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

/**
 * Entry point for the extension; wires up git repository listeners.
 */
export function activate(context: vscode.ExtensionContext) {
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  if (!gitExtension) {
    output.appendLine("Git extension not found. Branch Change Tabs is inactive.");
    return;
  }

  const git = gitExtension.getAPI(1);

  for (const repo of git.repositories) {
    trackRepository(repo, context);
  }

  context.subscriptions.push(
    git.onDidOpenRepository((repo) => trackRepository(repo, context))
  );
}

/**
 * Registers listeners for a git repository and debounces state changes.
 */
function trackRepository(repo: Repository, context: vscode.ExtensionContext) {
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
  if (settings.excludedBranches.includes(currentBranch)) {
    output.appendLine(`Branch "${currentBranch}" excluded.`);
    if (settings.closeAllOnExcludedBranch) {
      await closeOpenedFiles(state);
    }
    return;
  }

  output.appendLine(`Branch changed: ${previousBranch ?? "(unknown)"} -> ${currentBranch}`);

  const repoRoot = repo.rootUri.fsPath;
  const baseRef = await resolveBaseRef(
    repoRoot,
    settings.baseBranch,
    repo.state.HEAD?.name,
    repo.state.HEAD?.upstream?.name
  );
  if (!baseRef) {
    output.appendLine("No base ref found. Skipping diff.");
    return;
  }

  output.appendLine(`Using base ref: ${baseRef}`);

  const changedFiles = await getChangedFiles(repoRoot, baseRef, currentBranch);
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
    filterExcludedExtensions(
      filterExcludedDirectories(selectableFiles, settings.excludeDirRegexes),
      settings.excludeExtensions
    ),
    settings.excludeRegexes
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
      `Limiting open: ${filesToConsider.length} files exceeds maxFilesToOpen=${settings.maxFilesToOpen}`
    );
    vscode.window.showWarningMessage(
      `Branch Change Tabs: ${filesToConsider.length} files changed, opening up to ${settings.maxFilesToOpen} text files.`
    );
  }

  // Always clear previously opened tabs from the extension when switching branches.
  await closeOpenedFiles(state);

  if (settings.closePinnedTabsOnBranchChange) {
    await vscode.commands.executeCommand("workbench.action.closeAllPinnedEditors");
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
        const shouldPin =
          file.kind === "modified" ? settings.pinModified : settings.pinAdded;
        if (shouldPin) {
          await vscode.commands.executeCommand("workbench.action.pinEditor");
        }
        state.openedFiles.add(fileUri.toString());
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
 * Loads extension settings from the VS Code configuration.
 */
function getSettings() {
  const config = vscode.workspace.getConfiguration("branchTabs");
  return {
    excludedBranches: config.get<string[]>("excludedBranches", ["main", "master"]),
    closeAllBeforeOpen: config.get<boolean>("closeAllBeforeOpen", true),
    pinOpenedTabs: config.get<boolean>("pinOpenedTabs", true),
    includeModified: config.get<boolean>("includeModified", true),
    includeAdded: config.get<boolean>("includeAdded", true),
    pinModified: config.get<boolean>("pinModified", config.get<boolean>("pinOpenedTabs", true)),
    pinAdded: config.get<boolean>("pinAdded", config.get<boolean>("pinOpenedTabs", true)),
    excludeRegexes: config.get<string[]>("excludeRegexes", []),
    maxFilesToOpen: config.get<number>("maxFilesToOpen", 10),
    textFilesOnly: config.get<boolean>("textFilesOnly", true),
    excludeExtensions: config.get<string[]>("excludeExtensions", []),
    excludeDirRegexes: config.get<string[]>("excludeDirRegexes", []),
    closePinnedTabsOnBranchChange: config.get<boolean>("closePinnedTabsOnBranchChange", false),
    closeAllOnExcludedBranch: config.get<boolean>("closeAllOnExcludedBranch", true),
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
 * Filters files that match any excluded extension (case-insensitive).
 */
function filterExcludedExtensions(files: ChangedFile[], extensions: string[]): ChangedFile[] {
  if (!extensions.length) {
    return files;
  }
  const normalized = new Set(
    extensions
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0)
      .map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
  );
  if (normalized.size === 0) {
    return files;
  }
  return files.filter((file) => {
    const lower = file.path.toLowerCase();
    for (const ext of normalized) {
      if (lower.endsWith(ext)) {
        return false;
      }
    }
    return true;
  });
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
 * Extension deactivation hook (no-op).
 */
export function deactivate() {}
