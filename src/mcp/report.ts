/**
 * Parsers and renderers for `hyseed skills ... --json` output.
 * Pure functions with no `vscode` import so they stay unit-testable.
 */

export interface SkillsResult {
  agent: string;
  scope: string;
  kind: string;
  target: string;
  action: string;
  backup: string | null;
  note: string | null;
}

export interface SkillsReport {
  ok: boolean;
  dryRun: boolean;
  results: SkillsResult[];
}

export interface SkillsListSkill {
  name: string;
  files: number;
  bytes: number;
}

export interface SkillsListTarget {
  agent: string;
  scope: string;
  skillsDir: string;
  mcpFile: string | null;
  mcpKind: string;
  skills: Record<string, string>;
  mcp: string;
  legacy: { skills: string[]; mcp: string };
}

export interface SkillsListReport {
  bundled: SkillsListSkill[];
  targets: SkillsListTarget[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(asRecord(value))) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseSkillsReport(stdout: string): SkillsReport | null {
  const data = asRecord(parseJson(stdout));
  if (!Array.isArray(data.results)) return null;
  const results = data.results.map((entry) => {
    const item = asRecord(entry);
    return {
      agent: asString(item.agent),
      scope: asString(item.scope),
      kind: asString(item.kind),
      target: asString(item.target),
      action: asString(item.action),
      backup: typeof item.backup === "string" ? item.backup : null,
      note: typeof item.note === "string" ? item.note : null,
    };
  });
  return { ok: data.ok === true, dryRun: data.dry_run === true, results };
}

export function parseSkillsList(stdout: string): SkillsListReport | null {
  const data = asRecord(parseJson(stdout));
  if (!Array.isArray(data.bundled) || !Array.isArray(data.targets)) return null;
  const bundled = data.bundled.map((entry) => {
    const item = asRecord(entry);
    return {
      name: asString(item.name),
      files: typeof item.files === "number" ? item.files : 0,
      bytes: typeof item.bytes === "number" ? item.bytes : 0,
    };
  });
  const targets = data.targets.map((entry) => {
    const item = asRecord(entry);
    const legacy = asRecord(item.legacy);
    return {
      agent: asString(item.agent),
      scope: asString(item.scope),
      skillsDir: asString(item.skills_dir),
      mcpFile: typeof item.mcp_file === "string" ? item.mcp_file : null,
      mcpKind: asString(item.mcp_kind),
      skills: asStringRecord(item.skills),
      mcp: asString(item.mcp),
      legacy: {
        skills: Array.isArray(legacy.skills)
          ? legacy.skills.filter((name): name is string => typeof name === "string")
          : [],
        mcp: asString(legacy.mcp, "absent"),
      },
    };
  });
  return { bundled, targets };
}

export function hasConflicts(report: SkillsReport): boolean {
  return report.results.some((result) => result.action === "conflict");
}

export function actionsSummary(report: SkillsReport): string {
  const counts = new Map<string, number>();
  for (const result of report.results) {
    counts.set(result.action, (counts.get(result.action) ?? 0) + 1);
  }
  return [...counts.entries()].map(([action, count]) => `${action}: ${count}`).join(", ");
}

export function renderResultLines(report: SkillsReport): string[] {
  return report.results.map((result) => {
    const backup = result.backup ? ` (backup: ${result.backup})` : "";
    const note = result.note ? ` — ${result.note}` : "";
    return `${result.action.padEnd(9)} ${result.agent}/${result.scope} ${result.kind}${backup}${note}`;
  });
}

export function renderSkillsState(report: SkillsListReport): string[] {
  const bundled = report.bundled
    .map((skill) => `${skill.name} (${skill.files} files, ${skill.bytes} B)`)
    .join(", ");
  const lines = [`bundled: ${bundled}`];
  for (const target of report.targets) {
    const skills = Object.entries(target.skills)
      .map(([name, state]) => `${name}=${state}`)
      .join(", ");
    const legacyParts = [
      ...target.legacy.skills.map((name) => `${name} (dir)`),
      `mcp=${target.legacy.mcp}`,
    ];
    const legacy =
      target.legacy.skills.length > 0 || target.legacy.mcp !== "absent"
        ? `; legacy: ${legacyParts.join(", ")}`
        : "";
    lines.push(`${target.agent}/${target.scope}: ${skills}; mcp=${target.mcp}${legacy}`);
  }
  return lines;
}