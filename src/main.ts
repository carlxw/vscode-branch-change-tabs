import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GitExtension } from "./core/types";
import { output } from "./core/logger";
import { initRepositoryTracking, clearAllExtensionTrackedRepositories } from "./state/repoEnablement";
import { trackRepository } from "./watchers/repoWatcher";
import { closeAllPinnedTabsInActiveGroup, closeTabsForFile, getEditorActiveRepository } from "./ui/ui";
import { openRepositoryChangedFiles } from "./features/changedFiles/openChangedFiles";
import {
  ChangedFilesView,
  ChangedFileItem,
  COMMAND_VIEW_OPEN_FILE
} from "./features/changedFiles/changedFilesView";
import { doesRefExist, resolveBaseRef } from "./git/gitDiff";
import { getExtensionSettings } from "./core/settings";
import {
  addWorkspaceIgnoredFile,
  getWorkspaceIgnoredFiles,
  removeWorkspaceIgnoredFile
} from "./state/ignoredFiles";
import { getRepositoryState } from "./state/repoState";

const COMMAND_DEV_CLEAR = "branchTabs.dev.clearRepositoryDecisions";
const COMMAND_OPEN_CHANGED_FILES = "branchTabs.openChangedFiles";
const COMMAND_TOGGLE_IGNORE_ACTIVE_FILE = "branchTabs.toggleIgnoreActiveFile";
const COMMAND_CLOSE_PINNED_GROUP_TABS = "branchTabs.closePinnedTabsInGroup";
const COMMAND_VIEW_IGNORE_FILE = "branchTabs.changedFiles.ignoreFile";
const COMMAND_VIEW_UNIGNORE_FILE = "branchTabs.changedFiles.unignoreFile";
const COMMAND_VIEW_SHOW_DIFF_MAIN = "branchTabs.changedFiles.showDiffMain";
const execFileAsync = promisify(execFile);

/**
 * Entry point for the extension; wires up git repository listeners.
 */
