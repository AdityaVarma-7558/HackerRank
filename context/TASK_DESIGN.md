# Task Design — Terminal Vim-Style Editor RL Gym Task

## 1. Locked Decisions (read this first)

| Decision | Choice | Why |
|---|---|---|
| Language/runtime | TypeScript on Node.js 20+ | `package.json`-driven scripts are native, easy for verifier to spawn as a child process, easy to strip to pure functions for black-box testing |
| Core vs UI split | `core/` = pure editor engine (no terminal I/O). `cli/` = thin renderer + input loop | Required by the spec ("core editing logic decoupled from terminal UI rendering") and is what makes black-box verification possible at all |
| Verifier interface | **Headless scriptable mode**: `node dist/cli/index.js --headless <file>` reads a script of keystroke-tokens (one per line) from stdin, applies them to the core engine, and on exit writes final file contents + a JSON status blob to a `--report <path>` file | PTY emulation is fragile and non-deterministic across CI runners. A headless mode gives the verifier deterministic, fast, script-driven control while still exercising the *real* input parser (not a mocked one) |
| Interactive mode | Normal PTY mode (`node dist/cli/index.js <file>`) using raw stdin + `readline`/ANSI escapes | Needed for the app to be a "realistic" editor a human could actually use — reference solution must feel real, not just pass tests |
| Registers | `"a`–`"z` (26 named) + 1 unnamed default register + `"0` (last yank) | Matches real Vim semantics closely enough to be non-trivial without requiring full Vim register algebra (`"+`, `"*`, black hole `"_` excluded — out of scope, noted in instruction.md) |
| Swap/journal file | `.<filename>.swp` (hidden, same directory as target file) | Standard Vim convention; verifier can assert on its presence/absence/content directly |
| Journal format | Append-only newline-delimited JSON, one operation per line: `{seq, ts, op, args}` | Cheap to replay, cheap for the verifier to parse and assert against without needing the app's internals |
| External modification detection | Store `{mtimeMs, size, sha256}` of the file at open time (and after every successful `:w`) inside the swap file; recheck before any `:w` | `mtimeMs` alone is too coarse on some filesystems (1s resolution) — hashing is what makes this deterministic in CI |
| Crash simulation | Verifier sends `SIGKILL` to the headless process mid-script | This is literally what the spec asks for; no synthetic "crash flag" — must be a real kill signal |

---

## 2. Application Scope

### 2.1 Modes
- **Normal** — default; single keys and counted/registered commands.
- **Insert** — entered via `i`, `a`, `I`, `A`, `o`, `O`; free text insertion; exit via `<Esc>`.
- **Visual** (character-wise) and **Visual Line** (`V`) — selection for `d`, `y`, `c` over a range.
- **Command-line** — entered via `:`; parses `:w`, `:q`, `:wq`, `:q!`, `:w!`, plus `:<line>` for jump-to-line.

