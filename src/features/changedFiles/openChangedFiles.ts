import * as vscode from "vscode";
import * as path from "path";
import { Repository } from "../../core/types";
import { output } from "../../core/logger";
import { getExtensionSettings } from "../../core/settings";
import { isRepositoryEnabledOnInitialCheckout } from "../../state/repoEnablement";
import { resolveBaseRef, getChangedFiles } from "../../git/gitDiff";
import {
  filterByTypeOfChange,
  filterExcludedFiles,
  filterExcludedDirectories,
  filterGitIgnoredFilesDirectories,
  filterTextFiles
} from "../../git/filters";
import { closeExtensionOpenedFiles, closeExtensionPinnedFiles } from "../../ui/ui";
import { verifyRepositoryState } from "../../state/repoState";
import { filterWorkspaceIgnoredFiles } from "../../state/ignoredFiles";

/**
 * Opens changed files for a repository using current configuration.
 */
export async function openRepositoryChangedFiles(
  repo: Repository,
  options: { ignoreEnablement: boolean; workspaceIgnoredFiles?: Set<string> }
): Promise<void> {
  const settings = getExtensionSettings();
  if (settings.excludedBranches.includes(repo.state.HEAD?.name ?? "")) {
    output.appendLine(`Branch "${repo.state.HEAD?.name}" excluded.`);
    return;
  } else if (!options.ignoreEnablement) {
    const enabled = await isRepositoryEnabledOnInitialCheckout(repo, settings);
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

  const selectableFiles = filterByTypeOfChange(
    changedFiles,
    settings.includeModifiedFiles,
    settings.includeNewlyTrackedFiles
  );
  if (!selectableFiles.length) {
    output.appendLine("No files matched change-type filters.");
    return;
  }

  output.appendLine(`Changed files found: ${selectableFiles.length}`);

  const filteredFiles = filterExcludedFiles(
    filterExcludedDirectories(selectableFiles, settings.excludedDirectories),
    settings.excludedFiles
  );
  if (!filteredFiles.length) {
    output.appendLine("All changed files were excluded by regex.");
    return;
  }

  const gitIgnoredFiltered = await filterGitIgnoredFilesDirectories(repoRoot, filteredFiles);
  if (!gitIgnoredFiltered.length) {
    output.appendLine("All changed files were excluded by .gitignore.");
    return;
  }
  const workspaceIgnoredFiltered = filterWorkspaceIgnoredFiles(
    gitIgnoredFiltered,
    options.workspaceIgnoredFiles ?? new Set<string>()
  );
  if (!workspaceIgnoredFiltered.length) {
    output.appendLine("All changed files were excluded by workspace ignore list.");
    return;
  }

  output.appendLine(`Files after regex filter: ${filteredFiles.length}`);
  output.appendLine(`Files after .gitignore filter: ${gitIgnoredFiltered.length}`);
  output.appendLine(`Files after workspace ignore filter: ${workspaceIgnoredFiltered.length}`);

  let filesToConsider = workspaceIgnoredFiltered;
  if (settings.textFilesOnly) {
    filesToConsider = await filterTextFiles(repoRoot, workspaceIgnoredFiltered);
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
    const shouldOpen = await promptUserOnFileLimitExceeded(
      filesToConsider.length,
      settings.maxFilesToOpen
    );
    if (!shouldOpen) {
      return;
    }

    const scopeChoice = await vscode.window.showInformationMessage(
      "Change the max files to open?",
      "No",
      "This Workspace",
      "User (Global)"
    );

    if (scopeChoice === "This Workspace" || scopeChoice === "User (Global)") {
      const newValue = await vscode.window.showInputBox({
        prompt: "Enter new maxFilesToOpen value",
        value: String(settings.maxFilesToOpen),
        validateInput: (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
            return "Enter a whole number (0 or greater).";
          }

          return undefined;
        }
      });

      if (newValue !== undefined) {
        const parsed = Number(newValue);
        const config = vscode.workspace.getConfiguration("branchTabs");
        const isGlobal = scopeChoice === "User (Global)";

        await config.update("maxFilesToOpen", parsed, isGlobal);
      }
    }
  }

  const state = verifyRepositoryState(repo);
  settings.closePinnedTabsOnBranchChange
    ? await closeExtensionPinnedFiles(state)
    : await closeExtensionOpenedFiles(state);

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

      const shouldPin =
        file.kind === "modified" ? settings.pinModifiedFiles : settings.pinNewlyTrackedFiles;
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
async function promptUserOnFileLimitExceeded(
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
 * Formats an error into a readable message.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
