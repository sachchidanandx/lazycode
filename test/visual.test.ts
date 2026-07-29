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

const cursor = () => ed.getSelections()[0].active;
const text = () => ed.getText();

beforeEach(() => setup());

// Vim visual mode is INCLUSIVE of the character under the cursor: whatever
// the cursor sits on is part of the selection for y/d/c. These tests lock
// that in, including backward selections and line-end edge cases.
describe('visual inclusivity (cursor char is always included)', () => {
  it('v + lll + y yanks 4 chars including the cursor char', async () => {
    await type('vllly');
    expect(engine.getRegister()).toEqual({ text: 'foo ', linewise: false });
  });

  it('v + lll + d deletes 4 chars including the cursor char', async () => {
    await type('vllld'); // cols 0-3 = 'foo ' (lll lands on the space)
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
  });

  it('backward selection (v + hhh) includes both ends', async () => {
    setup(TEXT, { line: 0, character: 5 }); // on 'a' of bar
    await type('vhhhy'); // active → col 2; selection covers cols 2..5
    expect(engine.getRegister()).toEqual({ text: 'o ba', linewise: false });
  });

  it('v$ yanks through the last char of the line', async () => {
    await type('v$y');
    expect(engine.getRegister()).toEqual({ text: 'foo bar baz', linewise: false });
  });

  it('vd at the last char of a line deletes that char', async () => {
    setup(TEXT, { line: 0, character: 10 }); // last char of line 0
    await type('vd');
    expect(text()).toBe('foo bar ba\nsecond line here\nthird line');
  });

  it('v + e yanks through the end of the word', async () => {
    await type('vey');
    expect(engine.getRegister()).toEqual({ text: 'foo', linewise: false });
  });

  it('V selects whole lines regardless of cursor column', async () => {
    setup(TEXT, { line: 0, character: 5 });
    await type('Vy');
    expect(engine.getRegister()).toEqual({ text: 'foo bar baz\n', linewise: true });
  });

  it('visual change (c) deletes the inclusive selection and enters Insert', async () => {
    await type('vllc');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
  });
});

describe('visual text objects (viw, va{, vip, …)', () => {
  const sel = () => ed.getSelections()[0];

  it('viw selects the word, stays in Visual', async () => {
    await type('viw');
    expect(mm.current).toBe('Visual');
    expect(sel()).toEqual({ anchor: { line: 0, character: 0 }, active: { line: 0, character: 2 } });
  });

  it('vaw includes trailing blanks', async () => {
    await type('vaw');
    expect(sel()).toEqual({ anchor: { line: 0, character: 0 }, active: { line: 0, character: 3 } });
  });

  it('vi{ selects inside braces (multi-line)', async () => {
    setup('if (x) {\n  body();\n}', { line: 1, character: 3 });
    await type('vi{');
    expect(mm.current).toBe('Visual');
    // from after `{` to end of the body line — closing brace excluded
    expect(sel()).toEqual({ anchor: { line: 0, character: 8 }, active: { line: 1, character: 8 } });
  });

  it('va{ includes the braces', async () => {
    setup('if (x) {\n  body();\n}', { line: 1, character: 3 });
    await type('va{');
    expect(sel()).toEqual({ anchor: { line: 0, character: 7 }, active: { line: 2, character: 0 } });
  });

  it('vi" selects inside quotes', async () => {
    setup('say "hello world" loudly', { line: 0, character: 6 });
    await type('vi"');
    expect(sel()).toEqual({ anchor: { line: 0, character: 5 }, active: { line: 0, character: 15 } });
  });

  it('vip selects the paragraph as VisualLine', async () => {
    setup('one\ntwo\n\nthree', { line: 1, character: 1 });
    await type('vip');
    expect(mm.current).toBe('VisualLine');
    expect(sel().anchor).toEqual({ line: 0, character: 0 });
    expect(sel().active.line).toBe(1);
  });

  it('viw + y yanks exactly the word', async () => {
    await type('viwy');
    expect(engine.getRegister()).toEqual({ text: 'foo', linewise: false });
    expect(mm.current).toBe('Normal');
  });

  it('viw + d deletes exactly the word', async () => {
    await type('viwd');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Normal');
  });

  it('operator text objects still work (di{, ciw)', async () => {
    setup('if (x) {\n  body();\n}', { line: 1, character: 3 });
    await type('di{');
    expect(text()).toBe('if (x) {}');
    setup(TEXT);
    await type('ciw');
    expect(mm.current).toBe('Insert');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
  });

  it('unknown object in visual stays in Visual and selects nothing new', async () => {
    await type('vll');
    const before = sel();
    await type('iz'); // no 'z' text object
    expect(mm.current).toBe('Visual');
    expect(sel()).toEqual(before);
  });
});