### 2.2 Editing mechanics in scope
- Motions: `h j k l w b e 0 $ gg G <count>G`
- Operators: `d y c` combined with motions and `dd yy cc` line-forms
- `p` / `P` (paste after/before), with count (`5p`)
- Named register write (`"add`, `"ayy`) and read (`"ap`)
- Undo/redo: `u` / `<C-r>`, minimum 100-entry undo stack, tree not required (linear stack is fine — noted as acceptable in instruction.md so the model doesn't over-engineer)
- Numeric multipliers on any operator+motion pair (`3dd`, `2dw`, `5p`)

### 2.3 Explicitly out of scope (state this plainly in instruction.md so ambiguity can't leak into scoring)
- Regex search/replace (`:s///`)
- Macros (`q`, `@`)
- Splits/tabs/multiple buffers
- Clipboard integration (`"+`, `"*`)
- Syntax highlighting

Keeping these explicitly *out* is what keeps the task solvable in the target difficulty band without becoming ambiguous about what's tested.

### 2.4 Stateful workflows / failure scenarios the verifier will drive
1. **Basic edit + save** — open, insert text, `:w`, reopen, assert contents.
2. **Unsaved-quit guard** — edit, `:q` → must refuse (non-zero exit / stderr message), `:q!` → must exit discarding changes.
3. **Named register round-trip** — yank into `"b`, delete unrelated text, paste from `"b`, assert content and that the *unnamed* register was untouched by the named yank.
4. **Count multipliers** — `3dd` on a 5-line file leaves exactly 2 lines, deleted lines land in the default register in original order.
5. **External modification** — open file A, externally overwrite the file on disk (simulating another process/editor), then attempt `:w` inside the running session → must warn and require `:w!` to force-overwrite.
6. **Crash recovery** — open file, make edits, `SIGKILL` the process before `:w`, relaunch the editor on the same file → swap file is detected, uncommitted edits are recoverable (either auto-recovered or offered via a deterministic `--recover` flag — **decision: expose `--recover` explicitly rather than an interactive prompt**, since the headless verifier can't answer an interactive prompt).
7. **Stale swap file on clean open** — opening a file whose swap file is left over from a *previous clean exit* (bug scenario) must not falsely trigger recovery — swap file must be deleted on clean `:w`/`:q`.

---

## 3. Repository Structure (exact paths)

```
.
├── task/
│   ├── instruction.md              # model-facing spec (see §4)
│   └── public/
│       └── examples/               # 2-3 tiny sample .txt fixtures the model may reference
├── reference/
│   ├── src/
│   │   ├── core/                   # pure engine: buffer, modes, registers, undo, journal
│   │   │   ├── buffer.ts
│   │   │   ├── modes.ts
│   │   │   ├── registers.ts
│   │   │   ├── undo.ts
│   │   │   ├── journal.ts
│   │   │   └── engine.ts           # command dispatcher, single entry point core exposes
│   │   └── cli/
│   │       ├── index.ts            # arg parsing: interactive vs --headless vs --recover
│   │       ├── interactive.ts      # PTY renderer/input loop
│   │       └── headless.ts         # stdin script runner + --report writer
│   ├── package.json
│   └── tsconfig.json
├── evaluation/
│   ├── tests/
│   │   ├── 01-basic-edit.test.ts
│   │   ├── 02-quit-guard.test.ts
│   │   ├── 03-registers.test.ts
│   │   ├── 04-counts.test.ts
│   │   ├── 05-external-mod.test.ts
│   │   ├── 06-crash-recovery.test.ts
│   │   └── 07-stale-swap.test.ts
│   ├── mutants/
│   │   ├── m01-no-unsaved-guard/
│   │   ├── m02-register-overwrite-bug/
│   │   ├── m03-off-by-one-count/
│   │   ├── m04-hash-check-skipped/
│   │   ├── m05-journal-not-flushed/
│   │   ├── m06-empty-line-insert-skipped/
│   │   ├── m07-swap-not-cleared-on-quit/
│   │   └── README.md               # 1-line description + which test(s) must catch each
│   ├── acceptance-criteria.yml
│   ├── scoring.yml
│   └── proof-of-work/
│       ├── reference-run/
│       ├── mutant-run/
│       └── models/
│           ├── claude-opus-5/
│           └── gpt-5.6-sol/
├── app-setup/
│   ├── build.sh
│   ├── start.sh
│   └── reset.sh
└── package.json
```

---

## 4. `task/instruction.md` — content plan

Must specify (all *observable* behavior, zero internal architecture):
- CLI invocation: `<editor> <file>` opens interactively.
- Full keybinding table (modes, motions, operators, registers, counts) — this is safe to give in full because it's the *interface contract*, not the implementation.
- Exact `:w` / `:q` / `:q!` / `:w!` semantics, including exit codes:
  - `:q` with unsaved changes → refuse, exit code `1`, message to stderr containing the substring `unsaved`.
  - External-modification-on-`:w` → refuse, exit code `1`, message containing `modified`; `:w!` forces through.
- Swap file existence/naming contract (`.<name>.swp` next to the file) — stated generically as "a recovery file," without dictating its internal format (journal vs snapshot is the model's choice; only observable recovery behavior is graded).
- `--recover` flag contract for headless recovery testing.
- Explicit "out of scope" list from §2.3, so the model doesn't burn time on features that aren't graded.

---

## 5. Why this design hits the 2-model difficulty target
The failure scenarios in §2.4 are individually simple but compound: a model has to get the mode/motion/operator grammar right (Vim command parsing is notoriously fiddly), *and* get register semantics right, *and* get two separate pieces of persisted state right (swap file + external-mod hash) that most coding agents don't spontaneously design for unless the spec forces them to. This combination — not any single feature — is what should push both models under the 30% bar; §2.3 keeps the surface area bounded enough that the task stays fair rather than just "long."
