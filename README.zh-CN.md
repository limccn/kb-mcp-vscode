# 适用于 VS Code 的 hyseed

把 **hyseed**（原 kb-mcp）本地知识库带进 VS Code：管理台 Webview 标签页、MCP / 技能配置、
知识库（vault）管理，以及命令面板里的常用 CLI 指令。

> 状态：早期开发（0.1.0），目前仅支持 Windows x64。

## 功能

- **管理台标签页** —— 在 VS Code 内打开 hyseed 管理界面，由扩展自有的服务进程支撑。
- **活动栏面板** —— 在活动栏中直接搜索所选 vault（查询、模式、数量、类型、标签），并提供快捷操作：
  在 VS Code 内置浏览器中打开管理台、创建 vault、安装 MCP/技能、运行 doctor、打开扩展设置。
- **服务生命周期** —— 启动、停止、重启、在浏览器打开；端口被占用时自动顺延，已有实例会被复用。
- **MCP 服务定义** —— 为 VS Code 的 MCP 支持注册 `hyseed`（`hyseed serve`），并遵循工作区 vault pin。
- **Agent 技能** —— 通过 `hyseed skills` CLI 引导安装 / 移除 / 查看 Claude Code、Codex、Cline
  的技能状态，支持 global 与 project 两种作用域。
- **知识库（vault）** —— 创建 global / project vault、切换全局默认、为工作区固定 vault。
- **终端里的 CLI** —— 21 条带提示的 `hyseed` 指令，输出留在可见终端里。

## 要求

- Windows 10/11（x64）
- VS Code 1.101 或更新（实测 1.143.1）
- 无需单独安装 hyseed：扩展内置一份 `hyseed.exe` 作为兜底。

## 安装

```bash
code --install-extension kbmcp-vscode-win32-x64-0.1.0.vsix
```

内网分发直接共享同一个 VSIX 即可，不依赖市场。安装后重载窗口；命令位于 `hyseed:` 前缀下。

发布后（publisher `limccn`）也可直接从 VS Code Marketplace 或 Open VSX 安装：

```bash
code --install-extension limccn.kbmcp-vscode
```

## 命令

全部命令都在命令面板中，前缀 `hyseed:`。

| 命令 | ID | 作用 |
|---|---|---|
| 打开管理台 | `kbmcp.openAdmin` | 必要时启动服务，并在 Webview 标签页中打开管理台 |
| 启动管理服务 | `kbmcp.startServer` | 以扩展自有进程启动管理服务 |
| 停止管理服务 | `kbmcp.stopServer` | 停止扩展自有的进程树 |
| 重启管理服务 | `kbmcp.restartServer` | 停止（若自有）后再次启动 |
| 在浏览器打开管理台 | `kbmcp.openInBrowser` | 用系统浏览器打开管理台 |
| 显示运行体信息 | `kbmcp.showRuntimeInfo` | 显示解析到的可执行文件、候选与探测结果 |
| 显示日志 | `kbmcp.showLogs` | 打开输出通道 |
| 显示 MCP 状态 | `kbmcp.showMcpStatus` | 显示 MCP provider id/label、注册状态、数据根与项目 vault |
| 安装 Agent 技能 | `kbmcp.installAgentSkills` | 引导执行 `hyseed skills add`（Claude Code / Codex / Cline，global 或 project） |
| 移除 Agent 技能 | `kbmcp.removeAgentSkills` | 引导执行 `hyseed skills remove` |
| 显示技能状态 | `kbmcp.showSkillsState` | 列出内置技能及各 host 的安装状态 |
| 创建 vault | `kbmcp.createVault` | 创建 global 或工作区 pinned vault |
| 切换 vault | `kbmcp.switchVault` | 设置全局默认 vault |
| 清除项目 vault pin | `kbmcp.clearProjectVault` | 移除工作区 pin 与 `.mcp.json` 的 env 键 |
| 列出 vault | `kbmcp.listVaults` | 显示 vault 及 current / 工作区 pin 标记 |
| CLI 搜索 | `kbmcp.cli.search` | 终端执行 `hyseed search <query>` |
| CLI 获取文档 | `kbmcp.cli.get` | `hyseed get <id>` |
| CLI 列出文档 | `kbmcp.cli.list` | `hyseed list` |
| CLI 新增文档 | `kbmcp.cli.add` | `hyseed add --type … --title … [--body …]` |
| CLI 摄取文档 | `kbmcp.cli.ingest` | `hyseed ingest [文件\|目录] --out <目录>` |
| CLI 导入 Markdown | `kbmcp.cli.import` | `hyseed import <目录>` |
| CLI 导出 Markdown | `kbmcp.cli.export` | `hyseed export <目录>` |
| CLI doctor | `kbmcp.cli.doctor` | `hyseed doctor` |
| CLI 统计 | `kbmcp.cli.stats` | `hyseed stats` |
| CLI 重建索引 | `kbmcp.cli.reindex` | `hyseed reindex`（需确认） |
| CLI 差异检查 | `kbmcp.cli.diff-check` | `hyseed diff-check` |
| CLI 历史 | `kbmcp.cli.history` | `hyseed history <id>` |
| CLI vault 列表 | `kbmcp.cli.vaultList` | `hyseed vault list` |
| CLI 创建 vault | `kbmcp.cli.vaultCreate` | `hyseed vault create <name>` |
| CLI 切换 vault | `kbmcp.cli.vaultSwitch` | `hyseed vault switch <name>`（从实时列表中选择） |
| CLI vault 状态 | `kbmcp.cli.vaultStatus` | `hyseed vault status` |
| CLI 技能列表 | `kbmcp.cli.skillsList` | `hyseed skills list` |
| CLI 显示技能 | `kbmcp.cli.skillsShow` | `hyseed skills show <name>` |
| CLI 安装技能 | `kbmcp.cli.skillsAdd` | `hyseed skills add --agent … --scope …` |
| CLI 移除技能 | `kbmcp.cli.skillsRemove` | `hyseed skills remove --agent … --scope …`（需确认） |
| CLI HTTP 服务 | `kbmcp.cli.serveHttp` | `hyseed serve --transport http --port <N>` |

