# hyseed for VS Code

Your local **hyseed** knowledge base inside VS Code: search from the sidebar, manage the
admin console, install MCP/skills, and run the common CLI commands without leaving the editor.

Windows x64, VS Code 1.101+.

## Highlights

- **Sidebar search** — vault-aware search with mode, result count, filters, and per-vault history.
- **Admin console** — the full hyseed admin UI in a Webview tab.
- **MCP & skills** — register the `hyseed` MCP server and install agent skills for Claude Code,
  Codex, or Cline.
- **Vaults** — global vaults plus a per-workspace pin.
- **Backup** — export/import all documents as Markdown from the `⋯` menu.
- **Batteries included** — a `hyseed.exe` is bundled; no separate install is required.

## Install

```bash
code --install-extension kbmcp-vscode-win32-x64-0.2.0.vsix
```

Reload the window afterwards. Commands appear under `hyseed:`.

## First run

1. **CLI tools** (recommended, on by default) — copies `hyseed.exe` and `doc-convert.exe` to
   `%USERPROFILE%\.local\bin`. PATH is reported, never changed.
2. **MCP & skills** (optional) — registers the MCP server and agent skills for your AI tools.
3. **Data folder** — accept the default (`%USERPROFILE%\.local\share\hyseed`) or choose another.
   A `default` vault is created.

The guide opens automatically after a first install or a major/minor upgrade. Reopen it with
`hyseed: Setup guide`, or from **Doctor** in the admin console.

## Upgrading from 0.1.x

0.2.0 retires the old names and locations. On activation, an empty data folder is checked for
data left by 0.1.x. Nothing is written until you choose:

- **Migrate** — move the old data into the new folder.
- **Use existing** — keep the new folder and leave the old one in place.
- **Not now** — hold startup until `hyseed: Setup data folder`.

If both folders contain data, you pick one; nothing is merged. There is no downgrade path, so
back up important documents first (`⋯` → **Export backup**).

`~/.config/kb-mcp`, the old HTTP token file, and `kb-mcp.exe` are no longer read or launched.

## Sidebar

The vault has its own row; the top bar holds create, settings, refresh, admin, and the `⋯` menu
(admin service, MCP status, uploads, backup export/import, `/git`, maintenance). Results open in
VS Code's browser and offer copy/link actions on right-click.

## Data and backup

Documents live in `%USERPROFILE%\.local\share\hyseed` by default. Keep that folder to keep your
knowledge base; updating the extension does not touch it. Use `⋯` → **Export backup** for a
portable Markdown copy and **Import backup** to restore one.

## Commands

All commands are in the Command Palette under `hyseed:`.

| ID | Purpose |
|---|---|
| `kbmcp.openAdmin` | Open the admin console tab |
| `kbmcp.startServer` | Start the admin server |
| `kbmcp.stopServer` | Stop the extension-owned server |
| `kbmcp.restartServer` | Restart the server |
| `kbmcp.openInBrowser` | Open the console in a browser |
| `kbmcp.showRuntimeInfo` | Show the resolved executable |
| `kbmcp.showLogs` | Open the output channel |
| `kbmcp.showMcpStatus` | Show MCP registration and vault |
| `kbmcp.installAgentSkills` | Install agent skills |
| `kbmcp.installCliTools` | Install `hyseed.exe` / `doc-convert.exe` |
| `kbmcp.removeAgentSkills` | Remove agent skills |
| `kbmcp.showSkillsState` | Show skills install state |
| `kbmcp.createVault` | Create a vault |
| `kbmcp.switchVault` | Switch the default vault |
| `kbmcp.clearProjectVault` | Clear the workspace pin |
| `kbmcp.listVaults` | List vaults |
| `kbmcp.resumeMigration` | Resume the data-folder decision |
| `kbmcp.openSetupGuide` | Open the setup guide |
| `kbmcp.cli.search` | Run `hyseed search` |
| `kbmcp.cli.get` | Run `hyseed get` |
| `kbmcp.cli.list` | Run `hyseed list` |
| `kbmcp.cli.add` | Run `hyseed add` |
| `kbmcp.cli.ingest` | Run `hyseed ingest` |
| `kbmcp.cli.import` | Run `hyseed import` |
| `kbmcp.cli.export` | Run `hyseed export` |
| `kbmcp.cli.doctor` | Run `hyseed doctor` |
| `kbmcp.cli.stats` | Run `hyseed stats` |
| `kbmcp.cli.reindex` | Run `hyseed reindex` |
| `kbmcp.cli.diff-check` | Run `hyseed diff-check` |
| `kbmcp.cli.history` | Run `hyseed history` |
| `kbmcp.cli.vaultList` | Run `hyseed vault list` |
| `kbmcp.cli.vaultCreate` | Run `hyseed vault create` |
| `kbmcp.cli.vaultSwitch` | Run `hyseed vault switch` |
| `kbmcp.cli.vaultStatus` | Run `hyseed vault status` |
| `kbmcp.cli.skillsList` | Run `hyseed skills list` |
| `kbmcp.cli.skillsShow` | Run `hyseed skills show` |
| `kbmcp.cli.skillsAdd` | Run `hyseed skills add` |
| `kbmcp.cli.skillsRemove` | Run `hyseed skills remove` |
| `kbmcp.cli.serveHttp` | Run `hyseed serve` (HTTP) |

CLI commands open in a dedicated `hyseed` terminal. Values containing `"`, `%`, `!`, or a
newline are refused for safety; run those in your own terminal.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `kbMcp.runtimePath` | `""` | Explicit `hyseed.exe`; empty = auto-detect |
| `kbMcp.adminPort` | `51888` | Preferred admin port; the next free port is used |
| `kbMcp.adminHost` | `127.0.0.1` | Bind address; non-loopback exposes the console (no authentication) |
| `kbMcp.mcpHost` | `127.0.0.1` | MCP HTTP bind address; non-loopback needs a token and firewall rule |
| `kbMcp.dataRoot` | `""` | Explicit data folder; empty = default |
| `kbMcp.projectVault` | `""` | Workspace-pinned vault |
| `kbMcp.converterPath` | `""` | Explicit `doc-convert.exe`; empty = auto-detect |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Port 51888 busy | The next free port is used automatically |
| `hyseed.exe` not found | Check `hyseed: Show runtime info`, or set `kbMcp.runtimePath` |
| Ingest cannot find a converter | Set `kbMcp.converterPath` to `doc-convert.exe` and restart the server |
| Stop leaves the port open | The error names the PID; end it with `taskkill /PID <pid> /T /F` |
| Admin tab is blank | Start the server and check `hyseed: Show logs` |

## Privacy

The admin console and MCP server bind to loopback by default. The admin console has no
authentication; only expose it on a trusted network. Credentials are stored in your user
profile (never in this extension), and agent host files are written only by the `hyseed` CLI
with a backup.

## Development

```bash
npm install && npm run build     # dist/extension.js
npm run typecheck && npm test
npm run check:docs && npm run package
```

The product portal lives in `portal/` (a standalone Next.js site); see `portal/README.md`.

## License

MIT.