import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { COMMANDS } from "./constants";
import { logLine } from "./log";
import { fetchVaults, runSearch, switchVault, type SearchParams } from "./search";
import type { ServerStatus } from "./server";

export interface LauncherHtmlOptions {
  iconUri: vscode.Uri;
  nonce: string;
}

/**
 * Sidebar panel: search + quick actions. The admin console and result documents
 * open in VS Code's built-in Simple Browser, never in the extension's own panel.
 */
export function renderLauncherHtml(
  webview: vscode.Webview,
  options: LauncherHtmlOptions
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    padding: 12px;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.45;
  }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  header img { width: 32px; height: 32px; border-radius: 8px; display: block; }
  h1 { margin: 0; font-size: 14px; line-height: 1.2; font-weight: 600; }
  header p { margin: 2px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px; }

  .primary {
    display: block; width: 100%; padding: 7px 10px; border: 0; border-radius: 2px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font: inherit; cursor: pointer; text-align: center;
  }
  .primary:hover { background: var(--vscode-button-hoverBackground); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0 14px; }
  .secondary {
    display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px;
    padding: 5px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 2px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    font: inherit; cursor: pointer; text-align: left; text-decoration: none;
  }
  .secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
  }
  .secondary svg { width: 14px; height: 14px; flex: none; opacity: .9; }
  .secondary span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .section-title {
    display: flex; align-items: center; gap: 8px; margin: 0 0 8px;
    color: var(--vscode-descriptionForeground); font-size: 10.5px; letter-spacing: .08em;
    text-transform: uppercase;
  }
  .section-title::after { content: ""; flex: 1; height: 1px; background: var(--vscode-panel-border); }

  .field { display: block; margin-bottom: 8px; }
  .field > span { display: block; margin-bottom: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; }
  input, select {
    width: 100%; height: 26px; padding: 3px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 2px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    font: inherit; outline: none;
  }
  select {
    background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border-color: var(--vscode-dropdown-border, var(--vscode-panel-border));
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  .row { display: grid; grid-template-columns: 1fr 84px; gap: 8px; }

  details { margin: 1px 0 8px; }
  summary { cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 11px; list-style: none; user-select: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "▾ "; }
  details:not([open]) summary::before { content: "▸ "; }
  .details-body { padding-top: 8px; }

  .search-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; padding: 6px; border: 0; border-radius: 2px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font: inherit; cursor: pointer;
  }
  .search-btn:hover { background: var(--vscode-button-hoverBackground); }
  .search-btn:disabled { opacity: .6; cursor: default; }
  .search-btn svg { width: 13px; height: 13px; }

  .status { min-height: 16px; margin: 8px 0 6px; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .status.ok { color: var(--vscode-testing-iconPassed, #89d185); }
  .status.err { color: var(--vscode-errorForeground, #f48771); }

  .results { display: flex; flex-direction: column; gap: 6px; }
  .hit {
    display: block; width: 100%; padding: 8px; text-align: left; font: inherit;
    white-space: normal;
    border: 1px solid var(--vscode-panel-border); border-radius: 3px;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    color: var(--vscode-foreground); cursor: pointer;
  }
  .hit:hover { background: var(--vscode-list-hoverBackground); }
  .hit-head { display: flex; align-items: baseline; gap: 8px; }
  .hit-title {
    flex: 1; min-width: 0; font-weight: 600; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .score {
    flex: none; padding: 1px 6px; border-radius: 9px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px;
  }
  .hit-meta {
    display: block; margin-top: 2px; color: var(--vscode-descriptionForeground);
    font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hit-snippet { display: block; margin-top: 5px; font-size: 11px; line-height: 1.4; }

  .empty {
    padding: 14px 8px; text-align: center; color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-panel-border); border-radius: 3px;
  }
  .hint { margin: 10px 0 0; color: var(--vscode-descriptionForeground); font-size: 10.5px; }
</style>
</head>
<body>
<header>
  <img src="${options.iconUri.toString()}" alt="hyseed">
  <div>
    <h1>hyseed</h1>
    <p>Local knowledge base</p>
  </div>
</header>

<button id="open-admin" class="primary" type="button" title="Open the admin console in VS Code's built-in browser">Open admin console</button>

<div class="grid">
  <a class="secondary" href="command:${COMMANDS.createVault}" title="Create vault">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
    <span>Create</span>
  </a>
  <a class="secondary" href="command:${COMMANDS.installAgentSkills}" title="Install MCP definitions and agent skills">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"/></svg>
    <span>Install MCP/skills</span>
  </a>
  <a class="secondary" href="command:${COMMANDS.cliDoctor}" title="Run the hyseed doctor">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8h3l1.5-3 2.5 6 1.5-3h4.5"/></svg>
    <span>Doctor</span>
  </a>
  <button id="open-settings" class="secondary" type="button" title="Open hyseed extension settings">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 5h10M3 11h10M6 3v4M10 9v4"/></svg>
    <span>Settings</span>
  </button>
</div>

<form id="search-form">
  <div class="section-title">Search</div>

  <label class="field">
    <span>Knowledge base</span>
    <select id="vault"><option value="">Loading knowledge bases…</option></select>
  </label>

  <label class="field">
    <span>Query</span>
    <input id="query" type="text" placeholder="Search the knowledge base…" autocomplete="off" spellcheck="false">
  </label>

  <div class="row">
    <label class="field">
      <span>Mode</span>
      <select id="mode">
        <option value="hybrid">hybrid</option>
        <option value="lexical">lexical</option>
        <option value="fuzzy">fuzzy</option>
        <option value="semantic">semantic</option>
        <option value="rrf">rrf</option>
      </select>
    </label>
    <label class="field">
      <span>Limit</span>
      <input id="limit" type="number" min="1" max="100" step="1" value="10">
    </label>
  </div>

  <details open>
    <summary>Filters</summary>
    <div class="details-body">
      <label class="field">
        <span>Type</span>
        <input id="type" type="text" placeholder="any type" autocomplete="off" spellcheck="false">
      </label>
      <label class="field">
        <span>Tags</span>
        <input id="tags" type="text" placeholder="comma,separated" autocomplete="off" spellcheck="false">
      </label>
    </div>
  </details>

  <button id="search" class="search-btn" type="submit">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/></svg>
    Search
  </button>
</form>

<div id="status" class="status" role="status">Starting the admin server…</div>
<div id="results" class="results"></div>
<p class="hint">Admin console and results open in VS Code's built-in browser. Switching the knowledge base changes the global current vault.</p>

<script nonce="${options.nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = function (id) { return document.getElementById(id); };
  const vaultSelect = $("vault");
  const queryInput = $("query");
  const modeSelect = $("mode");
  const limitInput = $("limit");
  const typeInput = $("type");
  const tagsInput = $("tags");
  const searchButton = $("search");
  const statusEl = $("status");
  const resultsEl = $("results");
  let currentVault = "";
  let pending = 0;
  let busy = false;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(value) {
    busy = value;
    searchButton.disabled = value;
  }

  function stripTags(value) {
    return String(value || "").replace(/<[^>]*>/g, "");
  }

  function renderVaults(data) {
    const vaults = Array.isArray(data.vaults) ? data.vaults : [];
    vaultSelect.replaceChildren();
    for (let i = 0; i < vaults.length; i++) {
      const vault = vaults[i];
      const option = document.createElement("option");
      option.value = vault.name;
      option.textContent = vault.name;
      if (vault.description) option.title = vault.description;
      vaultSelect.appendChild(option);
    }
    currentVault = data.current || (vaults.length ? vaults[0].name : "");
    if (currentVault) {
      vaultSelect.value = currentVault;
      setStatus("Current knowledge base: " + currentVault);
    } else {
      setStatus("No knowledge bases found. Create one to get started.", "err");
    }
  }

  function renderResults(data) {
    const hits = Array.isArray(data.hits) ? data.hits : [];
    resultsEl.replaceChildren();
    if (hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No results. Try fuzzy or hybrid mode, or fewer filters.";
      resultsEl.appendChild(empty);
      setStatus("0 results", "ok");
      return;
    }
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i] || {};
      const doc = hit.doc || {};
      const card = document.createElement("button");
      card.type = "button";
      card.className = "hit";
      card.title = "Open " + (doc.title || doc.id) + " in the built-in browser";

      const head = document.createElement("span");
      head.className = "hit-head";
      const title = document.createElement("span");
      title.className = "hit-title";
      title.textContent = doc.title || doc.id || "(untitled)";
      head.appendChild(title);
      if (typeof hit.score === "number") {
        const score = document.createElement("span");
        score.className = "score";
        score.textContent = hit.score.toFixed(3);
        head.appendChild(score);
      }

      const meta = document.createElement("span");
      meta.className = "hit-meta";
      meta.textContent = (doc.type || "doc") + " · " + (doc.id || "");

      const snippet = document.createElement("span");
      snippet.className = "hit-snippet";
      snippet.textContent = stripTags(hit.snippet) || stripTags((doc.body || "").slice(0, 180));

      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(snippet);
      card.addEventListener("click", function () {
        vscode.postMessage({ type: "openDocument", id: doc.id });
      });
      resultsEl.appendChild(card);
    }
    const count = typeof data.count === "number" ? data.count : hits.length;
    setStatus(count + (count === 1 ? " result" : " results") + (currentVault ? " · " + currentVault : ""), "ok");
  }

  $("open-admin").addEventListener("click", function () {
    vscode.postMessage({ type: "openAdmin" });
  });

  $("open-settings").addEventListener("click", function () {
    vscode.postMessage({ type: "openSettings" });
  });

  vaultSelect.addEventListener("change", function () {
    if (!vaultSelect.value) return;
    setStatus("Switching to " + vaultSelect.value + "…");
    vscode.postMessage({ type: "switchVault", name: vaultSelect.value });
  });

  $("search-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;
    const query = queryInput.value.trim();
    if (!query) {
      setStatus("Enter a query to search.", "err");
      queryInput.focus();
      return;
    }
    pending += 1;
    setBusy(true);
    setStatus("Searching…");
    vscode.postMessage({
      type: "search",
      requestId: pending,
      params: {
        query: query,
        vault: vaultSelect.value || undefined,
        mode: modeSelect.value,
        limit: Number(limitInput.value),
        type: typeInput.value,
        tags: tagsInput.value
      }
    });
  });

  window.addEventListener("message", function (event) {
    const message = event.data || {};
    if (message.type === "vaults") {
      renderVaults(message.data || {});
    } else if (message.type === "vault") {
      currentVault = message.current || currentVault;
      if (currentVault) vaultSelect.value = currentVault;
      setStatus("Current knowledge base: " + currentVault);
    } else if (message.type === "results") {
      if (message.requestId !== pending) return;
      setBusy(false);
      renderResults(message.data || {});
    } else if (message.type === "error") {
      if (typeof message.requestId === "number" && message.requestId !== pending) return;
      setBusy(false);
      if (currentVault) vaultSelect.value = currentVault;
      setStatus(message.message || "Something went wrong.", "err");
    }
  });

  vscode.postMessage({ type: "ready" });
})();
</script>
</body>
</html>`;
}

function asSearchParams(value: unknown): SearchParams | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.query !== "string") return null;
  const params: SearchParams = { query: input.query };
  if (typeof input.vault === "string") params.vault = input.vault;
  if (typeof input.type === "string") params.type = input.type;
  if (typeof input.tags === "string") params.tags = input.tags;
  if (typeof input.mode === "string") params.mode = input.mode;
  if (typeof input.limit === "number") params.limit = input.limit;
  return params;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keep "/" as a path separator; encode each document-id segment. */
export function documentUrl(port: number, id: string): string {
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  return `http://127.0.0.1:${port}/documents/${encoded}`;
}

