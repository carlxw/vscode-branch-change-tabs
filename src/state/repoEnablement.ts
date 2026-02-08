import * as vscode from "vscode";
import { Repository, ExtensionSEttings } from "../core/types";
import { output } from "../core/logger";

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
  const keys = extensionContext.globalState.keys().filter((key) => key.startsWith("repoDisabled:"));
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
  if (settings.disabledRepositories.length > 0) {
    const normalized = new Set(
      settings.disabledRepositories.map((entry) => entry.trim()).filter(Boolean)
    );
    const enabled = !normalized.has(key);
    repositoryEnabledCache.set(key, enabled);

    return enabled;
  }

  const cached = repositoryEnabledCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const storedDisabled = extensionContext.globalState.get<boolean>(`repoDisabled:${key}`);
  if (storedDisabled !== undefined) {
    const enabled = !storedDisabled;
    repositoryEnabledCache.set(key, enabled);
    return enabled;
  }

  if (!settings.promptOnNewRepository) {
    repositoryEnabledCache.set(key, true);
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
    return true;
  }

  if (choice === "Always Enable") {
    const config = vscode.workspace.getConfiguration("branchTabs");
    await config.update("promptOnNewRepository", false, true);
    repositoryEnabledCache.set(key, true);
    await extensionContext.globalState.update(`repoDisabled:${key}`, false);
    output.appendLine(
      "Disabled future repository prompts (branchTabs.promptOnNewRepository = false)."
    );
    return true;
  }

  const enabled = choice === "Enable";
  repositoryEnabledCache.set(key, enabled);
  if (enabled) {
    await extensionContext.globalState.update(`repoDisabled:${key}`, false);
  } else {
    await extensionContext.globalState.update(`repoDisabled:${key}`, true);
    output.appendLine(`Repository disabled by user: ${key}`);
  }

  return enabled;
}
