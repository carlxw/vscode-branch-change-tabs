"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openRepositoryChangedFiles = openRepositoryChangedFiles;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const settings_1 = require("./settings");
const repoEnablement_1 = require("./repoEnablement");
const gitDiff_1 = require("./gitDiff");
const filters_1 = require("./filters");
const ui_1 = require("./ui");
const repoState_1 = require("./repoState");
/**
 * Opens changed files for a repository using current configuration.
 */
async function openRepositoryChangedFiles(repo, options) {
    const settings = (0, settings_1.getExtensionSettings)();
    if (settings.excludedBranches.includes(repo.state.HEAD?.name ?? "")) {
        logger_1.output.appendLine(`Branch "${repo.state.HEAD?.name}" excluded.`);
        return;
    }
    else if (!options.ignoreEnablement) {
        const enabled = await (0, repoEnablement_1.isRepositoryEnabledOnInitialCheckout)(repo, settings);
        if (!enabled) {
            logger_1.output.appendLine(`Repository disabled by user: ${repo.rootUri.fsPath}`);
            return;
        }
    }
    const repoRoot = repo.rootUri.fsPath;
    const headName = repo.state.HEAD?.name;
    const baseRef = await (0, gitDiff_1.resolveBaseRef)(repoRoot, settings.baseBranch, headName, repo.state.HEAD?.upstream?.name);
    if (!baseRef || !headName) {
        logger_1.output.appendLine("No base ref found. Skipping diff.");
        return;
    }
    logger_1.output.appendLine(`Using base ref: ${baseRef}`);
    const changedFiles = await (0, gitDiff_1.getChangedFiles)(repoRoot, baseRef, headName);
    if (!changedFiles.length) {
        logger_1.output.appendLine("No changed files found for branch diff.");
        return;
    }
    const selectableFiles = (0, filters_1.filterByTypeOfChange)(changedFiles, settings.includeModifiedFiles, settings.includeNewlyTrackedFiles);
    if (!selectableFiles.length) {
        logger_1.output.appendLine("No files matched change-type filters.");
        return;
    }
    logger_1.output.appendLine(`Changed files found: ${selectableFiles.length}`);
    const filteredFiles = (0, filters_1.filterExcludedFiles)((0, filters_1.filterExcludedDirectories)(selectableFiles, settings.excludedDirectories), settings.excludedFiles);
    if (!filteredFiles.length) {
        logger_1.output.appendLine("All changed files were excluded by regex.");
        return;
    }
    const gitIgnoredFiltered = await (0, filters_1.filterGitIgnoredFilesDirectories)(repoRoot, filteredFiles);
    if (!gitIgnoredFiltered.length) {
        logger_1.output.appendLine("All changed files were excluded by .gitignore.");
        return;
    }
    logger_1.output.appendLine(`Files after regex filter: ${filteredFiles.length}`);
    logger_1.output.appendLine(`Files after .gitignore filter: ${gitIgnoredFiltered.length}`);
    let filesToConsider = gitIgnoredFiltered;
    if (settings.textFilesOnly) {
        filesToConsider = await (0, filters_1.filterTextFiles)(repoRoot, filteredFiles);
        logger_1.output.appendLine(`Text files after filter: ${filesToConsider.length}`);
        if (filesToConsider.length === 0) {
            logger_1.output.appendLine("No text files found for branch diff.");
            return;
        }
    }
    const maxToOpen = settings.maxFilesToOpen > 0 ? settings.maxFilesToOpen : Infinity;
    if (settings.maxFilesToOpen > 0 && filesToConsider.length > settings.maxFilesToOpen) {
        logger_1.output.appendLine(`Limit exceeded: ${filesToConsider.length} files exceeds maxFilesToOpen=${settings.maxFilesToOpen}`);
        const shouldOpen = await promptUserOnFileLimitExceeded(filesToConsider.length, settings.maxFilesToOpen);
        if (!shouldOpen) {
            return;
        }
        const scopeChoice = await vscode.window.showInformationMessage("Change the max files to open?", "No", "This Workspace", "User (Global)");
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
    const state = (0, repoState_1.verifyRepositoryState)(repo);
    settings.closePinnedTabsOnBranchChange
        ? await (0, ui_1.closeExtensionPinnedFiles)(state)
        : await (0, ui_1.closeExtensionOpenedFiles)(state);
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
            const shouldPin = file.kind === "modified" ? settings.pinModifiedFiles : settings.pinNewlyTrackedFiles;
            if (shouldPin) {
                await vscode.commands.executeCommand("workbench.action.pinEditor");
            }
            state.openedFiles.add(fileUri.toString());
            openedCount += 1;
        }
        catch (error) {
            logger_1.output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
        }
    }
    if (openedCount === 0) {
        logger_1.output.appendLine("No text files were opened.");
    }
}
/**
 * Prompts whether to open files when the max limit is exceeded.
 */
async function promptUserOnFileLimitExceeded(totalFiles, limit) {
    const choice = await vscode.window.showWarningMessage(`Branch Change Tabs: ${totalFiles} files changed, which exceeds the limit (${limit}). Open up to ${limit} files?`, "Open", "Cancel");
    return choice === "Open";
}
/**
 * Formats an error into a readable message.
 */
function stringifyError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=openChangedFiles.js.map