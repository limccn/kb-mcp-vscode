/**
 * Thin wrapper around the runtime's `hyseed home` commands (0.2.0).
 *
 * The extension never copies or deletes a data root itself: this module only
 * spawns the CLI, and every decision stays in `migration.ts`. JSON reports are
 * pretty-printed over several lines, so parse the whole stdout — never the last
 * line. The process env is cleaned first because an inherited `KB_MCP_HOME` would
 * silently override the effective root the extension resolved.
 */

import { runSkillsCli, type CliRunResult, type CliRunOptions } from "./mcp/skillsCli";

export const HOME_INSPECT_TIMEOUT_MS = 15_000;
export const HOME_MIGRATE_TIMEOUT_MS = 120_000;

export interface HomeCandidateJson {
  path: string;
  kind: string;
  vaults: number;
  current?: string | null;
  documents: number | null;
  db_bytes?: number;
  modified_at?: string | null;
}

export interface HomeInspectJson {
  ok: boolean;
  data_root: { path: string; source: string };
  config_path: string;
  initialized: boolean;
  vaults: number;
  current: string | null;
  documents: number | null;
  candidates: HomeCandidateJson[];
}

export interface HomeMigrateJson {
  ok: boolean;
  mode?: string;
  from?: string;
  to?: string;
  vaults?: number;
  documents?: number | null;
  removed_source?: boolean;
  warnings?: string[];
  code?: number;
  stage?: string;
  error?: string;
}

export interface HomeSetDataDirJson {
  ok: boolean;
  data_dir?: string;
  config_path?: string;
  code?: number;
  stage?: string;
  error?: string;
}

export interface HomeCommandDetails {
  rc: number | null;
  /** Exit code reported inside the JSON payload, else the process code. */
  code: number | null;
  stage: string | null;
  /** True when the runtime predates the `home` command group. */
  unsupported: boolean;
  stdout: string;
  stderr: string;
}

export class HomeCommandError extends Error {
  constructor(
    message: string,
    readonly details: HomeCommandDetails
  ) {
    super(message);
    this.name = "HomeCommandError";
  }
}

export type HomeRunner = (exe: string, args: string[], opts: CliRunOptions) => Promise<CliRunResult>;

export interface HomeExecOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
  /** Test seam; production spawns the runtime. */
  run?: HomeRunner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the complete stdout as JSON; null when it is not a single JSON value. */
export function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * An old runtime answers `home` with click's usage text and rc 2. Treat only
 * that shape as "runtime too old"; any other failure is a plain error.
 */
export function isUnsupportedHomeOutput(rc: number | null, stdout: string, stderr: string): boolean {
  if (rc !== 2) return false;
  if (parseJsonOutput(stdout) !== null) return false;
  const text = `${stderr}\n${stdout}`;
  return /No such command/i.test(text) || /Usage:\s*hyseed\s+\[OPTIONS\]\s+COMMAND/i.test(text);
}

/** Drop inherited root/vault overrides, then apply the explicit root when given. */
export function cleanHomeEnv(env: NodeJS.ProcessEnv, dataRoot?: string): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  delete copy.KB_MCP_HOME;
  delete copy.KB_MCP_VAULT;
  if (dataRoot) copy.KB_MCP_HOME = dataRoot;
  return copy;
}

function stderrSuffix(stderr: string): string {
  const text = stderr.trim();
  return text ? `: ${text.split(/\r?\n/)[0]}` : "";
}

async function runHomeCommand(
  exe: string,
  args: string[],
  options: HomeExecOptions,
  env: NodeJS.ProcessEnv
): Promise<Record<string, unknown>> {
  const run = options.run ?? runSkillsCli;
  const result = await run(exe, args, {
    cwd: options.cwd ?? process.cwd(),
    env,
    timeoutMs: options.timeoutMs,
  });
  const json = parseJsonOutput(result.stdout);
  const command = `hyseed ${args.join(" ")}`;
  if (!isRecord(json)) {
    throw new HomeCommandError(
      `${command} failed (rc ${result.rc}) without a JSON report${stderrSuffix(result.stderr)}`,
      {
        rc: result.rc,
        code: result.rc,
        stage: null,
        unsupported: isUnsupportedHomeOutput(result.rc, result.stdout, result.stderr),
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }
  if (json.ok !== true) {
    const code = typeof json.code === "number" ? json.code : result.rc;
    const stage = typeof json.stage === "string" ? json.stage : null;
    const error = typeof json.error === "string" ? json.error : `rc ${result.rc}`;
    throw new HomeCommandError(
      `${command} failed (${stage ?? "error"}${code !== null ? ` ${code}` : ""}): ${error}`,
      {
        rc: result.rc,
        code,
        stage,
        unsupported: isUnsupportedHomeOutput(result.rc, result.stdout, result.stderr),
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }
  return json;
}

/** `hyseed home inspect --json` with `KB_MCP_HOME` pinned to the extension's root. */
export async function inspectHome(
  exe: string,
  dataRoot: string,
  options: HomeExecOptions = {}
): Promise<HomeInspectJson> {
  const json = await runHomeCommand(
    exe,
    ["home", "inspect", "--json"],
    { ...options, timeoutMs: options.timeoutMs ?? HOME_INSPECT_TIMEOUT_MS },
    cleanHomeEnv(options.env ?? process.env, dataRoot)
  );
  const root = json.data_root;
  if (
    !isRecord(root) ||
    typeof root.path !== "string" ||
    typeof json.initialized !== "boolean" ||
    !Array.isArray(json.candidates)
  ) {
    throw new HomeCommandError("unexpected 'home inspect' payload", {
      rc: 0,
      code: 0,
      stage: "parse",
      unsupported: false,
      stdout: JSON.stringify(json),
      stderr: "",
    });
  }
  return {
    ok: true,
    data_root: { path: root.path, source: String(root.source ?? "") },
    config_path: typeof json.config_path === "string" ? json.config_path : "",
    initialized: json.initialized,
    vaults: typeof json.vaults === "number" ? json.vaults : 0,
    current: typeof json.current === "string" ? json.current : null,
    documents: typeof json.documents === "number" ? json.documents : null,
    candidates: json.candidates.filter(isRecord) as unknown as HomeCandidateJson[],
  };
}

/**
 * `hyseed home migrate --from <src> --to <dst> --json`.
 *
 * No `KB_MCP_HOME` is passed: migrate writes the real config, so the CLI must
 * resolve the same home/config the user's own runs use.
 */
export async function migrateHome(
  exe: string,
  from: string,
  to: string,
  options: HomeExecOptions = {}
): Promise<HomeMigrateJson> {
  const json = await runHomeCommand(
    exe,
    ["home", "migrate", "--from", from, "--to", to, "--json"],
    { ...options, timeoutMs: options.timeoutMs ?? HOME_MIGRATE_TIMEOUT_MS },
    cleanHomeEnv(options.env ?? process.env)
  );
  return json as unknown as HomeMigrateJson;
}

/** `hyseed home set-data-dir <path> --json` (persists `data_dir` in the real config). */
export async function setDataDir(
  exe: string,
  target: string,
  options: HomeExecOptions = {}
): Promise<HomeSetDataDirJson> {
  const json = await runHomeCommand(
    exe,
    ["home", "set-data-dir", target, "--json"],
    { ...options, timeoutMs: options.timeoutMs ?? HOME_MIGRATE_TIMEOUT_MS },
    cleanHomeEnv(options.env ?? process.env)
  );
  return json as unknown as HomeSetDataDirJson;
}