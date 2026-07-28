import { describe, it, expect, beforeEach } from 'vitest';
import { NormalEngine } from '../src/core/engine';
import { ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';

let mm: ModeManager;
let engine: NormalEngine;
let ed: FakeEditorContext;

const TEXT = 'foo bar baz\nsecond line here\nthird line';

function setup(text = TEXT, cursor = { line: 0, character: 0 }) {
  mm = new ModeManager();
  engine = new NormalEngine(mm);
  ed = new FakeEditorContext(text, cursor);
}

const type = async (keys: string): Promise<void> => {
  await engine.handleKeys([...keys], ed);
};

/** Simulate typing in Insert mode (default:type edits the doc + router reports). */
const typeInInsert = async (raw: string): Promise<void> => {
  for (const ch of raw) {
    const at = ed.getSelections()[0].active;
    await ed.applyEdits([{ kind: 'insert', at, text: ch }]);
    ed.setSelections([
      { anchor: { line: at.line, character: at.character + 1 }, active: { line: at.line, character: at.character + 1 } },
    ]);
    engine.recordInsertText(ch);
  }
};

const cursor = () => ed.getSelections()[0].active;
const text = () => ed.getText();

beforeEach(() => setup());

describe('macro recording', () => {
  it('qq ... q records keystrokes into register q', async () => {
    await type('qq');
    await type('dw');
    await type('q');
    expect(engine.getMacro('q')).toEqual(['d', 'w']);
    expect(text()).toBe('bar baz\nsecond line here\nthird line'); // recorded action still ran
  });

  it('the closing q is not part of the macro', async () => {
    await type('qz');
    await type('x');
    await type('q');
    expect(engine.getMacro('z')).toEqual(['x']);
  });

  it('q with an invalid register cancels; following keys run normally', async () => {
    await type('q9');
    await type('dw');
    expect(engine.getMacro('9')).toBeUndefined();
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
  });
});

describe('macro replay', () => {
  it('@q replays the macro', async () => {
    await type('qq');
    await type('dw');
    await type('q');
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
    await type('@q');
    expect(text()).toBe('baz\nsecond line here\nthird line');
  });

  it('counted replay: 2@q', async () => {
    await type('qq');
    await type('x'); // recording runs it once: 'f' deleted
    await type('q');
    await type('2@q'); // two more deletions: 'o', 'o'
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
  });

  it('@@ repeats the last macro', async () => {
    await type('qq');
    await type('x');
    await type('q');
    await type('@@');
    expect(text()).toBe('o bar baz\nsecond line here\nthird line');
  });

  it('macro with an insert session replays typed text', async () => {
    // Record: append "!" at end of line
    await type('qa');
    await type('A');
    await typeInInsert('!');
    await engine.handleEscape(ed);
    await type('q');
    expect(engine.getMacro('a')).toEqual(['A', '!', '<esc>']);
    expect(text()).toBe('foo bar baz!\nsecond line here\nthird line');

    await type('j'); // line 1
    await type('@a');
    expect(text()).toBe('foo bar baz!\nsecond line here!\nthird line');
  });

  it('a change inside a macro becomes the dot-repeat', async () => {
    await type('qq');
    await type('dw');
    await type('q');
    await type('j0');
    await type('@q'); // deletes "second "
    expect(text()).toBe('bar baz\nline here\nthird line');
    await type('j0');
    await type('.'); // repeats dw (the macro's change)
    expect(text()).toBe('bar baz\nline here\nline');
  });
});

describe('macro edge cases', () => {
  it('replaying an empty register does nothing', async () => {
    await type('@z');
    expect(text()).toBe(TEXT);
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('recording captures counts and operators', async () => {
    await type('qq');
    await type('2dd');
    await type('q');
    expect(engine.getMacro('q')).toEqual(['2', 'd', 'd']);
    expect(text()).toBe('third line');
  });
});
