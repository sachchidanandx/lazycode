import { EditorContext } from '../src/core/editorContext';
import { Position, Range, Selection, TextEdit, comparePositions } from '../src/core/types';

/**
 * Headless EditorContext backed by a plain string with '\n' separators.
 * The workhorse for engine unit tests — no VSCode instance required.
 */
export class FakeEditorContext implements EditorContext {
  private lines: string[];
  private selections: Selection[];
  /** Number of applyEdits calls — lets tests assert the one-undo-stop invariant. */
  editBatchCount = 0;

  constructor(text: string, cursor: Position = { line: 0, character: 0 }, viewportHeight = 20) {
    this.lines = text.split('\n');
    this.selections = [{ anchor: cursor, active: cursor }];
    this.viewport = { start: 0, end: Math.min(viewportHeight - 1, this.lines.length - 1) };
  }

  getLineCount(): number {
    return this.lines.length;
  }

  getLine(line: number): string {
    if (line < 0 || line >= this.lines.length) throw new RangeError(`line ${line}`);
    return this.lines[line];
  }

  getText(range?: Range): string {
    if (!range) return this.lines.join('\n');
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this.lines.join('\n').slice(start, end);
  }

  getSelections(): readonly Selection[] {
    return this.selections;
  }

  setSelections(selections: readonly Selection[]): void {
    this.selections = [...selections];
  }

  async applyEdits(edits: readonly TextEdit[]): Promise<boolean> {
    this.editBatchCount += 1;
    // Apply right-to-left so earlier offsets stay valid.
    const sorted = [...edits].sort((a, b) => {
      const posOf = (e: TextEdit): Position => (e.kind === 'insert' ? e.at : e.range.start);
      return comparePositions(posOf(b), posOf(a));
    });
    for (const edit of sorted) {
      const text = this.lines.join('\n');
      let next: string;
      switch (edit.kind) {
        case 'insert': {
          const off = this.offsetAt(edit.at);
          next = text.slice(0, off) + edit.text + text.slice(off);
          break;
        }
        case 'replace': {
          const s = this.offsetAt(edit.range.start);
          const e = this.offsetAt(edit.range.end);
          next = text.slice(0, s) + edit.text + text.slice(e);
          break;
        }
        case 'delete': {
          const s = this.offsetAt(edit.range.start);
          const e = this.offsetAt(edit.range.end);
          next = text.slice(0, s) + text.slice(e);
          break;
        }
      }
      this.lines = next.split('\n');
    }
    return true;
  }

  offsetAt(pos: Position): number {
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += this.lines[i].length + 1;
    return off + pos.character;
  }

  positionAt(offset: number): Position {
    let remaining = offset;
    for (let i = 0; i < this.lines.length; i++) {
      if (remaining <= this.lines[i].length) return { line: i, character: remaining };
      remaining -= this.lines[i].length + 1;
    }
    const last = this.lines.length - 1;
    return { line: last, character: this.lines[last].length };
  }

  revealPrimaryCursor(): void {
    // Scroll the fake viewport minimally so the cursor is visible, like a
    // real editor would.
    const size = this.viewport.end - this.viewport.start;
    const line = this.selections[0].active.line;
    if (line < this.viewport.start) {
      this.viewport = { start: line, end: line + size };
    } else if (line > this.viewport.end) {
      this.viewport = { start: line - size, end: line };
    }
  }

  /** Fake viewport (inclusive end) for H/M/L and page-scroll tests. */
  private viewport: { start: number; end: number };

  getVisibleLineRange(): { start: number; end: number } {
    return { ...this.viewport };
  }

  scrollLines(delta: number): void {
    const size = this.viewport.end - this.viewport.start;
    const maxStart = Math.max(0, this.lines.length - 1 - size);
    const start = Math.max(0, Math.min(maxStart, this.viewport.start + delta));
    this.viewport = { start, end: start + size };
  }

  /** Test helper: place the viewport explicitly. */
  setViewport(start: number, end: number): void {
    this.viewport = { start: Math.max(0, start), end: Math.min(end, this.lines.length - 1) };
  }

  /** Number of moveVisualLine calls — lets tests assert the gj path is used. */
  visualMoveCount = 0;

  async moveVisualLine(delta: number, select: boolean): Promise<void> {
    this.visualMoveCount += 1;
    const sel = this.selections[0];
    const line = Math.max(0, Math.min(this.lines.length - 1, sel.active.line + delta));
    const len = this.lines[line].length;
    const character = Math.max(0, Math.min(sel.active.character, Math.max(0, len - 1)));
    const active = { line, character };
    this.selections = select ? [{ anchor: sel.anchor, active }] : [{ anchor: active, active }];
  }

  /** Test helper: "line|cursor" snapshot of the primary selection. */
  debugState(): string {
    const c = this.selections[0].active;
    return `mode-agnostic text=${JSON.stringify(this.lines.join('\n'))} cursor=${c.line}:${c.character}`;
  }
}
