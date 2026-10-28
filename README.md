# hyseed for VS Code

Bring the **hyseed** (formerly kb-mcp) local knowledge base into VS Code: the admin console as a
Webview tab, MCP/skills setup, vault management, and the most-used CLI commands in the Command
Palette.

> Status: early development (0.1.1). Windows x64 only for now.

## Features

- **Admin console tab** — the hyseed admin UI inside VS Code, backed by an extension-owned server.
- **Activity bar panel** — a compact search surface: the vault gets its own row, mode and result
  count are one-line segmented controls (hybrid/lexical/fuzzy/semantic/rrf; 10/25/50, count
  hidden below 298 px), and a funnel
  icon toggles the filters with a count badge. The query box offers per-vault search
  history (arrow keys, Enter, per-item delete, two-step clear). The icon top bar holds create,
  settings, refresh, the `⋯` action menu (admin service, MCP status/reload, file and folder upload
  with conversion progress, a `/git` jump, maintenance), and the admin console button.
  Install/Remove skills stay in the Command Palette.
- **Server lifecycle** — start, stop, restart, open in browser; the state machine survives port
  conflicts and reuses an already-running console.
- **MCP server definition** — registers `hyseed` (`hyseed serve`) for VS Code's MCP support,
  honoring the workspace vault pin.
- **Agent skills** — guided install/remove/status for Claude Code, Codex, and Cline, in global or
  project scope, through the `hyseed skills` CLI.
- **Vaults** — create global or project vaults, switch the global default, pin a workspace vault.
- **CLI in the terminal** — 21 `hyseed` commands with prompts and a visible terminal.

## Requirements

- Windows 10/11 (x64)
- VS Code 1.101 or newer (tested with 1.143.1)
- No separate hyseed install required: a `hyseed.exe` is bundled as a fallback.

## Install

```bash
code --install-extension kbmcp-vscode-win32-x64-0.1.1.vsix
```

For intranet distribution, share the same VSIX file; the Marketplace is not required. Reload the
window after installing. Commands appear under the `hyseed:` prefix.

Once published (publisher `limccn`), install from the VS Code Marketplace or Open VSX instead:

```bash
code --install-extension limccn.kbmcp-vscode
```

## Commands

All commands are in the Command Palette under the `hyseed:` prefix.

