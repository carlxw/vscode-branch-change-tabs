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
exports.closeExtensionOpenedFiles = closeExtensionOpenedFiles;
exports.closeExtensionPinnedFiles = closeExtensionPinnedFiles;
exports.getEditorActiveRepository = getEditorActiveRepository;
exports.closeAllPinnedTabsInActiveGroup = closeAllPinnedTabsInActiveGroup;
const vscode = __importStar(require("vscode"));
/**
 * Closes tabs that were opened by the extension.
 */
async function closeExtensionOpenedFiles(state) {
    if (state.openedFiles.size === 0) {
        return;
    }
    const toClose = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                if (state.openedFiles.has(input.uri.toString())) {
                    toClose.push(tab);
                }
            }
        }
    }
    if (toClose.length > 0) {
        await vscode.window.tabGroups.close(toClose, true);
    }
    state.openedFiles.clear();
}
/**
 * Closes only pinned tabs that were opened by the extension.
 */
async function closeExtensionPinnedFiles(state) {
    if (state.openedFiles.size === 0) {
        return;
    }
    const toClose = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (!tab.isPinned) {
                continue;
            }
            const input = tab.input;
            if (input instanceof vscode.TabInputText) {
                if (state.openedFiles.has(input.uri.toString())) {
                    toClose.push(tab);
                }
            }
        }
    }
    if (toClose.length > 0) {
        await vscode.window.tabGroups.close(toClose, true);
    }
    for (const tab of toClose) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
            state.openedFiles.delete(input.uri.toString());
        }
    }
}
/**
 * Finds the active repository based on the current editor or first repo.
 */
function getEditorActiveRepository() {
    const active = vscode.window.activeTextEditor?.document.uri;
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (!gitExtension) {
        return undefined;
    }
    const git = gitExtension.getAPI(1);
    if (active) {
        const match = git.repositories.find((repo) => active.fsPath.toLowerCase().startsWith(repo.rootUri.fsPath.toLowerCase()));
        if (match) {
            return match;
        }
    }
    return git.repositories[0];
}
/**
 * Closes pinned tabs in the active editor group.
 */
async function closeAllPinnedTabsInActiveGroup() {
    const group = vscode.window.tabGroups.activeTabGroup;
    const toClose = group.tabs.filter((tab) => tab.isPinned);
    if (toClose.length === 0) {
        void vscode.window.showInformationMessage("Branch Change Tabs: no pinned tabs in active group.");
        return;
    }
    await vscode.window.tabGroups.close(toClose, true);
}
//# sourceMappingURL=ui.js.map