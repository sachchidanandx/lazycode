import { EditorContext } from '../editorContext';
import { Position } from '../types';

/**
 * Motions: pure functions (editor, from, count) → MotionResult.
 *
 *  - `position`: where the motion lands
 *  - `inclusive`: when used with an operator, the target char is INCLUDED
 *    (e.g. `e`, `$`, `fx`). Exclusive otherwise (`w`, `b`).
 *  - `linewise`: operator applies to whole lines (`j`, `k`, `gg`, `G`).
 *
 * `count === 0` means "no count typed"; motions treat it as 1. `gg`/`G`
 * need the distinction (G with no count → last line; with count n → line n).
 */
export interface MotionResult {
  readonly position: Position;
  readonly inclusive?: boolean;
  readonly linewise?: boolean;
}

export type MotionFn = (
  editor: EditorContext,
  from: Position,
  count: number,
) => MotionResult | undefined;

const at = (e: EditorContext, line: number, character: number): MotionResult => ({
  position: { line, character },
});

const lineLen = (e: EditorContext, line: number): number => e.getLine(line).length;

/** Normal-mode cursor clamp: never past the last char (except empty lines → 0). */
export function clampNormalCursor(e: EditorContext, pos: Position): Position {
  const line = Math.max(0, Math.min(pos.line, e.getLineCount() - 1));
  const len = lineLen(e, line);
  return { line, character: Math.max(0, Math.min(pos.character, Math.max(0, len - 1))) };
}

export function firstNonBlankChar(e: EditorContext, line: number): number {
  const text = e.getLine(line);
  const m = /\S/.exec(text);
  return m ? m.index : 0;
}

// ── Character motions ────────────────────────────────────────────────────────

export const left: MotionFn = (e, from) => at(e, from.line, Math.max(0, from.character - 1));

export const right: MotionFn = (e, from, count) => {
  const c = count || 1;
  const len = lineLen(e, from.line);
  return at(e, from.line, Math.min(Math.max(0, len - 1), from.character + c));
};

export const down: MotionFn = (e, from, count) => {
  const c = count || 1;
  const line = Math.min(e.getLineCount() - 1, from.line + c);
  return { position: clampNormalCursor(e, { line, character: from.character }), linewise: true };
};

export const up: MotionFn = (e, from, count) => {
  const c = count || 1;
  const line = Math.max(0, from.line - c);
  return { position: clampNormalCursor(e, { line, character: from.character }), linewise: true };
};

export const lineStart: MotionFn = (e, from) => at(e, from.line, 0);

export const firstNonBlank: MotionFn = (e, from) => at(e, from.line, firstNonBlankChar(e, from.line));

export const lineEnd: MotionFn = (e, from) => ({
  position: { line: from.line, character: Math.max(0, lineLen(e, from.line) - 1) },
  inclusive: true,
});

// ── Word motions (vim 'word': keyword run | punct run, blanks separate) ─────

