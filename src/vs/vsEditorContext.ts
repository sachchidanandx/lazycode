import * as vscode from 'vscode';
import { EditorContext } from '../core/editorContext';
import { Position, Range, Selection, TextEdit } from '../core/types';

const toVsPosition = (p: Position): vscode.Position => new vscode.Position(p.line, p.character);
const toVsRange = (r: Range): vscode.Range => new vscode.Range(toVsPosition(r.start), toVsPosition(r.end));
const fromVsPosition = (p: vscode.Position): Position => ({ line: p.line, character: p.character });

/**
 * Real adapter: the only place (besides extension.ts) that imports vscode.
 */
export class VsEditorContext implements EditorContext {
  constructor(private readonly editor: vscode.TextEditor) {}

  getLineCount(): number {
    return this.editor.document.lineCount;
  }

  getLine(line: number): string {
    return this.editor.document.lineAt(line).text;
  }

  getText(range?: Range): string {
    return range ? this.editor.document.getText(toVsRange(range)) : this.editor.document.getText();
  }

  getSelections(): readonly Selection[] {
    return this.editor.selections.map((s) => ({
      anchor: fromVsPosition(s.anchor),
      active: fromVsPosition(s.active),
    }));
  }

  setSelections(selections: readonly Selection[]): void {
    this.editor.selections = selections.map(
      (s) => new vscode.Selection(toVsPosition(s.anchor), toVsPosition(s.active)),
    );
  }

  /**
   * THE undo-boundary chokepoint: all vim mutations flow through here, each
   * call producing exactly one VSCode undo stop.
   */
  async applyEdits(edits: readonly TextEdit[]): Promise<boolean> {
    return this.editor.edit((builder) => {
      for (const edit of edits) {
        switch (edit.kind) {
          case 'insert':
            builder.insert(toVsPosition(edit.at), edit.text);
            break;
          case 'replace':
            builder.replace(toVsRange(edit.range), edit.text);
            break;
          case 'delete':
            builder.delete(toVsRange(edit.range));
            break;
        }
      }
    });
  }

  offsetAt(pos: Position): number {
    return this.editor.document.offsetAt(toVsPosition(pos));
  }

  positionAt(offset: number): Position {
    return fromVsPosition(this.editor.document.positionAt(offset));
  }

  revealPrimaryCursor(): void {
    const active = this.editor.selection.active;
    this.editor.revealRange(new vscode.Range(active, active));
  }

  /** Viewport in logical lines — backs H/M/L and page-scroll amounts. */
  getVisibleLineRange(): { start: number; end: number } {
    const ranges = this.editor.visibleRanges;
    if (ranges.length === 0) return { start: 0, end: 0 };
    return {
      start: ranges[0].start.line,
      end: ranges[ranges.length - 1].end.line,
    };
  }

  /** View-only scroll (selection untouched); VSCode clamps at document bounds. */
  scrollLines(delta: number): void {
    if (delta === 0) return;
    void vscode.commands.executeCommand('editorScroll', {
      to: delta > 0 ? 'down' : 'up',
      by: 'line',
      value: Math.abs(delta),
    });
  }

  /** Display-line movement via VSCode's own cursor engine (handles wrapping). */
  async moveVisualLine(delta: number, select: boolean): Promise<void> {
    if (delta === 0) return;
    await vscode.commands.executeCommand('cursorMove', {
      to: delta > 0 ? 'down' : 'up',
      by: 'wrappedLine',
      value: Math.abs(delta),
      select,
    });
  }
}
