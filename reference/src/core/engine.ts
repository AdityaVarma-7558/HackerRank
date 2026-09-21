import * as fs from 'fs';
import { TextBuffer, parseText, serializeLines } from './buffer';
import { Mode } from './modes';
import { Registers, RegisterType } from './registers';
import { UndoStack } from './undo';
import { Journal, FileMeta } from './journal';

interface Pos {
  row: number;
  col: number;
}

interface MotionResult {
  pos: Pos;
  linewise: boolean;
  inclusive: boolean;
}

type Range =
  | { kind: 'line'; r1: number; r2: number }
  | { kind: 'char'; start: Pos; end: Pos };

export class Engine {
  public buffer: TextBuffer;
  public mode: Mode = Mode.Normal;
  public registers = new Registers();
  public undoStack = new UndoStack();
  public journal: Journal;

  private pendingCount = '';
  private awaitingRegister = false;
  private pendingRegister = '';
  private pendingOperator = '';
  private pendingG = false;
  private commandText = '';
  private visualAnchor: Pos | null = null;

  private insertPushedSnapshot = false;
  private savedText: string;
  private diskMeta: FileMeta | null = null;
  private replaying = false;
  private lastError: string | null = null;
  private exitRequested = false;

  constructor(filename: string, recover = false) {
    this.journal = new Journal(filename);
    let raw = '';
    if (fs.existsSync(filename)) {
      raw = fs.readFileSync(filename, 'utf-8');
      this.diskMeta = this.journal.getFileMeta();
    }
    this.buffer = new TextBuffer(filename, raw);
    this.savedText = this.buffer.text();

    if (recover && this.journal.hasSwap()) {
      this.recoverFromJournal();
    } else {
      this.journal.deleteSwap();
      this.journal.reset(this.diskMeta);
    }
  }

  get isDirty(): boolean {
    return this.buffer.text() !== this.savedText;
  }

  shouldExit(): boolean {
    return this.exitRequested;
  }

  takeError(): string | null {
    const e = this.lastError;
    this.lastError = null;
    return e;
  }

  private recoverFromJournal(): void {
    const entries = this.journal.readAll();
    this.replaying = true;
    for (const entry of entries) {
      if (entry.op === 'KEY') this.dispatch(entry.args.key);
    }
    this.replaying = false;
    this.lastError = null;
    if (this.mode !== Mode.Normal || this.hasPendingState()) {
      this.journal.appendKey('<Esc>');
      this.dispatch('<Esc>');
    }
    this.buffer.constrainCursor(false);
  }

  private hasPendingState(): boolean {
    return !!(this.pendingCount || this.awaitingRegister || this.pendingRegister || this.pendingOperator || this.pendingG);
  }

  public handleKey(key: string): void {
    this.journal.appendKey(key);
    this.dispatch(key);
  }

  private dispatch(key: string): void {
    switch (this.mode) {
      case Mode.Insert:
        this.handleInsert(key);
        break;
      case Mode.Command:
        this.handleCommand(key);
        break;
      default:
        this.handleNormalOrVisual(key);
    }
  }

  private pushUndo(): void {
    this.undoStack.push(this.buffer.snapshot());
  }

  private resetPending(): void {
    this.pendingCount = '';
    this.awaitingRegister = false;
    this.pendingRegister = '';
    this.pendingOperator = '';
    this.pendingG = false;
  }

  // ---------------------------------------------------------------- insert

  private handleInsert(key: string): void {
    const b = this.buffer;
    if (key === '<Esc>') {
      if (this.insertPushedSnapshot) {
        const top = this.undoStack;
        // Entering insert and leaving without typing must not create an undo step.
        if (b.text() === this.insertStartText) top.dropTop();
      }
      this.insertPushedSnapshot = false;
      this.mode = Mode.Normal;
      b.cursorCol = Math.max(0, b.cursorCol - 1);
      b.constrainCursor(false);
      return;
    }
    const line = b.lines[b.cursorRow];
    if (key === '<Enter>') {
      b.lines[b.cursorRow] = line.slice(0, b.cursorCol);
      b.lines.splice(b.cursorRow + 1, 0, line.slice(b.cursorCol));
      b.cursorRow++;
      b.cursorCol = 0;
    } else if (key === '<Backspace>') {
      if (b.cursorCol > 0) {
        b.lines[b.cursorRow] = line.slice(0, b.cursorCol - 1) + line.slice(b.cursorCol);
        b.cursorCol--;
      } else if (b.cursorRow > 0) {
        const prev = b.lines[b.cursorRow - 1];
        b.lines[b.cursorRow - 1] = prev + line;
        b.lines.splice(b.cursorRow, 1);
        b.cursorRow--;
        b.cursorCol = prev.length;
      }
    } else {
      const ch = key === '<Space>' ? ' ' : key.length === 1 ? key : '';
      if (ch) {
        b.lines[b.cursorRow] = line.slice(0, b.cursorCol) + ch + line.slice(b.cursorCol);
        b.cursorCol++;
      }
    }
  }

