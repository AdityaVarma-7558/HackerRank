import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileMeta {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface JournalEntry {
  seq: number;
  ts: number;
  op: 'META' | 'KEY';
  args: any;
}

export class Journal {
  public swapFile: string;
  private seq = 0;

  constructor(public filename: string) {
    this.swapFile = path.join(path.dirname(filename), `.${path.basename(filename)}.swp`);
  }

  hasSwap(): boolean {
    return fs.existsSync(this.swapFile);
  }

  deleteSwap(): void {
    if (this.hasSwap()) fs.unlinkSync(this.swapFile);
  }

  getFileMeta(): FileMeta | null {
    if (!fs.existsSync(this.filename)) return null;
    const content = fs.readFileSync(this.filename);
    return {
      size: content.length,
      mtimeMs: fs.statSync(this.filename).mtimeMs,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  }

  reset(meta: FileMeta | null): void {
    this.seq = 0;
    const entry: JournalEntry = { seq: this.seq++, ts: Date.now(), op: 'META', args: meta };
    fs.writeFileSync(this.swapFile, JSON.stringify(entry) + '\n');
  }

  appendKey(key: string): void {
    const entry: JournalEntry = { seq: this.seq++, ts: Date.now(), op: 'KEY', args: { key } };
    fs.appendFileSync(this.swapFile, JSON.stringify(entry) + '\n');
  }

  readAll(): JournalEntry[] {
    if (!this.hasSwap()) return [];
    const entries: JournalEntry[] = [];
    for (const line of fs.readFileSync(this.swapFile, 'utf-8').split('\n')) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // A SIGKILL can leave a truncated final line; ignore it.
      }
    }
    this.seq = entries.length;
    return entries;
  }
}
