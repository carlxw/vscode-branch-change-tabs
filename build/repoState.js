"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRepositoryState = getRepositoryState;
exports.verifyRepositoryState = verifyRepositoryState;
const repositoryStates = new Map();
/**
 * Returns tracked repository state if it exists.
 */
function getRepositoryState(repoRoot) {
    return repositoryStates.get(repoRoot);
}
/**
 * Ensures repository state is initialized and returns it.
 */
function verifyRepositoryState(repo) {
    const key = repo.rootUri.fsPath;
    const existing = repositoryStates.get(key);
    if (existing) {
        return existing;
    }
    const state = {
        lastBranch: repo.state.HEAD?.name,
        openedFiles: new Set()
    };
    repositoryStates.set(key, state);
    return state;
}
//# sourceMappingURL=repoState.js.map