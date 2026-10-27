import * as fs from "node:fs";
import * as path from "node:path";
import { CFG_SECTION, MCP_ENTRY_NAME } from "../constants";

export const VAULT_ENV_KEY = "KB_MCP_VAULT";
const PIN_KEY = "projectVault";

export interface PinResult {
  action: "created" | "updated" | "unchanged";
  file: string;
}

export interface McpEnvResult {
  status: "updated" | "unchanged" | "absent";
  file: string;
  backup: string | null;
}

type JsonObject = Record<string, unknown>;

/** Project vault names are derived from folder names; keep them CLI-safe (no separators). */
export function sanitizeVaultName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function settingsFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "settings.json");
}

export function mcpFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".mcp.json");
}

function readJsonObject(file: string): JsonObject | null {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return parsed as JsonObject;
}

function writeJsonAtomic(file: string, data: JsonObject): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function readWorkspacePin(workspaceRoot: string): string | null {
  const obj = readJsonObject(settingsFile(workspaceRoot));
  const section = obj?.[CFG_SECTION];
  if (typeof section !== "object" || section === null || Array.isArray(section)) return null;
  const value = (section as JsonObject)[PIN_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sectionOf(obj: JsonObject): JsonObject {
  const existing = obj[CFG_SECTION];
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as JsonObject;
  }
  return {};
}

export function writeWorkspacePin(workspaceRoot: string, name: string): PinResult {
  const file = settingsFile(workspaceRoot);
  const existed = fs.existsSync(file);
  const before = existed ? fs.readFileSync(file, "utf8") : null;
  const obj = readJsonObject(file) ?? {};
  const section = sectionOf(obj);
  if (section[PIN_KEY] === name) {
    return { action: "unchanged", file };
  }
  section[PIN_KEY] = name;
  obj[CFG_SECTION] = section;
  try {
    writeJsonAtomic(file, obj);
    if (readWorkspacePin(workspaceRoot) !== name) {
      throw new Error(`pin read-back verification failed: ${file}`);
    }
  } catch (err) {
    restore(file, before);
    throw err;
  }
  return { action: existed ? "updated" : "created", file };
}

export function clearWorkspacePin(workspaceRoot: string): PinResult {
  const file = settingsFile(workspaceRoot);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const obj = readJsonObject(file);
  if (!obj) return { action: "unchanged", file };
  const section = sectionOf(obj);
  if (!(PIN_KEY in section)) return { action: "unchanged", file };
  delete section[PIN_KEY];
  if (Object.keys(section).length > 0) obj[CFG_SECTION] = section;
  else delete obj[CFG_SECTION];
  try {
    writeJsonAtomic(file, obj);
    if (readWorkspacePin(workspaceRoot) !== null) {
      throw new Error(`pin read-back verification failed: ${file}`);
    }
  } catch (err) {
    restore(file, before);
    throw err;
  }
  return { action: "updated", file };
}

function restore(file: string, before: string | null): void {
  if (before === null) {
    fs.rmSync(file, { force: true });
  } else {
    fs.writeFileSync(file, before, "utf8");
  }
}

function getEntry(obj: JsonObject): JsonObject | null {
  const servers = obj.mcpServers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
  const entry = (servers as JsonObject)[MCP_ENTRY_NAME];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  return entry as JsonObject;
}

function envOf(entry: JsonObject): JsonObject {
  const existing = entry.env;
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as JsonObject;
  }
  return {};
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function backupFile(file: string, now: Date = new Date()): string {
  const base = `${file}.bak-${stamp(now)}`;
  let candidate = base;
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  fs.copyFileSync(file, candidate);
  return candidate;
}

/** Everything except the pinned env key, so writes can prove minimal intrusion. */
function stripVaultEnv(obj: JsonObject): JsonObject {
  const clone = JSON.parse(JSON.stringify(obj)) as JsonObject;
  const entry = getEntry(clone);
  if (entry) {
    const env = entry.env as JsonObject | undefined;
    if (env && typeof env === "object") {
      delete env[VAULT_ENV_KEY];
      if (Object.keys(env).length === 0) delete entry.env;
    }
  }
  return clone;
}

function sameShape(a: JsonObject, b: JsonObject): boolean {
  return JSON.stringify(stripVaultEnv(a)) === JSON.stringify(stripVaultEnv(b));
}

export function setVaultEnv(
  workspaceRoot: string,
  name: string,
  now: Date = new Date()
): McpEnvResult {
  const file = mcpFile(workspaceRoot);
  const obj = readJsonObject(file);
  const entry = obj ? getEntry(obj) : null;
  if (!obj || !entry) return { status: "absent", file, backup: null };
  const env = envOf(entry);
  if (env[VAULT_ENV_KEY] === name) return { status: "unchanged", file, backup: null };
  const before = JSON.parse(JSON.stringify(obj)) as JsonObject;
  env[VAULT_ENV_KEY] = name;
  entry.env = env;
  const backup = backupFile(file, now);
  try {
    writeJsonAtomic(file, obj);
    const after = readJsonObject(file);
    if (!after || envOf(getEntry(after) ?? {})[VAULT_ENV_KEY] !== name) {
      throw new Error(`env read-back verification failed: ${file}`);
    }
    if (!sameShape(before, after)) {
      throw new Error(`other fields changed while pinning vault env: ${file}`);
    }
  } catch (err) {
    fs.copyFileSync(backup, file);
    throw err;
  }
  return { status: "updated", file, backup };
}

export function clearVaultEnv(workspaceRoot: string, now: Date = new Date()): McpEnvResult {
  const file = mcpFile(workspaceRoot);
  const obj = readJsonObject(file);
  const entry = obj ? getEntry(obj) : null;
  if (!obj || !entry) return { status: "absent", file, backup: null };
  const env = envOf(entry);
  if (!(VAULT_ENV_KEY in env)) return { status: "unchanged", file, backup: null };
  const before = JSON.parse(JSON.stringify(obj)) as JsonObject;
  delete env[VAULT_ENV_KEY];
  if (Object.keys(env).length === 0) delete entry.env;
  else entry.env = env;
  const backup = backupFile(file, now);
  try {
    writeJsonAtomic(file, obj);
    const after = readJsonObject(file);
    const afterEntry = after ? getEntry(after) : null;
    if (!after || !afterEntry || VAULT_ENV_KEY in envOf(afterEntry)) {
      throw new Error(`env read-back verification failed: ${file}`);
    }
    if (!sameShape(before, after)) {
      throw new Error(`other fields changed while clearing vault env: ${file}`);
    }
  } catch (err) {
    fs.copyFileSync(backup, file);
    throw err;
  }
  return { status: "updated", file, backup };
}