import * as assert from "node:assert/strict";
import { join } from "node:path";
import {
  RuntimeResolveError,
  resolveRuntime,
  type ProbeResult,
  type ResolverDeps,
} from "../../runtime";

const HOME = "C:\\Users\\tester";
const BUNDLED = "C:\\ext\\resources\\hyseed.exe";
const BIN = join(HOME, ".local", "bin");
const SHARE = join(HOME, ".local", "share", "hyseed");
const SHARE_LEGACY = join(HOME, ".local", "share", "kb-mcp");

interface DepsOptions extends Partial<ResolverDeps> {
  existing: string[];
  failProbeFor?: string[];
}

function makeDeps(options: DepsOptions): ResolverDeps {
  const existing = new Set(options.existing.map((p) => p.toLowerCase()));
  const failing = new Set((options.failProbeFor ?? []).map((p) => p.toLowerCase()));
  return {
    setting: "",
    userHome: HOME,
    pathEnv: "",
    bundledPath: BUNDLED,
    fileExists: (p) => existing.has(p.toLowerCase()),
    probe: async (p): Promise<ProbeResult> =>
      failing.has(p.toLowerCase())
        ? { ok: false, version: null, error: "exit 1" }
        : existing.has(p.toLowerCase())
          ? { ok: true, version: "hyseed, version 0.9.0", error: null }
          : { ok: false, version: null, error: "missing" },
    ...options,
  };
}

function expectResolve(deps: ResolverDeps, expectedPath: string) {
  return resolveRuntime(deps).then((resolved) => {
    assert.equal(resolved.exePath, expectedPath);
    assert.equal(resolved.version, "hyseed, version 0.9.0");
    return resolved;
  });
}

describe("resolveRuntime candidate chain", () => {
  it("prefers the explicit setting", async () => {
    const setting = "D:\\tools\\hyseed.exe";
    const resolved = await expectResolve(
      makeDeps({
        existing: [setting, join(BIN, "hyseed.exe")],
        setting,
      }),
      setting
    );
    assert.equal(resolved.fromSetting, true);
  });

  it("hits ~/.local/bin", async () => {
    await expectResolve(makeDeps({ existing: [join(BIN, "hyseed.exe")] }), join(BIN, "hyseed.exe"));
  });

  it("hits ~/.local/share/hyseed", async () => {
    await expectResolve(
      makeDeps({ existing: [join(SHARE, "hyseed.exe")] }),
      join(SHARE, "hyseed.exe")
    );
  });

  it("no longer recognizes the pre-rename executable or share directory", async () => {
    await assert.rejects(
      resolveRuntime(
        makeDeps({
          existing: [join(SHARE_LEGACY, "kb-mcp.exe"), join(BIN, "kb-mcp.exe")],
        })
      ),
      (err: unknown) =>
        err instanceof RuntimeResolveError &&
        !err.candidates.some((candidate) => candidate.path.toLowerCase().includes("kb-mcp"))
    );
  });

  it("falls through to PATH", async () => {
    const tools = "C:\\tools";
    await expectResolve(
      makeDeps({ existing: [join(tools, "hyseed.exe")], pathEnv: `C:\\empty;${tools};D:\\bin` }),
      join(tools, "hyseed.exe")
    );
  });

  it("falls back to the bundled copy", async () => {
    const resolved = await expectResolve(makeDeps({ existing: [BUNDLED] }), BUNDLED);
    assert.equal(resolved.candidates.at(-1)?.kind, "bundled");
  });

  it("ignores a pre-rename executable in the same directory", async () => {
    await expectResolve(
      makeDeps({
        existing: [join(BIN, "hyseed.exe"), join(BIN, "kb-mcp.exe")],
      }),
      join(BIN, "hyseed.exe")
    );
  });
});

describe("resolveRuntime failure handling", () => {
  it("hard-fails when the setting candidate cannot be probed", async () => {
    const setting = "D:\\tools\\hyseed.exe";
    await assert.rejects(
      resolveRuntime(
        makeDeps({
          existing: [setting, join(BIN, "hyseed.exe")],
          setting,
          failProbeFor: [setting],
        })
      ),
      (err: unknown) =>
        err instanceof RuntimeResolveError &&
        err.message.includes(setting) &&
        err.message.includes("kbMcp.runtimePath")
    );
  });

  it("reports the full candidate list when everything fails", async () => {
    await assert.rejects(
      resolveRuntime(makeDeps({ existing: [join(BIN, "hyseed.exe")], failProbeFor: [join(BIN, "hyseed.exe")] })),
      (err: unknown) =>
        err instanceof RuntimeResolveError &&
        err.message.includes("Candidates checked") &&
        err.message.includes(BUNDLED)
    );
  });
});

describe("resolveRuntime name-list extension slot", () => {
  it("resolves a name added to the list without touching the resolver", async () => {
    await expectResolve(
      makeDeps({
        existing: [join(SHARE, "newseed.exe")],
        exeNames: ["hyseed.exe", "newseed.exe"],
      }),
      join(SHARE, "newseed.exe")
    );
  });
});