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
  const baseBranch = config.get<string>("baseBranch", "");
  const excludedBranches = config.get<string[]>("excludedBranches", ["main", "master"]);
  const includeModifiedFiles =
    config.get<boolean>("includeModifiedFiles") ?? config.get<boolean>("includeModified");
  const includeNewlyTrackedFiles =
    config.get<boolean>("includeNewlyTrackedFiles") ?? config.get<boolean>("includeAdded");
  const pinModifiedFiles =
    config.get<boolean>("pinModifiedFiles") ?? config.get<boolean>("pinModified");
  const pinNewlyTrackedFiles =
    config.get<boolean>("pinNewlyTrackedFiles") ?? config.get<boolean>("pinAdded");
  const excludedDirectories =
    config.get<string[]>("excludedDirectories") ??
    config.get<string[]>("excludeDirRegexes") ?? [
      "^dist/",
      "^build/",
      "^out/",
      "^coverage/",
      "^node_modules/",
      "^\\.turbo/",
      "^\\.next/"
    ];
  const normalizedBase = baseBranch.trim();
  if (normalizedBase.length > 0 && !excludedBranches.includes(normalizedBase)) {
    excludedBranches.push(normalizedBase);
  }
  return {
    excludedBranches,
    closeAllBeforeOpen: config.get<boolean>("closeAllBeforeOpen", true),
    includeModifiedFiles: includeModifiedFiles ?? true,
    includeNewlyTrackedFiles: includeNewlyTrackedFiles ?? true,
    pinModifiedFiles: pinModifiedFiles ?? true,
    pinNewlyTrackedFiles: pinNewlyTrackedFiles ?? true,
    excludedFiles: config.get<string[]>("excludedFiles", [
      "\\.png$",
      "\\.jpe?g$",
      "\\.svg$",
      "\\.gif$",
      "\\.pdf$",
      "\\.zip$",
      "\\.tar$",
      "\\.gz$",
      "\\.7z$",
      "\\.exe$",
      "\\.dmg$",
      "\\.iso$",
      "\\.jar$",
      "^\\.gitignore$",
      "^\\.gitattributes$"
    ]),
    maxFilesToOpen: config.get<number>("maxFilesToOpen", 10),
    textFilesOnly: config.get<boolean>("textFilesOnly", true),
    excludedDirectories: excludedDirectories ?? [],
    closePinnedTabsOnBranchChange: config.get<boolean>("closePinnedTabsOnBranchChange", false),
    closeAllOnExcludedBranch: config.get<boolean>("closeAllOnExcludedBranch", true),
    promptOnNewRepository: promptOnNewRepository ?? true,
    enabledRepositories: enabledRepositories ?? [],
    baseBranch
  };
}
