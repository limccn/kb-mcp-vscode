/**
 * Single point for every rename-sensitive name.
 * Old kb-mcp names are compatibility candidates only; never surface them in user-visible copy.
 * If the product is renamed again, this file (plus package.json displayName/titles) is the only
 * place to touch.
 */

/** User-visible product name. */
export const DISPLAY_NAME = "hyseed";

/** Executable candidates, highest priority first. kb-mcp.exe is a compatibility fallback. */
export const EXE_NAMES = ["hyseed.exe", "kb-mcp.exe"] as const;

/** CLI names looked up on PATH, highest priority first. */
export const PATH_CLI_NAMES = ["hyseed", "kb-mcp"] as const;

/** Directories under %USERPROFILE% probed for the executable, in order. */
export const PROBE_DIRS = [".local/bin", `.local/share/${DISPLAY_NAME}`, ".local/share/kb-mcp"] as const;

/** Version line accepted from `--version` probes (never pin an exact version here). */
export const VERSION_LINE_RE = /^(hyseed|kb), version \d+\.\d+\.\d+/;

/** Strings that mark a live admin console page (any one suffices; verified against the frozen exe). */
export const SERVER_MARKERS = ["HySeed", "kb-mcp Console"] as const;

/** Configuration section (technical id; kept as kbMcp per the naming decision). */
export const CFG_SECTION = "kbMcp";
export const DEFAULT_ADMIN_PORT = 51888;

/** Webview panel identity. */
export const PANEL_VIEW_TYPE = "kbmcp.admin";
export const PANEL_TITLE = "hyseed admin";

/** User-visible prefix for command titles, notifications, status bar and terminal names. */
export const PANEL_PREFIX = "hyseed:";

/** Output channel name. */
export const LOG_CHANNEL_NAME = "hyseed";

/** Command id prefix (technical id; kept as kbmcp per the naming decision). */
export const COMMAND_PREFIX = "kbmcp";

export const COMMANDS = {
  openAdmin: `${COMMAND_PREFIX}.openAdmin`,
  startServer: `${COMMAND_PREFIX}.startServer`,
  stopServer: `${COMMAND_PREFIX}.stopServer`,
  restartServer: `${COMMAND_PREFIX}.restartServer`,
  openInBrowser: `${COMMAND_PREFIX}.openInBrowser`,
  showRuntimeInfo: `${COMMAND_PREFIX}.showRuntimeInfo`,
  showLogs: `${COMMAND_PREFIX}.showLogs`,
  showMcpStatus: `${COMMAND_PREFIX}.showMcpStatus`,
  installAgentSkills: `${COMMAND_PREFIX}.installAgentSkills`,
  removeAgentSkills: `${COMMAND_PREFIX}.removeAgentSkills`,
  showSkillsState: `${COMMAND_PREFIX}.showSkillsState`,
  createVault: `${COMMAND_PREFIX}.createVault`,
  switchVault: `${COMMAND_PREFIX}.switchVault`,
  clearProjectVault: `${COMMAND_PREFIX}.clearProjectVault`,
  listVaults: `${COMMAND_PREFIX}.listVaults`,
  cliSearch: `${COMMAND_PREFIX}.cli.search`,
  cliGet: `${COMMAND_PREFIX}.cli.get`,
  cliList: `${COMMAND_PREFIX}.cli.list`,
  cliAdd: `${COMMAND_PREFIX}.cli.add`,
  cliIngest: `${COMMAND_PREFIX}.cli.ingest`,
  cliImport: `${COMMAND_PREFIX}.cli.import`,
  cliExport: `${COMMAND_PREFIX}.cli.export`,
  cliDoctor: `${COMMAND_PREFIX}.cli.doctor`,
  cliStats: `${COMMAND_PREFIX}.cli.stats`,
  cliReindex: `${COMMAND_PREFIX}.cli.reindex`,
  cliDiffCheck: `${COMMAND_PREFIX}.cli.diff-check`,
  cliHistory: `${COMMAND_PREFIX}.cli.history`,
  cliVaultList: `${COMMAND_PREFIX}.cli.vaultList`,
  cliVaultCreate: `${COMMAND_PREFIX}.cli.vaultCreate`,
  cliVaultSwitch: `${COMMAND_PREFIX}.cli.vaultSwitch`,
  cliVaultStatus: `${COMMAND_PREFIX}.cli.vaultStatus`,
  cliSkillsList: `${COMMAND_PREFIX}.cli.skillsList`,
  cliSkillsShow: `${COMMAND_PREFIX}.cli.skillsShow`,
  cliSkillsAdd: `${COMMAND_PREFIX}.cli.skillsAdd`,
  cliSkillsRemove: `${COMMAND_PREFIX}.cli.skillsRemove`,
  cliServeHttp: `${COMMAND_PREFIX}.cli.serveHttp`,
} as const;

/** Command ids whose flows run in the fixed cmd.exe terminal (registry.ts owns the forms). */
export const CLI_COMMAND_IDS = Object.entries(COMMANDS)
  .filter(([key]) => key.startsWith("cli"))
  .map(([, id]) => id);

/** Terminal that palette CLI commands run in (user-visible name). */
export const CLI_TERMINAL_NAME = DISPLAY_NAME;

/** HTTP token file under the user profile; the legacy name is only a compatibility fallback. */
export const TOKEN_FILE_NAME = `.${DISPLAY_NAME}-http-token`;
export const LEGACY_TOKEN_FILE_NAME = ".kb-mcp-http-token";

/** MCP definition provider (technical id stays; label is user-visible). */
export const MCP_PROVIDER_ID = `${COMMAND_PREFIX}.vscode`;
export const MCP_PROVIDER_LABEL = DISPLAY_NAME;

/** MCP entry name the hyseed CLI writes into host configs (e.g. `.mcp.json`). */
export const MCP_ENTRY_NAME = DISPLAY_NAME;

/** Activity bar container + the launcher view it holds. */
export const LAUNCHER_CONTAINER_ID = COMMAND_PREFIX;
export const LAUNCHER_VIEW_ID = `${COMMAND_PREFIX}.launcher`;

/** Probe / lifecycle timeouts and port scanning limits. */
export const PROBE_TIMEOUT_MS = 15_000;
export const HTTP_PROBE_TIMEOUT_MS = 2_000;
export const SERVER_START_TIMEOUT_MS = 30_000;
export const PORT_RELEASE_TIMEOUT_MS = 5_000;
export const SCAN_PORT_LIMIT = 50;