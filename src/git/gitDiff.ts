import { execFile } from "child_process";
import { promisify } from "util";
import { ChangedFile } from "../core/types";
import { output } from "../core/logger";

const execFileAsync = promisify(execFile);
const AUTHOR_MARKER = "__BCT_AUTHOR__";

type GitAuthor = {
  email?: string;
  name?: string;
};

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
    const configuredRef = configuredBase.trim();
    if (await doesRefExist(repoRoot, configuredRef)) {
      return configuredRef;
    }
    output.appendLine(`Configured base ref "${configuredRef}" not found. Falling back.`);
  }

  if (upstream && upstream.trim().length > 0) {
    const upstreamRef = upstream.trim();
    const tracksSameBranch =
      (currentBranch && upstreamRef === currentBranch) ||
      (currentBranch && upstreamRef.endsWith(`/${currentBranch}`));
    if (!tracksSameBranch && (await doesRefExist(repoRoot, upstreamRef))) {
      return upstreamRef;
    }
  }

  if (await doesRefExist(repoRoot, "main")) {
    return "main";
  } else if (await doesRefExist(repoRoot, "master")) {
    return "master";
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
 * Filters changed files to only those last authored by the current git author.
 */
export async function filterChangedFilesByCurrentAuthor(
  repoRoot: string,
  headRef: string,
  files: ChangedFile[]
): Promise<ChangedFile[]> {
  if (files.length === 0) {
    return files;
  }

  const currentAuthor = await getCurrentAuthor(repoRoot);
  if (!currentAuthor) {
    output.appendLine("Current git author could not be determined; author filter produced no files.");
    return [];
  }

  try {
    const changedPaths = files.map((file) => file.path);
    const authorByPath = await getLatestAuthorByPath(repoRoot, headRef, changedPaths);
    const filtered = files.filter((file) => {
      const fileAuthor = authorByPath.get(file.path);
      return fileAuthor ? doesAuthorMatch(fileAuthor, currentAuthor) : false;
    });

    output.appendLine(
      `Files after author filter: ${filtered.length} of ${files.length} match current author.`
    );
    return filtered;
  } catch (error) {
    output.appendLine(`Failed to apply author filter: ${stringifyError(error)}`);
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
 * Reads the active git author identity from repository config.
 */
async function getCurrentAuthor(repoRoot: string): Promise<GitAuthor | undefined> {
  const [email, name] = await Promise.all([
    getGitConfigValue(repoRoot, "user.email"),
    getGitConfigValue(repoRoot, "user.name")
  ]);
  if (!email && !name) {
    return undefined;
  }

  return { email, name };
}

/**
 * Gets last commit author metadata for each path on the given ref.
 */
async function getLatestAuthorByPath(
  repoRoot: string,
  ref: string,
  paths: string[]
): Promise<Map<string, GitAuthor>> {
  const wanted = new Set(paths);
  const result = new Map<string, GitAuthor>();
  if (wanted.size === 0) {
    return result;
  }

  const { stdout } = await execGit(repoRoot, [
    "log",
    `--format=${AUTHOR_MARKER}%x00%ae%x00%an`,
    "-z",
    "--name-only",
    ref,
    "--",
    ...paths
  ]);

  const tokens = stdout.split("\0");
  let currentAuthor: GitAuthor | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === AUTHOR_MARKER) {
      currentAuthor = {
        email: (tokens[index + 1] ?? "").trim(),
        name: (tokens[index + 2] ?? "").trim()
      };
      index += 2;
      continue;
    }

    const filePath = token.trim();
    if (!currentAuthor || !filePath || !wanted.has(filePath) || result.has(filePath)) {
      continue;
    }
    result.set(filePath, currentAuthor);
    if (result.size === wanted.size) {
      break;
    }
  }

  return result;
}

/**
 * Reads a git config value from repo or global scope.
 */
async function getGitConfigValue(repoRoot: string, key: string): Promise<string | undefined> {
  try {
    const { stdout } = await execGit(repoRoot, ["config", "--get", key]);
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compares file author metadata against the current git author.
 */
function doesAuthorMatch(fileAuthor: GitAuthor, currentAuthor: GitAuthor): boolean {
  const expectedEmail = normalizeIdentity(currentAuthor.email);
  if (expectedEmail) {
    return normalizeIdentity(fileAuthor.email) === expectedEmail;
  }

  const expectedName = normalizeIdentity(currentAuthor.name);
  if (expectedName) {
    return normalizeIdentity(fileAuthor.name) === expectedName;
  }

  return false;
}

/**
 * Normalizes identity fields for case-insensitive matching.
 */
function normalizeIdentity(value?: string): string {
  return (value ?? "").trim().toLowerCase();
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
