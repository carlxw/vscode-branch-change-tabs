"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackRepository = trackRepository;
const logger_1 = require("./logger");
const settings_1 = require("./settings");
const repoEnablement_1 = require("./repoEnablement");
const repoState_1 = require("./repoState");
const openChangedFiles_1 = require("./openChangedFiles");
const ui_1 = require("./ui");
const trackedRepositories = new Set();
/**
 * Registers listeners for a git repository and debounces state changes.
 */
async function trackRepository(repo, context) {
    const key = repo.rootUri.fsPath;
    if (trackedRepositories.has(key)) {
        return;
    }
    trackedRepositories.add(key);
    const state = (0, repoState_1.verifyRepositoryState)(repo);
    const subscription = repo.state.onDidChange(() => {
        if (state.pendingTimer) {
            clearTimeout(state.pendingTimer);
        }
        state.pendingTimer = setTimeout(() => {
            state.pendingTimer = undefined;
            void handleRepositoryChange(repo);
        }, 200);
    });
    context.subscriptions.push(subscription);
}
/**
 * Handles a repository state change by opening the branch's changed files.
 */
async function handleRepositoryChange(repo) {
    const key = repo.rootUri.fsPath;
    const state = (0, repoState_1.verifyRepositoryState)(repo);
    const currentBranch = repo.state.HEAD?.name;
    const previousBranch = state.lastBranch;
    state.lastBranch = currentBranch;
    if (!currentBranch || currentBranch === previousBranch) {
        return;
    }
    const settings = (0, settings_1.getExtensionSettings)();
    const enabled = await (0, repoEnablement_1.isRepositoryEnabledOnInitialCheckout)(repo, settings);
    if (!enabled) {
        logger_1.output.appendLine(`Repository disabled by user: ${key}`);
        return;
    }
    if (settings.excludedBranches.includes(currentBranch)) {
        logger_1.output.appendLine(`Branch "${currentBranch}" excluded.`);
        if (settings.closeAllOnExcludedBranch) {
            await (0, ui_1.closeExtensionOpenedFiles)(state);
        }
        return;
    }
    logger_1.output.appendLine(`Branch changed: ${previousBranch ?? "(unknown)"} -> ${currentBranch}`);
    await (0, openChangedFiles_1.openRepositoryChangedFiles)(repo, { ignoreEnablement: false });
}
//# sourceMappingURL=repoWatcher.js.map