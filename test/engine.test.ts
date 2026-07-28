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

describe('basic motions', () => {
  it('h/l move and clamp', async () => {
    await type('ll');
    expect(cursor()).toEqual({ line: 0, character: 2 });
    await type('hhhh');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('l clamps at last char of line (Normal mode)', async () => {
    await type('l'.repeat(30));
    expect(cursor()).toEqual({ line: 0, character: 10 }); // "foo bar baz".length - 1
  });

  it('j/k move vertically (display-line path; goal column is VSCode-tracked)', async () => {
    setup('abc\na\nabcdef', { line: 0, character: 2 });
    await type('j'); // display-line move (fake keeps char if possible)
    expect(ed.visualMoveCount).toBe(1);
    expect(cursor()).toEqual({ line: 1, character: 0 }); // fake clamps to line len
    await type('j');
    expect(cursor().line).toBe(2);
  });

  it('counted j/k (logical) keep desired column', async () => {
    setup('abc\na\nabcdef', { line: 0, character: 2 });
    await type('1j'); // count → logical path; clamps to char 0
    expect(cursor()).toEqual({ line: 1, character: 0 });
    await type('1j'); // remembers column 2
    expect(cursor()).toEqual({ line: 2, character: 2 });
  });

  it('0 ^ $ work', async () => {
    setup('  hello  ', { line: 0, character: 4 });
    await type('0');
    expect(cursor()).toEqual({ line: 0, character: 0 });
    await type('^');
    expect(cursor()).toEqual({ line: 0, character: 2 });
    await type('$');
    expect(cursor()).toEqual({ line: 0, character: 8 });
  });

  it('w/b/e navigate words', async () => {
    await type('w');
    expect(cursor()).toEqual({ line: 0, character: 4 });
    await type('w');
    expect(cursor()).toEqual({ line: 0, character: 8 });
    await type('b');
    expect(cursor()).toEqual({ line: 0, character: 4 });
    await type('e');
    expect(cursor()).toEqual({ line: 0, character: 6 });
  });

  it('gg and G with and without counts', async () => {
    await type('G');
    expect(cursor()).toEqual({ line: 2, character: 0 });
    await type('gg');
    expect(cursor()).toEqual({ line: 0, character: 0 });
    await type('2G');
    expect(cursor()).toEqual({ line: 1, character: 0 });
    await type('3gg');
    expect(cursor()).toEqual({ line: 2, character: 0 });
  });
});

describe('operator + motion', () => {
  it('dw deletes to next word start', async () => {
    await type('dw');
    expect(text()).toBe('bar baz\nsecond line here\nthird line');
    expect(cursor()).toEqual({ line: 0, character: 0 });
    expect(ed.editBatchCount).toBe(1); // one undo stop
  });

  it('de deletes inclusive through word end', async () => {
    await type('de');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
  });

  it('d$ deletes to end of line', async () => {
    await type('d$');
    expect(text()).toBe('\nsecond line here\nthird line');
  });

  it('3dw crosses the newline to the 3rd word start (vim semantics)', async () => {
    await type('3dw'); // foo→bar→baz→second
    expect(text()).toBe('second line here\nthird line');
  });

  it('d2w uses post-operator count', async () => {
    await type('d2w');
    expect(text()).toBe('baz\nsecond line here\nthird line');
  });

  it('cw behaves like ce (vim quirk: trailing space kept)', async () => {
    await type('cw');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
  });

  it('yw yanks without editing', async () => {
    await type('yw');
    expect(text()).toBe(TEXT);
    expect(engine.getRegister()).toEqual({ text: 'foo ', linewise: false });
  });

  it('dj deletes two lines linewise', async () => {
    await type('dj');
    expect(text()).toBe('third line');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });
});

describe('operator doubling (dd/cc/yy)', () => {
  it('dd deletes the line and yanks it linewise', async () => {
    await type('dd');
    expect(text()).toBe('second line here\nthird line');
    expect(engine.getRegister()).toEqual({ text: 'foo bar baz\n', linewise: true });
    expect(ed.editBatchCount).toBe(1);
  });

  it('2dd deletes two lines', async () => {
    await type('2dd');
    expect(text()).toBe('third line');
  });

  it('dd on the last line eats the preceding newline', async () => {
    setup(TEXT, { line: 2, character: 0 });
    await type('dd');
    expect(text()).toBe('foo bar baz\nsecond line here');
    expect(cursor()).toEqual({ line: 1, character: 0 });
  });

  it('cc empties the line and enters Insert', async () => {
    await type('cc');
    expect(text()).toBe('\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('yy + p pastes the line below; P pastes above', async () => {
    await type('yyp');
    expect(text()).toBe('foo bar baz\nfoo bar baz\nsecond line here\nthird line');
    expect(cursor()).toEqual({ line: 1, character: 0 });
    setup();
    await type('yyP');
    expect(text()).toBe('foo bar baz\nfoo bar baz\nsecond line here\nthird line');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });
});

describe('text objects', () => {
  it('diw deletes the inner word', async () => {
    setup(TEXT, { line: 0, character: 5 });
    await type('diw');
    expect(text()).toBe('foo  baz\nsecond line here\nthird line');
  });

  it('daw deletes word plus surrounding space', async () => {
    setup(TEXT, { line: 0, character: 5 });
    await type('daw');
    expect(text()).toBe('foo baz\nsecond line here\nthird line');
  });

  it('ci" changes inside quotes and enters Insert', async () => {
    setup('say "hi there" ok', { line: 0, character: 6 });
    await type('ci"');
    expect(text()).toBe('say "" ok');
    expect(mm.current).toBe('Insert');
    expect(cursor()).toEqual({ line: 0, character: 5 });
  });

  it('da( deletes the enclosing pair; cursor on a bracket uses that pair', async () => {
    setup('foo(a(b)c)end', { line: 0, character: 4 }); // between outer and inner
    await type('da(');
    expect(text()).toBe('fooend');
    setup('foo(a(b)c)end', { line: 0, character: 5 }); // on the inner '('
    await type('da(');
    expect(text()).toBe('foo(ac)end');
  });

  it('yi{ yanks brace contents across lines', async () => {
    setup('fn() {\n  body\n}', { line: 1, character: 2 });
    await type('yi{');
    expect(engine.getRegister()).toEqual({ text: '\n  body\n', linewise: false });
    expect(text()).toBe('fn() {\n  body\n}');
  });

  it('dip deletes the paragraph linewise', async () => {
    setup('one\ntwo\n\nthree', { line: 0, character: 1 });
    await type('dip');
    expect(text()).toBe('\nthree');
  });
});

describe('find-char motions', () => {
  it('fx / ; / ,', async () => {
    setup('the quick fox', { line: 0, character: 0 });
    await type('fx');
    expect(cursor()).toEqual({ line: 0, character: 12 });
    setup('a.b.c.d', { line: 0, character: 0 });
    await type('f.');
    expect(cursor()).toEqual({ line: 0, character: 1 });
    await type(';');
    expect(cursor()).toEqual({ line: 0, character: 3 });
    await type(',');
    expect(cursor()).toEqual({ line: 0, character: 1 });
  });

  it('dfx deletes through the char', async () => {
    setup('foo.bar', { line: 0, character: 0 });
    await type('df.');
    expect(text()).toBe('bar');
  });

  it('dtx deletes up to but not including the char', async () => {
    setup('foo.bar', { line: 0, character: 0 });
    await type('dt.');
    expect(text()).toBe('.bar');
  });

  it('failed find aborts the pending operator', async () => {
    await type('dfq'); // 'q' does not exist in TEXT
    expect(text()).toBe(TEXT);
    expect(mm.current).toBe('Normal');
  });
});

describe('small editing actions', () => {
  it('x deletes char under cursor with count', async () => {
    await type('x');
    expect(text()).toBe('oo bar baz\nsecond line here\nthird line');
    setup();
    await type('3x');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
  });

  it('X deletes char before cursor', async () => {
    setup(TEXT, { line: 0, character: 2 });
    await type('X');
    expect(text()).toBe('fo bar baz\nsecond line here\nthird line');
    expect(cursor()).toEqual({ line: 0, character: 1 });
  });

  it('D deletes to end of line', async () => {
    setup(TEXT, { line: 0, character: 4 }); // cursor on 'b' of bar
    await type('D');
    expect(text()).toBe('foo \nsecond line here\nthird line');
  });

  it('C changes to end of line', async () => {
    setup(TEXT, { line: 0, character: 4 });
    await type('C');
    expect(text()).toBe('foo \nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
  });

  it('s substitutes chars and enters Insert', async () => {
    await type('2s');
    expect(text()).toBe('o bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
  });

  it('charwise p pastes after cursor; P before', async () => {
    await type('yw'); // yanks "foo "
    await type('p');
    expect(text()).toBe('ffoo oo bar baz\nsecond line here\nthird line');
    setup();
    await type('yw');
    await type('P');
    expect(text()).toBe('foo foo bar baz\nsecond line here\nthird line');
  });
});

describe('insert-mode entry', () => {
  it('i enters Insert at cursor', async () => {
    await type('i');
    expect(mm.current).toBe('Insert');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('a moves one right then Insert', async () => {
    await type('a');
    expect(mm.current).toBe('Insert');
    expect(cursor()).toEqual({ line: 0, character: 1 });
  });

  it('I goes to first non-blank; A to line end', async () => {
    setup('  hello', { line: 0, character: 0 });
    await type('I');
    expect(cursor()).toEqual({ line: 0, character: 2 });
    setup('  hello', { line: 0, character: 0 });
    await type('A');
    expect(cursor()).toEqual({ line: 0, character: 7 });
  });

  it('o opens line below; O above', async () => {
    await type('o');
    expect(text()).toBe('foo bar baz\n\nsecond line here\nthird line');
    expect(mm.current).toBe('Insert');
    expect(cursor()).toEqual({ line: 1, character: 0 });
    setup();
    await type('O');
    expect(text()).toBe('\nfoo bar baz\nsecond line here\nthird line');
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('escape from Insert moves cursor left and returns to Normal', async () => {
    await type('ll'); // char 2
    await type('i');
    mm.transition('Normal'); // simulate what handleEscape does after typing
    setup(TEXT, { line: 0, character: 3 });
    mm.transition('Insert');
    await engine.handleEscape(ed);
    expect(mm.current).toBe('Normal');
    expect(cursor()).toEqual({ line: 0, character: 2 });
  });
});

describe('visual mode', () => {
  it('v + motions extend the selection', async () => {
    await type('vll');
    const sel = ed.getSelections()[0];
    expect(mm.current).toBe('Visual');
    expect(sel.anchor).toEqual({ line: 0, character: 0 });
    expect(sel.active).toEqual({ line: 0, character: 2 });
  });

  it('v then d deletes the selection inclusive', async () => {
    await type('vlld');
    expect(text()).toBe(' bar baz\nsecond line here\nthird line');
    expect(mm.current).toBe('Normal');
  });

  it('v + w + y yanks through the motion (inclusive of active char)', async () => {
    await type('vwy'); // visual selection covers 'foo b'
    expect(engine.getRegister()).toEqual({ text: 'foo b', linewise: false });
    expect(mm.current).toBe('Normal');
  });

  it('V selects linewise and d deletes whole lines', async () => {
    await type('Vjd');
    expect(text()).toBe('third line');
  });

  it('v toggles back to Normal', async () => {
    await type('vv');
    expect(mm.current).toBe('Normal');
    expect(ed.getSelections()[0].anchor).toEqual(ed.getSelections()[0].active);
  });

  it('<esc> exits visual and collapses the selection', async () => {
    await type('vll');
    await engine.handleEscape(ed);
    expect(mm.current).toBe('Normal');
    expect(ed.getSelections()[0].anchor).toEqual(ed.getSelections()[0].active);
  });
});

describe('hasPendingInput (router coordination)', () => {
  it('is false when idle', () => {
    expect(engine.hasPendingInput()).toBe(false);
  });

  it('is true while an operator is pending, false after the motion completes', async () => {
    await type('d');
    expect(engine.hasPendingInput()).toBe(true);
    await type('w');
    expect(engine.hasPendingInput()).toBe(false);
  });

  it('is true while waiting for a find-char argument', async () => {
    await type('f');
    expect(engine.hasPendingInput()).toBe(true);
    await type('o');
    expect(engine.hasPendingInput()).toBe(false);
  });

  it('is true while waiting for register/mark/macro names and r/z args', async () => {
    await type('"');
    expect(engine.hasPendingInput()).toBe(true);
    await type('ayy');
    expect(engine.hasPendingInput()).toBe(false);

    await type('r');
    expect(engine.hasPendingInput()).toBe(true);
    await type('x');
    expect(engine.hasPendingInput()).toBe(false);

    await type('z');
    expect(engine.hasPendingInput()).toBe(true);
    await type('z');
    expect(engine.hasPendingInput()).toBe(false);
  });

  it('is true while a text-object prefix is pending (di…)', async () => {
    await type('d');
    await type('i');
    expect(engine.hasPendingInput()).toBe(true);
    await type('w');
    expect(engine.hasPendingInput()).toBe(false);
  });
});

describe('gj/gk (LazyVim display-line j/k)', () => {
  it('j/k without a count use the display-line path', async () => {
    await type('j');
    expect(ed.visualMoveCount).toBe(1);
    await type('k');
    expect(ed.visualMoveCount).toBe(2);
  });

  it('j/k with a count stay logical', async () => {
    await type('3j');
    expect(ed.visualMoveCount).toBe(0);
    expect(cursor().line).toBe(2);
  });

  it('dj keeps logical lines (operator-pending)', async () => {
    await type('dj');
    expect(ed.visualMoveCount).toBe(0);
    expect(text()).toBe('third line');
  });

  it('gj/gk use the display-line path even with counts', async () => {
    await type('gj');
    expect(ed.visualMoveCount).toBe(1);
    await type('2gk');
    expect(ed.visualMoveCount).toBe(2);
  });

  it('j in Visual mode extends the selection via the display-line path', async () => {
    await type('v');
    await type('j');
    expect(ed.visualMoveCount).toBe(1);
    expect(mm.current).toBe('Visual');
    expect(ed.getSelections()[0].active.line).toBe(1);
  });
});

describe('edge cases', () => {
  it('dd on a single-line document leaves one empty line', async () => {
    setup('only', { line: 0, character: 0 });
    await type('dd');
    expect(text()).toBe('');
  });

  it('dw at end of document does not throw', async () => {
    setup(TEXT, { line: 2, character: 5 });
    await type('dw');
    expect(mm.current).toBe('Normal');
  });

  it('unknown keys are swallowed without side effects', async () => {
    await type('zzz');
    expect(text()).toBe(TEXT);
    expect(cursor()).toEqual({ line: 0, character: 0 });
  });

  it('a stray second operator cancels the pending one', async () => {
    await type('dc');
    expect(text()).toBe(TEXT);
    await type('w'); // plain motion now
    expect(cursor()).toEqual({ line: 0, character: 4 });
  });

  it('% jumps between brackets', async () => {
    setup('foo(bar)baz', { line: 0, character: 3 });
    await type('%');
    expect(cursor()).toEqual({ line: 0, character: 7 });
  });
});
