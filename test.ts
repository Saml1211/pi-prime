import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import registerPrime, { assembleContextBundle } from "./index.ts";
process.env.PI_SELF_COMPACT_STATE_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "prime-state-")); // never read real notes

console.log("=== Testing pi-prime extension (Hardened) ===");

const registeredTools = new Map();
const registeredCommands = new Map();
const registeredHandlers = new Map();

const mockPi = {
  registerTool(tool: any) {
    registeredTools.set(tool.name, tool);
  },
  registerCommand(name: string, cmd: any) {
    registeredCommands.set(name, cmd);
  },
  on(event: string, handler: Function) {
    registeredHandlers.set(event, handler);
  },
};

registerPrime(mockPi as any);

assert(registeredTools.has("prime"), "prime tool must be registered");
assert(registeredCommands.has("prime"), "/prime command must be registered");
const primeTool = registeredTools.get("prime");
console.log("✓ Tool and command registrations verified");

// 1. Five-argument tool execute test
const mockCtx: any = {
  cwd: process.cwd(),
  ui: { notify: () => {} },
};

const controller = new AbortController();
const toolRes = await primeTool.execute("call-prime-1", { includeDiffSummary: true }, controller.signal, () => {}, mockCtx);
assert(toolRes.content[0].text.includes("Dynamic Context Bundle"), "Must output bundle");
console.log("✓ Pi 5-argument tool.execute contract verified");

// 2. Non-git directory handling test
const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nongit-"));
try {
  const nonGitBundle = await assembleContextBundle(nonGitDir);
  assert.equal(nonGitBundle.isGitRepo, false, "Must detect non-git directory");
  assert(nonGitBundle.markdown.includes("Not a git repository"), "Must report 'Not a git repository', not clean tree");
  console.log("✓ Non-git directory handling verified (prevents false clean-tree claims)");
} finally {
  fs.rmSync(nonGitDir, { recursive: true, force: true });
}

// 3. Prompt guidelines hook test
const beforeHandler = registeredHandlers.get("before_agent_start");
assert(beforeHandler, "before_agent_start handler must be registered");
const injected = await beforeHandler({ type: "before_agent_start", prompt: "x" }, mockCtx);
assert.equal(injected?.message?.customType, "pi-prime-bundle", "bundle must be returned as a before_agent_start message");
assert(injected.message.content.includes("ACTIVE TASK CONTEXT BUNDLE"));
assert.equal(await beforeHandler({ type: "before_agent_start", prompt: "y" }, mockCtx), undefined, "bundle is delivered once");
console.log("✓ before_agent_start returns the bundle as a message, once (real delivery: e2e.ts)");

console.log("\nALL TESTS PASSED! pi-prime is fully hardened.");


// Workspace scoping + aggregate size bound
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cp = await import("node:child_process");
  const { assembleContextBundle, noteBackupPathFor, MAX_BUNDLE_CHARS } = await import("./index.ts");
  const assert = (await import("node:assert")).default;
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "prime-ws-")));
  const a = path.join(tmp, "a"), b = path.join(tmp, "b");
  fs.mkdirSync(a); fs.mkdirSync(b);
  const write = (cwd: string, header: string, note: string) => {
    fs.mkdirSync(path.dirname(noteBackupPathFor(cwd)), { recursive: true });
    fs.writeFileSync(noteBackupPathFor(cwd), `<!-- self-compact cwd: ${JSON.stringify(header)} saved: 2026-10-03T00:00:00.000Z -->\n${note}\n`);
  };
  write(a, a, "repo A secret plan");
  assert.match((await assembleContextBundle(a)).markdown, /repo A secret plan/, "own workspace note is included");
  assert.doesNotMatch((await assembleContextBundle(b)).markdown, /repo A secret plan/, "another workspace's note is never included");
  write(b, a, "forged header"); // file at B's path but header says A
  assert.doesNotMatch((await assembleContextBundle(b)).markdown, /forged header/, "header must match the workspace exactly");
  // huge commit subject + long paths cannot blow the budget
  const g = (...args: string[]) => cp.execFileSync("git", args, { cwd: a, stdio: "ignore" });
  g("init", "-q"); fs.writeFileSync(path.join(a, "f"), "x");
  g("add", "f"); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "S".repeat(50000));
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(a, "p".repeat(200) + i), "x");
  const big = await assembleContextBundle(a);
  assert.ok(big.markdown.length <= MAX_BUNDLE_CHARS + 30, `bundle ${big.markdown.length} chars exceeds cap`);
  console.log(`✓ notes scoped to the exact workspace; bundle capped (${big.markdown.length} chars with a 50K commit subject)`);
}
