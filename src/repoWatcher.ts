import * as vscode from "vscode";
import { Repository } from "./types";
import { output } from "./logger";
import { getExtensionSettings } from "./settings";
import { isRepositoryEnabledOnInitialCheckout } from "./repoEnablement";
import { verifyRepositoryState } from "./repoState";
import { openRepositoryChangedFiles } from "./openChangedFiles";
import { closeExtensionOpenedFiles } from "./ui";
import { getWorkspaceIgnoredFiles } from "./ignoredFiles";

const trackedRepositories = new Set<string>();

/**
 * Registers listeners for a git repository and debounces state changes.
 */
export async function trackRepository(
  repo: Repository,
  context: vscode.ExtensionContext
): Promise<void> {
  const key = repo.rootUri.fsPath;
  if (trackedRepositories.has(key)) {
    return;
  }
  trackedRepositories.add(key);
  const state = verifyRepositoryState(repo);

  const subscription = repo.state.onDidChange(() => {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
    }
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = undefined;
      void handleRepositoryChange(repo, context);
    }, 200);
  });

  context.subscriptions.push(subscription);
}

/**
 * Handles a repository state change by opening the branch's changed files.
 */
async function handleRepositoryChange(
  repo: Repository,
  context: vscode.ExtensionContext
): Promise<void> {
  const key = repo.rootUri.fsPath;
  const state = verifyRepositoryState(repo);

  const currentBranch = repo.state.HEAD?.name;
  const previousBranch = state.lastBranch;
  state.lastBranch = currentBranch;

  if (!currentBranch || currentBranch === previousBranch) {
    return;
  }

  const settings = getExtensionSettings();
  const enabled = await isRepositoryEnabledOnInitialCheckout(repo, settings);
  if (!enabled) {
    output.appendLine(`Repository disabled by user: ${key}`);
    return;
  }
  if (settings.excludedBranches.includes(currentBranch)) {
    output.appendLine(`Branch "${currentBranch}" excluded.`);
    if (settings.closeAllOnExcludedBranch) {
      await closeExtensionOpenedFiles(state);
    }
    return;
  }

  output.appendLine(`Branch changed: ${previousBranch ?? "(unknown)"} -> ${currentBranch}`);
  await openRepositoryChangedFiles(repo, {
    ignoreEnablement: false,
    workspaceIgnoredFiles: getWorkspaceIgnoredFiles(context, repo.rootUri.fsPath)
  });
}
