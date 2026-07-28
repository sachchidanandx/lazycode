import { describe, it, expect } from 'vitest';
import { BindingTrie } from '../src/core/input/bindingTrie';

describe('BindingTrie', () => {
  it('matches exact bindings', () => {
    const trie = new BindingTrie<string>();
    trie.bind(['d', 'd'], 'delete-line');
    expect(trie.match(['d', 'd'])).toEqual({ type: 'match', value: 'delete-line' });
  });

  it('distinguishes partial from none', () => {
    const trie = new BindingTrie<string>();
    trie.bind(['g', 'g'], 'goto-top');
    expect(trie.match(['g'])).toEqual({ type: 'partial' });
    expect(trie.match(['x'])).toEqual({ type: 'none' });
    expect(trie.match(['g', 'x'])).toEqual({ type: 'none' });
  });

  it('supports overlapping prefixes (gg vs gI)', () => {
    const trie = new BindingTrie<string>();
    trie.bind(['g', 'g'], 'goto-top');
    trie.bind(['g', 'I'], 'implementation');
    expect(trie.match(['g'])).toEqual({ type: 'partial' });
    expect(trie.match(['g', 'g'])).toEqual({ type: 'match', value: 'goto-top' });
    expect(trie.match(['g', 'I'])).toEqual({ type: 'match', value: 'implementation' });
  });

  it('unbinds and prunes', () => {
    const trie = new BindingTrie<string>();
    trie.bind(['<leader>', 'f', 'f'], 'find');
    expect(trie.unbind(['<leader>', 'f', 'f'])).toBe(true);
    expect(trie.match(['<leader>'])).toEqual({ type: 'none' });
    expect(trie.unbind(['<leader>', 'f', 'f'])).toBe(false);
  });

  it('lists bindings under a prefix (which-key)', () => {
    const trie = new BindingTrie<string>();
    trie.bind(['<leader>', 'f', 'f'], 'find-files');
    trie.bind(['<leader>', 'f', 'g'], 'grep');
    trie.bind(['<leader>', 'b', 'd'], 'delete-buffer');
    const under = trie.bindingsWithPrefix(['<leader>', 'f']);
    expect(under.map((b) => b.value).sort()).toEqual(['find-files', 'grep']);
    expect(trie.size).toBe(3);
  });

  it('rejects empty sequences', () => {
    const trie = new BindingTrie<string>();
    expect(() => trie.bind([], 'x')).toThrow();
  });
});
