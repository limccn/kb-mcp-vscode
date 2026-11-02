/**
 * Activation-time data-root detection and the start gate (0.2.0).
 *
 * The extension never moves data itself: every relocation goes through
 * `hyseed home migrate|set-data-dir` (see `homeCli.ts`). This module only
 * classifies the current root, collects legacy candidates, and holds
 * `ensureRunning()` until the user has made a decision.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HomeCommandError, type HomeCandidateJson, type HomeInspectJson, type HomeMigrateJson, type HomeSetDataDirJson } from "./homeCli";

export interface LegacyCandidate {
  path: string;
  kind: string;
  vaults: number;
  documents: number | null;
  dbBytes?: number;
  modifiedAt: string | null;
}

export type MigrationPendingReason = "not-now" | "runtime-too-old" | "migration-failed";

export type MigrationState =
  | { kind: "checking"; dataRoot: string }
  | { kind: "ready"; dataRoot: string }
  | { kind: "no-data"; dataRoot: string; candidates: LegacyCandidate[] }
  | { kind: "fresh"; dataRoot: string; candidates: [] }
  | {
      kind: "pending";
      dataRoot: string;
      candidates: LegacyCandidate[];
      reason: MigrationPendingReason;
      message?: string;
    }
  | { kind: "error"; dataRoot: string; message: string };

export interface MigrationPrompt {
  dataRoot: string;
  candidates: LegacyCandidate[];
}

export type MigrationDecision =
  | { action: "migrate"; candidate: LegacyCandidate }
  | { action: "use"; candidate: LegacyCandidate }
  | { action: "choose-folder"; path: string }
  | { action: "not-now" };

export interface ConflictPrompt {
  dataRoot: string;
  candidates: LegacyCandidate[];
  source: string;
}

export type ConflictDecision =
  | { action: "keep" }
  | { action: "use"; candidate: LegacyCandidate }
  | { action: "choose-folder"; path: string }
  | { action: "cancel" };

export interface MigrationGateDeps {
  /** Effective root at call time (readConfig() is re-read for every decision). */
  dataRoot(): string;
  inspect(dataRoot: string): Promise<HomeInspectJson>;
  scanExtensionDataDirs(): LegacyCandidate[];
  isInitialized(dir: string): boolean;
  /** Blocking UI. `null` means the user dismissed the prompt. */
  decide(prompt: MigrationPrompt): Promise<MigrationDecision | null>;
  decideConflict?(prompt: ConflictPrompt): Promise<ConflictDecision | null>;
  migrate(from: string, to: string): Promise<HomeMigrateJson>;
  setDataDir(path: string): Promise<HomeSetDataDirJson>;
  log(message: string): void;
  notifyError?(message: string): void;
  onState?(state: MigrationState): void;
  onDataRootChanged?(path: string): void;
}

export interface InitProbe {
  exists?(path: string): boolean;
  list?(path: string): string[];
}

