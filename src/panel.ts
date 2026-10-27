import * as vscode from "vscode";
import { PANEL_TITLE, PANEL_VIEW_TYPE } from "./constants";
import type { RuntimeResolution } from "./runtime";
import type { ServerStatus } from "./server";

export interface PanelInfo {
  status: ServerStatus;
  dataRoot: string;
  runtime: RuntimeResolution | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderPanelHtml(info: PanelInfo): string {
  const { status, dataRoot, runtime } = info;
  const running = status.state === "running-own" || status.state === "running-external";
  const url = running && status.port !== null ? `http://127.0.0.1:${status.port}/` : null;

  const bar = [
    `<span><b>hyseed</b>: ${escapeHtml(status.state)}</span>`,
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline';">
<title>${escapeHtml(PANEL_TITLE)}</title>
<style>
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .bar { padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .bar span { margin-right: 16px; }
  iframe { border: 0; width: 100%; height: calc(100vh - 32px); display: block; }
  .guide { padding: 24px; max-width: 640px; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; }
</style>
</head>
<body>
<div class="bar">${bar}</div>
${content}
</body>
</html>`;
}

export class AdminPanel {
  private panel: vscode.WebviewPanel | undefined;

  show(info: PanelInfo): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, PANEL_TITLE, vscode.ViewColumn.Active, {
        enableScripts: false,
        retainContextWhenHidden: false,
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.webview.html = renderPanelHtml(info);
    this.panel.reveal();
  }

  update(info: PanelInfo): void {
    if (this.panel) {
      this.panel.webview.html = renderPanelHtml(info);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}