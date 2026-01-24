import * as vscode from "vscode";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { ChangedFile } from "./types";
import { output } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Filters files by change kind based on user settings.
 */
export function filterByChangeKind(
  files: ChangedFile[],
  includeModified: boolean,
  includeAdded: boolean
): ChangedFile[] {
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
export function filterExcluded(files: ChangedFile[], regexes: string[]): ChangedFile[] {
  const compiled = regexes
    .map((pattern) => parseRegex(pattern))
    .filter((regex): regex is RegExp => Boolean(regex));
  if (compiled.length === 0) {
    return files;
  }
  return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}

/**
 * Filters files whose repo-relative paths match any directory regex.
 */
export function filterExcludedDirectories(files: ChangedFile[], dirRegexes: string[]): ChangedFile[] {
  const compiled = dirRegexes
    .map((pattern) => parseRegex(pattern))
    .filter((regex): regex is RegExp => Boolean(regex));
  if (compiled.length === 0) {
    return files;
  }
  return files.filter((file) => !compiled.some((regex) => regex.test(file.path)));
}

/**
 * Filters out files that cannot be opened as text documents.
 */
export async function filterTextFiles(
  repoRoot: string,
  files: ChangedFile[]
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    const fileUri = vscode.Uri.file(path.join(repoRoot, file.path));
    if (!(await fileExists(fileUri))) {
      continue;
    }
    try {
      await vscode.workspace.openTextDocument(fileUri);
      result.push(file);
    } catch (error) {
      output.appendLine(`Skipping non-text file "${file.path}": ${stringifyError(error)}`);
    }
  }
  return result;
}

/**
 * Filters files ignored by git (honors .gitignore and related excludes).
 */
export async function filterGitIgnored(
  repoRoot: string,
  files: ChangedFile[]
): Promise<ChangedFile[]> {
  if (files.length === 0) {
    return files;
  }

  const input = files.map((file) => file.path).join("\0") + "\0";
  try {
    const { stdout, exitCode } = await runGitCheckIgnore(repoRoot, input);
    if (!stdout) {
      return files;
    }
    const ignored = new Set(
      stdout
        .split("\0")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    );
    if (ignored.size === 0) {
      return files;
    }
    return files.filter((file) => !ignored.has(file.path));
    if (exitCode === 1) {
      return files;
    }
  } catch (error) {
    output.appendLine(`Failed to apply gitignore filters: ${stringifyError(error)}`);
    return files;
  }
}

/**
 * Parses a regex string, supporting "/pattern/flags" or "pattern" formats.
 */
function parseRegex(value: string): RegExp | undefined {
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
    } catch (error) {
      output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
      return undefined;
    }
  }

  try {
    return new RegExp(trimmed);
  } catch (error) {
    output.appendLine(`Invalid regex "${value}": ${stringifyError(error)}`);
    return undefined;
  }
}

/**
 * Checks if a file exists on disk via the VS Code FS API.
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats an error into a readable message.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Runs git check-ignore with a null-delimited list of paths.
 */
async function runGitCheckIgnore(
  repoRoot: string,
  input: string
): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
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
