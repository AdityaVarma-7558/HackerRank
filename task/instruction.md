# Task: Build a Terminal Vim-Style Text Editor

Implement a modal, Vim-style text editor for local files in **TypeScript on Node.js**. The editor has two front-ends over one editing engine:

* an **interactive** terminal editor for humans, and
* a **headless** mode that reads a scripted stream of keystrokes from `stdin`, so that an automated harness can drive the editor deterministically and inspect the result.

Keep the editing logic independent of terminal rendering (the headless mode must work with no TTY at all). How you structure the code is up to you. What you must get right is the **observable behavior** specified below: file contents on disk, exit codes, `stderr` output, the headless report, and the swap file.

Your solution is graded by a hidden black-box test suite that only uses the command line, the files it creates, exit codes, and signals. Follow this document literally; where it gives an exact rule, tests depend on it.

## 1. Deliverable and build

* Write the solution as TypeScript source files under `src/`. The entry point must be `src/cli/index.ts`.
* The harness supplies `package.json` (scripts: `build` = `tsc`) and `tsconfig.json` (`rootDir: ./src`, `outDir: ./dist`, CommonJS). Do **not** produce them. Only Node.js built-in modules may be used at runtime; `typescript` and `@types/node` are already available at build time.
* After `npm run build`, the program must be runnable as `node dist/cli/index.js ...`.
* Exit codes: `0` success, `1` an editing/command error as described below, `2` invalid command-line usage.

## 2. Command line and headless protocol

```
node dist/cli/index.js <file>                                          # interactive editor
node dist/cli/index.js --headless <file> [--report <path>] [--recover] # scripted mode
```

Options may appear in any order after the executable. `<file>` may be an absolute or relative path and may not exist yet.

### Headless keystroke stream

In `--headless` mode the editor reads `stdin` **one token per line** and feeds each token to the editor as a single keystroke, in order, as it arrives (do not wait for end-of-input before acting on tokens). Leading/trailing whitespace on a line is ignored; blank lines are ignored.

| Token | Key |
|---|---|
| any single character other than a space (`a`, `G`, `$`, `"`, `:` , `!`, `0`, ...) | that character |
| `<Space>` | the space character |
| `<Esc>` | Escape |
| `<Enter>` | Return |
| `<Backspace>` | Backspace |
| `<C-r>` | Control-R |

Any other token is ignored. Tokens are always single keys: `dd` is written as the two lines `d` and `d`.

### Session end

* After `:q`, `:q!`, `:wq`, or `:wq!` succeeds, the session ends **immediately**: remaining tokens are not processed and the exit code is `0`.
* If a command **fails** (a refused `:q`, a refused `:w`, an unknown command, an unwritable file), the session ends **immediately** with exit code `1`. The message is written to `stderr` followed by a newline; remaining tokens are not processed. (The interactive editor instead shows the message and keeps running.)
* If `stdin` reaches end-of-file without the session having ended, the editor stops with exit code `0`. It does **not** delete the swap file and does **not** save anything.

### Report

If `--report <path>` is given, the editor writes a JSON file to that path just before exiting (for every kind of exit above). It contains exactly these fields:

```json
{
  "exitCode": 0,
  "exitMessage": "",
  "finalContent": "line one\nline two",
  "cursorRow": 1,
  "cursorCol": 3,
  "isDirty": false,
  "mode": "NORMAL"
}
```

* `exitCode`: the process exit code. `exitMessage`: the text written to `stderr` (without the trailing newline), or `""`.
* `finalContent`: the buffer's lines joined with `\n`, **without** a trailing newline (a buffer with one empty line gives `""`).
* `cursorRow`, `cursorCol`: zero-based cursor position in the buffer.
* `isDirty`: `true` iff the buffer text differs from the text last loaded from or saved to disk (see section 6).
* `mode`: one of `NORMAL`, `INSERT`, `VISUAL`, `VISUAL_LINE`, `COMMAND`.

Nothing is written to the report path if the process is killed by a signal.

## 3. File model

* A file is a sequence of lines separated by `\n`. A trailing `\n` **terminates the last line**; it does not create an extra empty line. So `"a\nb\n"` is the two lines `a`, `b`, and `G` goes to `b`.
* An empty file, or a file that does not exist, is a buffer with one empty line.
* When writing, the buffer is written as its lines joined with `\n` **plus a final `\n`**. The single exception is a buffer whose only line is empty, which is written as an empty (0-byte) file.
* Opening a file that does not exist does not create it. `:w` creates it.
* Files are UTF-8. You do not need to handle `\r\n` specially.

## 4. Editing model

The editor starts in **Normal** mode with the cursor at row 0, column 0.

### Cursor rules

* In Normal and Visual modes the cursor is always on a character, so its column is at most `length - 1` (column 0 on an empty line). In Insert mode it may also sit just past the last character.
* Vertical motions (`j`, `k`, `G`, ...) keep the column, then clamp it to the target line. The editor does **not** remember a "desired column": after moving through a short line, the clamped column is used for further vertical motion.
* No motion ever moves the cursor outside the buffer; counts larger than the buffer allows are clamped.

