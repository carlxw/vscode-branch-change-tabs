import * as vscode from "vscode";
import { GitRepositoryState, Repository } from "./types";

/**
 * Closes tabs that were opened by the extension.
 */
export async function closeExtensionOpenedFiles(state: GitRepositoryState): Promise<void> {
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
export async function closeExtensionPinnedFiles(state: GitRepositoryState): Promise<void> {
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
 * Finds the active repository based on the current editor or first repo.
 */
export function getEditorActiveRepository(): Repository | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports as {
    getAPI(version: number): { repositories: Repository[] };
  } | undefined;
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
 * Closes pinned tabs in the active editor group.
 */
export async function closeAllPinnedTabsInActiveGroup(): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup;
  const toClose = group.tabs.filter((tab) => tab.isPinned);
  if (toClose.length === 0) {
    void vscode.window.showInformationMessage("Branch Change Tabs: no pinned tabs in active group.");
    return;
  }

  await vscode.window.tabGroups.close(toClose, true);
}

/**
 * Closes all open tabs for a specific file URI across all groups.
 */
export async function closeTabsForFile(fileUri: vscode.Uri): Promise<number> {
  const toClose: vscode.Tab[] = [];
  const target = fileUri.toString();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.toString() === target) {
        toClose.push(tab);
      }
    }
  }

  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose, true);
  }

  return toClose.length;
}
