import * as vscode from "vscode";
import { Repository } from "./types";
import { output } from "./logger";
import { getSettings } from "./settings";
import { ensureRepositoryEnabledOnFirstCheckout } from "./repoEnablement";
import { ensureRepositoryState } from "./repoState";
import { openChangedFilesForRepository } from "./openChangedFiles";
import { closeOpenedFiles } from "./ui";

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
  const state = ensureRepositoryState(repo);

  const subscription = repo.state.onDidChange(() => {
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

/**
 * Handles a repository state change by opening the branch's changed files.
 */
async function handleRepositoryChange(repo: Repository): Promise<void> {
  const key = repo.rootUri.fsPath;
  const state = ensureRepositoryState(repo);

  const currentBranch = repo.state.HEAD?.name;
  const previousBranch = state.lastBranch;
  state.lastBranch = currentBranch;

  if (!currentBranch || currentBranch === previousBranch) {
    return;
  }

  const settings = getSettings();
  const enabled = await ensureRepositoryEnabledOnFirstCheckout(repo, settings);
  if (!enabled) {
    output.appendLine(`Repository disabled by user: ${key}`);
    return;
  }
  if (settings.excludedBranches.includes(currentBranch)) {
    output.appendLine(`Branch "${currentBranch}" excluded.`);
    if (settings.closeAllOnExcludedBranch) {
      await closeOpenedFiles(state);
    }
    return;
  }

  output.appendLine(`Branch changed: ${previousBranch ?? "(unknown)"} -> ${currentBranch}`);
  await openChangedFilesForRepository(repo, { ignoreEnablement: false });
}
