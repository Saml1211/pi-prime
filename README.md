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
4. **Prompt Delivery**: Adds the bundle to the conversation as a hidden custom message with your next prompt, so it stays in context on later turns.

## Verification

```bash
node --input-type=module test.ts
```

## Verification

```bash
bun run test      # unit + isolated Git-status regressions
bun run e2e.ts    # real Pi AgentSession + faux provider: bundle reaches the model and persists
```

## Bounds and scoping

- The bundle is hard-capped at 4,800 characters (about 1,200 tokens). Commit subjects, status paths and script names are clipped one by one first, because repo metadata is untrusted and unbounded.
- The continuation note comes only from self-compact's per-workspace backup, `~/.pi/state/continuation-notes/<sha256(cwd)[:16]>.md`, and only when its header names exactly this workspace. Another repo's note is never replayed.

## Git status result API

`assembleContextBundle()` returns `statusKnown: true` and a numeric `dirtyFilesCount` only after a successful Git status query. A successful empty result is a clean tree (`0`); a failed or timed-out query returns `statusKnown: false` and `dirtyFilesCount: null`. Non-Git directories also return `false`/`null` and remain labeled as non-Git.

`dirtyFilesCount` is now `number | null`, and `ContextBundleResult` includes the required `statusKnown` field. Consumers of these exported APIs must handle the unknown case; check `dirtyFilesCount !== null` before numeric operations. The Pi tool and command display unavailable status rather than treating a failed query as a clean tree.
