# pi-prime

Dynamic Context Priming command and tool for the **Pi Coding Agent**, inspired by Dan Disler's ([IndyDevDan](https://github.com/disler)) *Elite Context Engineering*.

## The Problem

Standard agent workflows either:
1. Suffer from static instruction bloat (dumping massive global instruction files like `CLAUDE.md` / `AGENTS.md` into every turn, burning 40k+ tokens), or
2. Suffer from context amnesia after compaction or session reload, where the agent spends 3–6 tool turns manually checking `git status`, diffs, and package files to orient itself.

## The Solution

`pi-prime` provides:
1. **Tool `prime`**: Automatically generates a high-density, bounded Context Bundle (<1,200 tokens) in sub-50ms.
2. **Command `/prime`**: Allows instant manual execution from the terminal input bar.
3. **TypeSafe Jev Integration**: Calibrated judgment of current active engineering phase (`clean_slate`, `active_development`, `testing_and_fixing`) and uncommitted change risk.
4. **Automatic Prompt Injection**: Seamlessly injects the bundle into session guidelines without polluting the transcript.

## Verification

```bash
node --input-type=module test.ts
```

## Verification

```bash
bun run test.ts   # unit
bun run e2e.ts    # real Pi AgentSession + faux provider: bundle reaches the model and persists
```
