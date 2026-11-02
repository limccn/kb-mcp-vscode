import * as assert from "node:assert/strict";
import {
  HOME_INSPECT_TIMEOUT_MS,
  HOME_MIGRATE_TIMEOUT_MS,
  HomeCommandError,
  cleanHomeEnv,
  inspectHome,
  isUnsupportedHomeOutput,
  migrateHome,
  parseJsonOutput,
  setDataDir,
  type HomeRunner,
} from "../../homeCli";
import type { CliRunOptions, CliRunResult } from "../../mcp/skillsCli";

interface Call {
  exe: string;
  args: string[];
  opts: CliRunOptions;
}

function fakeRun(output: { rc?: number; stdout?: string; stderr?: string }): {
  run: HomeRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: HomeRunner = async (_exe, args, opts) => {
    calls.push({ exe: _exe, args, opts });
    const result: CliRunResult = {
      rc: output.rc ?? 0,
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
    };
    return result;
  };
  return { run, calls };
}

const INSPECT_JSON = JSON.stringify(
  {
    ok: true,
    data_root: { path: "C:\\new", source: "config" },
    config_path: "C:\\home\\.config\\hyseed\\config.yaml",
    initialized: false,
    vaults: 0,
    current: null,
    documents: null,
    candidates: [
      {
        path: "C:\\old",
        kind: "legacy_home",
        vaults: 2,
        current: "default",
        documents: 42,
        db_bytes: 1234,
        modified_at: "2026-10-30T10:00:00",
      },
    ],
  },
  null,
  2
);

describe("home CLI output parsing", () => {
  it("parses the whole pretty-printed stdout, not just the last line", () => {
    const parsed = parseJsonOutput(`\n${INSPECT_JSON}\n`) as { ok: boolean };
    assert.equal(parsed.ok, true);
    assert.equal(parseJsonOutput(""), null);
    assert.equal(parseJsonOutput("not json"), null);
  });

  it("only an old runtime's usage answer counts as unsupported", () => {
    assert.equal(
      isUnsupportedHomeOutput(2, "", "Error: No such command 'home'."),
      true
    );
    assert.equal(
      isUnsupportedHomeOutput(2, "", "Usage: hyseed [OPTIONS] COMMAND [ARGS]..."),
      true
    );
    assert.equal(isUnsupportedHomeOutput(2, INSPECT_JSON, ""), false);
    assert.equal(isUnsupportedHomeOutput(1, "", "Error: boom"), false);
  });

  it("cleans inherited root/vault overrides before every call", () => {
    const env = cleanHomeEnv({ KB_MCP_HOME: "C:\\parent", KB_MCP_VAULT: "old", PATH: "x" });
    assert.equal(env.KB_MCP_HOME, undefined);
    assert.equal(env.KB_MCP_VAULT, undefined);
    assert.equal(env.PATH, "x");
    assert.equal(cleanHomeEnv({ KB_MCP_HOME: "a" }, "C:\\pinned").KB_MCP_HOME, "C:\\pinned");
  });
});

describe("home CLI commands", () => {
  it("inspects with KB_MCP_HOME pinned to the resolved root", async () => {
    const { run, calls } = fakeRun({ stdout: INSPECT_JSON });
    const report = await inspectHome("C:\\bin\\hyseed.exe", "C:\\new", { run });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["home", "inspect", "--json"]);
    assert.equal(calls[0].opts.env?.KB_MCP_HOME, "C:\\new");
    assert.equal(calls[0].opts.timeoutMs, HOME_INSPECT_TIMEOUT_MS);
    assert.equal(report.initialized, false);
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0].path, "C:\\old");
  });

  it("migrates without inheriting KB_MCP_HOME", async () => {
    const { run, calls } = fakeRun({
      stdout: JSON.stringify({
        ok: true,
        mode: "move",
        from: "C:\\old",
        to: "C:\\new",
        vaults: 2,
        documents: 42,
        removed_source: true,
        warnings: [],
      }),
    });
    const result = await migrateHome("C:\\bin\\hyseed.exe", "C:\\old", "C:\\new", {
      run,
      env: { KB_MCP_HOME: "C:\\parent", KB_MCP_VAULT: "old" },
    });
    assert.deepEqual(calls[0].args, [
      "home",
      "migrate",
      "--from",
      "C:\\old",
      "--to",
      "C:\\new",
      "--json",
    ]);
    assert.equal(calls[0].opts.env?.KB_MCP_HOME, undefined);
    assert.equal(calls[0].opts.env?.KB_MCP_VAULT, undefined);
    assert.equal(calls[0].opts.timeoutMs, HOME_MIGRATE_TIMEOUT_MS);
    assert.equal(result.mode, "move");
    assert.equal(result.vaults, 2);
  });

  it("persists a data folder through set-data-dir without inheriting KB_MCP_HOME", async () => {
    const { run, calls } = fakeRun({
      stdout: JSON.stringify({ ok: true, data_dir: "C:\\old", config_path: "C:\\cfg" }),
    });
    const result = await setDataDir("C:\\bin\\hyseed.exe", "C:\\old", {
      run,
      env: { KB_MCP_HOME: "C:\\real-root", KB_MCP_VAULT: "real" },
    });
    assert.deepEqual(calls[0].args, ["home", "set-data-dir", "C:\\old", "--json"]);
    // A production-home KB_MCP_HOME must never reach the writer: the runtime has to
    // resolve the real config, and the user's actual root changes only via the config.
    assert.equal(calls[0].opts.env?.KB_MCP_HOME, undefined);
    assert.equal(calls[0].opts.env?.KB_MCP_VAULT, undefined);
    assert.equal(result.data_dir, "C:\\old");
  });

  it("surfaces the structured conflict code from a failed migrate", async () => {
    const { run } = fakeRun({
      rc: 4,
      stdout: JSON.stringify({
        ok: false,
        code: 4,
        stage: "conflict",
        error: "target already holds data",
        from: "C:\\old",
        to: "C:\\new",
      }),
    });
    await assert.rejects(
      migrateHome("C:\\bin\\hyseed.exe", "C:\\old", "C:\\new", { run }),
      (err: unknown) =>
        err instanceof HomeCommandError &&
        err.details.code === 4 &&
        err.details.stage === "conflict" &&
        err.message.includes("target already holds data")
    );
  });

  it("flags an old runtime that has no home command group", async () => {
    const { run } = fakeRun({ rc: 2, stderr: "Error: No such command 'home'." });
    await assert.rejects(
      inspectHome("C:\\bin\\hyseed.exe", "C:\\new", { run }),
      (err: unknown) => err instanceof HomeCommandError && err.details.unsupported
    );
  });

  it("rejects a payload without the inspect fields", async () => {
    const { run } = fakeRun({ stdout: JSON.stringify({ ok: true, data_root: {} }) });
    await assert.rejects(
      inspectHome("C:\\bin\\hyseed.exe", "C:\\new", { run }),
      (err: unknown) => err instanceof HomeCommandError && err.details.stage === "parse"
    );
  });
});