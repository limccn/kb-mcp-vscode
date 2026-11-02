import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CliToolsReport, CliToolsStatus } from "../../cliTools";
import type { KbMcpConfig } from "../../config";
import { HomeCommandError, type HomeInspectJson } from "../../homeCli";
import type { MigrationState } from "../../migration";
import { createOnboardingActions, type OnboardingDeps, type OnboardingGate } from "../../onboarding/actions";
import { buildAddArgs, type CliRunResult } from "../../mcp/skillsCli";

type Notice = { level: "info" | "error"; message: string };

const READY: MigrationState = { kind: "ready", dataRoot: "C:\\sandbox-data" };
const FRESH: MigrationState = { kind: "fresh", dataRoot: "C:\\sandbox-data", candidates: [] };

const CONFIG: KbMcpConfig = {
  runtimePath: "",
  adminPort: 8899,
  adminHost: "127.0.0.1",
  mcpHost: "127.0.0.1",
  dataRoot: "C:\\sandbox-data",
  projectVault: "",
  converterPath: "",
};

const CLI_STATUS: CliToolsStatus = {
  targetDir: "C:\\Users\\me\\.local\\bin",
  tools: [
    { name: "hyseed.exe", state: "missing", target: "C:\\Users\\me\\.local\\bin\\hyseed.exe" },
    {
      name: "doc-convert.exe",
      state: "up-to-date",
      target: "C:\\Users\\me\\.local\\bin\\doc-convert.exe",
    },
  ],
  pathContainsTarget: false,
  pathHint: "C:\\Users\\me\\.local\\bin is not on PATH.",
};

const CLI_REPORT: CliToolsReport = {
  targetDir: "C:\\Users\\me\\.local\\bin",
  results: [
    {
      name: "hyseed.exe",
      action: "installed",
      target: "C:\\Users\\me\\.local\\bin\\hyseed.exe",
      leftover: null,
    },
    {
      name: "doc-convert.exe",
      action: "kept",
      target: "C:\\Users\\me\\.local\\bin\\doc-convert.exe",
      leftover: null,
    },
  ],
  pathContainsTarget: false,
  pathHint: "C:\\Users\\me\\.local\\bin is not on PATH.",
};

function ok(stdout = ""): CliRunResult {
  return { rc: 0, stdout, stderr: "" };
}

function skillsListJson(targets: unknown[] = []): string {
  return JSON.stringify({ bundled: [], targets });
}

function skillsTarget(agent: string, scope: string, legacy: { skills: string[]; mcp: string }) {
  return {
    agent,
    scope,
    skills_dir: "",
    mcp_file: null,
    mcp_kind: "",
    skills: {},
    mcp: "absent",
    legacy,
  };
}

