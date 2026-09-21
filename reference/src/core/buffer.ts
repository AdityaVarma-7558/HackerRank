export interface Snapshot {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
}

export function parseText(raw: string): string[] {
  if (raw.length === 0) return [''];
  const body = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  return body.split('\n');
}

export function serializeLines(lines: string[]): string {
  if (lines.length === 1 && lines[0] === '') return '';
  return lines.join('\n') + '\n';
}

export class TextBuffer {
  lines: string[];
  cursorRow = 0;
  cursorCol = 0;

  constructor(public filename: string, raw: string) {
    this.lines = parseText(raw);
  }

  text(): string {
    return serializeLines(this.lines);
  }

  snapshot(): Snapshot {
    return { lines: [...this.lines], cursorRow: this.cursorRow, cursorCol: this.cursorCol };
  }

  restore(s: Snapshot): void {
    this.lines = [...s.lines];
    this.cursorRow = s.cursorRow;
    this.cursorCol = s.cursorCol;
  }

  constrainCursor(insertMode = false): void {
    this.cursorRow = Math.max(0, Math.min(this.lines.length - 1, this.cursorRow));
    const len = this.lines[this.cursorRow].length;
    const maxCol = insertMode ? len : Math.max(0, len - 1);
    this.cursorCol = Math.max(0, Math.min(maxCol, this.cursorCol));
  }
}