export function activate(context: vscode.ExtensionContext) {
  initRepositoryTracking(context);
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  if (!gitExtension) {
    output.appendLine("Git extension not found. Branch Change Tabs is inactive.");
    return;
  }

  const git = gitExtension.getAPI(1);
  const changedFilesView = new ChangedFilesView(getEditorActiveRepository, (repoRoot) =>
    getWorkspaceIgnoredFiles(context, repoRoot)
  );
  const changedFilesTree = vscode.window.createTreeView("branchTabs.changedFiles", {
    treeDataProvider: changedFilesView
  });
  changedFilesView.setVisible(changedFilesTree.visible);
  context.subscriptions.push(
    changedFilesTree.onDidChangeVisibility((event) => {
      changedFilesView.setVisible(event.visible);
    })
  );
  context.subscriptions.push(changedFilesTree);

  for (const repo of git.repositories) {
    void trackRepository(repo, context);
    context.subscriptions.push(
      repo.state.onDidChange(() => {
        changedFilesView.refresh();
      })
    );
  }

  context.subscriptions.push(
    git.onDidOpenRepository((repo) => {
      void trackRepository(repo, context);
      context.subscriptions.push(
        repo.state.onDidChange(() => {
          changedFilesView.refresh();
        })
      );
      changedFilesView.refresh();
    })
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => changedFilesView.refresh())
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("branchTabs")) {
        changedFilesView.refresh();
      }
    })
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const clearCommand = vscode.commands.registerCommand(COMMAND_DEV_CLEAR, async () => {
      await clearAllExtensionTrackedRepositories();
      output.appendLine("Cleared stored repository decisions (dev command).");
      void vscode.window.showInformationMessage(
        "Branch Change Tabs: cleared stored repository decisions."
      );
    });
    context.subscriptions.push(clearCommand);
  }

  const openChangedCommand = vscode.commands.registerCommand(COMMAND_OPEN_CHANGED_FILES, async () => {
    const repo = getEditorActiveRepository();
    if (!repo) {
      void vscode.window.showInformationMessage("Branch Change Tabs: no active repository found.");
      return;
    }

    await openRepositoryChangedFiles(repo, {
      ignoreEnablement: true,
      workspaceIgnoredFiles: getWorkspaceIgnoredFiles(context, repo.rootUri.fsPath)
    });
    changedFilesView.refresh();
  });
  context.subscriptions.push(openChangedCommand);

  const toggleIgnoreActiveFileCommand = vscode.commands.registerCommand(
    COMMAND_TOGGLE_IGNORE_ACTIVE_FILE,
    async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (!activeUri || activeUri.scheme !== "file") {
        void vscode.window.showInformationMessage(
          "Branch Change Tabs: open a file in the editor to toggle ignore."
        );
        return;
      }

      const repo = git.repositories.find((candidate) =>
        isPathInRepo(activeUri.fsPath, candidate.rootUri.fsPath)
      );
      if (!repo) {
        void vscode.window.showInformationMessage(
          "Branch Change Tabs: active file is not inside an open git repository."
        );
        return;
      }

      const repoRelativePath = toRepoRelativePath(repo.rootUri.fsPath, activeUri.fsPath);
      if (!repoRelativePath) {
        void vscode.window.showInformationMessage(
          "Branch Change Tabs: failed to resolve active file path relative to repository root."
        );
        return;
      }

      const ignored = getWorkspaceIgnoredFiles(context, repo.rootUri.fsPath).has(repoRelativePath);
      if (ignored) {
        const removed = await removeWorkspaceIgnoredFile(context, repo.rootUri.fsPath, repoRelativePath);
        if (!removed) {
          void vscode.window.showInformationMessage(
            `Branch Change Tabs: "${repoRelativePath}" is not currently ignored.`
          );
          return;
        }
        await vscode.commands.executeCommand("workbench.action.pinEditor");
        getRepositoryState(repo.rootUri.fsPath)?.openedFiles.add(activeUri.toString());
        void vscode.window.showInformationMessage(
          `Branch Change Tabs: "${repoRelativePath}" is no longer ignored and was pinned.`
        );
      } else {
        const added = await addWorkspaceIgnoredFile(context, repo.rootUri.fsPath, repoRelativePath);
        if (!added) {
          void vscode.window.showInformationMessage(
            `Branch Change Tabs: "${repoRelativePath}" is already ignored.`
          );
          return;
        }
        const closedTabsCount = await closeTabsForFile(activeUri);
        getRepositoryState(repo.rootUri.fsPath)?.openedFiles.delete(activeUri.toString());
        void vscode.window.showInformationMessage(
          closedTabsCount > 0
            ? `Branch Change Tabs: "${repoRelativePath}" is now ignored and was closed.`
            : `Branch Change Tabs: "${repoRelativePath}" is now ignored for branch auto-open/pin.`
        );
      }

      changedFilesView.refresh();
    }
  );
  context.subscriptions.push(toggleIgnoreActiveFileCommand);

  const openChangedFileCommand = vscode.commands.registerCommand(
    COMMAND_VIEW_OPEN_FILE,
    async (item?: ChangedFileItem) => {
      if (!item) {
        return;
      }
      await vscode.commands.executeCommand("vscode.open", item.fileUri);
    }
  );
  context.subscriptions.push(openChangedFileCommand);

  const ignoreChangedFileCommand = vscode.commands.registerCommand(
    COMMAND_VIEW_IGNORE_FILE,
    async (item?: ChangedFileItem) => {
      if (!item) {
        return;
      }
      const added = await addWorkspaceIgnoredFile(context, item.repoRoot, item.changedFile.path);
      if (!added) {
        void vscode.window.showInformationMessage(
          `Branch Change Tabs: "${item.changedFile.path}" is already ignored.`
        );
        return;
      }
      const closedTabsCount = await closeTabsForFile(item.fileUri);
      getRepositoryState(item.repoRoot)?.openedFiles.delete(item.fileUri.toString());
      void vscode.window.showInformationMessage(
        closedTabsCount > 0
          ? `Branch Change Tabs: "${item.changedFile.path}" is now ignored and was closed.`
          : `Branch Change Tabs: "${item.changedFile.path}" is now ignored for branch auto-open/pin.`
      );
      changedFilesView.refresh();
    }
  );
  context.subscriptions.push(ignoreChangedFileCommand);

  const unignoreChangedFileCommand = vscode.commands.registerCommand(
    COMMAND_VIEW_UNIGNORE_FILE,
    async (item?: ChangedFileItem) => {
      if (!item) {
        return;
      }
      const removed = await removeWorkspaceIgnoredFile(context, item.repoRoot, item.changedFile.path);
      if (!removed) {
        void vscode.window.showInformationMessage(
          `Branch Change Tabs: "${item.changedFile.path}" is not currently ignored.`
        );
        return;
      }
      try {
        await vscode.commands.executeCommand("vscode.open", item.fileUri, {
          preview: false,
          preserveFocus: false
        });
        await vscode.commands.executeCommand("workbench.action.pinEditor");
        getRepositoryState(item.repoRoot)?.openedFiles.add(item.fileUri.toString());
      } catch (error) {
        output.appendLine(`Failed to open unignored file "${item.changedFile.path}": ${String(error)}`);
        void vscode.window.showErrorMessage(
          `Branch Change Tabs: "${item.changedFile.path}" was un-ignored, but could not be opened.`
        );
      }
      void vscode.window.showInformationMessage(
        `Branch Change Tabs: "${item.changedFile.path}" is no longer ignored and was opened/pinned.`
      );
      changedFilesView.refresh();
    }
  );
  context.subscriptions.push(unignoreChangedFileCommand);

  const showDiffAgainstBaseCommand = vscode.commands.registerCommand(
    COMMAND_VIEW_SHOW_DIFF_MAIN,
    async (item?: ChangedFileItem) => {
      if (!item) {
        return;
      }

      const repo = git.repositories.find((candidate) =>
        isPathInRepo(item.fileUri.fsPath, candidate.rootUri.fsPath)
      );
      const branchName = repo?.state.HEAD?.name;
      if (!repo || !branchName) {
        void vscode.window.showWarningMessage(
          "Branch Change Tabs: active repository or branch could not be determined."
        );
        return;
      }

      const settings = getExtensionSettings();
      const baseRef = await resolveBaseRef(
        repo.rootUri.fsPath,
        settings.baseBranch,
        branchName,
        repo.state.HEAD?.upstream?.name
      );
      if (!baseRef || !(await doesRefExist(repo.rootUri.fsPath, baseRef))) {
        void vscode.window.showWarningMessage(
          "Branch Change Tabs: a valid base branch/ref could not be resolved in this repository."
        );
        return;
      }

      try {
        const rightUri = item.fileUri;
        const rightDoc = await vscode.workspace.openTextDocument(rightUri);
        const leftContent = await getFileContentsAtRef(
          item.repoRoot,
          baseRef,
          item.changedFile.path
        );
        const leftDoc = await vscode.workspace.openTextDocument({
          content: leftContent ?? "",
          language: rightDoc.languageId
        });

        await vscode.commands.executeCommand(
          "vscode.diff",
          leftDoc.uri,
          rightUri,
          `${path.basename(item.changedFile.path)} (${baseRef} vs Working Tree)`
        );
      } catch (error) {
        output.appendLine(`Failed to open diff for "${item.changedFile.path}": ${String(error)}`);
        void vscode.window.showErrorMessage(
          `Branch Change Tabs: failed to open diff for "${item.changedFile.path}".`
        );
      }
    }
  );
  context.subscriptions.push(showDiffAgainstBaseCommand);

  const closePinnedGroupCommand = vscode.commands.registerCommand(
    COMMAND_CLOSE_PINNED_GROUP_TABS,
    async () => {
      await closeAllPinnedTabsInActiveGroup();
    }
  );
  context.subscriptions.push(closePinnedGroupCommand);
}

async function getFileContentsAtRef(
  repoRoot: string,
  ref: string,
  relativePath: string
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${relativePath}`], {
      cwd: repoRoot,
      windowsHide: true
    });
    return stdout;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("exists on disk, but not in") ||
        error.message.includes("does not exist in"))
    ) {
      return undefined;
    }
    throw error;
  }
}

function isPathInRepo(filePath: string, repoRoot: string): boolean {
  const normalizedFilePath = path.resolve(filePath);
  const normalizedRepoRoot = path.resolve(repoRoot);
  if (process.platform === "win32") {
    const fileLower = normalizedFilePath.toLowerCase();
    const repoLower = normalizedRepoRoot.toLowerCase();
    return fileLower === repoLower || fileLower.startsWith(`${repoLower}${path.sep}`);
  }
  return (
    normalizedFilePath === normalizedRepoRoot ||
    normalizedFilePath.startsWith(`${normalizedRepoRoot}${path.sep}`)
  );
}

function toRepoRelativePath(repoRoot: string, filePath: string): string | undefined {
  const relative = path.relative(repoRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replace(/\\/g, "/");
}


/**
 * Extension deactivation hook (no-op).
 */
export function deactivate() {}
