import * as vscode from 'vscode';
import { WhichKeyItem, whichKeyTitle } from '../lazyvim/whichKeyItems';

export interface WhichKeyPopupDeps {
  /** Milliseconds to wait before showing (fast typists never see it). */
  readonly delay: number;
  readonly resolveItems: (pending: readonly string[]) => WhichKeyItem[];
  /** A character was typed into the popup input — forward to the router. */
  readonly onTyped: (raw: string) => void;
  /** Backspace in the popup — router should drop its last pending key. */
  readonly onBackspace: () => void;
  /** Popup was dismissed by the user (e.g. Escape) — router should reset. */
  readonly onHidden: () => void;
}

/**
 * Which-key popup: a QuickPick used as a non-modal hint display.
 *
 * Why QuickPick: it's the only VSCode UI that can float over the editor
 * without stealing layout. It DOES capture the keyboard while open — we turn
 * that into a feature: typed characters are forwarded back into the router
 * (which-key.nvim style: type blind, popup just shows hints; when the binding
 * fires the router clears its pending keys and we close).
 */
export class WhichKeyPopup {
  private qp: vscode.QuickPick<vscode.QuickPickItem> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastValue = '';
  private currentPending: readonly string[] = [];
  /** Guards against re-entrant hide → onDidHide → onHidden loops. */
  private hiding = false;

  constructor(private readonly deps: WhichKeyPopupDeps) {}

  /** Called by the router whenever its pending-key sequence changes. */
  onPendingChanged(keys: readonly string[]): void {
    this.currentPending = keys;
    if (keys.length === 0) {
      this.cancelTimer();
      this.hide();
      return;
    }
    if (this.deps.resolveItems(keys).length === 0) {
      this.cancelTimer();
      this.hide();
      return;
    }
    if (this.qp) {
      this.refresh(keys);
      return;
    }
    this.cancelTimer();
    this.timer = setTimeout(() => {
      if (this.currentPending.length > 0 && !this.qp) this.open(this.currentPending);
    }, this.deps.delay);
  }

  private open(keys: readonly string[]): void {
    const items = this.deps.resolveItems(keys);
    if (items.length === 0) return;

    const qp = vscode.window.createQuickPick();
    this.qp = qp;
    this.lastValue = '';
    qp.title = whichKeyTitle(keys);
    qp.placeholder = 'type the next key…';
    qp.matchOnDescription = true;
    qp.items = items.map((i) => ({ label: i.label, description: i.description }));

    qp.onDidChangeValue((value) => {
      const prev = this.lastValue;
      this.lastValue = value;
      if (value.startsWith(prev)) {
        for (const ch of value.slice(prev.length)) this.deps.onTyped(ch);
      } else if (prev.startsWith(value)) {
        for (let i = 0; i < prev.length - value.length; i++) this.deps.onBackspace();
      } else {
        this.hide(); // desync (paste etc.) — safest to close and reset
      }
    });

    qp.onDidHide(() => {
      qp.dispose();
      this.qp = undefined;
      this.lastValue = '';
      if (!this.hiding) this.deps.onHidden();
      this.hiding = false;
    });

    qp.show();
  }

  private refresh(keys: readonly string[]): void {
    if (!this.qp) return;
    const items = this.deps.resolveItems(keys);
    this.qp.title = whichKeyTitle(keys);
    this.qp.items = items.map((i) => ({ label: i.label, description: i.description }));
  }

  private hide(): void {
    this.cancelTimer();
    if (this.qp) {
      this.hiding = true;
      this.qp.hide();
    }
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.hide();
  }
}
