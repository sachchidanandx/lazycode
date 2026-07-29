# Changelog

All notable changes to **LazyCode** are documented here, newest first.
The project follows the original roadmap: Phase 1 study → scaffold →
pure-TS vim engine → LazyVim distribution layer → polish → publish.

---

## [1.1.0] — Visual-mode selection operations (vi" + x, p, r, ~, u, U, J, o)

`vi"` followed by `x` deleted ONE char at the cursor instead of the selected
quoted text: the engine's `x`/`X`/`s`/`p`/`P`/`r`/`~`/`J` only knew
Normal-mode (cursor-based) semantics and ignored the visual selection
entirely. All selection-scoped operations now work, each as ONE undo stop,
exiting to Normal afterwards:

- **`x`** → delete selection (same as `d`); **`s`** → change selection
  (same as `c`); both were broken, `d`/`c`/`y`/`>`/`<` already worked
- **`X` / `D` / `C` / `Y`** → delete/change/yank the selected LINES
  linewise (previously cursor-line-only or to-line-end)
- **`p` / `P`** → replace the selection with the register's contents; the
  deleted selection moves into the unnamed register (vim swap semantics,
  so `viwp` twice swaps back). One delete+insert batch
- **`r{char}`** → overwrite every selected character with `char`, newlines
  preserved, multi-line selections supported
- **`~` / `u` / `U`** → swap case / lowercase / uppercase the selection
  (Normal-mode undo still lives in the keymap table → native `undo`; the
  engine only sees `u` in Visual)
- **`J`** → join every line covered by the selection (single-line
  selection behaves like Normal `J`); `joinLines` refactored into a shared
  `joinLineRange(start, end)`
- **`o` / `O`** → jump the cursor to the other end of the selection
  (previously opened a new line while in Visual — very wrong)

Visual `x` composes with dot-repeat (`vi"x` … `f".` deletes the next
quoted string). 21 new tests in `test/visual.test.ts`. **283 tests total.**

## [1.0.13] — Mode-scoped keybindings (insert-typing shadowing fix)

All keymaps were bound into a single shared trie, so Normal-only bindings
leaked into Insert mode: typing `n` opened the find widget (`nextMatch`),
typing `gd`/`gt`/`u` fired goto-definition / next-tab / undo instead of
inserting text.

