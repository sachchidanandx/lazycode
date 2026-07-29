import { EditorContext } from './editorContext';
import { ModeManager } from './mode/modeManager';
import { Position, Range, Selection, TextEdit, cursorAt } from './types';
import * as motions from './actions/motions';
import { MotionResult, FindArg, clampNormalCursor, firstNonBlankChar } from './actions/motions';
import { wordObject, quoteObject, bracketObject, paragraphObject } from './actions/textObjects';
import { computeChange, computeDelete, computeYank, OperatorOutcome, Register } from './actions/operators';

/**
 * NormalEngine: the vim state machine for Normal/Visual modes.
 *
 * Receives canonical keystrokes from the router (only the ones the binding
 * trie didn't claim) and maintains vim's pending state: counts, pending
 * operator, pending text-object prefix, pending find-char, pending `g`.
 *
 * Invariants upheld here:
 *  - every operator applies its edits in ONE applyEdits call (one undo stop)
 *  - Normal-mode cursor is always clamped onto a real character
 *  - d/c/y always populate the unnamed register
 */

type Operator = 'd' | 'c' | 'y' | '>' | '<';
type FindKind = 'f' | 'F' | 't' | 'T';

const MOTIONS: Readonly<Record<string, motions.MotionFn>> = {
  h: motions.left,
  l: motions.right,
  j: motions.down,
  k: motions.up,
  w: motions.wordForward,
  b: motions.wordBackward,
  e: motions.wordEnd,
  '0': motions.lineStart,
  '^': motions.firstNonBlank,
  $: motions.lineEnd,
  G: motions.gotoBottom,
  '%': motions.bracketMatch,
  '{': motions.paragraphBackward,
  '}': motions.paragraphForward,
  H: motions.screenHigh,
  M: motions.screenMiddle,
  L: motions.screenLow,
};

const BRACKET_OBJECTS: Readonly<Record<string, [string, string]>> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
};

/** Convert a canonical keystroke to the literal char it represents (for f/F/t/T). */
function canonicalToChar(key: string): string | undefined {
  if (key.length === 1) return key;
  switch (key) {
    case '<space>': return ' ';
    case '<tab>': return '\t';
    case '<cr>': return '\n';
    case '<lt>': return '<';
    case '<bar>': return '|';
    default: return undefined;
  }
}

export class NormalEngine {
  private preCount = '';
  private postCount = '';
  private pendingOp: Operator | undefined;
  private pendingTO: 'i' | 'a' | undefined;
  private pendingG = false;
  private pendingFind: FindKind | undefined;
  private lastFind: FindArg | undefined;
  private desiredCol: number | undefined;

  private readonly registers: Record<string, Register | undefined> = {};
  private pendingRegister: string | undefined;
  private awaitRegisterName = false;

  private readonly marks: Record<string, Position | undefined> = {};
  private awaitMarkSet = false;
  private awaitMarkJump: "'" | '`' | undefined;
  private previousPos: Position | undefined;

  // ── dot-repeat recording ──────────────────────────────────────────────────
  /** Keys of the action currently in progress (reset when any action ends). */
  private pendingActionKeys: string[] = [];
  /** True while the user is in an Insert session started by a recorded change. */
  private insertSession = false;
  /** Text typed during the current insert session (fed by the router). */
  private insertText = '';
  private lastChange:
    | { keys: string[]; insertText: string; insertSession: boolean }
    | undefined;
  /** While true, keystrokes are NOT recorded (we are replaying them). */
  private replaying = false;

  // ── macros ─────────────────────────────────────────────────────────────────
  private recordingMacro: string | undefined;
  private macroKeys: string[] = [];
  private readonly macros: Record<string, string[] | undefined> = {};
  private awaitMacroRegister: 'record' | 'replay' | undefined;
  private lastMacroRegister: string | undefined;
  private replayingMacro = false;

  // ── search ─────────────────────────────────────────────────────────────────
  private search: { pattern: string; forward: boolean; wholeWord: boolean } | undefined;

  // ── misc pending state ────────────────────────────────────────────────────
  private awaitReplace = false; // after `r`
  private awaitZ = false; // after `z`
  private readonly jumplist: Position[] = [];
  private jumpIndex = -1; // -1 = at the live position (not on a list entry)

  constructor(private readonly modeManager: ModeManager) {}

  /** Set by the extension: prompts the user for a search pattern (UI concern). */
  searchPromptHandler?: (forward: boolean, editor: EditorContext) => Promise<string | undefined>;
  /** Set by the extension: receives match ranges for highlight decorations. */
  onSearchUpdate?: (matches: Range[], activeIndex: number, editor: EditorContext) => void;
  /** Set by the extension: zz/zt/zb scrolling (VSCode revealRange has no headless equivalent). */
  scrollHandler?: (kind: 'center' | 'top' | 'bottom', editor: EditorContext) => void;

  /** Test introspection. */
  getMacro(register: string): readonly string[] | undefined {
    return this.macros[register];
  }

  /**
   * True while the engine is mid-sequence and needs the next keystroke(s)
   * verbatim: operator-pending (d…), text-object prefix (di…), find-char arg
   * (f…), register/mark/macro names, `r` replacement char, `z` scroll arg.
   *
   * The router MUST consult this before trie matching — otherwise trie
   * bindings hijack argument keys (e.g. `f/` opening the find widget instead
   * of finding '/').
   */
  hasPendingInput(): boolean {
    return (
      this.pendingOp !== undefined ||
      this.pendingTO !== undefined ||
      this.pendingFind !== undefined ||
      this.awaitRegisterName ||
      this.awaitMarkSet ||
      this.awaitMarkJump !== undefined ||
      this.awaitMacroRegister !== undefined ||
      this.awaitReplace ||
      this.awaitZ
    );
  }

  /** Test introspection. */
  getRegister(name = '"'): Register | undefined {
    return this.registers[name];
  }

  /** Entry point used by the router fallback. */
  async handleKeys(keys: readonly string[], editor: EditorContext): Promise<void> {
    for (const key of keys) await this.handleKey(key, editor);
  }

  /** <esc> from any mode (also called by the extension's Escape command). */
  async handleEscape(editor: EditorContext): Promise<void> {
    this.clearPending();
    if (this.modeManager.is('Insert')) {
      // An insert session ending = a completed change → record it for `.`
      if (this.insertSession && !this.replaying) this.finalizeChange();
      this.insertSession = false;
      const cur = editor.getSelections()[0].active;
      editor.setSelections([cursorAt({ line: cur.line, character: Math.max(0, cur.character - 1) })]);
      this.modeManager.transition('Normal');
    } else if (this.modeManager.is('Visual', 'VisualLine')) {
      const active = editor.getSelections()[0].active;
      editor.setSelections([cursorAt(clampNormalCursor(editor, active))]);
      this.modeManager.transition('Normal');
      this.resetActionKeys();
    } else {
      this.resetActionKeys();
      // LazyVim: <esc> in Normal clears search highlights (pattern kept for n/N).
      if (this.search !== undefined) this.notifySearchUpdate(editor, [], -1);
    }
    // <esc> belongs in a macro being recorded (it ends insert sessions).
    if (this.recordingMacro !== undefined && !this.replayingMacro) {
      this.macroKeys.push('<esc>');
    }
  }

