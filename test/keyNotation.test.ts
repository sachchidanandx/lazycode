import { describe, it, expect } from 'vitest';
import { normalizeKey, parseKeySequence, keystrokeFromTypedText } from '../src/core/input/keyNotation';

describe('normalizeKey', () => {
  it('passes through printable chars', () => {
    expect(normalizeKey('a')).toBe('a');
    expect(normalizeKey('G')).toBe('G');
    expect(normalizeKey('1')).toBe('1');
  });

  it('normalizes literal space and tab', () => {
    expect(normalizeKey(' ')).toBe('<space>');
  });

  it('canonicalizes special key names and aliases', () => {
    expect(normalizeKey('<esc>')).toBe('<esc>');
    expect(normalizeKey('<Escape>')).toBe('<esc>');
    expect(normalizeKey('<enter>')).toBe('<cr>');
    expect(normalizeKey('<leader>')).toBe('<leader>');
  });

  it('sorts and dedupes modifiers', () => {
    expect(normalizeKey('<A-C-x>')).toBe('<C-A-x>');
    expect(normalizeKey('<ctrl-w>')).toBe('<C-w>');
    expect(normalizeKey('<C-C-x>')).toBe('<C-x>');
  });

  it('rejects garbage', () => {
    expect(() => normalizeKey('')).toThrow();
    expect(() => normalizeKey('ab')).toThrow();
    expect(() => normalizeKey('<notakey>')).toThrow();
  });
});

describe('parseKeySequence', () => {
  it('splits plain sequences', () => {
    expect(parseKeySequence('3dw')).toEqual(['3', 'd', 'w']);
    expect(parseKeySequence('gg')).toEqual(['g', 'g']);
  });

  it('splits mixed notation', () => {
    expect(parseKeySequence('<leader>ff')).toEqual(['<leader>', 'f', 'f']);
    expect(parseKeySequence('<C-w>v')).toEqual(['<C-w>', 'v']);
    expect(parseKeySequence('ci"')).toEqual(['c', 'i', '"']);
  });

  it('handles leader+special combos', () => {
    expect(parseKeySequence('<leader><space>')).toEqual(['<leader>', '<space>']);
    expect(parseKeySequence('[b')).toEqual(['[', 'b']);
  });
});

describe('keystrokeFromTypedText', () => {
  it('maps typed chars', () => {
    expect(keystrokeFromTypedText('a')).toBe('a');
    expect(keystrokeFromTypedText('\n')).toBe('<cr>');
    expect(keystrokeFromTypedText('\t')).toBe('<tab>');
  });

  it('rejects multi-char text (paste/IME)', () => {
    expect(() => keystrokeFromTypedText('hello')).toThrow();
  });
});
