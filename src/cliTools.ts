/**
 * Copy the bundled CLI executables into the user's stable `~/.local/bin`.
 * No `vscode` import: the command layer and the integration test both call this.
 * PATH is inspected, never modified.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

export const CLI_TOOL_NAMES = ["hyseed.exe", "doc-convert.exe"] as const;

export type CliToolAction = "installed" | "replaced" | "kept";

export interface CliToolResult {
  name: string;
  action: CliToolAction;
  target: string;
  /** Old file that could not be deleted because it is in use. */
  leftover: string | null;
}

export interface CliToolsReport {
  targetDir: string;
  results: CliToolResult[];
  pathContainsTarget: boolean;
  pathHint: string;
}

export interface CliToolsOptions {
  resourcesDir: string;
  targetDir: string;
  pathEnv: string;
  platform?: NodeJS.Platform;
  pathDelimiter?: string;
  /** Test seam for backup names. */
  now?: () => number;
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeDir(value: string, platform: NodeJS.Platform): string {
  let dir = value.trim();
  if (dir.startsWith('"') && dir.endsWith('"')) dir = dir.slice(1, -1);
  dir = dir.replace(/[\\/]+$/, "");
  return platform === "win32" ? dir.toLowerCase() : dir;
}

/** Is `targetDir` one of the entries in a PATH-style string? Read-only. */
export function pathContains(
  targetDir: string,
  pathEnv: string,
  platform: NodeJS.Platform = process.platform,
  pathDelimiter: string = delimiter
): boolean {
  const target = normalizeDir(targetDir, platform);
  return pathEnv
    .split(pathDelimiter)
    .some((entry) => entry.trim() !== "" && normalizeDir(entry, platform) === target);
}

export type CliToolState = "up-to-date" | "outdated" | "missing" | "unknown";

export interface CliToolStatus {
  name: string;
  state: CliToolState;
  target: string;
  error?: string;
}

export interface CliToolsStatus {
  targetDir: string;
  tools: CliToolStatus[];
  pathContainsTarget: boolean;
  pathHint: string;
}

export interface CliToolsInspectOptions {
  resourcesDir: string;
  targetDir: string;
  pathEnv: string;
  platform?: NodeJS.Platform;
  pathDelimiter?: string;
}

/**
 * Read-only compare used by the setup guide: bundled hash vs installed hash.
 * Never throws; an unreadable source or target degrades to "unknown".
 */
export async function inspectCliTools(options: CliToolsInspectOptions): Promise<CliToolsStatus> {
  const platform = options.platform ?? process.platform;
  const tools: CliToolStatus[] = [];
  for (const name of CLI_TOOL_NAMES) {
    const source = join(options.resourcesDir, name);
    const target = join(options.targetDir, name);
    try {
      const sourceSha = await sha256File(source);
      if (!(await exists(target))) {
        tools.push({ name, state: "missing", target });
        continue;
      }
      const targetSha = await sha256File(target);
      tools.push({ name, state: targetSha === sourceSha ? "up-to-date" : "outdated", target });
    } catch (error) {
      tools.push({
        name,
        state: "unknown",
        target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const contains = pathContains(options.targetDir, options.pathEnv, platform, options.pathDelimiter);
  return {
    targetDir: options.targetDir,
    tools,
    pathContainsTarget: contains,
    pathHint: pathHint(options.targetDir, contains),
  };
}

export function pathHint(targetDir: string, contains: boolean): string {
  if (contains) {
    return (
      `${targetDir} is on PATH; VS Code may hold an older PATH, ` +
      "so restart the window if a new terminal cannot find hyseed."
    );
  }
  return (
    `${targetDir} is not on PATH. Add it under System properties > Environment Variables, ` +
    "then open a new terminal."
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function backupName(targetDir: string, name: string, now: () => number): Promise<string> {
  const stamp = now();
  for (let suffix = 0; ; suffix += 1) {
    const candidate = join(
      targetDir,
      `.${name}.old-${stamp}${suffix === 0 ? "" : `-${suffix}`}`
    );
    if (!(await exists(candidate))) return candidate;
  }
}

async function installOne(
  sourceDir: string,
  targetDir: string,
  name: string,
  now: () => number
): Promise<CliToolResult> {
  const source = join(sourceDir, name);
  const target = join(targetDir, name);
  const sourceSha = await sha256File(source);

  if (await exists(target)) {
    if ((await sha256File(target)) === sourceSha) {
      return { name, action: "kept", target, leftover: null };
    }
    const tmp = join(targetDir, `.${name}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
    await copyFile(source, tmp);
    const backup = await backupName(targetDir, name, now);
    await rename(target, backup);
    try {
      await rename(tmp, target);
    } catch (error) {
      await rename(backup, target).catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    try {
      await rm(backup);
      return { name, action: "replaced", target, leftover: null };
    } catch {
      // The old image is still mapped by a running process; report, never hide it.
      return { name, action: "replaced", target, leftover: backup };
    }
  }

  const tmp = join(targetDir, `.${name}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
  await copyFile(source, tmp);
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { name, action: "installed", target, leftover: null };
}

const inFlight = new Map<string, Promise<CliToolsReport>>();

export function installCliTools(options: CliToolsOptions): Promise<CliToolsReport> {
  const key = options.targetDir.toLowerCase();
  const running = inFlight.get(key);
  if (running) return running;
  const task = installAll(options).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function installAll(options: CliToolsOptions): Promise<CliToolsReport> {
  const platform = options.platform ?? process.platform;
  const pathDelimiter = options.pathDelimiter ?? delimiter;
  const now = options.now ?? Date.now;

  for (const name of CLI_TOOL_NAMES) {
    const source = join(options.resourcesDir, name);
    if (!(await exists(source))) {
      throw new Error(`bundled CLI tool is missing: ${source}`);
    }
  }
  await mkdir(options.targetDir, { recursive: true });

  const results: CliToolResult[] = [];
  for (const name of CLI_TOOL_NAMES) {
    results.push(await installOne(options.resourcesDir, options.targetDir, name, now));
  }
  const contains = pathContains(options.targetDir, options.pathEnv, platform, pathDelimiter);
  return {
    targetDir: options.targetDir,
    results,
    pathContainsTarget: contains,
    pathHint: pathHint(options.targetDir, contains),
  };
}