## 设置

| 设置 | 默认值 | 含义 |
|---|---|---|
| `kbMcp.runtimePath` | `""` | 显式指定 `hyseed.exe` 路径；留空 = 自动探测 |
| `kbMcp.adminPort` | `51888` | 管理台首选端口；被占用时顺延到下一个空闲端口 |
| `kbMcp.dataRoot` | `""` | 显式数据根（为服务进程设置 `KB_MCP_HOME`）；留空 = 由运行体决定 |
| `kbMcp.projectVault` | `""` | 工作区固定的 vault；MCP provider 将其作为 `KB_MCP_VAULT` 传递 |
| `kbMcp.converterPath` | `""` | 显式指定 `doc-convert.exe`（或 `.cmd` 包装器）路径；留空 = 自动探测。机器级设置，工作区设置不能指定可执行文件 |

## 数据根

`kbMcp.dataRoot` 为空时，hyseed 运行体按以下顺序解析数据根：

1. `KB_MCP_HOME`（扩展会把 `kbMcp.dataRoot` 写进这个变量）；
2. `~/.config/hyseed/config.yaml` 里的 `data_dir`（新文件不存在时读取改名前的
   `~/.config/kb-mcp/config.yaml`）；
3. 冻结发行版：`<exe 所在目录>\data`——内置的 `resources\hyseed.exe` 因此默认把数据放在扩展
   目录内；
4. `~/.local/share/hyseed`。

希望知识库在扩展升级后保持不变，请设置 `kbMcp.dataRoot`。

## Vault

`hyseed: 创建 vault` 提供两种作用域：

- **global** —— 位于全局数据根的 vault，可设为默认（`hyseed vault switch`）。
- **project** —— vault 仍创建在全局数据根，但当前工作区被固定到它：`.vscode/settings.json` 的
  `kbMcp.projectVault`（供 MCP provider 使用）；若 `.mcp.json` 已存在 project 作用域的 `hyseed`
  条目，还会写入该条目 `env` 的 `KB_MCP_VAULT`。全局 current vault 不变。

`.mcp.json` 的修改会先备份（`.mcp.json.bak-<时间戳>`），原子写入并回读校验。若 project 条目尚不存在，
请先用 project 作用域运行 `hyseed: 安装 Agent 技能`，再重新 pin。

带 `--force` 重跑技能安装可能重写条目并丢掉 env 键；对同名 vault 再执行一次 `hyseed: 创建 vault`
（幂等）即可重新 pin。

## 终端里的 CLI

`hyseed: CLI …` 命令会提示所需参数，并在专用的 **hyseed** 终端中运行对应 `hyseed` 命令
（固定 `cmd.exe`，关闭 AutoRun），因此输出可见、`Ctrl+C` 有效、可直接复制。每次执行依次发送：

1. 设置了 `kbMcp.dataRoot` 时发送 `set "KB_MCP_HOME=…"`；设置了 `kbMcp.projectVault` 时发送
   `set "KB_MCP_VAULT=…"`；
