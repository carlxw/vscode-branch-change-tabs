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
- `branchTabs.includeModifiedFiles` (boolean, default: `true`)
  - Open files modified relative to the base branch.
- `branchTabs.includeNewlyTrackedFiles` (boolean, default: `true`)
  - Open files newly added relative to the base branch.
- `branchTabs.pinModifiedFiles` (boolean, default: `true`)
  - Pin modified files when opening.
- `branchTabs.pinNewlyTrackedFiles` (boolean, default: `true`)
  - Pin newly added files when opening.
- `branchTabs.excludedFiles` (array, default: common image/binary patterns and git meta files)
  - Regex strings to exclude files from opening (matched against repo-relative paths).
  - Supports either `pattern` or `/pattern/flags` formats.
  - Files ignored by `.gitignore` are already excluded.
  - Common patterns: `\\.png$`, `\\.jpe?g$`, `\\.svg$`, `\\.gif$`, `\\.pdf$`, `\\.zip$`, `\\.gz$`, `\\.7z$`, `\\.exe$`, `\\.dmg$`, `^\\.gitignore$`
- `branchTabs.maxFilesToOpen` (number, default: `10`)
  - Opens up to this many text files when more are changed.
- `branchTabs.textFilesOnly` (boolean, default: `true`)
  - Only open text files and skip binaries.
- `branchTabs.excludedDirectories` (array, default: `[]`)
  - Regex strings to exclude directories (matched against repo-relative paths).
  - Recommended: `^dist/`, `^build/`, `^out/`, `^coverage/`, `^node_modules/`, `^\\.turbo/`, `^\\.next/`
- `branchTabs.closePinnedTabsOnBranchChange` (boolean, default: `false`)
  - Closes pinned tabs that were opened by this extension when switching branches.
- `branchTabs.closeAllOnExcludedBranch` (boolean, default: `true`)
  - Closes tabs previously opened by the extension when switching to an excluded branch.
- `branchTabs.promptOnNewRepository` (boolean, default: `true`)
  - Prompt to enable or disable the extension when a new repository is opened.
- `branchTabs.disabledRepositories` (array, default: `[]`)
  - List of repository root paths where the extension is disabled.

## Commands
- `Branch Change Tabs: Open Changed Files`
  - Opens the current branch's changed files for the active repository using your configured settings.
- `Branch Change Tabs: Close Pinned Tabs in Active Group`
  - Closes pinned tabs in the currently active editor group.
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
