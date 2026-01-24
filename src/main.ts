import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

interface RepositoryState {
  HEAD?: Branch;
  onDidChange: vscode.Event<void>;
}

interface Branch {
  name?: string;
  upstream?: { name?: string };
}

type ChangeKind = "modified" | "added";

type ChangedFile = {
  path: string;
  kind: ChangeKind;
};

type RepoState = {
  lastBranch?: string;
  pendingTimer?: NodeJS.Timeout;
  openedFiles: Set<string>;
};

const repoStates = new Map<string, RepoState>();
const output = vscode.window.createOutputChannel("Branch Change Tabs");
const repoEnabledCache = new Map<string, boolean>();
let extensionContext: vscode.ExtensionContext | undefined;
const DEV_CLEAR_COMMAND = "branchTabs.dev.clearRepoDecisions";
const OPEN_CHANGED_COMMAND = "branchTabs.openChangedFiles";
const CLOSE_PINNED_GROUP_COMMAND = "branchTabs.closePinnedTabsInGroup";

/**
 * Entry point for the extension; wires up git repository listeners.
 */
export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  if (!gitExtension) {
    output.appendLine("Git extension not found. Branch Change Tabs is inactive.");
    return;
  }

  const git = gitExtension.getAPI(1);

  for (const repo of git.repositories) {
    void trackRepository(repo, context);
  }

  context.subscriptions.push(
    git.onDidOpenRepository((repo) => void trackRepository(repo, context))
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const clearCommand = vscode.commands.registerCommand(DEV_CLEAR_COMMAND, async () => {
      await clearRepoDecisions(context);
      output.appendLine("Cleared stored repo decisions (dev command).");
      void vscode.window.showInformationMessage("Branch Change Tabs: cleared stored repo decisions.");
    });
    context.subscriptions.push(clearCommand);
  }

  const openChangedCommand = vscode.commands.registerCommand(OPEN_CHANGED_COMMAND, async () => {
    const repo = getActiveRepository();
    if (!repo) {
      void vscode.window.showInformationMessage("Branch Change Tabs: no active repository found.");
      return;
    }
    await openChangedFilesForRepo(repo, { ignoreEnablement: true });
  });
  context.subscriptions.push(openChangedCommand);

  const closePinnedGroupCommand = vscode.commands.registerCommand(
    CLOSE_PINNED_GROUP_COMMAND,
    async () => {
      await closePinnedTabsInActiveGroup();
    }
  );
  context.subscriptions.push(closePinnedGroupCommand);
}

/**
 * Registers listeners for a git repository and debounces state changes.
 */
async function trackRepository(repo: Repository, context: vscode.ExtensionContext) {
  const key = repo.rootUri.fsPath;
  if (repoStates.has(key)) {
    return;
  }

  repoStates.set(key, { lastBranch: repo.state.HEAD?.name, openedFiles: new Set() });

  const subscription = repo.state.onDidChange(() => {
    const state = repoStates.get(key);
    if (!state) {
      return;
    }
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
    }
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = undefined;
      void handleRepositoryChange(repo);
    }, 200);
  });

  context.subscriptions.push(subscription);
}

/**
 * Handles a repository state change by opening the branch's changed files.
 */
async function handleRepositoryChange(repo: Repository) {
  const key = repo.rootUri.fsPath;
  const state = repoStates.get(key);
  if (!state) {
    return;
  }

  const currentBranch = repo.state.HEAD?.name;
  const previousBranch = state.lastBranch;
  state.lastBranch = currentBranch;

  if (!currentBranch || currentBranch === previousBranch) {
    return;
  }

  const settings = getSettings();
  const enabled = await ensureRepoEnabledOnFirstCheckout(repo, settings);
  if (!enabled) {
    output.appendLine(`Repository disabled by user: ${key}`);
    return;
  }
  if (settings.excludedBranches.includes(currentBranch)) {
    output.appendLine(`Branch "${currentBranch}" excluded.`);
    if (settings.closeAllOnExcludedBranch) {
      await closeOpenedFiles(state);
    }
    return;
  }

  output.appendLine(`Branch changed: ${previousBranch ?? "(unknown)"} -> ${currentBranch}`);
  await openChangedFilesForRepo(repo, { ignoreEnablement: false });
}

/**
 * Loads extension settings from the VS Code configuration.
 */
