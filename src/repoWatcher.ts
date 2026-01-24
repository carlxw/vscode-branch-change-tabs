import * as vscode from "vscode";
import { Repository } from "./types";
import { output } from "./logger";
import { getSettings } from "./settings";
import { ensureRepoEnabledOnFirstCheckout } from "./repoEnablement";
import { ensureRepoState } from "./repoState";
import { openChangedFilesForRepo } from "./openChangedFiles";
import { closeOpenedFiles } from "./ui";

const trackedRepos = new Set<string>();

/**
 * Registers listeners for a git repository and debounces state changes.
 */
export async function trackRepository(
  repo: Repository,
  context: vscode.ExtensionContext
): Promise<void> {
  const key = repo.rootUri.fsPath;
  if (trackedRepos.has(key)) {
    return;
  }
  trackedRepos.add(key);
  const state = ensureRepoState(repo);

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
  const state = ensureRepoState(repo);

  const currentBranch = repo.state.HEAD?.name;
  const previousBranch = state.lastBranch;
  state.lastBranch = currentBranch;

  if (!currentBranch || currentBranch === previousBranch) {
    return;
  }

  const settings = getSettings();
  const enabled = await ensureRepoEnabledOnFirstCheckout(repo, settings);
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
  await openChangedFilesForRepo(repo, { ignoreEnablement: false });
}