/** True when the directory already holds a registry or at least one database. */
export function isInitialized(dir: string, probe: InitProbe = {}): boolean {
  const exists = probe.exists ?? existsSync;
  const list = probe.list ?? readdirSync;
  try {
    if (exists(join(dir, "vaults.json"))) return true;
    if (exists(join(dir, "kb.db"))) return true;
    for (const name of list(dir)) {
      if (exists(join(dir, name, "kb.db"))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Case-insensitive, slash-normalized key used for dedupe and "is this the root" tests. */
export function pathKey(value: string, platform: NodeJS.Platform = process.platform): string {
  let key = value.trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (!key) key = "/";
  return platform === "win32" ? key.toLowerCase() : key;
}

export function toLegacyCandidate(candidate: HomeCandidateJson): LegacyCandidate {
  return {
    path: candidate.path,
    kind: candidate.kind,
    vaults: typeof candidate.vaults === "number" ? candidate.vaults : 0,
    documents: typeof candidate.documents === "number" ? candidate.documents : null,
    dbBytes: typeof candidate.db_bytes === "number" ? candidate.db_bytes : undefined,
    modifiedAt: typeof candidate.modified_at === "string" ? candidate.modified_at : null,
  };
}

function vaultCount(dir: string): number {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "vaults.json"), "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      const vaults = (parsed as { vaults?: unknown }).vaults;
      if (Array.isArray(vaults)) return vaults.length;
    }
  } catch {
    // An unreadable registry still counts as data; the runtime decides what to do with it.
  }
  return 0;
}

function modifiedAt(dir: string): string | null {
  for (const file of [join(dir, "vaults.json"), join(dir, "kb.db"), dir]) {
    try {
      return statSync(file).mtime.toISOString();
    } catch {
      continue;
    }
  }
  return null;
}

export interface ExtensionScanDeps {
  home?: string;
  /** `<publisher>.<name>` of this extension; the version suffix is appended by VS Code. */
  extensionId?: string;
  exists?(path: string): boolean;
  list?(path: string): string[];
  readFile?(path: string): string;
}

/**
 * Data directories left behind by older versions of this extension:
 * `~/.vscode/extensions/<id>-<version>/{resources/data,data}`. Entries listed
 * in `.obsolete` are included while their directory still exists.
 */
export function scanExtensionDataDirs(deps: ExtensionScanDeps = {}): LegacyCandidate[] {
  const home = deps.home ?? homedir();
  const prefix = `${(deps.extensionId ?? "limccn.kbmcp-vscode").toLowerCase()}-`;
  const exists = deps.exists ?? existsSync;
  const list = deps.list ?? readdirSync;
  const readFile = deps.readFile ?? ((file: string) => readFileSync(file, "utf8"));
  const root = join(home, ".vscode", "extensions");

  let entries: string[];
  try {
    entries = list(root);
  } catch {
    return [];
  }

  const names = new Set(entries.map((name) => name.toLowerCase()));
  try {
    const parsed = JSON.parse(readFile(join(root, ".obsolete"))) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [name, dead] of Object.entries(parsed)) {
        if (dead === true) names.add(name.toLowerCase());
      }
    }
  } catch {
    // No .obsolete file (or an unreadable one) — installed directories are enough.
  }

  const results: LegacyCandidate[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!name.startsWith(prefix) || name === ".obsolete") continue;
    for (const relative of [join("resources", "data"), "data"]) {
      const dir = join(root, name, relative);
      if (!isInitialized(dir, { exists, list })) continue;
      const key = pathKey(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        path: dir,
        kind: "extension_data",
        vaults: vaultCount(dir),
        documents: null,
        modifiedAt: modifiedAt(dir),
      });
    }
  }
  return results.sort(compareCandidates);
}

function candidateScore(candidate: LegacyCandidate): number {
  return (candidate.documents !== null ? 2 : 0) + (candidate.modifiedAt ? 1 : 0);
}

function compareCandidates(a: LegacyCandidate, b: LegacyCandidate): number {
  const aTime = a.modifiedAt ? Date.parse(a.modifiedAt) : Number.NaN;
  const bTime = b.modifiedAt ? Date.parse(b.modifiedAt) : Number.NaN;
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return bTime - aTime;
  if (!Number.isNaN(aTime) !== !Number.isNaN(bTime)) return Number.isNaN(aTime) ? 1 : -1;
  if (a.vaults !== b.vaults) return b.vaults - a.vaults;
  return a.path.localeCompare(b.path);
}

