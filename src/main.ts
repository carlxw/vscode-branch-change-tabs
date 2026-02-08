import * as vscode from "vscode";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GitExtension } from "./types";
import { output } from "./logger";
import { initRepositoryTracking, clearAllExtensionTrackedRepositories } from "./repoEnablement";
import { trackRepository } from "./repoWatcher";
import { closeAllPinnedTabsInActiveGroup, getEditorActiveRepository } from "./ui";
import { openRepositoryChangedFiles } from "./openChangedFiles";
import { ChangedFilesView, ChangedFileItem, COMMAND_VIEW_OPEN_FILE } from "./changedFilesView";
import { doesRefExist } from "./gitDiff";

const COMMAND_DEV_CLEAR = "branchTabs.dev.clearRepositoryDecisions";
const COMMAND_OPEN_CHANGED_FILES = "branchTabs.openChangedFiles";
const COMMAND_CLOSE_PINNED_GROUP_TABS = "branchTabs.closePinnedTabsInGroup";
const COMMAND_VIEW_IGNORE_FILE = "branchTabs.changedFiles.ignoreFile";
const COMMAND_VIEW_SHOW_DIFF_MAIN = "branchTabs.changedFiles.showDiffMain";
const MAIN_BRANCH_NAME = "main";
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
  const changedFilesView = new ChangedFilesView(getEditorActiveRepository);
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

    await openRepositoryChangedFiles(repo, { ignoreEnablement: true });
    changedFilesView.refresh();
  });
  context.subscriptions.push(openChangedCommand);

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

      const config = vscode.workspace.getConfiguration("branchTabs", item.fileUri);
      const currentExcluded = config.get<string[]>("excludedFiles", []);
      const escapedPathRegex = `^${escapeRegex(item.changedFile.path)}$`;
      if (currentExcluded.includes(escapedPathRegex)) {
        void vscode.window.showInformationMessage(
          `Branch Change Tabs: "${item.changedFile.path}" is already excluded.`
        );
        return;
      }
      const configTarget = vscode.workspace.getWorkspaceFolder(item.fileUri)
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Workspace;

      await config.update(
        "excludedFiles",
        [...currentExcluded, escapedPathRegex],
        configTarget
      );
      void vscode.window.showInformationMessage(
        `Branch Change Tabs: "${item.changedFile.path}" has been excluded.`
      );
      changedFilesView.refresh();
    }
  );
  context.subscriptions.push(ignoreChangedFileCommand);

  const showDiffAgainstMainCommand = vscode.commands.registerCommand(
    COMMAND_VIEW_SHOW_DIFF_MAIN,
    async (item?: ChangedFileItem) => {
      if (!item) {
        return;
      }

      const mainExists = await doesRefExist(item.repoRoot, MAIN_BRANCH_NAME);
      if (!mainExists) {
        void vscode.window.showWarningMessage(
          `Branch Change Tabs: branch "${MAIN_BRANCH_NAME}" was not found in this repository.`
        );
        return;
      }

      try {
        const rightUri = item.fileUri;
        const rightDoc = await vscode.workspace.openTextDocument(rightUri);
        const leftContent = await getFileContentsAtRef(
          item.repoRoot,
          MAIN_BRANCH_NAME,
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
          `${path.basename(item.changedFile.path)} (${MAIN_BRANCH_NAME} vs Working Tree)`
        );
      } catch (error) {
        output.appendLine(`Failed to open diff for "${item.changedFile.path}": ${String(error)}`);
        void vscode.window.showErrorMessage(
          `Branch Change Tabs: failed to open diff for "${item.changedFile.path}".`
        );
      }
    }
  );
  context.subscriptions.push(showDiffAgainstMainCommand);

  const closePinnedGroupCommand = vscode.commands.registerCommand(
    COMMAND_CLOSE_PINNED_GROUP_TABS,
    async () => {
      await closeAllPinnedTabsInActiveGroup();
    }
  );
  context.subscriptions.push(closePinnedGroupCommand);
}

/**
 * Extension deactivation hook (no-op).
 */
export function deactivate() {}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