| Command | ID | What it does |
|---|---|---|
| Open admin console | `kbmcp.openAdmin` | Starts the server if needed and opens the admin console in a Webview tab |
| Start admin server | `kbmcp.startServer` | Starts the admin server as an extension-owned process |
| Stop admin server | `kbmcp.stopServer` | Stops the extension-owned server process tree |
| Restart admin server | `kbmcp.restartServer` | Stops (if owned) and starts again |
| Open admin console in browser | `kbmcp.openInBrowser` | Opens the console in your system browser |
| Show runtime info | `kbmcp.showRuntimeInfo` | Shows the resolved executable, candidates, and probe results |
| Show logs | `kbmcp.showLogs` | Opens the output channel |
| Show MCP status | `kbmcp.showMcpStatus` | Shows the MCP provider id/label, registration state, data root, and project vault |
| Install agent skills | `kbmcp.installAgentSkills` | Guided `hyseed skills add` for Claude Code / Codex / Cline (global or project) |
| Remove agent skills | `kbmcp.removeAgentSkills` | Guided `hyseed skills remove` |
| Show skills state | `kbmcp.showSkillsState` | Lists bundled skills and per-host install state |
| Create vault | `kbmcp.createVault` | Creates a global or workspace-pinned vault |
| Switch vault | `kbmcp.switchVault` | Sets the global default vault |
| Clear project vault pin | `kbmcp.clearProjectVault` | Removes the workspace pin and the `.mcp.json` env key |
| List vaults | `kbmcp.listVaults` | Shows vaults with current / workspace-pin markers |
| CLI search | `kbmcp.cli.search` | `hyseed search <query>` in the terminal |
| CLI get document | `kbmcp.cli.get` | `hyseed get <id>` |
| CLI list documents | `kbmcp.cli.list` | `hyseed list` |
| CLI add document | `kbmcp.cli.add` | `hyseed add --type … --title … [--body …]` |
| CLI ingest documents | `kbmcp.cli.ingest` | `hyseed ingest [file\|folder] --out <dir>` |
| CLI import Markdown | `kbmcp.cli.import` | `hyseed import <dir>` |
| CLI export Markdown | `kbmcp.cli.export` | `hyseed export <dir>` |
| CLI doctor | `kbmcp.cli.doctor` | `hyseed doctor` |
| CLI stats | `kbmcp.cli.stats` | `hyseed stats` |
| CLI reindex | `kbmcp.cli.reindex` | `hyseed reindex` (confirmed) |
| CLI diff-check | `kbmcp.cli.diff-check` | `hyseed diff-check` |
| CLI history | `kbmcp.cli.history` | `hyseed history <id>` |
| CLI vault list | `kbmcp.cli.vaultList` | `hyseed vault list` |
| CLI vault create | `kbmcp.cli.vaultCreate` | `hyseed vault create <name>` |
| CLI vault switch | `kbmcp.cli.vaultSwitch` | `hyseed vault switch <name>` (pick from the live list) |
| CLI vault status | `kbmcp.cli.vaultStatus` | `hyseed vault status` |
| CLI skills list | `kbmcp.cli.skillsList` | `hyseed skills list` |
| CLI skills show | `kbmcp.cli.skillsShow` | `hyseed skills show <name>` |
| CLI skills add | `kbmcp.cli.skillsAdd` | `hyseed skills add --agent … --scope …` |
| CLI skills remove | `kbmcp.cli.skillsRemove` | `hyseed skills remove --agent … --scope …` (confirmed) |
| CLI serve (HTTP) | `kbmcp.cli.serveHttp` | `hyseed serve --transport http --port <N>` |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `kbMcp.runtimePath` | `""` | Explicit path to `hyseed.exe`. Empty = auto-detect. |
| `kbMcp.adminPort` | `51888` | Preferred admin port; the next free port is used when occupied. |
| `kbMcp.dataRoot` | `""` | Explicit data root (sets `KB_MCP_HOME` for the spawned server). Empty = runtime default. |
| `kbMcp.projectVault` | `""` | Workspace-pinned vault; the MCP definition provider passes it as `KB_MCP_VAULT`. |
| `kbMcp.converterPath` | `""` | Explicit path to `doc-convert.exe` (or a `.cmd` wrapper). Empty = auto-detect. Machine scope, so workspace settings cannot point it at an executable. |

## Data root

When `kbMcp.dataRoot` is empty, the hyseed runtime resolves its data root in this order:

1. `KB_MCP_HOME` (the extension sets this from `kbMcp.dataRoot`);
2. `data_dir` in `~/.config/hyseed/config.yaml` (the pre-rename
   `~/.config/kb-mcp/config.yaml` is read when the new file is absent);
3. frozen builds: `<exe folder>\data` — the bundled `resources\hyseed.exe` therefore defaults to a
   data folder inside the extension directory;
4. `~/.local/share/hyseed`.

Set `kbMcp.dataRoot` to keep the knowledge base in a stable place across extension updates.

## Vaults

`hyseed: Create vault` offers two scopes:

- **global** — a vault in the global data root; you can make it the default (`hyseed vault switch`).
- **project** — the vault is still created in the global data root, but this workspace is pinned to
  it: `kbMcp.projectVault` in `.vscode/settings.json` (used by the MCP provider) and, when
  `.mcp.json` already contains a project-scope `hyseed` entry, `KB_MCP_VAULT` in that entry's `env`.
  The global current vault does not change.

The `.mcp.json` edit backs up the file (`.mcp.json.bak-<timestamp>`), writes atomically, and verifies
the result. If the project entry does not exist yet, run `hyseed: Install agent skills` with scope
*project* first, then re-pin.

Re-running the skills installer with `--force` can rewrite the entry and drop the env key; repeat
`hyseed: Create vault` for the same name (idempotent) to pin it again.

## CLI in the terminal

The `hyseed: CLI …` commands prompt for the required arguments and run the matching `hyseed`
command in a dedicated **hyseed** terminal (fixed `cmd.exe`, AutoRun off), so output stays visible,
`Ctrl+C` works, and you can copy it. Each run sends, in order:

1. `set "KB_MCP_HOME=…"` when `kbMcp.dataRoot` is set, and `set "KB_MCP_VAULT=…"` when
   `kbMcp.projectVault` is set;