### Insert mode

* `i` inserts before the cursor. `a` inserts after the cursor character (on an empty line it behaves like `i`). `I` inserts at column 0 of the current line. `A` inserts at the end of the current line. `o` / `O` open a new empty line below / above the current line and start inserting on it. Counts before these commands are ignored.
* In Insert mode: a single-character token inserts that character at the cursor; `<Space>` inserts a space; `<Enter>` splits the line at the cursor (the cursor moves to column 0 of the new line); `<Backspace>` deletes the character before the cursor, or at column 0 joins the line onto the end of the previous line (cursor at the join point), and does nothing at the very start of the buffer.
* `<Esc>` returns to Normal mode and moves the cursor one column left unless it is already at column 0.

### Motions

A **count** (a number typed before the command) repeats a motion. `0` is the start-of-line motion unless it continues a number.

| Key | Motion |
|---|---|
| `h` `l` | left / right by count characters, stopping at the line's first / last character |
| `j` `k` | down / up by count lines, stopping at the last / first line |
| `0` | first column of the line |
| `$` | last character of the line (with a count `n`, the last character of the line `n-1` lines down) |
| `gg` | first line; with a count `n`, line `n` (1-based, clamped) |
| `G` | last line; with a count `n`, line `n` (1-based, clamped) |
| `w` | start of the next word |
| `b` | start of the previous word |
| `e` | end of the current word, or of the next word if already at an end |

A **word** is a run of letters, digits and `_`, or a run of other non-blank characters (so punctuation forms its own words), separated by blanks or line breaks. An empty line counts as a word for `w` and `b`. `w`, `b` and `e` cross line boundaries. `gg` and `G` put the cursor at column 0 of the target line.

### Operators

`d` (delete), `y` (yank), `c` (change = delete then enter Insert mode). An operator followed by a motion applies to the text between the cursor and the motion's destination:

* `w`, `b`, `h`, `l`, `0` are **exclusive**: the character at the far end is not included. For a forward motion the range starts at the cursor; for a backward motion (`b`, `h`, `0`) it ends just before the cursor.
* `e` and `$` are **inclusive**: the character at the destination is included (`$` includes the last character of the line).
* If `w` (with `d`, `y` or `c`) would land on a later line than the cursor, the range stops at the end of the cursor's line: `dw` on the last word of a line deletes to the end of that line and never joins lines.
* `cw` on a non-blank character behaves like `ce`.
* `j`, `k`, `G`, `gg` are **linewise** with an operator: `dj` deletes the current and the next line (count applies), `dG` deletes from the current line to the last line, `dgg` from the first line to the current line, `dk` the current and the previous line.
* Operator+motion combinations are only guaranteed to be tested when the range stays within one line, apart from the linewise motions above.

Doubling the operator (`dd`, `yy`, `cc`) applies it to `count` lines starting at the cursor line, clamped at the end of the buffer. `cc` replaces those lines with a single empty line and starts Insert mode on it. After a linewise `d`, the cursor is on the line that took the deleted text's place (or the new last line) at column 0. A `count` may come before the operator or between the operator and the motion (`3dd`, `2dw`, `d2w`); using both is not defined.

After a yank the cursor moves to the start of the yanked text (a linewise yank keeps the column, moves to the first yanked line). Deleting the last remaining line leaves one empty line.

### Registers

* The **unnamed** register is the default target of every delete, change and yank, and the default source of `p` / `P`.
* **Named** registers are `a` to `z`. A `"` followed by a register letter immediately before an operator or a paste selects that register: `"ayy`, `"add`, `"ap`, `"aP`.
* An operation that names a register writes **only** that register. The unnamed register is left exactly as it was. Pasting with `"a` reads register `a` only.
* A register remembers whether its text is **linewise** (from `dd`, `yy`, `cc`, `dj`, ..., Visual line mode) or **characterwise**.
* Pasting from an empty register does nothing (and is not an undo step).

### Paste

* Linewise register: `p` inserts the register's lines below the cursor line, `P` above it, `count` times in a row, in original order. The cursor goes to column 0 of the first pasted line.
* Characterwise register: `p` inserts the text after the cursor character (at column 0 on an empty line), `P` before it, repeated `count` times. For single-line text the cursor ends on the last inserted character.

### Undo and redo

* `u` undoes, `<C-r>` redoes, each `count` times. With nothing to undo or redo they do nothing.
* Every editing command is one undo step: `dd`, `dw`, `p`, `cc`, a Visual `d`, and so on. An **Insert session** (from `i`/`a`/`o`/... or the text typed after `c...`, up to `<Esc>`) is one step in total, and it includes the change made by the command that started it (for example the deletion done by `cw`).
* Yanks, motions, mode changes, `:w`, and Insert sessions in which nothing changed are **not** steps.
* A new edit after an undo discards the redo history.
* Keep at least the last 100 steps.
* Undo and redo restore the buffer text exactly, and put the cursor where it was before the undone change.

### Visual mode

