# hyseed for VS Code

在 VS Code 里使用本地 **hyseed** 知识库：侧栏检索、管理台、MCP 与技能安装，以及常用 CLI
命令，无需离开编辑器。

Windows x64，VS Code 1.101 及以上。

## 功能

- **侧栏检索** — 按知识库检索，支持模式、结果数、过滤条件与检索历史。
- **管理台** — 在 Webview 标签页中打开完整的 hyseed 管理界面。
- **MCP 与技能** — 注册 `hyseed` MCP 服务器，为 Claude Code、Codex、Cline 安装技能。
- **知识库（vault）** — 全局知识库，并可为当前工作区固定一个。
- **备份** — 在 `⋯` 菜单中把全部文档导出/导入为 Markdown。
- **开箱即用** — 扩展自带 `hyseed.exe`，无需单独安装。

## 安装

```bash
code --install-extension kbmcp-vscode-win32-x64-0.2.0.vsix
```

安装后重新加载窗口。命令位于 `hyseed:` 前缀下。

## 首次使用

1. **CLI 工具**（推荐，默认勾选）— 把 `hyseed.exe` 与 `doc-convert.exe` 复制到
   `%USERPROFILE%\.local\bin`。只报告 PATH 状态，不修改 PATH。
2. **MCP 与技能**（可选）— 为你的 AI 工具注册 MCP 服务器与技能。
3. **数据目录** — 使用默认目录（`%USERPROFILE%\.local\share\hyseed`）或另选；会创建
   `default` 知识库。

首次安装或大版本升级后，向导会自动打开。可用 `hyseed: Setup guide` 重开，或在管理台的
**Doctor** 中打开。

## 从 0.1.x 升级

0.2.0 退役了旧名称与旧位置。激活时，若数据目录为空，扩展会检查 0.1.x 留下的数据；在你
做出选择前不会写入任何内容：

- **迁移** — 把旧数据移动到新目录。
- **使用现有** — 保留新目录，旧目录原样不动。
- **稍后** — 启动挂起，直到执行 `hyseed: Setup data folder`。

若新旧目录都有数据，只能二选一，不会合并。没有降级路径，重要文档请先备份
（`⋯` → **Export backup**）。

`~/.config/kb-mcp`、旧 HTTP token 文件与 `kb-mcp.exe` 不再被读取或启动。

## 侧栏

知识库独占一行；顶栏包含新建、设置、刷新、管理与 `⋯` 菜单（管理服务、MCP 状态、上传、
备份导出/导入、`/git`、维护）。结果在 VS Code 浏览器中打开，右键可复制或复制链接。

## 数据与备份

文档默认位于 `%USERPROFILE%\.local\share\hyseed`。更新扩展不会影响该目录。用 `⋯` →
**Export backup** 导出可移植的 Markdown 副本，用 **Import backup** 恢复。

## 命令

所有命令均在命令面板的 `hyseed:` 前缀下。