2. `CLI HTTP 服务` 额外发送 `set /p KB_MCP_HTTP_TOKEN=<"<token 文件>"`——token 值不会出现在命令行。
   文件为 `%USERPROFILE%\.hyseed-http-token`；新文件缺失时回退到改名前的 `.kb-mcp-http-token`，
   两者都不存在时会询问是否生成 32 位十六进制 token；
3. 命令行本身；
4. `echo [hyseed exit=%errorlevel%]`。

参数会自动加引号（空格与 shell 元字符）。含 `"`、`%`、`!` 或换行的值会被拒绝而不是转义——请在你
自己的终端里执行这类命令。

## 可执行文件解析顺序

1. `kbMcp.runtimePath` 设置
2. `%USERPROFILE%\.local\bin`（`hyseed.exe`，其次 `kb-mcp.exe`）
3. `%USERPROFILE%\.local\share\hyseed`（兼容旧 `share\kb-mcp`）
4. `PATH`（`hyseed`，其次 `kb-mcp`）
5. 扩展内置副本（`resources\hyseed.exe`）

第一个对 `--version` 有响应的候选胜出。显式设置的路径必须可用，否则报错而不是静默回退。

## 文档转换器解析顺序

`hyseed ingest` 需要文档转换器。扩展在每次启动服务与执行 CLI ingest 时解析：

1. `kbMcp.converterPath` 设置
2. `KB_INGEST_CONVERTER` 环境变量
3. 已解析 `hyseed.exe` 同目录的 `doc-convert.exe`
4. 任一打开工作区目录下的 `ingestion-rt\doc-convert.exe`
5. 扩展内置副本（`resources\doc-convert.exe`）

显式设置或环境变量会原样使用；路径写错会直接导致 ingest 失败，而不是静默回退。admin 服务通过
`KB_INGEST_CONVERTER` 收到解析结果；`hyseed: ingest` 命令会追加 `--converter <path>`。

## 故障排查

| 现象 | 处理 |
|---|---|
| 51888 端口被占用 | 扩展自动顺延到下一个空闲端口；状态栏与管理台标签页显示实际端口 |
| 已有 hyseed 控制台在运行 | 作为外部实例复用；`停止` 不会杀掉非扩展自有的实例 |
| 停止后端口仍占用 | 错误信息会给出端口、PID 以及手动命令 `taskkill /PID <pid> /T /F` |
| 找不到 `hyseed.exe` | 运行 `hyseed: 显示运行体信息` 查看各候选与探测错误；设置 `kbMcp.runtimePath`；内置副本是最后兜底 |
| `hyseed ingest` 报 “no document converter found” | 设置 `kbMcp.converterPath` 指向 `doc-convert.exe`；正常情况下扩展会找到内置副本或 `hyseed.exe` 同目录的副本。修改设置后需重启服务 |
| HTTP 服务一直因 token 失败 | token 文件为 `%USERPROFILE%\.hyseed-http-token`；接受提示生成 32 位 token，或自行创建该文件 |
| 项目 vault pin 不见了 | `skills add --force` 会重写 `.mcp.json` 条目；对同名 vault 重新执行 `hyseed: 创建 vault`（幂等） |
| 某条 CLI 命令拒绝参数 | `"`、`%`、`!` 与换行会被设计性拒绝；请在自己的终端执行该命令 |
| 管理台标签页空白 | 启动服务并查看 `hyseed: 显示日志`；确认端口未被其他程序占用 |

## 安全说明

- 管理服务只绑定 `127.0.0.1`。管理台**没有认证**——请把它当作本机界面，不要把端口暴露到网络。
- `hyseed serve --transport http` 需要 `KB_MCP_HTTP_TOKEN`；扩展从 token 文件读取，绝不把值放到命令行。
- 扩展不保存任何凭据，也不读取项目密钥文件。
- Agent host 文件（`~/.claude.json`、Codex/Cline 设置）只由 `hyseed` CLI 写入，写前带时间戳备份、
  原子替换。

## 开发

```bash
npm install
npm run build        # 打包到 dist/extension.js
npm run watch        # 增量构建
npm run typecheck
npm run check:docs   # README / 命令 / 设置 / VSIX 内容一致性
npm run package      # build + 复制运行体 + check:docs + vsce package --target win32-x64
```

用 F5 启动扩展宿主。测试运行在沙箱中（临时 `KB_MCP_HOME`、临时端口），不会触碰真实数据根或
`config.yaml`。

## 许可证

MIT。内置的 `hyseed.exe` 属于 hyseed 项目（MIT）。感谢 hyseed（原 kb-mcp）贡献者。