* `v` starts characterwise Visual mode, `V` starts linewise Visual mode, anchored at the cursor. All motions above (with counts) move the cursor and extend the selection.
* A characterwise selection covers everything between the anchor and the cursor **inclusive of both ends**, in either direction. A linewise selection covers whole lines.
* `d`, `y`, `c` act on the selection and return to Normal mode (`c` continues into Insert mode). A `"x` register prefix may be typed before the operator inside Visual mode. Yank leaves the cursor at the start of the selection.
* `<Esc>` leaves Visual mode without changing anything; pressing `v` in characterwise Visual mode or `V` in linewise Visual mode also leaves it, and pressing the other one switches type.

## 5. Command-line mode

`:` in Normal mode starts collecting a command; `<Enter>` runs it, `<Esc>` cancels, `<Backspace>` deletes the last character (and cancels if it was the only one). Supported commands:

| Command | Effect |
|---|---|
| `:w` | write the buffer to the file (see section 6 for the safety check) |
| `:w!` | write without the external-modification check |
| `:q` | quit; refused if there are unsaved changes |
| `:q!` | quit, discarding unsaved changes |
| `:wq` | `:w` then quit (if the write fails, the editor does not quit) |
| `:wq!` | `:w!` then quit |
| `:<n>` | jump to line `n` (1-based, clamped to the buffer), column 0 |

A command is matched **exactly** (after trimming blanks). Anything else, including `:qq` and `:wx`, is an error: the message contains the word `unknown` (e.g. `E492: unknown command: qq`), it causes exit code 1 in headless mode, and nothing is written or quit.

## 6. Unsaved changes and external modification

### Unsaved changes

The buffer is **dirty** when its text differs from the text last loaded from or written to the file (so undoing every edit makes it clean again). `:q` on a dirty buffer is refused: exit code `1` and a message on `stderr` that contains the word `unsaved` (e.g. `E37: unsaved changes (add ! to override)`). The file and the swap file are left as they are. `:q` on a clean buffer and `:q!` exit with code `0`.

### External modification

When the file is opened, remember its content (for example a SHA-256 hash; a file that did not exist is remembered as "absent"). Before every `:w` / `:wq`, compare the file currently on disk with what was remembered:

* If the content on disk is **different** (or the file did not exist when opened but exists now), the write is refused: exit code `1`, and `stderr` contains the word `modified` (e.g. `E12: the file has been modified since it was opened. Use :w! to override.`). The file on disk is not touched.
* Detection is by **content**, not by timestamp: if another process rewrites the file with identical bytes (even with a newer modification time), the write proceeds normally.
* After each successful write, the file's new content becomes the remembered content, so consecutive `:w` commands from the same session never trigger the check.
* `:w!` and `:wq!` skip the check and overwrite the file.

## 7. Swap file and crash recovery

The editor maintains a hidden swap (journal) file so that unsaved edits survive a crash, including `SIGKILL`, which gives the process no chance to clean up.

* **Name and place.** The swap file for `dir/name` is `dir/.name.swp` (a dot, the file name, `.swp`, in the same directory as the edited file). Its format is up to you.
* **Creation.** It must exist by the time the editor has opened the file, before the first keystroke is processed.
* **Durability.** Every keystroke that has been processed must be reflected in the swap file within 250 ms, without the process having to exit or flush at exit. A harness will send `SIGKILL` some time after the last keystroke it sent.
* **After a save.** After a successful `:w` the swap file only needs to describe edits made *after* that save; edits already saved to the file must not be applied a second time by a later recovery.
* **Clean exit.** Any successful exit through `:q`, `:q!`, `:wq` or `:wq!` deletes the swap file. A *refused* `:q` leaves it in place. End-of-input (section 2) also leaves it in place.
* **Recovery.** If the editor is started with `--recover` and a swap file exists, it restores the unsaved edits recorded there on top of the file as it is on disk: the resulting buffer text equals the buffer text the killed session had after its last processed keystroke. The recovered editor is in Normal mode with no pending count, operator or register, and it is dirty if the recovered text differs from the file on disk. Editing then continues normally and the swap file keeps recording, so a crash after a recovery can itself be recovered.
* **Ignoring stale swap files.** If a swap file exists but `--recover` is **not** given, the leftover swap file is discarded and the file is opened exactly as it is on disk: not dirty, with no edits replayed. If `--recover` is given but there is no swap file, the file is simply opened normally.

## 8. Interactive mode

`node dist/cli/index.js <file>` runs a full-screen terminal editor using the same engine. Raw keyboard input is mapped to the same keys as in the headless protocol (including Space, Escape, Enter, Backspace, Ctrl-R, and shifted characters such as `G`, `$`, `:`). The screen shows the buffer with a visible cursor and a status line with the current mode and file name; command errors are shown in the status line instead of terminating the editor. `--recover` works in interactive mode too. The hidden suite exercises the headless mode; the interactive mode must still be a working editor.

## 9. Out of scope

Do not implement any of the following: regex search/replace (`:s`), `/` search, macros (`q`, `@`), splits, tabs or multiple buffers, system clipboard registers (`"+`, `"*`), the black-hole register, uppercase (append) registers, syntax highlighting, an undo tree (a linear undo history is enough), `.` repeat, text objects, marks.
