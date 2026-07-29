import { Binding } from '../core/router';
import { parseKeySequence } from '../core/input/keyNotation';

export interface KeymapEntry {
  /** Notation string, e.g. "<leader>ff", "gd", "<S-h>" */
  readonly keys: string;
  readonly binding: Binding;
  /** Human-readable label for the which-key popup. */
  readonly description: string;
  /** Modes this binding is active in. Defaults to Normal. */
  readonly modes?: readonly ('Normal' | 'Insert' | 'Visual' | 'VisualLine')[];
}

const vscode = (command: string, args?: unknown[]): Binding => ({ kind: 'vscode', command, args });

/**
 * LAZYVIM DEFAULT KEYMAPS → native VSCode commands.
 *
 * This table systematically replicates lazyvim/lua/lazyvim/config/keymaps.lua
 * (plus core plugin key specs): every LazyVim default binding is either
 * mapped to a native VSCode feature or DROPPED — drops are documented in the
 * DROPPED section at the bottom with their reasons.
 *
 * Not here by design:
 *  - Pure vim keys (h j k l w b e, d c y, i a o, f/F/t/T, registers, marks,
 *    macros, `.`, …): owned by the engine (src/core/engine.ts).
 *  - Ctrl chords (<C-r>, <C-o>, <C-h/j/k/l>, <C-w>v/s): VSCode's keybinding
 *    system consumes those before `type` fires — bound in package.json.
 *  - <A-j>/<A-k> (move lines): VSCode's default Alt+Up/Down already does
 *    exactly this in every mode; Alt-modified keys never reach `type` on
 *    macOS, so trie bindings would be dead.
 */