2. for `CLI serve (HTTP)`, `set /p KB_MCP_HTTP_TOKEN=<"<token file>"` — the token value is never
   placed on the command line. The file is `%USERPROFILE%\.hyseed-http-token`; the pre-rename
   `.kb-mcp-http-token` is reused when the new one is missing, and a fresh 32-hex token is offered
   when neither exists;
3. the command line itself;
4. `echo [hyseed exit=%errorlevel%]`.

Arguments are quoted automatically (spaces and shell metacharacters). Values containing `"`, `%`,
`!`, or a newline are refused rather than escaped — run those in your own terminal.

## How the executable is resolved

1. `kbMcp.runtimePath` setting
2. `%USERPROFILE%\.local\bin` (`hyseed.exe`, then `kb-mcp.exe`)
3. `%USERPROFILE%\.local\share\hyseed` (legacy `share\kb-mcp` also accepted)
4. `PATH` (`hyseed`, then `kb-mcp`)
5. Built-in copy shipped in the extension (`resources\hyseed.exe`)

The first candidate that answers `--version` wins. A path you set explicitly must work, or you get
an error instead of a silent fallback.

## How the document converter is resolved

`hyseed ingest` needs a document converter. The extension resolves it on every server start and
every CLI ingest:

1. `kbMcp.converterPath` setting
2. `KB_INGEST_CONVERTER` environment variable
3. `doc-convert.exe` next to the resolved `hyseed.exe`
4. `ingestion-rt\doc-convert.exe` in an open workspace folder
5. The copy bundled with the extension (`resources\doc-convert.exe`)

An explicit setting or environment variable is used as-is; a typo fails the ingest instead of
silently falling back. The admin server receives the resolved path as `KB_INGEST_CONVERTER`; the
`hyseed: ingest` palette command appends `--converter <path>`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Port 51888 is busy | The extension picks the next free port; the status bar and admin tab show the actual port. |
| Another hyseed console is already running | It is reused as an external instance. `Stop` will not kill an instance the extension does not own. |
| Stop leaves the port open | The error names the port and PID plus the manual `taskkill /PID <pid> /T /F` command. |
| `hyseed.exe` not found | Run `hyseed: Show runtime info` to see each candidate and probe error; set `kbMcp.runtimePath`. The bundled copy is the last resort. |
| `hyseed ingest` fails with "no document converter found" | Set `kbMcp.converterPath` to a `doc-convert.exe`; normally the bundled copy or the one next to `hyseed.exe` is found. Restart the server after changing the setting. |
| HTTP serve keeps failing on the token | The token file is `%USERPROFILE%\.hyseed-http-token`. Accept the prompt to generate a 32-hex token, or create the file yourself. |
| The project vault pin disappeared | `skills add --force` rewrites the `.mcp.json` entry. Re-run `hyseed: Create vault` for the same name (idempotent). |
| A CLI command refuses an argument | `"`, `%`, `!`, and newlines are refused by design; run that command in your own terminal. |
| The admin tab shows nothing | Start the server and check `hyseed: Show logs`; verify nothing else owns the port. |

## Security

- The admin server binds `127.0.0.1` only. Its console has **no authentication** — treat it as a
  local-only surface and do not expose the port to a network.
- `hyseed serve --transport http` requires `KB_MCP_HTTP_TOKEN`; the extension reads it from the
  token file and never places the value on a command line.
- The extension stores no credentials and never reads project secret files.
- Agent host files (`~/.claude.json`, Codex/Cline settings) are written only by the `hyseed` CLI,
  with a timestamped backup and atomic replace.

## Development

```bash
npm install
npm run build        # bundle to dist/extension.js
npm run watch        # incremental build
npm run typecheck
npm run check:docs   # README/commands/settings/VSIX-content consistency
npm run package      # build + copy runtime + check:docs + vsce package --target win32-x64
```

Launch the extension host with F5. Tests run in a sandbox (temporary `KB_MCP_HOME`, temporary
ports); they never touch the real data root or `config.yaml`.

## License

MIT. The bundled `hyseed.exe` is part of the hyseed project (MIT). Thanks to the hyseed (formerly
kb-mcp) contributors.

## Acknowledgements

This extension builds on the **hyseed** (formerly kb-mcp) local knowledge base project and would
not exist without it. Thanks to:

- [limccn/kb-mcp](https://github.com/limccn/kb-mcp)
- [HelloTomBruce/kb-mcp](https://github.com/HelloTomBruce/kb-mcp)