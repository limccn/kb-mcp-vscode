import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as vscode from "vscode";
import { PANEL_TITLE, PANEL_VIEW_TYPE } from "./constants";
import { adminBaseUrl, parseHost } from "./host";
import type { RuntimeResolution } from "./runtime";
import type { ServerStatus } from "./server";

export interface PanelInfo {
  status: ServerStatus;
  dataRoot: string;
  runtime: RuntimeResolution | null;
}

/** Test hook: the integration test points this at a temp file. */
const READY_FILE_ENV = "KB_MCP_PANEL_READY_FILE";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The iframe URL, or null when the server has no port. */
function panelUrl(status: ServerStatus): string | null {
  const running = status.state === "running-own" || status.state === "running-external";
  const base = running ? adminBaseUrl(status) : null;
  return base === null ? null : `${base}/`;
}

const BRIDGE = (origin: string | null, nonce: string): string => `
<script nonce="${nonce}">
(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  var vscode = (function () {
    try { return acquireVsCodeApi(); } catch (e) { return null; }
  })();
  window.addEventListener("message", function (event) {
    // Exact origin match: a nested page cannot forge the admin origin.
    if (!ORIGIN || event.origin !== ORIGIN) return;
    var msg = event.data;
    if (!msg || msg.type !== "hyseed-admin-ready") return;
    document.body.dataset.adminReady = "1";
    if (vscode) vscode.postMessage({ type: "hyseed-admin-ready", payload: msg });
  });
})();
</script>`;

export function renderPanelHtml(info: PanelInfo): string {
  const { status, dataRoot, runtime } = info;
  const url = panelUrl(status);
  const origin = url === null ? null : url.slice(0, -1);
  const frameOrigin = origin === null ? "'none'" : `http://${parseHost(status.host).urlHost}:*`;
  const nonce = randomBytes(16).toString("base64");

  const bar = [
    `<span><b>hyseed</b>: ${escapeHtml(status.state)}</span>`,
    `<span>host: ${escapeHtml(status.host ?? "127.0.0.1")}</span>`,
    `<span>port: ${status.port ?? "—"}</span>`,
    `<span>data root: ${escapeHtml(dataRoot || "(runtime default)")}</span>`,
    `<span>runtime: ${escapeHtml(runtime ? `${runtime.exePath} (${runtime.version})` : "not resolved")}</span>`,
    status.message ? `<span>note: ${escapeHtml(status.message)}</span>` : "",
  ].join("");

  let content: string;
  if (url !== null) {
    content = `<iframe src="${url}" title="hyseed admin"></iframe>`;
  } else if (status.state === "error") {
    content =
      `<div class="guide"><h2>hyseed admin failed to start</h2>` +
      `<p>${escapeHtml(status.message ?? "unknown error")}</p>` +
      `<p>Try <code>hyseed: Restart admin server</code> or check <code>hyseed: Show logs</code>.</p></div>`;
  } else {
    content =
      `<div class="guide"><h2>hyseed admin is not running</h2>` +
      `<p>Run <code>hyseed: Open admin console</code> or <code>hyseed: Start admin server</code>.</p></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${frameOrigin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>${escapeHtml(PANEL_TITLE)}</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .bar { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  iframe { flex: 1 1 auto; min-height: 0; width: 100%; border: 0; display: block; }
  .guide { padding: 24px; max-width: 640px; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; }
</style>
</head>
<body>
<div class="bar">${bar}</div>
${content}
${BRIDGE(origin, nonce)}
</body>
</html>`;
}

export class AdminPanel {
  private panel: vscode.WebviewPanel | undefined;
  private rendered = false;
  private renderedUrl: string | null = null;
  private ready: unknown = null;

  /** Last `hyseed-admin-ready` payload, for tests and diagnostics. */
  get lastReady(): unknown {
    return this.ready;
  }

  show(info: PanelInfo): void {
    let panel = this.panel;
    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        PANEL_VIEW_TYPE,
        PANEL_TITLE,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: false }
      );
      panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = undefined;
          this.rendered = false;
          this.renderedUrl = null;
        }
      });
      this.panel = panel;
    }
    const url = panelUrl(info.status);
    if (!this.rendered || url !== this.renderedUrl) {
      panel.webview.html = renderPanelHtml(info);
      this.rendered = true;
      this.renderedUrl = url;
    }
    panel.reveal();
  }

  update(info: PanelInfo): void {
    if (!this.panel) return;
    const url = panelUrl(info.status);
    // Replacing webview.html reloads the iframe and loses page state; an
    // unchanged URL (a status refresh) must only be ignored.
    if (this.rendered && url === this.renderedUrl) return;
    this.panel.webview.html = renderPanelHtml(info);
    this.rendered = true;
    this.renderedUrl = url;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.rendered = false;
    this.renderedUrl = null;
  }

  private handleMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    if (message.type !== "hyseed-admin-ready") return;
    this.ready = message.payload ?? null;
    const file = process.env[READY_FILE_ENV];
    if (file) {
      try {
        writeFileSync(file, JSON.stringify(this.ready));
      } catch {
        // Test-only hook; a failed write must not break the panel.
      }
    }
  }
}