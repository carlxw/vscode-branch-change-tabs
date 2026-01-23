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

type RepoState = {
  lastBranch?: string;
  pendingTimer?: NodeJS.Timeout;
  openedFiles: Set<string>;
};

const repoStates = new Map<string, RepoState>();
const output = vscode.window.createOutputChannel("Branch Change Tabs");

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

  output.appendLine(`Changed files found: ${changedFiles.length}`);

  const filteredFiles = filterExcluded(changedFiles, settings.excludeRegexes);
  if (!filteredFiles.length) {
    output.appendLine("All changed files were excluded by regex.");
    return;
  }

  output.appendLine(`Files after regex filter: ${filteredFiles.length}`);

  if (settings.maxFilesToOpen > 0 && filteredFiles.length > settings.maxFilesToOpen) {
    output.appendLine(
      `Aborting open: ${filteredFiles.length} files exceeds maxFilesToOpen=${settings.maxFilesToOpen}`
    );
    return;
  }

  if (settings.closeAllBeforeOpen) {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
  state.openedFiles.clear();

  if (settings.pinOpenedTabs) {
    for (const file of filteredFiles) {
      const fileUri = vscode.Uri.file(path.join(repoRoot, file));
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
        await vscode.commands.executeCommand("workbench.action.pinEditor");
        state.openedFiles.add(fileUri.toString());
      } catch (error) {
        output.appendLine(`Skipping non-text file "${file}": ${stringifyError(error)}`);
      }
    }
  } else {
    for (const file of filteredFiles) {
      const fileUri = vscode.Uri.file(path.join(repoRoot, file));
      if (!(await fileExists(fileUri))) {
        continue;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, {
          preview: true,
          preserveFocus: true,
          viewColumn: vscode.ViewColumn.Active
        });
        state.openedFiles.add(fileUri.toString());
      } catch (error) {
        output.appendLine(`Skipping non-text file "${file}": ${stringifyError(error)}`);
      }
    }
  }
}

function getSettings() {
  const config = vscode.workspace.getConfiguration("branchTabs");
  return {
    excludedBranches: config.get<string[]>("excludedBranches", ["main", "master"]),
    closeAllBeforeOpen: config.get<boolean>("closeAllBeforeOpen", true),
    pinOpenedTabs: config.get<boolean>("pinOpenedTabs", true),
    excludeRegexes: config.get<string[]>("excludeRegexes", []),
    maxFilesToOpen: config.get<number>("maxFilesToOpen", 10),
    closeAllOnExcludedBranch: config.get<boolean>("closeAllOnExcludedBranch", true),
    baseBranch: config.get<string>("baseBranch", "")
  };
}

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

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await execGit(repoRoot, ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

async function getChangedFiles(repoRoot: string, baseRef: string, headRef: string): Promise<string[]> {
  try {
    const { stdout } = await execGit(repoRoot, ["diff", "--name-only", `${baseRef}...${headRef}`]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    output.appendLine(`Failed to diff ${baseRef}...${headRef}: ${stringifyError(error)}`);
    return [];
  }
}

function filterExcluded(files: string[], regexes: string[]): string[] {
  const compiled = regexes
    .map((pattern) => parseRegex(pattern))
    .filter((regex): regex is RegExp => Boolean(regex));
  if (compiled.length === 0) {
    return files;
  }
  return files.filter((file) => !compiled.some((regex) => regex.test(file)));
}

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

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function execGit(repoRoot: string, args: string[]) {
  return execFileAsync("git", args, { cwd: repoRoot, windowsHide: true });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

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

export function deactivate() {}
