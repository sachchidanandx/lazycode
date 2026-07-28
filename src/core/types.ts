/**
 * Core geometry + edit types.
 *
 * These deliberately mirror vscode's Position/Range shape WITHOUT importing
 * vscode, so the entire engine can run headless under vitest.
 */

export interface Position {
  readonly line: number; // 0-based
  readonly character: number; // 0-based, in UTF-16 code units (matches VSCode)
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** A single text mutation. Mirrors the semantics of TextEditorEdit.replace/insert/delete. */
export type TextEdit =
  | { kind: 'insert'; at: Position; text: string }
  | { kind: 'replace'; range: Range; text: string }
  | { kind: 'delete'; range: Range };

export const position = (line: number, character: number): Position => ({
  line,
  character,
});

export const range = (
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Range => ({
  start: position(startLine, startChar),
  end: position(endLine, endChar),
});

export const comparePositions = (a: Position, b: Position): number =>
  a.line - b.line || a.character - b.character;

export const isBefore = (a: Position, b: Position): boolean =>
  comparePositions(a, b) < 0;

export const isBeforeOrEqual = (a: Position, b: Position): boolean =>
  comparePositions(a, b) <= 0;

export const positionsEqual = (a: Position, b: Position): boolean =>
  a.line === b.line && a.character === b.character;

/** A cursor selection. `active` is where the caret is; `anchor` is the fixed end. */
export interface Selection {
  anchor: Position;
  active: Position;
}

export const cursorAt = (p: Position): Selection => ({ anchor: p, active: p });
