import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CliRunResult } from "../../mcp/skillsCli";
import {
  buildVaultCreateArgs,
  buildVaultListArgs,
  buildVaultSwitchArgs,
  createVault,
  listVaults,
  parseCurrentVault,
  parseVaultListJson,
  readCurrentVault,
  switchVault,
  VaultCliError,
  type VaultRunner,
} from "../../vaults/vaults";

function fixture(name: string): string {
  return readFileSync(`src/test/fixtures/${name}`, "utf8");
}

function ok(stdout: string): CliRunResult {
  return { rc: 0, stdout, stderr: "" };
}

function fail(rc: number, stderr: string): CliRunResult {
  return { rc, stdout: "", stderr };
}

function stubRun(map: Record<string, CliRunResult>): { run: VaultRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: VaultRunner = async (_exe, args) => {
    calls.push(args);
    const key = args.join(" ");
    const result = map[key];
    if (!result) throw new Error(`unexpected command: ${key}`);
    return result;
  };
  return { run, calls };
}

describe("vault list parsing", () => {
  it("parses the real fixture and keeps name/path", () => {
    const vaults = parseVaultListJson(fixture("vault-list.json"));
    assert.deepEqual(vaults, [
      { name: "default", path: "default" },
      { name: "demo", path: "demo" },
    ]);
  });

  it("rejects non-array and entry-less payloads", () => {
    assert.throws(() => parseVaultListJson('{"vaults":[]}'), /expected a JSON array/);
    assert.throws(() => parseVaultListJson('[{"name":"x"}]'), /entry without name\/path/);
  });

  it("reads current only from the text listing", () => {
    assert.equal(parseCurrentVault(fixture("vault-list.txt")), "demo");
    assert.equal(parseCurrentVault("Available vaults:\n  a: a"), null);
  });
});

describe("vault CLI arguments", () => {
  it("builds create/switch/list arguments", () => {
    assert.deepEqual(buildVaultCreateArgs("demo"), ["vault", "create", "demo", "--json"]);
    assert.deepEqual(buildVaultSwitchArgs("demo"), ["vault", "switch", "demo"]);
    assert.deepEqual(buildVaultListArgs(true), ["vault", "list", "--json"]);
    assert.deepEqual(buildVaultListArgs(false), ["vault", "list"]);
  });
});

describe("vault CLI commands", () => {
  it("creates a vault from the JSON echo", async () => {
    const { run, calls } = stubRun({
      "vault create demo --json": ok('{"name":"demo","path":"demo"}'),
    });
    const created = await createVault("hyseed.exe", "demo", { run, cwd: "." });
    assert.deepEqual(created, { name: "demo", path: "demo" });
    assert.deepEqual(calls, [["vault", "create", "demo", "--json"]]);
  });

  it("maps a duplicate-name failure onto VaultCliError", async () => {
    const { run } = stubRun({
      "vault create demo --json": fail(4, "Error: vault 'demo' already exists"),
    });
    await assert.rejects(
      () => createVault("hyseed.exe", "demo", { run, cwd: "." }),
      (err: unknown) =>
        err instanceof VaultCliError && err.rc === 4 && /already exists/.test(err.message)
    );
  });

  it("lists vaults with the current name from the text run", async () => {
    const { run } = stubRun({
      "vault list --json": ok(fixture("vault-list.json")),
      "vault list": ok(fixture("vault-list.txt")),
    });
    const state = await listVaults("hyseed.exe", { run, cwd: "." });
    assert.equal(state.vaults.length, 2);
    assert.equal(state.current, "demo");
  });

  it("keeps the list usable when the text run fails", async () => {
    const { run } = stubRun({
      "vault list --json": ok(fixture("vault-list.json")),
      "vault list": fail(1, "boom"),
    });
    const state = await listVaults("hyseed.exe", { run, cwd: "." });
    assert.equal(state.vaults.length, 2);
    assert.equal(state.current, null);
  });

  it("raises on a switch to a missing vault", async () => {
    const { run } = stubRun({
      "vault switch nope": fail(3, "Error: vault 'nope' not found"),
      "vault list": fail(1, "boom"),
    });
    await assert.rejects(
      () => switchVault("hyseed.exe", "nope", { run, cwd: "." }),
      (err: unknown) => err instanceof VaultCliError && err.rc === 3
    );
    assert.equal(await readCurrentVault("hyseed.exe", { run, cwd: "." }), null);
  });
});