export const LAZYVIM_KEYMAPS: readonly KeymapEntry[] = [
  // ── undo/redo (<C-r> redo lives in package.json) ──────────────────────────
  { keys: 'u', binding: vscode('undo'), description: 'Undo' },

  // ── search (native find widget; LazyVim: / ? n N * #) ────────────────────
  { keys: '/', binding: vscode('actions.find'), description: 'Find in file' },
  { keys: '?', binding: vscode('actions.find'), description: 'Find in file' },
  { keys: 'n', binding: vscode('editor.action.nextMatchFindAction'), description: 'Next match' },
  { keys: 'N', binding: vscode('editor.action.previousMatchFindAction'), description: 'Prev match' },
  { keys: '*', binding: vscode('editor.action.nextSelectionFindAction'), description: 'Find word under cursor (next)' },
  { keys: '#', binding: vscode('editor.action.previousSelectionFindAction'), description: 'Find word under cursor (prev)' },
  { keys: '<leader>/', binding: vscode('workbench.action.findInFiles'), description: 'Grep (global)' },

  // ── files / picker (LazyVim: <leader><space>, <leader>f*) ────────────────
  { keys: '<leader><space>', binding: vscode('workbench.action.quickOpen'), description: 'Find Files' },
  { keys: '<leader>fn', binding: vscode('workbench.action.files.newUntitledFile'), description: 'New File' },
  { keys: '<leader>e', binding: vscode('lazycode.toggleExplorer'), description: 'Explorer (toggle focus)' },

  // ── buffers: ALL buffer-switcher bindings DROPPED ────────────────────────
  // VSCode has tabs, not buffers. <S-h>/<S-l> would shadow vim's H/L screen
  // motions; [b/]b were redundant per user. Tab navigation: gt/gT.

  // ── windows (LazyVim: <leader>w = <C-w> proxy, <leader>-, <leader>|) ─────
  // <leader>h/j/k/l: user-preferred window-group navigation (was <C-h/j/k/l>).
  { keys: '<leader>h', binding: vscode('workbench.action.navigateLeft'), description: 'Go to left window' },
  { keys: '<leader>j', binding: vscode('workbench.action.navigateDown'), description: 'Go to lower window' },
  { keys: '<leader>k', binding: vscode('workbench.action.navigateUp'), description: 'Go to upper window' },
  { keys: '<leader>l', binding: vscode('workbench.action.navigateRight'), description: 'Go to right window' },
  { keys: '<leader>-', binding: vscode('workbench.action.splitEditorDown'), description: 'Split below' },
  { keys: '<leader>|', binding: vscode('workbench.action.splitEditorRight'), description: 'Split right' },
  { keys: '<leader>wd', binding: vscode('workbench.action.joinTwoGroups'), description: 'Delete window' },

  // ── tabs (LazyVim: gt/gT) ────────────────────────────────────────────────
  { keys: 'gt', binding: vscode('workbench.action.nextEditor'), description: 'Next tab' },
  { keys: 'gT', binding: vscode('workbench.action.previousEditor'), description: 'Prev tab' },

  // ── code / LSP (LazyVim: gd gr gI gy K, <leader>c*) ──────────────────────
  { keys: 'gd', binding: vscode('editor.action.revealDefinition'), description: 'Goto Definition' },
  { keys: 'gr', binding: vscode('editor.action.goToReferences'), description: 'References' },
  { keys: 'gI', binding: vscode('editor.action.goToImplementation'), description: 'Goto Implementation' },
  { keys: 'gy', binding: vscode('editor.action.goToTypeDefinition'), description: 'Goto Type Definition' },
  { keys: 'K', binding: vscode('editor.action.showHover'), description: 'Hover' },
  { keys: 'gcc', binding: vscode('editor.action.commentLine'), description: 'Comment line' },
  { keys: 'gc', binding: vscode('editor.action.commentLine'), description: 'Comment selection', modes: ['Visual', 'VisualLine'] },
  { keys: '<leader>ca', binding: vscode('editor.action.codeAction'), description: 'Code Action', modes: ['Normal', 'Visual'] },
  { keys: '<leader>cr', binding: vscode('editor.action.rename'), description: 'Rename' },
  { keys: '<leader>cf', binding: vscode('editor.action.formatDocument'), description: 'Format' },
  { keys: '<leader>co', binding: vscode('editor.action.organizeImports'), description: 'Organize Imports' },
  { keys: '<leader>cs', binding: vscode('workbench.action.gotoSymbol'), description: 'Document Symbols' },
  { keys: '<leader>cS', binding: vscode('workbench.action.showAllSymbols'), description: 'Workspace Symbols' },
  { keys: '<leader>cd', binding: vscode('workbench.actions.view.problems'), description: 'Diagnostics (Problems)' },
  { keys: '[d', binding: vscode('editor.action.marker.prev'), description: 'Prev diagnostic' },
  { keys: ']d', binding: vscode('editor.action.marker.next'), description: 'Next diagnostic' },

  // ── git (LazyVim: <leader>gg, <leader>gb, ]h/[h via gitsigns) ────────────
  { keys: '<leader>gg', binding: vscode('lazycode.openSourceControl'), description: 'Source Control' },
  { keys: '<leader>gb', binding: vscode('git.blame.toggleEditorDecoration'), description: 'Blame line' },
  { keys: '<leader>ghs', binding: vscode('git.stageSelectedRanges'), description: 'Stage hunk' },
  { keys: '<leader>ghu', binding: vscode('git.unstageSelectedRanges'), description: 'Unstage hunk' },

  // ── debug (LazyVim: <leader>db, <leader>dc) ──────────────────────────────
  { keys: '<leader>db', binding: vscode('editor.debug.action.toggleBreakpoint'), description: 'Toggle breakpoint' },
  { keys: '<leader>dc', binding: vscode('workbench.action.debug.continue'), description: 'Continue / Run' },

  // ── ui toggles (LazyVim: <leader>u*) ─────────────────────────────────────
  { keys: '<leader>uw', binding: vscode('editor.action.toggleWordWrap'), description: 'Toggle word wrap' },
  { keys: '<leader>un', binding: vscode('notifications.clearAll'), description: 'Dismiss all notifications' },
  // VSCode extras in the same spirit (not LazyVim defaults):
  { keys: '<leader>uz', binding: vscode('workbench.action.toggleZenMode'), description: 'Toggle zen mode' },

  // ── misc LazyVim defaults ────────────────────────────────────────────────
  // NOTE: LazyVim's <leader>l (Lazy) is dropped — <leader>l is window-right here.

  // ── folds (LazyVim z-family; zz/zt/zb stay engine-side for scrolling) ────
  { keys: 'za', binding: vscode('editor.toggleFold'), description: 'Toggle fold' },
  { keys: 'zc', binding: vscode('editor.fold'), description: 'Close fold' },
  { keys: 'zo', binding: vscode('editor.unfold'), description: 'Open fold' },
  { keys: 'zC', binding: vscode('editor.foldRecursively'), description: 'Close fold recursively' },
  { keys: 'zO', binding: vscode('editor.unfoldRecursively'), description: 'Open fold recursively' },
  { keys: 'zM', binding: vscode('editor.foldAll'), description: 'Close all folds' },
  { keys: 'zR', binding: vscode('editor.unfoldAll'), description: 'Open all folds' },
  { keys: 'zv', binding: vscode('editor.unfold'), description: 'Open fold at cursor (view line)' },
  { keys: 'zj', binding: vscode('editor.gotoNextFold'), description: 'Next fold' },
  { keys: 'zk', binding: vscode('editor.gotoPreviousFold'), description: 'Prev fold' },
  { keys: 'zx', binding: vscode('editor.unfoldAll'), description: 'Re-open all folds (zx)' },
];