  /** Called by the router for every character typed through to Insert mode. */
  recordInsertText(raw: string): void {
    if (this.insertSession && !this.replaying) this.insertText += raw;
    // Typed text belongs in a macro being recorded too (as canonical keys).
    if (this.recordingMacro !== undefined && !this.replayingMacro) {
      for (const ch of raw) {
        this.macroKeys.push(ch === '\n' || ch === '\r' ? '<cr>' : ch === '\t' ? '<tab>' : ch);
      }
    }
  }

  // ── dot-repeat bookkeeping ─────────────────────────────────────────────────

  private finalizeChange(): void {
    this.lastChange = {
      keys: [...this.pendingActionKeys],
      insertText: this.insertText,
      insertSession: this.insertSession,
    };
    this.resetActionKeys();
  }

  private resetActionKeys(): void {
    this.pendingActionKeys = [];
    this.pendingRegister = undefined;
  }

  private beginInsertSession(): void {
    this.insertSession = true;
    this.insertText = '';
  }

  private async repeatLastChange(editor: EditorContext): Promise<void> {
    if (!this.lastChange || this.replaying) return;
    const lc = this.lastChange;
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    this.replaying = true;
    try {
      for (let i = 0; i < count; i++) {
        await this.handleKeys(lc.keys, editor);
        if (lc.insertSession) {
          // Replay the typed text exactly as if the user typed it.
          await this.insertRawAtCursor(editor, lc.insertText);
          await this.handleEscape(editor); // replaying → skips re-finalizing
        }
      }
    } finally {
      this.replaying = false;
    }
    this.resetActionKeys();
  }

  // ── macros ─────────────────────────────────────────────────────────────────

  private async replayMacro(register: string, editor: EditorContext, count: number): Promise<void> {
    const keys = this.macros[register];
    if (!keys || keys.length === 0) {
      this.resetActionKeys();
      return;
    }
    this.lastMacroRegister = register;
    // Fresh action buffer: the `@q` keys themselves are not part of any
    // change the macro makes, and the macro's last change becomes `.`.
    this.resetActionKeys();
    this.replayingMacro = true;
    try {
      for (let i = 0; i < count; i++) await this.replayKeys(keys, editor);
    } finally {
      this.replayingMacro = false;
    }
    this.resetActionKeys();
  }

  /**
   * Replay recorded keystrokes. Dot-recording stays ACTIVE during macro
   * replay (vim: a change inside a macro becomes the last change); typed
   * characters encountered while the macro has the engine in Insert mode are
   * inserted literally instead of dispatched.
   */
  private async replayKeys(keys: readonly string[], editor: EditorContext): Promise<void> {
    for (const key of keys) {
      if (this.modeManager.is('Insert')) {
        if (key === '<esc>') {
          await this.handleEscape(editor);
          continue;
        }
        const raw = canonicalToChar(key);
        if (raw === undefined) continue;
        await this.insertRawAtCursor(editor, raw);
        continue;
      }
      await this.handleKey(key, editor);
    }
  }

  /** Insert raw text at the cursor exactly as typing would (cursor ends after it). */
  private async insertRawAtCursor(editor: EditorContext, raw: string): Promise<void> {
    const at = this.cursor(editor);
    await editor.applyEdits([{ kind: 'insert', at, text: raw }]);
    const lines = raw.split('\n');
    const end: Position =
      lines.length === 1
        ? { line: at.line, character: at.character + raw.length }
        : { line: at.line + lines.length - 1, character: lines[lines.length - 1].length };
    editor.setSelections([cursorAt(end)]);
    this.recordInsertText(raw); // keeps `.` faithful during macro replay
  }

  // ── search ─────────────────────────────────────────────────────────────────

  private async promptSearch(editor: EditorContext, forward: boolean): Promise<void> {
    const handler = this.searchPromptHandler;
    if (!handler) {
      this.resetActionKeys();
      return;
    }
    const pattern = await handler(forward, editor);
    if (pattern === undefined || pattern === '') {
      this.clearPending();
      this.resetActionKeys();
      return;
    }
    this.search = { pattern, forward, wholeWord: false };
    await this.gotoMatch(editor, forward ? 1 : -1, 1);
  }

  private computeSearchMatches(editor: EditorContext): Array<{ start: number; end: number }> {
    const search = this.search;
    if (!search || search.pattern.length === 0) return [];
    const text = editor.getText();
    const isBoundary = (ch: string | undefined): boolean => ch === undefined || !/\w/.test(ch);
    const out: Array<{ start: number; end: number }> = [];
    let idx = text.indexOf(search.pattern);
    while (idx !== -1) {
      const end = idx + search.pattern.length;
      if (!search.wholeWord || (isBoundary(text[idx - 1]) && isBoundary(text[end]))) {
        out.push({ start: idx, end });
      }
      idx = text.indexOf(search.pattern, end);
    }
    return out;
  }

