import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  actionsSummary,
  hasConflicts,
  parseSkillsList,
  parseSkillsReport,
  renderResultLines,
  renderSkillsState,
  type SkillsReport,
} from "../../mcp/report";

const addFixture = readFileSync("src/test/fixtures/skills-add-report.json", "utf8");
const listFixture = readFileSync("src/test/fixtures/skills-list-report.json", "utf8");

describe("skills report parsing", () => {
  it("parses the captured skills add dry-run report", () => {
    const report = parseSkillsReport(addFixture);
    assert.ok(report);
    assert.equal(report.ok, true);
    assert.equal(report.dryRun, true);
    assert.equal(report.results.length, 3);
    assert.deepEqual(
      report.results.map((result) => result.kind),
      ["skills:hyseed", "skills:hyseed-manage", "mcp"]
    );
    assert.ok(report.results.every((result) => result.action === "created"));
    assert.ok(report.results[0].target.includes("<SANDBOX_HOME>"));
  });

  it("parses the captured skills list report", () => {
    const report = parseSkillsList(listFixture);
    assert.ok(report);
    assert.deepEqual(
      report.bundled.map((skill) => [skill.name, skill.files]),
      [
        ["hyseed", 4],
        ["hyseed-manage", 4],
      ]
    );
    const claudeProject = report.targets.find(
      (target) => target.agent === "claude" && target.scope === "project"
    );
    assert.equal(claudeProject?.mcp, "modified");
    const clineProject = report.targets.find(
      (target) => target.agent === "cline" && target.scope === "project"
    );
    assert.equal(clineProject?.mcpKind, "skip");
    assert.deepEqual(clineProject?.legacy, { skills: [], mcp: "n/a" });
  });

  it("rejects output that is not a skills report", () => {
    assert.equal(parseSkillsReport(""), null);
    assert.equal(parseSkillsReport("not json"), null);
    assert.equal(parseSkillsReport('{"ok":true}'), null);
    assert.equal(parseSkillsList('{"bundled":[]}'), null);
  });
});

describe("skills report rendering", () => {
  const conflictReport: SkillsReport = {
    ok: false,
    dryRun: true,
    results: [
      {
        agent: "claude",
        scope: "global",
        kind: "mcp",
        target: "C:\\home\\.claude.json",
        action: "conflict",
        backup: null,
        note: "existing 'hyseed' entry differs; rerun with --force to overwrite it",
      },
    ],
  };

  it("detects conflicts and summarizes actions", () => {
    assert.equal(hasConflicts(conflictReport), true);
    assert.equal(actionsSummary(conflictReport), "conflict: 1");
    const line = renderResultLines(conflictReport)[0];
    assert.match(line, /^conflict\s+claude\/global mcp/);
    assert.match(line, /--force/);
  });

  it("renders host state with the legacy column", () => {
    const report = parseSkillsList(listFixture);
    assert.ok(report);
    const lines = renderSkillsState(report);
    assert.match(lines[0], /hyseed \(4 files/);
    assert.ok(lines.some((line) => line.startsWith("claude/global:")));
    assert.ok(lines.some((line) => line.includes("mcp=modified")));
  });
});