function makeHarness() {
  const logLines: string[] = [];
  const notices: Notice[] = [];
  const setDataDirTargets: string[] = [];
  const runCalls: { exe: string; args: string[]; cwd: string }[] = [];
  const counts = {
    inspectCli: 0,
    installCli: 0,
    installMcp: 0,
    pick: 0,
    setDataDir: 0,
    ensureRunning: 0,
    confirm: 0,
    mark: 0,
    openSettings: 0,
  };
  const fixtures = {
    home: path.join(os.tmpdir(), "hyseed-onboarding-missing-home"),
    env: {} as NodeJS.ProcessEnv,
    config: CONFIG,
    settingDataRoot: "",
    cliStatus: CLI_STATUS,
    cliInspectError: null as Error | null,
    cliReport: CLI_REPORT,
    cliInstallError: null as Error | null,
    mcpInstallError: null as Error | null,
    inspect: (dataRoot: string): HomeInspectJson => ({
      ok: true,
      data_root: { path: dataRoot, source: "flag" },
      config_path: "",
      initialized: true,
      vaults: 2,
      current: "default",
      documents: 3,
      candidates: [],
    }),
    homeInspectError: null as Error | null,
    pick: "D:\\picked" as string | undefined,
    setDataDirError: null as Error | null,
    /** Simulate a redirect (KB_MCP_CONFIG) that keeps the effective root unchanged. */
    setDataDirKeepsConfig: false,
    ensureRunningError: null as Error | null,
    confirmAnswer: true,
    markError: null as Error | null,
    openSettingsError: null as Error | null,
  };
  const gate = {
    stateValue: READY as MigrationState,
    retryValue: READY as MigrationState,
    retried: 0,
    released: 0,
    retryError: null as Error | null,
  };
  const runImpl: { fn: (exe: string, args: string[]) => CliRunResult | Promise<CliRunResult> } = {
    fn: (_exe, args) => {
      if (args[0] === "skills" && args[1] === "list") return ok(skillsListJson());
      if (args[0] === "skills" && args[1] === "add") {
        return ok(
          JSON.stringify({
            ok: true,
            dry_run: false,
            results: [
              {
                agent: "cline",
                scope: "workspace",
                kind: "skills",
                target: "",
                action: "installed",
                backup: null,
                note: null,
              },
            ],
          })
        );
      }
      if (args[0] === "vault" && args[1] === "list") return ok("[]");
      if (args[0] === "vault" && args[1] === "create") {
        return ok(JSON.stringify({ name: args[2], path: `C:\\vaults\\${args[2]}` }));
      }
      return ok("{}");
    },
  };
  const gateImpl: OnboardingGate = {
    state: () => gate.stateValue,
    retry: async () => {
      gate.retried += 1;
      if (gate.retryError) throw gate.retryError;
      return gate.retryValue;
    },
    release: () => {
      gate.released += 1;
    },
  };
  const deps: OnboardingDeps = {
    version: "0.2.0",
    home: fixtures.home,
    env: fixtures.env,
    readConfig: () => fixtures.config,
    settingDataRoot: () => fixtures.settingDataRoot,
    resolveExe: async () => "C:\\tools\\hyseed.exe",
    run: async (exe, args, cwd) => {
      runCalls.push({ exe, args, cwd });
      return runImpl.fn(exe, args);
    },
    inspectHome: async (dataRoot) => {
      if (fixtures.homeInspectError) throw fixtures.homeInspectError;
      return fixtures.inspect(dataRoot);
    },
    setDataDir: async (target) => {
      counts.setDataDir += 1;
      setDataDirTargets.push(target);
      if (fixtures.setDataDirError) throw fixtures.setDataDirError;
      if (!fixtures.setDataDirKeepsConfig) {
        fixtures.config = { ...fixtures.config, dataRoot: target };
      }
      return { ok: true, data_dir: target };
    },
    installCliTools: async () => {
      counts.installCli += 1;
      if (fixtures.cliInstallError) throw fixtures.cliInstallError;
      return fixtures.cliReport;
    },
    inspectCliTools: async () => {
      counts.inspectCli += 1;
      if (fixtures.cliInspectError) throw fixtures.cliInspectError;
      return fixtures.cliStatus;
    },
    installAgentSkills: async () => {
      counts.installMcp += 1;
      if (fixtures.mcpInstallError) throw fixtures.mcpInstallError;
    },
    pickDataFolder: async () => {
      counts.pick += 1;
      return fixtures.pick;
    },
    openSettings: async () => {
      counts.openSettings += 1;
      if (fixtures.openSettingsError) throw fixtures.openSettingsError;
    },
    gate: gateImpl,
    ensureRunning: async () => {
      counts.ensureRunning += 1;
      if (fixtures.ensureRunningError) throw fixtures.ensureRunningError;
    },
    confirm: async () => {
      counts.confirm += 1;
      return fixtures.confirmAnswer;
    },
    notify: (level, message) => notices.push({ level, message }),
    log: (message) => logLines.push(message),
    markOnboarded: async () => {
      counts.mark += 1;
      if (fixtures.markError) throw fixtures.markError;
    },
  };
  const actions = createOnboardingActions(deps);
  return {
    deps,
    actions,
    fixtures,
    gate: gateImpl,
    gateControl: gate,
    counts,
    runImpl,
    runCalls,
    logLines,
    notices,
    setDataDirTargets,
  };
}