- **Fix**: bindings are now mode-scoped. `src/extension.ts` builds one
  `BindingTrie` per mode (populated from `KeymapEntry.modes`, default
  Normal-only) and hands the router a `trieForMode(mode)` resolver;
  `RouterDeps.trie` became `trieForMode`. In Insert mode only Insert-scoped
  bindings (e.g. a user's `jk` escape) can match — Normal bindings are
  invisible, so plain typing always passes through, including keys that are
  Normal-mode *prefixes* like `g`.
- Two regression tests in `test/router.test.ts` (`n` passes through,
  `gd` types literally in Insert mode). **262 tests total.**

## [1.0.12] — Visual-mode text objects (viw, va{, vip, …)

`i`/`a` in Visual mode were dispatched as INSERT commands, so `vi{`
literally typed a brace. They are now text-object prefixes in Visual mode:
the object is selected and Visual mode continues (vim behavior). Linewise
objects (`vip`/`vap`) switch to VisualLine. Multi-line range ends are
computed char-exactly: a range ending at char 0 of the closing-bracket
line selects through the end of the previous line instead. Object forms
cover `w`, quotes, all bracket pairs (incl. `b`/`B` aliases), and `p`.
10 new tests in `test/visual.test.ts`. **260 tests total.**

## [1.0.10] — Paragraph motions, screen motions, page scrolling

Closes the biggest everyday-navigation gaps in the engine.

- **`{` / `}` paragraph motions** — jump to the blank line above/below the
  current paragraph, with counts (`3}`). Linewise, exclusive with operators
  (`d}` deletes the paragraph but NOT the blank line below it — the
  `motionToRange` exclusive-linewise rule is new; `j`/`k`/`gg`/`G` stay
  inclusive), land on col 0 of blank lines, first non-blank at doc
  boundaries, fail (no-op) when already at the boundary, and record
  jumplist entries.
- **`H` / `M` / `L` screen motions** — first/middle/last visible line, first
  non-blank, with counts (`3H`, `2L`). Backed by a new
  `EditorContext.getVisibleLineRange()` (VSCode `visibleRanges`; the fake
  has a configurable 20-line viewport). Linewise, jumplist-worthy.
- **`<C-d>` / `<C-u>` half-page, `<C-f>` / `<C-b>` full-page scrolling** —
  new `EditorContext.scrollLines(delta)` (VSCode `editorScroll` command)
  plus the engine's `pageScroll`: scroll FIRST, then move the cursor by the
  same amount, so the cursor keeps its screen row (reverse order would
  double-scroll via reveal). Counts multiply; clamps at doc bounds; with a
  pending operator it degrades to a plain inclusive linewise motion
  (`d<C-d>`); in Visual it extends the selection. Bound in `package.json`
  via the new generic `lazycode.key` command (Ctrl chords never reach
  `type`), active in Normal/Visual, native behavior kept in Insert.
  NOT jumplist motions (matches vim).
- **`<S-h>` / `<S-l>` and `[b` / `]b` DROPPED** from the keymap table:
  LazyVim's buffer switchers don't map to VSCode's tab model, `<S-h>`/`<S-l>`
  would shadow vim's H/L screen motions, and `[b`/`]b` were redundant per
  user. Tab navigation remains via `gt`/`gT`; `[d`/`]d` diagnostics kept.
- New `test/navigation.test.ts` (32 tests); `FakeEditorContext` gained a
  realistic viewport (`getVisibleLineRange`/`scrollLines`/`setViewport`,
  and `revealPrimaryCursor` now scrolls it like a real editor).
  **250 tests total.**

## [1.0.9] — User keymap overrides (wired)

The `lazycode.keymapOverrides` setting (declared since 0.0.1 but never
read) is now fully functional.

- Three forms per key in `settings.json`:
  - `"<leader>tt": "workbench.action.terminal.toggleTerminal"` — string
  - `"<leader>ht": { "command": "...", "args": [...], "description": "..." }` — object
  - `"<leader>fn": false` — removes a default binding
- Overrides merge on top of the default table (replace / append / remove),
  are reflected in the which-key popup, and skip invalid key strings
  silently. Requires reload (no live config watching yet).
- New `test/overrides.test.ts` (7 tests) covering all forms + merge
  semantics. **218 tests total.**

## [1.0.2 – 1.0.8] — Icon iterations

Progressive extension icon redesigns driven by user feedback:
fusion badge → pure Neovim N → minimal two-glyph → plain icons →
diagonal layout → final: **user-selected modern Vim icon (top-left) +
official VSCode 1.35 icon (bottom-right), diagonal, transparent bg**.
Sources kept in `images/` (`icon.svg` composite + `assets/` PNGs/SVG).

## [1.0.1] — Git hunks + robust SCM

- `<leader>ghs` → `git.stageSelectedRanges` (stage hunk, gitsigns-style)
- `<leader>ghu` → `git.unstageSelectedRanges` (unstage hunk)
- Removed `]h`/`[h` hunk navigation (user request)
- `<leader>gg` routes through `lazycode.openSourceControl` with a visible
  error instead of silent failure

## [1.0.0] — v1 release

First packaged release with custom icon. Git repository initialized
(`git init`, full project-history commit).

## [0.0.17] — Keybinding cleanup #2

Removed 10 duplicate/low-value bindings: `<leader>?`, `<leader><tab>*`
(all 4), `<leader>bo`, `<leader>fr`, `<leader>ft`, `<leader>uC`,
`<leader>um`, `<leader>up`, `<leader>w=`, `<leader>wh/j/k/l/s/v`,
`<leader>xq`.

## [0.0.16] — `<leader>l` conflict fix

`<leader>l` was bound to both Extensions view and window-right;
Extensions binding removed (window nav wins).

## [0.0.15] — `<leader>h/j/k/l` window navigation

- Added `<leader>h/j/k/l` → navigateLeft/Down/Up/Right
- Removed `<C-h/j/k/l>` package.json bindings (keys freed back to VSCode)

## [0.0.14] — LazyVim `j`/`k` → `gj`/`gk` semantics

- New `EditorContext.moveVisualLine(delta, select)` capability:
  real adapter → VSCode `cursorMove` (`by: 'wrappedLine'`, native goal-
  column tracking); headless fake → logical move + call counter
- Rule (exact LazyVim `v:count == 0 and 'gj' or 'j'`): no count + no
  pending operator → display lines; count or `dj` → logical lines
- `gj`/`gk` always display lines, counts allowed; Visual mode extends
  selection via `cursorMove select:true`

## [0.0.13] — Systematic LazyVim keymap replica

Complete rewrite of `src/lazyvim/keymaps.ts` as a faithful replica of
LazyVim's default keymap spec: every LazyVim default is either mapped
to a native VSCode feature or **dropped with a documented reason** (the
`DROPPED` section in the file). Added: `gy`, `<leader>co/cs/cS/cd`,
`<leader><tab>*`, `<leader>bo`, `]h/[h` (later removed), `<leader>db/dc`,
`<leader>xq`, `<leader>uC/un/um/uz/up`, `<leader>l` (later removed),
`<leader>?`, `<leader>ft`, visual `gc`. Removed dead `<A-j>/<A-k>` trie
entries (Alt keys never reach `type` on macOS; VSCode's native
Alt+↑/↓ already moves lines).

## [0.0.12] — Keybinding cleanup #1 + SCM

Removed `<leader>ff`, `<leader>fg` (duplicates), `<leader>qq`
(dangerous), `<leader>bb`/`bd` (no buffers). `<leader>gg` → native
Source Control view (was lazygit-in-terminal).

## [0.0.11] — Status badge visibility fix

Badge was invisible: Catppuccin Mocha silently drops unknown ThemeColor
ids (`charts.*`) for `backgroundColor`, and dark custom text went
dark-on-dark. Fix: only `statusBarItem.*` ids (prominent/warning/error
— the three visually distinct families), no custom text color.

## [0.0.10] — Status badge position/colors

- Priority `-100` → `10000` (higher = further left; badge is now first
  from left in the right-side group)
- Tried `charts.*` colors (later reverted in 0.0.11)

## [0.0.9] — Engine pending-input bypass (critical architecture fix)

The engine's mid-sequence states were invisible to the router, so trie
bindings hijacked argument keys:

| Sequence | Before | After |
|---|---|---|
| `f/` | opened find widget | finds next `/` |
| `dn` | next-match + stale pending `d` | cancelled like vim |
| `diw`/`ci"` | `i` hit the package.json `enterInsertMode` binding → operator lost | text objects work |

- New `engine.hasPendingInput()` — router bypasses the trie when the
  engine is mid-sequence (operator-pending, find-char arg, register/
  mark/macro names, `r`/`z` args)
- Removed `i`/`v`/`V` package.json bridge bindings — they now flow
  through the router into the engine (correct operator-pending behavior)
- `escape` in Normal mode clears pending state, scoped with
  `!findWidgetVisible && !suggestWidgetVisible && !inSnippetMode`
- Full fold `z`-family: `za zc zo zC zO zM zR zv zj zk zx` (which-key
  shows fold hints under `z`)
- `J`/`K` reverted to vim defaults (join lines / hover); `gt`/`gT` tabs
- Status badge moved to right side

## [0.0.8] — Badge colors + `<S-j>/<S-k>` (later reverted)

- Zed-style mode badge: per-mode background colors
- `<leader>e` hardened: `getContext` failure can no longer kill the
  command silently (tracked-flag fallback)

## [0.0.7] — `<leader>e` explorer toggle

New `lazycode.toggleExplorer` command: focus tree if not focused, close
if focused (reads `filesExplorerFocus` via internal `getContext`).

## [0.0.6] — Explorer vim navigation

`j/k` move, `h` collapse, `l` open/expand, `gg`/`G` first/last — via
native List widget commands, scoped `filesExplorerFocus && !inputFocus`.

## [0.0.5] — `/` in file explorer

`/` and `?` open the explorer's native find box (`list.find`).

## [0.0.4] — Leader rewrite (critical bug)

Nothing translated physical `<space>` to `<leader>` — every leader
binding was unreachable. Fix: router rewrites the configured leader key
to `<leader>` at sequence start (mid-sequence `<space>` stays literal,
so `<leader><space>` works). Which-key popup now works too.
`<C-o>/<C-i>` switched to VSCode's native navigation history
(`navigateBack/Forward` — tracks gd, file switches, across editors).

## [0.0.3] — Mode cursor shapes

Block cursor in Normal/Visual, beam in Insert, applied to all visible
editors on mode change. Visual inclusivity test suite (cursor char
always included in `y`/`d`/`c`, backward selections, line-end clamping).

## [0.0.2] — Native find + Ctrl chords fix

- `/` `?` → native find widget; `n N * #` → native find navigation;
  `<leader>/` → global find
- Ctrl chords never reach the `type` command — `<C-o>/<C-i>` (jumplist),
  `<C-r>` (redo), `<C-h/j/k/l>` (window nav), `<C-w>v/s` (splits) moved
  to package.json keybindings with `lazycode.mode` when-clauses

## [0.0.1] — Initial release

**Engine (pure TS, zero `vscode` imports, headless-testable):**
- Keystroke pipeline: notation normalization, binding trie, single
  router interception point, Insert-mode passthrough with raw-text flush
- Mode state machine + `lazycode.mode` context keys + status bar item
- Motions `hjkl wbe 0^$ fFtT;, gg G %` (counts, vim char classes,
  inclusive/linewise flags, `cw`≈`ce` quirk)
- Operators `d c y > <` with one-undo-stop-per-action batching and
  linewise EOF edge cases
- Text objects `iw aw i" a" i' a' i` a` i( a( i[ i{ b B ip ap`
- Dot-repeat via keystroke recording incl. insert sessions; registers
  `"a-z`/`"`/`"0`; marks + `''`; jumplist; macros `q/@/@@`; search
  engine; `r ~ J x X s D C Y p P o O i a I A`; visual charwise/linewise;
  indent operators `>> << >j >ip` (dot-repeatable); `zz/zt/zb`
- Which-key popup (QuickPick as floating hint display, typed chars
  forwarded back into the router, 300 ms delay)

**LazyVim layer:** declarative keymap table → native VSCode commands;
`<space>` leader.

**Infra:** esbuild bundle, vitest (211 tests at release), strict TS,
`ARCHITECTURE.md` (core invariants), custom icon.

---

## Core invariants (held across all versions)

1. The engine never imports `vscode` (only `extension.ts` +
   `vs/vsEditorContext.ts` do) — everything else is headless-testable.
2. Single keystroke interception point (`KeystrokeRouter`); single edit
   chokepoint (`EditorContext.applyEdits`) — one undo stop per action.
3. Bindings compose via the trie; vim semantics are hand-implemented,
   IDE features delegate to native commands.
4. Engine pending input always beats trie bindings (argument keys can
   never be hijacked).
