import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { CFG_SECTION, DEFAULT_ADMIN_PORT } from "./constants";
import { DEFAULT_HOST, parseHost } from "./host";
import { logLine } from "./log";

export interface KbMcpConfig {
  runtimePath: string;
  adminPort: number;
  adminHost: string;
  mcpHost: string;
  dataRoot: string;
  projectVault: string;
  converterPath: string;
}

/** Minimal reader surface so parsing stays unit-testable without the real vscode module. */
export interface ConfigReader {
  get<T>(key: string): T | undefined;
}

/** Host facts injectable in tests; production uses the real home and process env. */
export interface ConfigHost {
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Non-fatal setting problems (invalid host values); readConfig logs them once. */
  onIssue?: (message: string) => void;
}

/** `~` (or `~/`, `~\`) at the start of a user-supplied value → the user's home. */
export function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
  return value;
}

/** Runtime config path (0.2.0 reads only the hyseed path; KB_MCP_CONFIG overrides it). */
function runtimeConfigPaths(home: string, env: NodeJS.ProcessEnv): string[] {
  const explicit = (env.KB_MCP_CONFIG ?? "").trim();
  if (explicit) return [explicit];
  return [path.join(home, ".config", "hyseed", "config.yaml")];
}

/** Stable per-user data root when no setting, env, or config value exists. */
export function defaultDataRoot(home: string): string {
  return path.join(home, ".local", "share", "hyseed");
}

/**
 * Read the top-level `data_dir:` value from the runtime config, or "".
 *
 * Only that one line is read — the runtime owns real YAML parsing. A missing
 * file, or a file without `data_dir`, yields ""; a `~` prefix expands like
 * `Path.expanduser`. The pre-rename config path is retired in 0.2.0: it is only
 * a migration candidate reported by `hyseed home inspect`.
 */
export function readConfigDataDir(home: string, env: NodeJS.ProcessEnv): string {
  for (const file of runtimeConfigPaths(home, env)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^data_dir\s*:\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      let raw = match[1];
      const quoted =
        raw.length >= 2 &&
        ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')));
      if (quoted) raw = raw.slice(1, -1);
      if (raw) return expandHome(raw, home);
    }
    return "";
  }
  return "";
}

/**
 * Resolve the data root passed to every hyseed child process.
 *
 * Setting → inherited `KB_MCP_HOME` → runtime `config.yaml` `data_dir` →
 * `~/.local/share/hyseed`. The last step is what keeps data out of the
 * versioned extension directory: a frozen `resources/hyseed.exe` would
 * otherwise fall back to `<exe dir>/data`, which VS Code discards on upgrade.
 */
export function resolveDataRoot(setting: string, home: string, env: NodeJS.ProcessEnv): string {
  const explicit = setting.trim();
  if (explicit) return expandHome(explicit, home);
  const fromEnv = (env.KB_MCP_HOME ?? "").trim();
  if (fromEnv) return fromEnv;
  const fromConfig = readConfigDataDir(home, env);
  if (fromConfig) return fromConfig;
  return defaultDataRoot(home);
}

function hostSetting(
  cfg: ConfigReader,
  key: string,
  onIssue?: (message: string) => void
): string {
  const binding = parseHost(cfg.get<string>(key));
  if (binding.error) onIssue?.(`kbMcp.${key}: ${binding.error}; using ${DEFAULT_HOST}`);
  return binding.listen;
}

export function parseConfig(cfg: ConfigReader, host: ConfigHost = {}): KbMcpConfig {
  const home = host.home ?? os.homedir();
  const env = host.env ?? process.env;
  const runtimePath = (cfg.get<string>("runtimePath") ?? "").trim();
  const adminHost = hostSetting(cfg, "adminHost", host.onIssue);
  const mcpHost = hostSetting(cfg, "mcpHost", host.onIssue);
  const dataRoot = resolveDataRoot(cfg.get<string>("dataRoot") ?? "", home, env);
  const projectVault = (cfg.get<string>("projectVault") ?? "").trim();
  const converterPath = (cfg.get<string>("converterPath") ?? "").trim();
  const rawPort = cfg.get<number>("adminPort") ?? DEFAULT_ADMIN_PORT;
  const adminPort =
    Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_ADMIN_PORT;
  return { runtimePath, adminPort, adminHost, mcpHost, dataRoot, projectVault, converterPath };
}

const reportedIssues = new Set<string>();

export function readConfig(): KbMcpConfig {
  return parseConfig(vscode.workspace.getConfiguration(CFG_SECTION), {
    onIssue: (message) => {
      if (reportedIssues.has(message)) return;
      reportedIssues.add(message);
      logLine(message);
    },
  });
}

export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CFG_SECTION)) {
      listener();
    }
  });
}