import { describe, it, expect, beforeEach } from 'vitest';
import { NormalEngine } from '../src/core/engine';
import { ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';

let mm: ModeManager;
let engine: NormalEngine;
let ed: FakeEditorContext;

function setup(text = 'foo\nbar\nbaz', cursor = { line: 0, character: 0 }) {
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

describe('>> and << (linewise indent)', () => {
  it('>> indents the current line by 4 spaces', async () => {
    await type('>>');
    expect(text()).toBe('    foo\nbar\nbaz');
    expect(cursor()).toEqual({ line: 0, character: 4 }); // first non-blank
    expect(ed.editBatchCount).toBe(1);
  });

  it('<< dedents', async () => {
    setup('        foo\nbar', { line: 0, character: 8 });
    await type('<<');
    expect(text()).toBe('    foo\nbar');
    expect(cursor()).toEqual({ line: 0, character: 4 });
  });

  it('2>> indents two lines', async () => {
    await type('2>>');
    expect(text()).toBe('    foo\n    bar\nbaz');
  });

  it('<< removes at most 4 spaces', async () => {
    setup('  foo', { line: 0, character: 2 });
    await type('<<');
    expect(text()).toBe('foo');
  });
});

describe('> with motions and text objects', () => {
  it('>j indents two lines', async () => {
    await type('>j');
    expect(text()).toBe('    foo\n    bar\nbaz');
  });

  it('>ip indents the paragraph', async () => {
    setup('one\ntwo\n\nthree', { line: 0, character: 0 });
    await type('>ip');
    expect(text()).toBe('    one\n    two\n\nthree');
  });

  it('<j dedents two lines', async () => {
    setup('    foo\n    bar\nbaz', { line: 0, character: 4 });
    await type('<j');
    expect(text()).toBe('foo\nbar\nbaz');
  });

  it('a different operator key cancels the pending >', async () => {
    await type('>d');
    expect(text()).toBe('foo\nbar\nbaz'); // nothing happened
  });
});

describe('visual indent (LazyVim: keeps going via dot)', () => {
  it('V> indents the selected lines and returns to Normal', async () => {
    await type('Vj>');
    expect(text()).toBe('    foo\n    bar\nbaz');
    expect(mm.current).toBe('Normal');
  });

  it('visual indent is dot-repeatable (re-indent same lines)', async () => {
    setup('foo\nbar', { line: 0, character: 0 });
    await type('V>');
    expect(text()).toBe('    foo\nbar');
    await type('.');
    expect(text()).toBe('        foo\nbar');
  });
});
