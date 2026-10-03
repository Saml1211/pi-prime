// Real-runtime check: does the primed bundle reach the model? Pi AgentSession + faux provider, no network.
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import prime from "./index.ts";

delete process.env.TYPESAFE_API_KEY; // no Jev network calls
process.env.HOME = mkdtempSync(join(tmpdir(), "pi-prime-home-"));
const dir = mkdtempSync(join(tmpdir(), "pi-prime-e2e-"));
const faux = fauxProvider({ models: [{ id: "faux", contextWindow: 100000, maxTokens: 500 }] });
const seen: string[] = [];
const capture = (reply: string) => (context: any) => {
  seen.push(JSON.stringify(context.messages));
  return fauxAssistantMessage(reply);
};
faux.setResponses([capture("ok"), capture("ok again")]);
const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null });
modelRuntime.registerNativeProvider(faux.provider);
const settingsManager = SettingsManager.inMemory({});
const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, extensionFactories: [prime], noSkills: true, noPromptTemplates: true });
await resourceLoader.reload();
const { session } = await createAgentSession({ cwd: dir, model: faux.getModel(), modelRuntime, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(dir), noTools: true } as any);
await (session as any).bindExtensions?.({});

await session.prompt("/prime"); // command assembles the bundle (non-git temp dir)
await session.prompt("first task");
await session.prompt("second task");
session.dispose();

assert.equal(seen.length, 2, "two model calls expected");
assert.match(seen[0], /ACTIVE TASK CONTEXT BUNDLE/, "bundle must reach the model on the next prompt");
assert.match(seen[1], /ACTIVE TASK CONTEXT BUNDLE/, "bundle must persist in context on later turns");
console.log("✓ primed bundle reaches the model and persists across turns");
console.log("\nE2E PASSED");