/** Merge candidate groups, drop the effective root, and sort (newest → vaults → path). */
export function mergeCandidates(
  currentRoot: string,
  groups: readonly (readonly LegacyCandidate[])[]
): LegacyCandidate[] {
  const current = pathKey(currentRoot);
  const merged = new Map<string, LegacyCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      if (!candidate || !candidate.path) continue;
      const key = pathKey(candidate.path);
      if (key === current) continue;
      const existing = merged.get(key);
      if (!existing || candidateScore(candidate) > candidateScore(existing)) {
        merged.set(key, candidate);
      }
    }
  }
  return [...merged.values()].sort(compareCandidates);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MigrationGate {
  private current: MigrationState;
  private readonly waitPromise: Promise<void>;
  private releaseWait!: () => void;
  private waitReleased = false;
  private readonly settledPromise: Promise<MigrationState>;
  private resolveSettled!: (state: MigrationState) => void;
  private settledResolved = false;
  private decision: Promise<MigrationState> | null = null;

  constructor(private readonly deps: MigrationGateDeps) {
    this.current = { kind: "checking", dataRoot: "" };
    this.waitPromise = new Promise<void>((resolve) => {
      this.releaseWait = resolve;
    });
    this.settledPromise = new Promise<MigrationState>((resolve) => {
      this.resolveSettled = resolve;
    });
  }

  state(): MigrationState {
    return this.current;
  }

  /** Resolves only when the current root may be used to start the server. */
  wait(): Promise<void> {
    return this.waitPromise;
  }

  /** Resolves with the first decision outcome, `pending` included (guide panel hook). */
  whenSettled(): Promise<MigrationState> {
    return this.settledPromise;
  }

  /** Let the caller treat the current root as ready (guide panel step 3). */
  release(): void {
    if (this.current.kind === "pending" || this.current.kind === "checking") {
      this.setState({ kind: "ready", dataRoot: this.deps.dataRoot() });
    }
    this.allowStart();
  }

  decide(): Promise<MigrationState> {
    this.decision ??= this.run().catch((error: unknown) => {
      const message = errorMessage(error);
      this.deps.log(`migration gate: ${message}`);
      return this.settle({ kind: "error", dataRoot: this.deps.dataRoot(), message });
    });
    return this.decision;
  }

  /** Re-detect from scratch (after installing CLI tools or fixing a failed migration). */
  retry(): Promise<MigrationState> {
    // A detection already running (or a modal already open) must never be raced
    // by a second one: re-entrant retry shares the in-flight decision.
    if (this.current.kind === "checking" || this.current.kind === "no-data") {
      return this.decision ?? this.decide();
    }
    this.decision = null;
    this.setState({ kind: "checking", dataRoot: this.deps.dataRoot() });
    return this.decide();
  }

  private async run(): Promise<MigrationState> {
    const root = this.deps.dataRoot();
    if (this.deps.isInitialized(root)) {
      return this.settle({ kind: "ready", dataRoot: root });
    }

    let inspect: HomeInspectJson | null = null;
    let failure: string | null = null;
    let unsupported = false;
    try {
      inspect = await this.deps.inspect(root);
    } catch (error) {
      failure = errorMessage(error);
      unsupported = error instanceof HomeCommandError && error.details.unsupported;
      this.deps.log(
        `migration gate: inspect failed${unsupported ? " (runtime predates the home command)" : ""}: ${failure}`
      );
    }

    const candidates = mergeCandidates(root, [
      inspect ? inspect.candidates.map(toLegacyCandidate) : [],
      this.deps.scanExtensionDataDirs(),
    ]);

    if (!inspect) {
      if (unsupported && candidates.length > 0) {
        const message =
          "the resolved hyseed runtime predates the 'home' commands; install hyseed 0.2.0 CLI tools and retry";
        this.deps.notifyError?.(message);
        return this.settle(
          { kind: "pending", dataRoot: root, candidates, reason: "runtime-too-old", message },
          false
        );
      }
      return this.settle({ kind: "error", dataRoot: root, message: failure ?? "home inspect failed" });
    }

    if (inspect.initialized || this.deps.isInitialized(root)) {
      return this.settle({ kind: "ready", dataRoot: root });
    }
    if (candidates.length === 0) {
      return this.settle({ kind: "fresh", dataRoot: root, candidates: [] });
    }

    this.setState({ kind: "no-data", dataRoot: root, candidates });
    const decision = await this.deps.decide({ dataRoot: root, candidates });
    return this.applyDecision(root, candidates, decision);
  }

  private async applyDecision(
    root: string,
    candidates: LegacyCandidate[],
    decision: MigrationDecision | null
  ): Promise<MigrationState> {
    if (!decision || decision.action === "not-now") {
      const message =
        "data folder setup is required; run 'hyseed: Setup data folder' from the Command Palette";
      return this.settle(
        { kind: "pending", dataRoot: root, candidates, reason: "not-now", message },
        false
      );
    }
    if (decision.action === "use") {
      return this.useRoot(decision.candidate.path, candidates);
    }
    if (decision.action === "choose-folder") {
      return this.useRoot(decision.path, candidates);
    }
    return this.migrateInto(root, candidates, decision.candidate);
  }

  private async useRoot(target: string, candidates: LegacyCandidate[]): Promise<MigrationState> {
    const root = this.deps.dataRoot();
    try {
      await this.deps.setDataDir(target);
      // The 'kbMcp.dataRoot' setting and an inherited KB_MCP_HOME outrank
      // config.yaml, so the config write alone may not move the root the
      // extension's child processes actually open.
      const effective = this.deps.dataRoot();
      if (pathKey(effective) !== pathKey(target)) {
        const message =
          `the data folder in the config is now ${target}, but ${effective} still overrides it ` +
          "(clear the 'kbMcp.dataRoot' setting or the KB_MCP_HOME variable, then run 'hyseed: Setup data folder')";
        this.deps.log(`migration gate: ${message}`);
        this.deps.notifyError?.(message);
        return this.settle(
          { kind: "pending", dataRoot: root, candidates, reason: "migration-failed", message },
          false
        );
      }
      this.deps.log(`migration gate: data folder switched to ${target}`);
      this.deps.onDataRootChanged?.(target);
      return this.settle({ kind: "ready", dataRoot: target });
    } catch (error) {
      const message = `could not switch the data folder to ${target}: ${errorMessage(error)}`;
      this.deps.log(`migration gate: ${message}`);
      this.deps.notifyError?.(message);
      return this.settle(
        { kind: "pending", dataRoot: root, candidates, reason: "migration-failed", message },
        false
      );
    }
  }

  private async migrateInto(
    root: string,
    candidates: LegacyCandidate[],
    candidate: LegacyCandidate
  ): Promise<MigrationState> {
    if (this.deps.isInitialized(root)) {
      return this.resolveConflict(root, candidates, candidate.path);
    }
    try {
      const result = await this.deps.migrate(candidate.path, root);
      if (!result.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "migration failed");
      }
      this.deps.log(
        `migration gate: migrated ${candidate.path} -> ${root} ` +
          `(${result.mode ?? "move"}, vaults ${result.vaults ?? "?"}, documents ${result.documents ?? "?"})`
      );
      this.deps.onDataRootChanged?.(root);
      return this.settle({ kind: "ready", dataRoot: root });
    } catch (error) {
      if (error instanceof HomeCommandError && error.details.code === 4 && this.deps.decideConflict) {
        return this.resolveConflict(root, candidates, candidate.path);
      }
      const message = `migration failed: ${errorMessage(error)}`;
      this.deps.log(`migration gate: ${message}`);
      this.deps.notifyError?.(message);
      return this.settle(
        { kind: "pending", dataRoot: root, candidates, reason: "migration-failed", message },
        false
      );
    }
  }

  /** Both roots hold data: never merge or overwrite; the user picks one. */
  private async resolveConflict(
    root: string,
    candidates: LegacyCandidate[],
    source: string
  ): Promise<MigrationState> {
    if (!this.deps.decideConflict) {
      const message = `the target ${root} already holds data; choose a data folder with 'hyseed: Setup data folder'`;
      this.deps.notifyError?.(message);
      return this.settle(
        { kind: "pending", dataRoot: root, candidates, reason: "migration-failed", message },
        false
      );
    }
    const choice = await this.deps.decideConflict({ dataRoot: root, candidates, source });
    if (!choice || choice.action === "cancel") {
      const message = `the target ${root} already holds data; nothing was migrated`;
      this.deps.notifyError?.(message);
      return this.settle(
        { kind: "pending", dataRoot: root, candidates, reason: "migration-failed", message },
        false
      );
    }
    if (choice.action === "keep") {
      return this.settle({ kind: "ready", dataRoot: root });
    }
    if (choice.action === "use") {
      return this.useRoot(choice.candidate.path, candidates);
    }
    return this.useRoot(choice.path, candidates);
  }

  private settle(state: MigrationState, allowStart = true): MigrationState {
    this.setState(state);
    if (!this.settledResolved) {
      this.settledResolved = true;
      this.resolveSettled(state);
    }
    if (allowStart) this.allowStart();
    return state;
  }

  private allowStart(): void {
    if (this.waitReleased) return;
    this.waitReleased = true;
    this.releaseWait();
  }

  private setState(state: MigrationState): void {
    this.current = state;
    this.deps.onState?.(state);
  }
}

/** `globalState` key read by the first-run guide (subtask 3). */
export const VERSION_STATE_KEY = "kbmcp.versionState";

export interface VersionState {
  current: string;
  previous: string | null;
  firstInstall: boolean;
  majorMinorUpgrade: boolean;
  recordedAt: string;
}

export interface VersionMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<unknown>;
}

export function majorMinor(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  return match ? `${match[1]}.${match[2]}` : "";
}

/**
 * Record first-install / major.minor-upgrade markers for the guide panel.
 * The write is best-effort: a read-only memento must never fail activation.
 */
export function recordVersionState(
  memento: VersionMemento,
  currentVersion: string,
  now: Date = new Date()
): VersionState {
  const stored = memento.get<VersionState>(VERSION_STATE_KEY);
  const previous = stored && typeof stored.current === "string" ? stored.current : null;
  const state: VersionState = {
    current: currentVersion,
    previous,
    firstInstall: previous === null,
    majorMinorUpgrade: previous !== null && majorMinor(previous) !== majorMinor(currentVersion),
    recordedAt: now.toISOString(),
  };
  void Promise.resolve(memento.update(VERSION_STATE_KEY, state)).catch(() => undefined);
  return state;
}