function getSettings() {
  const config = vscode.workspace.getConfiguration("branchTabs");
  return {
    excludedBranches: config.get<string[]>("excludedBranches", ["main", "master"]),
    closeAllBeforeOpen: config.get<boolean>("closeAllBeforeOpen", true),
    includeModified: config.get<boolean>("includeModified", true),
    includeAdded: config.get<boolean>("includeAdded", true),
    pinModified: config.get<boolean>("pinModified", true),
    pinAdded: config.get<boolean>("pinAdded", true),
    excludedFiles: config.get<string[]>("excludedFiles", []),
    maxFilesToOpen: config.get<number>("maxFilesToOpen", 10),
    textFilesOnly: config.get<boolean>("textFilesOnly", true),
    excludeDirRegexes: config.get<string[]>("excludeDirRegexes", []),
    closePinnedTabsOnBranchChange: config.get<boolean>("closePinnedTabsOnBranchChange", false),
    closeAllOnExcludedBranch: config.get<boolean>("closeAllOnExcludedBranch", true),
    promptOnNewRepo: config.get<boolean>("promptOnNewRepo", true),
    enabledRepos: config.get<string[]>("enabledRepos", []),
    baseBranch: config.get<string>("baseBranch", "")
  };
}

/**
 * Determines the base ref used for diffing a branch.
 */
async function resolveBaseRef(
  repoRoot: string,
  configuredBase: string,
  currentBranch?: string,
  upstream?: string
): Promise<string | undefined> {
  if (configuredBase && configuredBase.trim().length > 0) {
    return configuredBase.trim();
  }

  if (await refExists(repoRoot, "main")) {
    return "main";
  }
  if (await refExists(repoRoot, "master")) {
    return "master";
  }

  if (upstream && upstream.trim().length > 0) {
    const upstreamRef = upstream.trim();
    if (currentBranch && upstreamRef.endsWith(`/${currentBranch}`)) {
      return undefined;
    }
    return upstreamRef;
  }

  return undefined;
}

/**
 * Checks whether a git ref exists in the repository.
 */
async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await execGit(repoRoot, ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns repo-relative file paths changed between base and head refs.
 */
async function getChangedFiles(
  repoRoot: string,
  baseRef: string,
  headRef: string
): Promise<ChangedFile[]> {
  try {
    const { stdout } = await execGit(repoRoot, ["diff", "--name-status", `${baseRef}...${headRef}`]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseNameStatus(line))
      .filter((entry): entry is ChangedFile => Boolean(entry));
  } catch (error) {
    output.appendLine(`Failed to diff ${baseRef}...${headRef}: ${stringifyError(error)}`);
    return [];
  }
}

function parseNameStatus(line: string): ChangedFile | undefined {
  const parts = line.split(/\t+/);
  const status = parts[0];
  if (!status) {
    return undefined;
  }

  if (status.startsWith("R") || status.startsWith("C")) {
    const newPath = parts[2];
    if (!newPath) {
      return undefined;
    }
    return { path: newPath, kind: "modified" };
  }

  const filePath = parts[1];
  if (!filePath) {
    return undefined;
  }

  if (status === "A") {
    return { path: filePath, kind: "added" };
  }
  if (status === "M") {
    return { path: filePath, kind: "modified" };
  }

  return undefined;
}

/**
 * Filters files by change kind based on user settings.
 */
function filterByChangeKind(
  files: ChangedFile[],
  includeModified: boolean,
  includeAdded: boolean
): ChangedFile[] {
  if (includeModified && includeAdded) {
    return files;
  }
  if (!includeModified && !includeAdded) {
    return [];
  }
  return files.filter((file) => (includeModified ? file.kind === "modified" : file.kind === "added"));
}

/**
 * Filters files that match any of the configured exclude regexes.
 */
function filterExcluded(files: ChangedFile[], regexes: string[]): ChangedFile[] {
  const compiled = regexes
    .map((pattern) => parseRegex(pattern))
    .filter((regex): regex is RegExp => Boolean(regex));
  if (compiled.length === 0) {
    return files;
  }
  return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}

/**
 * Filters files whose repo-relative paths match any directory regex.
 */
function filterExcludedDirectories(files: ChangedFile[], dirRegexes: string[]): ChangedFile[] {
  const compiled = dirRegexes
    .map((pattern) => parseRegex(pattern))
    .filter((regex): regex is RegExp => Boolean(regex));
  if (compiled.length === 0) {
    return files;
  }
  return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}

/**
 * Parses a regex string, supporting "/pattern/flags" or "pattern" formats.
 */
function parseRegex(value: string): RegExp | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const lastSlash = trimmed.lastIndexOf("/");
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1);
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
      return undefined;
    }
  }

  try {
    return new RegExp(trimmed);
  } catch (error) {
    output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
    return undefined;
  }
}

/**
 * Checks if a file exists on disk via the VS Code FS API.
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filters out files that cannot be opened as text documents.
 */
