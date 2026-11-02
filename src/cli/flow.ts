/**
 * Palette command flow: resolve the runtime, run the declared prompts, build
 * the cmd.exe lines, hand them to the terminal. UI, terminal, token file and
 * CLI runner are injected so the whole path is testable.
 */

import { DEFAULT_HOST } from "../host";
import type { CliRunResult } from "../mcp/skillsCli";
import { buildLines, UnsafeArgError, type CliEnv } from "./quote";
import { CLI_COMMANDS, type CliContext, type CliUi } from "./registry";

export interface TokenSource {
  /** The 0.2.0 token path; the pre-rename file is no longer consulted. */
  file: string;
  /** Returns the trimmed token, or null when the file is missing/empty. */
  read(file: string): string | null;
  generate(file: string): void;
}

export interface CliDeps {
  resolveExe(): Promise<string>;
  workspaceRoot(): string | undefined;
  run(exe: string, args: string[], cwd?: string): Promise<CliRunResult>;
  sendToTerminal(lines: string[]): void;
  token: TokenSource;
  env(): CliEnv;
  log(message: string): void;
  /** Resolved document converter for `ingest`; absent = let the CLI discover one. */
  converter?(exe: string): string | undefined;
  /** Bind address for `serve --transport http`; absent = loopback. */
  mcpHost?(): string;
}

/** Use the token file when readable; generate it on confirmation when missing. */
export async function resolveToken(ui: CliUi, token: TokenSource): Promise<string | null> {
  if (token.read(token.file)) return token.file;
  const ok = await ui.confirm(
    "No HTTP token found",
    `Generate one at ${token.file}? Writes a 32-hex token; its value never appears in the terminal.`
  );
  if (!ok) return null;
  try {
    token.generate(token.file);
  } catch (err) {
    ui.error(`could not write the token file: ${(err as Error).message}`);
    return null;
  }
  if (token.read(token.file)) return token.file;
  ui.error(`token file ${token.file} is empty after writing`);
  return null;
}

export async function runCliCommand(id: string, ui: CliUi, deps: CliDeps): Promise<void> {
  const spec = CLI_COMMANDS[id];
  if (!spec) {
    ui.error(`unknown CLI command: ${id}`);
    return;
  }
  try {
    const exe = await deps.resolveExe();
    const root = deps.workspaceRoot();
    const ctx: CliContext = {
      exe,
      cwd: root ?? process.cwd(),
      run: deps.run,
      converter: deps.converter?.(exe),
      host: deps.mcpHost?.() ?? DEFAULT_HOST,
    };

    const invocation = await spec.build(ui, ctx);
    if (!invocation) return;

    let tokenFile: string | undefined;
    if (invocation.needsToken) {
      tokenFile = (await resolveToken(ui, deps.token)) ?? undefined;
      if (!tokenFile) return;
      deps.log(`http token: ${tokenFile}`);
    }

    const lines = buildLines(exe, invocation.args, deps.env(), tokenFile);
    deps.sendToTerminal(lines);
    deps.log(`cli ${id}: ${invocation.args.join(" ")}`);
  } catch (err) {
    if (err instanceof UnsafeArgError) {
      ui.error(`${err.message} — run this command in your own terminal instead`);
      return;
    }
    ui.error(err instanceof Error ? err.message : String(err));
  }
}