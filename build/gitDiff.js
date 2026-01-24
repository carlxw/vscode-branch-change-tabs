"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBaseRef = resolveBaseRef;
exports.doesRefExist = doesRefExist;
exports.getChangedFiles = getChangedFiles;
const child_process_1 = require("child_process");
const util_1 = require("util");
const logger_1 = require("./logger");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Determines the base ref used for diffing a branch.
 */
async function resolveBaseRef(repoRoot, configuredBase, currentBranch, upstream) {
    if (configuredBase && configuredBase.trim().length > 0) {
        return configuredBase.trim();
    }
    if (await doesRefExist(repoRoot, "main")) {
        return "main";
    }
    else if (await doesRefExist(repoRoot, "master")) {
        return "master";
    }
    if (upstream && upstream.trim().length > 0) {
        const upstreamRef = upstream.trim();
        if (currentBranch && upstreamRef.endsWith(`/${currentBranch}`)) {
            return undefined;
        }
        return upstreamRef;
    }
    return undefined;
}
/**
 * Checks whether a git ref exists in the repository.
 */
async function doesRefExist(repoRoot, ref) {
    try {
        await execGit(repoRoot, ["rev-parse", "--verify", ref]);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Returns repo-relative file paths changed between base and head refs.
 */
async function getChangedFiles(repoRoot, baseRef, headRef) {
    try {
        const { stdout } = await execGit(repoRoot, ["diff", "--name-status", `${baseRef}...${headRef}`]);
        return stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => parseNameStatus(line))
            .filter((entry) => Boolean(entry));
    }
    catch (error) {
        logger_1.output.appendLine(`Failed to diff ${baseRef}...${headRef}: ${stringifyError(error)}`);
        return [];
    }
}
/**
 * Parses a git name-status line into a ChangedFile entry.
 */
function parseNameStatus(line) {
    const parts = line.split(/\t+/);
    const status = parts[0];
    if (!status) {
        return undefined;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
        const newPath = parts[2];
        if (!newPath) {
            return undefined;
        }
        return { path: newPath, kind: "modified" };
    }
    const filePath = parts[1];
    if (!filePath) {
        return undefined;
    }
    if (status === "A") {
        return { path: filePath, kind: "added" };
    }
    else if (status === "M") {
        return { path: filePath, kind: "modified" };
    }
    return undefined;
}
/**
 * Executes a git command in the repository root.
 */
async function execGit(repoRoot, args) {
    return execFileAsync("git", args, { cwd: repoRoot, windowsHide: true });
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
//# sourceMappingURL=gitDiff.js.map