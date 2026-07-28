# LazyCode

**LazyVim-style keybindings for VSCode** — a vim engine written from scratch in
pure TypeScript. No Neovim process, no Lua, no dependency on other vim
extensions. Every motion, operator, and text object is implemented natively;
LazyVim's `<leader>` workflows map onto built-in VSCode commands.

## Features

- **Full vim core**: Normal / Insert / Visual / VisualLine modes
  - Motions: `h j k l w b e 0 ^ $ f F t T ; , gg G %` + counts (`3dw`, `d2w`)
  - LazyVim-style `j`/`k`: display-line movement on wrapped lines (no count),
    logical lines with a count or pending operator; explicit `gj`/`gk` too
  - Operators: `d c y > <` (incl. `dd`, `cc`, `yy`, `>>`, `<<`)
  - Text objects: `iw aw i" a" i' a' i` a` i( a( i[ i{ b B ip ap`
  - `.` dot-repeat (including insert sessions: `ciwfoo<esc>` repeats fully)
  - Registers `"a-z`, unnamed `"`, yank register `"0`
  - Marks `ma` `` `a `` `'a` `''`, jumplist `<C-o>` / `<C-i>`
  - Macros `qa` / `@a` / `@@`
  - Search: `/` `?` open the **native find widget**; `n` `N` `*` `#` navigate
    native find matches; `<leader>/` opens global find (⌘⇧F)
  - `r` replace, `~` case, `J` join, `x X s D C Y p P`, `zz zt zb`
- **LazyVim keymaps** (`<space>` leader) — a systematic replica of LazyVim's
  defaults: every LazyVim key is mapped to a **native** VSCode feature, or
  dropped (all drops documented in `src/lazyvim/keymaps.ts`):
  - Files: `<leader><space>` find · `<leader>/` global grep · `<leader>e` explorer · `<leader>fr` recent · `<leader>fn` new
  - Code: `gd gr gI gy K` · `<leader>ca/cr/cf/co/cs/cS/cd` · `[d ]d` · `gcc`/`gc`
  - Windows: `<leader>w h/j/k/l/s/v/=/d` · `<leader>-` `<leader>|` · `<C-h/j/k/l>` focus nav
  - Tabs: `gt gT` · `<leader><tab> [/]/d/<tab>` · `<S-h>/<S-l>` `[b ]b` · `<leader>bo`
  - Git: `<leader>gg` source control · `<leader>gb` blame · `[h ]h` hunks
  - Folds: `za zc zo zC zO zM zR zv zj zk zx`
  - Debug: `<leader>db` breakpoint · `<leader>dc` continue
  - UI: `<leader>uw` wrap · `<leader>uC` theme · `<leader>un` dismiss notifications · `<leader>um/uz/up` (extras)
  - Misc: `<leader>l` extensions · `<leader>?` keybindings · `<leader>ft` terminal · `<leader>xq` problems
- **Which-key popup** — shows available bindings after a short delay when you
  press `<leader>` (or `g`, `[`, `<C-w>`, …)

## Settings

| Setting | Default | Description |
|---|---|---|
| `lazycode.leaderKey` | `<space>` | Leader key |
| `lazycode.whichKey` | `true` | Show the which-key popup |
| `lazycode.whichKeyDelay` | `300` | Delay (ms) before the popup appears |

## Notes

- **Disable other vim extensions** (VSCodeVim, vscode-neovim) — they fight
  over the same keystrokes.
- Ctrl-chords (`<C-o>` `<C-i>` `<C-r>` `<C-h/j/k/l>` `<C-w>v/s`) are bound
  through VSCode's keybinding system with `lazycode.mode` when-clauses —
  they take precedence over the defaults only while LazyCode is in Normal mode.
- Undo/redo (`u` / `<C-r>`) use VSCode's native undo stack — every vim action
  is exactly one undo stop.
