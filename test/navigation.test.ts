import { describe, it, expect, beforeEach } from 'vitest';
import { NormalEngine } from '../src/core/engine';
import { ModeManager } from '../src/core/mode/modeManager';
import { FakeEditorContext } from './fakeEditorContext';
import { paragraphForward, paragraphBackward, screenHigh, screenMiddle, screenLow } from '../src/core/actions/motions';

const pos = (line: number, character: number) => ({ line, character });

// 0: para one line one
// 1: para one line two
// 2: (blank)
// 3: para two line one
// 4: (blank)
// 5: (blank)
// 6: para three
const PARAS = 'para one line one\npara one line two\n\npara two line one\n\n\npara three';

describe('paragraph motions ({ / }) — pure', () => {
  const ed = () => new FakeEditorContext(PARAS);

  it('} from a paragraph lands on the blank line below', () => {
    expect(paragraphForward(ed(), pos(0, 3), 0)?.position).toEqual(pos(2, 0));
    expect(paragraphForward(ed(), pos(1, 0), 0)?.position).toEqual(pos(2, 0));
  });

  it('} from a blank line goes to the end of the next paragraph', () => {
    expect(paragraphForward(ed(), pos(2, 0), 0)?.position).toEqual(pos(4, 0));
  });

  it('} respects count', () => {
    expect(paragraphForward(ed(), pos(0, 0), 2)?.position).toEqual(pos(4, 0));
    expect(paragraphForward(ed(), pos(0, 0), 3)?.position).toEqual(pos(6, 0)); // doc end
  });

  it('} with no blank below lands on the last line (first non-blank)', () => {
    const e = new FakeEditorContext('aaa\nbbb');
    expect(paragraphForward(e, pos(0, 1), 0)?.position).toEqual(pos(1, 0));
    expect(paragraphForward(e, pos(0, 1), 0)?.linewise).toBe(true);
  });

  it('{ from a paragraph lands on the blank line above it', () => {
    expect(paragraphBackward(ed(), pos(3, 2), 0)?.position).toEqual(pos(2, 0));
    expect(paragraphBackward(ed(), pos(6, 0), 0)?.position).toEqual(pos(5, 0));
  });

  it('{ from a blank line goes to the start of the previous paragraph', () => {
    expect(paragraphBackward(ed(), pos(5, 0), 0)?.position).toEqual(pos(2, 0));
    expect(paragraphBackward(ed(), pos(2, 0), 0)?.position).toEqual(pos(0, 0)); // doc start
  });

  it('{ respects count', () => {
    expect(paragraphBackward(ed(), pos(6, 0), 2)?.position).toEqual(pos(2, 0));
  });

  it('motions that cannot move return undefined (vim: beep)', () => {
    const e = new FakeEditorContext('aaa');
    expect(paragraphBackward(e, pos(0, 0), 0)).toBeUndefined();
    expect(paragraphForward(new FakeEditorContext('aaa'), pos(0, 0), 0)).toBeUndefined();
  });
});

describe('screen motions (H / M / L) — pure', () => {
  // 60 lines, every 10th indented (firstNonBlank = 2)
  const text = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? '  indented' : 'plain')).join('\n');
  const ed = () => {
    const e = new FakeEditorContext(text);
    e.setViewport(10, 29); // 20 visible lines, 10..29
    return e;
  };

  it('H goes to the first visible line, first non-blank', () => {
    const r = screenHigh(ed(), pos(15, 3), 0);
    expect(r?.position).toEqual(pos(10, 2));
    expect(r?.linewise).toBe(true);
  });

  it('H with count goes n lines down from the top', () => {
    expect(screenHigh(ed(), pos(15, 0), 3)?.position).toEqual(pos(12, 0));
  });

  it('M goes to the middle visible line', () => {
    expect(screenMiddle(ed(), pos(15, 0), 0)?.position).toEqual(pos(19, 0));
  });

  it('L goes to the last visible line', () => {
    expect(screenLow(ed(), pos(15, 0), 0)?.position).toEqual(pos(29, 0));
  });

  it('L with count goes n lines up from the bottom', () => {
    expect(screenLow(ed(), pos(15, 0), 2)?.position).toEqual(pos(28, 0));
  });

  it('clamps when the viewport extends past the document', () => {
    const e = new FakeEditorContext('a\nb\nc'); // viewport 0..2 (doc shorter than default)
    e.setViewport(0, 50);
    expect(screenLow(e, pos(0, 0), 0)?.position).toEqual(pos(2, 0));
  });
});

// ── engine integration ───────────────────────────────────────────────────────

let mm: ModeManager;
let engine: NormalEngine;
let ed: FakeEditorContext;

function setup(text: string, cursor = pos(0, 0), viewportHeight = 20) {
  mm = new ModeManager();
  engine = new NormalEngine(mm);
  ed = new FakeEditorContext(text, cursor, viewportHeight);
}

const keys = async (...ks: string[]): Promise<void> => {
  await engine.handleKeys(ks, ed);
};
const type = async (s: string): Promise<void> => keys(...[...s]);

