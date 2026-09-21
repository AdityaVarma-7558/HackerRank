# Build Plan — Execution Roadmap

Companion to `TASK_DESIGN.md`. That file locks *what* gets built; this file locks *in what order*, *with what commands*, and *how each acceptance criterion gets proven*.

---

## 1. Build Order (do not reorder — each stage unblocks the next)

1. **`reference/` core engine** (`buffer.ts`, `modes.ts`, `registers.ts`, `undo.ts`, `journal.ts`, `engine.ts`) — no CLI yet, just unit-testable pure functions.
2. **`reference/` CLI** — `headless.ts` first (unblocks verifier work immediately), `interactive.ts` second (needed for a realistic app, not needed for scoring).
3. **`app-setup/` scripts** — thin wrappers around the reference build; write these against the reference solution so they're proven correct before any model ever runs.
4. **`evaluation/tests/`** — write against the reference solution's headless mode; every test must pass on reference before anything else proceeds.
5. **`evaluation/mutants/`** — one mutant per test file (see §3), confirm each is caught.
6. **`evaluation/acceptance-criteria.yml`** + **`evaluation/scoring.yml`** — written last, once the actual test IDs exist, so the mapping is accurate rather than aspirational.
7. **`task/instruction.md`** — write last of the design artifacts, distilled from what the tests actually check (prevents instruction/verifier drift).
8. **Model evaluation runs** (`npm run generate` / `npm run score` for Claude Opus 5, then GPT-5.6-sol).
9. **`evaluation/proof-of-work/`** — populate with logs + scores from step 8.
10. **Collaborator access** — grant `content.team@problemsetters.com` last, once the repo is complete (avoid sharing an unfinished task).

---

## 2. Root `package.json` — locked script contents

```json
{
  "name": "vim-style-editor-rlgym-task",
  "version": "0.1.0",
  "private": true,
  "description": "RL Gym task: repository-level terminal Vim-style editor implementation, evaluated via black-box verifier suite.",
  "scripts": {
    "generate": "node ./scripts/generate-solution.js",
    "score": "node ./scripts/run-verifier.js --report evaluation/proof-of-work/latest-report.json",
    "check:mutants": "node ./scripts/run-mutants.js",
    "check:reference": "node ./scripts/run-verifier.js --target reference --report evaluation/proof-of-work/reference-run/report.json"
  }
}
```

- `generate` — invokes the model (Opus 5 / GPT-5.6-sol) against `task/instruction.md` + `task/public/`, writes its output into a scratch workspace (`workspace/<model-name>/`), single pass, no retries.
- `score` — points the verifier at whatever is in `workspace/<model-name>/`, defaults to the most recent `generate` output.
- `check:reference` — same verifier, pointed at `reference/` instead — this is the sanity gate that must hit 100% before anything else is trusted.
- `check:mutants` — runs the full test suite against every folder under `evaluation/mutants/*`, asserts each mutant fails at least one test that its corresponding clean build passes.

---

## 3. `app-setup/` — exact responsibilities

| Script | Responsibility | Must be idempotent? |
|---|---|---|
| `build.sh` | `npm ci && npm run build` inside the target solution dir (arg: path to reference/ or a model workspace) | Yes — safe to re-run |
| `reset.sh` | Deletes `dist/`, `*.swp`, `workspace/*/node_modules`, any generated test fixtures | Yes |
| `start.sh` | Launches `dist/cli/index.js --headless` and holds it open on stdin for the verifier to pipe scripts into | N/A (long-running) |

Each script takes the target directory as `$1` so the same three scripts serve the reference solution, both model workspaces, and every mutant — one set of lifecycle scripts, reused everywhere. This also doubles as a smoke test: if `build.sh` can't build a mutant, that's a bug in the mutant, not the harness.

---

## 4. Mutant strategy — one mutant per acceptance area

