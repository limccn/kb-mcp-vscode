import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  CFG_SECTION,
  CLI_COMMAND_IDS,
  CLI_TERMINAL_NAME,
  COMMANDS,
  LAUNCHER_VIEW_ID,
  MCP_PROVIDER_ID,
  MCP_PROVIDER_LABEL,
  PANEL_PREFIX,
  TOKEN_FILE_NAME,
} from "./constants";
import { inspectCliTools, installCliTools, type CliToolsReport } from "./cliTools";
import { onConfigChanged, readConfig, type KbMcpConfig } from "./config";
import { resolveConverter } from "./converter";
import { adminBaseUrl, isNonLoopback } from "./host";
import { inspectHome, migrateHome, setDataDir } from "./homeCli";
import { runCliCommand, type CliDeps, type TokenSource } from "./cli/flow";
import type { CliEnv } from "./cli/quote";
import type { CliUi } from "./cli/registry";
import { createTerminalSender, type TerminalSender } from "./cli/terminal";
import { SearchHistoryStore } from "./history";
import { AdminLauncherViewProvider } from "./launcher";
import {
  isInitialized,
  MigrationGate,
  pathKey,
  recordVersionState,
  scanExtensionDataDirs,
  type ConflictDecision,
  type ConflictPrompt,
  type LegacyCandidate,
  type MigrationDecision,
  type MigrationPrompt,
  type MigrationState,
} from "./migration";
import { getLogChannel, logLine } from "./log";
import { createOnboardingActions, type OnboardingActions } from "./onboarding/actions";
import { OnboardingPanel } from "./onboarding/panel";
import {
  AUTO_OPEN_DELAY_MS,
  ONBOARDED_VERSION_KEY,
  decideOnboarding,
  type OnboardingReason,
} from "./onboarding/state";
import {
  installSkillsFlow,
  removeSkillsFlow,
  showSkillsStateFlow,
  type SkillsDeps,
  type SkillsScope,
  type SkillsUi,
} from "./mcp/flow";
import { provideMcpServerDefinitions, registerMcpProvider } from "./mcp/provider";
import { runSkillsCli } from "./mcp/skillsCli";
import { AdminPanel } from "./panel";
import { RuntimeResolveError, resolveRuntimeFromDisk, type RuntimeResolution } from "./runtime";
import { createServerOps, ServerManager } from "./server";
import { StatusBar } from "./status";
import {
  clearProjectVaultFlow,
  createVaultFlow,
  listVaultsFlow,
  switchVaultFlow,
  type VaultScope,
  type VaultsDeps,
  type VaultsUi,
} from "./vaults/flow";
import type { VaultListState } from "./vaults/vaults";

let manager: ServerManager | undefined;
let statusBar: StatusBar | undefined;
let panel: AdminPanel | undefined;
let launcherView: AdminLauncherViewProvider | undefined;
let migrationGate: MigrationGate | undefined;
let onboardingPanel: OnboardingPanel | undefined;
let onboardingActions: OnboardingActions | undefined;
let lastRuntime: RuntimeResolution | null = null;
let cliSender: TerminalSender | undefined;

async function resolveRuntimeExe(context: vscode.ExtensionContext): Promise<string> {
  const resolved = await resolveRuntimeFromDisk(readConfig(), context.extensionUri.fsPath);
  lastRuntime = resolved;
  return resolved.exePath;
}

function defaultCliSender(): TerminalSender {
  cliSender ??= createTerminalSender(() =>
    vscode.window.createTerminal({
      name: CLI_TERMINAL_NAME,
      shellPath: process.env.ComSpec ?? "cmd.exe",
      shellArgs: ["/d"],
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    })
  );
  return cliSender;
}

export interface HyseedExtensionApi {
  provideMcpServerDefinitions(extensionPath: string): Promise<vscode.McpServerDefinition[]>;
  installSkillsFlow: typeof installSkillsFlow;
  removeSkillsFlow: typeof removeSkillsFlow;
  showSkillsStateFlow: typeof showSkillsStateFlow;
  createSkillsDeps(overrides?: { env?: NodeJS.ProcessEnv; cwd?: string }): SkillsDeps;
  createVaultFlow: typeof createVaultFlow;
  switchVaultFlow: typeof switchVaultFlow;
  clearProjectVaultFlow: typeof clearProjectVaultFlow;
  listVaultsFlow: typeof listVaultsFlow;
  createVaultsDeps(overrides?: { env?: NodeJS.ProcessEnv; cwd?: string }): VaultsDeps;
  runCliCommand: typeof runCliCommand;
  cliCommandIds: readonly string[];
  createCliDeps(overrides?: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    sendToTerminal?: (lines: string[]) => void;
  }): CliDeps;
  installCliTools(options?: {
    resourcesDir?: string;
    targetDir?: string;
    pathEnv?: string;
    platform?: NodeJS.Platform;
  }): Promise<CliToolsReport>;
  /** Integration drill hook; throws unless the host runs in test mode. */
  onboardingStateForTest(): {
    open: boolean;
    reason: OnboardingReason | null;
    creations: number;
    onboardedVersion: string | null;
  };
  /** Integration drill hook; throws unless the host runs in test mode. */
  finishOnboardingForTest(skipped: boolean): Promise<void>;
}

