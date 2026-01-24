import * as vscode from "vscode";
import * as path from "path";
import { Repository, ChangedFile } from "./types";
import { getExtensionSettings } from "./settings";
import { resolveBaseRef, getChangedFiles } from "./gitDiff";
import {
  filterByTypeOfChange,
  filterExcludedFiles,
  filterExcludedDirectories,
  filterGitIgnoredFilesDirectories
} from "./filters";

const REFRESH_DEBOUNCE_MS = 750;

export class ChangedFilesView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private refreshTimer?: NodeJS.Timeout;
  private loading = false;
  private inflight?: Promise<void>;
  private cachedItems: vscode.TreeItem[] | null = null;

  constructor(private readonly getRepository: () => Repository | undefined) {}

  /**
   * Signals the view to refresh, debounced to avoid rapid git calls.
   */
  refresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    // Debounce to avoid hammering git on rapid status changes.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.loadData();
      this.onDidChangeTreeDataEmitter.fire();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Returns the tree item used by VS Code for rendering.
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Loads the root children for the view.
   */
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    if (this.loading && !this.cachedItems) {
      return [createPlaceholderItem("Loading changed files...")];
    }
    if (this.cachedItems) {
      return this.cachedItems;
    }

    await this.loadData();
    return this.cachedItems ?? [createPlaceholderItem("Loading changed files...")];
  }

  private async loadData(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    this.loading = true;
    this.cachedItems = null;
    const task = this.loadDataInternal()
      .catch((error) => {
        this.cachedItems = [createPlaceholderItem(`Failed to load changes: ${String(error)}`)];
      })
      .finally(() => {
        this.loading = false;
        this.inflight = undefined;
        this.onDidChangeTreeDataEmitter.fire();
      });
    this.inflight = task;
    return task;
  }

  private async loadDataInternal(): Promise<void> {
    const repo = this.getRepository();
    if (!repo) {
      this.cachedItems = [createPlaceholderItem("No git repository detected.")];
      return;
    }

    const settings = getExtensionSettings();
    const branchName = repo.state.HEAD?.name;
    if (!branchName) {
      this.cachedItems = [createPlaceholderItem("No active branch detected.")];
      return;
    } else if (settings.baseBranch === branchName) {
      this.cachedItems = [
        createPlaceholderItem(
          `Currently on "${branchName}", which is the base branch. Checkout to another branch to see items here.`
        )
      ];
      return;
    } else if (settings.excludedBranches.includes(branchName)) {
      this.cachedItems = [createPlaceholderItem(`Branch "${branchName}" excluded by settings.`)];
      return;
    }

    const repoRoot = repo.rootUri.fsPath;
    const baseRef = await resolveBaseRef(
      repoRoot,
      settings.baseBranch,
      branchName,
      repo.state.HEAD?.upstream?.name
    );
    if (!baseRef) {
      this.cachedItems = [createPlaceholderItem("No base ref found for diff.")];
      return;
    }

    const changedFiles = await getChangedFiles(repoRoot, baseRef, branchName);
    if (!changedFiles.length) {
      this.cachedItems = [createPlaceholderItem("No changes detected vs base branch.")];
      return;
    }

    const selectableFiles = filterByTypeOfChange(
      changedFiles,
      settings.includeModifiedFiles,
      settings.includeNewlyTrackedFiles
    );
    const filteredFiles = filterExcludedFiles(
      filterExcludedDirectories(selectableFiles, settings.excludedDirectories),
      settings.excludedFiles
    );
    if (!filteredFiles.length) {
      this.cachedItems = [createPlaceholderItem("All changes filtered by settings.")];
      return;
    }

    const gitIgnoredFiltered = await filterGitIgnoredFilesDirectories(repoRoot, filteredFiles);
    if (!gitIgnoredFiltered.length) {
      this.cachedItems = [createPlaceholderItem("All changes are ignored by .gitignore.")];
      return;
    }

    this.cachedItems = gitIgnoredFiltered.map((file) => createChangedFileItem(file, repoRoot));
  }
}

/**
 * Builds a tree item that opens a changed file.
 */
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

/**
 * Builds a non-clickable placeholder tree item.
 */
function createPlaceholderItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("info");

  return item;
}
