/**
 * Setup-guide actions.
 *
 * Every write goes through an existing runtime command (`home set-data-dir`,
 * `vault create`, `skills add --force`) or an existing extension flow
 * (`installCliTools`, `installAgentSkills`). This module never edits
 * config.yaml or agent configs itself and never throws out of the panel:
 * failures degrade to a log line or an inline notice.
 */

import type { CliToolsReport, CliToolsStatus } from "../cliTools";
import { readConfigDataDir, type KbMcpConfig } from "../config";
import { HomeCommandError, type HomeInspectJson, type HomeSetDataDirJson } from "../homeCli";
import { isInitialized, pathKey, type MigrationState } from "../migration";
import { actionsSummary, parseSkillsList, parseSkillsReport } from "../mcp/report";
import { buildAddArgs, buildListArgs, type CliRunResult } from "../mcp/skillsCli";
import {
  createVault,
  parseVaultListJson,
  VaultCliError,
  type VaultInfo,
} from "../vaults/vaults";
import {
  DEFAULT_VAULT_NAME,
  type OnboardingCliState,
  type OnboardingDataState,
  type OnboardingMcpState,
  type OnboardingState,
  type OnboardingSteps,
} from "./state";

export interface OnboardingGate {
  state(): MigrationState;
  retry(): Promise<MigrationState>;
  release(): void;
}

/** Design §4: state reads are bounded so a wedged CLI cannot stall the panel. */
const STATE_READ_TIMEOUT_MS = 15_000;

export interface OnboardingDeps {
  version: string;
  home: string;
  env: NodeJS.ProcessEnv;
  readConfig(): KbMcpConfig;
  /** Raw `kbMcp.dataRoot` setting ("" when unset). */
  settingDataRoot(): string;
  resolveExe(): Promise<string>;
  run(exe: string, args: string[], cwd: string, timeoutMs?: number): Promise<CliRunResult>;
  inspectHome(dataRoot: string): Promise<HomeInspectJson>;
  setDataDir(target: string): Promise<HomeSetDataDirJson>;
  installCliTools(): Promise<CliToolsReport>;
  inspectCliTools(): Promise<CliToolsStatus>;
  installAgentSkills(): Promise<void>;
  pickDataFolder(): Promise<string | undefined>;
  openSettings(): Promise<void>;
  gate: OnboardingGate;
  ensureRunning(): Promise<void>;
  confirm(title: string, detail: string): Promise<boolean>;
  notify(level: "info" | "error", message: string): void;
  log(message: string): void;
  markOnboarded(): Promise<void>;
}