function installBundledCliTools(
  extensionPath: string,
  overrides: {
    resourcesDir?: string;
    targetDir?: string;
    pathEnv?: string;
    platform?: NodeJS.Platform;
  } = {}
): Promise<CliToolsReport> {
  return installCliTools({
    resourcesDir: overrides.resourcesDir ?? path.join(extensionPath, "resources"),
    targetDir: overrides.targetDir ?? path.join(os.homedir(), ".local", "bin"),
    pathEnv: overrides.pathEnv ?? process.env.PATH ?? "",
    platform: overrides.platform,
  });
}

function describeCandidate(candidate: LegacyCandidate): string {
  const documents =
    candidate.documents === null ? "documents unreadable" : `${candidate.documents} document(s)`;
  return `${candidate.path} (${candidate.kind}): ${candidate.vaults} vault(s), ${documents}`;
}

async function pickDataFolder(title: string): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use this folder",
    title: `${PANEL_PREFIX} ${title}`,
  });
  return picked?.[0]?.fsPath;
}

/**
 * Blocking legacy-data prompt. Migrate is the first (default) button; no option
 * ever merges two roots. A dismissed prompt is treated as "not now" by the gate.
 */
async function decideMigration(prompt: MigrationPrompt): Promise<MigrationDecision | null> {
  let candidate = prompt.candidates[0];
  if (prompt.candidates.length > 1) {
    const picked = await vscode.window.showQuickPick(
      prompt.candidates.map((item, index) => ({
        label: describeCandidate(item),
        description: index === 0 ? "newest" : undefined,
        candidate: item,
      })),
      { placeHolder: "Legacy hyseed data found — choose the folder to bring forward" }
    );
    if (!picked) return null;
    candidate = picked.candidate;
  }
  const detail = [
    `Source: ${describeCandidate(candidate)}`,
    `Current data folder: ${prompt.dataRoot}`,
    "",
    "Migrate moves the old vaults into the current data folder; the old location is removed when both are on the same volume.",
    "Use existing only points the config at the old folder; nothing is moved.",
  ].join("\n");
  const choice = await vscode.window.showWarningMessage(
    `${PANEL_PREFIX} Legacy hyseed data was found`,
    { modal: true, detail },
    "Migrate",
    "Use existing",
    "Choose folder…",
    "Not now"
  );
  if (choice === "Migrate") return { action: "migrate", candidate };
  if (choice === "Use existing") return { action: "use", candidate };
  if (choice === "Choose folder…") {
    const folder = await pickDataFolder("Choose the data folder to use");
    return folder ? { action: "choose-folder", path: folder } : null;
  }
  return { action: "not-now" };
}

/** Both roots hold data: nothing is merged or overwritten; the user picks one. */
async function decideConflict(prompt: ConflictPrompt): Promise<ConflictDecision | null> {
  const detail = [
    `Current: ${prompt.dataRoot}`,
    `Old: ${prompt.source}`,
    "",
    "No data is merged or overwritten. The chosen folder becomes the data root.",
  ].join("\n");
  const choice = await vscode.window.showWarningMessage(
    `${PANEL_PREFIX} Both data folders already hold data`,
    { modal: true, detail },
    "Keep current",
    "Use the old folder",
    "Choose folder…"
  );
  if (choice === "Keep current") return { action: "keep" };
  if (choice === "Use the old folder") {
    const source = pathKey(prompt.source);
    const candidate =
      prompt.candidates.find((item) => pathKey(item.path) === source) ?? prompt.candidates[0];
    return candidate ? { action: "use", candidate } : { action: "cancel" };
  }
  if (choice === "Choose folder…") {
    const folder = await pickDataFolder("Choose the data folder to use");
    return folder ? { action: "choose-folder", path: folder } : null;
  }
  return { action: "cancel" };
}

