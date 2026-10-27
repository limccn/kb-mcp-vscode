import type { CliRunResult } from "../mcp/skillsCli";

export interface VaultInfo {
  name: string;
  path: string;
}

export interface VaultListState {
  vaults: VaultInfo[];
  current: string | null;
}

export type VaultRunner = (exe: string, args: string[], cwd?: string) => Promise<CliRunResult>;

export interface VaultCliContext {
  run: VaultRunner;
  cwd: string;
}

export class VaultCliError extends Error {
  constructor(
    readonly rc: number,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(firstLine(stderr) ?? firstLine(stdout) ?? `exit code ${rc}`);
    this.name = "VaultCliError";
  }
}

function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return line ?? null;
}

export function buildVaultCreateArgs(name: string): string[] {
  return ["vault", "create", name, "--json"];
}

export function buildVaultSwitchArgs(name: string): string[] {
  return ["vault", "switch", name];
}

export function buildVaultListArgs(asJson: boolean): string[] {
  return asJson ? ["vault", "list", "--json"] : ["vault", "list"];
}

/** `vault list --json` carries no `current` field; current only appears in the text listing. */
export function parseVaultListJson(stdout: string): VaultInfo[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("unexpected vault list output: expected a JSON array");
  }
  return parsed.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { name?: unknown }).name !== "string" ||
      typeof (item as { path?: unknown }).path !== "string"
    ) {
      throw new Error("unexpected vault list output: entry without name/path");
    }
    const vault = item as { name: string; path: string };
    return { name: vault.name, path: vault.path };
  });
}

export function parseCurrentVault(text: string): string | null {
  const match = /^Default vault:[ \t]*(.+?)[ \t]*$/m.exec(text);
  return match ? match[1] : null;
}

function ensureOk(result: CliRunResult): void {
  if (result.rc !== 0) {
    throw new VaultCliError(result.rc, result.stdout, result.stderr);
  }
}

export async function listVaults(exe: string, ctx: VaultCliContext): Promise<VaultListState> {
  const listed = await ctx.run(exe, buildVaultListArgs(true), ctx.cwd);
  ensureOk(listed);
  const vaults = parseVaultListJson(listed.stdout);
  return { vaults, current: await readCurrentVault(exe, ctx) };
}

export async function readCurrentVault(
  exe: string,
  ctx: VaultCliContext
): Promise<string | null> {
  const listed = await ctx.run(exe, buildVaultListArgs(false), ctx.cwd);
  if (listed.rc !== 0) return null;
  return parseCurrentVault(listed.stdout);
}

export async function createVault(
  exe: string,
  name: string,
  ctx: VaultCliContext
): Promise<{ name: string; path: string }> {
  const result = await ctx.run(exe, buildVaultCreateArgs(name), ctx.cwd);
  ensureOk(result);
  const parsed: unknown = JSON.parse(result.stdout);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { path?: unknown }).path !== "string"
  ) {
    throw new Error("unexpected vault create output");
  }
  const created = parsed as { name: string; path: string };
  return { name: created.name, path: created.path };
}

export async function switchVault(exe: string, name: string, ctx: VaultCliContext): Promise<void> {
  ensureOk(await ctx.run(exe, buildVaultSwitchArgs(name), ctx.cwd));
}