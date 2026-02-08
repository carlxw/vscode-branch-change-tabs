import { GitRepositoryState, Repository } from "../core/types";

const repositoryStates = new Map<string, GitRepositoryState>();

/**
 * Returns tracked repository state if it exists.
 */
export function getRepositoryState(repoRoot: string): GitRepositoryState | undefined {
  return repositoryStates.get(repoRoot);
}

/**
 * Ensures repository state is initialized and returns it.
 */
export function verifyRepositoryState(repo: Repository): GitRepositoryState {
  const key = repo.rootUri.fsPath;
  const existing = repositoryStates.get(key);
  if (existing) {
    return existing;
  }

  const state: GitRepositoryState = {
    lastBranch: repo.state.HEAD?.name,
    openedFiles: new Set()
  };
  repositoryStates.set(key, state);

  return state;
}
