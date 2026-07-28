import { describe, it, expect } from 'vitest';
import { buildWhichKeyItems, whichKeyTitle } from '../src/lazyvim/whichKeyItems';
import { LAZYVIM_KEYMAPS, parsedKeymaps } from '../src/lazyvim/keymaps';
import { parseKeySequence } from '../src/core/input/keyNotation';

const parsed = parsedKeymaps();

describe('buildWhichKeyItems', () => {
  it('lists leader bindings with remaining suffixes at the root', () => {
    const items = buildWhichKeyItems(['<leader>'], parsed);
    const labels = items.map((i) => i.label);
    expect(labels).toContain('<space>');
    expect(labels).toContain('ca');
    expect(labels).toContain('e');
    // Descriptions come from the keymap table
    const root = items.find((i) => i.label === '<space>');
    expect(root?.description).toBe('Find Files');
  });

  it('narrows to the pending prefix', () => {
    const items = buildWhichKeyItems(['<leader>', 'f'], parsed);
    const labels = items.map((i) => i.label);
    expect(labels).toContain('n'); // <leader>fn
    expect(labels).not.toContain('ca');
  });

  it('lists g-prefix bindings', () => {
    const items = buildWhichKeyItems(['g'], parsed);
    const labels = items.map((i) => i.label);
    // suffixes are joined: gcc → "cc"
    expect(labels).toEqual(expect.arrayContaining(['d', 'r', 'I', 'cc']));
  });

  it('returns empty for non-prefix pendings', () => {
    expect(buildWhichKeyItems(['x'], parsed)).toEqual([]);
    expect(buildWhichKeyItems(['<leader>', 'z'], parsed)).toEqual([]);
  });

  it('excludes completed bindings (pending must be a strict prefix)', () => {
    // 'u' is a complete binding, not a prefix of anything
    expect(buildWhichKeyItems(['u'], parsed)).toEqual([]);
  });

  it('filters by mode when the entry declares modes', () => {
    // <leader>ca is Normal+Visual; all our entries apply in Normal
    const items = buildWhichKeyItems(['<leader>', 'c'], parsed, 'Normal');
    expect(items.map((i) => i.label)).toContain('a');
    const insertItems = buildWhichKeyItems(['<leader>', 'c'], parsed, 'Insert');
    expect(insertItems).toEqual([]);
  });

  it('every keymap entry parses without throwing', () => {
    for (const entry of LAZYVIM_KEYMAPS) {
      expect(() => parseKeySequence(entry.keys)).not.toThrow();
    }
  });
});

describe('whichKeyTitle', () => {
  it('renders readable prefixes', () => {
    expect(whichKeyTitle(['<leader>'])).toBe('<leader>');
    expect(whichKeyTitle(['<leader>', 'f'])).toBe('<leader> › f');
    expect(whichKeyTitle(['g'])).toBe('g');
  });
});