async function openInSimpleBrowser(url: string): Promise<void> {
  const uri = vscode.Uri.parse(url);
  try {
    await vscode.commands.executeCommand("simpleBrowser.api.open", uri);
  } catch (error) {
    logLine(`simpleBrowser.api.open unavailable (${errorText(error)}); opening in the system browser`);
    await vscode.env.openExternal(uri);
  }
}

export interface LauncherDeps {
  extensionId: string;
  ensureRunning: () => Promise<ServerStatus>;
}

export class AdminLauncherViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentVault = "";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: LauncherDeps
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: true };
    const nonce = randomUUID().replace(/-/g, "");
    const iconUri = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "icon.png")
    );
    view.webview.html = renderLauncherHtml(view.webview, { iconUri, nonce });

    const messageSub = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) void this.refreshVaults();
    });
    view.onDidDispose(() => {
      messageSub.dispose();
      visibilitySub.dispose();
      if (this.view === view) this.view = undefined;
    });

    // Start (or reuse) the admin server without stealing focus. The webview asks
    // for vaults once its message listener is installed.
    void this.deps.ensureRunning().catch(() => undefined);
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case "ready":
        await this.refreshVaults();
        return;
      case "openAdmin":
        await this.openAdmin();
        return;
      case "openSettings":
        try {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            `@ext:${this.deps.extensionId}`
          );
        } catch (error) {
          this.postError(error);
        }
        return;
      case "switchVault":
        if (typeof message.name === "string" && message.name) {
          await this.switchTo(message.name);
        }
        return;
      case "search": {
        const params = asSearchParams(message.params);
        const requestId = typeof message.requestId === "number" ? message.requestId : 0;
        if (!params) {
          this.post({ type: "error", requestId, message: "invalid search request" });
          return;
        }
        await this.search(params, requestId);
        return;
      }
      case "openDocument":
        if (typeof message.id === "string" && message.id) {
          await this.openDocument(message.id);
        }
        return;
    }
  }

  private async port(): Promise<number> {
    const status = await this.deps.ensureRunning();
    if (status.port === null) {
      throw new Error(status.message ?? "hyseed admin server did not start");
    }
    return status.port;
  }

  private async refreshVaults(): Promise<void> {
    try {
      const data = await fetchVaults(await this.port());
      this.currentVault = data.current;
      this.post({ type: "vaults", data });
    } catch (error) {
      this.postError(error);
    }
  }

  private async openAdmin(): Promise<void> {
    try {
      const port = await this.port();
      await openInSimpleBrowser(`http://127.0.0.1:${port}/`);
    } catch (error) {
      this.postError(error);
    }
  }

  private async switchTo(name: string): Promise<void> {
    try {
      this.currentVault = await switchVault(await this.port(), name);
      this.post({ type: "vault", current: this.currentVault });
    } catch (error) {
      this.postError(error);
    }
  }

  private async search(params: SearchParams, requestId: number): Promise<void> {
    try {
      const outcome = await runSearch(await this.port(), params, this.currentVault, {
        onVaultChanged: (current) => {
          this.currentVault = current;
          this.post({ type: "vault", current });
        },
      });
      this.currentVault = outcome.current;
      this.post({ type: "results", requestId, data: outcome.result });
    } catch (error) {
      this.postError(error, requestId);
    }
  }

  private async openDocument(id: string): Promise<void> {
    try {
      const port = await this.port();
      await openInSimpleBrowser(documentUrl(port, id));
    } catch (error) {
      this.postError(error);
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private postError(error: unknown, requestId?: number): void {
    const message: Record<string, unknown> = {
      type: "error",
      message: errorText(error),
    };
    if (requestId !== undefined) message.requestId = requestId;
    this.post(message);
  }
}