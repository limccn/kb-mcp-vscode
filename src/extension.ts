import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  CLI_COMMAND_IDS,
  CLI_TERMINAL_NAME,
  COMMANDS,
  LAUNCHER_VIEW_ID,
  LEGACY_TOKEN_FILE_NAME,
  MCP_PROVIDER_ID,
  MCP_PROVIDER_LABEL,
  PANEL_PREFIX,
  TOKEN_FILE_NAME,
} from "./constants";
import { readConfig } from "./config";
import { resolveConverter } from "./converter";
import { runCliCommand, type CliDeps, type TokenSource } from "./cli/flow";
import type { CliEnv } from "./cli/quote";
import type { CliUi } from "./cli/registry";
import { createTerminalSender, type TerminalSender } from "./cli/terminal";
import { SearchHistoryStore } from "./history";
import { AdminLauncherViewProvider } from "./launcher";
import { getLogChannel, logLine } from "./log";
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
let lastRuntime: RuntimeResolution | null = null;
let cliSender: TerminalSender | undefined;

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

  manager = new ServerManager(ops, (status) => {
    statusBar?.update(status, {
      runtimePath: lastRuntime?.exePath,
      dataRoot: readConfig().dataRoot,
    });
    panel?.update({ status, dataRoot: readConfig().dataRoot, runtime: lastRuntime });
    launcherView?.updateStatus(status);
    logLine(
      `status: ${status.state}${status.port !== null ? ` port=${status.port}` : ""}` +
        (status.message ? ` (${status.message})` : "")
    );
  });
  context.subscriptions.push({ dispose: () => manager?.dispose() });
  statusBar.update(manager.getStatus(), { dataRoot: readConfig().dataRoot });

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
    vscode.commands.registerCommand(COMMANDS.openAdmin, () =>
      run(async (m) => {
        const status = await m.ensureRunning();
        panel?.show({ status, dataRoot: readConfig().dataRoot, runtime: lastRuntime });
      })
    ),
    vscode.commands.registerCommand(COMMANDS.startServer, () =>
      run(async (m) => {
        const status = await m.ensureRunning();
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
        const status = await m.restart();
        void vscode.window.showInformationMessage(
          `${PANEL_PREFIX} server ${status.state}` +
            (status.port !== null ? ` on port ${status.port}` : "")
        );
      })
    ),
    vscode.commands.registerCommand(COMMANDS.openInBrowser, () =>
      run(async (m) => {
        const status = await m.ensureRunning();
        if (status.port === null) {
          throw new Error("server is not running");
        }
        await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${status.port}/`));
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
        runFlow(buildCliUi, () => createCliDeps(context), (ui, deps) => runCliCommand(id, ui, deps))
      )
    ),
    vscode.window.onDidCloseTerminal((terminal) => cliSender?.reset(terminal))
  );

  // Sidebar panel: vault search plus grouped actions. It starts the admin server on demand.
  launcherView = new AdminLauncherViewProvider({
    extensionId: context.extension.id,
    ensureRunning: () => manager!.ensureRunning(),
    getStatus: () => manager!.getStatus(),
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
    newFile: path.join(home, TOKEN_FILE_NAME),
    legacyFile: path.join(home, LEGACY_TOKEN_FILE_NAME),
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
    log: logLine,
  };
}

export function deactivate(): void {}