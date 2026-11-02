import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AdminPanel, renderPanelHtml, type PanelInfo } from "../../panel";
import { createdWebviewPanels } from "../vscode-stub";

function info(overrides: Partial<PanelInfo> = {}): PanelInfo {
  return {
    status: { state: "running-own", port: 8899, message: null },
    dataRoot: "C:\\sandbox",
    runtime: {
      exePath: "C:\\tools\\hyseed.exe",
      version: "hyseed, version 0.9.0",
      candidates: [],
      fromSetting: false,
    },
    ...overrides,
  };
}

describe("renderPanelHtml", () => {
  it("embeds the iframe with the actual port and a frame-src CSP", () => {
    const html = renderPanelHtml(info());
    assert.ok(html.includes('<iframe src="http://127.0.0.1:8899/"'));
    assert.ok(html.includes("frame-src http://127.0.0.1:*"));
    assert.ok(html.includes("host: 127.0.0.1"));
    assert.ok(html.includes("C:\\tools\\hyseed.exe"));
    assert.ok(html.includes("C:\\sandbox"));
  });

  it("brackets IPv6 hosts in the iframe URL and CSP", () => {
    const html = renderPanelHtml(
      info({ status: { state: "running-own", port: 8899, host: "::1", message: null } })
    );
    assert.ok(html.includes('<iframe src="http://[::1]:8899/"'));
    assert.ok(html.includes("frame-src http://[::1]:*"));
    assert.ok(html.includes("host: ::1"));
  });

  it("connects through loopback for a wildcard host", () => {
    const html = renderPanelHtml(
      info({ status: { state: "running-own", port: 8899, host: "0.0.0.0", message: null } })
    );
    assert.ok(html.includes('<iframe src="http://127.0.0.1:8899/"'));
    assert.ok(html.includes("frame-src http://127.0.0.1:*"));
    assert.ok(html.includes("host: 0.0.0.0"));
  });

  it("annotates an external instance", () => {
    const html = renderPanelHtml(
      info({
        status: { state: "running-external", port: 8888, message: "not started by the extension" },
      })
    );
    assert.ok(html.includes("running-external"));
    assert.ok(html.includes("not started by the extension"));
    assert.ok(html.includes('<iframe src="http://127.0.0.1:8888/"'));
  });

  it("shows the guide when stopped, without an iframe", () => {
    const html = renderPanelHtml(info({ status: { state: "stopped", port: null, message: null } }));
    assert.ok(html.includes("is not running"));
    assert.ok(!html.includes("<iframe"));
    assert.ok(html.includes("frame-src 'none'"));
  });

  it("escapes error messages", () => {
    const html = renderPanelHtml(info({ status: { state: "error", port: 8899, message: "<boom>" } }));
    assert.ok(html.includes("&lt;boom&gt;"));
    assert.ok(!html.includes("<boom>"));
  });
});

describe("panel CSP and bridge", () => {
  it("carries a nonce on the only outer script and matches the CSP", () => {
    const html = renderPanelHtml(info());
    const match = /script-src 'nonce-([^']+)'/.exec(html);
    assert.ok(match, "CSP has no script nonce");
    assert.ok(html.includes(`<script nonce="${match[1]}">`), "bridge script does not share the CSP nonce");
    assert.ok(html.includes("default-src 'none'"));
  });

  it("lays the iframe out with flex instead of a viewport calculation", () => {
    const html = renderPanelHtml(info());
    assert.ok(html.includes("flex: 1 1 auto"));
    assert.ok(html.includes("min-height: 0"));
    assert.ok(!html.includes("calc(100vh"));
  });

  it("validates the message origin against the exact admin origin", () => {
    const html = renderPanelHtml(info());
    assert.ok(html.includes('var ORIGIN = "http://127.0.0.1:8899";'));
    assert.ok(html.includes("event.origin !== ORIGIN"));
  });

  it("leaves ORIGIN null when the server is stopped", () => {
    const html = renderPanelHtml(info({ status: { state: "stopped", port: null, message: null } }));
    assert.ok(html.includes("var ORIGIN = null;"));
  });
});

describe("AdminPanel", () => {
  beforeEach(() => {
    createdWebviewPanels.length = 0;
    delete process.env.KB_MCP_PANEL_READY_FILE;
  });
  afterEach(() => {
    delete process.env.KB_MCP_PANEL_READY_FILE;
  });

  it("enables scripts and skips a re-render when the URL is unchanged", () => {
    const panel = new AdminPanel();
    panel.show(info());
    const fake = createdWebviewPanels[0];
    assert.equal(fake.options.enableScripts, true);
    assert.equal(fake.htmlSets, 1);

    panel.update(info({ status: { state: "running-own", port: 8899, message: "refreshed" } }));
    assert.equal(fake.htmlSets, 1, "an unchanged URL must not replace webview.html");

    panel.update(info({ status: { state: "running-own", port: 9900, message: null } }));
    assert.equal(fake.htmlSets, 2, "a new port must rebuild");

    panel.show(info({ status: { state: "running-own", port: 9900, message: null } }));
    assert.equal(fake.htmlSets, 2, "show with the same URL only reveals");
    assert.ok(fake.revealCount >= 2);
    panel.dispose();
  });

  it("stores the ready payload and writes the test hook file", () => {
    const file = path.join(os.tmpdir(), `hyseed-panel-ready-${process.pid}-${Date.now()}.json`);
    process.env.KB_MCP_PANEL_READY_FILE = file;
    const panel = new AdminPanel();
    panel.show(info());
    const fake = createdWebviewPanels[0];
    const payload = { type: "hyseed-admin-ready", navCount: 11, hasPalette: true, apiOk: true };
    fake.fireMessage({ type: "hyseed-admin-ready", payload });
    assert.deepEqual(panel.lastReady, payload);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), payload);
    fs.rmSync(file, { force: true });

    panel.dispose();
    panel.show(info());
    assert.equal(createdWebviewPanels.length, 2, "dispose resets the panel so show creates a new one");
    panel.dispose();
  });
});