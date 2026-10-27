import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clearVaultEnv,
  clearWorkspacePin,
  readWorkspacePin,
  sanitizeVaultName,
  setVaultEnv,
  settingsFile,
  VAULT_ENV_KEY,
  writeWorkspacePin,
} from "../../vaults/pin";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-pin-"));
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;
}

/** Real `hyseed skills add --scope project` payload (paths normalized in the fixture). */
function projectFixture(): Record<string, any> {
  const raw = fs
    .readFileSync("src/test/fixtures/mcp-project-json.json", "utf8")
    .replace("<RUNTIME_EXE>", "C:/tools/hyseed.exe")
    .replace("<DATA_ROOT>", "C:/data");
  return JSON.parse(raw) as Record<string, any>;
}

function seedMcp(root: string): string {
  const payload = projectFixture();
  payload.mcpServers.other = { command: "keep.exe" };
  payload.extra = { keep: true };
  const file = path.join(root, ".mcp.json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function backups(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.includes(".bak-"));
}

describe("sanitizeVaultName", () => {
  it("maps workspace folder names onto CLI-safe names", () => {
    assert.equal(sanitizeVaultName(" My Project (1) "), "My-Project-1");
    assert.equal(sanitizeVaultName("a//b"), "a-b");
    assert.equal(sanitizeVaultName("--x--"), "x");
    assert.equal(sanitizeVaultName("a..b"), "a..b");
  });

  it("returns an empty string when nothing survives", () => {
    assert.equal(sanitizeVaultName("中文"), "");
    assert.equal(sanitizeVaultName("   "), "");
  });
});

describe("workspace settings pin", () => {
  it("creates .vscode/settings.json without dropping other keys", () => {
    const root = tempRoot();
    try {
      const file = settingsFile(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ "editor.tabSize": 4, kbMcp: { adminPort: 9000 } }));
      const result = writeWorkspacePin(root, "demo");
      assert.equal(result.action, "updated");
      const written = readJson(file);
      assert.equal(written["editor.tabSize"], 4);
      assert.equal(written.kbMcp.adminPort, 9000);
      assert.equal(written.kbMcp.projectVault, "demo");
      assert.ok(fs.readFileSync(file, "utf8").includes('\n  "editor.tabSize"'));
      assert.equal(readWorkspacePin(root), "demo");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the file when missing and stays idempotent", () => {
    const root = tempRoot();
    try {
      const first = writeWorkspacePin(root, "demo");
      assert.equal(first.action, "created");
      const second = writeWorkspacePin(root, "demo");
      assert.equal(second.action, "unchanged");
      assert.equal(readWorkspacePin(root), "demo");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears only the pin key and is idempotent", () => {
    const root = tempRoot();
    try {
      const file = settingsFile(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ kbMcp: { projectVault: "demo", adminPort: 9000 } }, null, 2)
      );
      assert.equal(clearWorkspacePin(root).action, "updated");
      const written = readJson(file);
      assert.equal(written.kbMcp.projectVault, undefined);
      assert.equal(written.kbMcp.adminPort, 9000);
      assert.equal(clearWorkspacePin(root).action, "unchanged");
      assert.equal(clearWorkspacePin(tempRoot()).action, "unchanged");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to clobber an unparsable settings file", () => {
    const root = tempRoot();
    try {
      const file = settingsFile(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{ not json");
      assert.throws(() => writeWorkspacePin(root, "demo"));
      assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("project .mcp.json vault env", () => {
  it("merges the key with a timestamped backup and minimal intrusion", () => {
    const root = tempRoot();
    try {
      const file = seedMcp(root);
      const before = fs.readFileSync(file, "utf8");
      const result = setVaultEnv(root, "demo");
      assert.equal(result.status, "updated");
      assert.ok(result.backup, "expected a backup");
      assert.match(path.basename(result.backup as string), /\.bak-\d{8}-\d{6}(-\d+)?$/);
      assert.equal(fs.readFileSync(result.backup as string, "utf8"), before);

      const written = readJson(file);
      assert.equal(written.mcpServers.hyseed.env[VAULT_ENV_KEY], "demo");
      assert.deepEqual(written.mcpServers.other, { command: "keep.exe" });
      assert.deepEqual(written.extra, { keep: true });
      assert.equal(written.mcpServers.hyseed.env.KB_MCP_HOME, "C:/data");
      assert.deepEqual(written.mcpServers.hyseed.args, ["serve"]);

      const again = setVaultEnv(root, "demo");
      assert.equal(again.status, "unchanged");
      assert.equal(again.backup, null);
      assert.equal(backups(root).length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces a stale value and removes the key on clear", () => {
    const root = tempRoot();
    try {
      const file = seedMcp(root);
      assert.equal(setVaultEnv(root, "first").status, "updated");
      assert.equal(setVaultEnv(root, "second").status, "updated");
      assert.equal(readJson(file).mcpServers.hyseed.env[VAULT_ENV_KEY], "second");

      const cleared = clearVaultEnv(root);
      assert.equal(cleared.status, "updated");
      const written = readJson(file);
      assert.equal(VAULT_ENV_KEY in written.mcpServers.hyseed.env, false);
      assert.equal(written.mcpServers.hyseed.env.KB_MCP_HOME, "C:/data");
      assert.deepEqual(written.mcpServers.other, { command: "keep.exe" });
      assert.equal(clearVaultEnv(root).status, "unchanged");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports absent without touching unknown files", () => {
    const root = tempRoot();
    try {
      assert.equal(setVaultEnv(root, "demo").status, "absent");
      assert.ok(!fs.existsSync(path.join(root, ".mcp.json")));

      const file = path.join(root, ".mcp.json");
      const foreign = JSON.stringify({ mcpServers: { claude: { command: "x" } } }, null, 2);
      fs.writeFileSync(file, foreign);
      assert.equal(setVaultEnv(root, "demo").status, "absent");
      assert.equal(clearVaultEnv(root).status, "absent");
      assert.equal(fs.readFileSync(file, "utf8"), foreign);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});