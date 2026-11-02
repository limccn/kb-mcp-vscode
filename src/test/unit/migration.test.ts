import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HomeCommandError, type HomeInspectJson } from "../../homeCli";
import {
  MigrationGate,
  VERSION_STATE_KEY,
  isInitialized,
  mergeCandidates,
  pathKey,
  recordVersionState,
  scanExtensionDataDirs,
  type LegacyCandidate,
  type MigrationDecision,
  type MigrationGateDeps,
  type MigrationState,
  type VersionMemento,
} from "../../migration";

function candidate(overrides: Partial<LegacyCandidate> = {}): LegacyCandidate {
  return {
    path: "C:\\old",
    kind: "legacy_home",
    vaults: 2,
    documents: 10,
    modifiedAt: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function inspectJson(overrides: Partial<HomeInspectJson> = {}): HomeInspectJson {
  return {
    ok: true,
    data_root: { path: "C:\\new", source: "default" },
    config_path: "C:\\home\\.config\\hyseed\\config.yaml",
    initialized: false,
    vaults: 0,
    current: null,
    documents: null,
    candidates: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<MigrationGateDeps> = {}) {
  const log: string[] = [];
  const changes: string[] = [];
  const states: MigrationState[] = [];
  const errors: string[] = [];
  const migrated: string[][] = [];
  const persisted: string[] = [];
  // Production re-reads config.yaml after every write; the harness mirrors that
  // so a resolved root follows `set-data-dir` unless a test pins it.
  let currentRoot = "C:\\new";
  const deps: MigrationGateDeps = {
    dataRoot: () => currentRoot,
    inspect: async () => inspectJson(),
    scanExtensionDataDirs: () => [],
    isInitialized: () => false,
    decide: async () => ({ action: "not-now" }),
    migrate: async (from, to) => {
      migrated.push([from, to]);
      return {
        ok: true,
        mode: "move",
        from,
        to,
        vaults: 2,
        documents: 10,
        removed_source: true,
        warnings: [],
      };
    },
    setDataDir: async (target) => {
      persisted.push(target);
      currentRoot = target;
      return { ok: true, data_dir: target, config_path: "C:\\cfg" };
    },
    log: (message) => log.push(message),
    notifyError: (message) => errors.push(message),
    onState: (state) => states.push(state),
    onDataRootChanged: (target) => changes.push(target),
    ...overrides,
  };
  return { deps, log, changes, states, errors, migrated, persisted };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the promise settled within the budget (the gate must not hang). */
function settles(promise: Promise<unknown>, ms = 200): Promise<boolean> {
  return Promise.race([promise.then(() => true), delay(ms).then(() => false)]);
}

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kbmcp-migration-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isInitialized", () => {
  it("recognises a registry, a root database, and per-vault databases", () => {
    const vaults = tmpDir();
    writeFileSync(path.join(vaults, "vaults.json"), "[]", "utf8");
    const rootDb = tmpDir();
    writeFileSync(path.join(rootDb, "kb.db"), "", "utf8");
    const perVault = tmpDir();
    mkdirSync(path.join(perVault, "demo"));
    writeFileSync(path.join(perVault, "demo", "kb.db"), "", "utf8");
    const empty = tmpDir();

    assert.equal(isInitialized(vaults), true);
    assert.equal(isInitialized(rootDb), true);
    assert.equal(isInitialized(perVault), true);
    assert.equal(isInitialized(empty), false);
    assert.equal(isInitialized(path.join(empty, "missing")), false);
  });
});

describe("pathKey", () => {
  it("normalises separators, trailing slashes, and Windows case", () => {
    assert.equal(pathKey("C:\\Old\\", "win32"), "c:/old");
    assert.equal(pathKey("C:/old", "win32"), "c:/old");
    assert.equal(pathKey("/Data/", "linux"), "/Data");
    assert.equal(pathKey("", "linux"), "/");
  });
});

describe("mergeCandidates", () => {
  it("drops the current root and dedupes case-insensitively", () => {
    const merged = mergeCandidates("C:\\New", [
      [
        candidate({ path: "c:/new" }),
        candidate({ path: "C:\\old", vaults: 1, documents: null, modifiedAt: null }),
      ],
      [candidate({ path: "C:\\OLD\\", vaults: 5 })],
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].vaults, 5, "the candidate with document counts should win");
  });

  it("sorts newest first, then by vault count and path", () => {
    const merged = mergeCandidates("C:\\new", [
      [
        candidate({ path: "C:\\a", modifiedAt: "2026-01-01T00:00:00.000Z", vaults: 9 }),
        candidate({ path: "C:\\b", modifiedAt: "2026-10-01T00:00:00.000Z", vaults: 1 }),
        candidate({ path: "C:\\c", modifiedAt: "2026-10-01T00:00:00.000Z", vaults: 3 }),
      ],
    ]);
    assert.deepEqual(
      merged.map((entry) => entry.path),
      ["C:\\c", "C:\\b", "C:\\a"]
    );
  });
});

describe("scanExtensionDataDirs", () => {
  it("finds resources/data and data folders, including .obsolete leftovers", () => {
    const home = tmpDir();
    const extensions = path.join(home, ".vscode", "extensions");
    const write = (rel: string, file: string, text: string) => {
      const file_path = path.join(extensions, rel, file);
      mkdirSync(path.dirname(file_path), { recursive: true });
      writeFileSync(file_path, text, "utf8");
    };
    write("limccn.kbmcp-vscode-0.1.2/resources/data", "vaults.json", '["a","b"]');
    write("limccn.kbmcp-vscode-0.1.3/data", "kb.db", "");
    write("limccn.kbmcp-vscode-0.1.1/data", "kb.db", "");
    write("other.extension-1.0.0/data", "vaults.json", "[]");
    mkdirSync(path.join(extensions, "limccn.kbmcp-vscode-0.1.4"), { recursive: true });
    writeFileSync(
      path.join(extensions, ".obsolete"),
      JSON.stringify({ "limccn.kbmcp-vscode-0.1.1": true }),
      "utf8"
    );

    const found = scanExtensionDataDirs({ home });
    const paths = found.map((entry) => entry.path.toLowerCase());
    assert.equal(found.length, 3);
    assert.ok(paths.some((entry) => entry.includes("0.1.1")));
    assert.ok(paths.some((entry) => entry.includes("0.1.2")));
    assert.ok(paths.some((entry) => entry.includes("0.1.3")));
    assert.ok(!paths.some((entry) => entry.includes("other.extension")));
    assert.ok(!paths.some((entry) => entry.includes("0.1.4")));
    const rescued = found.find((entry) => entry.path.includes("0.1.2"));
    assert.equal(rescued?.vaults, 2);
    assert.equal(rescued?.kind, "extension_data");
  });

  it("returns nothing when the extensions root is missing", () => {
    assert.deepEqual(scanExtensionDataDirs({ home: tmpDir() }), []);
  });
});

describe("MigrationGate", () => {
  it("lets startup pass when the current root already holds data", async () => {
    let inspected = false;
    const { deps } = makeDeps({
      isInitialized: () => true,
      inspect: async () => {
        inspected = true;
        return inspectJson();
      },
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "ready");
    assert.equal(inspected, false);
    assert.equal(await settles(gate.wait()), true);
  });

  it("treats an initialised inspect report as ready", async () => {
    const { deps } = makeDeps({ inspect: async () => inspectJson({ initialized: true, vaults: 1 }) });
    const gate = new MigrationGate(deps);
    assert.equal((await gate.decide()).kind, "ready");
    assert.equal(await settles(gate.wait()), true);
  });

  it("starts normally on a fresh install", async () => {
    const { deps } = makeDeps();
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "fresh");
    assert.equal(await settles(gate.wait()), true);
  });

  it("migrates the chosen legacy root after confirmation", async () => {
    const { deps, migrated, changes } = makeDeps({
      inspect: async () => inspectJson({ candidates: [] }),
      scanExtensionDataDirs: () => [candidate({ path: "C:\\old", kind: "extension_data" })],
      decide: async () => ({ action: "migrate", candidate: candidate({ path: "C:\\old" }) }),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "ready");
    assert.deepEqual(migrated, [["C:\\old", "C:\\new"]]);
    assert.deepEqual(changes, ["C:\\new"]);
    assert.equal(await settles(gate.wait()), true);
  });

  it("switches to an existing folder through set-data-dir", async () => {
    const { deps, persisted, changes } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => ({ action: "use", candidate: candidate() }),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "ready");
    assert.equal((state as { dataRoot: string }).dataRoot, "C:\\old");
    assert.deepEqual(persisted, ["C:\\old"]);
    assert.deepEqual(changes, ["C:\\old"]);
  });

  it("stays pending when a setting or env still pins another root", async () => {
    // A fixed dataRoot stands in for 'kbMcp.dataRoot' / an inherited KB_MCP_HOME:
    // set-data-dir writes config.yaml, but the extension keeps resolving the pin.
    const { deps, persisted, changes, errors } = makeDeps({
      dataRoot: () => "C:\\new",
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => ({ action: "use", candidate: candidate() }),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "pending");
    assert.equal((state as { reason: string }).reason, "migration-failed");
    assert.deepEqual(persisted, ["C:\\old"]);
    assert.deepEqual(changes, []);
    assert.match(errors[0] ?? "", /still overrides it/);
    assert.equal(await settles(gate.wait(), 50), false);
  });

  it("persists a folder picked by hand", async () => {
    const { deps, persisted } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => ({ action: "choose-folder", path: "D:\\kb" }),
    });
    const gate = new MigrationGate(deps);
    assert.equal((await gate.decide()).kind, "ready");
    assert.deepEqual(persisted, ["D:\\kb"]);
  });

  it("holds startup after 'not now' until release() is called", async () => {
    const { deps, states, migrated, persisted, changes } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "pending");
    assert.equal((state as { reason: string }).reason, "not-now");
    // "Not now" never moves data or rewrites the real config, and startup stays held.
    assert.deepEqual(migrated, []);
    assert.deepEqual(persisted, []);
    assert.deepEqual(changes, []);
    assert.equal(await settles(gate.wait(), 50), false);
    assert.equal((await gate.whenSettled()).kind, "pending");
    assert.equal(states.at(-1)?.kind, "pending");

    gate.release();
    assert.equal(await settles(gate.wait()), true);
    assert.equal(gate.state().kind, "ready");
  });

  it("shares one detection when retry is invoked while a decision is in flight", async () => {
    let releaseDecide!: (decision: MigrationDecision | null) => void;
    const waiting = new Promise<MigrationDecision | null>((resolve) => {
      releaseDecide = resolve;
    });
    let inspectCalls = 0;
    let decideCalls = 0;
    const { deps } = makeDeps({
      inspect: async () => {
        inspectCalls += 1;
        return inspectJson();
      },
      scanExtensionDataDirs: () => [candidate()],
      decide: () => {
        decideCalls += 1;
        return waiting;
      },
    });
    const gate = new MigrationGate(deps);
    const first = gate.decide();
    await delay(10);
    const second = gate.retry();
    assert.equal(second, first, "retry must not start a second detection");
    assert.equal(inspectCalls, 1);
    assert.equal(decideCalls, 1);
    releaseDecide({ action: "not-now" });
    assert.equal((await first).kind, "pending");
  });

  it("treats a dismissed prompt as 'not now'", async () => {
    const { deps } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => null,
    });
    const gate = new MigrationGate(deps);
    assert.equal((await gate.decide()).kind, "pending");
    assert.equal(await settles(gate.wait(), 50), false);
  });

  it("blocks on an old runtime only while candidates exist, then recovers via retry", async () => {
    const oldRuntime = () =>
      new HomeCommandError("hyseed home inspect --json failed (rc 2) without a JSON report", {
        rc: 2,
        code: 2,
        stage: null,
        unsupported: true,
        stdout: "",
        stderr: "Error: No such command 'home'.",
      });
    let inspectImpl: () => Promise<HomeInspectJson> = async () => {
      throw oldRuntime();
    };
    const { deps, errors, log } = makeDeps({
      inspect: () => inspectImpl(),
      scanExtensionDataDirs: () => [candidate({ kind: "extension_data" })],
      decide: async () => ({ action: "migrate", candidate: candidate({ kind: "extension_data" }) }),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "pending");
    assert.equal((state as { reason: string }).reason, "runtime-too-old");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /home/);
    assert.match(log.join("\n"), /predates the home command/);
    assert.equal(await settles(gate.wait(), 50), false);

    inspectImpl = async () => inspectJson();
    const recovered = await gate.retry();
    assert.equal(recovered.kind, "ready");
    assert.equal(await settles(gate.wait()), true);
  });

  it("never blocks startup on an old runtime without candidates", async () => {
    const { deps } = makeDeps({
      inspect: async () => {
        throw new HomeCommandError("no home command", {
          rc: 2,
          code: 2,
          stage: null,
          unsupported: true,
          stdout: "",
          stderr: "Error: No such command 'home'.",
        });
      },
    });
    const gate = new MigrationGate(deps);
    assert.equal((await gate.decide()).kind, "error");
    assert.equal(await settles(gate.wait()), true);
  });

  it("never blocks startup on an unexpected inspect failure", async () => {
    const { deps } = makeDeps({
      inspect: async () => {
        throw new Error("boom");
      },
      scanExtensionDataDirs: () => [candidate()],
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "error");
    assert.match((state as { message: string }).message, /boom/);
    assert.equal(await settles(gate.wait()), true);
  });

  it("hands a non-empty target to the conflict prompt without migrating", async () => {
    let initCalls = 0;
    const { deps, migrated } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      isInitialized: () => {
        initCalls += 1;
        return initCalls >= 3;
      },
      decide: async () => ({ action: "migrate", candidate: candidate() }),
      decideConflict: async () => ({ action: "keep" }),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "ready");
    assert.deepEqual(migrated, []);
    assert.ok(initCalls >= 3);
  });

  it("parks a cancelled conflict prompt as pending and notifies", async () => {
    let initCalls = 0;
    const { deps, migrated, persisted, errors } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      isInitialized: () => {
        initCalls += 1;
        return initCalls >= 3;
      },
      decide: async () => ({ action: "migrate", candidate: candidate() }),
      decideConflict: async () => null,
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "pending");
    assert.equal((state as { reason: string }).reason, "migration-failed");
    assert.deepEqual(migrated, []);
    assert.deepEqual(persisted, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /already holds data/);
    assert.equal(await settles(gate.wait(), 50), false);
  });

  it("resolves a runtime-reported conflict (code 4) through the dialog", async () => {
    const { deps, persisted } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => ({ action: "migrate", candidate: candidate() }),
      migrate: async () => {
        throw new HomeCommandError("target already holds data", {
          rc: 4,
          code: 4,
          stage: "conflict",
          unsupported: false,
          stdout: "",
          stderr: "",
        });
      },
      decideConflict: async () => ({ action: "use", candidate: candidate() }),
    });
    const gate = new MigrationGate(deps);
    assert.equal((await gate.decide()).kind, "ready");
    assert.deepEqual(persisted, ["C:\\old"]);
  });

  it("parks a failed migration without unblocking the server", async () => {
    let migrateImpl: MigrationGateDeps["migrate"] = async () => {
      throw new Error("disk full");
    };
    const { deps, errors } = makeDeps({
      scanExtensionDataDirs: () => [candidate()],
      decide: async () => ({ action: "migrate", candidate: candidate() }),
      migrate: (from, to) => migrateImpl(from, to),
    });
    const gate = new MigrationGate(deps);
    const state = await gate.decide();
    assert.equal(state.kind, "pending");
    assert.equal((state as { reason: string }).reason, "migration-failed");
    assert.equal(errors.length, 1);
    assert.equal(await settles(gate.wait(), 50), false);

    migrateImpl = async (from, to) => ({
      ok: true,
      mode: "move",
      from,
      to,
      vaults: 2,
      documents: 10,
      removed_source: true,
      warnings: [],
    });
    assert.equal((await gate.retry()).kind, "ready");
    assert.equal(await settles(gate.wait()), true);
  });
});

describe("recordVersionState", () => {
  function memento(initial?: unknown): { store: VersionMemento; writes: unknown[] } {
    const writes: unknown[] = [];
    const store: VersionMemento = {
      get: <T>() => initial as T | undefined,
      update: (key, value) => {
        assert.equal(key, VERSION_STATE_KEY);
        writes.push(value);
        return Promise.resolve();
      },
    };
    return { store, writes };
  }

  it("marks the first install", () => {
    const { store, writes } = memento();
    const state = recordVersionState(store, "0.2.0");
    assert.equal(state.firstInstall, true);
    assert.equal(state.previous, null);
    assert.equal(state.majorMinorUpgrade, false);
    assert.equal(writes.length, 1);
  });

  it("marks only major.minor upgrades", () => {
    const minor = recordVersionState(
      memento({ current: "0.2.0" }).store,
      "0.2.1"
    );
    assert.equal(minor.firstInstall, false);
    assert.equal(minor.previous, "0.2.0");
    assert.equal(minor.majorMinorUpgrade, false);

    const major = recordVersionState(
      memento({ current: "0.1.4" }).store,
      "0.2.0"
    );
    assert.equal(major.majorMinorUpgrade, true);
  });
});