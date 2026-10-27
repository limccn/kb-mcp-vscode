import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  installSkillsFlow,
  removeSkillsFlow,
  showSkillsStateFlow,
  type SkillsDeps,
  type SkillsScope,
  type SkillsUi,
} from "../../mcp/flow";

interface RunCall {
  args: string[];
  cwd: string;
}

interface Output {
  stdout: string;
  rc?: number;
}

interface Recorded {
  confirms: { title: string; detail?: string }[];
  errors: string[];
  notes: string[];
  details: { title: string; lines: string[] }[];
}

function emptyRecord(): Recorded {
  return { confirms: [], errors: [], notes: [], details: [] };
}

function reportJson(actions: string[], dryRun: boolean): string {
  return JSON.stringify({
    ok: !actions.includes("conflict"),
    dry_run: dryRun,
    results: actions.map((action) => ({
      agent: "claude",
      scope: "global",
      kind: "skills:hyseed",
      target: "target",
      action,
      backup: null,
      note: action === "conflict" ? "rerun with --force" : null,
    })),
  });
}

function makeUi(
  script: { hosts?: string[]; scope?: SkillsScope; confirm?: boolean[] },
  record: Recorded
): SkillsUi {
  let confirmIndex = 0;
  return {
    async pickHosts() {
      return script.hosts;
    },
    async pickScope() {
      return script.scope;
    },
    async confirm(title, detail) {
      record.confirms.push({ title, detail });
      const value = script.confirm?.[confirmIndex] ?? true;
      confirmIndex += 1;
      return value;
    },
    notify(message) {
      record.notes.push(message);
    },
    error(message) {
      record.errors.push(message);
    },
    showDetails(title, lines) {
      record.details.push({ title, lines });
    },
  };
}

function makeDeps(outputs: Output[], runs: RunCall[]): SkillsDeps {
  let index = 0;
  return {
    resolveExe: async () => "C:\\bin\\hyseed.exe",
    workspaceRoot: () => "C:\\ws",
    async run(_exe, args, cwd) {
      runs.push({ args, cwd });
      const output = outputs[Math.min(index, outputs.length - 1)] ?? { stdout: "" };
      index += 1;
      return { rc: output.rc ?? 0, stdout: output.stdout, stderr: "" };
    },
    log() {},
  };
}

describe("install skills flow", () => {
  it("runs a dry-run preview, confirms, then installs", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    const deps = makeDeps(
      [{ stdout: reportJson(["created"], true) }, { stdout: reportJson(["created"], false) }],
      runs
    );
    await installSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global", confirm: [true] }, record),
      deps
    );
    assert.equal(runs.length, 2);
    assert.ok(runs[0].args.includes("--dry-run"));
    assert.ok(!runs[1].args.includes("--dry-run"));
    assert.ok(runs[0].args.includes("--mcp-command"));
    assert.equal(runs[0].cwd, "C:\\ws");
    assert.match(record.notes[0], /installed/);
    assert.equal(record.errors.length, 0);
  });

  it("makes no CLI calls when the host picker is cancelled", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await installSkillsFlow(makeUi({ hosts: undefined }, record), makeDeps([], runs));
    assert.equal(runs.length, 0);
  });

  it("stops after the preview when the confirmation is declined", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await installSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global", confirm: [false] }, record),
      makeDeps([{ stdout: reportJson(["created"], true) }], runs)
    );
    assert.equal(runs.length, 1);
    assert.equal(record.notes.length, 0);
  });

  it("asks for force on conflicts and reruns with --force", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await installSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global", confirm: [true] }, record),
      makeDeps(
        [{ stdout: reportJson(["conflict"], true) }, { stdout: reportJson(["created"], false) }],
        runs
      )
    );
    assert.match(record.confirms[0].title, /conflict/);
    assert.match(record.confirms[0].detail ?? "", /\.bak/);
    assert.ok(runs[1].args.includes("--force"));
  });

  it("refuses codex at project scope before spawning anything", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await installSkillsFlow(
      makeUi({ hosts: ["codex"], scope: "project" }, record),
      makeDeps([{ stdout: reportJson(["created"], true) }], runs)
    );
    assert.equal(runs.length, 0);
    assert.match(record.errors[0], /codex/);
  });

  it("surfaces unparsable preview output as an error", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await installSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global" }, record),
      makeDeps([{ stdout: "not json", rc: 1 }], runs)
    );
    assert.equal(runs.length, 1);
    assert.match(record.errors[0], /preview failed/);
  });
});

describe("remove skills flow", () => {
  it("confirms and then runs skills remove", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    await removeSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global", confirm: [true] }, record),
      makeDeps([{ stdout: reportJson(["removed"], false) }], runs)
    );
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].args.slice(0, 2), ["skills", "remove"]);
    assert.match(record.notes[0], /removed/);
  });

  it("does nothing when the confirmation is declined", async () => {
    const runs: RunCall[] = [];
    await removeSkillsFlow(
      makeUi({ hosts: ["claude"], scope: "global", confirm: [false] }, emptyRecord()),
      makeDeps([], runs)
    );
    assert.equal(runs.length, 0);
  });
});

describe("show skills state flow", () => {
  it("renders the captured host state", async () => {
    const runs: RunCall[] = [];
    const record = emptyRecord();
    const fixture = readFileSync("src/test/fixtures/skills-list-report.json", "utf8");
    await showSkillsStateFlow(
      makeUi({}, record),
      makeDeps([{ stdout: fixture }], runs)
    );
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].args, ["skills", "list", "--json"]);
    assert.equal(record.details.length, 1);
    assert.ok(record.details[0].lines.some((line) => line.startsWith("claude/global:")));
  });
});