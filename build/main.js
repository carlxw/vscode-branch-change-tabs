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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
const repoEnablement_1 = require("./repoEnablement");
const repoWatcher_1 = require("./repoWatcher");
const ui_1 = require("./ui");
const openChangedFiles_1 = require("./openChangedFiles");
const changedFilesView_1 = require("./changedFilesView");
const COMMAND_DEV_CLEAR = "branchTabs.dev.clearRepositoryDecisions";
const COMMAND_OPEN_CHANGED_FILES = "branchTabs.openChangedFiles";
const COMMAND_CLOSE_PINNED_GROUP_TABS = "branchTabs.closePinnedTabsInGroup";
/**
 * Entry point for the extension; wires up git repository listeners.
 */
function activate(context) {
    (0, repoEnablement_1.initRepositoryTracking)(context);
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (!gitExtension) {
        logger_1.output.appendLine("Git extension not found. Branch Change Tabs is inactive.");
        return;
    }
    const git = gitExtension.getAPI(1);
    const changedFilesView = new changedFilesView_1.ChangedFilesView(ui_1.getEditorActiveRepository);
    const changedFilesTree = vscode.window.createTreeView("branchTabs.changedFiles", {
        treeDataProvider: changedFilesView
    });
    context.subscriptions.push(changedFilesTree);
    for (const repo of git.repositories) {
        void (0, repoWatcher_1.trackRepository)(repo, context);
        context.subscriptions.push(repo.state.onDidChange(() => {
            changedFilesView.refresh();
        }));
    }
    context.subscriptions.push(git.onDidOpenRepository((repo) => {
        void (0, repoWatcher_1.trackRepository)(repo, context);
        context.subscriptions.push(repo.state.onDidChange(() => {
            changedFilesView.refresh();
        }));
        changedFilesView.refresh();
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => changedFilesView.refresh()));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("branchTabs")) {
            changedFilesView.refresh();
        }
    }));
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        const clearCommand = vscode.commands.registerCommand(COMMAND_DEV_CLEAR, async () => {
            await (0, repoEnablement_1.clearAllExtensionTrackedRepositories)();
            logger_1.output.appendLine("Cleared stored repository decisions (dev command).");
            void vscode.window.showInformationMessage("Branch Change Tabs: cleared stored repository decisions.");
        });
        context.subscriptions.push(clearCommand);
    }
    const openChangedCommand = vscode.commands.registerCommand(COMMAND_OPEN_CHANGED_FILES, async () => {
        const repo = (0, ui_1.getEditorActiveRepository)();
        if (!repo) {
            void vscode.window.showInformationMessage("Branch Change Tabs: no active repository found.");
            return;
        }
        await (0, openChangedFiles_1.openRepositoryChangedFiles)(repo, { ignoreEnablement: true });
        changedFilesView.refresh();
    });
    context.subscriptions.push(openChangedCommand);
    const closePinnedGroupCommand = vscode.commands.registerCommand(COMMAND_CLOSE_PINNED_GROUP_TABS, async () => {
        await (0, ui_1.closeAllPinnedTabsInActiveGroup)();
    });
    context.subscriptions.push(closePinnedGroupCommand);
}
/**
 * Extension deactivation hook (no-op).
 */
function deactivate() { }
//# sourceMappingURL=main.js.map