describe("collectState", () => {
  it("maps CLI tools, MCP targets/legacy entries, and home inspect data", async () => {
    const h = makeHarness();
    h.runImpl.fn = (exe, args) => {
      assert.equal(exe, "C:\\tools\\hyseed.exe");
      if (args[0] === "skills" && args[1] === "list") {
        return ok(
          skillsListJson([
            skillsTarget("claude", "user", { skills: [], mcp: "absent" }),
            skillsTarget("cline", "workspace", {
              skills: ["kb-usage", "kb-manage"],
              mcp: "present",
            }),
          ])
        );
      }
      return ok("{}");
    };

    const state = await h.actions.collectState();

    assert.equal(state.version, "0.2.0");
    assert.equal(state.cli.status, "ready");
    assert.deepEqual(state.cli.tools, [
      { name: "hyseed.exe", state: "missing" },
      { name: "doc-convert.exe", state: "up-to-date" },
    ]);
    assert.equal(state.cli.pathContainsTarget, false);
    assert.equal(state.mcp.status, "ready");
    assert.equal(state.mcp.targets.length, 2);
    assert.deepEqual(state.mcp.legacy, [
      {
        agent: "cline",
        scope: "workspace",
        skills: ["kb-usage", "kb-manage"],
        mcp: "present",
      },
    ]);
    assert.equal(state.data.status, "ready");
    assert.equal(state.data.dataRoot, "C:\\sandbox-data");
    assert.equal(state.data.initialized, true);
    assert.equal(state.data.vaults, 2);
    assert.equal(state.data.pinnedBy, null);
    assert.deepEqual(h.notices, [], "collecting state never notifies");
    assert.deepEqual(
      h.runCalls.map((call) => call.args.join(" ")),
      ["skills list --json"]
    );
  });

  it("degrades an unreadable CLI tool state to 'unavailable'", async () => {
    const h = makeHarness();
    h.fixtures.cliInspectError = new Error("disk on fire");
    const state = await h.actions.collectState();
    assert.equal(state.cli.status, "unavailable");
    assert.equal(state.cli.message, "disk on fire");
    assert.deepEqual(state.cli.tools, []);
    assert.equal(state.mcp.status, "ready", "one failure must not poison the other steps");
    assert.equal(state.data.status, "ready");
  });

  it("degrades a failed 'skills list' to an unavailable MCP step", async () => {
    const h = makeHarness();
    h.runImpl.fn = (_exe, args) =>
      args[0] === "skills" ? { rc: 2, stdout: "", stderr: "boom" } : ok("{}");
    const state = await h.actions.collectState();
    assert.equal(state.mcp.status, "unavailable");
    assert.match(state.mcp.message ?? "", /skills list failed \(rc=2\): boom/);
    assert.deepEqual(state.mcp.targets, []);
  });

  it("explains a runtime without the 'home' command", async () => {
    const h = makeHarness();
    h.fixtures.homeInspectError = new HomeCommandError("hyseed home inspect failed (rc 2)", {
      rc: 2,
      code: 2,
      stage: null,
      unsupported: true,
      stdout: "",
      stderr: "No such command 'home'.",
    });
    const state = await h.actions.collectState();
    assert.equal(state.data.status, "unavailable");
    assert.match(state.data.message ?? "", /has no 'home' command; install CLI tools first/);
    assert.equal(state.data.dataRoot, "C:\\sandbox-data", "the effective root is still shown");
  });

  it("keeps a plain inspect failure as its own message", async () => {
    const h = makeHarness();
    h.fixtures.homeInspectError = new Error("home exploded");
    const state = await h.actions.collectState();
    assert.equal(state.data.status, "unavailable");
    assert.equal(state.data.message, "home exploded");
  });

  it("shows config.yaml data_dir and the pin precedence", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-onboarding-"));
    try {
      fs.mkdirSync(path.join(home, ".config", "hyseed"), { recursive: true });
      fs.writeFileSync(path.join(home, ".config", "hyseed", "config.yaml"), "data_dir: ~/kb-data\n");

      const h = makeHarness();
      h.deps.home = home;
      let state = await h.actions.collectState();
      assert.equal(state.data.configDataDir, path.join(home, "kb-data"));
      assert.equal(state.data.pinnedBy, null);

      h.deps.env = { KB_MCP_HOME: "E:\\env-root" };
      state = await h.actions.collectState();
      assert.equal(state.data.pinnedBy, "env");

      h.fixtures.settingDataRoot = "D:\\setting-root";
      state = await h.actions.collectState();
      assert.equal(state.data.pinnedBy, "setting", "the setting wins over the env pin");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("runCliStep", () => {
  it("installs, reports counts and leftovers, then retries the gate", async () => {
    const h = makeHarness();
    h.fixtures.cliReport = {
      ...CLI_REPORT,
      results: [
        { name: "hyseed.exe", action: "installed", target: "", leftover: null },
        {
          name: "doc-convert.exe",
          action: "replaced",
          target: "",
          leftover: "C:\\bin\\.doc-convert.exe.old-1",
        },
      ],
    };
    await h.actions.runCliStep();
    assert.equal(h.counts.installCli, 1);
    assert.equal(h.gateControl.retried, 1);
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].level, "info");
    assert.match(h.notices[0].message, /installed 1, replaced 1, kept 0/);
    assert.match(h.notices[0].message, /Leftovers: C:\\bin\\\.doc-convert\.exe\.old-1/);
  });

  it("does not reopen a deferred migration prompt", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = {
      kind: "pending",
      dataRoot: "C:\\sandbox-data",
      candidates: [],
      reason: "not-now",
    };
    await h.actions.runCliStep();
    assert.equal(h.counts.installCli, 1);
    assert.equal(h.gateControl.retried, 0);
    assert.ok(h.logLines.some((line) => /migration is deferred/.test(line)));
  });

  it("degrades a failed install to an error notice", async () => {
    const h = makeHarness();
    h.fixtures.cliInstallError = new Error("copy failed");
    await h.actions.runCliStep();
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /install CLI tools failed: copy failed/);
    assert.equal(h.gateControl.retried, 0);
  });
});