  private insertStartText = '';

  private enterInsert(pushSnapshot: boolean): void {
    if (pushSnapshot) {
      this.pushUndo();
      this.insertPushedSnapshot = true;
      this.insertStartText = this.buffer.text();
    } else {
      this.insertPushedSnapshot = false;
    }
    this.mode = Mode.Insert;
  }

  // --------------------------------------------------------------- command

  private handleCommand(key: string): void {
    if (key === '<Esc>') {
      this.mode = Mode.Normal;
      this.commandText = '';
      return;
    }
    if (key === '<Enter>') {
      const cmd = this.commandText;
      this.commandText = '';
      this.mode = Mode.Normal;
      this.executeCommand(cmd);
      return;
    }
    if (key === '<Backspace>') {
      this.commandText = this.commandText.slice(0, -1);
      if (this.commandText.length === 0) this.mode = Mode.Normal;
      return;
    }
    if (key === '<Space>') this.commandText += ' ';
    else if (key.length === 1) this.commandText += key;
  }

  private fail(message: string): void {
    if (!this.replaying) this.lastError = message;
  }

  private executeCommand(raw: string): void {
    const cmd = raw.trim();
    if (/^\d+$/.test(cmd)) {
      this.buffer.cursorRow = Math.max(0, Math.min(this.buffer.lines.length - 1, parseInt(cmd, 10) - 1));
      this.buffer.cursorCol = 0;
      return;
    }
    if (this.replaying) return;
    switch (cmd) {
      case '':
        return;
      case 'w':
        this.writeFile(false);
        return;
      case 'w!':
        this.writeFile(true);
        return;
      case 'wq':
        if (this.writeFile(false)) this.quit(true);
        return;
      case 'wq!':
        if (this.writeFile(true)) this.quit(true);
        return;
      case 'q':
        this.quit(false);
        return;
      case 'q!':
        this.quit(true);
        return;
      default:
        this.fail(`E492: unknown command: ${cmd}`);
    }
  }

  private writeFile(force: boolean): boolean {
    if (!force) {
      const cur = this.journal.getFileMeta();
      const init = this.diskMeta;
      const changed =
        (init === null && cur !== null) || (init !== null && cur !== null && cur.sha256 !== init.sha256);
      if (changed) {
        this.fail('E12: the file has been modified since it was opened. Use :w! to override.');
        return false;
      }
    }
    try {
      fs.writeFileSync(this.buffer.filename, this.buffer.text());
    } catch (e: any) {
      this.fail(`E212: cannot write file: ${e.message}`);
      return false;
    }
    this.savedText = this.buffer.text();
    this.diskMeta = this.journal.getFileMeta();
    this.journal.reset(this.diskMeta);
    return true;
  }

  private quit(force: boolean): void {
    if (!force && this.isDirty) {
      this.fail('E37: unsaved changes (add ! to override)');
      return;
    }
    this.journal.deleteSwap();
    this.exitRequested = true;
  }

  // ---------------------------------------------------- normal + visual

  private inVisual(): boolean {
    return this.mode === Mode.Visual || this.mode === Mode.VisualLine;
  }

