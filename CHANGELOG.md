# Changelog

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