// Operations that apply to the visual SELECTION (not the cursor): these all
// previously ignored the selection entirely (vi" + x deleted one char at the
// cursor instead of the quoted text).
describe('visual selection operations (x, s, p, r, ~, u, U, J, o, …)', () => {
  it('vi" + x deletes the quoted text and exits to Normal', async () => {
    setup('say "hello world" loudly', { line: 0, character: 6 });
    await type('vi"x');
    expect(text()).toBe('say "" loudly');
    expect(mm.current).toBe('Normal');
  });

  it('viw + x yanks the selection into the unnamed register (like d)', async () => {
    await type('viwx');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(engine.getRegister()).toEqual({ text: 'foo', linewise: false });
  });

  it('V + X deletes the selected lines linewise', async () => {
    await type('VX');
    expect(text()).toBe('second line here\nthird line');
  });

  it('v + D deletes the selected lines linewise', async () => {
    setup(TEXT, { line: 0, character: 4 });
    await type('v$D');
    expect(text()).toBe('second line here\nthird line');
  });

  it('viw + s changes the selection (deletes + enters Insert)', async () => {
    await type('viws');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
  });

  it('V + Y yanks the selected lines linewise', async () => {
    await type('VjY');
    expect(engine.getRegister()).toEqual({ text: 'foo bar baz\nsecond line here\n', linewise: true });
    expect(mm.current).toBe('Normal');
  });

  it('viw + p replaces the selection with the register', async () => {
    setup(TEXT, { line: 0, character: 0 });
    await type('yiw'); // yank 'foo'
    await type('wviwp'); // select 'bar', paste over it
    expect(text()).toBe('foo foo baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Normal');
    expect(cursor()).toEqual({ line: 0, character: 6 }); // last char of pasted text
  });

  it('visual p moves the deleted selection into the unnamed register', async () => {
    setup(TEXT, { line: 0, character: 0 });
    await type('yiw'); // register: foo
    await type('wviwp'); // paste foo over bar
    expect(engine.getRegister()).toEqual({ text: 'bar', linewise: false });
  });

  it('viw + p + u then p again pastes the previously deleted text', async () => {
    setup(TEXT, { line: 0, character: 0 });
    await type('yiw');
    await type('wviwp'); // 'foo foo baz', unnamed register now 'bar'
    await type('viwp'); // select the pasted 'foo', replace with 'bar'
    expect(text()).toBe('foo bar baz\nsecond line here\nthird line');
  });

  it('viw + ra replaces every selected char with a', async () => {
    await type('viwra');
    expect(text()).toBe('aaa bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Normal');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('v$ + r- replaces across the line, one edit batch', async () => {
    const batchesBefore = ed.editBatchCount;
    await type('v$r-');
    expect(text()).toBe('-----------\nsecond line here\nthird line');
    expect(ed.editBatchCount).toBe(batchesBefore + 1);
  });

  it('viw + ~ swaps case over the selection', async () => {
    setup('Foo BAR baz', { line: 0, character: 5 });
    await type('viw~');
    expect(text()).toBe('Foo bar baz');
    expect(mm.current).toBe('Normal');
    expect(cursor()).toEqual({ line: 0, character: 4 });
  });

  it('viw + u lowercases the selection', async () => {
    setup('Foo BAR baz', { line: 0, character: 5 });
    await type('viwu');
    expect(text()).toBe('Foo bar baz');
    expect(mm.current).toBe('Normal');
  });

  it('viw + U uppercases the selection', async () => {
    setup('foo bar baz', { line: 0, character: 5 });
    await type('viwU');
    expect(text()).toBe('foo BAR baz');
    expect(mm.current).toBe('Normal');
  });

  it('Vj + J joins the selected lines', async () => {
    await type('VjJ');
    expect(text()).toBe('foo bar baz second line here\nthird line');
    expect(mm.current).toBe('Normal');
  });

  it('V + J on a single line behaves like Normal J', async () => {
    await type('VJ');
    expect(text()).toBe('foo bar baz second line here\nthird line');
  });

  it('v + o swaps the cursor to the other end of the selection', async () => {
    await type('vll'); // anchor 0, active 2
    const sel = () => ed.getSelections()[0];
    expect(sel()).toEqual({ anchor: { line: 0, character: 0 }, active: { line: 0, character: 2 } });
    await type('o');
    expect(sel()).toEqual({ anchor: { line: 0, character: 2 }, active: { line: 0, character: 0 } });
    expect(mm.current).toBe('Visual');
    await type('o');
    expect(sel()).toEqual({ anchor: { line: 0, character: 0 }, active: { line: 0, character: 2 } });
  });

  it('v + O also swaps ends (no new line opened)', async () => {
    await type('vllO');
    const sel = () => ed.getSelections()[0];
    expect(sel().active).toEqual({ line: 0, character: 0 });
    expect(text()).toBe(TEXT); // no line opened
  });

  it('vi"x is dot-repeatable', async () => {
    setup('a "one" b "two" c', { line: 0, character: 3 });
    await type('vi"x');
    expect(text()).toBe('a "" b "two" c');
    await type('f".'); // jump to the next quote pair, repeat
    expect(text()).toBe('a "" b "" c');
  });

  it('visual x is one undo stop', async () => {
    setup('say "hello world" loudly', { line: 0, character: 6 });
    const batchesBefore = ed.editBatchCount;
    await type('vi"x');
    expect(ed.editBatchCount).toBe(batchesBefore + 1);
  });

  it('Normal-mode x/X/s/r/~/J are unchanged (regression)', async () => {
    setup('Foo bar', { line: 0, character: 0 });
    await type('x');
    expect(text()).toBe('oo bar');

    setup('Foo bar', { line: 0, character: 3 });
    await type('X');
    expect(text()).toBe('Fo bar');

    setup('Foo bar', { line: 0, character: 0 });
    await type('s');
    expect(mm.current).toBe('Insert');
    expect(text()).toBe('oo bar');

    setup('Foo bar', { line: 0, character: 1 });
    await type('~');
    expect(text()).toBe('FOo bar');

    setup('Foo bar', { line: 0, character: 0 });
    await type('rx');
    expect(text()).toBe('xoo bar');

    setup('one\ntwo', { line: 0, character: 0 });
    await type('J');
    expect(text()).toBe('one two');

    // Normal u/U fall through harmlessly (undo lives in the keymap table).
    setup('Foo bar', { line: 0, character: 0 });
    await type('u');
    await type('U');
    expect(text()).toBe('Foo bar');
  });
});