type CharClass = 'blank' | 'word' | 'punct';
function charClass(ch: string | undefined): CharClass {
  if (ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return 'blank';
  return /\w/.test(ch) ? 'word' : 'punct';
}

const isWordStart = (text: string, i: number): boolean =>
  charClass(text[i]) !== 'blank' &&
  (i === 0 || charClass(text[i - 1]) === 'blank' || charClass(text[i - 1]) !== charClass(text[i]));

const isWordEnd = (text: string, i: number): boolean =>
  charClass(text[i]) !== 'blank' &&
  (i === text.length - 1 ||
    charClass(text[i + 1]) === 'blank' ||
    charClass(text[i + 1]) !== charClass(text[i]));

export const wordForward: MotionFn = (e, from, count) => {
  const text = e.getText();
  let off = e.offsetAt(from);
  for (let n = 0, c = count || 1; n < c; n++) {
    let i = Math.min(off + 1, text.length);
    while (i < text.length && !isWordStart(text, i)) i++;
    off = i;
  }
  return { position: e.positionAt(Math.min(off, Math.max(0, text.length - 1))) };
};

export const wordBackward: MotionFn = (e, from, count) => {
  const text = e.getText();
  let off = e.offsetAt(from);
  for (let n = 0, c = count || 1; n < c; n++) {
    let i = off - 1;
    while (i > 0 && !isWordStart(text, i)) i--;
    off = Math.max(0, i);
  }
  return { position: e.positionAt(off) };
};

export const wordEnd: MotionFn = (e, from, count) => {
  const text = e.getText();
  let off = e.offsetAt(from);
  for (let n = 0, c = count || 1; n < c; n++) {
    let i = Math.min(off + 1, text.length - 1);
    while (i < text.length - 1 && !isWordEnd(text, i)) i++;
    off = i;
  }
  return { position: e.positionAt(off), inclusive: true };
};

// ── Line jumps ───────────────────────────────────────────────────────────────

export const gotoTop: MotionFn = (e, _from, count) => {
  const line = count > 1 ? Math.min(count - 1, e.getLineCount() - 1) : 0;
  return { position: { line, character: firstNonBlankChar(e, line) }, linewise: true };
};

export const gotoBottom: MotionFn = (e, _from, count) => {
  const line = count > 0 ? Math.min(count - 1, e.getLineCount() - 1) : e.getLineCount() - 1;
  return { position: { line, character: firstNonBlankChar(e, line) }, linewise: true };
};

// ── Find-char motions (f/F/t/T) ──────────────────────────────────────────────

export interface FindArg {
  readonly char: string;
  readonly forward: boolean;
  readonly till: boolean;
}

export function findChar(
  e: EditorContext,
  from: Position,
  count: number,
  arg: FindArg,
): MotionResult | undefined {
  const line = e.getLine(from.line);
  const c = count || 1;
  let idx = from.character;
  for (let n = 0; n < c; n++) {
    const found = arg.forward
      ? line.indexOf(arg.char, idx + 1)
      : line.lastIndexOf(arg.char, idx - 1);
    if (found === -1) return undefined;
    idx = found;
  }
  if (arg.till) {
    idx = arg.forward ? idx - 1 : idx + 1;
    if (idx === from.character) return undefined;
  }
  return { position: { line: from.line, character: idx }, inclusive: true };
}

// ── Bracket match (%) ────────────────────────────────────────────────────────

const OPEN = '([{';
const CLOSE = ')]}';
const MATCH: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

export const bracketMatch: MotionFn = (e, from) => {
  const text = e.getText();
  let off = e.offsetAt(from);

  // If not on a bracket, scan forward on the current line for one (vim behavior).
  if (!OPEN.includes(text[off] ?? '') && !CLOSE.includes(text[off] ?? '')) {
    const lineEndOff = off + (lineLen(e, from.line) - from.character);
    let found = -1;
    for (let i = off; i < lineEndOff; i++) {
      if (OPEN.includes(text[i]) || CLOSE.includes(text[i])) {
        found = i;
        break;
      }
    }
    if (found === -1) return undefined;
    off = found;
  }

  const ch = text[off];
  const target = MATCH[ch];
  if (target === undefined) return undefined;
  const forward = OPEN.includes(ch);
  let depth = 0;
  let i = off;
  while (i >= 0 && i < text.length) {
    if (text[i] === ch) depth++;
    else if (text[i] === target) {
      depth--;
      if (depth === 0) return { position: e.positionAt(i), inclusive: true };
    }
    i += forward ? 1 : -1;
  }
  return undefined;
};

// ── Paragraph motions ({ / }) ────────────────────────────────────────────────

const isBlankLine = (e: EditorContext, line: number): boolean =>
  e.getLine(line).trim() === '';

/**
 * Blank landing lines go to col 0; non-blank (doc boundary) to first non-blank.
 * `inclusive: false` makes operators EXCLUDE the landing blank line (vim:
 * `{`/`}` are exclusive linewise — `d}` deletes the paragraph, not the
 * blank below it; contrast `dj`, which is inclusive).
 */
const paragraphLanding = (e: EditorContext, line: number): MotionResult => ({
  position: { line, character: isBlankLine(e, line) ? 0 : firstNonBlankChar(e, line) },
  linewise: true,
  inclusive: false,
});

/** `}` — forward to the end of this/next paragraph: the blank line below it. */
export const paragraphForward: MotionFn = (e, from, count) => {
  const last = e.getLineCount() - 1;
  let line = from.line;
  for (let n = 0, c = count || 1; n < c; n++) {
    if (line >= last) break;
    while (line < last && isBlankLine(e, line)) line++; // skip blank lines
    while (line < last && !isBlankLine(e, line + 1)) line++; // to paragraph end
    if (line < last) line++; // land on the blank line below
  }
  if (line === from.line) return undefined; // motion failed (vim: beep)
  return paragraphLanding(e, line);
};

/** `{` — back to the start of this/previous paragraph: the blank line above it. */
export const paragraphBackward: MotionFn = (e, from, count) => {
  let line = from.line;
  for (let n = 0, c = count || 1; n < c; n++) {
    if (line <= 0) break;
    while (line > 0 && isBlankLine(e, line)) line--; // skip blank lines
    while (line > 0 && !isBlankLine(e, line - 1)) line--; // to paragraph start
    if (line > 0) line--; // land on the blank line above
  }
  if (line === from.line) return undefined; // motion failed (vim: beep)
  return paragraphLanding(e, line);
};

// ── Screen motions (H / M / L) ───────────────────────────────────────────────

export const screenHigh: MotionFn = (e, _from, count) => {
  const { start, end } = e.getVisibleLineRange();
  const limit = Math.min(end, e.getLineCount() - 1);
  const line = Math.min(Math.max(0, start) + (count > 0 ? count - 1 : 0), limit);
  return { position: { line, character: firstNonBlankChar(e, line) }, linewise: true };
};

export const screenMiddle: MotionFn = (e, _from) => {
  const { start, end } = e.getVisibleLineRange();
  const limit = Math.min(end, e.getLineCount() - 1);
  const line = Math.min(Math.max(0, start) + Math.max(0, Math.floor((end - start) / 2)), limit);
  return { position: { line, character: firstNonBlankChar(e, line) }, linewise: true };
};

export const screenLow: MotionFn = (e, _from, count) => {
  const { start, end } = e.getVisibleLineRange();
  const limit = Math.min(end, e.getLineCount() - 1);
  const line = Math.max(Math.max(0, start), limit - (count > 0 ? count - 1 : 0));
  return { position: { line, character: firstNonBlankChar(e, line) }, linewise: true };
};
