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
exports.getExtensionSettings = getExtensionSettings;
const vscode = __importStar(require("vscode"));
/**
 * Loads extension settings from the VS Code configuration.
 */
function getExtensionSettings() {
    const config = vscode.workspace.getConfiguration("branchTabs");
    const promptOnNewRepository = config.get("promptOnNewRepository") ?? config.get("promptOnNewRepo");
    const disabledRepositories = config.get("disabledRepositories") ?? config.get("disabledRepos");
    const baseBranch = config.get("baseBranch", "");
    const excludedBranches = config.get("excludedBranches", ["main", "master"]);
    const includeModifiedFiles = config.get("includeModifiedFiles") ?? config.get("includeModified");
    const includeNewlyTrackedFiles = config.get("includeNewlyTrackedFiles") ?? config.get("includeAdded");
    const pinModifiedFiles = config.get("pinModifiedFiles") ?? config.get("pinModified");
    const pinNewlyTrackedFiles = config.get("pinNewlyTrackedFiles") ?? config.get("pinAdded");
    const excludedDirectories = config.get("excludedDirectories") ??
        config.get("excludeDirRegexes") ?? [
        "^dist/",
        "^build/",
        "^out/",
        "^coverage/",
        "^node_modules/",
        "^\\.turbo/",
        "^\\.next/"
    ];
    const normalizedBase = baseBranch.trim();
    if (normalizedBase.length > 0 && !excludedBranches.includes(normalizedBase)) {
        excludedBranches.push(normalizedBase);
    }
    return {
        excludedBranches,
        closeAllBeforeOpen: config.get("closeAllBeforeOpen", true),
        includeModifiedFiles: includeModifiedFiles ?? true,
        includeNewlyTrackedFiles: includeNewlyTrackedFiles ?? true,
        pinModifiedFiles: pinModifiedFiles ?? true,
        pinNewlyTrackedFiles: pinNewlyTrackedFiles ?? true,
        excludedFiles: config.get("excludedFiles", [
            "\\.png$",
            "\\.jpe?g$",
            "\\.svg$",
            "\\.gif$",
            "\\.pdf$",
            "\\.zip$",
            "\\.tar$",
            "\\.gz$",
            "\\.7z$",
            "\\.exe$",
            "\\.dmg$",
            "\\.iso$",
            "\\.jar$",
            "^\\.gitignore$",
            "^\\.gitattributes$"
        ]),
        maxFilesToOpen: config.get("maxFilesToOpen", 10),
        textFilesOnly: config.get("textFilesOnly", true),
        excludedDirectories: excludedDirectories ?? [],
        closePinnedTabsOnBranchChange: config.get("closePinnedTabsOnBranchChange", false),
        closeAllOnExcludedBranch: config.get("closeAllOnExcludedBranch", true),
        promptOnNewRepository: promptOnNewRepository ?? true,
        disabledRepositories: disabledRepositories ?? [],
        baseBranch
    };
}
//# sourceMappingURL=settings.js.map