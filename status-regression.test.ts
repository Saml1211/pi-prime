// Focused regression for Git status observation failures.
// No real Git repository, credentials, or network are used by this file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import registerPrime, { assembleContextBundle } from "./index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prime-status-"));
const binDir = path.join(tmp, "bin");
const cwd = path.join(tmp, "workspace");
fs.mkdirSync(binDir);
fs.mkdirSync(cwd);

const savedEnv = {
  PATH: process.env.PATH,
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
  PI_SELF_COMPACT_STATE_DIR: process.env.PI_SELF_COMPACT_STATE_DIR,
  PI_PRIME_TEST_STATUS: process.env.PI_PRIME_TEST_STATUS,
};
const originalFetch = globalThis.fetch;
const observedStates: string[] = [];
const notifications: string[] = [];

// The product already invokes Git through a shell. This POSIX fixture controls
// only the subprocess observations; no repository code is executed by the shim.
fs.writeFileSync(path.join(binDir, "git"), [
  "#!/bin/sh",
  'if [ "$PI_PRIME_TEST_STATUS" = "non-git" ]; then exit 128; fi',
  'case "$1" in',
  "  rev-parse) printf 'true\\n' ;;",
  "  branch) printf 'fixture-branch\\n' ;;",
  "  log) printf 'abc123 fixture commit\\n' ;;",
  "  status)",
  '    case "$PI_PRIME_TEST_STATUS" in',
  "      clean) exit 0 ;;",
  "      dirty) printf ' M tracked.ts\\n' ;;",
  "      error) exit 128 ;;",
  "      timeout) exec sleep 3 ;;",
  "      *) exit 128 ;;",
  "    esac ;;",
  "  diff) exit 0 ;;",
  "  *) exit 128 ;;",
  "esac",
  "",
].join("\n"), { mode: 0o755 });

try {
  process.env.PATH = binDir + path.delimiter + (savedEnv.PATH || "");
  process.env.TYPESAFE_API_KEY = "fixture-key";
  process.env.PI_SELF_COMPACT_STATE_DIR = path.join(tmp, "notes");
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    observedStates.push(body.state);
    return new Response(JSON.stringify({
      answers: {
        working_phase: { choice: "active_development" },
        uncommitted_risk: { noul: 0.5 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  for (const mode of ["error", "timeout", "clean", "dirty"] as const) {
    process.env.PI_PRIME_TEST_STATUS = mode;
    const stateCountBefore = observedStates.length;
    const bundle = await assembleContextBundle(cwd, {}, "fixture-key");
    assert.equal(bundle.isGitRepo, true, mode + ": repository detection succeeds");
    assert.equal(observedStates.length, stateCountBefore + 1, mode + ": one Jev observation is captured");
    const state = observedStates[stateCountBefore];

    if (mode === "clean") {
      assert.equal(bundle.statusKnown, true);
      assert.equal(bundle.dirtyFilesCount, 0);
      assert.match(bundle.markdown, /\*\*Git Status:\*\* Clean tree/);
      assert.match(state, /Dirty files: 0\./);
    } else if (mode === "dirty") {
      assert.equal(bundle.statusKnown, true);
      assert.equal(bundle.dirtyFilesCount, 1);
      assert.match(bundle.markdown, /1 modified\/untracked files/);
      assert.match(bundle.markdown, /tracked\.ts/);
      assert.match(state, /Dirty files: 1\./);
    } else {
      assert.match(bundle.markdown, /Status unavailable \(git status failed\)/);
      assert.equal(bundle.statusKnown, false, mode + ": status remains unknown");
      assert.equal(bundle.dirtyFilesCount, null, mode + ": unknown is not zero");
      assert.doesNotMatch(bundle.markdown, /Clean tree|0 modified\/untracked/);
      assert.match(state, /Dirty files: unknown \(git status unavailable\)\./);
      assert.doesNotMatch(state, /Dirty files: 0/);
    }
  }

  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  registerPrime({
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    on: () => {},
  } as any);
  const ctx = {
    cwd,
    ui: { notify: (message: string) => notifications.push(message) },
  } as any;

  process.env.PI_PRIME_TEST_STATUS = "error";
  const output = await tools.get("prime").execute(
    "status-error", {}, new AbortController().signal, () => {}, ctx,
  );
  assert.match(output.content[0].text, /Status unavailable/);
  assert.doesNotMatch(output.content[0].text, /Clean tree/);
  await commands.get("prime").handler("", ctx);
  assert.match(notifications.at(-1)!, /\(status unavailable\)/);
  assert.doesNotMatch(notifications.at(-1)!, /\(0 dirty\)/);

  for (const [mode, label] of [["clean", "0 dirty"], ["dirty", "1 dirty"]] as const) {
    process.env.PI_PRIME_TEST_STATUS = mode;
    await commands.get("prime").handler("", ctx);
    assert.ok(notifications.at(-1)!.includes("(" + label + ")"));
  }

  process.env.PI_PRIME_TEST_STATUS = "non-git";
  const beforeNonGit = observedStates.length;
  const nonGit = await assembleContextBundle(cwd, {}, "fixture-key");
  assert.equal(nonGit.isGitRepo, false);
  assert.equal(nonGit.statusKnown, false);
  assert.equal(nonGit.dirtyFilesCount, null);
  assert.match(nonGit.markdown, /Not a git repository/);
  assert.doesNotMatch(nonGit.markdown, /Clean tree/);
  assert.equal(observedStates.length, beforeNonGit, "non-Git state is not sent to Jev");

  console.log("Status regression checks passed");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
