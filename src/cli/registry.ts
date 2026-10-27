/**
 * The 21 palette commands: prompt sequence + exact `hyseed` argument list.
 * Forms are calibrated against hyseed 0.9.0 `--help` output (evidence in the
 * task directory); no `vscode` import, so every command is unit-testable via a
 * scripted UI.
 */

import { COMMANDS } from "../constants";
import type { CliRunResult } from "../mcp/skillsCli";
import { parseSkillsList } from "../mcp/report";
import { listVaults } from "../vaults/vaults";

export interface CliUi {
  /** `undefined` = cancelled; an empty string means the user submitted nothing. */
  input(options: { title: string; value?: string; placeHolder?: string }): Promise<string | undefined>;
  pickFolder(title: string): Promise<string | undefined>;
  pickFile(title: string): Promise<string | undefined>;
  pickOne(title: string, items: readonly string[]): Promise<string | undefined>;
  pickMany(
    title: string,
    items: readonly string[],
    defaults?: readonly string[]
  ): Promise<string[] | undefined>;
  confirm(title: string, detail?: string): Promise<boolean>;
  error(message: string): void;
}

export interface CliContext {
  exe: string;
  cwd: string;
  run(exe: string, args: string[], cwd?: string): Promise<CliRunResult>;
  /** Resolved document converter for `ingest`; absent = let the CLI discover one. */
  converter?: string;
}

export interface CliInvocation {
  args: string[];
  needsToken?: boolean;
}

export interface CliCommandSpec {
  /** Prompt keys, for completeness tests and documentation. */
  prompts: readonly string[];
  build(ui: CliUi, ctx: CliContext): Promise<CliInvocation | null>;
}

const AGENTS = ["claude", "codex", "cline"] as const;
const SCOPES = ["global", "project"] as const;

async function requiredInput(ui: CliUi, title: string, what: string): Promise<string | null> {
  const raw = await ui.input({ title });
  if (raw === undefined) return null;
  const value = raw.trim();
  if (!value) {
    ui.error(`${what} must not be empty`);
    return null;
  }
  return value;
}

function firstLine(result: CliRunResult): string {
  const text = [result.stderr, result.stdout].filter(Boolean).join("\n");
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? `exit code ${result.rc}`
  );
}

async function pickAgentsAndScope(ui: CliUi): Promise<{ agents: string[]; scope: string } | null> {
  const agents = await ui.pickMany("Target agent hosts", [...AGENTS], ["claude"]);
  if (!agents || agents.length === 0) return null;
  const scope = await ui.pickOne("Install scope", [...SCOPES]);
  if (!scope) return null;
  return { agents, scope };
}

