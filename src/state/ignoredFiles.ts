import * as path from "path";
import * as vscode from "vscode";
import { ChangedFile } from "../core/types";

const WORKSPACE_IGNORED_FILES_KEY = "branchTabs.ignoredFilesByRepo";

type IgnoredFilesByRepo = Record<string, string[]>;

/**
 * Returns ignored repo-relative file paths for the provided repository root.
 */
export function getWorkspaceIgnoredFiles(
  context: vscode.ExtensionContext,
  repoRoot: string
): Set<string> {
  const allIgnored = context.workspaceState.get<IgnoredFilesByRepo>(WORKSPACE_IGNORED_FILES_KEY, {});
  const repoKey = normalizeRepoRoot(repoRoot);
  const ignoredForRepo = allIgnored[repoKey] ?? [];
  return new Set(ignoredForRepo);
}

/**
 * Persists a repo-relative file path as ignored for this workspace and repo.
 * Returns false when the path was already ignored.
 */
export async function addWorkspaceIgnoredFile(
  context: vscode.ExtensionContext,
  repoRoot: string,
  repoRelativePath: string
): Promise<boolean> {
  const allIgnored = context.workspaceState.get<IgnoredFilesByRepo>(WORKSPACE_IGNORED_FILES_KEY, {});
  const repoKey = normalizeRepoRoot(repoRoot);
  const ignoredForRepo = new Set(allIgnored[repoKey] ?? []);
  if (ignoredForRepo.has(repoRelativePath)) {
    return false;
  }

  ignoredForRepo.add(repoRelativePath);
  const updated: IgnoredFilesByRepo = {
    ...allIgnored,
    [repoKey]: [...ignoredForRepo].sort()
  };
  await context.workspaceState.update(WORKSPACE_IGNORED_FILES_KEY, updated);
  return true;
}

/**
 * Removes a repo-relative file path from workspace ignored files.
 * Returns false when the path was not ignored.
 */
export async function removeWorkspaceIgnoredFile(
  context: vscode.ExtensionContext,
  repoRoot: string,
  repoRelativePath: string
): Promise<boolean> {
  const allIgnored = context.workspaceState.get<IgnoredFilesByRepo>(WORKSPACE_IGNORED_FILES_KEY, {});
  const repoKey = normalizeRepoRoot(repoRoot);
  const ignoredForRepo = new Set(allIgnored[repoKey] ?? []);
  if (!ignoredForRepo.has(repoRelativePath)) {
    return false;
  }

  ignoredForRepo.delete(repoRelativePath);
  const updated: IgnoredFilesByRepo = { ...allIgnored };
  if (ignoredForRepo.size === 0) {
    delete updated[repoKey];
  } else {
    updated[repoKey] = [...ignoredForRepo].sort();
  }
  await context.workspaceState.update(WORKSPACE_IGNORED_FILES_KEY, updated);
  return true;
}

/**
 * Filters out files explicitly ignored in workspace state.
 */
export function filterWorkspaceIgnoredFiles(files: ChangedFile[], ignoredFiles: Set<string>): ChangedFile[] {
  if (ignoredFiles.size === 0) {
    return files;
  }
  return files.filter((file) => !ignoredFiles.has(file.path));
}

function normalizeRepoRoot(repoRoot: string): string {
  const normalized = path.normalize(repoRoot);
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}