async function filterTextFiles(
  repoRoot: string,
  files: ChangedFile[]
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
    if (!(await fileExists(fileUri))) {
      continue;
    }
    try {
      await vscode.workspace.openTextDocument(fileUri);
      result.push(file);
    } catch (error) {
      output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
    }
  }
  return result;
}

/**
 * Prompts whether to open files when the max limit is exceeded.
 */
async function promptOpenWhenLimitExceeded(
  totalFiles: number,
  limit: number
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Branch Change Tabs: ${totalFiles} files changed, which exceeds the limit (${limit}). Open up to ${limit} files?`,
    "Open",
    "Cancel"
  );
  return choice === "Open";
}

/**
 * Optionally updates the maxFilesToOpen setting (workspace or user scope).
 */
async function maybeUpdateMaxFilesLimit(currentLimit: number): Promise<void> {
  const scopeChoice = await vscode.window.showInformationMessage(
    "Change the max files to open?",
    "No",
    "This Workspace",
    "User (Global)"
  );

  if (scopeChoice !== "This Workspace" && scopeChoice !== "User (Global)") {
    return;
  }

  const newValue = await vscode.window.showInputBox({
    prompt: "Enter new maxFilesToOpen value",
    value: String(currentLimit),
    validateInput: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return "Enter a whole number (0 or greater).";
      }
      return undefined;
    }
  });

  if (newValue === undefined) {
    return;
  }

  const parsed = Number(newValue);
  const config = vscode.workspace.getConfiguration("branchTabs");
  const isGlobal = scopeChoice === "User (Global)";
  await config.update("maxFilesToOpen", parsed, isGlobal);
}

/**
 * Executes a git command in the repository root.
 */
async function execGit(repoRoot: string, args: string[]) {
  return execFileAsync("git", args, { cwd: repoRoot, windowsHide: true });
}

/**
 * Formats an error into a readable message.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Closes tabs that were opened by the extension.
 */
async function closeOpenedFiles(state: RepoState) {
  if (state.openedFiles.size === 0) {
    return;
  }

  const toClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (state.openedFiles.has(input.uri.toString())) {
          toClose.push(tab);
        }
      }
    }
  }

  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose, true);
  }
  state.openedFiles.clear();
}

/**
 * Closes only pinned tabs that were opened by the extension.
 */
async function closePinnedOpenedFiles(state: RepoState) {
  if (state.openedFiles.size === 0) {
    return;
  }

  const toClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!tab.isPinned) {
        continue;
      }
      const input = tab.input;
      if (input instanceof vscode.TabInputText) {
        if (state.openedFiles.has(input.uri.toString())) {
          toClose.push(tab);
        }
      }
    }
  }

  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose, true);
  }
  for (const tab of toClose) {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) {
      state.openedFiles.delete(input.uri.toString());
    }
  }
}

/**
 * Clears stored repo enable/disable decisions (dev helper).
 */
async function clearRepoDecisions(context: vscode.ExtensionContext): Promise<void> {
  repoEnabledCache.clear();
  const keys = context.globalState.keys().filter((key) => key.startsWith("repoEnabled:"));
  for (const key of keys) {
    await context.globalState.update(key, undefined);
  }
}

/**
 * Finds the active repository based on the current editor or first repo.
 */
function getActiveRepository(): Repository | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  if (!gitExtension) {
    return undefined;
  }
  const git = gitExtension.getAPI(1);
  if (active) {
    const match = git.repositories.find((repo) =>
      active.fsPath.toLowerCase().startsWith(repo.rootUri.fsPath.toLowerCase())
    );
    if (match) {
      return match;
    }
  }
  return git.repositories[0];
}

/**
 * Opens changed files for a repository using current configuration.
 */
async function openChangedFilesForRepo(
  repo: Repository,
  options: { ignoreEnablement: boolean }
): Promise<void> {
  const settings = getSettings();
  if (settings.excludedBranches.includes(repo.state.HEAD?.name ?? "")) {
    output.appendLine(`Branch "${repo.state.HEAD?.name}" excluded.`);
    return;
  }
  if (!options.ignoreEnablement) {
    const enabled = await ensureRepoEnabledOnFirstCheckout(repo, settings);
    if (!enabled) {
      output.appendLine(`Repository disabled by user: ${repo.rootUri.fsPath}`);
      return;
    }
  }

  const repoRoot = repo.rootUri.fsPath;
  const headName = repo.state.HEAD?.name;
  const baseRef = await resolveBaseRef(
    repoRoot,
    settings.baseBranch,
    headName,
    repo.state.HEAD?.upstream?.name
  );
  if (!baseRef || !headName) {
    output.appendLine("No base ref found. Skipping diff.");
    return;
  }

  output.appendLine(`Using base ref: ${baseRef}`);

  const changedFiles = await getChangedFiles(repoRoot, baseRef, headName);
  if (!changedFiles.length) {
    output.appendLine("No changed files found for branch diff.");
    return;
  }

  const selectableFiles = filterByChangeKind(changedFiles, settings.includeModified, settings.includeAdded);
  if (!selectableFiles.length) {
    output.appendLine("No files matched change-type filters.");
    return;
  }

  output.appendLine(`Changed files found: ${selectableFiles.length}`);

  const filteredFiles = filterExcluded(
    filterExcludedDirectories(selectableFiles, settings.excludeDirRegexes),
    settings.excludedFiles
  );
  if (!filteredFiles.length) {
    output.appendLine("All changed files were excluded by regex.");
    return;
  }

  output.appendLine(`Files after regex filter: ${filteredFiles.length}`);

  let filesToConsider = filteredFiles;
  if (settings.textFilesOnly) {
    filesToConsider = await filterTextFiles(repoRoot, filteredFiles);
    output.appendLine(`Text files after filter: ${filesToConsider.length}`);
    if (filesToConsider.length === 0) {
      output.appendLine("No text files found for branch diff.");
      return;
    }
  }

  const maxToOpen = settings.maxFilesToOpen > 0 ? settings.maxFilesToOpen : Infinity;
  if (settings.maxFilesToOpen > 0 && filesToConsider.length > settings.maxFilesToOpen) {
    output.appendLine(
      `Limit exceeded: ${filesToConsider.length} files exceeds maxFilesToOpen=${settings.maxFilesToOpen}`
    );
    const shouldOpen = await promptOpenWhenLimitExceeded(
      filesToConsider.length,
      settings.maxFilesToOpen
    );
    if (!shouldOpen) {
      return;
    }
    await maybeUpdateMaxFilesLimit(settings.maxFilesToOpen);
  }

  const state = repoStates.get(repoRoot);
  if (state) {
    if (settings.closePinnedTabsOnBranchChange) {
      await closePinnedOpenedFiles(state);
    } else {
      await closeOpenedFiles(state);
    }
  }

  if (settings.closeAllBeforeOpen) {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }

  let openedCount = 0;
  for (const file of filesToConsider) {
    if (openedCount >= maxToOpen) {
      break;
    }
    const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
    if (!(await fileExists(fileUri))) {
      continue;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      });
      const shouldPin = file.kind === "modified" ? settings.pinModified : settings.pinAdded;
      if (shouldPin) {
        await vscode.commands.executeCommand("workbench.action.pinEditor");
      }
      if (state) {
        state.openedFiles.add(fileUri.toString());
      }
      openedCount += 1;
    } catch (error) {
      output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
    }
  }

  if (openedCount === 0) {
    output.appendLine("No text files were opened.");
  }
}

/**
 * Closes pinned tabs in the active editor group.
 */
async function closePinnedTabsInActiveGroup(): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup;
  const toClose = group.tabs.filter((tab) => tab.isPinned);
  if (toClose.length === 0) {
    void vscode.window.showInformationMessage("Branch Change Tabs: no pinned tabs in active group.");
    return;
  }
  await vscode.window.tabGroups.close(toClose, true);
}

/**
 * Ensures repo enablement state is known, prompting once if needed.
 */
async function ensureRepoEnabledOnFirstCheckout(
  repo: Repository,
  settings: ReturnType<typeof getSettings>
): Promise<boolean> {
  if (!extensionContext) {
    return true;
  }
  const key = repo.rootUri.fsPath;
  if (settings.enabledRepos.length > 0) {
    const normalized = new Set(settings.enabledRepos.map((entry) => entry.trim()).filter(Boolean));
    const enabled = normalized.has(key);
    repoEnabledCache.set(key, enabled);
    return enabled;
  }
  const cached = repoEnabledCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const stored = extensionContext.globalState.get<boolean>(`repoEnabled:${key}`);
  if (stored !== undefined) {
    repoEnabledCache.set(key, stored);
    return stored;
  }

  if (!settings.promptOnNewRepo) {
    repoEnabledCache.set(key, true);
    await extensionContext.globalState.update(`repoEnabled:${key}`, true);
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    "Enable Branch Change Tabs for this repository?",
    { modal: true, detail: key },
    "Enable",
    "Disable"
  );

  const enabled = choice === "Enable";
  repoEnabledCache.set(key, enabled);
  await extensionContext.globalState.update(`repoEnabled:${key}`, enabled);
  return enabled;
}

/**
 * Extension deactivation hook (no-op).
 */
export function deactivate() {}