export const CLI_COMMANDS: Record<string, CliCommandSpec> = {
  [COMMANDS.cliSearch]: {
    prompts: ["query"],
    async build(ui) {
      const query = await requiredInput(ui, "Search query", "query");
      return query ? { args: ["search", query] } : null;
    },
  },

  [COMMANDS.cliGet]: {
    prompts: ["id"],
    async build(ui) {
      const id = await requiredInput(ui, "Document id", "document id");
      return id ? { args: ["get", id] } : null;
    },
  },

  [COMMANDS.cliList]: {
    prompts: [],
    async build() {
      return { args: ["list"] };
    },
  },

  [COMMANDS.cliAdd]: {
    prompts: ["type", "title", "body"],
    async build(ui) {
      const type = await requiredInput(ui, "Document type", "type");
      if (!type) return null;
      const title = await requiredInput(ui, "Document title", "title");
      if (!title) return null;
      const body = (await ui.input({ title: "Document body (optional)" }))?.trim();
      const args = ["add", "--type", type, "--title", title];
      if (body) args.push("--body", body);
      return { args };
    },
  },

  [COMMANDS.cliIngest]: {
    prompts: ["source", "out"],
    async build(ui, ctx) {
      const kind = await ui.pickOne("What do you want to ingest?", ["File", "Folder"]);
      if (!kind) return null;
      const source =
        kind === "File"
          ? await ui.pickFile("Pick a file to ingest")
          : await ui.pickFolder("Pick a folder to ingest");
      if (!source) return null;
      const out = await ui.pickFolder("Choose the output folder (--out)");
      if (!out) return null;
      const args = ["ingest", ...(kind === "File" ? ["-f", source] : [source]), "--out", out];
      if (ctx.converter) args.push("--converter", ctx.converter);
      return { args };
    },
  },

  [COMMANDS.cliImport]: {
    prompts: ["dir"],
    async build(ui) {
      const dir = await ui.pickFolder("Pick a Markdown folder to import");
      return dir ? { args: ["import", dir] } : null;
    },
  },

  [COMMANDS.cliExport]: {
    prompts: ["dir"],
    async build(ui) {
      const dir = await ui.pickFolder("Pick an export folder");
      return dir ? { args: ["export", dir] } : null;
    },
  },

  [COMMANDS.cliDoctor]: {
    prompts: [],
    async build() {
      return { args: ["doctor"] };
    },
  },

  [COMMANDS.cliStats]: {
    prompts: [],
    async build() {
      return { args: ["stats"] };
    },
  },

  [COMMANDS.cliReindex]: {
    prompts: ["confirm"],
    async build(ui) {
      const ok = await ui.confirm(
        "Rebuild the full-text index?",
        "The command can take a while; output stays in the terminal."
      );
      return ok ? { args: ["reindex"] } : null;
    },
  },

  [COMMANDS.cliDiffCheck]: {
    prompts: [],
    async build() {
      return { args: ["diff-check"] };
    },
  },

  [COMMANDS.cliHistory]: {
    prompts: ["id"],
    async build(ui) {
      const id = await requiredInput(ui, "Document id", "document id");
      return id ? { args: ["history", id] } : null;
    },
  },

  [COMMANDS.cliVaultList]: {
    prompts: [],
    async build() {
      return { args: ["vault", "list"] };
    },
  },

  [COMMANDS.cliVaultCreate]: {
    prompts: ["name"],
    async build(ui) {
      const name = await requiredInput(ui, "New vault name", "vault name");
      return name ? { args: ["vault", "create", name] } : null;
    },
  },

  [COMMANDS.cliVaultSwitch]: {
    prompts: ["vault"],
    async build(ui, ctx) {
      const state = await listVaults(ctx.exe, { run: ctx.run, cwd: ctx.cwd });
      if (state.vaults.length === 0) {
        ui.error("no vaults found");
        return null;
      }
      const picked = await ui.pickOne(
        `Switch the global default vault (current: ${state.current ?? "unknown"})`,
        state.vaults.map((vault) => vault.name)
      );
      return picked ? { args: ["vault", "switch", picked] } : null;
    },
  },

  [COMMANDS.cliVaultStatus]: {
    prompts: [],
    async build() {
      return { args: ["vault", "status"] };
    },
  },

  [COMMANDS.cliSkillsList]: {
    prompts: [],
    async build() {
      return { args: ["skills", "list"] };
    },
  },

  [COMMANDS.cliSkillsShow]: {
    prompts: ["skill"],
    async build(ui, ctx) {
      const listed = await ctx.run(ctx.exe, ["skills", "list", "--json"], ctx.cwd);
      if (listed.rc !== 0) throw new Error(firstLine(listed));
      const report = parseSkillsList(listed.stdout);
      if (!report || report.bundled.length === 0) {
        throw new Error("could not read the bundled skills from the CLI output");
      }
      const picked = await ui.pickOne(
        "Show a bundled skill",
        report.bundled.map((skill) => skill.name)
      );
      return picked ? { args: ["skills", "show", picked] } : null;
    },
  },

  [COMMANDS.cliSkillsAdd]: {
    prompts: ["agents", "scope"],
    async build(ui) {
      const picked = await pickAgentsAndScope(ui);
      if (!picked) return null;
      return {
        args: [
          "skills",
          "add",
          ...picked.agents.flatMap((agent) => ["--agent", agent]),
          "--scope",
          picked.scope,
        ],
      };
    },
  },

  [COMMANDS.cliSkillsRemove]: {
    prompts: ["agents", "scope", "confirm"],
    async build(ui) {
      const picked = await pickAgentsAndScope(ui);
      if (!picked) return null;
      const ok = await ui.confirm(
        "Remove the bundled skills?",
        "Only the bundled skills and the hyseed MCP entry are removed."
      );
      if (!ok) return null;
      return {
        args: [
          "skills",
          "remove",
          ...picked.agents.flatMap((agent) => ["--agent", agent]),
          "--scope",
          picked.scope,
        ],
      };
    },
  },

  [COMMANDS.cliServeHttp]: {
    prompts: ["port", "confirm"],
    async build(ui) {
      const raw = await ui.input({ title: "HTTP port", value: "8000" });
      if (raw === undefined) return null;
      const port = Number(raw.trim());
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        ui.error("port must be an integer between 1 and 65535");
        return null;
      }
      const ok = await ui.confirm(
        `Serve over HTTP on 127.0.0.1:${port}?`,
        "Requires the HTTP token; Ctrl+C in the terminal stops the server."
      );
      return ok
        ? { args: ["serve", "--transport", "http", "--port", String(port)], needsToken: true }
        : null;
    },
  },
};