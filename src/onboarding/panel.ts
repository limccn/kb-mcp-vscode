/**
 * Singleton setup-guide webview: three steps (CLI tools, MCP & skills, data
 * folder), nonce/CSP locked down, no external resources, keyboard focusable.
 * The panel only renders state and dispatches actions — every write lives in
 * `actions.ts`.
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { ONBOARDING_TITLE, ONBOARDING_VIEW_TYPE } from "../constants";
import type { OnboardingActions } from "./actions";
import {
  DEFAULT_STEPS,
  parseOnboardingSteps,
  type OnboardingReason,
  type OnboardingSteps,
} from "./state";

export interface OnboardingPanelDeps {
  actions: OnboardingActions;
  version: string;
  log(message: string): void;
}

export interface OnboardingPanelSnapshot {
  open: boolean;
  reason: OnboardingReason | null;
  /** Panels created through this instance (singleton check). */
  creations: number;
}

export function renderOnboardingHtml(options: { nonce: string; version: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
<title>${ONBOARDING_TITLE}</title>
<style>
  body { margin: 0; padding: 16px 20px 24px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  h1 { font-size: 1.3em; margin: 0 0 4px; }
  .sub { margin: 0 0 4px; color: var(--vscode-descriptionForeground); font-size: 12px; }
  #status { min-height: 1.4em; margin: 8px 0 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  #status[data-level="error"] { color: var(--vscode-errorForeground); }
  .step { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 14px; margin: 0 0 12px; }
  .step-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .step-title { font-weight: 600; }
  .step-head label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  input[type="checkbox"] { accent-color: var(--vscode-focusBorder); }
  .hint { margin: 6px 0 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
  .badge { font-size: 11px; padding: 1px 8px; border-radius: 9px; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  .badge[data-tone="done"] { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
  .badge[data-tone="error"] { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; word-break: break-all; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 3px; padding: 5px 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  footer { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
  footer .hint { margin: 0; }
</style>
</head>
<body>
<main id="guide" role="region" aria-label="hyseed setup guide">
  <header>
    <h1>hyseed setup guide</h1>
    <p class="sub" id="version-line">Version ${options.version} — set up the parts you want; skip anything you do not need.</p>
    <p class="sub">Skip and closing this tab apply the data defaults only; install steps never run automatically. Reopen from the Command Palette (<code>hyseed: Setup guide</code>) or the sidebar menu.</p>
  </header>
  <div id="status" role="status" aria-live="polite"></div>

  <section class="step" id="step-cli" aria-labelledby="step-cli-title">
    <div class="step-head">
      <label><input type="checkbox" id="step-cli-enabled"${DEFAULT_STEPS.cli ? " checked" : ""}> <span class="step-title" id="step-cli-title">1. Install CLI tools</span></label>
      <span class="badge" id="step-cli-badge">pending</span>
    </div>
    <p class="hint">Copies the bundled hyseed.exe and doc-convert.exe into ~/.local/bin. PATH is only inspected, never modified.</p>
    <ul class="list" id="cli-tools"></ul>
    <p class="hint" id="cli-path"></p>
    <p class="hint" id="cli-message" hidden></p>
    <div class="actions"><button type="button" id="run-cli">Install CLI tools</button></div>
  </section>

  <section class="step" id="step-mcp" aria-labelledby="step-mcp-title">
    <div class="step-head">
      <label><input type="checkbox" id="step-mcp-enabled"${DEFAULT_STEPS.mcp ? " checked" : ""}> <span class="step-title" id="step-mcp-title">2. Install MCP &amp; skills</span></label>
      <span class="badge" id="step-mcp-badge">not selected</span>
    </div>
    <p class="hint">Opt-in. The Install button reuses the agent/scope prompts; entries point at the stable executable and carry KB_MCP_HOME.</p>
    <ul class="list" id="mcp-targets"></ul>
    <p class="hint" id="mcp-message" hidden></p>
    <div id="legacy-box" hidden>
      <p class="hint" id="legacy-summary"></p>
      <div class="actions"><button type="button" class="secondary" id="cleanup-legacy">Clean up old entries…</button></div>
    </div>
    <div class="actions"><button type="button" id="run-mcp">Install MCP &amp; skills</button></div>
  </section>

  <section class="step" id="step-data" aria-labelledby="step-data-title">
    <div class="step-head">
      <span class="step-title" id="step-data-title">3. Data folder</span>
      <span class="badge" id="step-data-badge">pending</span>
    </div>
    <p class="hint">Effective root: <code id="data-root">(unknown)</code></p>
    <p class="hint">config.yaml data_dir: <code id="data-config">(unset)</code></p>
    <p class="hint" id="data-pin" hidden></p>
    <p class="hint" id="data-candidates" hidden></p>
    <p class="hint" id="data-message" hidden></p>
    <div class="actions">
      <button type="button" id="change-data-dir">Change…</button>
      <button type="button" class="secondary" id="open-settings" hidden>Open settings</button>
      <button type="button" class="secondary" id="review-migration" hidden>Review migration</button>
    </div>
  </section>

  <footer>
    <button type="button" class="secondary" id="skip">Skip</button>
    <button type="button" id="finish">Finish</button>
    <span class="hint">Skip / close: data defaults only.</span>
  </footer>
</main>
<script nonce="${options.nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function show(id, visible) { var el = $(id); if (el) el.hidden = !visible; }
  function clearList(id) { var el = $(id); while (el && el.firstChild) el.removeChild(el.firstChild); }
  function addItem(id, text) {
    var list = $(id);
    if (!list) return;
    var item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  }
  function badge(id, text, tone) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.setAttribute("data-tone", tone || "");
  }
  function toolLabel(tool) {
    if (tool.state === "up-to-date") return tool.name + " — up to date";
    if (tool.state === "outdated") return tool.name + " — will be replaced";
    if (tool.state === "missing") return tool.name + " — not installed";
    return tool.name + " — unknown";
  }
  function renderCli(cli) {
    clearList("cli-tools");
    if (cli.status === "unavailable") {
      badge("step-cli-badge", "unavailable", "error");
      setText("cli-path", "");
      setText("cli-message", cli.message || "CLI tool state is unavailable");
      show("cli-message", true);
      return;
    }
    var pending = 0;
    for (var i = 0; i < cli.tools.length; i += 1) {
      if (cli.tools[i].state !== "up-to-date") pending += 1;
      addItem("cli-tools", toolLabel(cli.tools[i]));
    }
    badge("step-cli-badge", pending === 0 ? "done" : "pending", pending === 0 ? "done" : "");
    setText("cli-path", cli.pathHint);
    show("cli-message", false);
  }
  function renderMcp(mcp) {
    clearList("mcp-targets");
    if (mcp.status === "unavailable") {
      badge("step-mcp-badge", "unavailable", "error");
      setText("mcp-message", mcp.message || "skills state is unavailable");
      show("mcp-message", true);
      return;
    }
    var installed = 0;
    for (var i = 0; i < mcp.targets.length; i += 1) {
      var target = mcp.targets[i];
      if (target.mcp === "present") installed += 1;
      addItem("mcp-targets", target.agent + "/" + target.scope + " — MCP entry: " + target.mcp);
    }
    badge("step-mcp-badge", installed > 0 ? "configured" : "not installed", installed > 0 ? "done" : "");
    show("mcp-message", false);
    var legacy = mcp.legacy || [];
    if (legacy.length === 0) {
      show("legacy-box", false);
      return;
    }
    var names = [];
    for (var j = 0; j < legacy.length; j += 1) {
      var entry = legacy[j];
      var parts = [];
      if (entry.skills.length > 0) parts.push("skills: " + entry.skills.join(", "));
      if (entry.mcp !== "absent") parts.push("MCP entry: " + entry.mcp);
      names.push(entry.agent + "/" + entry.scope + " (" + parts.join("; ") + ")");
    }
    setText("legacy-summary", "Pre-rename entries found: " + names.join(", "));
    show("legacy-box", true);
  }
  function renderData(data) {
    setText("data-root", data.dataRoot || "(unknown)");
    setText("data-config", data.configDataDir || "(unset)");
    badge(
      "step-data-badge",
      data.status === "ready" ? (data.initialized ? "ready" : "fresh") : "unavailable",
      data.status === "ready" ? "done" : "error"
    );
    var pinned = data.pinnedBy;
    show("data-pin", pinned !== null);
    show("open-settings", pinned !== null);
    if (pinned === "setting") {
      setText("data-pin", "The 'kbMcp.dataRoot' setting overrides the data folder; Change… is disabled. Clear the setting to use the default.");
    } else if (pinned === "env") {
      setText("data-pin", "The KB_MCP_HOME variable overrides the data folder; Change… is disabled. Clear the variable to use the default.");
    }
    var change = $("change-data-dir");
    if (change) change.disabled = pinned !== null;
    var candidates = data.candidates || [];
    show("review-migration", candidates.length > 0);
    show("data-candidates", candidates.length > 0);
    if (candidates.length > 0) {
      var parts = [];
      for (var i = 0; i < candidates.length; i += 1) {
        var candidate = candidates[i];
        parts.push(
          candidate.path + " (" + candidate.vaults + " vault(s), " +
          (candidate.documents === null ? "documents unreadable" : candidate.documents + " document(s)") + ")"
        );
      }
      setText("data-candidates", "Legacy data: " + parts.join("; ") + ". Migration is handled by the upgrade check.");
    }
    show("data-message", data.status !== "ready");
    if (data.status !== "ready") setText("data-message", data.message || "data folder state is unavailable");
  }
  function render(next) {
    renderCli(next.cli);
    renderMcp(next.mcp);
    renderData(next.data);
  }
  function busy(step, active) {
    $("run-cli").disabled = active;
    $("run-mcp").disabled = active;
    $("finish").disabled = active;
    $("skip").disabled = active;
    var change = $("change-data-dir");
    var pinned = $("data-pin") && $("data-pin").hidden === false;
    if (change) change.disabled = active || pinned;
    $("open-settings").disabled = active;
    $("review-migration").disabled = active;
    if (active) setText("status", "Working on " + step + "…");
  }
  function steps() {
    return { cli: $("step-cli-enabled").checked, mcp: $("step-mcp-enabled").checked };
  }
  function send(message) { vscode.postMessage(message); }
  $("run-cli").addEventListener("click", function () { send({ type: "run", step: "cli" }); });
  $("run-mcp").addEventListener("click", function () { send({ type: "run", step: "mcp" }); });
  $("change-data-dir").addEventListener("click", function () { send({ type: "chooseDataDir" }); });
  $("open-settings").addEventListener("click", function () { send({ type: "openSettings" }); });
  $("review-migration").addEventListener("click", function () { send({ type: "reviewMigration" }); });
  $("cleanup-legacy").addEventListener("click", function () { send({ type: "cleanupLegacyMcp" }); });
  $("skip").addEventListener("click", function () { send({ type: "finish", skipped: true, steps: steps() }); });
  $("finish").addEventListener("click", function () { send({ type: "finish", skipped: false, steps: steps() }); });
  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message) return;
    if (message.type === "state") {
      render(message.state);
      setText("status", "");
    } else if (message.type === "busy") {
      busy(message.step, message.busy === true);
    } else if (message.type === "notice") {
      setText("status", message.message);
      $("status").setAttribute("data-level", message.level === "error" ? "error" : "info");
    }
  });
  send({ type: "ready" });
})();
</script>
</body>
</html>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OnboardingPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private reason: OnboardingReason | null = null;
  private creations = 0;

  constructor(private readonly deps: OnboardingPanelDeps) {}

  /** Open (or reveal) the singleton guide. */
  show(reason: OnboardingReason): void {
    this.reason = reason;
    const existing = this.panel;
    if (existing) {
      existing.reveal();
      void this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ONBOARDING_VIEW_TYPE,
      ONBOARDING_TITLE,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false }
    );
    this.creations += 1;
    panel.webview.html = renderOnboardingHtml({
      nonce: randomBytes(16).toString("base64"),
      version: this.deps.version,
    });
    panel.webview.onDidReceiveMessage((message) => {
      void this.dispatch(message).catch((error: unknown) => {
        this.deps.log(`onboarding: message failed: ${errorMessage(error)}`);
      });
    });
    panel.onDidDispose(() => {
      // An internally initiated dispose clears `this.panel` first, so this
      // handler only runs for a user closing the tab.
      if (this.panel !== panel) return;
      this.panel = undefined;
      // Closing is "seen, apply the defaults": no install steps, no migration.
      void this.deps.actions.handleClosed().catch((error: unknown) => {
        this.deps.log(`onboarding: close handler failed: ${errorMessage(error)}`);
      });
    });
    this.panel = panel;
    panel.reveal();
    // Fallback for hosts that load the HTML before the script's "ready" arrives.
    void this.refresh();
  }

  /** Test seam for message dispatch (also used by the integration drill). */
  async dispatch(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "run": {
        // Only the two declared steps may trigger a write; a malformed
        // message must never start an install by default.
        if (message.step !== "cli" && message.step !== "mcp") return;
        const step = message.step;
        this.postBusy(step, true);
        try {
          if (step === "cli") await this.deps.actions.runCliStep();
          else await this.deps.actions.runMcpStep();
        } finally {
          this.postBusy(step, false);
        }
        await this.refresh();
        return;
      }
      case "chooseDataDir":
        this.postBusy("data", true);
        try {
          await this.deps.actions.chooseDataDir();
        } finally {
          this.postBusy("data", false);
        }
        await this.refresh();
        return;
      case "reviewMigration":
        this.postBusy("data", true);
        try {
          await this.deps.actions.reviewMigration();
        } finally {
          this.postBusy("data", false);
        }
        await this.refresh();
        return;
      case "openSettings":
        await this.deps.actions.openSettings();
        return;
      case "cleanupLegacyMcp":
        this.postBusy("mcp", true);
        try {
          await this.deps.actions.cleanupLegacyMcp();
        } finally {
          this.postBusy("mcp", false);
        }
        await this.refresh();
        return;
      case "finish": {
        const steps: OnboardingSteps = parseOnboardingSteps(message.steps);
        await this.deps.actions.finish(message.skipped === true, steps);
        this.closeInternal();
        return;
      }
      default:
        return;
    }
  }

  /** Re-read every step and push the state to the webview. */
  async refresh(): Promise<void> {
    try {
      const state = await this.deps.actions.collectState();
      this.post({ type: "state", state });
    } catch (error) {
      this.notice("error", `could not read setup state: ${errorMessage(error)}`);
    }
  }

  notice(level: "info" | "error", message: string): void {
    this.post({ type: "notice", level, message });
  }

  post(message: unknown): void {
    const panel = this.panel;
    if (!panel) return;
    void Promise.resolve(panel.webview.postMessage(message)).catch(() => undefined);
  }

  snapshotForTest(): OnboardingPanelSnapshot {
    return { open: this.panel !== undefined, reason: this.reason, creations: this.creations };
  }

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  dispose(): void {
    this.closeInternal();
  }

  private closeInternal(): void {
    const panel = this.panel;
    if (!panel) return;
    this.panel = undefined;
    panel.dispose();
  }

  private postBusy(step: "cli" | "mcp" | "data", busy: boolean): void {
    this.post({ type: "busy", step, busy });
  }
}