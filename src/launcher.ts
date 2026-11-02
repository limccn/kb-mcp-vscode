import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { COMMANDS } from "./constants";
import { SearchHistoryStore } from "./history";
import {
  IngestHttpError,
  createIngestBatch,
  fetchIngestLimits,
  listIngestJobs,
  planFileSelection,
  planFolderUpload,
  postIngestFile,
  startIngestBatch,
  type IngestJobSummary,
} from "./ingest";
import { adminBaseUrl, connectHost, DEFAULT_HOST, parseHost } from "./host";
import { logLine } from "./log";
import type { MigrationState } from "./migration";
import type { McpProviderHandle } from "./mcp/provider";
import {
  fetchVaults,
  httpJson,
  runSearch,
  switchVault,
  type HttpJson,
  type SearchParams,
} from "./search";
import type { ServerStatus } from "./server";
import { buildSnippetView } from "./snippet";

export interface LauncherHtmlOptions {
  nonce: string;
}

function isRunningStatus(status: ServerStatus): boolean {
  return status.state === "running-own" || status.state === "running-external";
}

/**
 * Sidebar panel: compact search plus a grouped action menu. The admin console and
 * result documents open in VS Code's built-in Simple Browser, never in the panel itself.
 */
export function renderLauncherHtml(options: LauncherHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  [hidden] { display: none !important; }
  :root { --fs-xs: 10px; --fs-sm: 11px; --fs-md: 12px; --fs-lg: 13px; }
  body {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.4;
  }

  #topbar {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; gap: 4px;
    padding: 4px 6px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  #status-chip {
    display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;
    color: var(--vscode-descriptionForeground); font-size: var(--fs-sm);
  }
  #status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #status-dot {
    width: 7px; height: 7px; border-radius: 50%; flex: none;
    background: var(--vscode-descriptionForeground);
  }
  #status-dot.running-own, #status-dot.running-external {
    background: var(--vscode-testing-iconPassed, #89d185);
  }
  #status-dot.starting, #status-dot.stopping { background: var(--vscode-charts-yellow, #cca700); }
  #status-dot.error { background: var(--vscode-errorForeground, #f48771); }
  #status-dot.setup { background: var(--vscode-charts-yellow, #cca700); }

  #setup-banner {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 8px;
    background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, .18));
    border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
    font-size: var(--fs-sm);
  }
  #setup-text { flex: 1; min-width: 0; }
  #setup-action {
    color: var(--vscode-textLink-foreground); text-decoration: none; white-space: nowrap;
  }
  #setup-action:hover { text-decoration: underline; }

  .actions { display: flex; align-items: center; gap: 2px; }
  .icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 3px;
    background: transparent; color: var(--vscode-foreground);
    cursor: pointer; text-decoration: none; opacity: .85;
  }
  .icon:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, .2)); opacity: 1; }
  .icon svg { width: 14px; height: 14px; }
  #btn-admin { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
  #btn-admin:hover { background: var(--vscode-button-hoverBackground); }

  #vault-row { padding: 6px 8px 0; }

  input, select {
    width: 100%; padding: 2px 6px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 2px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    font: inherit; outline: none;
  }
  select {
    background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border-color: var(--vscode-dropdown-border, var(--vscode-panel-border));
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  #vault { height: 28px; font-size: var(--fs-lg); }

  #search-form { padding: 6px 8px 0; }
  #query-row { position: relative; display: grid; grid-template-columns: 1fr 28px; gap: 4px; }
  #query { height: 26px; }
  #search {
    display: flex; align-items: center; justify-content: center;
    height: 26px; padding: 0; border: 0; border-radius: 2px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    cursor: pointer;
  }
  #search:hover { background: var(--vscode-button-hoverBackground); }
  #search:disabled { opacity: .6; cursor: default; }
  #search svg { width: 13px; height: 13px; }

  #options-row { display: flex; align-items: center; gap: 3px; margin-top: 6px; }
  .segmented {
    display: inline-flex; flex: none; overflow: hidden;
    border: 1px solid var(--vscode-panel-border); border-radius: 3px;
  }
  .seg {
    height: 26px; padding: 0 3px; border: 0; background: transparent;
    color: var(--vscode-foreground); font: inherit; font-size: var(--fs-md); cursor: pointer;
  }
  .seg + .seg { border-left: 1px solid var(--vscode-panel-border); }
  .seg[aria-checked="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .seg:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  #options-row .spacer { flex: 1; }
  #mode + #limit { margin-left: 2px; }
  @media (max-width: 297px) { #limit { display: none; } }
  #btn-filters { position: relative; flex: none; }
  #btn-filters[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, .2)); opacity: 1; }
  #btn-filters svg { width: 15px; height: 15px; }

  #filters { display: grid; gap: 4px; margin: 5px 0 0; }
  .count {
    padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    font-size: var(--fs-xs); line-height: 14px;
  }
  #btn-filters .count { position: absolute; top: -3px; right: -3px; min-width: 14px; text-align: center; }
  #type, #tags { height: 26px; font-size: var(--fs-md); }
  .link {
    justify-self: start; padding: 0; border: 0; background: none;
    color: var(--vscode-textLink-foreground); font-size: var(--fs-sm); cursor: pointer;
  }
  .link:hover { text-decoration: underline; }

  .history {
    position: absolute; top: 28px; left: 0; right: 32px; z-index: 30;
    max-height: 220px; overflow-y: auto;
    border: 1px solid var(--vscode-panel-border); border-radius: 2px;
    background: var(--vscode-dropdown-background, var(--vscode-sideBar-background));
    box-shadow: 0 2px 8px rgba(0, 0, 0, .3);
  }
  .history-row { display: flex; align-items: center; }
  .history-row.active .history-item, .history-item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .history-item {
    flex: 1; min-width: 0; padding: 4px 6px;
    border: 0; background: none; color: var(--vscode-foreground);
    font: inherit; font-size: var(--fs-md); text-align: left; cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .history-remove {
    flex: none; width: 20px; height: 20px; padding: 0;
    border: 0; background: none; color: var(--vscode-descriptionForeground);
    font-size: var(--fs-sm); cursor: pointer;
  }
  .history-remove:hover { color: var(--vscode-foreground); }
  .history-clear {
    display: block; width: 100%; padding: 3px 6px;
    border: 0; border-top: 1px solid var(--vscode-panel-border); background: none;
    color: var(--vscode-descriptionForeground); font-size: var(--fs-sm);
    text-align: left; cursor: pointer;
  }
  .history-clear:hover { color: var(--vscode-foreground); }
  .history-clear.confirm { color: var(--vscode-errorForeground, #f48771); }

  .status { min-height: 13px; padding: 5px 8px 0; color: var(--vscode-descriptionForeground); font-size: var(--fs-sm); }
  .status.ok { color: var(--vscode-testing-iconPassed, #89d185); }
  .status.err { color: var(--vscode-errorForeground, #f48771); }

  .ingest {
    display: flex; align-items: center; gap: 6px;
    margin: 4px 8px 0; padding: 3px 6px; border-radius: 2px;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    color: var(--vscode-descriptionForeground); font-size: var(--fs-sm);
  }
  .ingest.err { color: var(--vscode-errorForeground, #f48771); }
  .ingest.ok { color: var(--vscode-testing-iconPassed, #89d185); }
  #ingest-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spinner {
    width: 10px; height: 10px; flex: none; border-radius: 50%;
    border: 1.5px solid currentColor; border-right-color: transparent;
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .results { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 12px; }
  .hit {
    display: block; width: 100%; padding: 6px 7px; text-align: left; font: inherit;
    white-space: normal;
    border: 1px solid var(--vscode-panel-border); border-radius: 3px;
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    color: var(--vscode-foreground); cursor: pointer;
  }
  .hit:hover { background: var(--vscode-list-hoverBackground); }
  .hit-head { display: flex; align-items: baseline; gap: 6px; }
  .hit-title {
    flex: 1; min-width: 0; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .score {
    flex: none; padding: 0 5px; border-radius: 9px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: var(--fs-xs);
  }
  .hit-meta {
    display: block; margin-top: 1px; color: var(--vscode-descriptionForeground);
    font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hit-snippet {
    display: -webkit-box; margin-top: 3px; overflow: hidden;
    font-size: var(--fs-sm); line-height: 1.35; white-space: pre-wrap;
    -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  }
  .hit-snippet.expanded {
    display: block; -webkit-line-clamp: none;
    max-height: 13.5em; overflow-y: auto;
  }
  .hit-snippet strong {
    font-weight: 700;
    color: var(--vscode-list-highlightForeground, var(--vscode-textLink-foreground));
  }
  .snippet-actions { display: flex; justify-content: flex-end; margin-top: 2px; }
  .snippet-toggle {
    display: inline-block; padding: 0; border: 0; background: none;
    color: var(--vscode-textLink-foreground); font: inherit; font-size: var(--fs-sm);
    cursor: pointer;
  }
  .snippet-toggle:hover { text-decoration: underline; }
  .empty {
    padding: 12px 8px; text-align: center; color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-panel-border); border-radius: 3px;
  }

  #backdrop { position: fixed; inset: 0; z-index: 40; }
  #menu, #hitmenu {
    position: fixed; z-index: 50;
    padding: 4px 0; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    box-shadow: 0 4px 14px rgba(0, 0, 0, .35);
  }
  #menu {
    top: 32px; right: 6px;
    width: min(260px, calc(100vw - 16px)); max-height: calc(100vh - 40px); overflow-y: auto;
  }
  #hitmenu {
    min-width: 190px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
    overflow-y: auto;
  }
  .menu-title {
    padding: 5px 10px 2px; font-size: var(--fs-xs); letter-spacing: .06em;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
  }
  .menu-item {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 5px 10px; border: 0; background: none;
    color: inherit; font: inherit; font-size: var(--fs-md); text-align: left;
    text-decoration: none; cursor: pointer;
  }
  .menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .menu-item[aria-disabled="true"] { opacity: .5; cursor: default; }
  .menu-badge {
    margin-left: auto; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    font-size: var(--fs-xs); text-transform: none; letter-spacing: 0;
  }
  .menu-badge.ok { background: var(--vscode-testing-iconPassed, #89d185); color: #000; }
  .menu-badge.warn { background: var(--vscode-charts-yellow, #cca700); color: #000; }

  #jobs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    display: flex; flex-direction: column; max-height: 60vh;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    box-shadow: 0 -4px 14px rgba(0, 0, 0, .3);
  }
  .sheet-head {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border);
  }
  .sheet-head strong { flex: 1; font-size: var(--fs-md); font-weight: 600; }
  .mini {
    padding: 2px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 2px;
    background: var(--vscode-button-secondaryBackground, transparent); color: inherit;
    font: inherit; font-size: var(--fs-sm); cursor: pointer;
  }
  .mini:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .jobs-list { flex: 1; overflow-y: auto; }
  .job { padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: var(--fs-sm); }
  .job-head { display: flex; align-items: center; gap: 6px; }
  .job-id { font-family: var(--vscode-editor-font-family, monospace); font-size: var(--fs-sm); }
  .job-state {
    margin-left: auto; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: var(--fs-xs);
  }
  .job-state.done { background: var(--vscode-testing-iconPassed, #89d185); color: #000; }
  .job-state.failed { background: var(--vscode-errorForeground, #f48771); color: #fff; }
  .job-counts { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: var(--fs-sm); }
  .job-error { margin-top: 2px; color: var(--vscode-errorForeground, #f48771); }
  .jobs-empty { padding: 14px 8px; text-align: center; color: var(--vscode-descriptionForeground); font-size: var(--fs-sm); }
  .sheet-foot { display: flex; gap: 6px; padding: 4px 8px; border-top: 1px solid var(--vscode-panel-border); }
  .sheet-foot .mini { flex: 1; }
  .jobs-note { margin: 0; padding: 2px 8px 5px; color: var(--vscode-descriptionForeground); font-size: var(--fs-xs); }
  .jobs-note.err { color: var(--vscode-errorForeground, #f48771); }
</style>
</head>
<body>
<div id="topbar">
  <span id="status-chip" title="Admin server status">
    <span id="status-dot"></span>
    <span id="status-text">starting</span>
  </span>
  <div class="actions">
    <a id="btn-create" class="icon" href="command:${COMMANDS.createVault}" title="Create knowledge base" aria-label="Create knowledge base"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></a>
    <button id="btn-settings" class="icon" type="button" title="Settings" aria-label="Settings"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 5h10M3 11h10M6 3v4M10 9v4"/></svg></button>
    <button id="btn-refresh" class="icon" type="button" title="Refresh knowledge bases and status" aria-label="Refresh"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5v3h-3"/></svg></button>
    <button id="btn-menu" class="icon" type="button" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" aria-controls="menu"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg></button>
    <button id="btn-admin" class="icon" type="button" title="Open admin console in VS Code" aria-label="Open admin console"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M6 6v7.5"/></svg></button>
  </div>
</div>

<div id="setup-banner" role="status" hidden>
  <span id="setup-text">Data folder setup required</span>
  <a id="setup-action" href="command:${COMMANDS.resumeMigration}">Set up data folder</a>
</div>

<div id="vault-row">
  <select id="vault" aria-label="Knowledge base" title="Current knowledge base"><option value="">Loading knowledge bases…</option></select>
</div>

<form id="search-form">
  <div id="query-row">
    <input id="query" type="text" placeholder="Search the knowledge base…" aria-label="Search query" autocomplete="off" spellcheck="false">
    <button id="search" type="submit" title="Search" aria-label="Search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/></svg></button>
    <div id="history" class="history" role="listbox" aria-label="Search history" hidden></div>
  </div>
  <div id="options-row">
    <div id="mode" class="segmented" role="radiogroup" aria-label="Search mode">
      <button type="button" class="seg" role="radio" data-value="hybrid" aria-checked="true">hybrid</button>
      <button type="button" class="seg" role="radio" data-value="lexical" aria-checked="false">lexical</button>
      <button type="button" class="seg" role="radio" data-value="fuzzy" aria-checked="false">fuzzy</button>
      <button type="button" class="seg" role="radio" data-value="semantic" aria-checked="false">semantic</button>
      <button type="button" class="seg" role="radio" data-value="rrf" aria-checked="false">rrf</button>
    </div>
    <div id="limit" class="segmented" role="radiogroup" aria-label="Result limit">
      <button type="button" class="seg" role="radio" data-value="10" aria-checked="true" aria-label="10 results" title="10 results">10</button>
      <button type="button" class="seg" role="radio" data-value="25" aria-checked="false" aria-label="25 results" title="25 results">25</button>
      <button type="button" class="seg" role="radio" data-value="50" aria-checked="false" aria-label="50 results" title="50 results">50</button>
    </div>
    <span class="spacer"></span>
    <button id="btn-filters" class="icon" type="button" title="Filters" aria-label="Filters" aria-expanded="false" aria-controls="filters"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11l-4 5v4l-3 1v-5z"/></svg><span id="filter-count" class="count" hidden></span></button>
  </div>
  <div id="filters" role="group" aria-label="Filters" hidden>
    <input id="type" type="text" placeholder="type (any)" aria-label="Document type filter" autocomplete="off" spellcheck="false">
    <input id="tags" type="text" placeholder="tags, comma separated" aria-label="Tag filter" autocomplete="off" spellcheck="false">
    <button id="filters-clear" class="link" type="button">Clear filters</button>
  </div>
</form>

<div id="status" class="status" role="status">Starting the admin server…</div>
<div id="ingest-status" class="ingest" role="status" aria-live="polite" hidden>
  <span id="ingest-spinner" class="spinner" hidden></span>
  <span id="ingest-text"></span>
</div>
<div id="results" class="results"></div>

<div id="backdrop" hidden></div>
<div id="menu" role="menu" aria-label="Actions" hidden>
  <div class="menu-title">Admin service</div>
  <a id="menu-start" class="menu-item" data-group="admin" role="menuitem" href="command:${COMMANDS.startServer}">Start service</a>
  <a id="menu-restart" class="menu-item" data-group="admin" role="menuitem" href="command:${COMMANDS.restartServer}">Restart service</a>
  <button id="menu-console" class="menu-item" data-group="admin" role="menuitem" type="button">Open console in VS Code</button>
  <a id="menu-browser" class="menu-item" data-group="admin" role="menuitem" href="command:${COMMANDS.openInBrowser}">Open console in browser</a>

  <div class="menu-title">MCP</div>
  <a id="menu-mcp-status" class="menu-item" data-group="mcp" role="menuitem" href="command:${COMMANDS.showMcpStatus}">MCP status <span id="mcp-state" class="menu-badge">unknown</span></a>
  <button id="menu-reload-mcp" class="menu-item" data-group="mcp" role="menuitem" type="button">Reload MCP definitions</button>

  <div class="menu-title">Knowledge base</div>
  <button id="menu-upload-files" class="menu-item" data-group="ingest" role="menuitem" type="button">Upload files…</button>
  <button id="menu-upload-folder" class="menu-item" data-group="ingest" role="menuitem" type="button">Upload folder…</button>
  <button id="menu-progress" class="menu-item" data-group="ingest" role="menuitem" type="button">Conversion progress <span id="menu-jobs-badge" class="menu-badge" hidden>0</span></button>

  <div class="menu-title">Backup</div>
  <a id="menu-export" class="menu-item" data-group="backup" role="menuitem" href="command:${COMMANDS.cliExport}" title="Export all documents as Markdown">Export backup (Markdown)…</a>
  <a id="menu-import" class="menu-item" data-group="backup" role="menuitem" href="command:${COMMANDS.cliImport}" title="Import Markdown files into the knowledge base">Import backup (Markdown)…</a>

  <div class="menu-title">Git</div>
  <button id="menu-git" class="menu-item" data-group="git" role="menuitem" type="button">Open Git page</button>

  <div class="menu-title">Maintenance</div>
  <a id="menu-install-skills" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.installAgentSkills}">Install MCP &amp; skills</a>
  <a id="menu-install-cli-tools" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.installCliTools}">Install CLI tools</a>
  <a id="menu-setup-guide" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.openSetupGuide}">Setup guide</a>
  <a id="menu-skills-state" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.showSkillsState}">Skills status</a>
  <a id="menu-doctor" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.cliDoctor}">Run doctor</a>
  <a id="menu-logs" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.showLogs}">Show logs</a>
  <a id="menu-runtime" class="menu-item" data-group="more" role="menuitem" href="command:${COMMANDS.showRuntimeInfo}">Runtime info</a>
</div>

<div id="hitmenu" role="menu" aria-label="Search result actions" hidden>
  <div class="menu-title">Search result</div>
  <button class="menu-item" data-action="open" role="menuitem" type="button">Open document</button>
  <button class="menu-item" data-action="copy-title" role="menuitem" type="button">Copy title</button>
  <button class="menu-item" data-action="copy-id" role="menuitem" type="button">Copy document ID</button>
  <button class="menu-item" data-action="copy-snippet" role="menuitem" type="button">Copy snippet</button>
  <button class="menu-item" data-action="copy-link" role="menuitem" type="button">Copy link</button>
  <button class="menu-item" data-action="copy-selection" role="menuitem" type="button" hidden>Copy selected text</button>
</div>

<div id="jobs" role="dialog" aria-modal="true" aria-labelledby="jobs-title" hidden>
  <div class="sheet-head">
    <strong id="jobs-title">Ingestion jobs</strong>
    <button id="jobs-refresh" class="mini" type="button" title="Refresh jobs">Refresh</button>
    <button id="jobs-close" class="mini" type="button" title="Close" aria-label="Close">&times;</button>
  </div>
  <div id="jobs-list" class="jobs-list"></div>
  <div class="sheet-foot">
    <button id="jobs-open" class="mini" type="button">Open ingest page</button>
  </div>
  <p id="jobs-note" class="jobs-note">Jobs live in the admin process; restarting the server clears them.</p>
</div>

<script nonce="${options.nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  var $ = function (id) { return document.getElementById(id); };
  var statusChip = $("status-chip");
  var statusDot = $("status-dot");
  var statusText = $("status-text");
  var setupBanner = $("setup-banner");
  var setupText = $("setup-text");
  var setupRequired = false;
  var lastStatus = null;
  var vaultSelect = $("vault");
  var queryInput = $("query");
  var modeGroup = $("mode");
  var limitGroup = $("limit");
  var typeInput = $("type");
  var tagsInput = $("tags");
  var filters = $("filters");
  var filtersToggle = $("btn-filters");
  var filterCount = $("filter-count");
  var filtersClear = $("filters-clear");
  var searchButton = $("search");
  var statusEl = $("status");
  var ingestEl = $("ingest-status");
  var ingestSpinner = $("ingest-spinner");
  var ingestText = $("ingest-text");
  var resultsEl = $("results");
  var historyEl = $("history");
  var menuButton = $("btn-menu");
  var menuEl = $("menu");
  var hitMenuEl = $("hitmenu");
  var backdrop = $("backdrop");
  var menuStart = $("menu-start");
  var menuRestart = $("menu-restart");
  var menuReloadMcp = $("menu-reload-mcp");
  var mcpState = $("mcp-state");
  var jobsBadge = $("menu-jobs-badge");
  var jobsPane = $("jobs");
  var jobsList = $("jobs-list");
  var jobsNote = $("jobs-note");
  var jobsNoteDefault = jobsNote.textContent;
  var currentVault = "";
  var pending = 0;
  var busy = false;
  var booted = false;
  var historyItems = [];
  var historyOpen = false;
  var historyIndex = -1;
  var clearArmed = false;
  var clearTimer = 0;
  var serverRunning = false;
  var lastJobs = [];
  var MODES = ["hybrid", "lexical", "fuzzy", "semantic", "rrf"];
  var LIMITS = [10, 25, 50];
  var saved = vscode.getState() || {};
  var hitMenuCard = null;
  var hitMenuHit = null;
  var hitMenuSelection = "";

  function segmentValue(group) {
    var active = group.querySelector('[aria-checked="true"]');
    return active ? active.getAttribute("data-value") : "";
  }

  function setSegmentValue(group, value) {
    var options = group.querySelectorAll(".seg");
    for (var i = 0; i < options.length; i++) {
      var checked = options[i].getAttribute("data-value") === value;
      options[i].setAttribute("aria-checked", checked ? "true" : "false");
      options[i].tabIndex = checked ? 0 : -1;
    }
  }

  function setFiltersOpen(open) {
    filters.hidden = !open;
    filtersToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (typeof saved.query === "string") queryInput.value = saved.query;
  setSegmentValue(modeGroup, MODES.indexOf(saved.mode) !== -1 ? saved.mode : "hybrid");
  setSegmentValue(limitGroup, LIMITS.indexOf(saved.limit) !== -1 ? String(saved.limit) : "10");
  if (typeof saved.type === "string") typeInput.value = saved.type;
  if (typeof saved.tags === "string") tagsInput.value = saved.tags;
  setFiltersOpen(saved.filtersOpen === true);

  function persist() {
    vscode.setState({
      query: queryInput.value,
      mode: segmentValue(modeGroup),
      limit: Number(segmentValue(limitGroup)),
      type: typeInput.value,
      tags: tagsInput.value,
      filtersOpen: !filters.hidden
    });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setBusy(value) {
    busy = value;
    searchButton.disabled = value;
  }

  function setIngest(text, kind, spin) {
    if (!text) {
      ingestEl.hidden = true;
      ingestText.textContent = "";
      return;
    }
    ingestEl.hidden = false;
    ingestEl.className = "ingest" + (kind ? " " + kind : "");
    ingestSpinner.hidden = !spin;
    ingestText.textContent = text;
  }

  function updateFilterCount() {
    var count = 0;
    if (typeInput.value.trim()) count += 1;
    if (tagsInput.value.trim()) count += 1;
    filterCount.hidden = count === 0;
    filterCount.textContent = String(count);
    filtersToggle.setAttribute("aria-label", count ? "Filters, " + count + " active" : "Filters");
  }

  function displayHost(value) {
    var host = String(value || "127.0.0.1");
    return host.indexOf(":") >= 0 && host.charAt(0) !== "[" ? "[" + host + "]" : host;
  }

  function renderServer(status) {
    status = status || {};
    lastStatus = status;
    var state = String(status.state || "stopped");
    serverRunning = state === "running-own" || state === "running-external";
    var label;
    if (state === "running-own") label = "running";
    else if (state === "running-external") {
      label = displayHost(status.host) + (status.port ? ":" + status.port : "");
    }
    else if (state === "stopped") label = "start";
    else label = state;
    var setupActive = setupRequired && !serverRunning;
    if (setupActive) label = "setup required";
    statusText.textContent = label;
    statusDot.className = setupActive ? "setup" : state;
    // A running/external server always wins over the setup banner.
    setupBanner.hidden = !setupActive;
    statusChip.title = "Admin server: " + state +
      (status.port ? " on " + displayHost(status.host) + ":" + status.port : "") +
      (status.message ? " - " + status.message : "");
    menuStart.hidden = serverRunning;
    menuRestart.hidden = !serverRunning;
    if (state === "running-external") {
      menuRestart.setAttribute("aria-disabled", "true");
      menuRestart.title = "Restart is available only for the server this extension started";
    } else {
      menuRestart.removeAttribute("aria-disabled");
      menuRestart.removeAttribute("title");
    }
  }

  function renderVaults(data) {
    var vaults = Array.isArray(data.vaults) ? data.vaults : [];
    vaultSelect.replaceChildren();
    if (!vaults.length) {
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "No knowledge bases";
      vaultSelect.appendChild(none);
      currentVault = "";
      booted = true;
      setStatus("No knowledge bases found. Create one to get started.", "err");
      return;
    }
    for (var i = 0; i < vaults.length; i++) {
      var vault = vaults[i];
      var option = document.createElement("option");
      option.value = vault.name;
      option.textContent = vault.name;
      if (vault.description) option.title = vault.description;
      vaultSelect.appendChild(option);
    }
    currentVault = data.current || vaults[0].name;
    vaultSelect.value = currentVault;
    if (!booted) {
      booted = true;
      setStatus("");
    }
  }

  function stripTags(value) {
    return String(value || "").replace(/<[^>]*>/g, "");
  }

  function appendSegments(target, segments) {
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i] || {};
      var text = String(segment.text || "");
      if (!text) continue;
      if (segment.match) {
        var strong = document.createElement("strong");
        strong.textContent = text;
        target.appendChild(strong);
      } else {
        target.appendChild(document.createTextNode(text));
      }
    }
  }

  function addSnippetToggle(card, snippet, view) {
    var actions = document.createElement("div");
    actions.className = "snippet-actions";
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "snippet-toggle";
    toggle.textContent = "Show more";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var expand = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", expand ? "true" : "false");
      toggle.textContent = expand ? "Show less" : "Show more";
      snippet.classList.toggle("expanded", expand);
      snippet.replaceChildren();
      appendSegments(snippet, expand ? view.expanded : view.collapsed);
    });
    actions.appendChild(toggle);
    card.appendChild(actions);
  }

  function renderResults(data) {
    var hits = Array.isArray(data.hits) ? data.hits : [];
    closeHitMenu(false);
    resultsEl.replaceChildren();
    if (hits.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No results. Try fuzzy or hybrid mode, or fewer filters.";
      resultsEl.appendChild(empty);
      setStatus("0 results", "ok");
      return;
    }
    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i] || {};
      var doc = hit.doc || {};
      var card = document.createElement("div");
      card.className = "hit";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.hitData = hit;
      card.title = "Open " + (doc.title || doc.id) + " in the built-in browser";

      var head = document.createElement("span");
      head.className = "hit-head";
      var title = document.createElement("span");
      title.className = "hit-title";
      title.textContent = doc.title || doc.id || "(untitled)";
      head.appendChild(title);
      if (typeof hit.score === "number") {
        var score = document.createElement("span");
        score.className = "score";
        score.textContent = hit.score.toFixed(3);
        head.appendChild(score);
      }

      var meta = document.createElement("span");
      meta.className = "hit-meta";
      meta.textContent = (doc.type || "doc") + " · " + (doc.id || "");

      var snippet = document.createElement("span");
      snippet.className = "hit-snippet";
      var view = hit.snippetView;
      if (view && Array.isArray(view.collapsed)) {
        appendSegments(snippet, view.collapsed);
      } else {
        snippet.textContent = stripTags(hit.snippet) || stripTags((doc.body || "").slice(0, 180));
      }

      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(snippet);
      if (view && view.expandable && Array.isArray(view.expanded)) {
        addSnippetToggle(card, snippet, view);
      }
      (function (id) {
        card.addEventListener("click", function () {
          vscode.postMessage({ type: "openDocument", id: id });
        });
        card.addEventListener("keydown", function (event) {
          if (event.target !== card) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            vscode.postMessage({ type: "openDocument", id: id });
          }
        });
      })(doc.id);
      resultsEl.appendChild(card);
    }
    var count = typeof data.count === "number" ? data.count : hits.length;
    setStatus(count + (count === 1 ? " result" : " results") + (currentVault ? " · " + currentVault : ""), "ok");
  }

  function renderMcp(message) {
    var registered = message.registered === true;
    mcpState.textContent = registered ? "registered" : "unavailable";
    mcpState.className = "menu-badge " + (registered ? "ok" : "warn");
    if (registered) {
      menuReloadMcp.removeAttribute("aria-disabled");
      menuReloadMcp.removeAttribute("disabled");
      menuReloadMcp.title = "Ask VS Code to re-read the MCP server definition";
    } else {
      menuReloadMcp.setAttribute("aria-disabled", "true");
      menuReloadMcp.setAttribute("disabled", "disabled");
      menuReloadMcp.title = "The MCP provider API is unavailable in this VS Code host";
    }
    if (message.reloaded === true) setStatus("MCP definitions reloaded.", "ok");
    if (message.reloaded === false) setStatus("MCP provider is not available in this host.", "err");
  }

  function filteredHistory() {
    var needle = queryInput.value.trim().toLowerCase();
    if (!needle) return historyItems;
    return historyItems.filter(function (item) {
      return item.toLowerCase().indexOf(needle) !== -1;
    });
  }

  function hideHistory() {
    historyOpen = false;
    historyIndex = -1;
    clearArmed = false;
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = 0;
    }
    historyEl.hidden = true;
  }

  function renderHistory() {
    var items = filteredHistory();
    historyEl.replaceChildren();
    if (!items.length) {
      hideHistory();
      return;
    }
    for (var i = 0; i < items.length; i++) {
      (function (item, index) {
        var row = document.createElement("div");
        row.className = "history-row" + (index === historyIndex ? " active" : "");
        var pick = document.createElement("button");
        pick.type = "button";
        pick.className = "history-item";
        pick.textContent = item;
        pick.title = "Search for " + item;
        pick.addEventListener("click", function () { chooseHistory(item); });
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "history-remove";
        remove.textContent = "×";
        remove.title = "Remove from history";
        remove.setAttribute("aria-label", "Remove " + item + " from history");
        remove.addEventListener("click", function (event) {
          event.stopPropagation();
          vscode.postMessage({ type: "forgetQuery", query: item });
        });
        row.appendChild(pick);
        row.appendChild(remove);
        historyEl.appendChild(row);
      })(items[i], i);
    }
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "history-clear" + (clearArmed ? " confirm" : "");
    clear.textContent = clearArmed ? "Click again to clear all history" : "Clear history";
    clear.addEventListener("click", function () {
      if (!clearArmed) {
        clearArmed = true;
        renderHistory();
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(function () {
          clearArmed = false;
          renderHistory();
        }, 3000);
        return;
      }
      clearArmed = false;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = 0;
      }
      vscode.postMessage({ type: "clearHistory" });
    });
    historyEl.appendChild(clear);
    historyEl.hidden = false;
    historyOpen = true;
  }

  function showHistory() {
    if (!historyItems.length) return;
    historyIndex = -1;
    renderHistory();
  }

  function chooseHistory(item) {
    queryInput.value = item;
    hideHistory();
    persist();
    submitSearch();
  }

  function setHistory(items) {
    historyItems = Array.isArray(items) ? items.slice(0, 8) : [];
    if (historyIndex >= historyItems.length) historyIndex = historyItems.length - 1;
    if (historyOpen) renderHistory();
    if (!historyItems.length) hideHistory();
  }

  function setJobsError(text) {
    jobsNote.textContent = text || jobsNoteDefault;
    jobsNote.className = "jobs-note" + (text ? " err" : "");
  }

  function renderJobs(jobs) {
    lastJobs = Array.isArray(jobs) ? jobs.slice() : [];
    var active = 0;
    for (var i = 0; i < lastJobs.length; i++) {
      if (lastJobs[i].state !== "done" && lastJobs[i].state !== "failed") active += 1;
    }
    jobsBadge.textContent = String(active);
    jobsBadge.hidden = active === 0;
    jobsList.replaceChildren();
    if (!lastJobs.length) {
      var empty = document.createElement("div");
      empty.className = "jobs-empty";
      empty.textContent = "No ingestion jobs in this admin process.";
      jobsList.appendChild(empty);
      return;
    }
    var sorted = lastJobs.slice().sort(function (a, b) {
      return String(b.started_at || "").localeCompare(String(a.started_at || ""));
    });
    for (var j = 0; j < sorted.length; j++) jobsList.appendChild(jobRow(sorted[j]));
  }

  function jobNumber(value) {
    return typeof value === "number" ? String(value) : "0";
  }

  function jobRow(job) {
    var row = document.createElement("div");
    row.className = "job";
    var head = document.createElement("div");
    head.className = "job-head";
    var id = document.createElement("span");
    id.className = "job-id";
    id.textContent = String(job.job_id || "").slice(0, 8);
    id.title = String(job.job_id || "");
    var vault = document.createElement("span");
    vault.className = "job-counts";
    vault.textContent = job.vault || "";
    var state = document.createElement("span");
    state.className = "job-state " + String(job.state || "");
    state.textContent = String(job.state || "?");
    head.appendChild(id);
    head.appendChild(vault);
    head.appendChild(state);
    row.appendChild(head);
    var counts = job.counts || {};
    var line = document.createElement("div");
    line.className = "job-counts";
    line.textContent = "up " + jobNumber(counts.uploaded) +
      " · conv " + jobNumber(counts.converted) +
      " · ins " + jobNumber(counts.inserted) +
      " · upd " + jobNumber(counts.updated) +
      " · fail " + jobNumber(counts.failed) +
      " · skip " + jobNumber(counts.skipped);
    row.appendChild(line);
    if (job.error) {
      var error = document.createElement("div");
      error.className = "job-error";
      error.textContent = String(job.error);
      row.appendChild(error);
    }
    return row;
  }

  function closeMenu() {
    if (menuEl.hidden) return;
    menuEl.hidden = true;
    if (jobsPane.hidden) backdrop.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  }

  function openMenu() {
    menuEl.hidden = false;
    backdrop.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    var first = menuEl.querySelector(".menu-item:not([hidden])");
    if (first) first.focus();
  }

  function closeJobs() {
    if (jobsPane.hidden) return;
    jobsPane.hidden = true;
    if (menuEl.hidden) backdrop.hidden = true;
    vscode.postMessage({ type: "hideJobs" });
  }

  function closeHitMenu(restoreFocus) {
    if (hitMenuEl.hidden) return;
    hitMenuEl.hidden = true;
    if (menuEl.hidden && jobsPane.hidden) backdrop.hidden = true;
    var previous = hitMenuCard;
    hitMenuCard = null;
    hitMenuHit = null;
    hitMenuSelection = "";
    if (restoreFocus !== false && previous && previous.focus) previous.focus();
  }

  function openHitMenu(card, hit, x, y, selection) {
    closeMenu();
    closeJobs();
    hitMenuCard = card;
    hitMenuHit = hit || {};
    hitMenuSelection = selection || "";
    hitMenuEl.querySelector('[data-action="copy-selection"]').hidden = !hitMenuSelection;
    hitMenuEl.hidden = false;
    backdrop.hidden = false;
    hitMenuEl.style.left = "0px";
    hitMenuEl.style.top = "0px";
    var rect = hitMenuEl.getBoundingClientRect();
    var left = x;
    var top = y;
    if (!left && !top && card.getBoundingClientRect) {
      var cardRect = card.getBoundingClientRect();
      left = cardRect.left + 12;
      top = cardRect.bottom - 4;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - rect.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - rect.height - 4));
    hitMenuEl.style.left = left + "px";
    hitMenuEl.style.top = top + "px";
    var first = hitMenuEl.querySelector(".menu-item:not([hidden])");
    if (first) first.focus();
  }

  function copyText(text, label) {
    if (!text) {
      setStatus("Nothing to copy.", "err");
      return;
    }
    vscode.postMessage({ type: "copyText", text: text, label: label });
  }

  function submitSearch() {
    if (busy) return;
    var query = queryInput.value.trim();
    if (!query) {
      setStatus("Enter a query to search.", "err");
      queryInput.focus();
      return;
    }
    var type = typeInput.value.trim();
    var tags = tagsInput.value.trim();
    var params = { query: query, mode: segmentValue(modeGroup), limit: Number(segmentValue(limitGroup)) };
    if (vaultSelect.value) params.vault = vaultSelect.value;
    if (type) params.type = type;
    if (tags) params.tags = tags;
    pending += 1;
    setBusy(true);
    setStatus("Searching…");
    hideHistory();
    persist();
    vscode.postMessage({ type: "search", requestId: pending, params: params });
  }

  $("search-form").addEventListener("submit", function (event) {
    event.preventDefault();
    submitSearch();
  });

  $("btn-settings").addEventListener("click", function () {
    vscode.postMessage({ type: "openSettings" });
  });

  $("btn-refresh").addEventListener("click", function () {
    this.disabled = true;
    vscode.postMessage({ type: "refresh" });
  });

  $("btn-admin").addEventListener("click", function () {
    vscode.postMessage({ type: "openAdmin" });
  });

  menuButton.addEventListener("click", function () {
    if (menuEl.hidden) openMenu();
    else closeMenu();
  });

  menuEl.addEventListener("click", function (event) {
    var target = event.target;
    var item = target && target.closest ? target.closest(".menu-item") : null;
    if (!item) return;
    if (item.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    closeMenu();
  });

  backdrop.addEventListener("click", function () {
    closeMenu();
    closeJobs();
    closeHitMenu();
  });

  resultsEl.addEventListener("contextmenu", function (event) {
    var target = event.target;
    var card = target && target.closest ? target.closest(".hit") : null;
    if (!card) return;
    event.preventDefault();
    var selection = "";
    if (window.getSelection) selection = String(window.getSelection().toString() || "").trim();
    openHitMenu(card, card.hitData, event.clientX, event.clientY, selection);
  });

  hitMenuEl.addEventListener("click", function (event) {
    var target = event.target;
    var item = target && target.closest ? target.closest(".menu-item") : null;
    if (!item) return;
    var action = item.getAttribute("data-action");
    var hit = hitMenuHit || {};
    var doc = hit.doc || {};
    var view = hit.snippetView || {};
    var selection = hitMenuSelection;
    closeHitMenu();
    if (action === "open") {
      vscode.postMessage({ type: "openDocument", id: doc.id });
    } else if (action === "copy-title") {
      copyText(String(doc.title || doc.id || ""), "Title");
    } else if (action === "copy-id") {
      copyText(String(doc.id || ""), "Document ID");
    } else if (action === "copy-snippet") {
      copyText(String(view.plain || stripTags(hit.snippet) || ""), "Snippet");
    } else if (action === "copy-link") {
      vscode.postMessage({ type: "copyDocumentLink", id: doc.id });
    } else if (action === "copy-selection") {
      copyText(selection, "Selection");
    }
  });

  $("menu-console").addEventListener("click", function () {
    vscode.postMessage({ type: "openAdmin" });
  });

  $("menu-git").addEventListener("click", function () {
    vscode.postMessage({ type: "openGitPage" });
  });

  $("menu-upload-files").addEventListener("click", function () {
    vscode.postMessage({ type: "upload", kind: "files" });
  });

  $("menu-upload-folder").addEventListener("click", function () {
    vscode.postMessage({ type: "upload", kind: "folder" });
  });

  $("menu-progress").addEventListener("click", function () {
    vscode.postMessage({ type: "showJobs" });
  });

  menuReloadMcp.addEventListener("click", function () {
    if (menuReloadMcp.getAttribute("aria-disabled") === "true") return;
    vscode.postMessage({ type: "reloadMcp" });
  });

  $("jobs-close").addEventListener("click", closeJobs);

  $("jobs-refresh").addEventListener("click", function () {
    vscode.postMessage({ type: "refreshJobs" });
  });

  $("jobs-open").addEventListener("click", function () {
    vscode.postMessage({ type: "openIngestPage" });
  });

  vaultSelect.addEventListener("change", function () {
    if (!vaultSelect.value) return;
    setStatus("Switching to " + vaultSelect.value + "…");
    vscode.postMessage({ type: "switchVault", name: vaultSelect.value });
  });

  queryInput.addEventListener("input", function () {
    persist();
    if (historyOpen) {
      historyIndex = -1;
      renderHistory();
    }
  });

  queryInput.addEventListener("focus", function () {
    showHistory();
  });

  queryInput.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (historyOpen) {
        event.preventDefault();
        hideHistory();
      }
      return;
    }
    if (!historyOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      showHistory();
      return;
    }
    if (!historyOpen) return;
    var items = filteredHistory();
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      historyIndex = (historyIndex + 1) % items.length;
      renderHistory();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      historyIndex = historyIndex <= 0 ? items.length - 1 : historyIndex - 1;
      renderHistory();
    } else if (event.key === "Enter" && historyIndex >= 0 && historyIndex < items.length) {
      event.preventDefault();
      chooseHistory(items[historyIndex]);
    }
  });

  function onSegmentClick(group) {
    return function (event) {
      var target = event.target.closest ? event.target.closest(".seg") : null;
      if (!target || !group.contains(target)) return;
      setSegmentValue(group, target.getAttribute("data-value"));
      persist();
    };
  }
  function onSegmentKey(group) {
    return function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      var options = Array.prototype.slice.call(group.querySelectorAll(".seg"));
      var index = options.indexOf(document.activeElement);
      if (index === -1) index = options.indexOf(group.querySelector('[aria-checked="true"]'));
      var next;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = options.length - 1;
      else if (event.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
      else next = (index + 1) % options.length;
      event.preventDefault();
      setSegmentValue(group, options[next].getAttribute("data-value"));
      options[next].focus();
      persist();
    };
  }
  modeGroup.addEventListener("click", onSegmentClick(modeGroup));
  limitGroup.addEventListener("click", onSegmentClick(limitGroup));
  modeGroup.addEventListener("keydown", onSegmentKey(modeGroup));
  limitGroup.addEventListener("keydown", onSegmentKey(limitGroup));
  typeInput.addEventListener("input", function () {
    updateFilterCount();
    persist();
  });
  tagsInput.addEventListener("input", function () {
    updateFilterCount();
    persist();
  });
  filtersToggle.addEventListener("click", function () {
    setFiltersOpen(filters.hidden);
    persist();
  });
  filtersClear.addEventListener("click", function () {
    typeInput.value = "";
    tagsInput.value = "";
    updateFilterCount();
    persist();
  });

  document.addEventListener("click", function (event) {
    if (!historyOpen) return;
    var target = event.target;
    if (historyEl.contains(target) || queryInput.contains(target)) return;
    hideHistory();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (!jobsPane.hidden) {
        closeJobs();
        return;
      }
      if (!hitMenuEl.hidden) {
        closeHitMenu();
        return;
      }
      if (!menuEl.hidden) {
        closeMenu();
        return;
      }
      if (historyOpen) hideHistory();
    }
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    event.preventDefault();
    queryInput.focus();
    queryInput.select();
  });

  window.addEventListener("message", function (event) {
    var message = event.data || {};
    if (message.type === "server") {
      renderServer(message.status);
      return;
    }
    if (message.type === "setup") {
      var setupState = message.state || {};
      setupRequired = setupState.kind === "pending";
      setupBanner.hidden = !setupRequired;
      if (setupRequired) {
        setupText.textContent = setupState.message || "Data folder setup required";
      }
      if (lastStatus) renderServer(lastStatus);
      return;
    }
    if (message.type === "mcp") {
      renderMcp(message);
      return;
    }
    if (message.type === "vaults") {
      renderVaults(message.data || {});
      return;
    }
    if (message.type === "vault") {
      currentVault = message.current || currentVault;
      if (currentVault) vaultSelect.value = currentVault;
      return;
    }
    if (message.type === "history") {
      setHistory(message.items);
      return;
    }
    if (message.type === "results") {
      if (message.requestId !== pending) return;
      setBusy(false);
      renderResults(message.data || {});
      return;
    }
    if (message.type === "refreshed") {
      $("btn-refresh").disabled = false;
      return;
    }
    if (message.type === "notice") {
      setStatus(String(message.text || ""), "ok");
      return;
    }
    if (message.type === "ingestProgress") {
      var progress = "Working…";
      if (message.phase === "uploading" && message.total) {
        progress = "Uploading " + message.done + "/" + message.total +
          (message.current ? " · " + message.current : "");
      } else if (message.phase === "scanning") {
        progress = "Scanning the selection…";
      } else if (message.phase === "starting") {
        progress = "Starting conversion…";
      }
      setIngest(progress, "", true);
      return;
    }
    if (message.type === "ingestResult") {
      var parts = [String(message.uploaded || 0) + " uploaded"];
      if (message.rejected) parts.push(String(message.rejected) + " rejected");
      var skipped = Array.isArray(message.skipped) ? message.skipped.length : 0;
      if (skipped) parts.push(String(skipped) + " skipped");
      setIngest("Ingestion queued · " + parts.join(" · "), "ok", false);
      return;
    }
    if (message.type === "jobs") {
      setJobsError("");
      renderJobs(message.jobs);
      return;
    }
    if (message.type === "jobsOpen") {
      jobsPane.hidden = false;
      backdrop.hidden = false;
      return;
    }
    if (message.type === "error") {
      if (typeof message.requestId === "number" && message.requestId !== pending) return;
      var scope = message.scope || "";
      var text = message.message || "Something went wrong.";
      if (scope === "upload") {
        setIngest(text, "err", false);
        return;
      }
      if (scope === "jobs") {
        setJobsError(text);
        return;
      }
      setBusy(false);
      $("btn-refresh").disabled = false;
      if (currentVault && (scope === "vaults" || scope === "search" || scope === "switch")) {
        vaultSelect.value = currentVault;
      }
      setStatus(text, "err");
    }
  });

  updateFilterCount();
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
export function documentUrl(port: number, id: string, host: string = DEFAULT_HOST): string {
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  return `http://${parseHost(host).urlHost}:${port}/documents/${encoded}`;
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
  getStatus: () => ServerStatus;
  /** Migration gate state used to show the "setup required" banner. */
  getSetupState?: () => MigrationState | null;
  history: SearchHistoryStore;
  mcp: McpProviderHandle;
}

export class AdminLauncherViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private currentVault = "";
  private uploading = false;
  private jobsVisible = false;
  private jobsTimer: ReturnType<typeof setInterval> | undefined;
  private jobsPolling = false;
  private lastJobs: IngestJobSummary[] = [];
  private lastRunning = false;
  private lastSetup: MigrationState | null = null;

  constructor(private readonly deps: LauncherDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: true };
    const nonce = randomUUID().replace(/-/g, "");
    view.webview.html = renderLauncherHtml({ nonce });

    const messageSub = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) void this.refreshVaults();
    });
    view.onDidDispose(() => {
      messageSub.dispose();
      visibilitySub.dispose();
      this.jobsVisible = false;
      this.stopJobPolling();
      if (this.view === view) this.view = undefined;
    });

    const status = this.deps.getStatus();
    this.lastRunning = isRunningStatus(status);
    this.postServer(status);
    this.postMcp();
    this.postSetup();

    // Start (or reuse) the admin server without stealing focus. The webview asks
    // for vaults once its message listener is installed.
    void this.deps.ensureRunning().catch(() => undefined);
  }

  /** Called by the migration gate; a `pending` state shows the setup banner. */
  updateSetupState(state: MigrationState | null): void {
    this.lastSetup = state;
    this.post({ type: "setup", state });
  }

  updateStatus(status: ServerStatus): void {
    const running = isRunningStatus(status);
    const becameRunning = running && !this.lastRunning;
    this.lastRunning = running;
    this.postServer(status);
    if (becameRunning && this.view) void this.refreshVaults();
    if (running) {
      if (this.jobsVisible) {
        void this.refreshJobs();
        this.startJobPolling();
      }
    } else {
      this.stopJobPolling();
      if (this.jobsVisible && (status.state === "stopped" || status.state === "error")) {
        this.lastJobs = [];
        this.post({ type: "jobs", jobs: [] });
      }
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case "ready":
        // The webview has installed its listener now; repost what resolveWebviewView
        // sent before the script was running.
        this.postServer(this.deps.getStatus());
        this.postMcp();
        this.postSetup();
        await this.refreshVaults();
        return;
      case "refresh":
        await this.refreshAll();
        return;
      case "openAdmin":
        await this.openAdmin();
        return;
      case "openGitPage":
        await this.openPage("/git");
        return;
      case "openIngestPage":
        await this.openPage("/ingest");
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
          this.postError(new Error("invalid search request"), requestId, "search");
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
      case "copyText": {
        const text = typeof message.text === "string" ? message.text : "";
        if (!text) return;
        const label = typeof message.label === "string" && message.label ? message.label : "Text";
        try {
          await vscode.env.clipboard.writeText(text);
          this.post({ type: "notice", text: `${label} copied.` });
        } catch (error) {
          this.postError(error);
        }
        return;
      }
      case "copyDocumentLink": {
        if (typeof message.id !== "string" || !message.id) return;
        try {
          const port = await this.port();
          const host = connectHost(this.deps.getStatus().host);
          await vscode.env.clipboard.writeText(documentUrl(port, message.id, host));
          this.post({ type: "notice", text: "Link copied." });
        } catch (error) {
          this.postError(error);
        }
        return;
      }
      case "reloadMcp":
        this.reloadMcp();
        return;
      case "upload":
        if (message.kind === "files" || message.kind === "folder") {
          await this.upload(message.kind);
        }
        return;
      case "showJobs":
        this.showJobs();
        return;
      case "hideJobs":
        this.jobsVisible = false;
        this.stopJobPolling();
        return;
      case "refreshJobs":
        await this.refreshJobs();
        return;
      case "forgetQuery":
        if (typeof message.query === "string" && message.query) {
          await this.forgetQuery(message.query);
        }
        return;
      case "clearHistory":
        await this.clearHistory();
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

  /** JSON client bound to the server's connect address (wildcards already mapped). */
  private http(): HttpJson {
    const host = connectHost(this.deps.getStatus().host);
    return (port, path, options) => httpJson(port, path, { ...options, host });
  }

  private async baseUrl(): Promise<string> {
    const status = await this.deps.ensureRunning();
    const url = adminBaseUrl(status);
    if (url === null) {
      throw new Error(status.message ?? "hyseed admin server did not start");
    }
    return url;
  }

  private async refreshAll(): Promise<void> {
    this.postServer(this.deps.getStatus());
    this.postMcp();
    await this.refreshVaults();
    if (this.jobsVisible) await this.refreshJobs();
    this.post({ type: "refreshed" });
  }

  private async refreshVaults(): Promise<void> {
    try {
      const data = await fetchVaults(await this.port(), this.http());
      this.currentVault = data.current;
      this.post({ type: "vaults", data });
      this.postHistory();
    } catch (error) {
      this.postError(error, undefined, "vaults");
    }
  }

  private async openAdmin(): Promise<void> {
    try {
      await openInSimpleBrowser(`${await this.baseUrl()}/`);
    } catch (error) {
      this.postError(error);
    }
  }

  private async openPage(route: string): Promise<void> {
    try {
      await openInSimpleBrowser(`${await this.baseUrl()}${route}`);
    } catch (error) {
      this.postError(error);
    }
  }

  private async switchTo(name: string): Promise<void> {
    try {
      this.currentVault = await switchVault(await this.port(), name, this.http());
      this.post({ type: "vault", current: this.currentVault });
      this.postHistory();
    } catch (error) {
      this.postError(error, undefined, "switch");
    }
  }

  private async search(params: SearchParams, requestId: number): Promise<void> {
    try {
      const outcome = await runSearch(await this.port(), params, this.currentVault, {
        http: this.http(),
        onVaultChanged: (current) => {
          this.currentVault = current;
          this.post({ type: "vault", current });
        },
      });
      this.currentVault = outcome.current;
      const data = {
        ...outcome.result,
        hits: outcome.result.hits.map((hit) => ({
          ...hit,
          snippetView: buildSnippetView(
            params.query,
            hit.doc?.body ?? "",
            hit.snippet ?? ""
          ),
        })),
      };
      this.post({ type: "results", requestId, data });
      await this.recordQuery(params.query);
    } catch (error) {
      this.postError(error, requestId, "search");
    }
  }

  private async recordQuery(query: string): Promise<void> {
    if (!this.currentVault) return;
    try {
      const items = await this.deps.history.record(this.currentVault, query);
      this.post({ type: "history", vault: this.currentVault, items });
    } catch (error) {
      // History is a convenience; a failed write must not break search.
      logLine(`search history: ${errorText(error)}`);
    }
  }

  private async forgetQuery(query: string): Promise<void> {
    try {
      const items = await this.deps.history.remove(this.currentVault, query);
      this.post({ type: "history", vault: this.currentVault, items });
    } catch (error) {
      this.postError(error);
    }
  }

  private async clearHistory(): Promise<void> {
    try {
      const items = await this.deps.history.clear(this.currentVault);
      this.post({ type: "history", vault: this.currentVault, items });
    } catch (error) {
      this.postError(error);
    }
  }

  private postHistory(): void {
    this.post({
      type: "history",
      vault: this.currentVault,
      items: this.deps.history.items(this.currentVault),
    });
  }

  private async openDocument(id: string): Promise<void> {
    try {
      const port = await this.port();
      const host = connectHost(this.deps.getStatus().host);
      await openInSimpleBrowser(documentUrl(port, id, host));
    } catch (error) {
      this.postError(error);
    }
  }

  private reloadMcp(): void {
    const reloaded = this.deps.mcp.reload();
    this.post({
      type: "mcp",
      available: this.deps.mcp.available,
      registered: this.deps.mcp.registered,
      reloaded,
    });
  }

  private postMcp(): void {
    this.post({
      type: "mcp",
      available: this.deps.mcp.available,
      registered: this.deps.mcp.registered,
    });
  }

  /**
   * Stage the selection through the admin ingest API, then start one job.
   * Files are uploaded one at a time; a batch-limit 409 aborts the rest.
   */
  private async upload(kind: "files" | "folder"): Promise<void> {
    if (this.uploading) {
      this.postError(new Error("An upload is already running."), undefined, "upload");
      return;
    }
    const picked = await vscode.window.showOpenDialog(
      kind === "folder"
        ? {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Upload folder",
            title: "hyseed: upload a folder",
          }
        : {
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: "Upload files",
            title: "hyseed: upload files",
          }
    );
    if (!picked || picked.length === 0) return;

    this.uploading = true;
    try {
      this.post({ type: "ingestProgress", phase: "scanning" });
      const port = await this.port();
      const http = this.http();
      const host = connectHost(this.deps.getStatus().host);
      const limits = await fetchIngestLimits(port, http);
      const plan =
        kind === "folder"
          ? await planFolderUpload(picked[0].fsPath, limits)
          : await planFileSelection(
              picked.map((uri) => uri.fsPath),
              limits
            );
      const batch = await createIngestBatch(port, this.currentVault, http);
      if (!this.currentVault && batch.vault) this.currentVault = batch.vault;

      const total = plan.files.length;
      let uploaded = 0;
      let rejected = 0;
      for (let index = 0; index < plan.files.length; index++) {
        const file = plan.files[index];
        this.post({
          type: "ingestProgress",
          phase: "uploading",
          done: index,
          total,
          current: file.rel,
        });
        try {
          const result = await postIngestFile(
            port,
            batch.batch_id,
            file,
            kind === "folder" ? "folder" : "upload",
            host
          );
          if (result.ok) uploaded += 1;
          else rejected += 1;
        } catch (error) {
          if (error instanceof IngestHttpError && error.status === 409) throw error;
          rejected += 1;
          logLine(`ingest upload failed for ${file.rel}: ${errorText(error)}`);
        }
      }
      if (uploaded === 0) {
        throw new Error(
          rejected > 0 ? `The server rejected all ${rejected} file(s).` : "No files were uploaded."
        );
      }
      this.post({ type: "ingestProgress", phase: "starting", done: total, total });
      const started = await startIngestBatch(port, batch.batch_id, http);
      this.post({
        type: "ingestResult",
        uploaded,
        rejected,
        skipped: plan.skipped,
        jobId: started.job_id,
      });
      this.showJobs();
    } catch (error) {
      this.postError(error, undefined, "upload");
    } finally {
      this.uploading = false;
    }
  }

  private showJobs(): void {
    if (!this.view) return;
    this.jobsVisible = true;
    this.post({ type: "jobsOpen" });
    void this.refreshJobs();
    this.startJobPolling();
  }

  private async refreshJobs(): Promise<boolean> {
    try {
      const jobs = await listIngestJobs(await this.port(), this.http());
      this.lastJobs = jobs;
      this.post({ type: "jobs", jobs });
      return true;
    } catch (error) {
      this.postError(error, undefined, "jobs");
      return false;
    }
  }

  private startJobPolling(): void {
    if (this.jobsTimer !== undefined) return;
    this.jobsTimer = setInterval(() => {
      void this.pollJobs();
    }, 2000);
  }

  private stopJobPolling(): void {
    if (this.jobsTimer !== undefined) {
      clearInterval(this.jobsTimer);
      this.jobsTimer = undefined;
    }
  }

  private async pollJobs(): Promise<void> {
    if (this.jobsPolling) return;
    if (!this.view || !this.jobsVisible) {
      this.stopJobPolling();
      return;
    }
    this.jobsPolling = true;
    try {
      const ok = await this.refreshJobs();
      if (!ok || !this.lastJobs.some((job) => job.state !== "done" && job.state !== "failed")) {
        this.stopJobPolling();
      }
    } finally {
      this.jobsPolling = false;
    }
  }

  private postServer(status: ServerStatus): void {
    this.post({ type: "server", status });
  }

  private postSetup(): void {
    const state = this.lastSetup ?? this.deps.getSetupState?.() ?? null;
    if (state) {
      this.lastSetup = state;
      this.post({ type: "setup", state });
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private postError(error: unknown, requestId?: number, scope?: string): void {
    const message: Record<string, unknown> = {
      type: "error",
      message: errorText(error),
    };
    if (requestId !== undefined) message.requestId = requestId;
    if (scope) message.scope = scope;
    this.post(message);
  }
}