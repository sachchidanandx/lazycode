import * as vscode from 'vscode';
import { Mode, ModeManager } from './core/mode/modeManager';
import { BindingTrie } from './core/input/bindingTrie';
import { Binding, KeystrokeRouter } from './core/router';
import { keystrokeFromTypedText } from './core/input/keyNotation';
import { mergeKeymapOverrides, parseOverrides, parsedKeymaps } from './lazyvim/keymaps';
import { VsEditorContext } from './vs/vsEditorContext';
import { NormalEngine } from './core/engine';
import { WhichKeyPopup } from './vs/whichKeyPopup';
import { buildWhichKeyItems } from './lazyvim/whichKeyItems';

export function activate(context: vscode.ExtensionContext): void {
  const modeManager = new ModeManager((key, value) => {
    void vscode.commands.executeCommand('setContext', key, value);
  });

  // Status bar mode badge, Zed/airline-style: per-mode solid background with
  // dark foreground (the status bar API has no font-weight, so the solid
  // badge reads as bold). Placed RIGHT side, first-from-left within the group
  // (higher priority = further left in the status bar).
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
  statusBar.command = 'lazycode.enterNormalMode';
  // Only statusBarItem.* background ids render reliably across themes (custom
  // ids like charts.* silently drop in some, e.g. Catppuccin Mocha, making the
  // badge invisible). prominent/remote alias each other in Mocha, so the three
  // visually distinct families are prominent / warning / error. Text color is
  // left to the theme default so the badge can never go dark-on-dark.
  const MODE_BADGE: Record<string, { label: string; bg: string }> = {
    Normal: { label: 'NORMAL', bg: 'statusBarItem.prominentBackground' },
    Insert: { label: 'INSERT', bg: 'statusBarItem.warningBackground' },
    Visual: { label: 'VISUAL', bg: 'statusBarItem.errorBackground' },
    VisualLine: { label: 'V-LINE', bg: 'statusBarItem.errorBackground' },
  };
  const renderMode = (): void => {
    const badge = MODE_BADGE[modeManager.current];
    statusBar.text = ` ${badge.label} `;
    statusBar.backgroundColor = new vscode.ThemeColor(badge.bg);
    statusBar.show();
  };
  modeManager.onDidChange(renderMode);
  renderMode();
  context.subscriptions.push(statusBar);

  // Cursor shape per mode (like terminal Neovim): block in Normal/Visual,
  // beam in Insert. The block cursor also makes visual selections *look*
  // inclusive of the cursor char — which they are (see engine.visualRange).
  const applyCursorStyle = (): void => {
    const style =
      modeManager.current === 'Insert'
        ? vscode.TextEditorCursorStyle.Line
        : vscode.TextEditorCursorStyle.Block;
    for (const editor of vscode.window.visibleTextEditors) {
      editor.options.cursorStyle = style;
    }
  };
  modeManager.onDidChange(applyCursorStyle);
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(applyCursorStyle),
  );
  applyCursorStyle();

  // Build the binding trie from the LazyVim keymap table, then apply user
  // overrides from lazycode.keymapOverrides (reload required to re-read).
  const overrides = parseOverrides(
    vscode.workspace.getConfiguration('lazycode').get<Record<string, unknown>>('keymapOverrides', {}),
  );
  const effectiveKeymaps = mergeKeymapOverrides(parsedKeymaps(), overrides);
  // Bindings are mode-scoped (KeymapEntry.modes, default Normal-only): build
  // one trie per mode so a Normal binding (e.g. `n` → next match) can never
  // shadow plain typing in Insert mode.
  const tries = new Map<Mode, BindingTrie<Binding>>();
  for (const { keys, entry } of effectiveKeymaps) {
    const modes: readonly Mode[] = entry.modes ?? ['Normal'];
    for (const mode of modes) {
      let trie = tries.get(mode);
      if (!trie) {
        trie = new BindingTrie<Binding>();
        tries.set(mode, trie);
      }
      trie.bind(keys, entry.binding);
    }
  }
  const emptyTrie = new BindingTrie<Binding>();
  const trieForMode = (mode: Mode): BindingTrie<Binding> => tries.get(mode) ?? emptyTrie;

  const executeCommand = (command: string, args?: unknown[]): Promise<unknown> =>
    Promise.resolve(vscode.commands.executeCommand(command, ...(args ?? [])));
  const defaultType = (text: string): Promise<unknown> =>
    Promise.resolve(vscode.commands.executeCommand('default:type', { text }));

  const engine = new NormalEngine(modeManager);

  // Search: engine owns the state/motion; the extension owns the UI.
  engine.searchPromptHandler = async (forward) => {
    return vscode.window.showInputBox({
      prompt: forward ? '/' : '?',
      placeHolder: 'Search pattern',
    });
  };
  engine.scrollHandler = (kind, editor) => {
    void editor; // cursor already where it should be; we scroll the view
    const command =
      kind === 'center'
        ? 'centerEditorViewport'
        : kind === 'top'
          ? 'scrollEditorTop'
          : 'scrollEditorBottom';
    // VSCode has no native scroll-to-cursor variants for top/bottom; use
    // revealRange as a reasonable approximation for those.
    const active = vscode.window.activeTextEditor;
    if (!active) return;
    if (kind === 'center') {
      void vscode.commands.executeCommand(command);
    } else {
      active.revealRange(
        active.selection,
        kind === 'top' ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.Default,
      );
    }
  };
  const searchDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderRadius: '2px',
  });
  context.subscriptions.push(searchDecoration);
  engine.onSearchUpdate = (matches) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    editor.setDecorations(
      searchDecoration,
      matches.map(
        (m) =>
          new vscode.Range(m.start.line, m.start.character, m.end.line, m.end.character),
      ),
    );
  };

  const router = new KeystrokeRouter({
    modeManager,
    trieForMode,
    executeCommand,
    defaultType,
    engineFallback: (keys, editor) => engine.handleKeys(keys, editor),
    engineHasPendingInput: () => engine.hasPendingInput(),
    insertTextRecorder: (raw) => engine.recordInsertText(raw),
    leaderKey: vscode.workspace.getConfiguration('lazycode').get<string>('leaderKey', '<space>'),
  });

  // Which-key popup: shows hints when a trie prefix (e.g. <leader>) is pending.
  const whichKeyPopup = new WhichKeyPopup({
    delay: vscode.workspace.getConfiguration('lazycode').get<number>('whichKeyDelay', 300),
    resolveItems: (keys) => buildWhichKeyItems(keys, effectiveKeymaps, modeManager.current),
    onTyped: (raw) => {
      void (async () => {
        try {
          const key = keystrokeFromTypedText(raw);
          await withEditor((editor) => router.handleKeystroke(key, raw, editor));
        } catch {
          whichKeyPopup.onPendingChanged([]); // untypeable char — close
        }
      })();
    },
    onBackspace: () => router.popPendingKey(),
    onHidden: () => router.clearPendingKeys(),
  });
  context.subscriptions.push(whichKeyPopup);

  router.onPendingChanged = (keys) => {
    const enabled = vscode.workspace.getConfiguration('lazycode').get<boolean>('whichKey', true);
    if (enabled) whichKeyPopup.onPendingChanged(keys);
  };

  const withEditor = async (fn: (editor: VsEditorContext) => Promise<unknown>): Promise<unknown> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    return fn(new VsEditorContext(editor));
  };

  // The single interception point for typed characters.
  context.subscriptions.push(
    vscode.commands.registerCommand('type', async (e: { text: string }) => {
      let key: string;
      try {
        key = keystrokeFromTypedText(e.text);
      } catch {
        await defaultType(e.text); // multi-char input (paste, IME commit)
        engine.recordInsertText(e.text);
        return;
      }
      await withEditor(async (editor) => {
        await router.handleKeystroke(key, e.text, editor);
      });
    }),
  );

  // <leader>e: LazyVim-style explorer toggle — focus it if not focused,
  // close it if it is. Reads filesExplorerFocus via the internal 'getContext'
  // command; if that is unavailable, falls back to a tracked flag so the
  // command can never die silently.
  let explorerFocused = false;

  // Mode commands (bound to <esc>, i, v, V in package.json — these keys, when
  // bound, fire commands instead of `type`, so they bypass the router).
  context.subscriptions.push(
    vscode.commands.registerCommand('lazycode.enterNormalMode', async () => {
      await withEditor((editor) => engine.handleEscape(editor));
      modeManager.transition('Normal');
    }),
    vscode.commands.registerCommand('lazycode.enterInsertMode', () => {
      modeManager.transition('Insert');
    }),
    vscode.commands.registerCommand('lazycode.enterVisualMode', () => {
      modeManager.transition('Visual');
    }),
    vscode.commands.registerCommand('lazycode.enterVisualLineMode', () => {
      modeManager.transition('VisualLine');
    }),
    // Generic forwarder for Ctrl chords bound in package.json (<C-d>/<C-u>/
    // <C-f>/<C-b>): the `type` event never fires for Ctrl combos, so these
    // arrive as commands and re-enter the normal router path.
    vscode.commands.registerCommand('lazycode.key', async (args: { key: string }) => {
      if (typeof args?.key !== 'string') return;
      await withEditor((editor) => router.handleKeystroke(args.key, args.key, editor));
    }),
    // <leader>gg: open + focus the Source Control view, with a visible error
    // instead of silent failure if the command id ever changes.
    vscode.commands.registerCommand('lazycode.openSourceControl', async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.scm');
      } catch (err) {
        void vscode.window.showErrorMessage(
          `LazyCode: could not open Source Control (${String(err)}). Is the git extension enabled?`,
        );
      }
    }),
    vscode.commands.registerCommand('lazycode.toggleExplorer', async () => {
      let focused = explorerFocused;
      try {
        const f: unknown = await vscode.commands.executeCommand('getContext', 'filesExplorerFocus');
        if (typeof f === 'boolean') focused = f;
      } catch {
        // fall back to the tracked flag
      }
      if (focused) {
        // closeSidebar may not exist in some builds — fall back to toggle.
        try {
          await vscode.commands.executeCommand('workbench.action.closeSidebar');
        } catch {
          await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
        }
        explorerFocused = false;
      } else {
        await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
        explorerFocused = true;
      }
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up yet
}