| ID | 用途 |
|---|---|
| `kbmcp.openAdmin` | 打开管理台标签页 |
| `kbmcp.startServer` | 启动管理服务 |
| `kbmcp.stopServer` | 停止扩展管理的服务 |
| `kbmcp.restartServer` | 重启服务 |
| `kbmcp.openInBrowser` | 在浏览器中打开管理台 |
| `kbmcp.showRuntimeInfo` | 显示解析到的可执行文件 |
| `kbmcp.showLogs` | 打开输出面板 |
| `kbmcp.showMcpStatus` | 显示 MCP 注册状态与知识库 |
| `kbmcp.installAgentSkills` | 安装代理技能 |
| `kbmcp.installCliTools` | 安装 `hyseed.exe` / `doc-convert.exe` |
| `kbmcp.removeAgentSkills` | 移除代理技能 |
| `kbmcp.showSkillsState` | 显示技能安装状态 |
| `kbmcp.createVault` | 新建知识库 |
| `kbmcp.switchVault` | 切换默认知识库 |
| `kbmcp.clearProjectVault` | 清除工作区固定 |
| `kbmcp.listVaults` | 列出知识库 |
| `kbmcp.resumeMigration` | 继续数据目录选择 |
| `kbmcp.openSetupGuide` | 打开设置向导 |
| `kbmcp.cli.search` | 运行 `hyseed search` |
| `kbmcp.cli.get` | 运行 `hyseed get` |
| `kbmcp.cli.list` | 运行 `hyseed list` |
| `kbmcp.cli.add` | 运行 `hyseed add` |
| `kbmcp.cli.ingest` | 运行 `hyseed ingest` |
| `kbmcp.cli.import` | 运行 `hyseed import` |
| `kbmcp.cli.export` | 运行 `hyseed export` |
| `kbmcp.cli.doctor` | 运行 `hyseed doctor` |
| `kbmcp.cli.stats` | 运行 `hyseed stats` |
| `kbmcp.cli.reindex` | 运行 `hyseed reindex` |
| `kbmcp.cli.diff-check` | 运行 `hyseed diff-check` |
| `kbmcp.cli.history` | 运行 `hyseed history` |
| `kbmcp.cli.vaultList` | 运行 `hyseed vault list` |
| `kbmcp.cli.vaultCreate` | 运行 `hyseed vault create` |
| `kbmcp.cli.vaultSwitch` | 运行 `hyseed vault switch` |
| `kbmcp.cli.vaultStatus` | 运行 `hyseed vault status` |
| `kbmcp.cli.skillsList` | 运行 `hyseed skills list` |
| `kbmcp.cli.skillsShow` | 运行 `hyseed skills show` |
| `kbmcp.cli.skillsAdd` | 运行 `hyseed skills add` |
| `kbmcp.cli.skillsRemove` | 运行 `hyseed skills remove` |
| `kbmcp.cli.serveHttp` | 运行 `hyseed serve`（HTTP） |

CLI 命令在专用的 `hyseed` 终端中运行。包含 `"`、`%`、`!` 或换行的值会被拒绝，请在你
自己的终端中执行。

## 设置

| 设置 | 默认值 | 说明 |
|---|---|---|
| `kbMcp.runtimePath` | `""` | 指定 `hyseed.exe`；留空 = 自动检测 |
| `kbMcp.adminPort` | `51888` | 首选管理端口；被占用时顺延 |
| `kbMcp.adminHost` | `127.0.0.1` | 绑定地址；非回环会暴露无鉴权的管理台 |
| `kbMcp.mcpHost` | `127.0.0.1` | MCP HTTP 绑定地址；非回环需令牌与防火墙规则 |
| `kbMcp.dataRoot` | `""` | 指定数据目录；留空 = 默认目录 |
| `kbMcp.projectVault` | `""` | 工作区固定的知识库 |
| `kbMcp.converterPath` | `""` | 指定 `doc-convert.exe`；留空 = 自动检测 |

## 常见问题

| 现象 | 处理 |
|---|---|
| 端口 51888 被占用 | 自动使用下一个空闲端口 |
| 找不到 `hyseed.exe` | 查看 `hyseed: Show runtime info`，或设置 `kbMcp.runtimePath` |
| 导入找不到转换器 | 设置 `kbMcp.converterPath` 指向 `doc-convert.exe`，然后重启服务 |
| 停止后端口仍占用 | 错误信息会给出 PID，用 `taskkill /PID <pid> /T /F` 结束 |
| 管理台空白 | 启动服务并查看 `hyseed: Show logs` |

## 隐私

管理台与 MCP 服务默认只绑定回环地址。管理台没有鉴权，只应在可信网络暴露。凭据保存在
用户目录（不在扩展内）；代理宿主的配置文件只由 `hyseed` CLI 写入，并且写入前会备份。

## 开发

```bash
npm install && npm run build     # dist/extension.js
npm run typecheck && npm test
npm run check:docs && npm run package
```

产品门户在 `portal/`（独立 Next.js 站点），见 `portal/README.md`。

## 许可证

MIT。