# AGENTS.md — Working agreements for this repo

These rules apply to every change made in this repository, whether by a
human or an AI coding agent. Read them **before** starting work.

## 1. Commit incrementally

- Commit changes in small, logical increments — one commit per coherent
  change (a fix, a feature, a refactor), not one giant commit at the end.
- Follow the existing conventional-commit style seen in `git log`:
  `fix(scope): …`, `feat(scope): …`, `chore(scope): …`.
- Never commit session artifacts (e.g. `*.jsonl` session logs,
  `pi-session-*.html`).

## 2. Keep CHANGELOG.md up to date

- Every user-visible change gets an entry in `CHANGELOG.md`, newest first,
  under a `## [version] — title` heading matching the version in
  `package.json`.
- Describe *what* changed and *why*, including the user-visible symptom for
  bug fixes. Mention new/updated tests and the running test total.
- Keep the "Core invariants" section at the bottom intact and accurate.

## 3. Version bumps (semver, strictly)

Update the `version` field in `package.json` with **every** change:

- **Patch** (x.y.Z → x.y.Z+1): minor updates and bug fixes.
- **Minor** (x.Y.z → x.Y+1.0): new features / new functionality.
- **Major** (X.y.z → X+1.0.0): breaking changes (changed default behavior
  users rely on, removed settings/bindings, API changes).

The changelog heading and `package.json` version must always match.

## 4. Keep ARCHITECTURE.md up to date

- Any change that alters a core mechanism (keystroke pipeline, router,
  engine, mode handling, edit chokepoint, which-key flow, keymap layer)
  must be reflected in `ARCHITECTURE.md` in the same commit.
- The "Core invariants" list is sacred: if a change would violate one, stop
  and reconsider the design instead of weakening the invariant silently.

## 5. Tests

- Run `npx tsc --noEmit` and `npx vitest run` before committing; both must
  pass.
- Bug fixes come with a regression test; features come with coverage in the
  appropriate `test/*.test.ts` file. Keep the engine headless-testable
  (no `vscode` imports outside `extension.ts` and `src/vs/`).

## 6. Install every change into VSCode

- **Every** completed change — fix, feature, or chore that affects the
  shipped extension — ends with packaging and installing the new version
  into VSCode so the user always runs the latest build:

  ```sh
  npm run release
  ```

  This runs the tests, bundles with esbuild, packages the `.vsix` with
  `vsce`, and installs it via `code --install-extension … --force`
  (user reloads the window to activate it). Do this AFTER the version bump
  so the installed `.vsix` matches `package.json`.
