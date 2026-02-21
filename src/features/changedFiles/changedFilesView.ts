import * as vscode from "vscode";
import * as path from "path";
import { Repository, ChangedFile } from "../../core/types";
import { getExtensionSettings } from "../../core/settings";
import {
  resolveBaseRef,
  getChangedFiles,
  filterChangedFilesByCurrentAuthor
} from "../../git/gitDiff";
import {
  filterByTypeOfChange,
  filterExcludedFiles,
  filterExcludedDirectories,
  filterGitIgnoredFilesDirectories
} from "../../git/filters";

const REFRESH_DEBOUNCE_MS = 750;
export const CHANGED_FILE_TREE_ITEM_CONTEXT = "branchTabs.changedFile";
export const CHANGED_FILE_IGNORED_TREE_ITEM_CONTEXT = "branchTabs.changedFileIgnored";
export const COMMAND_VIEW_OPEN_FILE = "branchTabs.changedFiles.openFile";
export const COMMAND_VIEW_SEARCH_FILES = "branchTabs.changedFiles.search";

export class ChangedFilesView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private refreshTimer?: NodeJS.Timeout;
  private loading = false;
  private inflight?: Promise<void>;
  private cachedItems: vscode.TreeItem[] | null = null;
  private viewVisible = true;
  private pendingRefresh = false;
  private searchQuery = "";

  constructor(
    private readonly getRepository: () => Repository | undefined,
    private readonly getWorkspaceIgnoredFilesForRepo: (repoRoot: string) => Set<string>
  ) {}

  /**
   * Signals the view to refresh, debounced to avoid rapid git calls.
   */
  refresh(): void {
    if (!this.viewVisible) {
      this.pendingRefresh = true;
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Debounce to avoid hammering git on rapid status changes.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.loadData();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Updates whether the view is currently visible to the user.
   */
  setVisible(visible: boolean): void {
    this.viewVisible = visible;
    if (!visible && this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (visible && this.pendingRefresh) {
      this.pendingRefresh = false;
      this.refresh();
    }
  }

  /**
   * Returns the active search query for this view.
   */
  getSearchQuery(): string {
    return this.searchQuery;
  }

  /**
   * Updates the search query and refreshes the view.
   */
  setSearchQuery(query: string): void {
    const normalized = query.trim().toLowerCase();
    if (normalized === this.searchQuery) {
      return;
    }
    this.searchQuery = normalized;
    this.cachedItems = null;
    if (this.viewVisible) {
      void this.loadData();
      return;
    }
    this.pendingRefresh = true;
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
    const task = this.loadDataInternal()
      .catch((error) => {
        if (!this.cachedItems) {
          this.cachedItems = [createPlaceholderItem(`Failed to load changes: ${String(error)}`)];
        }
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

    const ownedFiles = await filterChangedFilesByCurrentAuthor(repoRoot, branchName, changedFiles);
    if (!ownedFiles.length) {
      this.cachedItems = [createPlaceholderItem("No changes owned by the current git author.")];
      return;
    }

    const selectableFiles = filterByTypeOfChange(
      ownedFiles,
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

    const searchFiltered = filterFilesBySearch(gitIgnoredFiltered, this.searchQuery);
    if (!searchFiltered.length) {
      this.cachedItems = [createPlaceholderItem(`No changed files match search "${this.searchQuery}".`)];
      return;
    }

    const workspaceIgnored = this.getWorkspaceIgnoredFilesForRepo(repoRoot);
    this.cachedItems = searchFiltered.map((file) =>
      createChangedFileItem(file, repoRoot, workspaceIgnored.has(file.path))
    );
  }
}

/**
 * Builds a tree item that opens a changed file.
 */
function createChangedFileItem(file: ChangedFile, repoRoot: string, ignored: boolean): vscode.TreeItem {
  return new ChangedFileItem(file, repoRoot, ignored);
}

/**
 * Applies a case-insensitive path filter for view search.
 */
function filterFilesBySearch(files: ChangedFile[], query: string): ChangedFile[] {
  if (!query) {
    return files;
  }

  return files.filter((file) => file.path.toLowerCase().includes(query));
}

/**
 * Builds a non-clickable placeholder tree item.
 */
function createPlaceholderItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("info");

  return item;
}

export class ChangedFileItem extends vscode.TreeItem {
  readonly fileUri: vscode.Uri;

  constructor(
    readonly changedFile: ChangedFile,
    readonly repoRoot: string,
    readonly ignored: boolean
  ) {
    super(changedFile.path, vscode.TreeItemCollapsibleState.None);
    this.fileUri = vscode.Uri.file(path.join(repoRoot, changedFile.path));
    this.contextValue = ignored
      ? CHANGED_FILE_IGNORED_TREE_ITEM_CONTEXT
      : CHANGED_FILE_TREE_ITEM_CONTEXT;
    this.resourceUri = this.fileUri;
    this.description = ignored ? `${changedFile.kind} (ignored)` : changedFile.kind;
    this.iconPath = ignored
      ? new vscode.ThemeIcon("eye-closed")
      : new vscode.ThemeIcon(changedFile.kind === "added" ? "diff-added" : "diff-modified");
    if (ignored) {
      this.tooltip = `${changedFile.path}\nIgnored for branch auto-open/pin.`;
    }
    this.command = {
      command: COMMAND_VIEW_OPEN_FILE,
      title: "Open File",
      arguments: [this]
    };
  }
}
