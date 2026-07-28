import { describe, it, expect } from 'vitest';
import { FakeEditorContext } from './fakeEditorContext';
import { wordObject, quoteObject, bracketObject, paragraphObject } from '../src/core/actions/textObjects';

const r = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

describe('wordObject (iw/aw)', () => {
  it('iw selects the word under the cursor', () => {
    const e = new FakeEditorContext('foo bar baz');
    expect(wordObject(e, { line: 0, character: 5 }, false)).toEqual(r(0, 4, 0, 7));
  });

  it('aw includes trailing blanks, else leading', () => {
    const e = new FakeEditorContext('foo bar  ');
    expect(wordObject(e, { line: 0, character: 0 }, true)).toEqual(r(0, 0, 0, 4)); // "foo "
    const e2 = new FakeEditorContext('foo bar');
    expect(wordObject(e2, { line: 0, character: 5 }, true)).toEqual(r(0, 3, 0, 7)); // " bar"
  });

  it('iw on punctuation selects the punct run', () => {
    const e = new FakeEditorContext('a...b');
    expect(wordObject(e, { line: 0, character: 2 }, false)).toEqual(r(0, 1, 0, 4));
  });
});

describe('quoteObject (i"/a")', () => {
  const ed = () => new FakeEditorContext('say "hi there" ok');

  it('i" selects inside quotes', () => {
    expect(quoteObject(ed(), { line: 0, character: 6 }, '"', false)).toEqual(r(0, 5, 0, 13));
  });

  it('a" includes the quotes', () => {
    expect(quoteObject(ed(), { line: 0, character: 6 }, '"', true)).toEqual(r(0, 4, 0, 14));
  });

  it('works when cursor is on a quote', () => {
    expect(quoteObject(ed(), { line: 0, character: 4 }, '"', false)).toEqual(r(0, 5, 0, 13));
  });

  it('returns undefined without a surrounding pair', () => {
    const e = new FakeEditorContext('no quotes here');
    expect(quoteObject(e, { line: 0, character: 3 }, '"', false)).toBeUndefined();
  });
});

describe('bracketObject (i(/a()', () => {
  it('i( selects innermost content', () => {
    const e = new FakeEditorContext('a(b(c)d)e');
    expect(bracketObject(e, { line: 0, character: 4 }, '(', ')', false)).toEqual(r(0, 4, 0, 5));
    expect(bracketObject(e, { line: 0, character: 2 }, '(', ')', false)).toEqual(r(0, 2, 0, 7));
  });

  it('a( includes brackets', () => {
    const e = new FakeEditorContext('a(b(c)d)e');
    expect(bracketObject(e, { line: 0, character: 4 }, '(', ')', true)).toEqual(r(0, 3, 0, 6));
  });

  it('spans multiple lines', () => {
    const e = new FakeEditorContext('fn() {\n  body\n}');
    expect(bracketObject(e, { line: 1, character: 2 }, '{', '}', false)).toEqual(r(0, 6, 2, 0));
  });
});

describe('paragraphObject (ip/ap)', () => {
  const text = 'one\ntwo\n\nthree\n\n\nfour';
  const ed = () => new FakeEditorContext(text);

  it('ip selects the paragraph, linewise', () => {
    const o = paragraphObject(ed(), { line: 1 }, false);
    expect(o?.range).toEqual(r(0, 0, 1, 3));
    expect(o?.linewise).toBe(true);
  });

  it('ap includes trailing blank lines', () => {
    const o = paragraphObject(ed(), { line: 3 }, true);
    expect(o?.range).toEqual(r(3, 0, 5, 0));
  });

  it('returns undefined on a blank line', () => {
    expect(paragraphObject(ed(), { line: 2 }, false)).toBeUndefined();
  });
});
