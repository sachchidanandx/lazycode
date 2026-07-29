# LazyCode Architecture

A from-scratch vim engine in pure TypeScript (no Neovim process, no Lua, no
dependency on VSCodeVim), with LazyVim-style keybindings mapped onto native
VSCode commands.

## Core invariants

1. **The engine never imports `vscode`.** Everything under `src/core/` and
   `src/lazyvim/` is pure TS and headless-testable. The only files importing
   `vscode` are `src/extension.ts` and `src/vs/vsEditorContext.ts`.

2. **Single interception point.** All keystrokes funnel through
   `KeystrokeRouter.handleKeystroke()`. Typed text arrives via the `type`
   command override; multi-char input (paste, IME commits) is detected and
   passed straight to `default:type`.

3. **Single edit chokepoint.** Every vim action applies its mutations through
   `EditorContext.applyEdits()`, and each action produces exactly ONE call —
   one VSCode undo stop per vim action. This is what prevents undo desync
   (the most common bug class in vim extensions).

4. **Bindings compose, never hardcode pairs.** `d` + `iw` works because the
   BindingTrie matches key *sequences*, and operators/motions/text-objects are
   separate composable pieces (Milestone 2).

## Data flow

```
keypress ──► keystrokeFromTypedText() ──► canonical key ("<C-w>", "g", ...)
     │
     ▼
KeystrokeRouter: mode gate (Insert → passthrough unless bound)
     │           pendingKeys += key
     │           trieForMode(currentMode).match(pendingKeys)
     ▼
Binding = action (engine) | vscode command (delegate)
     │
     ▼
engine action: (VimState, EditorContext) → TextEdit[] → applyEdits (one undo stop)
```

## Engine (Milestone 2)

`src/core/engine.ts` (`NormalEngine`) owns vim's pending state — counts,
pending operator, text-object prefix (`i`/`a`), find-char (`f/F/t/T`), `g`
prefix — and composes three kinds of pure functions:

- `src/core/actions/motions.ts` — `(editor, pos, count) → MotionResult`
  (`inclusive`/`linewise` flags drive operator range computation). Implements
  vim's word/punct char classes, the `cw`≈`ce` quirk, and `%` bracket matching.
- `src/core/actions/textObjects.ts` — `(editor, pos, around) → Range`
  (`iw/aw`, quotes, nested brackets, paragraphs).
- `src/core/actions/operators.ts` — `d`/`c`/`y` produce one edit batch +
  register entry + target cursor; linewise ops handle the EOF newline edge
  cases (`dd` on last line, `dd` on a single-line doc).

The router claims leader/IDE bindings via the trie; everything else falls
through to the engine (`engineFallback`), so `gg` (engine) and `gd` (trie)
coexist on the same `g` prefix.

**Tries are mode-scoped.** `src/extension.ts` builds one `BindingTrie` per
mode from `KeymapEntry.modes` (default Normal-only) and injects
`trieForMode(mode)` into the router, which resolves the trie per keystroke.
A Normal binding (e.g. `n` → next match) therefore can never shadow plain
typing in Insert mode, and only Insert-scoped bindings (e.g. a `jk` escape)
are visible there.

### Dot-repeat, registers, marks

- **`.` repeat** is keystroke recording: every Normal/Visual key joins
  `pendingActionKeys`; completing a change finalizes `lastChange`. Changes
  that enter Insert (`ciw`, `o`, `s`…) open an *insert session* — the router
  reports every passthrough character to `engine.recordInsertText`, and
  `<esc>` finalizes the change as `keys + insertedText`. Replay re-feeds the
  keys to the engine, then re-applies the recorded text and simulates the
  escape. During replay a `replaying` flag disables recording (a replay must
  never clobber `lastChange`).
- **Registers**: `"a-z` via the `"` prefix; every delete/yank/change also
  writes the unnamed register `"`; yanks (only) write `"0`.
- **Marks**: `ma` sets, `` `a `` jumps exact, `'a` jumps linewise
  (first-non-blank); `''` returns to the pre-jump position.
- **Macros**: `qa` records (the closing `q` is not captured), `@a` replays,
  `@@` repeats. Typed insert text is captured via `recordInsertText`, `<esc>`
  via `handleEscape` (single funnel — pushing it in both places would double
  it). Macro replay keeps dot-recording ACTIVE so a change inside a macro
  becomes the new `.`; the action buffer is reset at replay start so `@a`
  itself never leaks into `lastChange`.
- **Search**: `/` `?` `n` `N` `*` `#`. The engine owns pattern state, match
  computation (plain string, whole-word for `*`/`#`), wrap-around navigation
  and the motion (`d/pattern` composes). The extension owns the UI: an input
  box (`searchPromptHandler`) and match-highlight decorations
  (`onSearchUpdate`); `<esc>` in Normal clears highlights but keeps the
  pattern alive for `n`.

## Which-key popup

`src/vs/whichKeyPopup.ts` uses a QuickPick as a floating hint display (the
only VSCode UI that floats without stealing layout). The router exposes
`onPendingChanged` / `popPendingKey` / `clearPendingKeys`; when a trie prefix
(e.g. `<leader>`) is pending, the popup appears after `whichKeyDelay` ms.
While open, the QuickPick captures the keyboard — typed chars are diffed out
of its input value and forwarded back into the router, so blind typing works
exactly like which-key.nvim; when the binding fires, pending clears and the
popup closes. `src/lazyvim/whichKeyItems.ts` is the pure resolver (tested
headless).

## Misc engine actions

- `r{char}` replace, `~` case toggle, `J` join (indent-aware, one undo stop).
  In Visual mode these are selection-scoped: `x`/`s` alias `d`/`c`,
  `X`/`D`/`C`/`Y` go linewise over the selected lines, `r` overwrites every
  selected char, `~`/`u`/`U` swap/lower/upper case, `J` joins the selected
  lines (shared `joinLineRange`), `p`/`P` paste over the selection (the
  deleted selection lands in the unnamed register, vim swap semantics), and
  `o`/`O` swap the cursor to the other end of the selection. Every visual
  operation is one `applyEdits` batch and exits to Normal.
- `>`/`<` are real operators: `>>`, `>j`, `>ip`, visual `>` — 4-space shifts,
  empty lines skipped, dot-repeatable
- Jumplist: `gg`/`G`/`%`/marks/searches record origins; `<C-o>`/`<C-i>` walk
  with forward-truncation on new jumps. Gotcha enforced by tests: counts must
  be consumed by the action that read them (`runMotion` clears pending
  counts), or they leak into the next keystroke.
- `zz/zt/zb` delegate to `scrollHandler` (VSCode `revealRange` semantics).
- LazyVim's `j`/`k` → `gj`/`gk`: with no count and no pending operator, `j`/`k`
  move by DISPLAY (wrapped) lines via `EditorContext.moveVisualLine` → VSCode's
  `cursorMove` command (which also tracks the goal column natively). With a
  count or a pending operator they stay logical — exactly LazyVim's
  `v:count == 0 and 'gj' or 'j'` mapping. `gj`/`gk` always move by display
  lines, counts allowed.

## Keymap layer

`src/lazyvim/keymaps.ts` is a declarative table mirroring
`lazyvim/config/keymaps.lua`: `{ keys, binding, description, modes }`.
`<space>` is the leader. `modes` scopes each entry (default Normal-only) and
drives both the per-mode tries the router matches against and the which-key
popup's hints (`buildWhichKeyItems` filters by current mode).

## Testing

Engine tests are headless: `FakeEditorContext` (a string-backed EditorContext)
+ vitest. No VSCode instance needed. Run: `npm test`.
