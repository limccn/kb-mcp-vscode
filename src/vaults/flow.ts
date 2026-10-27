import * as path from "node:path";
import type { CliRunResult } from "../mcp/skillsCli";
import {
  clearVaultEnv,
  clearWorkspacePin,
  readWorkspacePin,
  sanitizeVaultName,
  setVaultEnv,
  writeWorkspacePin,
} from "./pin";
import {
  createVault,
  listVaults,
  readCurrentVault,
  switchVault,
  VaultCliError,
  type VaultCliContext,
  type VaultListState,
} from "./vaults";

export type VaultScope = "global" | "project";

export interface VaultsUi {
  pickScope(projectAvailable: boolean): Promise<VaultScope | undefined>;
  inputName(defaultValue: string): Promise<string | undefined>;
  confirm(title: string, detail?: string): Promise<boolean>;
  pickVault(state: VaultListState, pinned: string | null): Promise<string | undefined>;
  showVaults(state: VaultListState, pinned: string | null): Promise<void>;
  notify(message: string): void;
  error(message: string): void;
}

export interface VaultsDeps {
  resolveExe(): Promise<string>;
  workspaceRoot(): string | undefined;
  run(exe: string, args: string[], cwd?: string): Promise<CliRunResult>;
  log(message: string): void;
}

function cliContext(deps: VaultsDeps, root: string | undefined): VaultCliContext {
  return { run: deps.run, cwd: root ?? process.cwd() };
}

function pinnedOrNull(root: string | undefined, log: (message: string) => void): string | null {
  if (!root) return null;
  try {
    return readWorkspacePin(root);
  } catch (err) {
    log(`could not read the workspace pin: ${(err as Error).message}`);
    return null;
  }
}

function validName(name: string): string | null {
  if (!name) return "vault name must not be empty";
  if (name.includes("/") || name.includes("\\")) return "vault name must not contain / or \\";
  return null;
}

export async function createVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void> {
  const root = deps.workspaceRoot();
  const scope = await ui.pickScope(Boolean(root));
  if (!scope) return;
  if (scope === "project" && !root) {
    ui.error("project scope needs an open workspace folder");
    return;
  }

  const defaultName = scope === "project" ? sanitizeVaultName(path.basename(root as string)) : "";
  let name = (await ui.inputName(defaultName))?.trim() ?? "";
  if (!name) return;
  const problem = validName(name);
  if (problem) {
    ui.error(problem);
    return;
  }

  const exe = await deps.resolveExe();
  const ctx = cliContext(deps, root);

  for (;;) {
    const detail =
      scope === "project"
        ? "The vault is created in the global data root; this workspace is pinned to it (the global current vault does not change)."
        : "The vault is created in the global data root.";
    if (!(await ui.confirm(`Create vault "${name}"?`, detail))) return;
    try {
      const created = await createVault(exe, name, ctx);
      deps.log(`created vault ${created.name} at ${created.path}`);
      break;
    } catch (err) {
      if (!(err instanceof VaultCliError)) throw err;
      ui.error(err.message);
      if (!(await ui.confirm("Try another name?", err.message))) return;
      const next = (await ui.inputName(name))?.trim() ?? "";
      if (!next) return;
      const nextProblem = validName(next);
      if (nextProblem) {
        ui.error(nextProblem);
        return;
      }
      name = next;
    }
  }

  if (scope === "global") {
    if (!(await ui.confirm(`Switch to "${name}" now?`, "Changes the global default vault."))) {
      ui.notify(`vault "${name}" created`);
      return;
    }
    await switchVault(exe, name, ctx);
    const current = await readCurrentVault(exe, ctx);
    if (current === name) {
      ui.notify(`vault "${name}" is now current`);
    } else {
      ui.error(`switch returned but the current vault reads as "${current ?? "unknown"}"`);
    }
    return;
  }

  const pin = writeWorkspacePin(root as string, name);
  const env = setVaultEnv(root as string, name);
  deps.log(
    `pin ${pin.action}: ${pin.file}; mcp env: ${env.status}` +
      (env.backup ? ` (backup ${env.backup})` : "")
  );
  if (env.status === "absent") {
    ui.notify(
      `vault "${name}" created and pinned to this workspace; no project-scope hyseed entry found — ` +
        `run "hyseed: Install agent skills" with scope project, then re-pin`
    );
  } else {
    ui.notify(`vault "${name}" created and pinned to this workspace`);
  }
}

export async function switchVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void> {
  const root = deps.workspaceRoot();
  const exe = await deps.resolveExe();
  const ctx = cliContext(deps, root);
  const state = await listVaults(exe, ctx);
  const pinned = pinnedOrNull(root, deps.log);
  const picked = await ui.pickVault(state, pinned);
  if (!picked) return;
  await switchVault(exe, picked, ctx);
  const current = await readCurrentVault(exe, ctx);
  if (current === picked) {
    ui.notify(`vault "${picked}" is now current`);
  } else {
    ui.error(`switch returned but the current vault reads as "${current ?? "unknown"}"`);
  }
}

export async function clearProjectVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void> {
  const root = deps.workspaceRoot();
  if (!root) {
    ui.error("project vault pin needs an open workspace folder");
    return;
  }
  const pinned = pinnedOrNull(root, deps.log);
  if (!pinned) {
    ui.notify("no project vault pin in this workspace");
    return;
  }
  if (!(await ui.confirm(`Clear the project vault pin ("${pinned}")?`, "Vault data is not deleted."))) {
    return;
  }
  const env = clearVaultEnv(root);
  const pin = clearWorkspacePin(root);
  deps.log(`clear pin ${pin.action}; mcp env: ${env.status}`);
  const suffix = env.status === "absent" ? " (no project-scope hyseed entry)" : "";
  ui.notify(`project vault pin cleared${suffix}`);
}

export async function listVaultsFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void> {
  const root = deps.workspaceRoot();
  const exe = await deps.resolveExe();
  const state = await listVaults(exe, cliContext(deps, root));
  await ui.showVaults(state, pinnedOrNull(root, deps.log));
}