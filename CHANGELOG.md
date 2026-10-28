# Changelog

## 0.1.1 — 2026-10-28

Compact activity bar sidebar with a grouped action menu, per-vault search history, and
admin-driven ingest uploads.

### Added

- Per-vault search history in the query box (20 stored / 8 shown, arrow-key navigation,
  per-item delete, two-step clear).
- File and folder upload through the admin ingest API, with upload progress and an
  ingestion jobs sheet (2 s polling; the list is per admin process).
- Grouped `⋯` menu: admin start/restart and console links, MCP status and Reload MCP,
  uploads and conversion progress, a `/git` jump, and maintenance entries.

### Changed

- The sidebar top bar is icon-only (create, settings, refresh, `⋯`, admin console), the
  vault has its own row, mode and result count are one-line segmented controls
  (hybrid/lexical/fuzzy/semantic/rrf; 10/25/50, with the count segment hidden below
  298 px), and Filters toggle from a funnel icon with a count badge and stay collapsed by
  default.
- The status chip reads `start` when stopped, `running` for the extension's own server, and
  `127.0.0.1:<port>` for an external server.
- The vault selector and segments are taller with larger text; the filters inputs match the
  control size, and all webview type sizes follow one scale (10/11/12/13 px).
- Segmented controls support Arrow/Home/End selection with a single tab stop; the filter
  button announces its active-filter count.
- The activity bar seedling is scaled up 1.25× and re-centered, trimming the surrounding
  padding while keeping the 1.6 px stroke.
- Query/mode/limit/filters persist across view hide/show; a failed search or vault switch
  restores the vault selector.
- Status and MCP chips are reposted when the webview is ready, so the first paint is never
  stale.

## 0.1.0 — 2026-10-27

First release.

### Added

- Admin console as a Webview tab, backed by an extension-owned `hyseed admin start` process.
- Activity bar panel with vault-aware search (mode, limit, type, tags) and quick actions:
  open the admin console in VS Code's built-in browser, create a vault, install MCP/skills,
  run doctor, or open extension settings. Search results open in the built-in browser too.
- Monochrome 24×24 activity bar icon (SVG), plus the transparent 128×128 Marketplace icon.
- Server lifecycle commands: start, stop, restart, open in browser, runtime info, logs.
- MCP server definition provider (`kbmcp.vscode`, label `hyseed`) with data-root and vault env.
- Guided agent-skills install/remove/status for Claude Code, Codex, and Cline.
- Global and project vault creation, switching, workspace pinning, and `.mcp.json` merge.
- 21 `hyseed` CLI commands in a dedicated terminal, with safe cmd.exe quoting.
- Bundled `resources/hyseed.exe` fallback runtime.
- Bundled `resources/doc-convert.exe` and converter auto-detection for ingest (setting, env,
  runtime sibling, workspace `ingestion-rt`, then the bundled copy); `kbMcp.converterPath` setting.
- `npm run check:docs` consistency checks for README, commands, settings, and VSIX contents.
- `npm run package` enforces a 100 MiB VSIX size limit.

### Changed

- Default `kbMcp.adminPort` is now `51888` (was `8888`) to avoid the common port.