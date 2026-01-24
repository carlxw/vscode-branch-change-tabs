import { RepositoryTrackingState, Repository } from "./types";

const repositoryStates = new Map<string, RepositoryTrackingState>();

/**
 * Returns tracked repository state if it exists.
 */
export function getRepositoryState(repoRoot: string): RepositoryTrackingState | undefined {
  return repositoryStates.get(repoRoot);
}

/**
 * Ensures repository state is initialized and returns it.
 */
export function ensureRepositoryState(repo: Repository): RepositoryTrackingState {
  const key = repo.rootUri.fsPath;
  const existing = repositoryStates.get(key);
  if (existing) {
    return existing;
  }
  const state: RepositoryTrackingState = {
    lastBranch: repo.state.HEAD?.name,
    openedFiles: new Set()
  };
  repositoryStates.set(key, state);
  return state;
}