describe("runMcpStep", () => {
  it("delegates to the existing skills flow", async () => {
    const h = makeHarness();
    await h.actions.runMcpStep();
    assert.equal(h.counts.installMcp, 1);
    assert.ok(h.logLines.some((line) => /agent skills flow finished/.test(line)));
  });

  it("degrades a failed flow to an error notice", async () => {
    const h = makeHarness();
    h.fixtures.mcpInstallError = new Error("prompts closed");
    await h.actions.runMcpStep();
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /install MCP & skills failed: prompts closed/);
  });
});

describe("chooseDataDir", () => {
  it("refuses to change a folder pinned by the setting", async () => {
    const h = makeHarness();
    h.fixtures.settingDataRoot = "D:\\pinned";
    await h.actions.chooseDataDir();
    assert.equal(h.counts.pick, 0);
    assert.equal(h.counts.setDataDir, 0);
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /'kbMcp\.dataRoot' setting overrides the data folder/);
  });

  it("refuses to change a folder pinned by KB_MCP_HOME", async () => {
    const h = makeHarness();
    h.deps.env = { KB_MCP_HOME: "E:\\pinned" };
    await h.actions.chooseDataDir();
    assert.equal(h.counts.pick, 0);
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /KB_MCP_HOME variable overrides the data folder/);
  });

  it("persists the picked folder, releases the gate, and restarts", async () => {
    const h = makeHarness();
    h.fixtures.pick = "D:\\New Data";
    await h.actions.chooseDataDir();
    assert.deepEqual(h.setDataDirTargets, ["D:\\New Data"]);
    assert.equal(h.gateControl.released, 1);
    assert.equal(h.counts.ensureRunning, 1);
    assert.equal(h.notices[0].level, "info");
    assert.match(h.notices[0].message, /data folder set to D:\\New Data/);
  });

  it("does nothing when the folder picker is cancelled", async () => {
    const h = makeHarness();
    h.fixtures.pick = undefined;
    await h.actions.chooseDataDir();
    assert.equal(h.counts.setDataDir, 0);
    assert.equal(h.gateControl.released, 0);
    assert.deepEqual(h.notices, []);
  });

  it("degrades a failed set-data-dir to an error notice", async () => {
    const h = makeHarness();
    h.fixtures.setDataDirError = new Error("permission denied");
    await h.actions.chooseDataDir();
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /could not set the data folder: permission denied/);
    assert.equal(h.gateControl.released, 0);
  });

  it("does not claim success when the effective root still points elsewhere", async () => {
    const h = makeHarness();
    h.fixtures.pick = "D:\\New Data";
    // A KB_MCP_CONFIG redirect can make the CLI write a config the extension
    // does not read: mirror MigrationGate.useRoot and refuse the false success.
    h.fixtures.setDataDirKeepsConfig = true;
    await h.actions.chooseDataDir();
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /still resolves C:\\sandbox-data/);
    assert.equal(h.gateControl.released, 0);
    assert.equal(h.counts.ensureRunning, 0);
  });

  it("keeps the success notice when the server restart fails", async () => {
    const h = makeHarness();
    h.fixtures.ensureRunningError = new Error("port busy");
    await h.actions.chooseDataDir();
    assert.equal(h.notices[0].level, "info");
    assert.ok(h.logLines.some((line) => /could not start the server.*port busy/.test(line)));
  });
});

