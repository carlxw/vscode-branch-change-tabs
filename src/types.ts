import * as vscode from "vscode";

export interface GitExtension {
  getAPI(version: number): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
}

export interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
}

export interface RepositoryState {
  HEAD?: Branch;
  onDidChange: vscode.Event<void>;
}

export interface Branch {
  name?: string;
  upstream?: { name?: string };
}

export type ChangeKind = "modified" | "added";

export type ChangedFile = {
  path: string;
  kind: ChangeKind;
};

export type RepositoryTrackingState = {
  lastBranch?: string;
  pendingTimer?: NodeJS.Timeout;
  openedFiles: Set<string>;
};

export type Settings = {
  excludedBranches: string[];
  closeAllBeforeOpen: boolean;
  includeModifiedFiles: boolean;
  includeNewlyTrackedFiles: boolean;
  pinModifiedFiles: boolean;
  pinNewlyTrackedFiles: boolean;
  excludedFiles: string[];
  maxFilesToOpen: number;
  textFilesOnly: boolean;
  excludedDirectories: string[];
  closePinnedTabsOnBranchChange: boolean;
  closeAllOnExcludedBranch: boolean;
  promptOnNewRepository: boolean;
  enabledRepositories: string[];
  baseBranch: string;
};
