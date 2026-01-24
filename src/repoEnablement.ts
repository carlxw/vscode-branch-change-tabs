import * as vscode from "vscode";
import { Repository, ExtensionSEttings } from "./types";
import { output } from "./logger";

const repositoryEnabledCache = new Map<string, boolean>();
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Initializes enablement tracking with the extension context.
 */
export function initRepositoryTracking(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Clears stored repository enable/disable decisions (dev helper).
 */
export async function clearAllExtensionTrackedRepositories(): Promise<void> {
  if (!extensionContext) {
    return;
  }

  repositoryEnabledCache.clear();
  const keys = extensionContext.globalState.keys().filter((key) => key.startsWith("repoEnabled:"));
  for (const key of keys) {
    await extensionContext.globalState.update(key, undefined);
  }
}

/**
 * Ensures repository enablement state is known, prompting once if needed.
 */
export async function isRepositoryEnabledOnInitialCheckout(
  repo: Repository,
  settings: ExtensionSEttings
): Promise<boolean> {
  if (!extensionContext) {
    return true;
  }

  const key = repo.rootUri.fsPath;
  if (settings.enabledRepositories.length > 0) {
    const normalized = new Set(
      settings.enabledRepositories.map((entry) => entry.trim()).filter(Boolean)
    );
    const enabled = normalized.has(key);
    repositoryEnabledCache.set(key, enabled);

    return enabled;
  }

  const cached = repositoryEnabledCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const stored = extensionContext.globalState.get<boolean>(`repoEnabled:${key}`);
  if (stored !== undefined) {
    repositoryEnabledCache.set(key, stored);
    return stored;
  }

  if (!settings.promptOnNewRepository) {
    repositoryEnabledCache.set(key, true);
    await extensionContext.globalState.update(`repoEnabled:${key}`, true);
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    "Enable Branch Change Tabs for this repository?",
    { detail: key },
    "Enable",
    "Always Enable",
    "Disable",
    "Don't Ask Again"
  );

  if (!choice) {
    return true;
  } else if (choice === "Don't Ask Again") {
    const config = vscode.workspace.getConfiguration("branchTabs");
    await config.update("promptOnNewRepository", false, true);
    repositoryEnabledCache.set(key, true);
    await extensionContext.globalState.update(`repoEnabled:${key}`, true);
    output.appendLine(
      "Disabled future repository prompts (branchTabs.promptOnNewRepository = false)."
    );
    return true;
  }

  const enabled = choice === "Enable" || choice === "Always Enable";
  repositoryEnabledCache.set(key, enabled);
  await extensionContext.globalState.update(`repoEnabled:${key}`, enabled);
  if (!enabled) {
    output.appendLine(`Repository disabled by user: ${key}`);
  }

  return enabled;
}
