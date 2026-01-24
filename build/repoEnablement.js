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
exports.initRepositoryTracking = initRepositoryTracking;
exports.clearAllExtensionTrackedRepositories = clearAllExtensionTrackedRepositories;
exports.isRepositoryEnabledOnInitialCheckout = isRepositoryEnabledOnInitialCheckout;
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
const repositoryEnabledCache = new Map();
let extensionContext;
/**
 * Initializes enablement tracking with the extension context.
 */
function initRepositoryTracking(context) {
    extensionContext = context;
}
/**
 * Clears stored repository enable/disable decisions (dev helper).
 */
async function clearAllExtensionTrackedRepositories() {
    if (!extensionContext) {
        return;
    }
    repositoryEnabledCache.clear();
    const keys = extensionContext.globalState.keys().filter((key) => key.startsWith("repoDisabled:"));
    for (const key of keys) {
        await extensionContext.globalState.update(key, undefined);
    }
}
/**
 * Ensures repository enablement state is known, prompting once if needed.
 */
async function isRepositoryEnabledOnInitialCheckout(repo, settings) {
    if (!extensionContext) {
        return true;
    }
    const key = repo.rootUri.fsPath;
    if (settings.disabledRepositories.length > 0) {
        const normalized = new Set(settings.disabledRepositories.map((entry) => entry.trim()).filter(Boolean));
        const enabled = !normalized.has(key);
        repositoryEnabledCache.set(key, enabled);
        return enabled;
    }
    const cached = repositoryEnabledCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const storedDisabled = extensionContext.globalState.get(`repoDisabled:${key}`);
    if (storedDisabled !== undefined) {
        const enabled = !storedDisabled;
        repositoryEnabledCache.set(key, enabled);
        return enabled;
    }
    if (!settings.promptOnNewRepository) {
        repositoryEnabledCache.set(key, true);
        return true;
    }
    const choice = await vscode.window.showInformationMessage("Enable Branch Change Tabs for this repository?", { detail: key }, "Enable", "Always Enable", "Disable", "Don't Ask Again");
    if (!choice) {
        return true;
    }
    else if (choice === "Don't Ask Again") {
        return true;
    }
    if (choice === "Always Enable") {
        const config = vscode.workspace.getConfiguration("branchTabs");
        await config.update("promptOnNewRepository", false, true);
        repositoryEnabledCache.set(key, true);
        await extensionContext.globalState.update(`repoDisabled:${key}`, false);
        logger_1.output.appendLine("Disabled future repository prompts (branchTabs.promptOnNewRepository = false).");
        return true;
    }
    const enabled = choice === "Enable";
    repositoryEnabledCache.set(key, enabled);
    if (enabled) {
        await extensionContext.globalState.update(`repoDisabled:${key}`, false);
    }
    else {
        await extensionContext.globalState.update(`repoDisabled:${key}`, true);
        logger_1.output.appendLine(`Repository disabled by user: ${key}`);
    }
    return enabled;
}
//# sourceMappingURL=repoEnablement.js.map