# Sample headless sessions

Each session pipes one token per line to `node dist/cli/index.js --headless <file> --report <report.json>`.
These examples only illustrate the protocol; they are not the hidden tests.

## 1. Append and save

File `notes.txt` contains `foo` followed by a newline.

Keystrokes: `A` `_` `b` `a` `r` `<Esc>` `:` `w` `q` `<Enter>`

Result: exit code `0`; `notes.txt` is now `foo_bar` plus a final newline; the swap file `.notes.txt.swp` is gone.

## 2. Typing a space and a line break

Keystrokes: `i` `h` `i` `<Space>` `y` `o` `u` `<Enter>` `!` `<Esc>`

Result (stdin ends, so the session ends with exit code `0` and nothing is saved); report:

```json
{ "exitCode": 0, "exitMessage": "", "finalContent": "hi you\n!", "cursorRow": 1, "cursorCol": 0, "isDirty": true, "mode": "NORMAL" }
```

## 3. Refused quit

Keystrokes: `i` `x` `<Esc>` `:` `q` `<Enter>` `i` `y` `<Esc>`

Result: the session stops at the refused `:q` with exit code `1`, `stderr` contains `E37: unsaved changes (add ! to override)`, the last three tokens are never processed.
