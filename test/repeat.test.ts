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

/**
 * Simulate the user typing text in Insert mode, then hitting <esc>.
 * Mimics what really happens: `default:type` edits the document and moves the
 * cursor, while the router reports the raw text to the engine for recording.
 */
const typeInInsert = async (raw: string): Promise<void> => {
  const at = ed.getSelections()[0].active;
  await ed.applyEdits([{ kind: 'insert', at, text: raw }]);
  ed.setSelections([
    { anchor: { line: at.line, character: at.character + raw.length }, active: { line: at.line, character: at.character + raw.length } },
  ]);
  for (const ch of raw) engine.recordInsertText(ch);
  await engine.handleEscape(ed);
};

const cursor = () => ed.getSelections()[0].active;
const text = () => ed.getText();

beforeEach(() => setup());

describe('dot-repeat: operator changes', () => {
  it('dw then . deletes another word', async () => {
    await type('dw');
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
    await type('.');
    expect(text()).toBe('baz\nsecond line here\nthird line');
  });

  it('dd then j. deletes the next line', async () => {
    await type('dd');
    await type('j');
    await type('.');
    expect(text()).toBe('second line here');
  });

  it('counted change repeats: 2dw then .', async () => {
    await type('2dw');
    expect(text()).toBe('baz\nsecond line here\nthird line');
    await type('.'); // 2dw again: baz→second→line
    expect(text()).toBe('line here\nthird line');
  });

  it('x then . deletes the next char', async () => {
    await type('x');
    await type('.');
    expect(text()).toBe('o bar baz\nsecond line here\nthird line');
  });

  it('dot with a count repeats the change N times', async () => {
    await type('x'); // deletes 'f'
    await type('3.'); // deletes 'oo '
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
  });

  it('diw then . on another word', async () => {
    await type('diw');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    await type('w'); // onto 'bar'
    await type('.');
    expect(text()).toBe('  baz\nsecond line here\nthird line');
  });

  it('motions between changes do not clobber lastChange', async () => {
    await type('dw'); // deletes "foo "
    await type('j'); // move down (a motion — not a change)
    await type('.');
    expect(text()).toBe('bar baz\nline here\nthird line');
  });

  it('repeating a non-insert change twice keeps lastChange intact', async () => {
    // Regression: replaying a change must not overwrite lastChange with
    // empty keys, or the second `.` would silently do nothing.
    await type('dw');
    await type('.');
    await type('.'); // third dw: 'baz' + newline (next word is on line 2)
    expect(text()).toBe('second line here\nthird line');
  });

  it('yank is not repeatable with .', async () => {
    await type('yw');
    await type('.');
    expect(text()).toBe(TEXT);
  });
});

describe('dot-repeat: insert sessions', () => {
  it('ciw<text><esc> then . applies the same change elsewhere', async () => {
    setup('foo bar\nfoo bar', { line: 0, character: 0 });
    await type('ciw');
    await typeInInsert('X');
    expect(text()).toBe('X bar\nfoo bar');
    expect(mm.current).toBe('Normal');

    await type('j'); // line 1, cursor on 'f' of foo
    await type('.');
    expect(text()).toBe('X bar\nX bar');
  });

  it('o<text><esc> then . opens another line with the same text', async () => {
    await type('o');
    await typeInInsert('hi');
    await type('.');
    expect(text()).toBe('foo bar baz\nhi\nhi\nsecond line here\nthird line');
  });

  it('repeating an insert-session change twice does not degrade', async () => {
    await type('ciw');
    await typeInInsert('Z');
    await type('w'); // onto 'bar'
    await type('.');
    expect(text()).toBe('Z Z baz\nsecond line here\nthird line');
    await type('w'); // onto 'baz'
    await type('.');
    expect(text()).toBe('Z Z Z\nsecond line here\nthird line');
  });

  it('i<text><esc> repeats as a plain insert', async () => {
    await type('i');
    await typeInInsert('>>');
    await type('.');
    expect(text()).toBe('>>>>foo bar baz\nsecond line here\nthird line');
  });
});

describe('dot-repeat: paste', () => {
  it('yy p then . pastes again', async () => {
    await type('yyp');
    await type('.');
    expect(text()).toBe('foo bar baz\nfoo bar baz\nfoo bar baz\nsecond line here\nthird line');
  });
});

describe('named registers', () => {
  it('"ayy yanks into register a and the unnamed register', async () => {
    await type('"ayy');
    expect(engine.getRegister('a')).toEqual({ text: 'foo bar baz\n', linewise: true });
    expect(engine.getRegister('"')).toEqual({ text: 'foo bar baz\n', linewise: true });
  });

  it('"ap pastes from register a below the cursor line', async () => {
    await type('"ayy');
    await type('j'); // cursor on line 1
    await type('"ap');
    expect(text()).toBe('foo bar baz\nsecond line here\nfoo bar baz\nthird line');
  });

  it('register spec survives an operator: "bdw deletes into b', async () => {
    await type('"bdw');
    expect(engine.getRegister('b')).toEqual({ text: 'foo ', linewise: false });
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
  });

  it('yanks populate "0; deletes do not', async () => {
    await type('yy');
    expect(engine.getRegister('0')).toEqual({ text: 'foo bar baz\n', linewise: true });
    await type('dd');
    expect(engine.getRegister('0')).toEqual({ text: 'foo bar baz\n', linewise: true }); // unchanged
  });

  it('"0p pastes the last yank even after a delete', async () => {
    await type('yw'); // yanks "foo " into "0; cursor stays at (0,0)
    await type('dw'); // deletes "foo " into unnamed register
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
    await type('"0p'); // charwise paste of "foo " after the cursor
    expect(text()).toBe('bfoo ar baz\nsecond line here\nthird line');
  });
});

describe('marks', () => {
  it('ma then \'a jumps back to the marked line (first non-blank)', async () => {
    await type('ma');
    await type('G');
    expect(cursor().line).toBe(2);
    await type("'a");
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('`a jumps to the exact marked position', async () => {
    setup('  indented\nother', { line: 0, character: 5 });
    await type('ma');
    await type('j0');
    await type('`a');
    expect(cursor()).toEqual({ line: 0, character: 5 });
  });

  it("'a is linewise: d'a deletes from current line to mark", async () => {
    setup(TEXT, { line: 0, character: 0 });
    await type('ma');
    await type('jj'); // line 2
    await type("d'a");
    expect(text()).toBe('');
  });

  it("'' jumps back to where the last jump started", async () => {
    await type('ma');
    await type('G');
    await type("'a"); // jump to mark
    await type("''"); // jump back
    expect(cursor().line).toBe(2);
  });
});
