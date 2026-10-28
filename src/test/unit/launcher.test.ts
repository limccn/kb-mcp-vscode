import * as assert from "node:assert/strict";
import { COMMANDS } from "../../constants";
import { documentUrl, renderLauncherHtml } from "../../launcher";

const html = renderLauncherHtml({ nonce: "testnonce" });

describe("launcher webview", () => {
  it("runs a nonce script with no external resource sources", () => {
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-testnonce'"));
    assert.ok(html.includes('<script nonce="testnonce">'));
    assert.ok(html.includes("acquireVsCodeApi"));
    assert.ok(!html.includes("vscode-resource:"));
  });

  it("parses its inline script", () => {
    const match = /<script nonce="testnonce">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, "inline script not found");
    assert.doesNotThrow(() => new Function(match![1]));
  });

  it("keeps the compact top bar with icon-only actions", () => {
    for (const id of [
      "topbar",
      "status-chip",
      "status-dot",
      "status-text",
      "btn-create",
      "btn-settings",
      "btn-refresh",
      "btn-menu",
      "btn-admin",
    ]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(!html.includes(">Create<"));
    assert.ok(!html.includes(">Open admin console<"));
    assert.ok(!html.includes("id=\"open-admin\""));
    assert.ok(!html.includes("id=\"open-settings\""));
  });

  it("collapses filters and keeps vault, mode and limit visible", () => {
    for (const id of [
      "vault-row",
      "vault",
      "search-form",
      "query-row",
      "query",
      "history",
      "options-row",
      "mode",
      "limit",
      "filters",
      "filter-count",
      "type",
      "tags",
      "filters-clear",
      "search",
      "status",
      "results",
    ]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(/<div id="filters"[^>]* hidden>/.test(html));
    assert.ok(!/<details/.test(html));
    assert.ok(html.indexOf('id="vault-row"') < html.indexOf('id="search-form"'));
    for (const mode of ["hybrid", "lexical", "fuzzy", "semantic", "rrf"]) {
      assert.ok(html.includes(`data-value="${mode}"`), mode);
    }
    for (const limit of ["10", "25", "50"]) {
      assert.ok(html.includes(`data-value="${limit}"`), limit);
    }
    assert.ok(/id="mode"[^>]*role="radiogroup"/.test(html));
    assert.ok(/id="limit"[^>]*role="radiogroup"/.test(html));
    assert.ok(html.includes("@media (max-width: 297px) { #limit { display: none; } }"));
    assert.ok(html.includes('id="btn-filters"'));
    assert.ok(html.includes('aria-controls="filters"'));
  });

  it("shows start/running or the external host and port", () => {
    assert.ok(html.includes('if (state === "running-own") label = "running"'));
    assert.ok(html.includes('else if (state === "running-external") label = "127.0.0.1"'));
    assert.ok(html.includes('else if (state === "stopped") label = "start"'));
    assert.ok(!html.includes('? "external" : state'));
  });

  it("offers the grouped action menu", () => {
    for (const group of ["admin", "mcp", "ingest", "git", "more"]) {
      assert.ok(html.includes(`data-group="${group}"`), group);
    }
    for (const id of [
      "menu-start",
      "menu-restart",
      "menu-console",
      "menu-browser",
      "menu-mcp-status",
      "mcp-state",
      "menu-reload-mcp",
      "menu-upload-files",
      "menu-upload-folder",
      "menu-progress",
      "menu-jobs-badge",
      "menu-git",
      "menu-install-skills",
      "menu-skills-state",
      "menu-doctor",
      "menu-logs",
      "menu-runtime",
    ]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    for (const command of [
      COMMANDS.createVault,
      COMMANDS.startServer,
      COMMANDS.restartServer,
      COMMANDS.openInBrowser,
      COMMANDS.showMcpStatus,
      COMMANDS.installAgentSkills,
      COMMANDS.showSkillsState,
      COMMANDS.cliDoctor,
      COMMANDS.showLogs,
      COMMANDS.showRuntimeInfo,
    ]) {
      assert.ok(html.includes(`command:${command}`), command);
    }
    assert.ok(!html.includes(`command:${COMMANDS.openAdmin}`));
  });

  it("keeps the simplified groups free of native Git and MCP lifecycle", () => {
    assert.equal((html.match(/data-group="mcp"/g) ?? []).length, 2);
    assert.equal((html.match(/data-group="git"/g) ?? []).length, 1);
    const menuHtml = html.slice(html.indexOf('<div id="menu"'), html.indexOf("<script"));
    for (const text of ["Start MCP", "Restart MCP", "commit", "push", "pull"]) {
      assert.ok(!menuHtml.toLowerCase().includes(text.toLowerCase()), text);
    }
    const startAt = html.indexOf('id="menu-start"');
    const startTagEnd = html.indexOf(">", startAt);
    assert.ok(startAt >= 0 && startTagEnd > startAt, "menu-start missing");
    assert.ok(html.slice(startAt, startTagEnd).includes(`command:${COMMANDS.startServer}`));
    assert.ok(!html.includes("innerHTML"));
  });

  it("renders the ingestion jobs sheet", () => {
    for (const id of ["jobs", "jobs-list", "jobs-close", "jobs-refresh", "jobs-open", "jobs-note"]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(html.includes("restarting the server clears them"));
  });

  it("bridges search, history and actions through messages", () => {
    for (const type of [
      "ready",
      "refresh",
      "openAdmin",
      "openSettings",
      "switchVault",
      "search",
      "openDocument",
      "reloadMcp",
      "upload",
      "showJobs",
      "hideJobs",
      "refreshJobs",
      "openGitPage",
      "openIngestPage",
      "forgetQuery",
      "clearHistory",
    ]) {
      assert.ok(html.includes(`type: "${type}"`), type);
    }
  });

  it("handles host messages for status, history, jobs and errors", () => {
    for (const type of [
      "server",
      "mcp",
      "vaults",
      "vault",
      "history",
      "results",
      "refreshed",
      "ingestProgress",
      "ingestResult",
      "jobs",
      "jobsOpen",
      "error",
    ]) {
      assert.ok(html.includes(`message.type === "${type}"`), type);
    }
    for (const scope of ["upload", "jobs", "vaults", "search", "switch"]) {
      assert.ok(html.includes(`scope === "${scope}"`), scope);
    }
  });

  it("keeps slashes in document ids and encodes each segment", () => {
    assert.equal(
      documentUrl(1234, "notes/2026 plan"),
      "http://127.0.0.1:1234/documents/notes/2026%20plan"
    );
  });
});