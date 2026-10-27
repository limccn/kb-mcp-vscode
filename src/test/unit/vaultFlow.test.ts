import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CliRunResult } from "../../mcp/skillsCli";
import {
  clearProjectVaultFlow,
  createVaultFlow,
  listVaultsFlow,
  switchVaultFlow,
  type VaultScope,
  type VaultsDeps,
  type VaultsUi,
} from "../../vaults/flow";
import { readWorkspacePin, VAULT_ENV_KEY } from "../../vaults/pin";
import type { VaultListState } from "../../vaults/vaults";

interface UiRecord {
  projectAvailable: boolean[];
  defaults: string[];
  confirms: { title: string; detail?: string }[];
  errors: string[];
  notes: string[];
  pinned: (string | null)[];
  shown: { state: VaultListState; pinned: string | null }[];
}

function scriptedUi(script: {
  scope?: VaultScope | "cancel";
  names?: (string | "__default__" | undefined)[];
  confirms?: boolean[];
  pick?: string;
}): { ui: VaultsUi; record: UiRecord } {
  const record: UiRecord = {
    projectAvailable: [],
    defaults: [],
    confirms: [],
    errors: [],
    notes: [],
    pinned: [],
    shown: [],
  };
  let confirmIndex = 0;
  const ui: VaultsUi = {
    async pickScope(projectAvailable) {
      record.projectAvailable.push(projectAvailable);
      return script.scope === "cancel" ? undefined : script.scope;
    },
    async inputName(defaultValue) {
      record.defaults.push(defaultValue);
      const next = script.names?.shift();
      if (next === undefined) return undefined;
      return next === "__default__" ? defaultValue : next;
    },
    async confirm(title, detail) {
      record.confirms.push({ title, detail });
      const value = script.confirms?.[confirmIndex] ?? true;
      confirmIndex += 1;
      return value;
    },
    async pickVault(_state, pinned) {
      record.pinned.push(pinned);
      return script.pick;
    },
    async showVaults(state, pinned) {
      record.shown.push({ state, pinned });
    },
    notify(message) {
      record.notes.push(message);
    },
    error(message) {
      record.errors.push(message);
    },
  };
  return { ui, record };
}

function ok(stdout: string): CliRunResult {
  return { rc: 0, stdout, stderr: "" };
}

function fail(rc: number, stderr: string): CliRunResult {
  return { rc, stdout: "", stderr };
}

interface CliState {
  current: string;
  vaults: { name: string; path: string }[];
  failCreate?: Record<string, CliRunResult>;
}

function newState(): CliState {
  return { current: "default", vaults: [{ name: "default", path: "default" }] };
}

function makeDeps(
  root: string | undefined,
  state: CliState
): { deps: VaultsDeps; calls: string[][] } {
  const calls: string[][] = [];
  const deps: VaultsDeps = {
    resolveExe: async () => "C:/tools/hyseed.exe",
    workspaceRoot: () => root,
    async run(_exe, args) {
      calls.push(args);
      if (args[0] !== "vault") throw new Error(`unexpected command: ${args.join(" ")}`);
      if (args[1] === "list" && args.includes("--json")) {
        return ok(
          JSON.stringify(
            state.vaults.map((vault) => ({ ...vault, description: null, sync_dir: null }))
          )
        );
      }
      if (args[1] === "list") {
        return ok(
          `Default vault: ${state.current}\n\nAvailable vaults:\n* ${state.current}: ${state.current}\n`
        );
      }
      if (args[1] === "create") {
        const name = args[2];
        const failure = state.failCreate?.[name];
        if (failure) return failure;
        state.vaults.push({ name, path: name });
        return ok(JSON.stringify({ name, path: name }));
      }
      if (args[1] === "switch") {
        const name = args[2];
        if (!state.vaults.some((vault) => vault.name === name)) {
          return fail(3, `Error: vault '${name}' not found`);
        }
        state.current = name;
        return ok(`Default vault set to ${name}`);
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    log: () => undefined,
  };
  return { deps, calls };
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-vaultflow-"));
}

function seedWorkspace(root: string): void {
  const settings = path.join(root, ".vscode", "settings.json");
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ "editor.tabSize": 2 }, null, 2));
  fs.writeFileSync(
    path.join(root, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          hyseed: {
            type: "stdio",
            command: "C:/tools/hyseed.exe",
            args: ["serve"],
            env: { KB_MCP_HOME: "C:/data" },
          },
          other: { command: "keep.exe" },
        },
      },
      null,
      2
    )
  );
}

