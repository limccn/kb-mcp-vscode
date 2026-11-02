# hyseed for VS Code

VS Code の中でローカルの **hyseed** ナレッジベースを使えます。サイドバー検索、管理コンソール、
MCP／スキルの導入、よく使う CLI コマンドをエディタから実行できます。

Windows x64、VS Code 1.101 以上。

## 主な機能

- **サイドバー検索** — 保管庫ごとの検索、モード・件数・フィルタ・検索履歴。
- **管理コンソール** — フル機能の hyseed 管理画面を Webview タブで表示。
- **MCP とスキル** — `hyseed` MCP サーバーを登録し、Claude Code／Codex／Cline 用スキルを導入。
- **保管庫** — グローバル保管庫と、ワークスペース単位の固定。
- **バックアップ** — `⋯` メニューから全ドキュメントを Markdown で書き出し／取り込み。
- **すぐ使える** — `hyseed.exe` を同梱。別途インストール不要。

## インストール

```bash
code --install-extension kbmcp-vscode-win32-x64-0.2.0.vsix
```

インストール後にウィンドウを再読み込みしてください。コマンドは `hyseed:` にあります。

## はじめに

1. **CLI ツール**（推奨・既定でオン）— `hyseed.exe` と `doc-convert.exe` を
   `%USERPROFILE%\.local\bin` にコピーします。PATH は確認のみで変更しません。
2. **MCP とスキル**（任意）— AI ツール用の MCP サーバーとスキルを登録します。
3. **データフォルダー** — 既定（`%USERPROFILE%\.local\share\hyseed`）を受け入れるか、別の場所を
   選択します。`default` 保管庫が作成されます。

初回インストールまたはメジャー／マイナー更新後にガイドが自動で開きます。
`hyseed: Setup guide` で再表示でき、管理コンソールの **Doctor** からも開けます。

## 0.1.x からのアップグレード

0.2.0 では旧名称・旧保存先を廃止しました。起動時、データフォルダーが空の場合に 0.1.x の
データを確認し、選択するまで書き込みません。

- **移行** — 旧データを新しいフォルダーへ移動します。
- **既存を使う** — 新しいフォルダーを維持し、旧フォルダーはそのまま残します。
- **後で** — `hyseed: Setup data folder` を実行するまで起動を保留します。

新旧両方にデータがある場合は一方だけを選び、マージはしません。ダウングレードはできないため、
重要なドキュメントは先にバックアップしてください（`⋯` → **Export backup**）。

`~/.config/kb-mcp`、旧 HTTP トークンファイル、`kb-mcp.exe` は読み込まれません。

## サイドバー

保管庫は専用の行に表示されます。上部バーには新規作成、設定、更新、管理、`⋯` メニュー
（管理サービス、MCP 状態、アップロード、バックアップの書き出し／取り込み、`/git`、メンテナンス）
があります。検索結果は VS Code のブラウザーで開き、右クリックでコピーできます。

## データとバックアップ

ドキュメントは既定で `%USERPROFILE%\.local\share\hyseed` に保存されます。拡張機能を更新しても
このフォルダーは変更されません。`⋯` → **Export backup** で Markdown として持ち出し、
**Import backup** で復元できます。

## コマンド

すべてコマンドパレットの `hyseed:` にあります。

