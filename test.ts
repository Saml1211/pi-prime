import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import registerPrime, { assembleContextBundle } from "./index.ts";

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
