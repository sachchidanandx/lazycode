import { BindingTrie } from './input/bindingTrie';
import { EditorContext } from './editorContext';
import { ModeManager } from './mode/modeManager';

/**
 * A resolved keybinding: either an engine action (vim semantics, implemented
 * by us) or a native VSCode command (IDE features, delegated).
 *
 * This union IS the LazyVim philosophy in one type: vim editing is hand-built;
 * everything else maps to native workbench / editor commands.
 */
export type Binding =
  | { kind: 'action'; actionId: string } // engine handles it
  | { kind: 'vscode'; command: string; args?: unknown[] }; // delegate to VSCode

export type VscodeCommandExecutor = (command: string, args?: unknown[]) => Promise<unknown>;

export interface RouterDeps {
  readonly modeManager: ModeManager;
  readonly trie: BindingTrie<Binding>;
  readonly executeCommand: VscodeCommandExecutor;
  /** Called when a binding can't be handled — used to pass text through in Insert mode. */
  readonly defaultType: (text: string) => Promise<unknown>;
  /**
   * Keys the trie doesn't claim fall through to the vim engine (Normal/Visual
   * modes). Receives canonical keystrokes, possibly a buffered sequence like
   * ['g', 'g'] that was a trie prefix but never completed.
   */
  readonly engineFallback?: (keys: readonly string[], editor: EditorContext) => Promise<void>;
  /** Notified of every character passed through to Insert mode (for `.` recording). */
  readonly insertTextRecorder?: (raw: string) => void;
  /**
   * When the engine reports pending input (operator-pending, find-char arg,
   * register name, …), the router bypasses the trie and hands the key
   * straight to the engine. Without this, trie bindings hijack argument
   * characters (`f/` opening find, `dn` firing next-match with a stale `d`).
   */
  readonly engineHasPendingInput?: () => boolean;
  /**
   * The physical key that acts as <leader> (default '<space>'). When a
   * keystroke equals this AND no sequence is pending, it is rewritten to
   * '<leader>' before trie matching. Raw text is untouched, so in Insert mode
   * the same key still types normally via passthrough.
   */
  readonly leaderKey?: string;
}

export type KeystrokeResult =
  | { type: 'handled'; binding?: Binding }
  | { type: 'pending' } // waiting for more keys
  | { type: 'passthrough' }; // sent to default:type (Insert mode)

interface PendingKey {
  readonly key: string; // canonical, for trie matching / engine
  readonly raw: string; // original text, for Insert-mode flushing
}

/**
 * KeystrokeRouter: the single interception point.
 *
 * All keys funnel through handleKeystroke(). Modes gate behavior:
 *   Insert        → pass through to VSCode unless bound (e.g. jk escape)
 *   Normal/Visual → trie first (leader/gd/K/...), engine fallback for vim keys;
 *                   unknown keys are swallowed (vim behavior)
 */
export class KeystrokeRouter {
  private pending: PendingKey[] = [];

  /** Notified whenever the pending-key sequence changes (which-key popup). */
  onPendingChanged?: (keys: readonly string[]) => void;

  constructor(private readonly deps: RouterDeps) {}

  /** Drop the entire pending sequence (popup dismissed). */
  clearPendingKeys(): void {
    if (this.pending.length > 0) this.setPending([]);
  }

  /** Drop the last pending key (backspace in the popup). */
  popPendingKey(): void {
    if (this.pending.length > 0) this.setPending(this.pending.slice(0, -1));
  }

  private setPending(keys: PendingKey[]): void {
    this.pending = keys;
    this.onPendingChanged?.(keys.map((k) => k.key));
  }

  async handleKeystroke(key: string, rawText: string, editor: EditorContext): Promise<KeystrokeResult> {
    const { modeManager, trie, executeCommand, defaultType, engineFallback } = this.deps;
    // Leader rewrite: only at sequence start (so '<leader><space>' still works
    // — the second <space> must stay a literal <space>).
    const effectiveKey =
      this.pending.length === 0 && key === (this.deps.leaderKey ?? '<space>') ? '<leader>' : key;
    const pending: PendingKey[] = [...this.pending, { key: effectiveKey, raw: rawText }];
    const keys = pending.map((p) => p.key);
    const result = trie.match(keys);

    if (modeManager.is('Insert')) {
      if (result.type === 'match') {
        this.setPending([]);
        await this.fire(result.value, editor, executeCommand);
        return { type: 'handled', binding: result.value };
      }
      if (result.type === 'partial') {
        this.setPending(pending);
        return { type: 'pending' };
      }
      // No insert-mode binding: flush buffered keys as literal text, then this key.
      for (const p of this.pending) {
        await defaultType(p.raw);
        this.deps.insertTextRecorder?.(p.raw);
      }
      this.setPending([]);
      await defaultType(rawText);
      this.deps.insertTextRecorder?.(rawText);
      return { type: 'passthrough' };
    }

    // Normal / Visual: engine pending input beats the trie — the key is an
    // argument to an in-progress vim sequence, not a binding.
    if (this.deps.engineHasPendingInput?.() === true) {
      if (engineFallback) await engineFallback([effectiveKey], editor);
      return { type: 'handled' };
    }

    switch (result.type) {
      case 'match':
        this.setPending([]);
        await this.fire(result.value, editor, executeCommand);
        return { type: 'handled', binding: result.value };
      case 'partial':
        this.setPending(pending);
        return { type: 'pending' };
      case 'none':
        this.setPending([]);
        if (engineFallback) await engineFallback(keys, editor);
        // Engine handles or vim swallows — either way the key is consumed.
        return { type: 'handled' };
    }
  }

  private async fire(
    binding: Binding,
    _editor: EditorContext,
    executeCommand: VscodeCommandExecutor,
  ): Promise<void> {
    if (binding.kind === 'vscode') {
      await executeCommand(binding.command, binding.args);
    }
    // 'action' bindings are reserved for future engine-exposed actions.
  }
}
