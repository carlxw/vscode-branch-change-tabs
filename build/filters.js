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
exports.filterByTypeOfChange = filterByTypeOfChange;
exports.filterExcludedFiles = filterExcludedFiles;
exports.filterExcludedDirectories = filterExcludedDirectories;
exports.filterTextFiles = filterTextFiles;
exports.filterGitIgnoredFilesDirectories = filterGitIgnoredFilesDirectories;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const logger_1 = require("./logger");
/**
 * Filters files by change kind based on user settings.
 */
function filterByTypeOfChange(files, includeModified, includeAdded) {
    if (includeModified && includeAdded) {
        return files;
    }
    if (!includeModified && !includeAdded) {
        return [];
    }
    return files.filter((file) => (includeModified ? file.kind === "modified" : file.kind === "added"));
}
/**
 * Filters files that match any of the configured exclude regexes.
 */
function filterExcludedFiles(files, regexes) {
    const compiled = regexes
        .map((pattern) => parseRegex(pattern))
        .filter((regex) => Boolean(regex));
    if (compiled.length === 0) {
        return files;
    }
    return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}
/**
 * Filters files whose repo-relative paths match any directory regex.
 */
function filterExcludedDirectories(files, dirRegexes) {
    const compiled = dirRegexes
        .map((pattern) => parseRegex(pattern))
        .filter((regex) => Boolean(regex));
    if (compiled.length === 0) {
        return files;
    }
    return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}
/**
 * Filters out files that cannot be opened as text documents.
 */
async function filterTextFiles(repoRoot, files) {
    const result = [];
    for (const file of files) {
        const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
        if (!(await doesFileExist(fileUri))) {
            continue;
        }
        try {
            await vscode.workspace.openTextDocument(fileUri);
            result.push(file);
        }
        catch (error) {
            logger_1.output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
        }
    }
    return result;
}
/**
 * Filters files ignored by git (honors .gitignore and related excludes).
 */
async function filterGitIgnoredFilesDirectories(repoRoot, files) {
    if (files.length === 0) {
        return files;
    }
    const input = files.map((file) => file.path).join("\0") + "\0";
    try {
        const { stdout, exitCode } = await runGitCheckIgnore(repoRoot, input);
        if (!stdout) {
            return files;
        }
        const ignored = new Set(stdout
            .split("\0")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0));
        if (exitCode === 1 || ignored.size) {
            return files;
        }
        return files.filter((file) => !ignored.has(file.path));
    }
    catch (error) {
        logger_1.output.appendLine(`Failed to apply gitignore filters: ${stringifyError(error)}`);
        return files;
    }
}
/**
 * Parses a regex string, supporting "/pattern/flags" or "pattern" formats.
 */
function parseRegex(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
        const lastSlash = trimmed.lastIndexOf("/");
        const pattern = trimmed.slice(1, lastSlash);
        const flags = trimmed.slice(lastSlash + 1);
        try {
            return new RegExp(pattern, flags);
        }
        catch (error) {
            logger_1.output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
            return undefined;
        }
    }
    try {
        return new RegExp(trimmed);
    }
    catch (error) {
        logger_1.output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
        return undefined;
    }
}
/**
 * Checks if a file exists on disk via the VS Code FS API.
 */
async function doesFileExist(uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
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
/**
 * Runs git check-ignore with a null-delimited list of paths.
 */
async function runGitCheckIgnore(repoRoot, input) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)("git", ["check-ignore", "-z", "--stdin"], {
            cwd: repoRoot,
            windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            reject(error);
        });
        child.on("close", (code) => {
            if (code && code !== 0 && code !== 1) {
                const message = stderr.trim() || `git check-ignore exited with code ${code}`;
                reject(new Error(message));
                return;
            }
            resolve({ stdout, exitCode: code });
        });
        if (child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}
//# sourceMappingURL=filters.js.map