describe("reviewMigration", () => {
  async function review(state: MigrationState) {
    const h = makeHarness();
    h.gateControl.retryValue = state;
    await h.actions.reviewMigration();
    assert.equal(h.notices.length, 1);
    return h.notices[0];
  }

  it("reports each settled state as a visible notice", async () => {
    let notice = await review(READY);
    assert.equal(notice.level, "info");
    assert.match(notice.message, /data folder is ready: C:\\sandbox-data/);

    notice = await review(FRESH);
    assert.equal(notice.level, "info");
    assert.match(notice.message, /no legacy data was found; using C:\\sandbox-data/);

    notice = await review({
      kind: "pending",
      dataRoot: "C:\\sandbox-data",
      candidates: [],
      reason: "not-now",
    });
    assert.equal(notice.level, "info");
    assert.match(notice.message, /still pending \(not-now\)/);

    notice = await review({ kind: "error", dataRoot: "C:\\sandbox-data", message: "boom" });
    assert.equal(notice.level, "error");
    assert.match(notice.message, /data folder check failed: boom/);

    notice = await review({ kind: "checking", dataRoot: "C:\\sandbox-data" });
    assert.equal(notice.level, "info");
    assert.match(notice.message, /data folder check: checking/);
  });

  it("turns a thrown retry into an error notice", async () => {
    const h = makeHarness();
    h.gateControl.retryError = new Error("gate boom");
    await h.actions.reviewMigration();
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /data folder check failed: gate boom/);
  });
});