export interface OnboardingActions {
  collectState(): Promise<OnboardingState>;
  runCliStep(): Promise<void>;
  runMcpStep(): Promise<void>;
  chooseDataDir(): Promise<void>;
  reviewMigration(): Promise<void>;
  openSettings(): Promise<void>;
  cleanupLegacyMcp(): Promise<void>;
  finish(skipped: boolean, steps: OnboardingSteps): Promise<void>;
  /** Tab closed by the user: data defaults + onboarded marker, no installs. */
  handleClosed(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pinnedRoot(deps: OnboardingDeps): "setting" | "env" | null {
  if (deps.settingDataRoot().trim() !== "") return "setting";
  if ((deps.env.KB_MCP_HOME ?? "").trim() !== "") return "env";
  return null;
}

async function collectCli(deps: OnboardingDeps): Promise<OnboardingCliState> {
  try {
    const status = await deps.inspectCliTools();
    return {
      status: "ready",
      targetDir: status.targetDir,
      tools: status.tools.map((tool) => ({ name: tool.name, state: tool.state })),
      pathContainsTarget: status.pathContainsTarget,
      pathHint: status.pathHint,
    };
  } catch (error) {
    return {
      status: "unavailable",
      targetDir: "",
      tools: [],
      pathContainsTarget: false,
      pathHint: "",
      message: errorMessage(error),
    };
  }
}

async function collectMcp(deps: OnboardingDeps): Promise<OnboardingMcpState> {
  try {
    const exe = await deps.resolveExe();
    const result = await deps.run(exe, buildListArgs(), deps.home, STATE_READ_TIMEOUT_MS);
    if (result.rc !== 0) {
      throw new Error(`skills list failed (rc=${result.rc}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    const report = parseSkillsList(result.stdout);
    if (!report) throw new Error("unexpected 'skills list' output");
    const targets = report.targets.map((target) => ({
      agent: target.agent,
      scope: target.scope,
      mcp: target.mcp,
      legacy: {
        agent: target.agent,
        scope: target.scope,
        skills: target.legacy.skills,
        mcp: target.legacy.mcp,
      },
    }));
    const legacy = targets
      .map((target) => target.legacy)
      .filter((entry) => entry.skills.length > 0 || entry.mcp !== "absent");
    return { status: "ready", targets, legacy };
  } catch (error) {
    return { status: "unavailable", targets: [], legacy: [], message: errorMessage(error) };
  }
}

async function collectData(deps: OnboardingDeps): Promise<OnboardingDataState> {
  const cfg = deps.readConfig();
  const base = {
    dataRoot: cfg.dataRoot,
    configDataDir: readConfigDataDir(deps.home, deps.env),
    pinnedBy: pinnedRoot(deps),
    initialized: isInitialized(cfg.dataRoot),
    vaults: 0,
    candidates: [] as OnboardingDataState["candidates"],
  };
  try {
    const report = await deps.inspectHome(cfg.dataRoot);
    return {
      status: "ready",
      ...base,
      initialized: report.initialized,
      vaults: report.vaults,
      candidates: report.candidates.map((candidate) => ({
        path: candidate.path,
        kind: candidate.kind,
        vaults: typeof candidate.vaults === "number" ? candidate.vaults : 0,
        documents: typeof candidate.documents === "number" ? candidate.documents : null,
      })),
    };
  } catch (error) {
    const unsupported = error instanceof HomeCommandError && error.details.unsupported;
    return {
      status: "unavailable",
      ...base,
      message: unsupported
        ? "the resolved hyseed runtime has no 'home' command; install CLI tools first, then reopen this guide"
        : errorMessage(error),
    };
  }
}

export function createOnboardingActions(deps: OnboardingDeps): OnboardingActions {
  // Shared in-flight guard: a close racing a finish must apply defaults once.
  let defaultsInFlight: Promise<void> | null = null;

  async function collectState(): Promise<OnboardingState> {
    const [cli, mcp, data] = await Promise.all([collectCli(deps), collectMcp(deps), collectData(deps)]);
    return { version: deps.version, cli, mcp, data };
  }

  async function retryGateAfterInstall(): Promise<void> {
    const state = deps.gate.state();
    if (state.kind === "pending" && state.reason === "not-now") {
      deps.log("onboarding: migration is deferred; not re-opening the legacy-data prompt");
      return;
    }
    try {
      await deps.gate.retry();
    } catch (error) {
      deps.log(`onboarding: migration gate retry failed: ${errorMessage(error)}`);
    }
  }

  async function runCliStep(): Promise<void> {
    try {
      const report = await deps.installCliTools();
      const count = (action: string) =>
        report.results.filter((result) => result.action === action).length;
      const leftovers = report.results
        .map((result) => result.leftover)
        .filter((leftover): leftover is string => leftover !== null);
      deps.log(
        `onboarding: cli tools installed=${count("installed")} replaced=${count("replaced")} kept=${count("kept")}`
      );
      deps.notify(
        "info",
        `CLI tools in ${report.targetDir}: installed ${count("installed")}, ` +
          `replaced ${count("replaced")}, kept ${count("kept")}. ${report.pathHint}` +
          (leftovers.length > 0 ? ` Leftovers: ${leftovers.join(", ")}` : "")
      );
      await retryGateAfterInstall();
    } catch (error) {
      deps.log(`onboarding: install CLI tools failed: ${errorMessage(error)}`);
      deps.notify("error", `install CLI tools failed: ${errorMessage(error)}`);
    }
  }

  async function runMcpStep(): Promise<void> {
    try {
      await deps.installAgentSkills();
      deps.log("onboarding: agent skills flow finished");
    } catch (error) {
      deps.log(`onboarding: install MCP & skills failed: ${errorMessage(error)}`);
      deps.notify("error", `install MCP & skills failed: ${errorMessage(error)}`);
    }
  }

  async function chooseDataDir(): Promise<void> {
    const pinned = pinnedRoot(deps);
    if (pinned !== null) {
      deps.notify(
        "error",
        `${pinned === "setting" ? "the 'kbMcp.dataRoot' setting" : "the KB_MCP_HOME variable"} ` +
          "overrides the data folder; clear it, then reopen this guide"
      );
      return;
    }
    const target = await deps.pickDataFolder();
    if (!target) return;
    try {
      await deps.setDataDir(target);
      // Mirror MigrationGate.useRoot: a setting, KB_MCP_HOME, or a config
      // redirect can keep the effective root unchanged even though the CLI
      // reported success; never claim a move that did not happen.
      const effective = deps.readConfig().dataRoot;
      if (pathKey(effective) !== pathKey(target)) {
        const message =
          `the runtime config now points at ${target}, but this window still resolves ${effective}` +
          " (a setting, KB_MCP_HOME, or KB_MCP_CONFIG may override it)";
        deps.log(`onboarding: ${message}`);
        deps.notify("error", message);
        return;
      }
      deps.log(`onboarding: data folder set to ${target}`);
      deps.notify("info", `data folder set to ${target}`);
      deps.gate.release();
      try {
        await deps.ensureRunning();
      } catch (error) {
        deps.log(`onboarding: could not start the server after the data-root change: ${errorMessage(error)}`);
      }
    } catch (error) {
      deps.log(`onboarding: could not set the data folder: ${errorMessage(error)}`);
      deps.notify("error", `could not set the data folder: ${errorMessage(error)}`);
    }
  }

  async function reviewMigration(): Promise<void> {
    try {
      const state = await deps.gate.retry();
      switch (state.kind) {
        case "ready":
          deps.notify("info", `data folder is ready: ${state.dataRoot}`);
          break;
        case "fresh":
          deps.notify("info", `no legacy data was found; using ${state.dataRoot}`);
          break;
        case "pending":
          deps.notify("info", `data folder setup is still pending (${state.reason})`);
          break;
        case "error":
          deps.notify("error", `data folder check failed: ${state.message}`);
          break;
        default:
          deps.notify("info", `data folder check: ${state.kind}`);
      }
    } catch (error) {
      deps.log(`onboarding: migration review failed: ${errorMessage(error)}`);
      deps.notify("error", `data folder check failed: ${errorMessage(error)}`);
    }
  }

  async function cleanupLegacyMcp(): Promise<void> {
    const mcp = await collectMcp(deps);
    if (mcp.status !== "ready") {
      deps.notify("error", mcp.message ?? "skills list is unavailable");
      return;
    }
    if (mcp.legacy.length === 0) {
      deps.notify("info", "no pre-rename kb/kb-manage entries were found");
      return;
    }
    const found = mcp.legacy
      .map((entry) => `${entry.agent}/${entry.scope}${entry.skills.length > 0 ? ` (skills: ${entry.skills.join(", ")})` : ""}`)
      .join("\n");
    const proceed = await deps.confirm(
      "Remove pre-rename kb/kb-manage entries?",
      `${found}\n\n` +
        "This reinstalls the current hyseed skills into the affected hosts with --force, " +
        "the only supported way to clear the pre-rename entries and skill links. " +
        "Vault data is never touched."
    );
    if (!proceed) return;
    let exe: string;
    try {
      exe = await deps.resolveExe();
    } catch (error) {
      deps.log(`onboarding: runtime resolution failed: ${errorMessage(error)}`);
      deps.notify("error", `could not resolve the hyseed runtime: ${errorMessage(error)}`);
      return;
    }
    let cleaned = 0;
    for (const entry of mcp.legacy) {
      try {
        const result = await deps.run(
          exe,
          buildAddArgs([entry.agent], entry.scope, { force: true, mcpCommand: exe }),
          deps.home
        );
        const report = parseSkillsReport(result.stdout);
        if (!report || result.rc !== 0) {
          throw new Error(
            `skills add --force failed (rc=${result.rc}): ${result.stderr.trim() || result.stdout.trim()}`
          );
        }
        deps.log(`onboarding: legacy cleanup ${entry.agent}/${entry.scope}: ${actionsSummary(report)}`);
        cleaned += 1;
      } catch (error) {
        deps.log(`onboarding: legacy cleanup failed for ${entry.agent}/${entry.scope}: ${errorMessage(error)}`);
        deps.notify("error", `could not clean up ${entry.agent}/${entry.scope}: ${errorMessage(error)}`);
      }
    }
    if (cleaned > 0) {
      deps.notify(
        "info",
        `old entries cleaned up in ${cleaned} host/scope target(s); current skills were reinstalled with --force`
      );
    }
  }

  async function ensureDefaultVault(): Promise<void> {
    const exe = await deps.resolveExe();
    const cfg = deps.readConfig();
    let vaults: VaultInfo[];
    try {
      const listed = await deps.run(exe, ["vault", "list", "--json"], deps.home, STATE_READ_TIMEOUT_MS);
      if (listed.rc !== 0) throw new VaultCliError(listed.rc, listed.stdout, listed.stderr);
      vaults = parseVaultListJson(listed.stdout);
    } catch (error) {
      deps.log(`onboarding: could not list vaults: ${errorMessage(error)}`);
      return;
    }
    if (vaults.length > 0) return;
    try {
      await createVault(exe, DEFAULT_VAULT_NAME, {
        run: (vaultExe, args, cwd) => deps.run(vaultExe, args, cwd ?? deps.home),
        cwd: deps.home,
      });
      deps.log(`onboarding: registered vault '${DEFAULT_VAULT_NAME}' in ${cfg.dataRoot}`);
    } catch (error) {
      // rc 4 is the documented duplicate; the message check covers older CLIs.
      if ((error instanceof VaultCliError && error.rc === 4) || /already exists/i.test(errorMessage(error))) {
        return;
      }
      deps.log(`onboarding: could not create the '${DEFAULT_VAULT_NAME}' vault: ${errorMessage(error)}`);
    }
  }

  /**
   * Skip/close defaults (design §6): persist the effective root through
   * `home set-data-dir` (never when a setting/env pin owns the root) and
   * register a `default` vault in an empty root.
   *
   * Persisting `data_dir` is safe in every gate state: it writes the value the
   * extension already resolves and never initialises the root, so AC-1 holds
   * even when `home inspect` failed (the command simply fails and is logged on
   * a runtime that predates `home`). The `default` vault is created only when
   * the gate is resolved (`ready`/`fresh`): a vault in a `checking`/`no-data`/
   * `pending`/`error` root would make a future migration target non-empty and
   * mask legacy data from a later detection.
   */
  async function applyDataDefaults(): Promise<void> {
    const state = deps.gate.state();
    const pinned = pinnedRoot(deps);
    if (pinned === null) {
      const root = deps.readConfig().dataRoot;
      try {
        await deps.setDataDir(root);
        deps.log(`onboarding: default data folder persisted: ${root}`);
      } catch (error) {
        deps.log(`onboarding: could not persist the default data folder: ${errorMessage(error)}`);
      }
    } else {
      deps.log(`onboarding: data folder is pinned by ${pinned}; config.yaml left untouched`);
    }
    if (state.kind !== "ready" && state.kind !== "fresh") {
      deps.log(`onboarding: default vault deferred while the migration gate is ${state.kind}`);
      return;
    }
    try {
      await ensureDefaultVault();
    } catch (error) {
      // Never let a vault-preparation failure skip the onboarded marker.
      deps.log(`onboarding: could not prepare the default vault: ${errorMessage(error)}`);
    }
  }

  function applyDefaultsAndMark(reason: string): Promise<void> {
    if (!defaultsInFlight) {
      defaultsInFlight = (async () => {
        await applyDataDefaults();
        try {
          await deps.markOnboarded();
          deps.log(`onboarding: version ${deps.version} marked onboarded (${reason})`);
        } catch (error) {
          deps.log(`onboarding: could not record the onboarded version: ${errorMessage(error)}`);
        }
      })().finally(() => {
        defaultsInFlight = null;
      });
    }
    return defaultsInFlight;
  }

  // Covers the whole finish flow (installs included) so a user close during an
  // install joins it instead of applying the data defaults a second time.
  let finishFlow: Promise<void> | null = null;

  function finish(skipped: boolean, steps: OnboardingSteps): Promise<void> {
    if (!finishFlow) {
      finishFlow = (async () => {
        if (!skipped) {
          if (steps.cli) await runCliStep();
          if (steps.mcp) await runMcpStep();
        }
        await applyDefaultsAndMark(skipped ? "skip" : "finish");
      })().finally(() => {
        finishFlow = null;
      });
    }
    return finishFlow;
  }

  return {
    collectState,
    runCliStep,
    runMcpStep,
    chooseDataDir,
    reviewMigration,
    async openSettings() {
      try {
        await deps.openSettings();
      } catch (error) {
        deps.log(`onboarding: could not open settings: ${errorMessage(error)}`);
      }
    },
    cleanupLegacyMcp,
    finish,
    handleClosed: () => finishFlow ?? applyDefaultsAndMark("closed"),
  };
}