describe("createVaultFlow", () => {
  it("creates a global vault and switches it current", async () => {
    const state = newState();
    const { deps, calls } = makeDeps(undefined, state);
    const { ui, record } = scriptedUi({
      scope: "global",
      names: ["demo"],
      confirms: [true, true],
    });
    await createVaultFlow(ui, deps);
    assert.deepEqual(record.errors, []);
    assert.equal(state.current, "demo");
    assert.ok(calls.some((args) => args.join(" ") === "vault create demo --json"));
    assert.ok(calls.some((args) => args.join(" ") === "vault switch demo"));
    assert.match(record.notes.at(-1) ?? "", /is now current/);
  });

  it("skips the switch when declined", async () => {
    const state = newState();
    const { deps, calls } = makeDeps(undefined, state);
    const { ui, record } = scriptedUi({
      scope: "global",
      names: ["demo"],
      confirms: [true, false],
    });
    await createVaultFlow(ui, deps);
    assert.equal(state.current, "default");
    assert.ok(!calls.some((args) => args[1] === "switch"));
    assert.match(record.notes.at(-1) ?? "", /created/);
  });

  it("pins a project vault, merges the entry env, and leaves current alone", async () => {
    const root = tempRoot();
    try {
      seedWorkspace(root);
      const state = newState();
      const { deps, calls } = makeDeps(root, state);
      const { ui, record } = scriptedUi({ scope: "project", names: ["demo"] });
      await createVaultFlow(ui, deps);
      assert.deepEqual(record.errors, []);
      assert.equal(state.current, "default");
      assert.ok(!calls.some((args) => args[1] === "switch"));
      assert.equal(readWorkspacePin(root), "demo");
      const written = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
      assert.equal(written.mcpServers.hyseed.env[VAULT_ENV_KEY], "demo");
      assert.deepEqual(written.mcpServers.other, { command: "keep.exe" });
      assert.match(record.notes.at(-1) ?? "", /pinned to this workspace/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("offers the sanitized workspace name as the default", async () => {
    const base = tempRoot();
    try {
      const root = path.join(base, "My Project (1)");
      fs.mkdirSync(root, { recursive: true });
      const state = newState();
      const { deps } = makeDeps(root, state);
      const { ui, record } = scriptedUi({ scope: "project", names: ["__default__"] });
      await createVaultFlow(ui, deps);
      assert.equal(record.defaults[0], "My-Project-1");
      assert.equal(readWorkspacePin(root), "My-Project-1");
      assert.match(record.notes.at(-1) ?? "", /Install agent skills/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses project scope without a workspace folder", async () => {
    const state = newState();
    const { deps, calls } = makeDeps(undefined, state);
    const { ui, record } = scriptedUi({ scope: "project" });
    await createVaultFlow(ui, deps);
    assert.match(record.errors[0] ?? "", /workspace folder/);
    assert.deepEqual(calls, []);
    assert.deepEqual(record.projectAvailable, [false]);
  });

  it("only writes the pin when no project entry exists", async () => {
    const root = tempRoot();
    try {
      const state = newState();
      const { deps } = makeDeps(root, state);
      const { ui, record } = scriptedUi({ scope: "project", names: ["demo"] });
      await createVaultFlow(ui, deps);
      assert.equal(readWorkspacePin(root), "demo");
      assert.ok(!fs.existsSync(path.join(root, ".mcp.json")));
      assert.match(record.notes.at(-1) ?? "", /Install agent skills/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries with a new name after a duplicate", async () => {
    const state = newState();
    state.failCreate = { demo: fail(4, "Error: vault 'demo' already exists") };
    const { deps } = makeDeps(undefined, state);
    const { ui, record } = scriptedUi({
      scope: "global",
      names: ["demo", "demo2"],
      confirms: [true, true, true, false],
    });
    await createVaultFlow(ui, deps);
    assert.match(record.errors[0] ?? "", /already exists/);
    assert.ok(state.vaults.some((vault) => vault.name === "demo2"));
    assert.match(record.notes.at(-1) ?? "", /created/);
  });
});

describe("switchVaultFlow", () => {
  it("switches to the picked vault and verifies the text listing", async () => {
    const state = newState();
    state.vaults.push({ name: "demo", path: "demo" });
    const { deps } = makeDeps(undefined, state);
    const { ui, record } = scriptedUi({ pick: "demo" });
    await switchVaultFlow(ui, deps);
    assert.equal(state.current, "demo");
    assert.deepEqual(record.errors, []);
    assert.match(record.notes[0] ?? "", /is now current/);
  });
});

describe("clearProjectVaultFlow", () => {
  it("clears the pin and the entry env key", async () => {
    const root = tempRoot();
    try {
      seedWorkspace(root);
      fs.mkdirSync(path.join(root, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".vscode", "settings.json"),
        JSON.stringify({ kbMcp: { projectVault: "demo", adminPort: 9000 } }, null, 2)
      );
      const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
      mcp.mcpServers.hyseed.env[VAULT_ENV_KEY] = "demo";
      fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify(mcp, null, 2));

      const state = newState();
      const { deps } = makeDeps(root, state);
      const { ui, record } = scriptedUi({ confirms: [true] });
      await clearProjectVaultFlow(ui, deps);

      assert.equal(readWorkspacePin(root), null);
      const written = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
      assert.equal(VAULT_ENV_KEY in written.mcpServers.hyseed.env, false);
      assert.equal(written.mcpServers.hyseed.env.KB_MCP_HOME, "C:/data");
      assert.match(record.notes.at(-1) ?? "", /pin cleared/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listVaultsFlow", () => {
  it("shows vaults with current and workspace pin markers", async () => {
    const root = tempRoot();
    try {
      fs.mkdirSync(path.join(root, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".vscode", "settings.json"),
        JSON.stringify({ kbMcp: { projectVault: "demo" } }, null, 2)
      );
      const state = newState();
      state.vaults.push({ name: "demo", path: "demo" });
      const { deps } = makeDeps(root, state);
      const { ui, record } = scriptedUi({});
      await listVaultsFlow(ui, deps);
      assert.equal(record.shown.length, 1);
      assert.equal(record.shown[0].state.current, "default");
      assert.equal(record.shown[0].pinned, "demo");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});