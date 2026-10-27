import * as assert from "node:assert/strict";
import { renderPanelHtml, type PanelInfo } from "../../panel";

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
    assert.ok(html.includes("C:\\tools\\hyseed.exe"));
    assert.ok(html.includes("C:\\sandbox"));
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
  });

  it("escapes error messages", () => {
    const html = renderPanelHtml(info({ status: { state: "error", port: 8899, message: "<boom>" } }));
    assert.ok(html.includes("&lt;boom&gt;"));
    assert.ok(!html.includes("<boom>"));
  });
});