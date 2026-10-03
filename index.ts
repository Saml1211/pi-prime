import { homedir } from "node:os";
import { join, basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

function resolveJevApiKey(): string | undefined {
  if (process.env.TYPESAFE_API_KEY?.trim()) {
    return process.env.TYPESAFE_API_KEY.trim();
  }
  try {
    const configPath = join(homedir(), ".pi/agent/pi-jev.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      if (cfg.apiKey?.trim()) return cfg.apiKey.trim();
      if (cfg.apiKeyFile) {
        const keyFilePath = cfg.apiKeyFile.replace(/^~(?=$|\/)/, homedir());
        if (existsSync(keyFilePath)) {
          return readFileSync(keyFilePath, "utf8").trim();
        }
      }
    }
  } catch {}
  return undefined;
}

export interface ContextBundleOptions {
  includeDiffSummary?: boolean;
}

export interface ContextBundleResult {
  markdown: string;
  branch: string;
  dirtyFilesCount: number;
  stack: string;
  jevVerdict?: string;
  isGitRepo: boolean;
}

function safeExecGit(cmd: string, cwd: string, timeout = 2500): { ok: boolean; stdout: string } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export async function evaluateStateWithJev(
  summaryText: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ workingPhase: string; uncommittedRisk: number } | null> {
  const body = {
    state: summaryText,
    model: JEV_MODEL,
    questions: {
      working_phase: {
        type: "choice",
        instructions: "What active engineering phase best characterizes the repository state?",
        criteria: {
          clean_slate: "Working tree is clean, ready for new tasks",
          active_development: "Active uncommitted code changes in progress",
          testing_and_fixing: "Test or build errors present needing repair",
          ready_for_review: "Changes completed and ready for commit or review",
        },
      },
      uncommitted_risk: {
        type: "noul",
        instructions: "Are there substantial uncommitted changes that risk being lost or broken?",
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });

    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const answers = json?.answers;
    if (!answers) return null;

    const allowedPhases = ["clean_slate", "active_development", "testing_and_fixing", "ready_for_review"];
    const phaseRaw = answers.working_phase?.choice;
    const workingPhase = allowedPhases.includes(phaseRaw) ? phaseRaw : "active_development";

    const riskRaw = answers.uncommitted_risk?.noul;
    const uncommittedRisk = typeof riskRaw === "number" && Number.isFinite(riskRaw) ? riskRaw : 0.5;

    return { workingPhase, uncommittedRisk };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function assembleContextBundle(
  cwd: string,
  opts: ContextBundleOptions = {},
  jevApiKey?: string,
  signal?: AbortSignal,
): Promise<ContextBundleResult> {
  const includeDiff = opts.includeDiffSummary !== false;

  // 1. Git State Inspection
  const gitCheck = safeExecGit("git rev-parse --is-inside-work-tree", cwd);
  const isGitRepo = gitCheck.ok && gitCheck.stdout === "true";

  let branch = "not-git";
  let commit = "none";
  let dirtyFilesCount = 0;
  let statusSummary = "";
  let diffSummary = "";

  if (isGitRepo) {
    const branchRes = safeExecGit("git branch --show-current || git rev-parse --abbrev-ref HEAD", cwd);
    branch = branchRes.ok && branchRes.stdout ? branchRes.stdout : "detached";

    const commitRes = safeExecGit("git log -n 1 --oneline", cwd);
    commit = commitRes.ok && commitRes.stdout ? commitRes.stdout : "none";

    const statusRes = safeExecGit("git status --short", cwd);
    if (statusRes.ok) {
      const statusLines = statusRes.stdout ? statusRes.stdout.split("\n").filter((l) => l.trim().length > 0) : [];
      dirtyFilesCount = statusLines.length;
      statusSummary = statusLines.slice(0, 15).join("\n");
      if (statusLines.length > 15) {
        statusSummary += `\n... (+${statusLines.length - 15} more dirty files)`;
      }
    }

    if (includeDiff && dirtyFilesCount > 0) {
      const unstagedDiff = safeExecGit("git diff --stat", cwd);
      const stagedDiff = safeExecGit("git diff --cached --stat", cwd);
      const diffParts: string[] = [];
      if (stagedDiff.stdout) diffParts.push(`Staged:\n${stagedDiff.stdout}`);
      if (unstagedDiff.stdout) diffParts.push(`Unstaged:\n${unstagedDiff.stdout}`);
      diffSummary = diffParts.join("\n\n").slice(0, 1500);
    }
  }

  // 2. Stack & Toolchain Detection
  const stackItems: string[] = [];
  const pkgJsonPath = join(cwd, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      let pm = "npm";
      if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) pm = "bun";
      else if (existsSync(join(cwd, "pnpm-lock.yaml"))) pm = "pnpm";
      else if (existsSync(join(cwd, "yarn.lock"))) pm = "yarn";

      const scripts = pkg.scripts ? Object.keys(pkg.scripts).slice(0, 8).join(", ") : "none";
      stackItems.push(`Node/TS (${pm}): scripts [${scripts}]`);
    } catch {}
  }
  if (existsSync(join(cwd, "Cargo.toml"))) stackItems.push("Rust (cargo)");
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
    stackItems.push("Python (python3/ruff)");
  }
  if (existsSync(join(cwd, "justfile"))) stackItems.push("Justfile");
  if (existsSync(join(cwd, "Makefile"))) stackItems.push("Makefile");
  const stack = stackItems.length > 0 ? stackItems.join(" | ") : "Generic directory";

  // 3. Task / Continuation State (scoped by path)
  let continuationNote = "";
  const lastNotePath = join(homedir(), ".pi/state/last-continuation-note.md");
  if (existsSync(lastNotePath)) {
    try {
      const noteRaw = readFileSync(lastNotePath, "utf8").trim();
      if (noteRaw.length > 0) {
        continuationNote = noteRaw.slice(0, 600);
      }
    } catch {}
  }

  // 4. TypeSafe Jev Working State Check
  let jevVerdict = "";
  if (jevApiKey && isGitRepo) {
    const stateSummary = `Branch: ${branch}. Dirty files: ${dirtyFilesCount}. Commit: ${commit}. Stack: ${stack}.`;
    const jevRes = await evaluateStateWithJev(stateSummary, jevApiKey, signal);
    if (jevRes) {
      const riskPct = Math.round(jevRes.uncommittedRisk * 100);
      jevVerdict = `${jevRes.workingPhase.toUpperCase()} (uncommitted risk: ${riskPct}%)`;
    }
  }

  // 5. Construct Compact Markdown Bundle (< 1,200 tokens)
  const sections: string[] = [
    `### ⚡ Dynamic Context Bundle (${basename(cwd)})`,
    `- **Branch:** \`${branch}\` | **Commit:** \`${commit}\``,
    `- **Stack:** ${stack}`,
    `- **Git Status:** ${
      !isGitRepo
        ? "Not a git repository"
        : dirtyFilesCount === 0
        ? "Clean tree"
        : `${dirtyFilesCount} modified/untracked files`
    }`,
  ];

  if (jevVerdict) {
    sections.push(`- **Jev State:** ${jevVerdict}`);
  }

  if (dirtyFilesCount > 0 && statusSummary) {
    sections.push(`\n**Modified Files:**\n\`\`\`\n${statusSummary}\n\`\`\``);
  }

  if (diffSummary) {
    sections.push(`\n**Diff Summary:**\n\`\`\`\n${diffSummary}\n\`\`\``);
  }

  if (continuationNote) {
    sections.push(`\n**Preserved Continuation State:**\n> ${continuationNote.replace(/\n/g, "\n> ")}`);
  }

  return {
    markdown: sections.join("\n"),
    branch,
    dirtyFilesCount,
    stack,
    jevVerdict: jevVerdict || undefined,
    isGitRepo,
  };
}

