import { RepoState, Repository } from "./types";

const repoStates = new Map<string, RepoState>();

/**
 * Returns tracked repo state if it exists.
 */
export function getRepoState(repoRoot: string): RepoState | undefined {
  return repoStates.get(repoRoot);
}

/**
 * Ensures repo state is initialized and returns it.
 */
export function ensureRepoState(repo: Repository): RepoState {
  const key = repo.rootUri.fsPath;
  const existing = repoStates.get(key);
  if (existing) {
    return existing;
  }
  const state: RepoState = {
    lastBranch: repo.state.HEAD?.name,
    openedFiles: new Set()
  };
  repoStates.set(key, state);
  return state;
}
