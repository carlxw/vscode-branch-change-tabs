import * as vscode from "vscode";
import { Settings } from "./types";

/**
 * Loads extension settings from the VS Code configuration.
 */
export function getSettings(): Settings {
  const config = vscode.workspace.getConfiguration("branchTabs");
  const promptOnNewRepository =
    config.get<boolean>("promptOnNewRepository") ?? config.get<boolean>("promptOnNewRepo");
  const enabledRepositories =
    config.get<string[]>("enabledRepositories") ?? config.get<string[]>("enabledRepos");
  return {
    excludedBranches: config.get<string[]>("excludedBranches", ["main", "master"]),
    closeAllBeforeOpen: config.get<boolean>("closeAllBeforeOpen", true),
    includeModified: config.get<boolean>("includeModified", true),
    includeAdded: config.get<boolean>("includeAdded", true),
    pinModified: config.get<boolean>("pinModified", true),
    pinAdded: config.get<boolean>("pinAdded", true),
    excludedFiles: config.get<string[]>("excludedFiles", []),
    maxFilesToOpen: config.get<number>("maxFilesToOpen", 10),
    textFilesOnly: config.get<boolean>("textFilesOnly", true),
    excludeDirRegexes: config.get<string[]>("excludeDirRegexes", []),
    closePinnedTabsOnBranchChange: config.get<boolean>("closePinnedTabsOnBranchChange", false),
    closeAllOnExcludedBranch: config.get<boolean>("closeAllOnExcludedBranch", true),
    promptOnNewRepository: promptOnNewRepository ?? true,
    enabledRepositories: enabledRepositories ?? [],
    baseBranch: config.get<string>("baseBranch", "")
  };
}
