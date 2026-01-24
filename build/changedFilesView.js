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
exports.ChangedFilesView = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const settings_1 = require("./settings");
const gitDiff_1 = require("./gitDiff");
const filters_1 = require("./filters");
const REFRESH_DEBOUNCE_MS = 750;
class ChangedFilesView {
    constructor(getRepository) {
        this.getRepository = getRepository;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.loading = false;
        this.cachedItems = null;
    }
    /**
     * Signals the view to refresh, debounced to avoid rapid git calls.
     */
    refresh() {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        // Debounce to avoid hammering git on rapid status changes.
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.loadData();
            this.onDidChangeTreeDataEmitter.fire();
        }, REFRESH_DEBOUNCE_MS);
    }
    /**
     * Returns the tree item used by VS Code for rendering.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Loads the root children for the view.
     */
    async getChildren(element) {
        if (element) {
            return [];
        }
        if (this.loading && !this.cachedItems) {
            return [createPlaceholderItem("Loading changed files...")];
        }
        if (this.cachedItems) {
            return this.cachedItems;
        }
        await this.loadData();
        return this.cachedItems ?? [createPlaceholderItem("Loading changed files...")];
    }
    async loadData() {
        if (this.inflight) {
            return this.inflight;
        }
        this.loading = true;
        this.cachedItems = null;
        const task = this.loadDataInternal()
            .catch((error) => {
            this.cachedItems = [createPlaceholderItem(`Failed to load changes: ${String(error)}`)];
        })
            .finally(() => {
            this.loading = false;
            this.inflight = undefined;
            this.onDidChangeTreeDataEmitter.fire();
        });
        this.inflight = task;
        return task;
    }
    async loadDataInternal() {
        const repo = this.getRepository();
        if (!repo) {
            this.cachedItems = [createPlaceholderItem("No git repository detected.")];
            return;
        }
        const settings = (0, settings_1.getExtensionSettings)();
        const branchName = repo.state.HEAD?.name;
        if (!branchName) {
            this.cachedItems = [createPlaceholderItem("No active branch detected.")];
            return;
        }
        else if (settings.baseBranch === branchName) {
            this.cachedItems = [
                createPlaceholderItem(`Currently on "${branchName}", which is the base branch. Checkout to another branch to see items here.`)
            ];
            return;
        }
        else if (settings.excludedBranches.includes(branchName)) {
            this.cachedItems = [createPlaceholderItem(`Branch "${branchName}" excluded by settings.`)];
            return;
        }
        const repoRoot = repo.rootUri.fsPath;
        const baseRef = await (0, gitDiff_1.resolveBaseRef)(repoRoot, settings.baseBranch, branchName, repo.state.HEAD?.upstream?.name);
        if (!baseRef) {
            this.cachedItems = [createPlaceholderItem("No base ref found for diff.")];
            return;
        }
        const changedFiles = await (0, gitDiff_1.getChangedFiles)(repoRoot, baseRef, branchName);
        if (!changedFiles.length) {
            this.cachedItems = [createPlaceholderItem("No changes detected vs base branch.")];
            return;
        }
        const selectableFiles = (0, filters_1.filterByTypeOfChange)(changedFiles, settings.includeModifiedFiles, settings.includeNewlyTrackedFiles);
        const filteredFiles = (0, filters_1.filterExcludedFiles)((0, filters_1.filterExcludedDirectories)(selectableFiles, settings.excludedDirectories), settings.excludedFiles);
        if (!filteredFiles.length) {
            this.cachedItems = [createPlaceholderItem("All changes filtered by settings.")];
            return;
        }
        const gitIgnoredFiltered = await (0, filters_1.filterGitIgnoredFilesDirectories)(repoRoot, filteredFiles);
        if (!gitIgnoredFiltered.length) {
            this.cachedItems = [createPlaceholderItem("All changes are ignored by .gitignore.")];
            return;
        }
        this.cachedItems = gitIgnoredFiltered.map((file) => createChangedFileItem(file, repoRoot));
    }
}
exports.ChangedFilesView = ChangedFilesView;
/**
 * Builds a tree item that opens a changed file.
 */
function createChangedFileItem(file, repoRoot) {
    const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
    const item = new vscode.TreeItem(file.path, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = fileUri;
    item.description = file.kind;
    item.iconPath = new vscode.ThemeIcon(file.kind === "added" ? "diff-added" : "diff-modified");
    item.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [fileUri]
    };
    return item;
}
/**
 * Builds a non-clickable placeholder tree item.
 */
function createPlaceholderItem(label) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
}
//# sourceMappingURL=changedFilesView.js.map