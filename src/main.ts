import * as vscode from "vscode";
import { GitExtension } from "./types";
import { output } from "./logger";
import { initRepositoryTracking, clearAllExtensionTrackedRepositories } from "./repoEnablement";
import { trackRepository } from "./repoWatcher";
import { closeAllPinnedTabsInActiveGroup, getEditorActiveRepository } from "./ui";
import { openRepositoryChangedFiles } from "./openChangedFiles";
import { ChangedFilesView } from "./changedFilesView";

const COMMAND_DEV_CLEAR = "branchTabs.dev.clearRepositoryDecisions";
const COMMAND_OPEN_CHANGED_FILES = "branchTabs.openChangedFiles";
const COMMAND_CLOSE_PINNED_GROUP_TABS = "branchTabs.closePinnedTabsInGroup";

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
