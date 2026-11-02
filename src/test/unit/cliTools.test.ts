import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CLI_TOOL_NAMES,
  installCliTools,
  pathContains,
  pathHint,
  sha256File,
  type CliToolsOptions,
} from "../../cliTools";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-cli-tools-"));
}

function makeResources(root: string): string {
  const dir = path.join(root, "resources");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of CLI_TOOL_NAMES) fs.writeFileSync(path.join(dir, name), `${name}-bytes`);
  return dir;
}

function options(root: string, overrides: Partial<CliToolsOptions> = {}): CliToolsOptions {
  return {
    resourcesDir: path.join(root, "resources"),
    targetDir: path.join(root, "home", ".local", "bin"),
    pathEnv: "C:\\Windows\\System32",
    platform: "win32",
    pathDelimiter: ";",
    ...overrides,
  };
}

describe("installCliTools", () => {
  it("installs both bundled tools and reports a missing PATH entry", async () => {
    const root = tempDir();
    makeResources(root);
    try {
      const report = await installCliTools(options(root));
      assert.equal(report.results.length, 2);
      for (const result of report.results) {
        assert.equal(result.action, "installed");
        assert.equal(result.leftover, null);
        assert.equal(
          await sha256File(result.target),
          await sha256File(path.join(root, "resources", result.name))
        );
      }
      assert.equal(report.pathContainsTarget, false);
      assert.ok(report.pathHint.includes(report.targetDir));
      assert.deepEqual(
        fs.readdirSync(report.targetDir).sort(),
        [...CLI_TOOL_NAMES].sort(),
        "temporary or backup files were left behind"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent: a second run keeps both files without writing", async () => {
    const root = tempDir();
    makeResources(root);
    try {
      const first = await installCliTools(options(root));
      fs.utimesSync(first.results[0].target, 1, 1);
      fs.utimesSync(first.results[1].target, 1, 1);

      const second = await installCliTools(options(root));
      assert.deepEqual(
        second.results.map((result) => [result.name, result.action]),
        CLI_TOOL_NAMES.map((name) => [name, "kept"])
      );
      for (const result of second.results) {
        assert.equal(fs.statSync(result.target).mtimeMs, 1000, `${result.name} was rewritten`);
      }
      assert.deepEqual(fs.readdirSync(second.targetDir).sort(), [...CLI_TOOL_NAMES].sort());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces a different target and keeps matching ones", async () => {
    const root = tempDir();
    makeResources(root);
    try {
      const targetDir = path.join(root, "home", ".local", "bin");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, CLI_TOOL_NAMES[0]), "stale");
      fs.writeFileSync(path.join(targetDir, CLI_TOOL_NAMES[1]), `${CLI_TOOL_NAMES[1]}-bytes`);

      const report = await installCliTools(options(root));
      assert.deepEqual(
        report.results.map((result) => result.action),
        ["replaced", "kept"]
      );
      assert.equal(
        await sha256File(path.join(targetDir, CLI_TOOL_NAMES[0])),
        await sha256File(path.join(root, "resources", CLI_TOOL_NAMES[0]))
      );
      assert.deepEqual(fs.readdirSync(targetDir).sort(), [...CLI_TOOL_NAMES].sort());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails before creating the target when a bundled tool is missing", async () => {
    const root = tempDir();
    try {
      const resourcesDir = makeResources(root);
      fs.rmSync(path.join(resourcesDir, CLI_TOOL_NAMES[1]));
      const targetDir = path.join(root, "home", ".local", "bin");

      await assert.rejects(
        () => installCliTools(options(root, { resourcesDir, targetDir })),
        /bundled CLI tool is missing/
      );
      assert.equal(fs.existsSync(targetDir), false, "target directory must not be created");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares one run between concurrent callers", async () => {
    const root = tempDir();
    makeResources(root);
    try {
      const opts = options(root);
      const [a, b] = await Promise.all([installCliTools(opts), installCliTools(opts)]);
      assert.equal(a, b, "concurrent installs must share the same report");
      assert.deepEqual(
        a.results.map((result) => result.action),
        ["installed", "installed"]
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("pathContains", () => {
  it("matches exact, quoted, trailing-separator, and case-insensitive entries on win32", () => {
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", "C:\\Users\\x\\.local\\bin", "win32", ";"), true);
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", "C:\\USERS\\X\\.LOCAL\\BIN\\", "win32", ";"), true);
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", '"C:\\Users\\x\\.local\\bin"', "win32", ";"), true);
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", "C:\\Windows;C:\\Users\\x\\.local\\bin", "win32", ";"), true);
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", "C:\\Users\\x\\.local", "win32", ";"), false);
    assert.equal(pathContains("C:\\Users\\x\\.local\\bin", "", "win32", ";"), false);
  });

  it("compares case-sensitively elsewhere", () => {
    assert.equal(pathContains("/home/x/.local/bin", "/HOME/X/.local/bin", "linux", ":"), false);
    assert.equal(pathContains("/home/x/.local/bin", "/home/x/.local/bin", "linux", ":"), true);
  });
});

describe("pathHint", () => {
  it("reports adding PATH versus restarting the window", () => {
    assert.match(pathHint("C:\\x\\.local\\bin", false), /not on PATH/);
    assert.match(pathHint("C:\\x\\.local\\bin", true), /restart the window/);
  });
});