  private handleNormalOrVisual(key: string): void {
    const b = this.buffer;

    if (key === '<Esc>') {
      this.resetPending();
      if (this.inVisual()) this.leaveVisual();
      return;
    }

    if (this.awaitingRegister) {
      this.awaitingRegister = false;
      if (/^[a-z]$/.test(key)) this.pendingRegister = key;
      else if (key !== '"') this.resetPending();
      return;
    }
    if (key === '"') {
      this.awaitingRegister = true;
      return;
    }

    if (/^[1-9]$/.test(key) || (key === '0' && this.pendingCount !== '')) {
      this.pendingCount += key;
      return;
    }

    if (key === ':' && !this.inVisual() && !this.pendingOperator) {
      this.resetPending();
      this.mode = Mode.Command;
      this.commandText = '';
      return;
    }

    const hasCount = this.pendingCount !== '';
    const count = hasCount ? parseInt(this.pendingCount, 10) : 1;

    if (key === 'g') {
      if (this.pendingG) {
        this.pendingG = false;
        this.applyMotion('gg', count, hasCount);
      } else {
        this.pendingG = true;
      }
      return;
    }
    if (this.pendingG) {
      this.resetPending();
      return;
    }

    if (!this.pendingOperator && !this.inVisual()) {
      if (key === 'u') {
        for (let i = 0; i < count; i++) if (!this.undoStack.undo(b)) break;
        this.resetPending();
        b.constrainCursor(false);
        return;
      }
      if (key === '<C-r>') {
        for (let i = 0; i < count; i++) if (!this.undoStack.redo(b)) break;
        this.resetPending();
        b.constrainCursor(false);
        return;
      }
      if (['i', 'a', 'I', 'A', 'o', 'O'].includes(key)) {
        this.startInsert(key);
        this.resetPending();
        return;
      }
      if (key === 'p' || key === 'P') {
        this.paste(key === 'p', count);
        this.resetPending();
        return;
      }
      if (key === 'v' || key === 'V') {
        this.enterVisual(key === 'v' ? Mode.Visual : Mode.VisualLine);
        this.resetPending();
        return;
      }
    }

    if (this.inVisual() && (key === 'v' || key === 'V')) {
      const target = key === 'v' ? Mode.Visual : Mode.VisualLine;
      if (this.mode === target) this.leaveVisual();
      else this.mode = target;
      this.resetPending();
      return;
    }

    if (key === 'd' || key === 'y' || key === 'c') {
      if (this.inVisual()) {
        this.visualOperator(key);
        this.resetPending();
        return;
      }
      if (!this.pendingOperator) {
        this.pendingOperator = key;
        return;
      }
      if (this.pendingOperator === key) {
        const r2 = Math.min(b.lines.length - 1, b.cursorRow + count - 1);
        this.applyOperator(key, { kind: 'line', r1: b.cursorRow, r2 }, this.pendingRegister);
      }
      this.resetPending();
      return;
    }

    if (this.isMotionKey(key)) {
      this.applyMotion(key, count, hasCount);
      return;
    }

    this.resetPending();
  }

