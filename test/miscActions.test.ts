import { describe, it, expect, beforeEach } from 'vitest';
import { NormalEngine } from '../src/core/engine';
import { ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';

let mm: ModeManager;
let engine: NormalEngine;
let ed: FakeEditorContext;

const TEXT = 'foo bar baz\nsecond line here\nthird line\nfourth line\nfifth line';

function setup(text = TEXT, cursor = { line: 0, character: 0 }) {
  mm = new ModeManager();
  engine = new NormalEngine(mm);
  ed = new FakeEditorContext(text, cursor);
}

const type = async (keys: string): Promise<void> => {
  await engine.handleKeys([...keys], ed);
};

const cursor = () => ed.getSelections()[0].active;
const text = () => ed.getText();

beforeEach(() => setup());

describe('r (replace char)', () => {
  it('rx replaces the char under the cursor', async () => {
    await type('rx');
    expect(text()).toBe('xoo bar baz\nsecond line here\nthird line\nfourth line\nfifth line');
    expect(cursor()).toEqual({ line: 0, character: 0 }); // cursor stays
  });

  it('3rx replaces three chars', async () => {
    await type('3rx');
    expect(text()).toBe('xxx bar baz\nsecond line here\nthird line\nfourth line\nfifth line');
  });

  it('fails silently past end of line', async () => {
    setup(TEXT, { line: 0, character: 10 });
    await type('5rx');
    expect(text()).toBe(TEXT);
  });

  it('is dot-repeatable', async () => {
    await type('rx');
    await type('l');
    await type('.');
    expect(text()).toBe('xxo bar baz\nsecond line here\nthird line\nfourth line\nfifth line');
  });
});

describe('~ (toggle case)', () => {
  it('toggles the char and moves right', async () => {
    await type('~');
    expect(text()).toBe('Foo bar baz\nsecond line here\nthird line\nfourth line\nfifth line');
    expect(cursor()).toEqual({ line: 0, character: 1 });
  });

  it('with count', async () => {
    await type('3~');
    expect(text()).toBe('FOO bar baz\nsecond line here\nthird line\nfourth line\nfifth line');
  });

  it('respects existing case', async () => {
    setup('aBc', { line: 0, character: 0 });
    await type('3~');
    expect(text()).toBe('AbC');
  });
});

describe('J (join lines)', () => {
  it('joins with the next line, collapsing indent', async () => {
    await type('J');
    expect(text()).toBe('foo bar baz second line here\nthird line\nfourth line\nfifth line');
    expect(ed.editBatchCount).toBe(1);
  });

  it('2J joins three lines', async () => {
    await type('2J');
    expect(text()).toBe('foo bar baz second line here third line\nfourth line\nfifth line');
  });

  it('does nothing on the last line', async () => {
    setup(TEXT, { line: 4, character: 0 });
    await type('J');
    expect(text()).toBe(TEXT);
  });

  it('is dot-repeatable', async () => {
    await type('J');
    await type('.');
    expect(text()).toBe('foo bar baz second line here third line\nfourth line\nfifth line');
  });
});

describe('zz/zt/zb', () => {
  it('dispatches to the scroll handler', async () => {
    const calls: string[] = [];
    engine.scrollHandler = (kind) => {
      calls.push(kind);
    };
    await type('zz');
    await type('zt');
    await type('zb');
    expect(calls).toEqual(['center', 'top', 'bottom']);
  });

  it('unknown z-key does nothing', async () => {
    const calls: string[] = [];
    engine.scrollHandler = (kind) => {
      calls.push(kind);
    };
    await type('zq');
    expect(calls).toEqual([]);
  });
});

describe('jumplist (<C-o>/<C-i>)', () => {
  it('G records the origin; <C-o> returns; <C-i> goes forward again', async () => {
    await type('G'); // jump: (0,0) → line 4
    expect(cursor().line).toBe(4);
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor().line).toBe(0);
    await engine.handleKeys(['<C-i>'], ed);
    expect(cursor().line).toBe(4);
  });

  it('walks multiple entries back and forward', async () => {
    await type('G'); // origin (0,0), land line 4
    await type('gg'); // origin (4,0), land line 0
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor().line).toBe(4);
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor().line).toBe(0);
    await engine.handleKeys(['<C-i>'], ed);
    expect(cursor().line).toBe(4);
  });

  it('a new jump after going back truncates forward entries', async () => {
    await type('G'); // origin (0,0), land 4
    await type('gg'); // origin (4,0), land 0
    await engine.handleKeys(['<C-o>'], ed); // back to (4,0)
    expect(cursor().line).toBe(4);
    await type('2gg'); // new jump from line 4 → line 2
    expect(cursor().line).toBe(1);
    // <C-o> now goes to the truncated origin (4,0); forward entry (0,0) is gone
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor().line).toBe(4);
  });

  it('plain motions (j/k) do not touch the jumplist', async () => {
    await type('jjj');
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor().line).toBe(3); // nothing recorded — no movement
  });

  it('% records a jump', async () => {
    setup('foo(bar)baz\nline2', { line: 0, character: 3 });
    await type('%');
    expect(cursor()).toEqual({ line: 0, character: 7 });
    await engine.handleKeys(['<C-o>'], ed);
    expect(cursor()).toEqual({ line: 0, character: 3 });
  });
});
