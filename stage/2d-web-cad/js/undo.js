// Undo/redo over document snapshots. Documents are immutable, so a snapshot
// is just the previous drawing object.

export class UndoStack {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  record(before) {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
