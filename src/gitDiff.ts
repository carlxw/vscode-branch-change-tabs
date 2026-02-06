import { execFile } from "child_process";
import { promisify } from "util";
import { ChangedFile } from "./types";
import { output } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Determines the base ref used for diffing a branch.
 */
export async function resolveBaseRef(
  repoRoot: string,
  configuredBase: string,
  currentBranch?: string,
  upstream?: string
): Promise<string | undefined> {
  if (configuredBase && configuredBase.trim().length > 0) {
    return configuredBase.trim();
  }

  if (await doesRefExist(repoRoot, "main")) {
    return "main";
  } else if (await doesRefExist(repoRoot, "master")) {
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
export async function doesRefExist(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await execGit(repoRoot, ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns repo-relative file paths changed between base and head refs.
 */
export async function getChangedFiles(
  repoRoot: string,
  baseRef: string,
  headRef: string
): Promise<ChangedFile[]> {
  try {
    const { stdout } = await execGit(repoRoot, ["diff", "--name-status", `${baseRef}...${headRef}`]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseNameStatus(line))
      .filter((entry): entry is ChangedFile => Boolean(entry));
  } catch (error) {
    output.appendLine(`Failed to diff ${baseRef}...${headRef}: ${stringifyError(error)}`);
    return [];
  }
}

/**
 * Parses a git name-status line into a ChangedFile entry.
 */
function parseNameStatus(line: string): ChangedFile | undefined {
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
  } else if (status === "M") {
    return { path: filePath, kind: "modified" };
  }

  return undefined;
}

/**
 * Executes a git command in the repository root.
 */
async function execGit(repoRoot: string, args: string[]) {
  return execFileAsync("git", args, {
    cwd: repoRoot,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  });
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