describe("cleanupLegacyMcp", () => {
  function withLegacy(h: ReturnType<typeof makeHarness>) {
    h.runImpl.fn = (_exe, args) => {
      if (args[0] === "skills" && args[1] === "list") {
        return ok(
          skillsListJson([
            skillsTarget("cline", "workspace", { skills: ["kb-usage"], mcp: "present" }),
          ])
        );
      }
      if (args[0] === "skills" && args[1] === "add") {
        return ok(
          JSON.stringify({
            ok: true,
            dry_run: false,
            results: [
              {
                agent: "cline",
                scope: "workspace",
                kind: "skills",
                target: "",
                action: "installed",
                backup: null,
                note: null,
              },
            ],
          })
        );
      }
      return ok("{}");
    };
  }

  it("says so when no pre-rename entries exist", async () => {
    const h = makeHarness();
    await h.actions.cleanupLegacyMcp();
    assert.equal(h.counts.confirm, 0);
    assert.equal(h.notices[0].level, "info");
    assert.match(h.notices[0].message, /no pre-rename kb\/kb-manage entries were found/);
  });

  it("asks before rewriting entries and stops on cancel", async () => {
    const h = makeHarness();
    withLegacy(h);
    h.fixtures.confirmAnswer = false;
    await h.actions.cleanupLegacyMcp();
    assert.equal(h.counts.confirm, 1);
    assert.ok(!h.runCalls.some((call) => call.args[0] === "skills" && call.args[1] === "add"));
  });

  it("reinstalls with --force, the only supported writer", async () => {
    const h = makeHarness();
    withLegacy(h);
    await h.actions.cleanupLegacyMcp();
    const addCall = h.runCalls.find((call) => call.args[0] === "skills" && call.args[1] === "add");
    assert.ok(addCall, "skills add was never called");
    assert.deepEqual(
      addCall.args,
      buildAddArgs(["cline"], "workspace", { force: true, mcpCommand: "C:\\tools\\hyseed.exe" })
    );
    assert.equal(addCall.cwd, h.deps.home);
    assert.equal(h.notices[0].level, "info");
    assert.match(h.notices[0].message, /old entries cleaned up in 1 host\/scope target/);
  });

  it("reports a failed add per target without throwing", async () => {
    const h = makeHarness();
    withLegacy(h);
    h.runImpl.fn = (_exe, args) => {
      if (args[0] === "skills" && args[1] === "list") {
        return ok(
          skillsListJson([
            skillsTarget("cline", "workspace", { skills: ["kb-usage"], mcp: "present" }),
          ])
        );
      }
      if (args[0] === "skills" && args[1] === "add") return { rc: 1, stdout: "", stderr: "nope" };
      return ok("{}");
    };
    await h.actions.cleanupLegacyMcp();
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /could not clean up cline\/workspace/);
  });

  it("reports an unavailable skills list instead of pretending to clean", async () => {
    const h = makeHarness();
    h.runImpl.fn = (_exe, args) =>
      args[0] === "skills" ? { rc: 3, stdout: "", stderr: "no runtime" } : ok("{}");
    await h.actions.cleanupLegacyMcp();
    assert.equal(h.notices[0].level, "error");
    assert.match(h.notices[0].message, /skills list failed \(rc=3\): no runtime/);
  });
});