/**
 * DROPPED LazyVim defaults (no native VSCode feature — per project rule, they
 * are dropped rather than mimicked):
 *
 *  flash `s`               — engine owns `s` (substitute); no native flash
 *  mini.surround gsa/gsd/gsr — no native surround (candidate for engine v2)
 *  <leader>us (spell)      — no native spell toggle
 *  <leader>ul/ur (line numbers, relative) — no native toggle command
 *  <leader>uc (conceal)    — N/A in VSCode
 *  <leader>uh (inlay hints) <leader>ug (indent guides) <leader>uT (treesitter)
 *  <leader>uA (tabline) <leader>ub (background) <leader>uf (autoformat)
 *  <leader>uD (dim)        — no confident native toggle commands
 *  <leader>ui/uH (inspect) — no native equivalent
 *  <leader>L (changelog)   — LazyVim-internal
 *  <leader>xl (loclist)    — VSCode has one list (Problems) → <leader>xq
 *  ]e/[e ]w/[w (severity-filtered diagnostic jumps) — marker nav can't filter
 *  gitsigns reset hunk (<leader>ghr) — git.revertSelectedRanges is destructive
 *    and was not requested; stage/unstage ARE mapped (<leader>ghs/ghu)
 *  ]h/[h (hunk navigation) — dropped per user request
 *  <leader>wm (zoom window) — no confident native command
 *  <leader><tab>f/l (first/last tab) — no confident native command
 *  <C-/> (terminal)        — conflicts with native comment binding; use <leader>ft
 *  <leader>fc (find config) — LazyVim-internal
 *  <leader>fb (file browser) — <leader>e covers explorer
 *  <leader>cm (mason)      — <leader>l (Extensions) covers it
 *  <leader>qd/qs (persistence sessions) — no native session manager
 *  todo-comments ]t/[t, harpoon — no native equivalents
 *  <leader>qq, <leader>bb, <leader>bd, <leader>ff, <leader>fg
 *                          — dropped per user request
 */

/** Parse all entries once; the router binds these into its trie at startup. */
export function parsedKeymaps(): Array<{ keys: string[]; entry: KeymapEntry }> {
  return LAZYVIM_KEYMAPS.map((entry) => ({
    keys: parseKeySequence(entry.keys),
    entry,
  }));
}

// ── user overrides (lazycode.keymapOverrides) ────────────────────────────────

export type KeymapOverrideValue =
  | string // "workbench.action.quickOpen"
  | { command: string; args?: unknown[]; description?: string }
  | false // remove the default binding at this key
  | null;

export interface ParsedOverrides {
  readonly bind: Array<{ keys: string[]; entry: KeymapEntry }>;
  readonly unbind: string[][];
}

/** Parse the raw settings object; invalid key strings are skipped silently. */
export function parseOverrides(raw: Record<string, unknown>): ParsedOverrides {
  const bind: Array<{ keys: string[]; entry: KeymapEntry }> = [];
  const unbind: string[][] = [];
  for (const [keys, value] of Object.entries(raw)) {
    let parsed: string[];
    try {
      parsed = parseKeySequence(keys);
    } catch {
      continue; // invalid notation — ignore
    }
    if (value === false || value === null) {
      unbind.push(parsed);
      continue;
    }
    if (typeof value === 'string' && value.length > 0) {
      bind.push({
        keys: parsed,
        entry: { keys, binding: { kind: 'vscode', command: value }, description: value },
      });
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const v = value as { command?: unknown; args?: unknown[]; description?: string };
      if (typeof v.command === 'string' && v.command.length > 0) {
        bind.push({
          keys: parsed,
          entry: {
            keys,
            binding: { kind: 'vscode', command: v.command, args: v.args },
            description: v.description ?? v.command,
          },
        });
      }
    }
  }
  return { bind, unbind };
}

const keysEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** Apply overrides to the base table: unbind removes, bind replaces/appends. */
export function mergeKeymapOverrides(
  base: Array<{ keys: string[]; entry: KeymapEntry }>,
  overrides: ParsedOverrides,
): Array<{ keys: string[]; entry: KeymapEntry }> {
  const withoutRemoved = base.filter((e) => !overrides.unbind.some((u) => keysEqual(u, e.keys)));
  const withoutReplaced = withoutRemoved.filter(
    (e) => !overrides.bind.some((b) => keysEqual(b.keys, e.keys)),
  );
  return [...withoutReplaced, ...overrides.bind];
}
