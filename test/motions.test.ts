import { describe, it, expect } from 'vitest';
import { FakeEditorContext } from './fakeEditorContext';
import { wordForward, wordBackward, wordEnd, findChar, bracketMatch, gotoTop, gotoBottom } from '../src/core/actions/motions';

const pos = (line: number, character: number) => ({ line, character });

describe('word motions', () => {
  const text = 'foo bar.baz  qux\nsecond line';
  const ed = () => new FakeEditorContext(text);

  it('w moves across word and punct boundaries', () => {
    const e = ed();
    expect(wordForward(e, pos(0, 0), 0)?.position).toEqual(pos(0, 4)); // foo→bar
    expect(wordForward(e, pos(0, 4), 0)?.position).toEqual(pos(0, 7)); // bar→.
    expect(wordForward(e, pos(0, 7), 0)?.position).toEqual(pos(0, 8)); // .→baz
    expect(wordForward(e, pos(0, 8), 0)?.position).toEqual(pos(0, 13)); // baz→qux
    expect(wordForward(e, pos(0, 13), 0)?.position).toEqual(pos(1, 0)); // crosses newline
  });

  it('w respects count', () => {
    const e = ed();
    expect(wordForward(e, pos(0, 0), 3)?.position).toEqual(pos(0, 8));
  });

  it('b moves to previous word start', () => {
    const e = ed();
    expect(wordBackward(e, pos(0, 13), 0)?.position).toEqual(pos(0, 8));
    expect(wordBackward(e, pos(1, 0), 0)?.position).toEqual(pos(0, 13));
    expect(wordBackward(e, pos(0, 0), 0)?.position).toEqual(pos(0, 0)); // clamped
  });

  it('e lands on word ends, inclusive', () => {
    const e = ed();
    const r = wordEnd(e, pos(0, 0), 0);
    expect(r?.position).toEqual(pos(0, 2));
    expect(r?.inclusive).toBe(true);
    expect(wordEnd(e, pos(0, 2), 0)?.position).toEqual(pos(0, 6));
  });
});

describe('findChar (f/F/t/T)', () => {
  const ed = () => new FakeEditorContext('abc def abc');

  it('f finds forward, with count', () => {
    const e = ed();
    expect(findChar(e, pos(0, 0), 0, { char: 'c', forward: true, till: false })?.position).toEqual(pos(0, 2));
    expect(findChar(e, pos(0, 0), 2, { char: 'c', forward: true, till: false })?.position).toEqual(pos(0, 10));
  });

  it('t stops one before the target', () => {
    const e = ed();
    expect(findChar(e, pos(0, 0), 0, { char: 'd', forward: true, till: true })?.position).toEqual(pos(0, 3));
  });

  it('F searches backward', () => {
    const e = ed();
    expect(findChar(e, pos(0, 10), 0, { char: 'd', forward: false, till: false })?.position).toEqual(pos(0, 4));
  });

  it('returns undefined when not found', () => {
    const e = ed();
    expect(findChar(e, pos(0, 0), 0, { char: 'z', forward: true, till: false })).toBeUndefined();
  });
});

describe('line jumps', () => {
  const ed = () => new FakeEditorContext('aaa\n  bbb\nccc\nddd');

  it('gg goes to first line, or count line', () => {
    const e = ed();
    expect(gotoTop(e, pos(3, 0), 0)?.position).toEqual(pos(0, 0));
    expect(gotoTop(e, pos(0, 0), 3)?.position).toEqual(pos(2, 0));
  });

  it('gg lands on first non-blank', () => {
    const e = ed();
    expect(gotoTop(e, pos(0, 0), 2)?.position).toEqual(pos(1, 2));
  });

  it('G goes to last line, or count line', () => {
    const e = ed();
    expect(gotoBottom(e, pos(0, 0), 0)?.position).toEqual(pos(3, 0));
    expect(gotoBottom(e, pos(3, 0), 2)?.position).toEqual(pos(1, 2));
  });
});

describe('bracketMatch (%)', () => {
  it('matches across nesting', () => {
    const e = new FakeEditorContext('a(b(c)d)e');
    expect(bracketMatch(e, pos(0, 1), 0)?.position).toEqual(pos(0, 7));
    expect(bracketMatch(e, pos(0, 7), 0)?.position).toEqual(pos(0, 1));
    expect(bracketMatch(e, pos(0, 3), 0)?.position).toEqual(pos(0, 5));
  });

  it('scans forward on the line when not on a bracket', () => {
    const e = new FakeEditorContext('foo (bar)');
    expect(bracketMatch(e, pos(0, 0), 0)?.position).toEqual(pos(0, 8));
  });

  it('matches braces across lines', () => {
    const e = new FakeEditorContext('if {\n  x\n}');
    expect(bracketMatch(e, pos(0, 3), 0)?.position).toEqual(pos(2, 0));
  });
});