  private async gotoMatch(editor: EditorContext, direction: 1 | -1, count: number): Promise<void> {
    if (this.search === undefined) {
      this.resetActionKeys();
      return;
    }
    const matches = this.computeSearchMatches(editor);
    if (matches.length === 0) {
      this.notifySearchUpdate(editor, [], -1);
      this.clearPending();
      this.resetActionKeys();
      return;
    }
    const cur = editor.offsetAt(this.cursor(editor));
    let idx: number;
    if (direction === 1) {
      const base = matches.findIndex((m) => m.start > cur);
      idx = ((base === -1 ? 0 : base) + count - 1) % matches.length;
    } else {
      let base = -1;
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i].start < cur) {
          base = i;
          break;
        }
      }
      const startIdx = base === -1 ? matches.length - 1 : base;
      idx = (((startIdx - (count - 1)) % matches.length) + matches.length) % matches.length;
    }
    const target = editor.positionAt(matches[idx].start);
    if (this.pendingOp === undefined) this.recordJump(this.cursor(editor));
    // Routed through runMotion so `d/pattern` works and the cursor clamp applies.
    await this.runMotion(editor, () => ({ position: target }));
    this.notifySearchUpdate(editor, matches, idx);
  }

  private notifySearchUpdate(
    editor: EditorContext,
    matches: Array<{ start: number; end: number }>,
    activeIndex: number,
  ): void {
    if (!this.onSearchUpdate) return;
    this.onSearchUpdate(
      matches.map((m) => ({ start: editor.positionAt(m.start), end: editor.positionAt(m.end) })),
      activeIndex,
      editor,
    );
  }

  private clearPending(): void {
    this.preCount = '';
    this.postCount = '';
    this.pendingOp = undefined;
    this.pendingTO = undefined;
    this.pendingG = false;
    this.pendingFind = undefined;
  }

  private effectiveCount(): number {
    return (this.preCount === '' ? 1 : parseInt(this.preCount, 10)) *
           (this.postCount === '' ? 1 : parseInt(this.postCount, 10));
  }

  private hasCount(): boolean {
    return this.preCount !== '' || this.postCount !== '';
  }

  // ── main dispatch ──────────────────────────────────────────────────────────

  private async handleKey(key: string, editor: EditorContext): Promise<void> {
    // Every key joins the in-progress action (for `.` recording) unless we
    // are the ones replaying it.
    if (!this.replaying) this.pendingActionKeys.push(key);

    // 0a. Macro recording: capture everything; a second `q` stops (and is not
    // itself recorded).
    if (this.recordingMacro !== undefined && !this.replayingMacro) {
      if (key === 'q') {
        this.macros[this.recordingMacro] = [...this.macroKeys];
        this.lastMacroRegister = this.recordingMacro;
        this.recordingMacro = undefined;
        this.macroKeys = [];
        this.resetActionKeys();
        return;
      }
      // '<esc>' is captured by handleEscape (all escape paths funnel there),
      // so pushing it here too would record it twice.
      if (key !== '<esc>') this.macroKeys.push(key);
    }

    // 0aa. `r` was pressed: the next key replaces the char under the cursor.
    if (this.awaitReplace) {
      this.awaitReplace = false;
      const char = canonicalToChar(key);
      if (char !== undefined && char !== '\n') {
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.replaceVisualSelection(editor, char);
        } else {
          await this.replaceChar(editor, char);
        }
      } else {
        this.resetActionKeys();
      }
      return;
    }

    // 0ab. `z` was pressed: zz/zt/zb scroll commands.
    if (this.awaitZ) {
      this.awaitZ = false;
      const kind = key === 'z' ? 'center' : key === 't' ? 'top' : key === 'b' ? 'bottom' : undefined;
      if (kind !== undefined) this.scrollHandler?.(kind, editor);
      this.resetActionKeys();
      return;
    }

    // 0b. `q`/`@` was pressed: the next key names the macro register.
    if (this.awaitMacroRegister !== undefined) {
      const kind = this.awaitMacroRegister;
      this.awaitMacroRegister = undefined;
      const reg = key === '@' ? this.lastMacroRegister : key;
      if (reg === undefined || reg === null || !/^[a-z]$/.test(reg)) {
        this.resetActionKeys();
        return;
      }
      if (kind === 'record') {
        this.recordingMacro = reg;
        this.macroKeys = [];
        this.resetActionKeys();
      } else {
        const count = this.hasCount() ? this.effectiveCount() : 1;
        this.clearPending();
        await this.replayMacro(reg, editor, count);
      }
      return;
    }

    // 1. A find-char motion is waiting for its target character.
    if (this.pendingFind !== undefined) {
      const kind = this.pendingFind;
      this.pendingFind = undefined;
      const char = canonicalToChar(key);
      if (char === undefined || char === '\n') {
        this.clearPending();
        return;
      }
      const arg: FindArg = {
        char,
        forward: kind === 'f' || kind === 't',
        till: kind === 't' || kind === 'T',
      };
      this.lastFind = arg;
      await this.runMotion(editor, (e, from, count) => motions.findChar(e, from, count, arg));
      return;
    }

    // 1b. `"` was pressed: the next key names a register.
    if (this.awaitRegisterName) {
      this.awaitRegisterName = false;
      if (/^[a-z0-9"+]$/.test(key)) this.pendingRegister = key;
      else this.resetActionKeys();
      return;
    }

    // 1c. `m` was pressed: the next key names a mark to set.
    if (this.awaitMarkSet) {
      this.awaitMarkSet = false;
      if (/^[a-z]$/.test(key)) this.marks[key] = this.cursor(editor);
      this.resetActionKeys();
      return;
    }

    // 1d. `'` or "`" was pressed: the next key names a mark to jump to.
    if (this.awaitMarkJump !== undefined) {
      const jump = this.awaitMarkJump;
      this.awaitMarkJump = undefined;
      const target =
        key === "'" || key === '`'
          ? this.previousPos
          : this.marks[key];
      if (target === undefined) {
        this.clearPending();
        this.resetActionKeys();
        return;
      }
      this.previousPos = this.cursor(editor);
      this.recordJump(this.cursor(editor));
      const linewise = jump === "'";
      await this.runMotion(editor, (e, _from, _count) => ({
        position: linewise
          ? { line: target.line, character: firstNonBlankChar(e, target.line) }
          : target,
        linewise,
      }));
      return;
    }

    // 2. Count digits (0 is a motion when no count is in progress).
    if (/^[0-9]$/.test(key) && !(key === '0' && !this.hasCount())) {
      if (this.pendingOp !== undefined) this.postCount += key;
      else this.preCount += key;
      return;
    }

    // 3. Pending `g` prefix (gg; other g-bindings live in the router's trie).
    if (this.pendingG) {
      this.pendingG = false;
      if (key === 'g') await this.runMotion(editor, motions.gotoTop);
      else if (key === 'j' || key === 'k') {
        // gj/gk: ALWAYS display-line movement (counts allowed).
        const count = this.hasCount() ? this.effectiveCount() : 1;
        await this.moveVisual(editor, key === 'j' ? count : -count);
      } else this.clearPending();
      return;
    }

    // 4. Pending text-object char (we have operator + i/a already).
    if (this.pendingTO !== undefined) {
      const around = this.pendingTO === 'a';
      this.pendingTO = undefined;
      await this.runTextObject(editor, key, around);
      return;
    }

    // 5. Regular keys.
    switch (key) {
      case '<esc>':
        await this.handleEscape(editor);
        return;

      case 'v':
        await this.toggleVisual(editor, false);
        return;
      case 'V':
        await this.toggleVisual(editor, true);
        return;

      case 'd':
      case 'c':
      case 'y':
      case '>':
      case '<':
        await this.onOperatorKey(editor, key);
        return;

      case 'i':
      case 'a':
        if (this.pendingOp !== undefined) {
          this.pendingTO = key;
          return;
        }
        // Visual-mode text object (viw, va{, vip, …): i/a is an object
        // prefix, NOT an insert command.
        if (this.modeManager.is('Visual', 'VisualLine')) {
          this.pendingTO = key;
          return;
        }
        await this.enterInsert(editor, key);
        return;

      case 'I': {
        const cur = this.cursor(editor);
        editor.setSelections([cursorAt({ line: cur.line, character: firstNonBlankChar(editor, cur.line) })]);
        this.modeManager.transition('Insert');
        this.beginInsertSession();
        return;
      }
      case 'A': {
        const cur = this.cursor(editor);
        editor.setSelections([cursorAt({ line: cur.line, character: editor.getLine(cur.line).length })]);
        this.modeManager.transition('Insert');
        this.beginInsertSession();
        return;
      }
      case 'o':
      case 'O':
        if (this.modeManager.is('Visual', 'VisualLine')) {
          // vim: o/O in visual mode jumps the cursor to the other end of
          // the selection (swapping anchor and active).
          const sel = editor.getSelections()[0];
          editor.setSelections([{ anchor: sel.active, active: sel.anchor }]);
          editor.revealPrimaryCursor();
          this.clearPending();
          this.resetActionKeys();
          return;
        }
        await this.openLine(editor, key === 'o');
        return;

      case 'x':
        // Visual x: delete the selection (same as d).
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.onOperatorKey(editor, 'd');
          return;
        }
        await this.deleteChars(editor, 1);
        return;
      case 'X':
        // Visual X: delete the selected LINES (same as D).
        if (this.modeManager.is('Visual', 'VisualLine')) {
          const { range } = this.visualRange(editor, true);
          this.clearPending();
          await this.applyOperatorToRange(editor, 'd', range, true);
          return;
        }
        await this.deleteChars(editor, -1);
        return;
      case 's':
        // Visual s: change the selection (same as c).
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.onOperatorKey(editor, 'c');
          return;
        }
        await this.changeChars(editor);
        return;

      case 'D':
        // Visual D: delete the selected lines linewise.
        if (this.modeManager.is('Visual', 'VisualLine')) {
          const { range } = this.visualRange(editor, true);
          this.clearPending();
          await this.applyOperatorToRange(editor, 'd', range, true);
          return;
        }
        await this.operateWithMotion(editor, 'd', motions.lineEnd);
        return;
      case 'C':
        // Visual C: change the selected lines linewise.
        if (this.modeManager.is('Visual', 'VisualLine')) {
          const { range } = this.visualRange(editor, true);
          this.clearPending();
          await this.applyOperatorToRange(editor, 'c', range, true);
          return;
        }
        await this.operateWithMotion(editor, 'c', motions.lineEnd);
        return;
      case 'Y':
        // Visual Y: yank the selected lines linewise.
        if (this.modeManager.is('Visual', 'VisualLine')) {
          const { range } = this.visualRange(editor, true);
          this.clearPending();
          await this.applyOperatorToRange(editor, 'y', range, true);
          return;
        }
        await this.linewiseOperator(editor, 'y');
        return;

      case 'p':
      case 'P':
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.pasteOverSelection(editor);
          return;
        }
        await this.paste(editor, key === 'p');
        return;

      case 'f':
      case 'F':
      case 't':
      case 'T':
        this.pendingFind = key;
        return;
      case ';':
        if (this.lastFind) {
          const arg = this.lastFind;
          await this.runMotion(editor, (e, from, count) => motions.findChar(e, from, count, arg));
        }
        return;
      case ',':
        if (this.lastFind) {
          const arg: FindArg = { ...this.lastFind, forward: !this.lastFind.forward };
          await this.runMotion(editor, (e, from, count) => motions.findChar(e, from, count, arg));
        }
        return;

      case 'g':
        this.pendingG = true;
        return;

      case 'r':
        this.awaitReplace = true;
        return;

      case '~':
        await this.toggleCase(editor);
        return;

      case 'u':
        // Visual u: lowercase the selection (Normal-mode undo lives in the
        // keymap table → native `undo`, so the engine only ever sees this
        // in Visual/VisualLine).
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.transformVisualCase(editor, 'lower');
          return;
        }
        this.resetActionKeys();
        return;
      case 'U':
        // Visual U: uppercase the selection.
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.transformVisualCase(editor, 'upper');
          return;
        }
        this.resetActionKeys();
        return;

      case 'J':
        if (this.modeManager.is('Visual', 'VisualLine')) {
          await this.joinVisualLines(editor);
          return;
        }
        await this.joinLines(editor);
        return;

      case 'z':
        this.awaitZ = true;
        return;

      case '<C-o>':
        await this.jump(editor, -1);
        return;
      case '<C-i>':
        await this.jump(editor, 1);
        return;

      case '<C-d>':
        await this.pageScroll(editor, 1, false);
        return;
      case '<C-u>':
        await this.pageScroll(editor, -1, false);
        return;
      case '<C-f>':
        await this.pageScroll(editor, 1, true);
        return;
      case '<C-b>':
        await this.pageScroll(editor, -1, true);
        return;

      case '"':
        this.awaitRegisterName = true;
        return;

      case 'm':
        this.awaitMarkSet = true;
        return;

      case "'":
      case '`':
        this.awaitMarkJump = key;
        return;

      case '.':
        await this.repeatLastChange(editor);
        return;

      case 'q':
        // (stopping an active recording is handled at the top of handleKey)
        this.awaitMacroRegister = 'record';
        return;

      case '@':
        this.awaitMacroRegister = 'replay';
        return;

      case '/':
        await this.promptSearch(editor, true);
        return;
      case '?':
        await this.promptSearch(editor, false);
        return;
      case 'n': {
        const dir = this.search !== undefined && !this.search.forward ? -1 : 1;
        const count = this.hasCount() ? this.effectiveCount() : 1;
        this.clearPending();
        await this.gotoMatch(editor, dir, count);
        return;
      }
      case 'N': {
        const dir = this.search !== undefined && !this.search.forward ? 1 : -1;
        const count = this.hasCount() ? this.effectiveCount() : 1;
        this.clearPending();
        await this.gotoMatch(editor, dir, count);
        return;
      }
      case '*':
      case '#': {
        const obj = wordObject(editor, this.cursor(editor), false);
        if (!obj) {
          this.resetActionKeys();
          return;
        }
        this.search = { pattern: editor.getText(obj), forward: key === '*', wholeWord: true };
        const count = this.hasCount() ? this.effectiveCount() : 1;
        this.clearPending();
        await this.gotoMatch(editor, key === '*' ? 1 : -1, count);
        return;
      }

      default:
        // LazyVim: j/k are gj/gk (display lines) when no count is given;
        // with a count or an operator pending they stay logical.
        if ((key === 'j' || key === 'k') && this.useVisualLineMotion()) {
          await this.moveVisual(editor, key === 'j' ? 1 : -1);
          return;
        }
        if (key in MOTIONS) {
          await this.runMotion(editor, MOTIONS[key]);
          return;
        }
        // Unknown key: vim does nothing. Drop any pending operator.
        if (!/^[0-9]$/.test(key)) {
          this.clearPending();
          this.resetActionKeys();
        }
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private cursor(editor: EditorContext): Position {
    return editor.getSelections()[0].active;
  }

  private moveCursor(editor: EditorContext, pos: Position): void {
    editor.setSelections([cursorAt(clampNormalCursor(editor, pos))]);
    editor.revealPrimaryCursor();
  }

  /**
   * Run a motion in whatever context we're in:
   *   operator pending → operate over [cursor, motion-target]
   *   visual mode      → extend the selection
   *   normal mode      → move the cursor
   */
  private async runMotion(
    editor: EditorContext,
    fn: motions.MotionFn,
  ): Promise<void> {
    // Vim quirk: `cw` behaves like `ce` (does not include trailing space).
    if (this.pendingOp === 'c' && fn === motions.wordForward) {
      fn = motions.wordEnd;
    }
    const count = this.effectiveCount();
    const from = this.cursor(editor);

    // Vertical motions remember the desired column.
    let motionFrom = from;
    const isVertical = fn === motions.down || fn === motions.up;
    if (isVertical && this.desiredCol !== undefined) {
      motionFrom = { ...from, character: this.desiredCol };
    }

    // Jumplist-worthy motions record the pre-jump position (vim: G, gg, %,
    // {, }, H, M, L are jumps; <C-d>/<C-u>/<C-f>/<C-b> are NOT).
    const isJump =
      fn === motions.gotoTop ||
      fn === motions.gotoBottom ||
      fn === motions.bracketMatch ||
      fn === motions.paragraphForward ||
      fn === motions.paragraphBackward ||
      fn === motions.screenHigh ||
      fn === motions.screenMiddle ||
      fn === motions.screenLow;
    if (isJump && this.modeManager.is('Normal') && this.pendingOp === undefined) {
      this.recordJump(from);
    }

    const result = fn(editor, motionFrom, this.hasCount() ? count : 0);

    if (fn !== motions.down && fn !== motions.up) this.desiredCol = undefined;
    else if (this.desiredCol === undefined) this.desiredCol = from.character;

    if (!result) {
      this.clearPending();
      this.resetActionKeys();
      return;
    }

    if (this.pendingOp !== undefined) {
      const op = this.pendingOp;
      this.clearPending();
      await this.applyOperator(editor, op, from, result);
      return;
    }

    if (this.modeManager.is('Visual', 'VisualLine')) {
      const sel = editor.getSelections()[0];
      const target = this.modeManager.is('VisualLine')
        ? { line: result.position.line, character: 0 }
        : result.position;
      editor.setSelections([{ anchor: sel.anchor, active: target }]);
      editor.revealPrimaryCursor();
      this.clearPending(); // consume the count — do not leak it into the next action
      return; // visual selection continues — action not finished yet
    }

    this.moveCursor(editor, result.position);
    this.clearPending(); // consume the count
    this.resetActionKeys(); // plain motion: not a repeatable change
  }

  /** Convert a motion result into [range, linewise] relative to `from`. */
  private motionToRange(from: Position, result: MotionResult): { range: Range; linewise: boolean } {
    if (result.linewise) {
      let s = Math.min(from.line, result.position.line);
      let en = Math.max(from.line, result.position.line);
      // Exclusive linewise (explicit `inclusive: false`, e.g. { }): the
      // landing line is NOT part of the operated range. Motions with the
      // flag undefined (j/k/gg/G/H/M/L) stay inclusive, matching vim.
      if (result.inclusive === false) {
        if (result.position.line > from.line) en = Math.max(s, en - 1);
        else if (result.position.line < from.line) s = Math.min(en, s + 1);
      }
      return {
        range: { start: { line: s, character: 0 }, end: { line: en, character: 0 } },
        linewise: true,
      };
    }
    const backward =
      result.position.line < from.line ||
      (result.position.line === from.line && result.position.character < from.character);
    const start = backward ? result.position : from;
    const endAnchor = backward ? from : result.position;
    const end: Position = result.inclusive
      ? { line: endAnchor.line, character: endAnchor.character + 1 }
      : { ...endAnchor };
    return { range: { start, end }, linewise: false };
  }

  private async applyOperator(
    editor: EditorContext,
    op: Operator,
    from: Position,
    motion: MotionResult,
  ): Promise<void> {
    const { range, linewise } = this.motionToRange(from, motion);
    await this.applyOperatorToRange(editor, op, range, linewise);
  }

  private async applyOperatorToRange(
    editor: EditorContext,
    op: Operator,
    range: Range,
    linewise: boolean,
  ): Promise<void> {
    if (op === '>' || op === '<') {
      await this.indentRange(editor, range, op === '>');
      return;
    }
    const compute =
      op === 'd' ? computeDelete : op === 'c' ? computeChange : computeYank;
    const outcome: OperatorOutcome = compute(editor, range, linewise);

    if (outcome.edits.length > 0) await editor.applyEdits(outcome.edits);
    if (outcome.register) {
      // `"xy` writes to register x AND the unnamed register (vim behavior);
      // yanks also populate the yank register `"0` (deletes/changes do not).
      const name = this.pendingRegister ?? '"';
      this.registers[name] = outcome.register;
      if (name !== '"') this.registers['"'] = outcome.register;
      if (op === 'y') this.registers['0'] = outcome.register;
    }

    const cursor = outcome.enterInsert
      ? outcome.cursor
      : clampNormalCursor(editor, outcome.cursor);
    editor.setSelections([cursorAt(cursor)]);
    editor.revealPrimaryCursor();

    if (outcome.enterInsert) {
      this.modeManager.transition('Insert');
      this.beginInsertSession();
    } else {
      if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
      if (op === 'y') this.resetActionKeys(); // yank is not a repeatable change
      else if (!this.replaying) this.finalizeChange(); // guard: replay must not clobber lastChange
    }
  }

  private async operateWithMotion(
    editor: EditorContext,
    op: Operator,
    fn: motions.MotionFn,
  ): Promise<void> {
    const result = fn(editor, this.cursor(editor), this.hasCount() ? this.effectiveCount() : 0);
    this.clearPending();
    if (result) await this.applyOperator(editor, op, this.cursor(editor), result);
  }

  // ── operators ──────────────────────────────────────────────────────────────

  private async onOperatorKey(editor: EditorContext, key: Operator): Promise<void> {
    // Visual mode: operator applies to the selection immediately.
    if (this.modeManager.is('Visual', 'VisualLine')) {
      const linewise = this.modeManager.is('VisualLine');
      const { range } = this.visualRange(editor, linewise);
      this.clearPending();
      await this.applyOperatorToRange(editor, key, range, linewise);
      return;
    }

    // Operator doubling (dd/cc/yy) → linewise on `count` lines.
    // Count must be captured BEFORE clearing pending state.
    if (this.pendingOp === key) {
      const count = this.hasCount() ? this.effectiveCount() : 1;
      this.clearPending();
      await this.linewiseOperator(editor, key, count);
      return;
    }

    // A different operator while one is pending cancels (vim behavior).
    if (this.pendingOp !== undefined) {
      this.clearPending();
      this.resetActionKeys();
      return;
    }

    this.pendingOp = key;
  }

  /** Indent/dedent whole lines by one shift (4 spaces), cursor to first non-blank. */
  private async indentRange(editor: EditorContext, range: Range, right: boolean): Promise<void> {
    const startLine = range.start.line;
    const endLine = range.end.line;
    const edits = [];
    for (let line = startLine; line <= endLine; line++) {
      const text = editor.getLine(line);
      if (right) {
        if (text.length === 0) continue; // vim does not indent empty lines
        edits.push({ kind: 'insert' as const, at: { line, character: 0 }, text: '    ' });
      } else {
        let spaces = 0;
        while (spaces < 4 && spaces < text.length && text[spaces] === ' ') spaces++;
        if (spaces > 0) {
          edits.push({
            kind: 'delete' as const,
            range: { start: { line, character: 0 }, end: { line, character: spaces } },
          });
        }
      }
    }
    if (edits.length > 0) await editor.applyEdits(edits);
    editor.setSelections([
      cursorAt({ line: startLine, character: firstNonBlankChar(editor, startLine) }),
    ]);
    editor.revealPrimaryCursor();
    if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
    if (!this.replaying) this.finalizeChange();
  }

  private async linewiseOperator(editor: EditorContext, op: Operator, count?: number): Promise<void> {
    const n = count ?? (this.hasCount() ? this.effectiveCount() : 1);
    const line = this.cursor(editor).line;
    const endLine = Math.min(line + n - 1, editor.getLineCount() - 1);
    const range: Range = {
      start: { line, character: 0 },
      end: { line: endLine, character: 0 },
    };
    await this.applyOperatorToRange(editor, op, range, true);
  }

  private visualRange(editor: EditorContext, linewise: boolean): { range: Range } {
    const sel = editor.getSelections()[0];
    const s = sel.anchor.line < sel.active.line ||
      (sel.anchor.line === sel.active.line && sel.anchor.character <= sel.active.character)
      ? sel.anchor
      : sel.active;
    const e = s === sel.anchor ? sel.active : sel.anchor;
    if (linewise) {
      return { range: { start: { line: s.line, character: 0 }, end: { line: e.line, character: 0 } } };
    }
    // Charwise visual includes the char under `active`.
    const lineLen = editor.getLine(e.line).length;
    return {
      range: { start: s, end: { line: e.line, character: Math.min(e.character + 1, lineLen) } },
    };
  }

  // ── text objects ───────────────────────────────────────────────────────────

  private async runTextObject(editor: EditorContext, objKey: string, around: boolean): Promise<void> {
    const pos = this.cursor(editor);
    let range: Range | undefined;
    let linewise = false;

    if (objKey === 'w') {
      range = wordObject(editor, pos, around);
    } else if (objKey === '"' || objKey === "'" || objKey === '`') {
      range = quoteObject(editor, pos, objKey, around);
    } else if (objKey in BRACKET_OBJECTS) {
      const [open, close] = BRACKET_OBJECTS[objKey];
      range = bracketObject(editor, pos, open, close, around);
    } else if (objKey === 'p') {
      const para = paragraphObject(editor, pos, around);
      if (para) {
        range = para.range;
        linewise = true;
      }
    }

    if (!range) {
      this.clearPending();
      this.resetActionKeys();
      return;
    }

    const op = this.pendingOp;
    this.clearPending();
    if (op !== undefined) {
      await this.applyOperatorToRange(editor, op, range, linewise);
      return;
    }
    if (this.modeManager.is('Visual', 'VisualLine')) {
      // Visual text object: select the object, stay in Visual. Linewise
      // objects force VisualLine (vim: vip selects whole lines).
      if (linewise) {
        if (!this.modeManager.is('VisualLine')) this.modeManager.transition('VisualLine');
        editor.setSelections([
          { anchor: range.start, active: { line: range.end.line, character: 0 } },
        ]);
      } else {
        if (!this.modeManager.is('Visual')) this.modeManager.transition('Visual');
        // Range end is exclusive; charwise visual includes the active char.
        // When a multi-line range ends at char 0 (e.g. vi{ on `{\n…\n}`), the
        // last included char is the END of the previous line — not the
        // closing-bracket line.
        let active: Position;
        if (editor.offsetAt(range.end) <= editor.offsetAt(range.start)) {
          active = range.start; // empty inner object (e.g. i" in "")
        } else if (range.end.character === 0 && range.end.line > range.start.line) {
          const prev = range.end.line - 1;
          active = { line: prev, character: Math.max(0, editor.getLine(prev).length - 1) };
        } else {
          active = { line: range.end.line, character: Math.max(0, range.end.character - 1) };
        }
        editor.setSelections([{ anchor: range.start, active }]);
      }
      editor.revealPrimaryCursor();
      return; // keep accumulating keys — the visual action is still open
    }
    this.resetActionKeys();
  }

  // ── small editing actions ──────────────────────────────────────────────────

  private async enterInsert(editor: EditorContext, key: 'i' | 'a'): Promise<void> {
    if (key === 'a') {
      const cur = this.cursor(editor);
      const len = editor.getLine(cur.line).length;
      if (len > 0) {
        editor.setSelections([cursorAt({ line: cur.line, character: Math.min(cur.character + 1, len) })]);
      }
    }
    this.clearPending();
    this.modeManager.transition('Insert');
    this.beginInsertSession();
  }

  private async openLine(editor: EditorContext, below: boolean): Promise<void> {
    const cur = this.cursor(editor);
    const len = editor.getLine(cur.line).length;
    if (below) {
      await editor.applyEdits([{ kind: 'insert', at: { line: cur.line, character: len }, text: '\n' }]);
      editor.setSelections([cursorAt({ line: cur.line + 1, character: 0 })]);
    } else {
      await editor.applyEdits([{ kind: 'insert', at: { line: cur.line, character: 0 }, text: '\n' }]);
      editor.setSelections([cursorAt({ line: cur.line, character: 0 })]);
    }
    this.modeManager.transition('Insert');
    this.beginInsertSession();
  }

  private async deleteChars(editor: EditorContext, direction: 1 | -1): Promise<void> {
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    const cur = this.cursor(editor);
    const len = editor.getLine(cur.line).length;
    if (len === 0) return;
    const range: Range =
      direction === 1
        ? { start: cur, end: { line: cur.line, character: Math.min(cur.character + count, len) } }
        : { start: { line: cur.line, character: Math.max(0, cur.character - count) }, end: cur };
    if (range.start.character === range.end.character && range.start.line === range.end.line) return;
    await this.applyOperatorToRange(editor, 'd', range, false);
  }

  private async changeChars(editor: EditorContext): Promise<void> {
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    const cur = this.cursor(editor);
    const len = editor.getLine(cur.line).length;
    const range: Range = {
      start: cur,
      end: { line: cur.line, character: Math.min(cur.character + count, len) },
    };
    await this.applyOperatorToRange(editor, 'c', range, false);
  }

  private async paste(editor: EditorContext, after: boolean): Promise<void> {
    const reg = this.registers[this.pendingRegister ?? '"'];
    if (!reg) {
      this.resetActionKeys();
      return;
    }
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    const cur = this.cursor(editor);

    if (reg.linewise) {
      const body = reg.text.endsWith('\n') ? reg.text.slice(0, -1) : reg.text;
      const text = body.repeat(count);
      if (after) {
        const len = editor.getLine(cur.line).length;
        await editor.applyEdits([{ kind: 'insert', at: { line: cur.line, character: len }, text: '\n' + text }]);
        const line = cur.line + 1;
        editor.setSelections([cursorAt({ line, character: firstNonBlankChar(editor, line) })]);
      } else {
        const chunks = Array.from({ length: count }, () => body).join('\n');
        await editor.applyEdits([{ kind: 'insert', at: { line: cur.line, character: 0 }, text: chunks + '\n' }]);
        editor.setSelections([cursorAt({ line: cur.line, character: firstNonBlankChar(editor, cur.line) })]);
      }
    } else {
      const text = reg.text.repeat(count);
      const atChar = after ? Math.min(cur.character + 1, editor.getLine(cur.line).length) : cur.character;
      await editor.applyEdits([{ kind: 'insert', at: { line: cur.line, character: atChar }, text }]);
      editor.setSelections([cursorAt(clampNormalCursor(editor, { line: cur.line, character: atChar + text.length - 1 }))]);
    }
    editor.revealPrimaryCursor();
    if (!this.replaying) this.finalizeChange();
  }

  /** LazyVim j/k rule: display lines only with no count and no pending operator. */
  private useVisualLineMotion(): boolean {
    return !this.hasCount() && this.pendingOp === undefined && !this.modeManager.is('VisualLine');
  }

  /** Display-line movement (gj/gk semantics); VSCode tracks the goal column itself. */
  private async moveVisual(editor: EditorContext, delta: number): Promise<void> {
    const select = this.modeManager.is('Visual');
    await editor.moveVisualLine(delta, select);
    if (!select) {
      // Keep the Normal-mode cursor clamped onto a real character.
      const cur = this.cursor(editor);
      editor.setSelections([cursorAt(clampNormalCursor(editor, cur))]);
    }
    editor.revealPrimaryCursor();
    this.clearPending();
    this.resetActionKeys(); // motion, not a repeatable change
  }

  // ── misc actions (r, ~, J, jumplist) ──────────────────────────────────────

  private async replaceChar(editor: EditorContext, char: string): Promise<void> {
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    const cur = this.cursor(editor);
    const len = editor.getLine(cur.line).length;
    if (cur.character + count > len) {
      this.resetActionKeys();
      return; // vim fails silently past end of line
    }
    await editor.applyEdits([
      {
        kind: 'replace',
        range: { start: cur, end: { line: cur.line, character: cur.character + count } },
        text: char.repeat(count),
      },
    ]);
    this.finalizeChange();
  }

  private async toggleCase(editor: EditorContext): Promise<void> {
    if (this.modeManager.is('Visual', 'VisualLine')) {
      await this.transformVisualCase(editor, 'swap');
      return;
    }
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();
    const cur = this.cursor(editor);
    const line = editor.getLine(cur.line);
    if (cur.character >= line.length) {
      this.resetActionKeys();
      return;
    }
    const end = Math.min(cur.character + count, line.length);
    const flipped = [...line.slice(cur.character, end)]
      .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
      .join('');
    await editor.applyEdits([
      { kind: 'replace', range: { start: cur, end: { line: cur.line, character: end } }, text: flipped },
    ]);
    // Vim moves to the next char (clamped at line end).
    editor.setSelections([cursorAt(clampNormalCursor(editor, { line: cur.line, character: end }))]);
    this.finalizeChange();
  }

  private async joinLines(editor: EditorContext): Promise<void> {
    const count = this.hasCount() ? Math.max(1, this.effectiveCount()) : 1;
    this.clearPending();
    const cur = this.cursor(editor);
    await this.joinLineRange(editor, cur.line, cur.line + count);
  }

  /** Join [startLine, endLineInclusive] into startLine, vim-style. */
  private async joinLineRange(
    editor: EditorContext,
    startLine: number,
    endLineInclusive: number,
  ): Promise<void> {
    const lineCount = editor.getLineCount();
    if (startLine >= lineCount - 1) {
      this.resetActionKeys();
      return; // last line: J does nothing
    }
    const joins = Math.min(endLineInclusive - startLine, lineCount - 1 - startLine);
    const edits = [];
    for (let i = 0; i < joins; i++) {
      const line = startLine + i;
      const nextLine = line + 1;
      const thisLen = editor.getLine(line).length;
      const nextText = editor.getLine(nextLine);
      const trimmed = nextText.trimStart();
      edits.push({
        kind: 'replace' as const,
        range: {
          start: { line, character: thisLen },
          end: { line: nextLine, character: nextText.length - trimmed.length },
        },
        text: trimmed.length === 0 ? '' : ' ',
      });
    }
    await editor.applyEdits(edits);
    if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
    this.finalizeChange();
  }

  /** Visual J: join every line covered by the selection. */
  private async joinVisualLines(editor: EditorContext): Promise<void> {
    const { range } = this.visualRange(editor, true);
    this.clearPending();
    // A single-line selection behaves like Normal J (joins the next line).
    const last = Math.max(range.end.line, range.start.line + 1);
    await this.joinLineRange(editor, range.start.line, last);
  }

  /**
   * Visual r{char}: overwrite every selected character with `char`
   * (newlines are preserved). One edit batch, exits to Normal.
   */
  private async replaceVisualSelection(editor: EditorContext, char: string): Promise<void> {
    const { range } = this.visualRange(editor, this.modeManager.is('VisualLine'));
    this.clearPending();
    const edits = [];
    for (let line = range.start.line; line <= range.end.line; line++) {
      const len = editor.getLine(line).length;
      const from = line === range.start.line ? range.start.character : 0;
      const to = line === range.end.line ? Math.min(range.end.character, len) : len;
      if (to > from) {
        edits.push({
          kind: 'replace' as const,
          range: { start: { line, character: from }, end: { line, character: to } },
          text: char.repeat(to - from),
        });
      }
    }
    if (edits.length === 0) {
      this.resetActionKeys();
      return;
    }
    await editor.applyEdits(edits);
    editor.setSelections([cursorAt(clampNormalCursor(editor, range.start))]);
    editor.revealPrimaryCursor();
    if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
    this.finalizeChange();
  }

  /**
   * Visual ~ / u / U: swap case, lowercase, or uppercase the selection.
   * One edit batch per line, cursor to selection start, exits to Normal.
   */
  private async transformVisualCase(
    editor: EditorContext,
    how: 'swap' | 'lower' | 'upper',
  ): Promise<void> {
    const { range } = this.visualRange(editor, this.modeManager.is('VisualLine'));
    this.clearPending();
    const edits = [];
    for (let line = range.start.line; line <= range.end.line; line++) {
      const len = editor.getLine(line).length;
      const from = line === range.start.line ? range.start.character : 0;
      const to = line === range.end.line ? Math.min(range.end.character, len) : len;
      if (to <= from) continue;
      const src = editor.getLine(line).slice(from, to);
      const out =
        how === 'lower'
          ? src.toLowerCase()
          : how === 'upper'
            ? src.toUpperCase()
            : [...src]
                .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
                .join('');
      if (out !== src) {
        edits.push({
          kind: 'replace' as const,
          range: { start: { line, character: from }, end: { line, character: to } },
          text: out,
        });
      }
    }
    if (edits.length > 0) await editor.applyEdits(edits);
    editor.setSelections([cursorAt(clampNormalCursor(editor, range.start))]);
    editor.revealPrimaryCursor();
    if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
    this.finalizeChange();
  }

  /**
   * Visual p/P: replace the selection with the register's contents (vim
   * puts the deleted selection into the unnamed register in the process).
   * One edit batch, exits to Normal.
   */
  private async pasteOverSelection(editor: EditorContext): Promise<void> {
    const reg = this.registers[this.pendingRegister ?? '"'];
    if (!reg) {
      this.clearPending();
      this.resetActionKeys();
      return;
    }
    const linewise = this.modeManager.is('VisualLine');
    const { range } = this.visualRange(editor, linewise);
    const deletedText = editor.getText(range) + (linewise ? '\n' : '');
    this.clearPending();

    // Batch order matters: deletes are applied before inserts at the same
    // position (positions refer to the pre-edit document in both adapters).
    const edits: TextEdit[] = [{ kind: 'delete', range }];
    let cursor: Position;
    if (reg.linewise) {
      const body = reg.text.endsWith('\n') ? reg.text : reg.text + '\n';
      edits.push({ kind: 'insert', at: { line: range.start.line, character: 0 }, text: body });
      const firstLine = body.split('\n')[0];
      cursor = {
        line: range.start.line,
        character: Math.max(0, firstLine.length - firstLine.trimStart().length),
      };
    } else {
      edits.push({ kind: 'insert', at: range.start, text: reg.text });
      const lines = reg.text.split('\n');
      cursor =
        lines.length === 1
          ? { line: range.start.line, character: range.start.character + reg.text.length - 1 }
          : {
              line: range.start.line + lines.length - 1,
              character: Math.max(0, lines[lines.length - 1].length - 1),
            };
    }
    await editor.applyEdits(edits);
    this.registers['"'] = { text: deletedText, linewise };
    editor.setSelections([cursorAt(clampNormalCursor(editor, cursor))]);
    editor.revealPrimaryCursor();
    if (this.modeManager.is('Visual', 'VisualLine')) this.modeManager.transition('Normal');
    if (!this.replaying) this.finalizeChange();
  }

  /**
   * <C-d>/<C-u> half-page, <C-f>/<C-b> full-page scrolling. The cursor moves
   * by the scroll amount and the view scrolls with it, so the cursor keeps
   * its screen row (vim behavior). With a pending operator these degrade to
   * a plain linewise motion (no scrolling), matching j/k with operators.
   */
  private async pageScroll(editor: EditorContext, direction: 1 | -1, fullPage: boolean): Promise<void> {
    const count = this.hasCount() ? this.effectiveCount() : 1;
    const { start, end } = editor.getVisibleLineRange();
    const height = Math.max(1, end - start + 1);
    const page = fullPage ? Math.max(1, height - 2) : Math.max(1, Math.floor(height / 2));
    const amount = page * count;
    const from = this.cursor(editor);
    const last = editor.getLineCount() - 1;
    const targetLine = Math.max(0, Math.min(last, from.line + direction * amount));

    if (this.pendingOp !== undefined) {
      const op = this.pendingOp;
      this.clearPending();
      await this.applyOperator(editor, op, from, {
        position: { line: targetLine, character: 0 },
        linewise: true,
      });
      return;
    }

    // Scroll BEFORE moving the cursor: an equal scroll keeps the cursor on
    // its screen row (vim), and moveCursor's reveal then has nothing to do.
    // (Reverse order would double-scroll: reveal follows the cursor, then
    // the scroll would push it off-screen.)
    editor.scrollLines(targetLine - from.line);

    if (this.modeManager.is('Visual', 'VisualLine')) {
      const sel = editor.getSelections()[0];
      const target = this.modeManager.is('VisualLine')
        ? { line: targetLine, character: 0 }
        : { line: targetLine, character: from.character };
      editor.setSelections([{ anchor: sel.anchor, active: target }]);
      editor.revealPrimaryCursor();
      this.clearPending(); // consume the count; visual selection continues
      return;
    }

    this.moveCursor(editor, { line: targetLine, character: from.character });
    this.clearPending(); // consume the count
    this.resetActionKeys(); // scroll is a motion, not a repeatable change
  }

  // ── jumplist ───────────────────────────────────────────────────────────────
  //
  // Model: `jumplist` holds jump ORIGINS. `jumpIndex === -1` means the user
  // is at the "live" position (not on a list entry). The first <C-o> from the
  // live position snapshots it onto the list, then walks backward; <C-i>
  // walks forward. A new jump after walking back truncates forward entries.

  private recordJump(pos: Position): void {
    if (this.jumpIndex >= 0) {
      // User had jumped back: a fresh jump drops the "future" entries.
      this.jumplist.length = this.jumpIndex + 1;
    }
    const last = this.jumplist[this.jumplist.length - 1];
    if (last === undefined || last.line !== pos.line || last.character !== pos.character) {
      this.jumplist.push(pos);
      if (this.jumplist.length > 100) this.jumplist.shift();
    }
    this.jumpIndex = -1; // after the jump lands, the user is at the live position
  }

  private async jump(editor: EditorContext, direction: -1 | 1): Promise<void> {
    const count = this.hasCount() ? this.effectiveCount() : 1;
    this.clearPending();

    if (direction === -1) {
      if (this.jumplist.length === 0) {
        this.resetActionKeys();
        return;
      }
      if (this.jumpIndex === -1) {
        // Snapshot the live position so <C-i> can return to it.
        const live = this.cursor(editor);
        const last = this.jumplist[this.jumplist.length - 1];
        if (last === undefined || last.line !== live.line || last.character !== live.character) {
          this.jumplist.push(live);
        }
        this.jumpIndex = this.jumplist.length - 1;
      }
      const target = this.jumpIndex - count;
      if (target < 0) {
        this.resetActionKeys();
        return; // vim stays put at the oldest entry
      }
      this.jumpIndex = target;
    } else {
      if (this.jumpIndex === -1) {
        this.resetActionKeys();
        return; // already at the live position
      }
      const target = this.jumpIndex + count;
      if (target >= this.jumplist.length) {
        this.resetActionKeys();
        return;
      }
      this.jumpIndex = target;
    }

    const entry = this.jumplist[this.jumpIndex];
    editor.setSelections([cursorAt(clampNormalCursor(editor, entry))]);
    editor.revealPrimaryCursor();
    this.resetActionKeys();
  }

  // ── visual mode ────────────────────────────────────────────────────────────

  private async toggleVisual(editor: EditorContext, linewise: boolean): Promise<void> {
    this.clearPending();
    const cur = this.cursor(editor);

    if (this.modeManager.is('Normal')) {
      editor.setSelections([{ anchor: cur, active: cur }]);
      this.modeManager.transition(linewise ? 'VisualLine' : 'Visual');
      return; // keep accumulating keys — a visual change records from `v`
    }
    // v/V inside visual mode exits back to Normal (toggle behavior).
    const sel = editor.getSelections()[0];
    editor.setSelections([cursorAt(clampNormalCursor(editor, sel.active))]);
    this.modeManager.transition('Normal');
    this.resetActionKeys();
  }
}
