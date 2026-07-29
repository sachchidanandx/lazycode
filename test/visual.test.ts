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
