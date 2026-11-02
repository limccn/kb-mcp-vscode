import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseConfig, type ConfigReader } from "../../config";
import { DEFAULT_ADMIN_PORT } from "../../constants";

const HOME = "C:\\Users\\tester";
const DEFAULT_ROOT = path.join(HOME, ".local", "share", "hyseed");

function reader(values: Record<string, unknown>): ConfigReader {
  return { get: <T>(key: string) => values[key] as T | undefined };
}

const homes: string[] = [];

function tmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kbmcp-config-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function writeConfig(home: string, rel: string, text: string): void {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

describe("parseConfig", () => {
  it("falls back to a stable data root under the user home", () => {
    assert.deepEqual(parseConfig(reader({}), { home: HOME, env: {} }), {
      runtimePath: "",
      adminPort: DEFAULT_ADMIN_PORT,
      adminHost: "127.0.0.1",
      mcpHost: "127.0.0.1",
      dataRoot: DEFAULT_ROOT,
      projectVault: "",
      converterPath: "",
    });
  });

  it("normalises host settings and reports invalid values once", () => {
    const issues: string[] = [];
    const cfg = parseConfig(
      reader({ adminHost: " 0.0.0.0 ", mcpHost: "[::1]" }),
      { home: HOME, env: {}, onIssue: (message) => issues.push(message) }
    );
    assert.equal(cfg.adminHost, "0.0.0.0");
    assert.equal(cfg.mcpHost, "::1");
    assert.deepEqual(issues, []);
  });

  it("falls back to loopback when a host setting is invalid", () => {
    const issues: string[] = [];
    const cfg = parseConfig(
      reader({ adminHost: "example.com", mcpHost: "not a host" }),
      { home: HOME, env: {}, onIssue: (message) => issues.push(message) }
    );
    assert.equal(cfg.adminHost, "127.0.0.1");
    assert.equal(cfg.mcpHost, "127.0.0.1");
    assert.equal(issues.length, 2);
    assert.match(issues[0], /kbMcp\.adminHost/);
    assert.match(issues[1], /kbMcp\.mcpHost/);
  });

  it("trims explicit paths", () => {
    const cfg = parseConfig(
      reader({
        runtimePath: "  C:\\tools\\hyseed.exe ",
        dataRoot: " D:\\kb ",
        projectVault: " demo ",
        converterPath: " C:\\tools\\doc-convert.exe ",
      }),
      { home: HOME, env: {} }
    );
    assert.equal(cfg.runtimePath, "C:\\tools\\hyseed.exe");
    assert.equal(cfg.dataRoot, "D:\\kb");
    assert.equal(cfg.projectVault, "demo");
    assert.equal(cfg.converterPath, "C:\\tools\\doc-convert.exe");
  });

  it("rejects out-of-range ports in favor of the default", () => {
    const host = { home: HOME, env: {} };
    assert.equal(parseConfig(reader({ adminPort: 0 }), host).adminPort, DEFAULT_ADMIN_PORT);
    assert.equal(parseConfig(reader({ adminPort: 70000 }), host).adminPort, DEFAULT_ADMIN_PORT);
    assert.equal(parseConfig(reader({ adminPort: 8890 }), host).adminPort, 8890);
  });

  it("expands ~ in the explicit data root and outranks env/config", () => {
    const home = tmpHome();
    writeConfig(home, ".config/hyseed/config.yaml", "data_dir: 'C:\\from-config'\n");
    const cfg = parseConfig(reader({ dataRoot: "~/kb" }), {
      home,
      env: { KB_MCP_HOME: "C:\\from-env" },
    });
    assert.equal(cfg.dataRoot, path.join(home, "kb"));
  });

  it("inherits KB_MCP_HOME before config and the default", () => {
    const home = tmpHome();
    writeConfig(home, ".config/hyseed/config.yaml", "data_dir: 'C:\\from-config'\n");
    const cfg = parseConfig(reader({}), { home, env: { KB_MCP_HOME: "C:\\from-env" } });
    assert.equal(cfg.dataRoot, "C:\\from-env");
  });

  it("reads data_dir from the new config path", () => {
    const home = tmpHome();
    writeConfig(home, ".config/hyseed/config.yaml", "data_dir: 'C:\\from-config'\n");
    assert.equal(parseConfig(reader({}), { home, env: {} }).dataRoot, "C:\\from-config");
  });

  it("ignores the pre-rename config path (0.2.0 retired it)", () => {
    const home = tmpHome();
    writeConfig(home, ".config/kb-mcp/config.yaml", "data_dir: 'C:\\legacy-config'\n");
    assert.equal(
      parseConfig(reader({}), { home, env: {} }).dataRoot,
      path.join(home, ".local", "share", "hyseed")
    );
  });

  it("honours KB_MCP_CONFIG and expands ~ in data_dir", () => {
    const home = tmpHome();
    const file = path.join(home, "custom.yaml");
    fs.writeFileSync(file, "data_dir: '~/kb-root'\n", "utf8");
    assert.equal(
      parseConfig(reader({}), { home, env: { KB_MCP_CONFIG: file } }).dataRoot,
      path.join(home, "kb-root")
    );
  });

  it("reads only the new config even when a legacy file also exists", () => {
    const home = tmpHome();
    writeConfig(home, ".config/hyseed/config.yaml", "data_dir: 'C:\\new'\n");
    writeConfig(home, ".config/kb-mcp/config.yaml", "data_dir: 'C:\\legacy'\n");
    assert.equal(parseConfig(reader({}), { home, env: {} }).dataRoot, "C:\\new");
  });

  it("uses the stable default when the config has no data_dir", () => {
    const home = tmpHome();
    writeConfig(home, ".config/hyseed/config.yaml", "embedding:\n  url: http://localhost\n");
    assert.equal(
      parseConfig(reader({}), { home, env: {} }).dataRoot,
      path.join(home, ".local", "share", "hyseed")
    );
  });
});