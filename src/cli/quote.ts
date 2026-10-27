/**
 * cmd.exe command-line construction for palette commands. Pure functions only
 * (no `vscode` import) so the whole matrix stays unit-testable.
 */

import { DISPLAY_NAME } from "../constants";

export class UnsafeArgError extends Error {
  constructor(
    readonly value: string,
    readonly reason: string
  ) {
    super(`${reason}: ${value}`);
    this.name = "UnsafeArgError";
  }
}

/**
 * Characters cmd.exe would expand or choke on even inside double quotes. The
 * strategy is to refuse instead of escaping: refusing is predictable, escaping
 * is a losing game.
 */
const REFUSED = /["%!\r\n]/;

/** Values containing these get wrapped in double quotes (safe there). */
const NEEDS_QUOTES = /[\s&|<>^()]/;

export interface CliEnv {
  KB_MCP_HOME?: string;
  KB_MCP_VAULT?: string;
}

function doubleTrailingBackslashes(arg: string): string {
  const match = /\\+$/.exec(arg);
  if (!match) return arg;
  return arg.slice(0, -match[0].length) + "\\".repeat(match[0].length * 2);
}

/** Quote one argument; throws UnsafeArgError rather than trying to escape. */
export function quoteArg(arg: string): string {
  if (arg === "") return '""';
  if (REFUSED.test(arg)) {
    throw new UnsafeArgError(arg, 'contains a character cmd.exe expands (" % ! or a newline)');
  }
  if (!NEEDS_QUOTES.test(arg)) return arg;
  // Inside quotes the CRT treats backslashes before the closing quote as escapes,
  // so a value ending in `\` must double its trailing run.
  return `"${doubleTrailingBackslashes(arg)}"`;
}

function setLine(name: string, value: string): string {
  if (REFUSED.test(value)) {
    throw new UnsafeArgError(value, `${name} contains a character cmd.exe expands`);
  }
  // `set "VAR=value"` keeps spaces and shell metacharacters literal.
  return `set "${name}=${value}"`;
}

function quotedAlways(value: string, what: string): string {
  if (REFUSED.test(value)) {
    throw new UnsafeArgError(value, `${what} contains a character cmd.exe expands`);
  }
  return `"${doubleTrailingBackslashes(value)}"`;
}

/**
 * Lines sent to the fixed cmd.exe terminal, in order:
 * env prefixes, the token line (serve http only), the command, the exit-code echo.
 * The token VALUE never enters a line — only the path of the file it is read from.
 */
export function buildLines(
  exe: string,
  args: readonly string[],
  env: CliEnv,
  tokenFile?: string
): string[] {
  const lines: string[] = [];
  if (env.KB_MCP_HOME) lines.push(setLine("KB_MCP_HOME", env.KB_MCP_HOME));
  if (env.KB_MCP_VAULT) lines.push(setLine("KB_MCP_VAULT", env.KB_MCP_VAULT));
  if (tokenFile) lines.push(`set /p KB_MCP_HTTP_TOKEN=<${quotedAlways(tokenFile, "token file path")}`);
  // The executable is always quoted: a resolver path may gain spaces later.
  lines.push([quotedAlways(exe, "executable path"), ...args.map(quoteArg)].join(" "));
  lines.push(`echo [${DISPLAY_NAME} exit=%errorlevel%]`);
  return lines;
}