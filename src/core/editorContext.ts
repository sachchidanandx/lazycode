import { Position, Range, Selection, TextEdit } from './types';

/**
 * The seam between the vim engine and the outside world.
 *
 * The engine ONLY talks to this interface — never to `vscode.TextEditor`
 * directly. Two implementations exist:
 *   - VsEditorContext (src/vs/vsEditorContext.ts) — real adapter
 *   - FakeEditorContext (test/fakeEditorContext.ts)   — headless test double
 */
export interface EditorContext {
  getLineCount(): number;
  /** Full text of a 0-based line, without the newline. */
  getLine(line: number): string;
  /** Whole-document text (used sparingly, e.g. search). */
  getText(range?: Range): string;

  getSelections(): readonly Selection[];
  setSelections(selections: readonly Selection[]): void;

  /**
   * Apply a batch of edits as ONE undo stop. Every vim action produces exactly
   * one call to this — that invariant is what keeps vim undo and VSCode undo
   * from desyncing.
   */
  applyEdits(edits: readonly TextEdit[]): Promise<boolean>;

  /** Convert between position and absolute offset (needed for f/F/t/T and search). */
  offsetAt(pos: Position): number;
  positionAt(offset: number): Position;

  /** Scroll so the primary cursor is visible. */
  revealPrimaryCursor(): void;

  /**
   * Move the cursor by DISPLAY (wrapped) lines — the `gj`/`gk` behavior.
   * VSCode implements this via the `cursorMove` command; the fake implements
   * it as a logical-line move (no wrapping headless). `select` extends the
   * selection (Visual mode).
   */
  moveVisualLine(delta: number, select: boolean): Promise<void> | void;
}