  private isMotionKey(key: string): boolean {
    return ['h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '$', 'G'].includes(key);
  }

  private startInsert(key: string): void {
    const b = this.buffer;
    this.pushUndo();
    this.insertPushedSnapshot = true;
    this.insertStartText = b.text();
    this.mode = Mode.Insert;
    const len = b.lines[b.cursorRow].length;
    if (key === 'I') b.cursorCol = 0;
    else if (key === 'a') b.cursorCol = len > 0 ? Math.min(len, b.cursorCol + 1) : 0;
    else if (key === 'A') b.cursorCol = len;
    else if (key === 'o') {
      b.lines.splice(b.cursorRow + 1, 0, '');
      b.cursorRow++;
      b.cursorCol = 0;
    } else if (key === 'O') {
      b.lines.splice(b.cursorRow, 0, '');
      b.cursorCol = 0;
    }
  }

  // ---------------------------------------------------------------- motions

  private static cls(ch: string | undefined): 'space' | 'word' | 'punct' {
    if (ch === undefined || /\s/.test(ch)) return 'space';
    return /[A-Za-z0-9_]/.test(ch) ? 'word' : 'punct';
  }

  private wordForward(p: Pos): Pos {
    const lines = this.buffer.lines;
    let { row, col } = p;
    let line = lines[row];
    const c = Engine.cls(line[col]);
    if (c !== 'space') while (col < line.length && Engine.cls(line[col]) === c) col++;
    for (;;) {
      if (col >= line.length) {
        if (row + 1 >= lines.length) return { row, col: line.length };
        row++;
        col = 0;
        line = lines[row];
        if (line.length === 0) return { row, col: 0 };
        continue;
      }
      if (/\s/.test(line[col])) {
        col++;
        continue;
      }
      return { row, col };
    }
  }

  private wordBackward(p: Pos): Pos {
    const lines = this.buffer.lines;
    let { row, col } = p;
    let line = lines[row];
    if (col === 0) {
      if (row === 0) return { row: 0, col: 0 };
      row--;
      line = lines[row];
      col = line.length;
    } else {
      col--;
    }
    for (;;) {
      if (col < 0) {
        if (row === 0) return { row: 0, col: 0 };
        row--;
        line = lines[row];
        col = line.length - 1;
        if (line.length === 0) return { row, col: 0 };
        continue;
      }
      if (col < line.length && /\s/.test(line[col])) {
        col--;
        continue;
      }
      break;
    }
    if (col < 0) return { row, col: 0 };
    const c = Engine.cls(line[col]);
    while (col > 0 && Engine.cls(line[col - 1]) === c) col--;
    return { row, col };
  }

  private wordEnd(p: Pos): Pos {
    const lines = this.buffer.lines;
    let { row, col } = p;
    let line = lines[row];
    col++;
    for (;;) {
      if (col >= line.length) {
        if (row + 1 >= lines.length) return { row, col: Math.max(0, line.length - 1) };
        row++;
        line = lines[row];
        col = 0;
        continue;
      }
      if (/\s/.test(line[col])) {
        col++;
        continue;
      }
      break;
    }
    const c = Engine.cls(line[col]);
    while (col + 1 < line.length && Engine.cls(line[col + 1]) === c) col++;
    return { row, col };
  }

  private computeMotion(key: string, count: number, hasCount: boolean, from: Pos): MotionResult | null {
    const lines = this.buffer.lines;
    const lastRow = lines.length - 1;
    switch (key) {
      case 'h':
        return { pos: { row: from.row, col: Math.max(0, from.col - count) }, linewise: false, inclusive: false };
      case 'l':
        return { pos: { row: from.row, col: from.col + count }, linewise: false, inclusive: false };
      case 'j':
        return { pos: { row: Math.min(lastRow, from.row + count), col: from.col }, linewise: true, inclusive: false };
      case 'k':
        return { pos: { row: Math.max(0, from.row - count), col: from.col }, linewise: true, inclusive: false };
      case '0':
        return { pos: { row: from.row, col: 0 }, linewise: false, inclusive: false };
      case '$': {
        const row = Math.min(lastRow, from.row + count - 1);
        return { pos: { row, col: lines[row].length }, linewise: false, inclusive: false };
      }
      case 'G':
        return { pos: { row: hasCount ? Math.min(lastRow, count - 1) : lastRow, col: 0 }, linewise: true, inclusive: false };
      case 'gg':
        return { pos: { row: hasCount ? Math.min(lastRow, count - 1) : 0, col: 0 }, linewise: true, inclusive: false };
      case 'w': {
        let p = from;
        for (let i = 0; i < count; i++) p = this.wordForward(p);
        return { pos: p, linewise: false, inclusive: false };
      }
      case 'b': {
        let p = from;
        for (let i = 0; i < count; i++) p = this.wordBackward(p);
        return { pos: p, linewise: false, inclusive: false };
      }
      case 'e': {
        let p = from;
        for (let i = 0; i < count; i++) p = this.wordEnd(p);
        return { pos: p, linewise: false, inclusive: true };
      }
    }
    return null;
  }

  private applyMotion(key: string, count: number, hasCount: boolean): void {
    const b = this.buffer;
    const from: Pos = { row: b.cursorRow, col: b.cursorCol };
    const op = this.pendingOperator;
    const regName = this.pendingRegister;

    if (op && !this.inVisual()) {
      let motionKey = key;
      if (op === 'c' && key === 'w' && !/\s/.test(b.lines[from.row][from.col] ?? ' ')) motionKey = 'e';
      const m = this.computeMotion(motionKey, count, hasCount, from);
      if (m) {
        const range = this.rangeFromMotion(from, m, motionKey);
        this.applyOperator(op, range, regName);
      }
      this.resetPending();
      return;
    }

    const m = this.computeMotion(key, count, hasCount, from);
    if (m) {
      b.cursorRow = m.pos.row;
      b.cursorCol = m.pos.col;
      b.constrainCursor(false);
    }
    this.resetPending();
  }

  private rangeFromMotion(from: Pos, m: MotionResult, key: string): Range {
    const lines = this.buffer.lines;
    if (m.linewise) {
      return { kind: 'line', r1: Math.min(from.row, m.pos.row), r2: Math.max(from.row, m.pos.row) };
    }
    let a = from;
    let z = m.pos;
    if (key === 'w' && z.row > a.row) z = { row: a.row, col: lines[a.row].length };
    if (z.row < a.row || (z.row === a.row && z.col < a.col)) [a, z] = [z, a];
    let end: Pos = { row: z.row, col: z.col + (m.inclusive ? 1 : 0) };
    end.col = Math.min(end.col, lines[end.row].length);
    return { kind: 'char', start: a, end };
  }

  // -------------------------------------------------------------- operators

  private extract(range: Range): { text: string; type: RegisterType } {
    const lines = this.buffer.lines;
    if (range.kind === 'line') {
      return { text: lines.slice(range.r1, range.r2 + 1).join('\n'), type: 'line' };
    }
    const { start, end } = range;
    if (start.row === end.row) return { text: lines[start.row].slice(start.col, end.col), type: 'char' };
    const parts = [lines[start.row].slice(start.col)];
    for (let r = start.row + 1; r < end.row; r++) parts.push(lines[r]);
    parts.push(lines[end.row].slice(0, end.col));
    return { text: parts.join('\n'), type: 'char' };
  }

  private setRegister(regName: string, text: string, type: RegisterType): void {
    this.registers.set(regName || '', text, type);
  }

  private applyOperator(op: string, range: Range, regName: string): void {
    const b = this.buffer;
    const { text, type } = this.extract(range);

    if (range.kind === 'char' && range.start.row === range.end.row && range.start.col === range.end.col) {
      if (op === 'c') this.enterInsert(true);
      return;
    }

    this.setRegister(regName, text, type);

    if (op === 'y') {
      if (range.kind === 'line') {
        b.cursorRow = range.r1;
      } else {
        b.cursorRow = range.start.row;
        b.cursorCol = range.start.col;
      }
      b.constrainCursor(false);
      return;
    }

    this.pushUndo();
    if (range.kind === 'line') {
      b.lines.splice(range.r1, range.r2 - range.r1 + 1);
      if (op === 'c') {
        b.lines.splice(range.r1, 0, '');
        b.cursorRow = range.r1;
        b.cursorCol = 0;
        this.insertPushedSnapshot = false;
        this.mode = Mode.Insert;
        return;
      }
      if (b.lines.length === 0) b.lines = [''];
      b.cursorRow = Math.min(range.r1, b.lines.length - 1);
      b.cursorCol = 0;
      b.constrainCursor(false);
      return;
    }

    const { start, end } = range;
    const head = b.lines[start.row].slice(0, start.col);
    const tail = b.lines[end.row].slice(end.col);
    b.lines.splice(start.row, end.row - start.row + 1, head + tail);
    b.cursorRow = start.row;
    b.cursorCol = start.col;
    if (op === 'c') {
      this.insertPushedSnapshot = false;
      this.mode = Mode.Insert;
      b.constrainCursor(true);
    } else {
      b.constrainCursor(false);
    }
  }

  // ----------------------------------------------------------------- visual

  private enterVisual(mode: Mode): void {
    this.mode = mode;
    this.visualAnchor = { row: this.buffer.cursorRow, col: this.buffer.cursorCol };
  }

  private leaveVisual(): void {
    this.mode = Mode.Normal;
    this.visualAnchor = null;
  }

  private visualOperator(op: string): void {
    const b = this.buffer;
    const anchor = this.visualAnchor ?? { row: b.cursorRow, col: b.cursorCol };
    const cur: Pos = { row: b.cursorRow, col: b.cursorCol };
    const wasLine = this.mode === Mode.VisualLine;
    let a = anchor;
    let z = cur;
    if (z.row < a.row || (z.row === a.row && z.col < a.col)) [a, z] = [z, a];
    this.leaveVisual();
    let range: Range;
    if (wasLine) {
      range = { kind: 'line', r1: a.row, r2: z.row };
    } else {
      const end: Pos = { row: z.row, col: Math.min(z.col + 1, b.lines[z.row].length) };
      range = { kind: 'char', start: a, end };
    }
    this.applyOperator(op, range, this.pendingRegister);
  }

  // ------------------------------------------------------------------ paste

  private paste(after: boolean, count: number): void {
    const b = this.buffer;
    const reg = this.registers.get(this.pendingRegister || '');
    if (!reg) return;
    this.pushUndo();
    if (reg.type === 'line') {
      const block = reg.content.split('\n');
      let at = after ? b.cursorRow + 1 : b.cursorRow;
      const first = at;
      for (let i = 0; i < count; i++) {
        b.lines.splice(at, 0, ...block);
        at += block.length;
      }
      b.cursorRow = first;
      b.cursorCol = 0;
      return;
    }
    const line = b.lines[b.cursorRow];
    const at = line.length === 0 ? 0 : after ? b.cursorCol + 1 : b.cursorCol;
    const text = reg.content.repeat(count);
    const segs = text.split('\n');
    if (segs.length === 1) {
      b.lines[b.cursorRow] = line.slice(0, at) + text + line.slice(at);
      b.cursorCol = at + text.length - 1;
    } else {
      const head = line.slice(0, at) + segs[0];
      const tail = segs[segs.length - 1] + line.slice(at);
      const middle = segs.slice(1, -1);
      b.lines.splice(b.cursorRow, 1, head, ...middle, tail);
      b.cursorCol = at;
    }
    b.constrainCursor(false);
  }
}

export { parseText, serializeLines };
