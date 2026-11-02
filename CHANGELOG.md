# Changelog

## 0.2.0 — 2026-10-30

First public release since the local-only 0.1.3/0.1.4 builds. There is no downgrade path.

### Added

- Setup guide on first install or a major/minor upgrade: CLI tools, MCP & skills, data folder.
- Upgrade from 0.1.x: old data is detected before anything is written, then migrated, kept in
  place, or deferred. Two data folders are never merged.
- `hyseed home inspect|migrate|set-data-dir` commands.
- Sidebar `⋯` → Backup: export/import all documents as Markdown.

### Changed

- Old names and locations are retired: `kb-mcp.exe`, `~/.local/share/kb-mcp`,
  `~/.config/kb-mcp`, and the old HTTP token file are no longer read or launched. They are
  only reported as migration candidates.
- The bundled runtime is updated to 0.2.0.
- README refreshed in English, Chinese, and Japanese.

## 0.1.4 — 2026-10-29

Local build only.

### Changed

- The admin console is fully server-rendered; the old single-page routes are gone.
- One component layer for dialogs, toasts, pagination, and the sidebar; the editor and graph
  views are bundled rather than loaded from a CDN.

## 0.1.3 — 2026-10-29

Local build only.

### Added

- `hyseed: Install CLI tools` copies the bundled executables to `%USERPROFILE%\.local\bin`
  and reports PATH without changing it.
- Separate `kbMcp.adminHost` and `kbMcp.mcpHost` settings.

### Changed

- `hyseed admin start` accepts `--host`; the default command line is unchanged.

## 0.1.2 — 2026-10-29

Local build only.

### Fixed

- Documents live in `%USERPROFILE%\.local\share\hyseed`, so updating the extension no longer
  hides the knowledge base.

## 0.1.1 — 2026-10-28

- Compact sidebar with a grouped action menu, per-vault search history, and uploads with
  progress.

## 0.1.0 — 2026-10-27

First release.

- Admin console tab, sidebar search, vault management, MCP server, and agent skills.
- 21 CLI commands in a dedicated terminal.
- Bundled runtime and document converter.