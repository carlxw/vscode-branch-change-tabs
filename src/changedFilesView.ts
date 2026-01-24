import * as vscode from "vscode";
import * as path from "path";
import { Repository, ChangedFile } from "./types";
import { getSettings } from "./settings";
import { resolveBaseRef, getChangedFiles } from "./gitDiff";
import {
  filterByChangeKind,
  filterExcluded,
  filterExcludedDirectories,
  filterGitIgnored
} from "./filters";

const REFRESH_DEBOUNCE_MS = 200;

export class ChangedFilesView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private refreshTimer?: NodeJS.Timeout;

  constructor(private readonly getRepository: () => Repository | undefined) {}

  refresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    // Debounce to avoid hammering git on rapid status changes.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.onDidChangeTreeDataEmitter.fire();
    }, REFRESH_DEBOUNCE_MS);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const repo = this.getRepository();
    if (!repo) {
      return [createPlaceholderItem("No git repository detected.")];
    }

    const settings = getSettings();
    const branchName = repo.state.HEAD?.name;
    if (!branchName) {
      return [createPlaceholderItem("No active branch detected.")];
    }
    if (settings.excludedBranches.includes(branchName)) {
      return [createPlaceholderItem(`Branch "${branchName}" excluded by settings.`)];
    }

    const repoRoot = repo.rootUri.fsPath;
    const baseRef = await resolveBaseRef(
      repoRoot,
      settings.baseBranch,
      branchName,
      repo.state.HEAD?.upstream?.name
    );
    if (!baseRef) {
      return [createPlaceholderItem("No base ref found for diff.")];
    }

    const changedFiles = await getChangedFiles(repoRoot, baseRef, branchName);
    if (!changedFiles.length) {
      return [createPlaceholderItem("No changes detected vs base branch.")];
    }

    const selectableFiles = filterByChangeKind(
      changedFiles,
      settings.includeModifiedFiles,
      settings.includeNewlyTrackedFiles
    );
    const filteredFiles = filterExcluded(
      filterExcludedDirectories(selectableFiles, settings.excludedDirectories),
      settings.excludedFiles
    );
    if (!filteredFiles.length) {
      return [createPlaceholderItem("All changes filtered by settings.")];
    }

    const gitIgnoredFiltered = await filterGitIgnored(repoRoot, filteredFiles);
    if (!gitIgnoredFiltered.length) {
      return [createPlaceholderItem("All changes are ignored by .gitignore.")];
    }

    return gitIgnoredFiltered.map((file) => createChangedFileItem(file, repoRoot));
  }
}

function createChangedFileItem(file: ChangedFile, repoRoot: string): vscode.TreeItem {
  const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
  const item = new vscode.TreeItem(file.path, vscode.TreeItemCollapsibleState.None);
  item.resourceUri = fileUri;
  item.description = file.kind;
  item.iconPath = new vscode.ThemeIcon(file.kind === "added" ? "diff-added" : "diff-modified");
  item.command = {
    command: "vscode.open",
    title: "Open File",
    arguments: [fileUri]
  };
  return item;
}

function createPlaceholderItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("info");
  return item;
}
