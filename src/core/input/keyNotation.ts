/**
 * Key notation: parse/normalize strings like "<C-w>", "<leader>ff", "g@", "3dw".
 *
 * Canonical form rules:
 *   - A single printable char is itself: "a", "G", "1"
 *   - Special keys are angle-bracketed lowercase names: "<esc>", "<cr>", "<space>"
 *   - Modifiers sort C- then A- then S-, key lowercased: "<C-A-x>", "<S-Tab>" → "<S-tab>"
 *
 * Raw keystrokes arrive from VSCode one at a time; the parser turns each into
 * its canonical form so the BindingTrie can compare by simple equality.
 */

const SPECIAL_KEYS = new Set([
  'esc', 'cr', 'enter', 'tab', 'space', 'bs', 'del',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'leader', 'lt', 'bar',
]);

const ALIASES: Record<string, string> = {
  enter: 'cr',
  return: 'cr',
  escape: 'esc',
  backspace: 'bs',
  delete: 'del',
  ' ': '<space>',
};

const MODIFIER_ORDER: Record<string, number> = { C: 0, A: 1, S: 2, M: 1 };

/**
 * Normalize ONE keystroke (not a sequence) to canonical form.
 * Accepts: "a", "<C-w>", "<ctrl-x>", "<leader>", " " (literal space), "\t".
 */
export function normalizeKey(raw: string): string {
  if (raw.length === 0) throw new Error('empty keystroke');

  // Literal single characters
  if (raw.length === 1) {
    const alias = ALIASES[raw];
    return alias ?? raw;
  }

  const m = /^<(.+)>$/.exec(raw);
  if (!m) {
    // Multi-char raw input (e.g. pasted text) — caller should split it.
    throw new Error(`not a single keystroke: ${JSON.stringify(raw)}`);
  }

  const inner = m[1];
  const parts = inner.split('-');
  const keyPartRaw = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((p) => {
    const up = p.toUpperCase();
    const first = up[0];
    if (!(first in MODIFIER_ORDER)) throw new Error(`unknown modifier: ${p}`);
    return first;
  });

  let key = keyPartRaw.toLowerCase();
  key = ALIASES[key] ? ALIASES[key].replace(/^<|>$/g, '') : key;

  if (mods.length === 0) {
    if (!SPECIAL_KEYS.has(key) && key.length !== 1) {
      throw new Error(`unknown special key: <${key}>`);
    }
    return `<${key}>`;
  }

  mods.sort((a, b) => MODIFIER_ORDER[a] - MODIFIER_ORDER[b]);
  const deduped = [...new Set(mods)];
  return `<${deduped.join('-')}-${key}>`;
}

/**
 * Split a key SEQUENCE string into canonical keystrokes.
 * "g@" → ["g", "@"], "<leader>ff" → ["<leader>", "f", "f"], "3dw" → ["3","d","w"]
 */
export function parseKeySequence(sequence: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < sequence.length) {
    if (sequence[i] === '<') {
      const close = sequence.indexOf('>', i);
      if (close === -1) throw new Error(`unterminated <> in: ${sequence}`);
      out.push(normalizeKey(sequence.slice(i, close + 1)));
      i = close + 1;
    } else {
      out.push(normalizeKey(sequence[i]));
      i += 1;
    }
  }
  return out;
}

/** Convert a raw typed character from VSCode's `type` event to a canonical keystroke. */
export function keystrokeFromTypedText(text: string): string {
  if (text === '\n' || text === '\r') return '<cr>';
  if (text === '\t') return '<tab>';
  if (text.length === 1) return normalizeKey(text);
  throw new Error(`expected single typed char, got ${JSON.stringify(text)}`);
}