| ID | 用途 |
|---|---|
| `kbmcp.openAdmin` | 管理コンソールを開く |
| `kbmcp.startServer` | 管理サーバーを起動 |
| `kbmcp.stopServer` | 拡張機能が起動したサーバーを停止 |
| `kbmcp.restartServer` | サーバーを再起動 |
| `kbmcp.openInBrowser` | ブラウザーで管理コンソールを開く |
| `kbmcp.showRuntimeInfo` | 使用中の実行ファイルを表示 |
| `kbmcp.showLogs` | 出力チャンネルを開く |
| `kbmcp.showMcpStatus` | MCP の登録状態と保管庫を表示 |
| `kbmcp.installAgentSkills` | エージェントスキルを導入 |
| `kbmcp.installCliTools` | `hyseed.exe` / `doc-convert.exe` を導入 |
| `kbmcp.removeAgentSkills` | エージェントスキルを削除 |
| `kbmcp.showSkillsState` | スキルの導入状態を表示 |
| `kbmcp.createVault` | 保管庫を作成 |
| `kbmcp.switchVault` | 既定の保管庫を切り替え |
| `kbmcp.clearProjectVault` | ワークスペースの固定を解除 |
| `kbmcp.listVaults` | 保管庫一覧を表示 |
| `kbmcp.resumeMigration` | データフォルダーの選択を再開 |
| `kbmcp.openSetupGuide` | セットアップガイドを開く |
| `kbmcp.cli.search` | `hyseed search` を実行 |
| `kbmcp.cli.get` | `hyseed get` を実行 |
| `kbmcp.cli.list` | `hyseed list` を実行 |
| `kbmcp.cli.add` | `hyseed add` を実行 |
| `kbmcp.cli.ingest` | `hyseed ingest` を実行 |
| `kbmcp.cli.import` | `hyseed import` を実行 |
| `kbmcp.cli.export` | `hyseed export` を実行 |
| `kbmcp.cli.doctor` | `hyseed doctor` を実行 |
| `kbmcp.cli.stats` | `hyseed stats` を実行 |
| `kbmcp.cli.reindex` | `hyseed reindex` を実行 |
| `kbmcp.cli.diff-check` | `hyseed diff-check` を実行 |
| `kbmcp.cli.history` | `hyseed history` を実行 |
| `kbmcp.cli.vaultList` | `hyseed vault list` を実行 |
| `kbmcp.cli.vaultCreate` | `hyseed vault create` を実行 |
| `kbmcp.cli.vaultSwitch` | `hyseed vault switch` を実行 |
| `kbmcp.cli.vaultStatus` | `hyseed vault status` を実行 |
| `kbmcp.cli.skillsList` | `hyseed skills list` を実行 |
| `kbmcp.cli.skillsShow` | `hyseed skills show` を実行 |
| `kbmcp.cli.skillsAdd` | `hyseed skills add` を実行 |
| `kbmcp.cli.skillsRemove` | `hyseed skills remove` を実行 |
| `kbmcp.cli.serveHttp` | `hyseed serve`（HTTP）を実行 |

CLI コマンドは専用の `hyseed` ターミナルで実行します。`"`、`%`、`!`、改行を含む値は
安全のため拒否されます。そのような場合はご自身のターミナルで実行してください。

## 設定

| 設定 | 既定値 | 説明 |
|---|---|---|
| `kbMcp.runtimePath` | `""` | `hyseed.exe` を指定。空 = 自動検出 |
| `kbMcp.adminPort` | `51888` | 管理ポート。使用中なら次の空きポート |
| `kbMcp.adminHost` | `127.0.0.1` | バインド先。非ループバックは認証なしで公開されます |
| `kbMcp.mcpHost` | `127.0.0.1` | MCP HTTP のバインド先。非ループバックはトークンとファイアウォール設定が必要 |
| `kbMcp.dataRoot` | `""` | データフォルダーを指定。空 = 既定 |
| `kbMcp.projectVault` | `""` | ワークスペースで固定する保管庫 |
| `kbMcp.converterPath` | `""` | `doc-convert.exe` を指定。空 = 自動検出 |

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| ポート 51888 が使用中 | 次の空きポートを自動で使用します |
| `hyseed.exe` が見つからない | `hyseed: Show runtime info` を確認、または `kbMcp.runtimePath` を設定 |
| 取り込みで変換ツールが見つからない | `kbMcp.converterPath` に `doc-convert.exe` を設定し、サーバーを再起動 |
| 停止後もポートが開いたまま | エラーに表示される PID を `taskkill /PID <pid> /T /F` で終了 |
| 管理タブが空 | サーバーを起動し、`hyseed: Show logs` を確認 |

## プライバシー

管理コンソールと MCP サーバーは既定でループバックにのみバインドされます。管理コンソールには
認証がないため、信頼できるネットワークでのみ公開してください。認証情報はユーザープロファイル
に保存され、拡張機能には保存されません。エージェント側の設定ファイルは `hyseed` CLI だけが
バックアップ付きで書き込みます。

## 開発

```bash
npm install && npm run build     # dist/extension.js
npm run typecheck && npm test
npm run check:docs && npm run package
```

製品ポータルは `portal/`（独立した Next.js サイト）にあります。`portal/README.md` を参照してください。

## ライセンス

MIT。