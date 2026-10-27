/**
 * Guided `hyseed skills` flows. UI and process access are injected so the whole
 * flow is unit-testable without a real VS Code window or a real hyseed.exe.
 */
import {
  actionsSummary,
  hasConflicts,
  parseSkillsList,
  parseSkillsReport,
  renderResultLines,
  renderSkillsState,
} from "./report";
import { buildAddArgs, buildListArgs, buildRemoveArgs, type CliRunResult } from "./skillsCli";

export const AGENT_HOSTS = ["claude", "codex", "cline"] as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];
export type SkillsScope = "global" | "project";

export interface SkillsUi {
  pickHosts(): Promise<string[] | undefined>;
  pickScope(hosts: readonly string[]): Promise<SkillsScope | undefined>;
  confirm(title: string, detail?: string): Promise<boolean>;
  notify(message: string): void;
  error(message: string): void;
  showDetails(title: string, lines: string[]): void;
}

export interface SkillsDeps {
  resolveExe(): Promise<string>;
  workspaceRoot(): string | undefined;
  run(exe: string, args: string[], cwd: string): Promise<CliRunResult>;
  log(message: string): void;
}

function errorText(result: CliRunResult): string {
  const stderr = result.stderr.trim();
  if (stderr) return stderr;
  return result.stdout.trim().split(/\r?\n/).slice(0, 3).join("\n");
}

function projectScopeRefused(ui: SkillsUi, hosts: readonly string[]): boolean {
  if (!hosts.includes("codex")) return false;
  ui.error("codex has no project-level skills or MCP location; choose global scope or drop codex");
  return true;
}

export async function installSkillsFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void> {
  const hosts = await ui.pickHosts();
  if (!hosts || hosts.length === 0) return;
  const scope = await ui.pickScope(hosts);
  if (!scope) return;
  if (scope === "project" && projectScopeRefused(ui, hosts)) return;

  const workspace = deps.workspaceRoot();
  if (scope === "project" && !workspace) {
    ui.error("open a workspace folder to install at project scope");
    return;
  }
  const cwd = workspace ?? ".";
  const exe = await deps.resolveExe();

  const preview = await deps.run(
    exe,
    buildAddArgs(hosts, scope, { dryRun: true, mcpCommand: exe }),
    cwd
  );
  const previewReport = parseSkillsReport(preview.stdout);
  if (!previewReport) {
    ui.error(`skills preview failed (rc=${preview.rc}): ${errorText(preview)}`);
    return;
  }

  const lines = renderResultLines(previewReport);
  let force = false;
  if (hasConflicts(previewReport)) {
    const proceed = await ui.confirm(
      `${previewReport.results.filter((r) => r.action === "conflict").length} conflict(s) found`,
      `${lines.join("\n")}\n\nForce overwrites conflicting files and entries after a .bak backup. Continue?`
    );
    if (!proceed) return;
    force = true;
  } else if (!(await ui.confirm("Install hyseed skills?", lines.join("\n")))) {
    return;
  }

  const result = await deps.run(exe, buildAddArgs(hosts, scope, { force, mcpCommand: exe }), cwd);
  const report = parseSkillsReport(result.stdout);
  if (!report) {
    ui.error(`skills add failed (rc=${result.rc}): ${errorText(result)}`);
    return;
  }
  deps.log(`skills add (${force ? "force" : "normal"}): ${actionsSummary(report)}`);
  ui.showDetails("hyseed skills — install report", renderResultLines(report));
  if (result.rc !== 0) {
    ui.error(`skills add exited with rc=${result.rc}: ${actionsSummary(report)}`);
    return;
  }
  ui.notify(`hyseed skills installed (${actionsSummary(report)})`);
}

export async function removeSkillsFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void> {
  const hosts = await ui.pickHosts();
  if (!hosts || hosts.length === 0) return;
  const scope = await ui.pickScope(hosts);
  if (!scope) return;
  if (scope === "project" && projectScopeRefused(ui, hosts)) return;

  const workspace = deps.workspaceRoot();
  if (scope === "project" && !workspace) {
    ui.error("open a workspace folder to remove at project scope");
    return;
  }
  const cwd = workspace ?? ".";

  const proceed = await ui.confirm(
    "Remove hyseed skills?",
    "Only files and entries written by 'hyseed skills add' are removed; modified trees and foreign entries are refused."
  );
  if (!proceed) return;

  const exe = await deps.resolveExe();
  const result = await deps.run(exe, buildRemoveArgs(hosts, scope), cwd);
  const report = parseSkillsReport(result.stdout);
  if (!report) {
    ui.error(`skills remove failed (rc=${result.rc}): ${errorText(result)}`);
    return;
  }
  deps.log(`skills remove: ${actionsSummary(report)}`);
  ui.showDetails("hyseed skills — remove report", renderResultLines(report));
  if (result.rc !== 0) {
    ui.error(`skills remove exited with rc=${result.rc}: ${actionsSummary(report)}`);
    return;
  }
  ui.notify(`hyseed skills removed (${actionsSummary(report)})`);
}

export async function showSkillsStateFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void> {
  const exe = await deps.resolveExe();
  const result = await deps.run(exe, buildListArgs(), deps.workspaceRoot() ?? ".");
  const report = parseSkillsList(result.stdout);
  if (!report) {
    ui.error(`skills list failed (rc=${result.rc}): ${errorText(result)}`);
    return;
  }
  const lines = renderSkillsState(report);
  deps.log(lines.join("\n"));
  ui.showDetails("hyseed skills — host state", lines);
}