function createMigrationGate(context: vscode.ExtensionContext): MigrationGate {
  return new MigrationGate({
    dataRoot: () => readConfig().dataRoot,
    inspect: async (dataRoot) => inspectHome(await resolveRuntimeExe(context), dataRoot, { env: process.env }),
    scanExtensionDataDirs: () =>
      scanExtensionDataDirs({ home: os.homedir(), extensionId: context.extension.id }),
    isInitialized,
    decide: decideMigration,
    decideConflict,
    migrate: async (from, to) => migrateHome(await resolveRuntimeExe(context), from, to, { env: process.env }),
    setDataDir: async (target) => setDataDir(await resolveRuntimeExe(context), target, { env: process.env }),
    log: logLine,
    notifyError(message) {
      logLine(message);
      void vscode.window
        .showErrorMessage(`${PANEL_PREFIX} ${message}`, "Show logs", "Setup data folder")
        .then((choice) => {
          if (choice === "Show logs") getLogChannel().show();
          else if (choice === "Setup data folder") {
            void vscode.commands.executeCommand(COMMANDS.resumeMigration);
          }
        });
    },
    onState(state: MigrationState) {
      logLine(
        `migration gate: ${state.kind}` +
          (state.kind === "pending" ? ` (${state.reason})` : "")
      );
      launcherView?.updateSetupState(state);
    },
    onDataRootChanged() {
      const cfg = readConfig();
      logLine(`migration gate: data folder is now ${cfg.dataRoot}`);
      statusBar?.update(manager!.getStatus(), {
        runtimePath: lastRuntime?.exePath,
        dataRoot: cfg.dataRoot,
      });
      launcherView?.updateSetupState({ kind: "ready", dataRoot: cfg.dataRoot });
      if (manager?.getStatus().state === "running-own") {
        void manager.restart().catch((err: unknown) => {
          logLine(`restart after migration failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    },
  });
}

/**
 * Doctor follow-up: `hyseed doctor` keeps its terminal output, but an
 * uninitialised data root (or legacy candidates) also earns an entry point
 * into the setup guide. Any inspection failure stays silent.
 */
async function checkDataFolderAfterDoctor(context: vscode.ExtensionContext): Promise<void> {
  try {
    const report = await inspectHome(await resolveRuntimeExe(context), readConfig().dataRoot, {
      env: process.env,
    });
    if (report.initialized && report.candidates.length === 0) return;
    // Never await a notification in a command path: the headless test host
    // never resolves it. The check is fire-and-forget by design.
    void vscode.window
      .showWarningMessage(`${PANEL_PREFIX} data folder needs attention`, "Open setup guide")
      .then((choice) => {
        if (choice === "Open setup guide") {
          void vscode.commands.executeCommand(COMMANDS.openSetupGuide);
        }
      });
  } catch (error) {
    logLine(
      `doctor data-folder check skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function activate(context: vscode.ExtensionContext): HyseedExtensionApi {
  statusBar = new StatusBar();
  panel = new AdminPanel();
  context.subscriptions.push(statusBar, panel);

  const ops = createServerOps(context.extensionUri.fsPath);
  const resolveRuntime = ops.resolveRuntime;
  ops.resolveRuntime = async () => {
    const resolved = await resolveRuntime();
    lastRuntime = resolved;
    return resolved;
  };
  ops.resolveConverter = (runtime) => converterFor(context, runtime.exePath);
  ops.warnAdminHost = (host) => warnAdminBinding(host, context.extension.id);
  const initialConfig = readConfig();
  let lastAdminHost = initialConfig.adminHost;
  warnHostBindings(initialConfig, context.extension.id);

  manager = new ServerManager(ops, (status) => {
    statusBar?.update(status, {
      runtimePath: lastRuntime?.exePath,
      dataRoot: readConfig().dataRoot,
    });
    panel?.update({ status, dataRoot: readConfig().dataRoot, runtime: lastRuntime });
    launcherView?.updateStatus(status);
    logLine(
      `status: ${status.state}` +
        (status.port !== null ? ` host=${status.host ?? "127.0.0.1"} port=${status.port}` : "") +
        (status.message ? ` (${status.message})` : "")
    );
  });
  context.subscriptions.push({ dispose: () => manager?.dispose() });
  statusBar.update(manager.getStatus(), { dataRoot: readConfig().dataRoot });

  // Migration gate: an upgrade must not scaffold an empty data root over (or
  // instead of) an old one. Start now; ensureRunning() waits for the decision.
  const gate = createMigrationGate(context);
  migrationGate = gate;
  const currentVersion = String(context.extension.packageJSON?.version ?? "0.0.0");
  const versionState = recordVersionState(context.globalState, currentVersion);
  logLine(
    `version state: current=${versionState.current} previous=${versionState.previous ?? "(none)"}` +
      `${versionState.firstInstall ? " first-install" : ""}${versionState.majorMinorUpgrade ? " major-minor-upgrade" : ""}`
  );
  void gate.decide();

  const ensureReady = async (m: ServerManager) => {
    await gate.wait();
    return m.ensureRunning();
  };

  const settingDataRoot = (): string =>
    vscode.workspace.getConfiguration(CFG_SECTION).get<string>("dataRoot") ?? "";

  onboardingActions = createOnboardingActions({
    version: currentVersion,
    home: os.homedir(),
    env: process.env,
    readConfig,
    settingDataRoot,
    resolveExe: () => resolveRuntimeExe(context),
    run(exe, args, cwd, timeoutMs) {
      const cfg = readConfig();
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (cfg.dataRoot) env.KB_MCP_HOME = cfg.dataRoot;
      return runSkillsCli(exe, args, { cwd, env, timeoutMs });
    },
    inspectHome: async (dataRoot) =>
      inspectHome(await resolveRuntimeExe(context), dataRoot, { env: process.env }),
    setDataDir: async (target) => setDataDir(await resolveRuntimeExe(context), target, { env: process.env }),
    installCliTools: () => installBundledCliTools(context.extensionUri.fsPath),
    inspectCliTools: () =>
      inspectCliTools({
        resourcesDir: path.join(context.extensionUri.fsPath, "resources"),
        targetDir: path.join(os.homedir(), ".local", "bin"),
        pathEnv: process.env.PATH ?? "",
      }),
    installAgentSkills: () => installSkillsFlow(buildSkillsUi(), createSkillsDeps(context)),
    pickDataFolder: () => pickDataFolder("Choose the data folder"),
    openSettings: async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${CFG_SECTION}.dataRoot`
      );
    },
    gate: {
      state: () => gate.state(),
      retry: () => gate.retry(),
      release: () => gate.release(),
    },
    ensureRunning: async () => {
      if (manager) await manager.ensureRunning();
    },
    confirm: async (title, detail) => {
      const choice = await vscode.window.showWarningMessage(
        `${PANEL_PREFIX} ${title}`,
        { modal: true, detail },
        "Continue"
      );
      return choice === "Continue";
    },
    notify(level, message) {
      logLine(`onboarding: ${message}`);
      onboardingPanel?.notice(level, message);
    },
    log: logLine,
    markOnboarded: async () => {
      await context.globalState.update(ONBOARDED_VERSION_KEY, currentVersion);
    },
  });

  onboardingPanel = new OnboardingPanel({
    actions: onboardingActions,
    version: currentVersion,
    log: logLine,
  });
  context.subscriptions.push(onboardingPanel);

  const openSetupGuide = (reason: OnboardingReason): void => {
    try {
      onboardingPanel?.show(reason);
    } catch (error) {
      logLine(`onboarding: could not open the setup guide: ${String(error)}`);
    }
  };

  // First-run / major-upgrade guide: waits for the migration gate to settle so
  // the blocking migration prompt always comes first, then opens asynchronously.
  // It never blocks activation.
  void gate
    .whenSettled()
    .then(() => {
      const decision = decideOnboarding({
        current: currentVersion,
        onboarded: context.globalState.get<string>(ONBOARDED_VERSION_KEY),
        firstInstall: versionState.firstInstall,
      });
      if (!decision.open) return;
      const timer = setTimeout(() => {
        // A manual open+finish during the delay must not pop the guide again.
        const now = decideOnboarding({
          current: currentVersion,
          onboarded: context.globalState.get<string>(ONBOARDED_VERSION_KEY),
          firstInstall: versionState.firstInstall,
        });
        if (now.open) openSetupGuide(now.reason);
      }, AUTO_OPEN_DELAY_MS);
      timer.unref?.();
      context.subscriptions.push({ dispose: () => clearTimeout(timer) });
    })
    .catch((error: unknown) => logLine(`onboarding: auto-open skipped: ${String(error)}`));

  context.subscriptions.push(
    onConfigChanged(() => {
      const cfg = readConfig();
      warnHostBindings(cfg, context.extension.id);
      if (cfg.adminHost !== lastAdminHost && manager?.getStatus().state === "running-own") {
        const previous = lastAdminHost;
        void vscode.window
          .showInformationMessage(
            `${PANEL_PREFIX} admin host changed from ${previous} to ${cfg.adminHost}; restart the admin server to apply it.`,
            "Restart"
          )
          .then((choice) => {
            if (choice === "Restart" && manager) {
              void manager.restart().catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                logLine(message);
                void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
              });
            }
          });
      }
      lastAdminHost = cfg.adminHost;
    })
  );

  const mcpProvider = registerMcpProvider(context.extensionUri.fsPath, context.subscriptions);

  const runFlow = <U, D>(
    makeUi: () => U,
    makeDeps: () => D,
    action: (ui: U, deps: D) => Promise<void>
  ): (() => void) => {
    return () => {
      void action(makeUi(), makeDeps()).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logLine(message);
        void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
      });
    };
  };

  const run = async (action: (m: ServerManager) => Promise<void>): Promise<void> => {
    if (!manager) return;
    try {
      await action(manager);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(message);
      void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.resumeMigration, () => {
      void gate.retry().catch((err: unknown) => logLine(`migration gate retry failed: ${String(err)}`));
    }),
    vscode.commands.registerCommand(COMMANDS.openSetupGuide, () => openSetupGuide("manual")),
    vscode.commands.registerCommand(COMMANDS.openAdmin, () =>
      run(async (m) => {
        const status = await ensureReady(m);
        panel?.show({ status, dataRoot: readConfig().dataRoot, runtime: lastRuntime });
      })
    ),
    vscode.commands.registerCommand(COMMANDS.startServer, () =>
      run(async (m) => {
        const status = await ensureReady(m);
        void vscode.window.showInformationMessage(
          `${PANEL_PREFIX} server ${status.state}` +
            (status.port !== null ? ` on port ${status.port}` : "")
        );
      })
    ),
    vscode.commands.registerCommand(COMMANDS.stopServer, () =>
      run(async (m) => {
        const status = await m.stop();
        void vscode.window.showInformationMessage(`${PANEL_PREFIX} server ${status.state}`);
      })
    ),
    vscode.commands.registerCommand(COMMANDS.restartServer, () =>
      run(async (m) => {
        await gate.wait();
        const status = await m.restart();
        void vscode.window.showInformationMessage(
          `${PANEL_PREFIX} server ${status.state}` +
            (status.port !== null ? ` on port ${status.port}` : "")
        );
      })
    ),
    vscode.commands.registerCommand(COMMANDS.openInBrowser, () =>
      run(async (m) => {
        const status = await ensureReady(m);
        const base = adminBaseUrl(status);
        if (base === null) {
          throw new Error("server is not running");
        }
        await vscode.env.openExternal(vscode.Uri.parse(`${base}/`));
      })
    ),
    vscode.commands.registerCommand(COMMANDS.showLogs, () => {
      getLogChannel().show();
    }),
    vscode.commands.registerCommand(COMMANDS.showRuntimeInfo, async () => {
      try {
        logLine("resolving runtime...");
        const resolved = await resolveRuntimeFromDisk(readConfig(), context.extensionUri.fsPath);
        lastRuntime = resolved;
        logLine(`resolved runtime: ${resolved.exePath} (${resolved.version})`);
        statusBar?.update(manager!.getStatus(), {
          runtimePath: resolved.exePath,
          dataRoot: readConfig().dataRoot,
        });
        const items = resolved.candidates.map((candidate) => ({
          label: `${candidate.ok ? "$(check)" : candidate.probed ? "$(circle-slash)" : "$(ellipsis)"} ${candidate.path}`,
          description: candidate.ok
            ? `${candidate.version} (${candidate.kind})`
            : candidate.probed
              ? candidate.error ?? "not found"
              : "not probed",
        }));
        void vscode.window.showQuickPick(items, {
          placeHolder: `Resolved: ${resolved.exePath} (${resolved.version})`,
        });
      } catch (err) {
        const message = err instanceof RuntimeResolveError ? err.message : String(err);
        logLine(message);
        void vscode.window.showErrorMessage(`${PANEL_PREFIX} runtime resolution failed: ${message}`);
      }
    }),
    vscode.commands.registerCommand(COMMANDS.showMcpStatus, async () => {
      const cfg = readConfig();
      const lines = [
        `provider id: ${MCP_PROVIDER_ID}`,
        `label: ${MCP_PROVIDER_LABEL}`,
        `registered: ${mcpProvider.registered ? "yes" : "no (API unavailable in this VS Code host)"}`,
        `data root: ${cfg.dataRoot || "(runtime default)"}`,
        `project vault: ${cfg.projectVault || "(none)"}`,
      ];
      try {
        const resolved = await resolveRuntimeFromDisk(cfg, context.extensionUri.fsPath);
        lastRuntime = resolved;
        lines.push(`runtime: ${resolved.exePath} (${resolved.version})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lines.push(`runtime: unresolved (${message})`);
      }
      const channel = getLogChannel();
      channel.appendLine("--- MCP status ---");
      for (const line of lines) channel.appendLine(line);
      channel.show();
      void vscode.window.showInformationMessage(
        `${PANEL_PREFIX} MCP provider ${mcpProvider.registered ? "registered" : "unavailable"} — see output`
      );
    }),
    vscode.commands.registerCommand(COMMANDS.installCliTools, async () => {
      try {
        const report = await installBundledCliTools(context.extensionUri.fsPath);
        const count = (action: string) =>
          report.results.filter((result) => result.action === action).length;
        const leftovers = report.results
          .map((result) => result.leftover)
          .filter((leftover): leftover is string => leftover !== null);
        for (const result of report.results) {
          logLine(
            `cli tools: ${result.action} ${result.name} -> ${result.target}` +
              (result.leftover
                ? ` (left ${result.leftover}; it is in use and can be deleted later)`
                : "")
          );
        }
        logLine(`cli tools: ${report.pathHint}`);
        const summary =
          `${PANEL_PREFIX} CLI tools in ${report.targetDir}: ` +
          `installed ${count("installed")}, replaced ${count("replaced")}, kept ${count("kept")}. ` +
          "The extension resolves hyseed from this directory; these bytes match the bundled VSIX.";
        const details =
          report.pathHint + (leftovers.length > 0 ? ` Leftovers: ${leftovers.join(", ")}` : "");
        if (report.pathContainsTarget) {
          void vscode.window
            .showInformationMessage(`${summary} ${details}`, "Show details")
            .then((choice) => {
              if (choice === "Show details") getLogChannel().show();
            });
        } else {
          void vscode.window
            .showWarningMessage(`${summary} ${details}`, "Show details")
            .then((choice) => {
              if (choice === "Show details") getLogChannel().show();
            });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logLine(message);
        void vscode.window.showErrorMessage(
          `${PANEL_PREFIX} install CLI tools failed: ${message}`
        );
      }
    }),
    vscode.commands.registerCommand(
      COMMANDS.installAgentSkills,
      runFlow(buildSkillsUi, () => createSkillsDeps(context), installSkillsFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.removeAgentSkills,
      runFlow(buildSkillsUi, () => createSkillsDeps(context), removeSkillsFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.showSkillsState,
      runFlow(buildSkillsUi, () => createSkillsDeps(context), showSkillsStateFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.createVault,
      runFlow(buildVaultsUi, () => createVaultsDeps(context), createVaultFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.switchVault,
      runFlow(buildVaultsUi, () => createVaultsDeps(context), switchVaultFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.clearProjectVault,
      runFlow(buildVaultsUi, () => createVaultsDeps(context), clearProjectVaultFlow)
    ),
    vscode.commands.registerCommand(
      COMMANDS.listVaults,
      runFlow(buildVaultsUi, () => createVaultsDeps(context), listVaultsFlow)
    ),
    ...CLI_COMMAND_IDS.map((id) =>
      vscode.commands.registerCommand(
        id,
        runFlow(buildCliUi, () => createCliDeps(context), async (ui, deps) => {
          await runCliCommand(id, ui, deps);
          // Doctor keeps its terminal output; this only adds the setup-guide
          // entry point when the data folder needs attention.
          if (id === COMMANDS.cliDoctor) await checkDataFolderAfterDoctor(context);
        })
      )
    ),
    vscode.window.onDidCloseTerminal((terminal) => cliSender?.reset(terminal))
  );

  // Sidebar panel: vault search plus grouped actions. It starts the admin server on demand.
  launcherView = new AdminLauncherViewProvider({
    extensionId: context.extension.id,
    ensureRunning: () => ensureReady(manager!),
    getStatus: () => manager!.getStatus(),
    getSetupState: () => migrationGate?.state() ?? null,
    history: new SearchHistoryStore(context.globalState),
    mcp: mcpProvider,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LAUNCHER_VIEW_ID, launcherView)
  );

  return {
    provideMcpServerDefinitions,
    installSkillsFlow,
    removeSkillsFlow,
    showSkillsStateFlow,
    createSkillsDeps: (overrides) => createSkillsDeps(context, overrides),
    createVaultFlow,
    switchVaultFlow,
    clearProjectVaultFlow,
    listVaultsFlow,
    createVaultsDeps: (overrides) => createVaultsDeps(context, overrides),
    runCliCommand,
    cliCommandIds: CLI_COMMAND_IDS,
    createCliDeps: (overrides) => createCliDeps(context, overrides),
    installCliTools: (overrides) => installBundledCliTools(context.extensionUri.fsPath, overrides),
    onboardingStateForTest: () => {
      if (context.extensionMode !== vscode.ExtensionMode.Test) {
        throw new Error("onboarding test hooks are only available in test mode");
      }
      const snapshot = onboardingPanel?.snapshotForTest() ?? {
        open: false,
        reason: null as OnboardingReason | null,
        creations: 0,
      };
      return {
        ...snapshot,
        onboardedVersion: context.globalState.get<string>(ONBOARDED_VERSION_KEY) ?? null,
      };
    },
    finishOnboardingForTest: async (skipped) => {
      if (context.extensionMode !== vscode.ExtensionMode.Test) {
        throw new Error("onboarding test hooks are only available in test mode");
      }
      if (onboardingActions) await onboardingActions.finish(skipped, { cli: false, mcp: false });
      onboardingPanel?.dispose();
    },
  };
}

function buildSkillsUi(): SkillsUi {
  return {
    async pickHosts() {
      const items = [
        { label: "claude", description: "Claude Code — skills + MCP entry" },
        { label: "codex", description: "Codex — skills + MCP entry (global only)" },
        { label: "cline", description: "Cline — skills + MCP entry (project = skills only)" },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: "Agent hosts to install into",
      });
      return picked?.map((item) => item.label);
    },
    async pickScope(hosts) {
      const projectDescription = hosts.includes("codex")
        ? "codex does not support project scope"
        : "workspace files (.claude, .mcp.json, .cline)";
      const picked = await vscode.window.showQuickPick(
        [
          { label: "global", description: "user-wide host directories" },
          { label: "project", description: projectDescription },
        ],
        { placeHolder: "Install scope" }
      );
      return picked?.label as SkillsScope | undefined;
    },
    async confirm(title, detail) {
      const choice = await vscode.window.showWarningMessage(
        `${PANEL_PREFIX} ${title}`,
        { modal: true, detail },
        "Continue"
      );
      return choice === "Continue";
    },
    notify(message) {
      void vscode.window.showInformationMessage(`${PANEL_PREFIX} ${message}`);
    },
    error(message) {
      void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
    },
    showDetails(title, lines) {
      const channel = getLogChannel();
      channel.appendLine(`--- ${title} ---`);
      for (const line of lines) channel.appendLine(line);
      channel.show();
    },
  };
}

export function createSkillsDeps(
  context: vscode.ExtensionContext,
  overrides: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
): SkillsDeps {
  const baseEnv = overrides.env ?? process.env;
  return {
    async resolveExe() {
      const resolved = await resolveRuntimeFromDisk(readConfig(), context.extensionUri.fsPath);
      lastRuntime = resolved;
      return resolved.exePath;
    },
    workspaceRoot: () => overrides.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    run(exe, args, cwd) {
      const cfg = readConfig();
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      if (cfg.dataRoot) env.KB_MCP_HOME = cfg.dataRoot;
      logLine(`skills cli: ${args.join(" ")}`);
      return runSkillsCli(exe, args, { cwd, env });
    },
    log: logLine,
  };
}

function vaultItems(state: VaultListState, pinned: string | null) {
  return state.vaults.map((vault) => ({
    label: vault.name,
    description: [
      vault.name === state.current ? "current" : "",
      vault.name === pinned ? "workspace pin" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

function buildVaultsUi(): VaultsUi {
  return {
    async pickScope(projectAvailable) {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "global", description: "shared vault in the global data root" },
          {
            label: "project",
            description: projectAvailable
              ? "vault in the global data root, pinned to this workspace"
              : "open a workspace folder first",
          },
        ],
        { placeHolder: "Vault scope" }
      );
      if (!picked) return undefined;
      if (picked.label === "project" && !projectAvailable) {
        void vscode.window.showWarningMessage(
          `${PANEL_PREFIX} project scope needs an open workspace folder`
        );
        return undefined;
      }
      return picked.label as VaultScope;
    },
    async inputName(defaultValue) {
      return vscode.window.showInputBox({
        prompt: "Vault name",
        value: defaultValue,
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) return "vault name must not be empty";
          if (trimmed.includes("/") || trimmed.includes("\\")) {
            return "vault name must not contain / or \\";
          }
          return null;
        },
      });
    },
    async confirm(title, detail) {
      const choice = await vscode.window.showWarningMessage(
        `${PANEL_PREFIX} ${title}`,
        { modal: true, detail },
        "Continue"
      );
      return choice === "Continue";
    },
    async pickVault(state, pinned) {
      const picked = await vscode.window.showQuickPick(vaultItems(state, pinned), {
        placeHolder: "Set the global default vault",
      });
      return picked?.label;
    },
    async showVaults(state, pinned) {
      await vscode.window.showQuickPick(vaultItems(state, pinned), {
        placeHolder:
          `current: ${state.current ?? "unknown"}` +
          (pinned ? ` · workspace pin: ${pinned}` : " · no workspace pin"),
      });
    },
    notify(message) {
      void vscode.window.showInformationMessage(`${PANEL_PREFIX} ${message}`);
    },
    error(message) {
      void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
    },
  };
}

export function createVaultsDeps(
  context: vscode.ExtensionContext,
  overrides: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
): VaultsDeps {
  const baseEnv = overrides.env ?? process.env;
  return {
    async resolveExe() {
      const resolved = await resolveRuntimeFromDisk(readConfig(), context.extensionUri.fsPath);
      lastRuntime = resolved;
      return resolved.exePath;
    },
    workspaceRoot: () => overrides.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    run(exe, args, cwd) {
      const cfg = readConfig();
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      if (cfg.dataRoot) env.KB_MCP_HOME = cfg.dataRoot;
      logLine(`vault cli: ${args.join(" ")}`);
      return runSkillsCli(exe, args, { cwd: cwd ?? process.cwd(), env });
    },
    log: logLine,
  };
}

function buildCliUi(): CliUi {
  const withPrefix = (title: string): string => `${PANEL_PREFIX} ${title}`;
  return {
    async input({ title, value, placeHolder }) {
      return vscode.window.showInputBox({ title: withPrefix(title), value, placeHolder });
    },
    async pickFolder(title) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select",
        title: withPrefix(title),
      });
      return picked?.[0]?.fsPath;
    },
    async pickFile(title) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Select",
        title: withPrefix(title),
      });
      return picked?.[0]?.fsPath;
    },
    async pickOne(title, items) {
      return vscode.window.showQuickPick(items.slice(), { title: withPrefix(title) });
    },
    async pickMany(title, items, defaults) {
      const picked = await vscode.window.showQuickPick(
        items.map((label) => ({ label, picked: defaults?.includes(label) ?? false })),
        { canPickMany: true, title: withPrefix(title) }
      );
      return picked?.map((item) => item.label);
    },
    async confirm(title, detail) {
      const choice = await vscode.window.showWarningMessage(
        `${PANEL_PREFIX} ${title}`,
        { modal: true, detail },
        "Continue"
      );
      return choice === "Continue";
    },
    error(message) {
      void vscode.window.showErrorMessage(`${PANEL_PREFIX} ${message}`);
    },
  };
}

function tokenSource(env: NodeJS.ProcessEnv): TokenSource {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return {
    file: path.join(home, TOKEN_FILE_NAME),
    read(file) {
      try {
        const value = fs.readFileSync(file, "utf8").trim();
        return value || null;
      } catch {
        return null;
      }
    },
    generate(file) {
      fs.writeFileSync(file, `${randomUUID().replace(/-/g, "")}\r\n`);
    },
  };
}

function converterFor(context: vscode.ExtensionContext, exePath: string): string | undefined {
  return resolveConverter({
    configured: readConfig().converterPath,
    runtimePath: exePath,
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath),
    bundledPath: context.asAbsolutePath("resources/doc-convert.exe"),
  })?.path;
}

export function createCliDeps(
  context: vscode.ExtensionContext,
  overrides: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    sendToTerminal?: (lines: string[]) => void;
  } = {}
): CliDeps {
  const baseEnv = overrides.env ?? process.env;
  return {
    async resolveExe() {
      const resolved = await resolveRuntimeFromDisk(readConfig(), context.extensionUri.fsPath);
      lastRuntime = resolved;
      return resolved.exePath;
    },
    workspaceRoot: () => overrides.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    converter: (exe) => converterFor(context, exe),
    run(exe, args, cwd) {
      const cfg = readConfig();
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      if (cfg.dataRoot) env.KB_MCP_HOME = cfg.dataRoot;
      return runSkillsCli(exe, args, { cwd: cwd ?? process.cwd(), env });
    },
    sendToTerminal: overrides.sendToTerminal ?? ((lines) => defaultCliSender().send(lines)),
    token: tokenSource(baseEnv),
    env(): CliEnv {
      const cfg = readConfig();
      return { KB_MCP_HOME: cfg.dataRoot || undefined, KB_MCP_VAULT: cfg.projectVault || undefined };
    },
    mcpHost: () => readConfig().mcpHost,
    log: logLine,
  };
}

const warnedHosts = new Set<string>();

/** Warn once per session for each non-loopback binding; never blocks activation. */
function warnHostBindings(cfg: KbMcpConfig, extensionId: string): void {
  warnAdminBinding(cfg.adminHost, extensionId);
  if (isNonLoopback(cfg.mcpHost)) {
    warnOnce(
      `mcp:${cfg.mcpHost}`,
      `${PANEL_PREFIX} MCP HTTP transport is bound to ${cfg.mcpHost}; set KB_MCP_HTTP_TOKEN and allow the port through the firewall.`,
      extensionId
    );
  }
}

function warnAdminBinding(host: string, extensionId: string): void {
  if (!isNonLoopback(host)) return;
  warnOnce(
    `admin:${host}`,
    `${PANEL_PREFIX} admin console is bound to ${host} and has no authentication: anyone who can reach this address can read and modify the knowledge base.`,
    extensionId
  );
}

function warnOnce(key: string, message: string, extensionId: string): void {
  if (warnedHosts.has(key)) return;
  warnedHosts.add(key);
  void vscode.window.showWarningMessage(message, "Open settings").then((choice) => {
    if (choice === "Open settings") {
      void vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${extensionId}`);
    }
  });
}

export function deactivate(): void {}