export default function (pi: ExtensionAPI) {
  const jevApiKey = resolveJevApiKey();
  let pendingBundle: string | null = null;

  // 1. Tool: prime (conforming to Pi's 5-argument execute signature)
  pi.registerTool({
    name: "prime",
    label: "Prime Context Bundle",
    description:
      "Dynamically gathers a high-density, bounded Context Bundle (<1,200 tokens) covering active Git branch, dirty files, detected stack tools, open tasks, and Jev project state. Use after compaction or session start to orient immediately with zero context bloat.",
    promptSnippet: "Call prime to dynamically re-orient after compaction or when exploring a fresh workspace.",
    parameters: Type.Object({
      includeDiffSummary: Type.Optional(
        Type.Boolean({ description: "Whether to include a git diff stat summary (default: true)" }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const effectiveCtx: ExtensionContext | undefined = ctx || (signal && (signal as any).cwd ? (signal as any) : undefined);
      const effectiveSignal: AbortSignal | undefined = signal instanceof AbortSignal ? signal : effectiveCtx?.signal;
      const cwd = effectiveCtx?.cwd || process.cwd();

      const bundle = await assembleContextBundle(cwd, params, jevApiKey, effectiveSignal);
      pendingBundle = bundle.markdown;

      return {
        content: [
          {
            type: "text",
            text: `${bundle.markdown}\n\n[Context primed successfully. Bundle injected into prompt guidelines.]`,
          },
        ],
      };
    },
  });

  // 2. Slash Command: /prime
  pi.registerCommand("prime", {
    description: "Assemble and display a dynamic context bundle for the active workspace",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd || process.cwd();
      ctx.ui?.notify?.("Assembling dynamic context bundle...", "info");
      const bundle = await assembleContextBundle(cwd, {}, jevApiKey);
      pendingBundle = bundle.markdown;
      ctx.ui?.notify?.(
        `[pi-prime] Primed ${bundle.branch} (${bundle.dirtyFilesCount} dirty) | Stack: ${bundle.stack}`,
        "info",
      );
    },
  });

  // 3. Inject primed bundle into active guidelines on next turn
  pi.on("before_agent_start", async (event, _ctx: ExtensionContext) => {
    if (pendingBundle) {
      const guidelines = (event.promptGuidelines = event.promptGuidelines || []);
      guidelines.push(`[ACTIVE TASK CONTEXT BUNDLE]:\n${pendingBundle}`);
      pendingBundle = null;
    }
  });
}
