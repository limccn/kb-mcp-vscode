import * as assert from "node:assert/strict";
import {
  buildAddArgs,
  buildListArgs,
  buildRemoveArgs,
  decodeCliOutput,
  runSkillsCli,
} from "../../mcp/skillsCli";

describe("skills CLI arguments", () => {
  it("builds a dry-run add command with the launcher path", () => {
    assert.deepEqual(
      buildAddArgs(["claude", "codex"], "global", {
        dryRun: true,
        mcpCommand: "C:\\tools\\hyseed.exe",
      }),
      [
        "skills",
        "add",
        "--agent",
        "claude",
        "--agent",
        "codex",
        "--scope",
        "global",
        "--dry-run",
        "--mcp-command",
        "C:\\tools\\hyseed.exe",
        "--json",
      ]
    );
  });

  it("adds --force only when requested", () => {
    const args = buildAddArgs(["cline"], "project", {
      force: true,
      mcpCommand: "hyseed.exe",
    });
    assert.ok(args.includes("--force"));
    assert.ok(!args.includes("--dry-run"));
    assert.equal(args.at(-1), "--json");
  });

  it("builds remove and list commands", () => {
    assert.deepEqual(buildRemoveArgs(["claude"], "global"), [
      "skills",
      "remove",
      "--agent",
      "claude",
      "--scope",
      "global",
      "--json",
    ]);
    assert.deepEqual(buildListArgs(), ["skills", "list", "--json"]);
  });
});

describe("skills CLI output decoding", () => {
  it("keeps valid UTF-8 output", () => {
    assert.equal(decodeCliOutput(Buffer.from("hyseed, version 0.9.0")), "hyseed, version 0.9.0");
    assert.equal(decodeCliOutput(Buffer.from("日本語", "utf8")), "日本語");
  });

  it("falls back to shift_jis for cp932 bytes", () => {
    // 日本語 in cp932.
    const cp932 = Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
    assert.equal(decodeCliOutput(cp932), "日本語");
  });
});

describe("skills CLI process runner", () => {
  it("returns rc and stdout from a real child process", async () => {
    const result = await runSkillsCli(
      process.execPath,
      ["-e", 'process.stdout.write(\'{"ok":true,"dry_run":true,"results":[]}\')'],
      { cwd: process.cwd(), env: process.env, timeoutMs: 10_000 }
    );
    assert.equal(result.rc, 0);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, dry_run: true, results: [] });
  });

  it("surfaces a non-zero exit code and stderr", async () => {
    const result = await runSkillsCli(
      process.execPath,
      ["-e", 'process.stderr.write("boom"); process.exit(3)'],
      { cwd: process.cwd(), env: process.env, timeoutMs: 10_000 }
    );
    assert.equal(result.rc, 3);
    assert.equal(result.stderr, "boom");
  });

  it("rejects when the child outlives the timeout", async () => {
    await assert.rejects(
      runSkillsCli(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 300,
      }),
      /timed out after 300 ms/
    );
  });
});