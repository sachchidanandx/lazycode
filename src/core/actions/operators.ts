import { EditorContext } from '../editorContext';
import { Position, Range, TextEdit } from '../types';
import { firstNonBlankChar } from './motions';

/**
 * Operators: given a target range, produce the edit batch + resulting cursor.
 *
 * Range convention (charwise): `end` EXCLUSIVE. The engine applies motion
 * inclusivity before calling these, so operators stay dumb.
 * Linewise: only the line numbers of `range` matter; content columns are
 * ignored and whole lines (including newlines) are affected.
 *
 * Every outcome is ONE edits array → ONE applyEdits call → one undo stop.
 */

export interface Register {
  readonly text: string;
  readonly linewise: boolean;
}

export interface OperatorOutcome {
  readonly edits: TextEdit[];
  readonly cursor: Position;
  /** d/y/c all yank into the unnamed register. */
  readonly register?: Register;
  readonly enterInsert?: boolean;
}

const lineLen = (e: EditorContext, line: number): number => e.getLine(line).length;

/** Charwise text of a range (for yank registers). */
function textOfRange(e: EditorContext, range: Range): string {
  return e.getText(range);
}

function linewiseText(e: EditorContext, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (let l = startLine; l <= endLine; l++) lines.push(e.getLine(l));
  return lines.join('\n') + '\n';
}

/** Expand a linewise span to the delete-range that removes whole lines cleanly. */
function linewiseDeleteRange(e: EditorContext, s: number, en: number): { range: Range; mode: 'range' | 'clear' } {
  const lineCount = e.getLineCount();
  if (en + 1 < lineCount) {
    // Delete lines s..en plus the newline after en.
    return { range: { start: { line: s, character: 0 }, end: { line: en + 1, character: 0 } }, mode: 'range' };
  }
  if (s > 0) {
    // Deleting through EOF: also eat the newline BEFORE s.
    return {
      range: { start: { line: s - 1, character: lineLen(e, s - 1) }, end: { line: en, character: lineLen(e, en) } },
      mode: 'range',
    };
  }
  // Whole document: clear it to a single empty line (vim behavior).
  return { range: { start: { line: 0, character: 0 }, end: { line: en, character: lineLen(e, en) } }, mode: 'clear' };
}

function linewiseCursor(e: EditorContext, s: number, en: number): Position {
  const lineCount = e.getLineCount();
  if (en + 1 < lineCount) return { line: s, character: 0 };
  if (s > 0) return { line: s - 1, character: 0 };
  return { line: 0, character: 0 };
}

// ── delete (d) ───────────────────────────────────────────────────────────────

export function computeDelete(e: EditorContext, range: Range, linewise: boolean): OperatorOutcome {
  if (!linewise) {
    return {
      edits: [{ kind: 'delete', range }],
      cursor: { ...range.start },
      register: { text: textOfRange(e, range), linewise: false },
    };
  }
  const s = range.start.line;
  const en = range.end.line;
  const { range: dr } = linewiseDeleteRange(e, s, en);
  const cursorLine = linewiseCursor(e, s, en).line;
  const afterLine = Math.min(cursorLine, e.getLineCount() - 1);
  return {
    edits: [{ kind: 'delete', range: dr }],
    cursor: { line: afterLine, character: 0 }, // engine re-clamps to first non-blank after edit
    register: { text: linewiseText(e, s, en), linewise: true },
  };
}

// ── yank (y) ─────────────────────────────────────────────────────────────────

export function computeYank(e: EditorContext, range: Range, linewise: boolean): OperatorOutcome {
  if (!linewise) {
    return {
      edits: [],
      cursor: { ...range.start },
      register: { text: textOfRange(e, range), linewise: false },
    };
  }
  const s = range.start.line;
  const en = range.end.line;
  return {
    edits: [],
    cursor: { line: s, character: firstNonBlankChar(e, s) },
    register: { text: linewiseText(e, s, en), linewise: true },
  };
}

// ── change (c) ───────────────────────────────────────────────────────────────

export function computeChange(e: EditorContext, range: Range, linewise: boolean): OperatorOutcome {
  if (!linewise) {
    return {
      edits: [{ kind: 'delete', range }],
      cursor: { ...range.start },
      register: { text: textOfRange(e, range), linewise: false },
      enterInsert: true,
    };
  }
  // cc: collapse the lines into one empty line, keep surrounding newlines.
  const s = range.start.line;
  const en = range.end.line;
  return {
    edits: [{ kind: 'replace', range: { start: { line: s, character: 0 }, end: { line: en, character: lineLen(e, en) } }, text: '' }],
    cursor: { line: s, character: 0 },
    register: { text: linewiseText(e, s, en), linewise: true },
    enterInsert: true,
  };
}
