# Branch Change Tabs

Open all files that were changed on the current git branch whenever you switch branches
(excluding configured branches like `main`/`master`).

## What it does
- Detects git branch switches in the current repository.
- Diffs the current branch against a base ref (upstream if set; otherwise `main`/`master`).
- Opens all changed files, optionally pinning them and optionally closing existing tabs first.
- Skips branches in a configurable exclude list.
- Skips files that match any configured regex.

## Configuration
These settings live under `branchTabs.*`:

- `branchTabs.excludedBranches` (array, default: `["main","master"]`)
  - Branch names that should not trigger auto-opening files.
- `branchTabs.closeAllBeforeOpen` (boolean, default: `true`)
  - Close all open editors before opening changed files.
- `branchTabs.pinOpenedTabs` (boolean, default: `true`)
  - When `true`, opened tabs are pinned (preview disabled).
  - When `false`, files open as previews (VS Code may keep only one preview per editor group).
- `branchTabs.excludeRegexes` (array, default: `[]`)
  - Regex strings to exclude files from opening (matched against repo-relative paths).
  - Supports either `pattern` or `/pattern/flags` formats.
- `branchTabs.maxFilesToOpen` (number, default: `10`)
  - Aborts opening files when the number of changed files exceeds this limit.
- `branchTabs.closeAllOnExcludedBranch` (boolean, default: `true`)
  - Closes tabs previously opened by the extension when switching to an excluded branch.
- `branchTabs.baseBranch` (string, default: `""`)
  - Optional base branch/ref to diff against. If empty, uses upstream if set; otherwise
  `main`/`master` when available.

## How to test locally (Extension Development Host)
1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run build`.
4. Press `F5` to start an Extension Development Host.
5. In the new VS Code window, open a git repo and switch branches:
   - `git switch <branch>` or `git checkout <branch>`
   - The extension should open all files changed on that branch.

## Notes
- The extension triggers only on branch change events (not on VS Code startup).
- Output logs are available in the Output panel under **Branch Change Tabs**.
