import * as vscode from "vscode";
import * as path from "path";
import { Repository } from "./types";
import { output } from "./logger";
import { getSettings } from "./settings";
import { ensureRepositoryEnabledOnFirstCheckout } from "./repoEnablement";
import { resolveBaseRef, getChangedFiles } from "./gitDiff";
import {
  filterByChangeKind,
  filterExcluded,
  filterExcludedDirectories,
  filterTextFiles
} from "./filters";
import { closeOpenedFiles, closePinnedOpenedFiles } from "./ui";
import { ensureRepositoryState } from "./repoState";

/**
 * Opens changed files for a repository using current configuration.
 */
export async function openChangedFilesForRepository(
  repo: Repository,
  options: { ignoreEnablement: boolean }
): Promise<void> {
  const settings = getSettings();
  if (settings.excludedBranches.includes(repo.state.HEAD?.name ?? "")) {
    output.appendLine(`Branch "${repo.state.HEAD?.name}" excluded.`);
    return;
  }
  if (!options.ignoreEnablement) {
    const enabled = await ensureRepositoryEnabledOnFirstCheckout(repo, settings);
    if (!enabled) {
      output.appendLine(`Repository disabled by user: ${repo.rootUri.fsPath}`);
      return;
    }
  }

  const repoRoot = repo.rootUri.fsPath;
  const headName = repo.state.HEAD?.name;
  const baseRef = await resolveBaseRef(
    repoRoot,
    settings.baseBranch,
    headName,
    repo.state.HEAD?.upstream?.name
  );
  if (!baseRef || !headName) {
    output.appendLine("No base ref found. Skipping diff.");
    return;
  }

  output.appendLine(`Using base ref: ${baseRef}`);

  const changedFiles = await getChangedFiles(repoRoot, baseRef, headName);
  if (!changedFiles.length) {
    output.appendLine("No changed files found for branch diff.");
    return;
  }

  const selectableFiles = filterByChangeKind(changedFiles, settings.includeModified, settings.includeAdded);
  if (!selectableFiles.length) {
    output.appendLine("No files matched change-type filters.");
    return;
  }

  output.appendLine(`Changed files found: ${selectableFiles.length}`);

  const filteredFiles = filterExcluded(
    filterExcludedDirectories(selectableFiles, settings.excludeDirRegexes),
    settings.excludedFiles
  );
  if (!filteredFiles.length) {
    output.appendLine("All changed files were excluded by regex.");
    return;
  }

  output.appendLine(`Files after regex filter: ${filteredFiles.length}`);

  let filesToConsider = filteredFiles;
  if (settings.textFilesOnly) {
    filesToConsider = await filterTextFiles(repoRoot, filteredFiles);
    output.appendLine(`Text files after filter: ${filesToConsider.length}`);
    if (filesToConsider.length === 0) {
      output.appendLine("No text files found for branch diff.");
      return;
    }
  }

  const maxToOpen = settings.maxFilesToOpen > 0 ? settings.maxFilesToOpen : Infinity;
  if (settings.maxFilesToOpen > 0 && filesToConsider.length > settings.maxFilesToOpen) {
    output.appendLine(
      `Limit exceeded: ${filesToConsider.length} files exceeds maxFilesToOpen=${settings.maxFilesToOpen}`
    );
    const shouldOpen = await promptOpenWhenLimitExceeded(
      filesToConsider.length,
      settings.maxFilesToOpen
    );
    if (!shouldOpen) {
      return;
    }
    await maybeUpdateMaxFilesLimit(settings.maxFilesToOpen);
  }

  const state = ensureRepositoryState(repo);
  if (settings.closePinnedTabsOnBranchChange) {
    await closePinnedOpenedFiles(state);
  } else {
    await closeOpenedFiles(state);
  }

  if (settings.closeAllBeforeOpen) {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }

  let openedCount = 0;
  for (const file of filesToConsider) {
    if (openedCount >= maxToOpen) {
      break;
    }
    const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      });
      const shouldPin = file.kind === "modified" ? settings.pinModified : settings.pinAdded;
      if (shouldPin) {
        await vscode.commands.executeCommand("workbench.action.pinEditor");
      }
      state.openedFiles.add(fileUri.toString());
      openedCount += 1;
    } catch (error) {
      output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
    }
  }

  if (openedCount === 0) {
    output.appendLine("No text files were opened.");
  }
}

/**
 * Prompts whether to open files when the max limit is exceeded.
 */
async function promptOpenWhenLimitExceeded(
  totalFiles: number,
  limit: number
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Branch Change Tabs: ${totalFiles} files changed, which exceeds the limit (${limit}). Open up to ${limit} files?`,
    "Open",
    "Cancel"
  );
  return choice === "Open";
}

/**
 * Optionally updates the maxFilesToOpen setting (workspace or user scope).
 */
async function maybeUpdateMaxFilesLimit(currentLimit: number): Promise<void> {
  const scopeChoice = await vscode.window.showInformationMessage(
    "Change the max files to open?",
    "No",
    "This Workspace",
    "User (Global)"
  );

  if (scopeChoice !== "This Workspace" && scopeChoice !== "User (Global)") {
    return;
  }

  const newValue = await vscode.window.showInputBox({
    prompt: "Enter new maxFilesToOpen value",
    value: String(currentLimit),
    validateInput: (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return "Enter a whole number (0 or greater).";
      }
      return undefined;
    }
  });

  if (newValue === undefined) {
    return;
  }

  const parsed = Number(newValue);
  const config = vscode.workspace.getConfiguration("branchTabs");
  const isGlobal = scopeChoice === "User (Global)";
  await config.update("maxFilesToOpen", parsed, isGlobal);
}

/**
 * Formats an error into a readable message.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