| Mutant | Bug introduced | Test(s) that must catch it |
|---|---|---|
| `m01-no-unsaved-guard` | `:q` always exits 0, never checks dirty flag | `02-quit-guard.test.ts` |
| `m02-register-overwrite-bug` | Named-register yank also overwrites the unnamed register incorrectly | `03-registers.test.ts` |
| `m03-off-by-one-count` | `3dd` deletes 2 or 4 lines instead of 3 | `04-counts.test.ts` |
| `m04-hash-check-skipped` | `:w` never checks on-disk hash, silently clobbers external edits | `05-external-mod.test.ts` |
| `m05-journal-not-flushed` | Journal writes are buffered and lost on `SIGKILL` | `06-crash-recovery.test.ts` |
| `m06-empty-line-insert-skipped` | Typing into a genuinely empty line silently drops the character | `01-basic-edit.test.ts` |
| `m07-swap-not-cleared-on-quit` | Swap file is never deleted on a clean, non-forced `:q` | `07-stale-swap.test.ts` |

Rule enforced by `check:mutants`: **every mutant must fail its specific expected test, and every test file must have at least one mutant that fails it.** This two-way check is what proves the suite isn't just padded with vacuous tests — a common failure mode in "hidden verifier" tasks the spec is implicitly guarding against. (The original 5-mutant set left `01-basic-edit` and `07-stale-swap` uncovered; `m06`/`m07` close that gap.)

---

## 5. `evaluation/scoring.yml` — weight allocation (must sum to 1.0)

| Component | Weight | Rationale |
|---|---|---|
| Basic edit/save correctness | 0.15 | Table stakes — must work but isn't the differentiator |
| Modal mechanics (motions/operators/counts) | 0.25 | Largest surface area, most opportunities for subtle bugs |
| Registers (named + default + count-paste) | 0.15 | Easy to get partially right, hard to get fully right |
| Unsaved-quit guard | 0.15 | Binary, high-signal — either implemented or not |
| External modification detection | 0.15 | Requires the model to *think of* this case unprompted from the instruction's observable-behavior description |
| Crash recovery (swap/journal) | 0.15 | Hardest, most likely to be skipped or half-implemented — key difficulty lever |

`acceptance-criteria.yml` maps each of the 7 test files to one of these six components (register tests split 04-counts partially into both "mechanics" and "registers" — document that split explicitly in the YAML comments so scoring isn't ambiguous).

---

## 6. Model evaluation protocol

Per the brief, this evaluates Claude Opus 5 and GPT-5.6-sol specifically (see `scripts/generate-solution.js` for the real Anthropic/OpenAI API calls). Requires `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env`.

1. Fresh checkout per model — no shared workspace state between the two runs.
2. Single pass only: `npm run generate -- --model claude-opus-5 --reasoning medium`, then `npm run generate -- --model gpt-5.6-sol --reasoning medium`. No retries on failure, no feeding back test output — matches the spec's "single attempt" requirement. If a model rejects the reasoning/thinking parameter, re-run with `--reasoning omit`. If a response gets truncated, raise `ANTHROPIC_MAX_TOKENS`/`OPENAI_MAX_TOKENS` in `.env`.
3. `npm run score -- --target workspace/claude-opus-5 --report evaluation/proof-of-work/models/claude-opus-5/report.json` (and the `gpt-5.6-sol` equivalent) for each model, plus the raw transcript/log.
4. If either model scores ≥30%, do **not** submit — go back to `TASK_DESIGN.md` §2 and either tighten an edge case or remove a hint from `task/instruction.md`, then re-run `check:reference` before re-evaluating (reference must stay at 100% through any instruction tightening).
5. Record final scores, per-component breakdown, and a short failure-category note (e.g., "both models omitted external-modification detection entirely") in `evaluation/proof-of-work/`.

---

## 7. Final acceptance checklist (gate before requesting review)

- [ ] `npm run check:reference` → 100%
- [ ] `npm run check:mutants` → every mutant caught, every test has ≥1 catching mutant
- [ ] `scoring.yml` weights sum to exactly 1.0 (lint this programmatically, don't eyeball it)
- [ ] Claude Opus 5 score < 30%
- [ ] GPT-5.6-sol score < 30%
- [ ] Repeated `npm run score` on the same model workspace produces identical results (determinism check — run twice, diff the reports)
- [ ] No verifier internals (`evaluation/`) referenced or leaked from `task/` or `reference/`
- [ ] `content.team@problemsetters.com` granted collaborator access — **last step**
