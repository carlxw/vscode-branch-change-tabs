import * as vscode from "vscode";
import { GitExtension } from "./types";
import { output } from "./logger";
import { initRepoEnablement, clearRepoDecisions } from "./repoEnablement";
import { trackRepository } from "./repoWatcher";
import { closePinnedTabsInActiveGroup, getActiveRepository } from "./ui";
import { openChangedFilesForRepo } from "./openChangedFiles";
import { ChangedFilesView } from "./changedFilesView";

const DEV_CLEAR_COMMAND = "branchTabs.dev.clearRepoDecisions";
const OPEN_CHANGED_COMMAND = "branchTabs.openChangedFiles";
const CLOSE_PINNED_GROUP_COMMAND = "branchTabs.closePinnedTabsInGroup";

/**
 * Entry point for the extension; wires up git repository listeners.
 */
export function activate(context: vscode.ExtensionContext) {
  initRepoEnablement(context);
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")?.exports;
  if (!gitExtension) {
    output.appendLine("Git extension not found. Branch Change Tabs is inactive.");
    return;
  }

  const git = gitExtension.getAPI(1);
  const changedFilesView = new ChangedFilesView(getActiveRepository);
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
    const clearCommand = vscode.commands.registerCommand(DEV_CLEAR_COMMAND, async () => {
      await clearRepoDecisions();
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
    changedFilesView.refresh();
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
 * Extension deactivation hook (no-op).
 */
export function deactivate() {}
