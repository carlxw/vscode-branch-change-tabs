import * as vscode from "vscode";
import { Repository, Settings } from "./types";
import { output } from "./logger";

const repoEnabledCache = new Map<string, boolean>();
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Initializes enablement tracking with the extension context.
 */
export function initRepoEnablement(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Clears stored repo enable/disable decisions (dev helper).
 */
export async function clearRepoDecisions(): Promise<void> {
  if (!extensionContext) {
    return;
  }
  repoEnabledCache.clear();
  const keys = extensionContext.globalState.keys().filter((key) => key.startsWith("repoEnabled:"));
  for (const key of keys) {
    await extensionContext.globalState.update(key, undefined);
  }
}

/**
 * Ensures repo enablement state is known, prompting once if needed.
 */
export async function ensureRepoEnabledOnFirstCheckout(
  repo: Repository,
  settings: Settings
): Promise<boolean> {
  if (!extensionContext) {
    return true;
  }
  const key = repo.rootUri.fsPath;
  if (settings.enabledRepos.length > 0) {
    const normalized = new Set(settings.enabledRepos.map((entry) => entry.trim()).filter(Boolean));
    const enabled = normalized.has(key);
    repoEnabledCache.set(key, enabled);
    return enabled;
  }
  const cached = repoEnabledCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const stored = extensionContext.globalState.get<boolean>(`repoEnabled:${key}`);
  if (stored !== undefined) {
    repoEnabledCache.set(key, stored);
    return stored;
  }

  if (!settings.promptOnNewRepo) {
    repoEnabledCache.set(key, true);
    await extensionContext.globalState.update(`repoEnabled:${key}`, true);
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    "Enable Branch Change Tabs for this repository?",
    { modal: true, detail: key },
    "Enable",
    "Disable"
  );

  const enabled = choice === "Enable";
  repoEnabledCache.set(key, enabled);
  await extensionContext.globalState.update(`repoEnabled:${key}`, enabled);
  if (!enabled) {
    output.appendLine(`Repository disabled by user: ${key}`);
  }
  return enabled;
}
