import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NormalEngine } from '../src/core/engine';
import { ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';
import { Range } from '../src/core/types';

let mm: ModeManager;
let engine: NormalEngine;
let ed: FakeEditorContext;
let updates: Array<{ matches: Range[]; active: number }>;

const TEXT = 'foo bar foo\nbaz foo qux\nlast foo line';

function setup(text = TEXT, cursor = { line: 0, character: 0 }) {
  mm = new ModeManager();
  engine = new NormalEngine(mm);
  ed = new FakeEditorContext(text, cursor);
  updates = [];
  engine.onSearchUpdate = (matches, active) => {
    updates.push({ matches, active });
  };
}

const type = async (keys: string): Promise<void> => {
  await engine.handleKeys([...keys], ed);
};

const cursor = () => ed.getSelections()[0].active;
const text = () => ed.getText();

beforeEach(() => setup());

describe('/ and ? search', () => {
  it('/ jumps to the first match after the cursor', async () => {
    engine.searchPromptHandler = async () => 'foo';
    await type('/');
    expect(cursor()).toEqual({ line: 0, character: 8 }); // 2nd 'foo'; skips match AT cursor
  });

  it('/ wraps around to the top', async () => {
    setup(TEXT, { line: 2, character: 5 });
    engine.searchPromptHandler = async () => 'foo';
    await type('/');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('? searches backward', async () => {
    setup(TEXT, { line: 2, character: 4 });
    engine.searchPromptHandler = async () => 'foo';
    await type('?');
    expect(cursor()).toEqual({ line: 1, character: 4 });
  });

  it('cancelled prompt does nothing', async () => {
    engine.searchPromptHandler = async () => undefined;
    await type('/');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('notifies matches for highlighting', async () => {
    engine.searchPromptHandler = async () => 'foo';
    await type('/');
    const last = updates[updates.length - 1];
    expect(last.matches.length).toBe(4);
    expect(last.active).toBe(1);
    expect(last.matches[0]).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 3 },
    });
  });
});

describe('n and N', () => {
  beforeEach(async () => {
    engine.searchPromptHandler = async () => 'foo';
    await type('/'); // cursor now on match index 1 (line 0, char 4)
  });

  it('n advances to the next match', async () => {
    await type('n');
    expect(cursor()).toEqual({ line: 1, character: 4 });
    await type('n');
    expect(cursor()).toEqual({ line: 2, character: 5 });
  });

  it('n wraps around', async () => {
    await type('nnn'); // to last match, then wrap
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('N goes backward (opposite of search direction)', async () => {
    await type('N');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('count: 2n skips a match', async () => {
    await type('2n');
    expect(cursor()).toEqual({ line: 2, character: 5 });
  });
});

describe('* and #', () => {
  it('* jumps to the next whole-word occurrence', async () => {
    setup('foo food foo', { line: 0, character: 0 });
    await type('*');
    expect(cursor()).toEqual({ line: 0, character: 9 }); // skips "food"
  });

  it('* sets whole-word matching for n', async () => {
    setup('foo food foo', { line: 0, character: 0 });
    await type('*');
    await type('n');
    expect(cursor()).toEqual({ line: 0, character: 0 }); // wraps past "food"
  });

  it('# searches backward', async () => {
    setup('foo bar foo', { line: 0, character: 8 });
    await type('#');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });
});

describe('search with operators and highlights', () => {
  it('d/pattern deletes up to the match (exclusive)', async () => {
    setup('foo bar baz\nsecond line', { line: 0, character: 0 });
    engine.searchPromptHandler = async () => 'baz';
    await type('d/');
    expect(text()).toBe('baz\nsecond line');
  });

  it('<esc> in Normal clears highlights but keeps the pattern for n', async () => {
    engine.searchPromptHandler = async () => 'foo';
    await type('/');
    updates.length = 0;
    await engine.handleEscape(ed);
    expect(updates[updates.length - 1].matches).toEqual([]);
    await type('n'); // pattern still alive
    expect(cursor()).toEqual({ line: 1, character: 4 });
  });

  it('no matches notifies empty and does not move', async () => {
    engine.searchPromptHandler = async () => 'zzz';
    await type('/');
    expect(cursor()).toEqual({ line: 0, character: 0 });
    expect(updates[updates.length - 1].matches).toEqual([]);
  });
});
