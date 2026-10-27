import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  EXE_NAMES,
  PATH_CLI_NAMES,
  PROBE_DIRS,
  PROBE_TIMEOUT_MS,
  VERSION_LINE_RE,
} from "./constants";
import type { KbMcpConfig } from "./config";
import { logLine } from "./log";

export interface ProbeResult {
  ok: boolean;
  version: string | null;
  error: string | null;
}

export type CandidateKind = "setting" | "dir" | "path" | "bundled";

export interface RuntimeCandidate {
  kind: CandidateKind;
  path: string;
  origin: string;
  probed: boolean;
  ok: boolean;
  version: string | null;
  error: string | null;
}

export interface RuntimeResolution {
  exePath: string;
  version: string;
  candidates: RuntimeCandidate[];
  fromSetting: boolean;
}

export interface ResolverDeps {
  setting: string;
  userHome: string;
  pathEnv: string;
  bundledPath: string;
  fileExists(path: string): boolean;
  probe(path: string): Promise<ProbeResult>;
  /** Optional diagnostics sink for auto-candidate probe failures. */
  log?(message: string): void;
  /** Test seam / future rename slot: defaults to the constant lists. */
  exeNames?: readonly string[];
  cliNames?: readonly string[];
  probeDirs?: readonly string[];
  pathDelimiter?: string;
}

export class RuntimeResolveError extends Error {
  constructor(
    message: string,
    readonly candidates: RuntimeCandidate[]
  ) {
    super(message);
    this.name = "RuntimeResolveError";
  }
}

interface CandidateSeed {
  kind: CandidateKind;
  path: string;
  origin: string;
}

export function buildCandidates(deps: ResolverDeps): CandidateSeed[] {
  const exeNames = deps.exeNames ?? EXE_NAMES;
  const cliNames = deps.cliNames ?? PATH_CLI_NAMES;
  const probeDirs = deps.probeDirs ?? PROBE_DIRS;
  const pathDelimiter = deps.pathDelimiter ?? delimiter;
  const seeds: CandidateSeed[] = [];
  const seen = new Set<string>();
  const add = (path: string, kind: CandidateKind, origin: string) => {
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ kind, path, origin });
  };

  const setting = deps.setting.trim();
  if (setting) {
    add(setting, "setting", "kbMcp.runtimePath");
  }
  for (const dir of probeDirs) {
    for (const name of exeNames) {
      const path = join(deps.userHome, dir, name);
      if (deps.fileExists(path)) add(path, "dir", `~/${dir}`);
    }
  }
  for (const dir of deps.pathEnv.split(pathDelimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    for (const cli of cliNames) {
      const path = join(trimmed, `${cli}.exe`);
      if (deps.fileExists(path)) add(path, "path", "PATH");
    }
  }
  add(deps.bundledPath, "bundled", "extension bundle");

  return seeds;
}

export async function resolveRuntime(deps: ResolverDeps): Promise<RuntimeResolution> {
  const candidates: RuntimeCandidate[] = buildCandidates(deps).map((seed) => ({
    ...seed,
    probed: false,
    ok: false,
    version: null,
    error: null,
  }));

  for (const candidate of candidates) {
    candidate.probed = true;
    const probe = await deps.probe(candidate.path);
    candidate.ok = probe.ok;
    candidate.version = probe.version;
    candidate.error = probe.error;
    if (probe.ok && probe.version !== null) {
      return {
        exePath: candidate.path,
        version: probe.version,
        candidates,
        fromSetting: candidate.kind === "setting",
      };
    }
    if (candidate.kind === "setting") {
      throw new RuntimeResolveError(
        `kbMcp.runtimePath points at an unusable executable: ${candidate.path}` +
          (candidate.error ? ` (${candidate.error})` : ""),
        candidates
      );
    }
    deps.log?.(
      `runtime candidate failed: ${candidate.path}${candidate.error ? ` (${candidate.error})` : ""}`
    );
  }

  const detail = candidates
    .map((c) => `- ${c.path}${c.error ? ` (${c.error})` : ""}`)
    .join("\n");
  throw new RuntimeResolveError(
    `No usable hyseed runtime found. Candidates checked:\n${detail}`,
    candidates
  );
}

export function probeVersion(
  exePath: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child: ChildProcessWithoutNullStreams | undefined;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child?.kill();
      finish({ ok: false, version: null, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      child = spawn(exePath, ["--version"], { windowsHide: true });
    } catch (err) {
      finish({ ok: false, version: null, error: (err as Error).message });
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      finish({ ok: false, version: null, error: err.message });
    });
    child.on("close", (code) => {
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => VERSION_LINE_RE.test(l));
      if (code === 0 && line) {
        finish({ ok: true, version: line, error: null });
      } else {
        finish({
          ok: false,
          version: null,
          error: `exit ${code}${line ? "" : " (no version line)"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        });
      }
    });
  });
}

export function resolveRuntimeFromDisk(
  config: KbMcpConfig,
  extensionPath: string,
  probe: (path: string) => Promise<ProbeResult> = probeVersion
): Promise<RuntimeResolution> {
  return resolveRuntime({
    setting: config.runtimePath,
    userHome: homedir(),
    pathEnv: process.env.PATH ?? "",
    bundledPath: join(extensionPath, "resources", EXE_NAMES[0]),
    fileExists: existsSync,
    probe,
    log: logLine,
  });
}