const cursor = () => ed.getSelections()[0].active;
const lines = () => ed.getText().split('\n');

beforeEach(() => setup(PARAS));

describe('paragraph motions — engine', () => {
  it('} and { move the cursor', async () => {
    await type('}');
    expect(cursor()).toEqual(pos(2, 0));
    await type('{');
    expect(cursor()).toEqual(pos(0, 0));
  });

  it('d} deletes the paragraph but NOT the blank line below (exclusive)', async () => {
    await type('d}');
    expect(lines()).toEqual(['', 'para two line one', '', '', 'para three']);
  });

  it('d{ from a paragraph start deletes only the cursor line', async () => {
    setup(PARAS, pos(3, 0));
    await type('d{');
    expect(lines()).toEqual(['para one line one', 'para one line two', '', '', '', 'para three']);
  });

  it('y} yanks the paragraph linewise', async () => {
    await type('y}');
    expect(engine.getRegister()?.text).toBe('para one line one\npara one line two\n');
    expect(engine.getRegister()?.linewise).toBe(true);
  });

  it('v} extends the visual selection to the blank line', async () => {
    await type('v}');
    const sel = ed.getSelections()[0];
    expect(sel.active).toEqual(pos(2, 0));
    expect(mm.current).toBe('Visual');
  });

  it('} records a jumplist entry (<C-o> returns)', async () => {
    setup(PARAS, pos(3, 1));
    await type('}');
    expect(cursor().line).toBe(4);
    await keys('<C-o>');
    expect(cursor().line).toBe(3);
  });
});

describe('screen motions — engine', () => {
  const text60 = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? '  indented' : 'plain')).join('\n');

  beforeEach(() => {
    setup(text60, pos(15, 0));
    ed.setViewport(10, 29);
  });

  it('H / M / L move within the viewport', async () => {
    await type('H');
    expect(cursor()).toEqual(pos(10, 2)); // indented → first non-blank
    await type('M');
    expect(cursor()).toEqual(pos(19, 0));
    await type('L');
    expect(cursor()).toEqual(pos(29, 0));
  });

  it('3H goes to the 3rd visible line', async () => {
    await type('3H');
    expect(cursor().line).toBe(12);
  });

  it('H records a jumplist entry', async () => {
    await type('L');
    expect(cursor().line).toBe(29);
    await keys('<C-o>');
    expect(cursor().line).toBe(15);
  });

  it('dL deletes linewise to the bottom of the screen (inclusive)', async () => {
    await type('dL');
    // lines 15..29 inclusive = 15 lines removed, 45 remain
    expect(lines().length).toBe(45);
  });
});

describe('page scrolling (<C-d>/<C-u>/<C-f>/<C-b>)', () => {
  const text100 = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');

  beforeEach(() => setup(text100, pos(5, 3), 20)); // viewport 0..19

  it('<C-d> moves down half a page and scrolls the view with it', async () => {
    await keys('<C-d>');
    expect(cursor().line).toBe(15); // 5 + 10
    expect(cursor().character).toBe(3); // column preserved
    expect(ed.getVisibleLineRange()).toEqual({ start: 10, end: 29 }); // scrolled by the same 10
  });

  it('<C-u> moves back up half a page', async () => {
    await keys('<C-d>');
    await keys('<C-u>');
    expect(cursor().line).toBe(5);
    expect(ed.getVisibleLineRange()).toEqual({ start: 0, end: 19 });
  });

  it('<C-f>/<C-b> move a full page (height - 2 for overlap)', async () => {
    await keys('<C-f>');
    expect(cursor().line).toBe(23); // 5 + 18
    await keys('<C-b>');
    expect(cursor().line).toBe(5);
  });

  it('counts multiply the scroll amount', async () => {
    await type('3');
    await keys('<C-d>');
    expect(cursor().line).toBe(35); // 5 + 3*10
    expect(ed.getVisibleLineRange().start).toBe(30);
  });

  it('clamps at the document end', async () => {
    setup(text100, pos(97, 0), 20);
    await keys('<C-d>');
    expect(cursor().line).toBe(99); // moved only 2
    // The editor revealed the clamped cursor: viewport pinned to the doc end.
    expect(ed.getVisibleLineRange()).toEqual({ start: 80, end: 99 });
  });

  it('d<C-d> operates linewise over half a page', async () => {
    setup(text100, pos(10, 2), 20);
    await type('d');
    await keys('<C-d>');
    expect(lines().length).toBe(89); // lines 10..20 inclusive removed
    expect(lines()[10]).toBe('line 21');
  });

  it('<C-d> in Visual mode extends the selection', async () => {
    await type('v');
    await keys('<C-d>');
    const sel = ed.getSelections()[0];
    expect(sel.active.line).toBe(15);
    expect(sel.anchor.line).toBe(5);
    expect(mm.current).toBe('Visual');
  });

  it('page scrolls are not recorded as repeatable changes', async () => {
    await keys('<C-d>');
    await type('.');
    expect(cursor().line).toBe(15); // `.` had nothing to repeat
  });
});
