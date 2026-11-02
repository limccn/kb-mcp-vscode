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

  it("shows the setup-required banner with a command link", () => {
    for (const id of ["setup-banner", "setup-text", "setup-action"]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    assert.ok(/<div id="setup-banner"[^>]* hidden>/.test(html));
    assert.ok(html.includes("Data folder setup required"));
    assert.ok(html.includes(`href="command:${COMMANDS.resumeMigration}"`));
    assert.ok(html.includes('message.type === "setup"'));
    assert.ok(html.includes('setupRequired && !serverRunning'));
    // A running/external server wins: the banner is hidden whenever it runs.
    assert.ok(html.includes("setupBanner.hidden = !setupActive"));
  });

  it("shows start/running or the external host and port", () => {
    assert.ok(html.includes('if (state === "running-own") label = "running"'));
    assert.ok(
      html.includes('label = displayHost(status.host) + (status.port ? ":" + status.port : "")')
    );
    assert.ok(html.includes('else if (state === "stopped") label = "start"'));
    assert.ok(!html.includes('? "external" : state'));
  });

  it("offers the grouped action menu", () => {
    for (const group of ["admin", "mcp", "ingest", "backup", "git", "more"]) {
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
      "menu-export",
      "menu-import",
      "menu-git",
      "menu-install-skills",
      "menu-install-cli-tools",
      "menu-setup-guide",
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
      COMMANDS.installCliTools,
      COMMANDS.openSetupGuide,
      COMMANDS.showSkillsState,
      COMMANDS.cliDoctor,
      COMMANDS.showLogs,
      COMMANDS.showRuntimeInfo,
      COMMANDS.cliExport,
      COMMANDS.cliImport,
    ]) {
      assert.ok(html.includes(`command:${command}`), command);
    }
    assert.ok(!html.includes(`command:${COMMANDS.openAdmin}`));
    const skillsAt = html.indexOf('id="menu-install-skills"');
    const toolsAt = html.indexOf('id="menu-install-cli-tools"');
    assert.ok(skillsAt >= 0 && toolsAt > skillsAt, "Install CLI tools follows Install MCP & skills");
    assert.ok(html.slice(toolsAt, html.indexOf(">", toolsAt)).includes('data-group="more"'));
    const guideAt = html.indexOf('id="menu-setup-guide"');
    assert.ok(guideAt > toolsAt, "Setup guide follows Install CLI tools");
    assert.ok(html.slice(guideAt, html.indexOf(">", guideAt)).includes('data-group="more"'));
    const progressAt = html.indexOf('id="menu-progress"');
    const exportAt = html.indexOf('id="menu-export"');
    const importAt = html.indexOf('id="menu-import"');
    const gitAt = html.indexOf('id="menu-git"');
    assert.ok(progressAt >= 0 && exportAt > progressAt, "Backup follows the Knowledge base group");
    assert.ok(importAt > exportAt, "Import follows Export");
    assert.ok(gitAt > importAt, "Git follows the Backup group");
    for (const id of ["menu-export", "menu-import"]) {
      const at = html.indexOf(`id="${id}"`);
      const openingTag = html.slice(at, html.indexOf(">", at));
      assert.ok(openingTag.includes('data-group="backup"'), id);
      assert.ok(openingTag.includes('role="menuitem"'), id);
    }
    assert.ok(
      html.slice(exportAt, html.indexOf(">", exportAt)).includes(`command:${COMMANDS.cliExport}`)
    );
    assert.ok(
      html.slice(importAt, html.indexOf(">", importAt)).includes(`command:${COMMANDS.cliImport}`)
    );
    assert.ok(html.includes(">Export backup (Markdown)…<"));
    assert.ok(html.includes(">Import backup (Markdown)…<"));
    assert.ok(html.includes('title="Export all documents as Markdown"'));
    assert.ok(html.includes('title="Import Markdown files into the knowledge base"'));
    assert.equal((html.match(/data-group="backup"/g) ?? []).length, 2);
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
      "copyText",
      "copyDocumentLink",
    ]) {
      assert.ok(html.includes(`type: "${type}"`), type);
    }
  });

  it("offers a custom context menu for search results", () => {
    assert.ok(html.includes('id="hitmenu"'));
    assert.ok(html.includes('resultsEl.addEventListener("contextmenu"'));
    for (const action of [
      "open",
      "copy-title",
      "copy-id",
      "copy-snippet",
      "copy-link",
      "copy-selection",
    ]) {
      assert.ok(html.includes(`data-action="${action}"`), action);
    }
    assert.ok(html.includes('"Search result actions"'));
    assert.ok(html.includes("hitMenuSelection"));
  });

  it("renders snippet segments with a show-more toggle", () => {
    assert.ok(html.includes("function appendSegments"));
    assert.ok(html.includes("hit.snippetView"));
    assert.ok(html.includes('"Show more"'));
    assert.ok(html.includes('"Show less"'));
    assert.ok(html.includes("-webkit-line-clamp: 3"));
    assert.ok(html.includes("max-height: 13.5em"));
    assert.ok(html.includes(".snippet-actions"));
    assert.ok(html.includes("justify-content: flex-end"));
    assert.ok(html.includes("actions.appendChild(toggle)"));
    assert.ok(html.includes("createElement(\"strong\")"));
    assert.ok(!html.includes("innerHTML"));
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
      "notice",
      "ingestProgress",
      "ingestResult",
      "jobs",
      "jobsOpen",
      "error",
      "setup",
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

  it("brackets IPv6 hosts and maps wildcards in document URLs", () => {
    assert.equal(
      documentUrl(1234, "notes/a b", "::1"),
      "http://[::1]:1234/documents/notes/a%20b"
    );
    assert.equal(documentUrl(1234, "x", "0.0.0.0"), "http://127.0.0.1:1234/documents/x");
  });
});