describe("finish defaults", () => {
  it("persists the root and registers the default vault on a fresh root", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    await h.actions.finish(false, { cli: false, mcp: false });
    assert.deepEqual(h.setDataDirTargets, ["C:\\sandbox-data"]);
    const commands = h.runCalls.map((call) => call.args.join(" "));
    assert.ok(commands.includes("vault list --json"));
    assert.ok(commands.includes("vault create default --json"));
    assert.equal(h.counts.mark, 1);
    assert.ok(h.logLines.some((line) => /marked onboarded/.test(line)));
    assert.equal(h.counts.installCli, 0, "finish only installs the selected steps");
    assert.equal(h.counts.installMcp, 0);
  });

  it("runs the selected install steps before applying defaults", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = READY;
    await h.actions.finish(false, { cli: true, mcp: false });
    assert.equal(h.counts.installCli, 1);
    assert.equal(h.counts.installMcp, 0);
    assert.equal(h.counts.mark, 1);
  });

  it("persists data_dir but never creates a vault while migration is unresolved", async () => {
    const states: MigrationState[] = [
      { kind: "checking", dataRoot: "C:\\sandbox-data" },
      { kind: "no-data", dataRoot: "C:\\sandbox-data", candidates: [] },
      {
        kind: "pending",
        dataRoot: "C:\\sandbox-data",
        candidates: [],
        reason: "migration-failed",
      },
      { kind: "error", dataRoot: "C:\\sandbox-data", message: "boom" },
    ];
    for (const state of states) {
      const h = makeHarness();
      h.gateControl.stateValue = state;
      await h.actions.finish(true, { cli: true, mcp: true });
      // R6/AC-1: the default root is persisted even when detection failed;
      // writing data_dir never initialises the root, so it cannot mask a
      // future migration.
      assert.deepEqual(
        h.setDataDirTargets,
        ["C:\\sandbox-data"],
        `${state.kind} must still persist the default data folder`
      );
      assert.ok(
        !h.runCalls.some((call) => call.args[0] === "vault"),
        `${state.kind} must not create a vault (migration target would become non-empty)`
      );
      assert.equal(h.counts.mark, 1, `${state.kind} still marks the guide as seen`);
      assert.ok(h.logLines.some((line) => /default vault deferred/.test(line)));
    }
  });

  it("never writes config.yaml when a setting or env pin owns the root", async () => {
    for (const pin of ["setting", "env"] as const) {
      const h = makeHarness();
      h.gateControl.stateValue = FRESH;
      if (pin === "setting") h.fixtures.settingDataRoot = "D:\\pinned";
      else h.deps.env = { KB_MCP_HOME: "E:\\pinned" };
      await h.actions.finish(true, { cli: false, mcp: false });
      assert.deepEqual(h.setDataDirTargets, []);
      assert.ok(h.runCalls.some((call) => call.args.join(" ") === "vault list --json"));
      assert.ok(h.logLines.some((line) => new RegExp(`pinned by ${pin}`).test(line)));
      assert.equal(h.counts.mark, 1);
    }
  });

  it("does not create a vault when one already exists", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    h.runImpl.fn = (_exe, args) => {
      if (args[0] === "vault" && args[1] === "list") {
        return ok(JSON.stringify([{ name: "default", path: "C:\\sandbox-data\\default" }]));
      }
      if (args[0] === "vault" && args[1] === "create") return ok("{}");
      return ok("{}");
    };
    await h.actions.finish(true, { cli: false, mcp: false });
    assert.ok(!h.runCalls.some((call) => call.args.join(" ") === "vault create default --json"));
  });

  it("treats an 'already exists' create failure as success", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    h.runImpl.fn = (_exe, args) => {
      if (args[0] === "vault" && args[1] === "list") return ok("[]");
      if (args[0] === "vault" && args[1] === "create") {
        return { rc: 4, stdout: "", stderr: "vault 'default' already exists" };
      }
      return ok("{}");
    };
    await h.actions.finish(true, { cli: false, mcp: false });
    assert.ok(!h.logLines.some((line) => /could not create the 'default' vault/.test(line)));
    assert.equal(h.counts.mark, 1);
  });

  it("logs (never throws) when config persistence or marking fails", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    h.fixtures.setDataDirError = new Error("config locked");
    h.fixtures.markError = new Error("state full");
    await h.actions.finish(true, { cli: false, mcp: false });
    assert.ok(h.logLines.some((line) => /could not persist the default data folder: config locked/.test(line)));
    assert.ok(h.logLines.some((line) => /could not record the onboarded version: state full/.test(line)));
    assert.ok(h.runCalls.some((call) => call.args.join(" ") === "vault list --json"));
  });

  it("still marks the guide as seen when the runtime cannot be resolved", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    h.deps.resolveExe = async () => {
      throw new Error("no runtime");
    };
    await h.actions.finish(true, { cli: false, mcp: false });
    assert.equal(h.counts.mark, 1);
    assert.ok(h.logLines.some((line) => /could not prepare the default vault: no runtime/.test(line)));
  });

  it("applies defaults once when close races finish", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    await Promise.all([
      h.actions.finish(true, { cli: false, mcp: false }),
      h.actions.handleClosed(),
    ]);
    assert.equal(h.counts.setDataDir, 1);
    assert.equal(h.counts.mark, 1);
  });

  it("applies defaults once when the tab closes during a finish install", async () => {
    const h = makeHarness();
    h.gateControl.stateValue = FRESH;
    let releaseInstall!: () => void;
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    h.deps.installCliTools = async () => {
      h.counts.installCli += 1;
      await installGate;
      return CLI_REPORT;
    };
    const finishing = h.actions.finish(false, { cli: true, mcp: false });
    const closing = h.actions.handleClosed();
    releaseInstall();
    await Promise.all([finishing, closing]);
    assert.equal(h.counts.installCli, 1);
    assert.equal(h.counts.setDataDir, 1);
    assert.equal(h.counts.mark, 1);
  });

  it("degrades a failed settings command to a log line", async () => {
    const h = makeHarness();
    h.fixtures.openSettingsError = new Error("no settings");
    await h.actions.openSettings();
    assert.equal(h.counts.openSettings, 1);
    assert.ok(h.logLines.some((line) => /could not open settings: no settings/.test(line)));
    assert.deepEqual(h.notices, []);
  });
});