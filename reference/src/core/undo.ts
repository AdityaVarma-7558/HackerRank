import { Snapshot, TextBuffer } from './buffer';

export class UndoStack {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private maxDepth = 1000;

  push(snapshot: Snapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack = [];
  }

  dropTop(): void {
    this.undoStack.pop();
  }

  undo(buffer: TextBuffer): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(buffer.snapshot());
    buffer.restore(prev);
    return true;
  }

  redo(buffer: TextBuffer): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(buffer.snapshot());
    buffer.restore(next);
    return true;
  }
}
