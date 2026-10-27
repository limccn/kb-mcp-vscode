import { spawn } from "node:child_process";

export interface CliRunResult {
  rc: number;
  stdout: string;
  stderr: string;
}

export interface CliRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface AddFlags {
  force?: boolean;
  dryRun?: boolean;
  mcpCommand: string;
}

export function buildAddArgs(agents: readonly string[], scope: string, flags: AddFlags): string[] {
  const args = ["skills", "add"];
  for (const agent of agents) args.push("--agent", agent);
  args.push("--scope", scope);
  if (flags.force) args.push("--force");
  if (flags.dryRun) args.push("--dry-run");
  args.push("--mcp-command", flags.mcpCommand);
  args.push("--json");
  return args;
}

export function buildRemoveArgs(
  agents: readonly string[],
  scope: string,
  flags: { force?: boolean; dryRun?: boolean } = {}
): string[] {
  const args = ["skills", "remove"];
  for (const agent of agents) args.push("--agent", agent);
  args.push("--scope", scope);
  if (flags.force) args.push("--force");
  if (flags.dryRun) args.push("--dry-run");
  args.push("--json");
  return args;
}

export function buildListArgs(): string[] {
  return ["skills", "list", "--json"];
}

/**
 * Frozen hyseed builds ignore PYTHONIOENCODING/PYTHONUTF8 and can emit cp932 on a
 * Japanese Windows console, so fall back to shift_jis when UTF-8 decoding found
 * replacement characters. JSON reports are mostly ASCII; this is a safety net.
 */
export function decodeCliOutput(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch {
    return utf8;
  }
}

export function runSkillsCli(
  exe: string,
  args: string[],
  opts: CliRunOptions
): Promise<CliRunResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${exe} ${args.join(" ")} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    // `close` (not `exit`) so stdout is fully drained before decoding.
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        rc: code ?? -1,
        stdout: decodeCliOutput(Buffer.concat(stdout)),
        stderr: decodeCliOutput(Buffer.concat(stderr)),
      });
    });
  });
}