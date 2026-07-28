import { EditorContext } from '../editorContext';
import { Range } from '../types';

/**
 * Text objects: pure functions (editor, pos, around) → Range | undefined.
 *
 * Range convention: `end` is EXCLUSIVE (one past the last char to affect),
 * matching what operators.ts expects. Returns undefined when the object
 * doesn't exist around the cursor (vim aborts the pending operation).
 */

type CharClass = 'blank' | 'word' | 'punct';
function charClass(ch: string | undefined): CharClass {
  if (ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return 'blank';
  return /\w/.test(ch) ? 'word' : 'punct';
}

const mk = (sl: number, sc: number, el: number, ec: number): Range => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

// ── word: iw / aw ────────────────────────────────────────────────────────────

export function wordObject(e: EditorContext, pos: { line: number; character: number }, around: boolean): Range | undefined {
  const line = e.getLine(pos.line);
  if (line.length === 0) return undefined;
  const cls = charClass(line[pos.character]);
  let s = pos.character;
  let en = pos.character;
  while (s > 0 && charClass(line[s - 1]) === cls) s--;
  while (en < line.length - 1 && charClass(line[en + 1]) === cls) en++;

  if (!around) return mk(pos.line, s, pos.line, en + 1);

  // around: include trailing blanks, else leading blanks (vim behavior)
  let ae = en;
  while (ae < line.length - 1 && charClass(line[ae + 1]) === 'blank') ae++;
  if (ae > en) return mk(pos.line, s, pos.line, ae + 1);
  let as_ = s;
  while (as_ > 0 && charClass(line[as_ - 1]) === 'blank') as_--;
  return mk(pos.line, as_, pos.line, en + 1);
}

// ── quotes: i" a" i' a' i` a` ────────────────────────────────────────────────

export function quoteObject(e: EditorContext, pos: { line: number; character: number }, quote: string, around: boolean): Range | undefined {
  const line = e.getLine(pos.line);
  const quotes: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === quote) quotes.push(i);

  // Pair up (0,1), (2,3), ... and find the pair containing the cursor.
  for (let p = 0; p + 1 < quotes.length; p += 2) {
    const [open, close] = [quotes[p], quotes[p + 1]];
    if (pos.character >= open && pos.character <= close) {
      return around
        ? mk(pos.line, open, pos.line, close + 1)
        : mk(pos.line, open + 1, pos.line, close);
    }
  }
  return undefined;
}

// ── brackets: i( a( i[ a[ i{ a{ (aliases b/B) ───────────────────────────────

export function bracketObject(
  e: EditorContext,
  pos: { line: number; character: number },
  open: string,
  close: string,
  around: boolean,
): Range | undefined {
  const text = e.getText();
  const from = e.offsetAt(pos);

  // Scan backward for the unmatched open bracket containing the cursor.
  let openOff = -1;
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    if (text[i] === close) depth++;
    else if (text[i] === open) {
      if (depth === 0) {
        openOff = i;
        break;
      }
      depth--;
    }
  }
  if (openOff === -1) return undefined;

  // Scan forward for its match.
  let closeOff = -1;
  depth = 0;
  for (let i = openOff; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        closeOff = i;
        break;
      }
    }
  }
  if (closeOff === -1) return undefined;

  const s = e.positionAt(around ? openOff : openOff + 1);
  const en = e.positionAt(around ? closeOff + 1 : closeOff);
  return { start: s, end: en };
}

// ── paragraph: ip / ap (linewise) ────────────────────────────────────────────

export interface LinewiseObject {
  readonly range: Range;
  readonly linewise: true;
}

export function paragraphObject(e: EditorContext, pos: { line: number }, around: boolean): LinewiseObject | undefined {
  const count = e.getLineCount();
  const isBlank = (l: number): boolean => e.getLine(l).trim() === '';
  if (isBlank(pos.line)) return undefined;

  let s = pos.line;
  let en = pos.line;
  while (s > 0 && !isBlank(s - 1)) s--;
  while (en < count - 1 && !isBlank(en + 1)) en++;

  if (around) {
    // Include trailing blank lines, else leading (vim behavior).
    let ae = en;
    while (ae < count - 1 && isBlank(ae + 1)) ae++;
    if (ae > en) en = ae;
    else {
      let as_ = s;
      while (as_ > 0 && isBlank(as_ - 1)) as_--;
      s = as_;
    }
  }
  return { range: mk(s, 0, en, e.getLine(en).length), linewise: true };
}
