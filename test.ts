import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import registerPrime, { assembleContextBundle } from "./index.ts";

console.log("=== Testing pi-prime extension ===");

const cwd = process.cwd();

// 1. Bundle Assembly Test
console.log("Testing assembleContextBundle in cwd:", cwd);
const bundle = await assembleContextBundle(cwd, { includeDiffSummary: true });

assert(bundle.markdown, "Bundle markdown must not be empty");
assert(bundle.branch, "Branch must be resolved");
assert(typeof bundle.dirtyFilesCount === "number", "dirtyFilesCount must be a number");
assert(bundle.markdown.includes("Dynamic Context Bundle"), "Markdown must have bundle header");
assert(bundle.markdown.includes("Branch:"), "Markdown must show branch");
console.log("✓ Context bundle assembled cleanly:");
console.log("  - Branch:", bundle.branch);
console.log("  - Dirty files count:", bundle.dirtyFilesCount);
console.log("  - Stack detected:", bundle.stack);
if (bundle.jevVerdict) {
  console.log("  - Jev working state:", bundle.jevVerdict);
}

// 2. Extension Tool and Command Registration Test
const registeredTools = new Map();
const registeredCommands = new Map();
const eventHandlers = new Map();

const mockPi = {
  registerTool(tool: any) {
    registeredTools.set(tool.name, tool);
  },
  registerCommand(name: string, cmd: any) {
    registeredCommands.set(name, cmd);
  },
  on(event: string, handler: any) {
    if (!eventHandlers.has(event)) eventHandlers.set(event, []);
    eventHandlers.get(event).push(handler);
  },
};

registerPrime(mockPi as any);

assert(registeredTools.has("prime"), "prime tool must be registered");
assert(registeredCommands.has("prime"), "/prime command must be registered");
assert(eventHandlers.has("before_agent_start"), "before_agent_start handler must be registered");
console.log("✓ Tool 'prime' and command '/prime' verified");

// 3. Tool Execution Test
const primeTool = registeredTools.get("prime");
const mockContext: any = { cwd };
const execRes = await primeTool.execute("call-prime-1", { includeDiffSummary: true }, mockContext);

assert(execRes.content[0].text.includes("Dynamic Context Bundle"), "Tool execution must output markdown bundle");
console.log("✓ prime tool executed successfully and generated bundle");

// 4. Guideline Injection Test
const beforeStartHandler = eventHandlers.get("before_agent_start")?.[0];
const startEvent: any = { systemPromptOptions: {} };
await beforeStartHandler(startEvent, mockContext);

assert(
  startEvent.systemPromptOptions.guidelines.some((g: string) => g.includes("ACTIVE TASK CONTEXT BUNDLE")),
  "before_agent_start must inject context bundle into guidelines"
);
console.log("✓ Bundle guideline injection verified post-prime execution");

console.log("\nALL TESTS PASSED! pi-prime is fully verified.");
