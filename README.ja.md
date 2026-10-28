# VS Code 向け hyseed

**hyseed**（旧 kb-mcp）ローカルナレッジベースを VS Code に：管理コンソールを Webview タブで、
MCP／スキルのセットアップ、vault 管理、よく使う CLI コマンドをコマンドパレットから。

> ステータス：早期開発（0.1.1）。現時点では Windows x64 のみ。

## 機能

- **管理コンソールタブ** — hyseed の管理 UI を VS Code 内で表示。拡張機能が所有するサーバーが支えます。
- **アクティビティバーのパネル** — コンパクトな検索面：vault は専用行、モードと件数は 1 行の
  セグメントコントロール（hybrid／lexical／fuzzy／semantic／rrf、10／25／50。298px 未満では件数段を非表示）、フィルターは漏斗
  アイコンで開閉し件数バッジを表示。クエリ欄には vault ごとの検索履歴（矢印キー、Enter、個別削除、
  2 段階クリア）。アイコンのトップバーに作成・設定・更新・`⋯` アクションメニュー（管理サーバー、
  MCP の状態／再読み込み、ファイル／フォルダーの取り込みと進捗、`/git` への移動、メンテナンス）・
  管理コンソールボタンを配置。スキルのインストール／削除はコマンドパレットに残ります。
- **サーバーのライフサイクル** — 起動・停止・再起動・ブラウザーで開く。ポート競合時は自動で
  次のポートへ移り、既に動作中のコンソールは再利用されます。
- **MCP サーバー定義** — VS Code の MCP サポートに `hyseed`（`hyseed serve`）を登録し、
  ワークスペースの vault ピンに従います。
- **エージェントスキル** — Claude Code／Codex／Cline 向けのインストール・削除・状態確認を
  `hyseed skills` CLI 経由でガイドします（global／project スコープ）。
- **vault** — global／project vault の作成、グローバル既定の切り替え、ワークスペースへの固定。
- **ターミナル内の CLI** — プロンプト付きの 21 個の `hyseed` コマンドを可視ターミナルで実行。

## 必要環境

- Windows 10/11（x64）
- VS Code 1.101 以降（1.143.1 で確認）
- hyseed の別途インストールは不要：`hyseed.exe` をフォールバックとして同梱。

## インストール

```bash
code --install-extension kbmcp-vscode-win32-x64-0.1.1.vsix
```

イントラネット配布では同じ VSIX を共有するだけで、マーケットプレイスは不要です。インストール後に
ウィンドウを再読み込みしてください。コマンドは `hyseed:` プレフィックスにあります。

公開後（publisher `limccn`）は VS Code Marketplace または Open VSX からインストールできます：

```bash
code --install-extension limccn.kbmcp-vscode
```

## コマンド

すべてのコマンドはコマンドパレットにあり、プレフィックスは `hyseed:` です。

| コマンド | ID | 動作 |
|---|---|---|
| 管理コンソールを開く | `kbmcp.openAdmin` | 必要ならサーバーを起動し、管理コンソールを Webview タブで開く |
| 管理サーバーを起動 | `kbmcp.startServer` | 拡張機能が所有するプロセスとして管理サーバーを起動 |
| 管理サーバーを停止 | `kbmcp.stopServer` | 拡張機能が所有するサーバーのプロセスツリーを停止 |
| 管理サーバーを再起動 | `kbmcp.restartServer` | （所有している場合は）停止してから再起動 |
| ブラウザーで管理コンソールを開く | `kbmcp.openInBrowser` | システムのブラウザーでコンソールを開く |
| ランタイム情報を表示 | `kbmcp.showRuntimeInfo` | 解決された実行ファイル、候補、プローブ結果を表示 |
| ログを表示 | `kbmcp.showLogs` | 出力チャネルを開く |
| MCP ステータスを表示 | `kbmcp.showMcpStatus` | MCP プロバイダーの id／label、登録状態、データルート、プロジェクト vault を表示 |
| エージェントスキルをインストール | `kbmcp.installAgentSkills` | Claude Code／Codex／Cline 向けの `hyseed skills add` をガイド（global または project） |
| エージェントスキルを削除 | `kbmcp.removeAgentSkills` | `hyseed skills remove` をガイド |
| スキル状態を表示 | `kbmcp.showSkillsState` | 同梱スキルとホストごとのインストール状態を一覧 |
| vault を作成 | `kbmcp.createVault` | global またはワークスペース固定の vault を作成 |
| vault を切り替え | `kbmcp.switchVault` | グローバル既定 vault を設定 |
| プロジェクト vault のピンを解除 | `kbmcp.clearProjectVault` | ワークスペースのピンと `.mcp.json` の env キーを削除 |
| vault を一覧 | `kbmcp.listVaults` | current／ワークスペースピンのマーカー付きで vault を表示 |
| CLI 検索 | `kbmcp.cli.search` | ターミナルで `hyseed search <query>` |
| CLI ドキュメント取得 | `kbmcp.cli.get` | `hyseed get <id>` |
| CLI ドキュメント一覧 | `kbmcp.cli.list` | `hyseed list` |
| CLI ドキュメント追加 | `kbmcp.cli.add` | `hyseed add --type … --title … [--body …]` |
| CLI ドキュメント取り込み | `kbmcp.cli.ingest` | `hyseed ingest [file\|folder] --out <dir>` |
| CLI Markdown インポート | `kbmcp.cli.import` | `hyseed import <dir>` |
| CLI Markdown エクスポート | `kbmcp.cli.export` | `hyseed export <dir>` |
| CLI doctor | `kbmcp.cli.doctor` | `hyseed doctor` |
| CLI 統計 | `kbmcp.cli.stats` | `hyseed stats` |
| CLI 再インデックス | `kbmcp.cli.reindex` | `hyseed reindex`（確認あり） |
| CLI 差分チェック | `kbmcp.cli.diff-check` | `hyseed diff-check` |
| CLI 履歴 | `kbmcp.cli.history` | `hyseed history <id>` |
| CLI vault 一覧 | `kbmcp.cli.vaultList` | `hyseed vault list` |
| CLI vault 作成 | `kbmcp.cli.vaultCreate` | `hyseed vault create <name>` |
| CLI vault 切り替え | `kbmcp.cli.vaultSwitch` | `hyseed vault switch <name>`（実際の一覧から選択） |
| CLI vault ステータス | `kbmcp.cli.vaultStatus` | `hyseed vault status` |
| CLI スキル一覧 | `kbmcp.cli.skillsList` | `hyseed skills list` |
| CLI スキル表示 | `kbmcp.cli.skillsShow` | `hyseed skills show <name>` |
| CLI スキル追加 | `kbmcp.cli.skillsAdd` | `hyseed skills add --agent … --scope …` |
| CLI スキル削除 | `kbmcp.cli.skillsRemove` | `hyseed skills remove --agent … --scope …`（確認あり） |
| CLI HTTP サービス | `kbmcp.cli.serveHttp` | `hyseed serve --transport http --port <N>` |

## 設定

| 設定 | 既定値 | 意味 |
|---|---|---|
| `kbMcp.runtimePath` | `""` | `hyseed.exe` の明示パス。空＝自動検出。 |
| `kbMcp.adminPort` | `51888` | 管理コンソールの優先ポート。使用中は次の空きポートを使用。 |
| `kbMcp.dataRoot` | `""` | 明示的なデータルート（起動するサーバーに `KB_MCP_HOME` を設定）。空＝ランタイムの既定。 |
| `kbMcp.projectVault` | `""` | ワークスペースに固定した vault。MCP 定義プロバイダーが `KB_MCP_VAULT` として渡す。 |
| `kbMcp.converterPath` | `""` | `doc-convert.exe`（または `.cmd` ラッパー）の明示パス。空＝自動検出。マシンスコープのため、ワークスペース設定では実行ファイルを指定できません。 |

## データルート

`kbMcp.dataRoot` が空のとき、hyseed ランタイムは次の順でデータルートを解決します：

1. `KB_MCP_HOME`（拡張機能が `kbMcp.dataRoot` から設定）；
2. `~/.config/hyseed/config.yaml` の `data_dir`（新しいファイルがない場合は改名前の
   `~/.config/kb-mcp/config.yaml` を読む）；
3. 凍結ビルド：`<exe フォルダー>\data` — 同梱の `resources\hyseed.exe` は拡張機能ディレクトリ内の
   data フォルダーを既定にします；
4. `~/.local/share/hyseed`。

拡張機能の更新をまたいでナレッジベースを安定させたい場合は `kbMcp.dataRoot` を設定してください。

## Vault

`hyseed: vault を作成` には 2 つのスコープがあります：

- **global** — グローバルデータルート内の vault。既定にできます（`hyseed vault switch`）。
- **project** — vault 自体はグローバルデータルートに作成されますが、このワークスペースがそれに
  固定されます：`.vscode/settings.json` の `kbMcp.projectVault`（MCP プロバイダーが使用）と、
  `.mcp.json` に project スコープの `hyseed` エントリが既にある場合はその `env` の
  `KB_MCP_VAULT`。グローバルの current vault は変わりません。

`.mcp.json` の編集はバックアップ（`.mcp.json.bak-<タイムスタンプ>`）を取り、アトミックに書き込み、
結果を検証します。project エントリがまだない場合は、project スコープで
`hyseed: エージェントスキルをインストール` を実行してから再ピンしてください。

`--force` 付きでスキルインストーラーを再実行するとエントリが書き換えられ、env キーが失われる
ことがあります。同じ名前で `hyseed: vault を作成` を再実行（冪等）して再ピンしてください。

## ターミナル内の CLI

`hyseed: CLI …` コマンドは必要な引数を尋ね、専用の **hyseed** ターミナル（固定 `cmd.exe`、
AutoRun 無効）で対応する `hyseed` コマンドを実行します。出力が表示され、`Ctrl+C` が効き、
コピーできます。各実行では次の順に送信します：

1. `kbMcp.dataRoot` が設定されていれば `set "KB_MCP_HOME=…"`、`kbMcp.projectVault` が
   設定されていれば `set "KB_MCP_VAULT=…"`；
2. `CLI HTTP サービス` の場合は `set /p KB_MCP_HTTP_TOKEN=<"<token ファイル>"` — token の値は
   コマンドラインに現れません。ファイルは `%USERPROFILE%\.hyseed-http-token`、新しいファイルが
   ない場合は改名前の `.kb-mcp-http-token` を使用し、どちらもない場合は新しい 32 桁 hex token の
   生成を提案します；
3. コマンドライン本体；
4. `echo [hyseed exit=%errorlevel%]`。

引数は自動的に引用符で囲まれます（空白とシェルメタ文字）。`"`、`%`、`!`、改行を含む値は
エスケープせず拒否します — そのようなコマンドはご自身のターミナルで実行してください。

## 実行ファイルの解決順

1. `kbMcp.runtimePath` 設定
2. `%USERPROFILE%\.local\bin`（`hyseed.exe`、次に `kb-mcp.exe`）
3. `%USERPROFILE%\.local\share\hyseed`（旧 `share\kb-mcp` も許容）
4. `PATH`（`hyseed`、次に `kb-mcp`）
5. 拡張機能に同梱のコピー（`resources\hyseed.exe`）

`--version` に応答した最初の候補が採用されます。明示的に設定したパスが使えない場合は、
黙ってフォールバックせずエラーになります。

## ドキュメントコンバーターの解決順

`hyseed ingest` にはドキュメントコンバーターが必要です。拡張機能はサーバー起動時と CLI ingest の
たびに次の順で解決します：

1. `kbMcp.converterPath` 設定
2. `KB_INGEST_CONVERTER` 環境変数
3. 解決済み `hyseed.exe` と同じディレクトリの `doc-convert.exe`
4. 開いているワークスペースの `ingestion-rt\doc-convert.exe`
5. 拡張機能に同梱のコピー（`resources\doc-convert.exe`）

明示設定と環境変数はそのまま使用されます。パスを間違えると黙ってフォールバックせず ingest が
失敗します。admin サーバーには `KB_INGEST_CONVERTER` として渡され、`hyseed: ingest` は
`--converter <path>` を付加します。

## トラブルシューティング

| 現象 | 対処 |
|---|---|
| ポート 51888 が使用中 | 拡張機能が次の空きポートを選びます。ステータスバーと管理タブに実際のポートが表示されます。 |
| 別の hyseed コンソールが既に実行中 | 外部インスタンスとして再利用されます。`停止` は拡張機能が所有しないインスタンスを強制終了しません。 |
| 停止後もポートが開いたまま | エラーにポートと PID、手動コマンド `taskkill /PID <pid> /T /F` が表示されます。 |
| `hyseed.exe` が見つからない | `hyseed: ランタイム情報を表示` で各候補とプローブエラーを確認し、`kbMcp.runtimePath` を設定してください。同梱コピーが最後のフォールバックです。 |
| `hyseed ingest` が「no document converter found」で失敗する | `kbMcp.converterPath` に `doc-convert.exe` を設定してください。通常は同梱コピーか `hyseed.exe` と同じ場所のコピーが見つかります。設定変更後はサーバーを再起動してください。 |
| HTTP サービスが token で失敗し続ける | token ファイルは `%USERPROFILE%\.hyseed-http-token`。32 桁 hex token の生成プロンプトに従うか、ファイルを自分で作成してください。 |
| プロジェクト vault のピンが消えた | `skills add --force` が `.mcp.json` エントリを書き換えます。同じ名前で `hyseed: vault を作成` を再実行（冪等）してください。 |
| CLI コマンドが引数を拒否する | `"`、`%`、`!`、改行は設計上拒否されます。ご自身のターミナルで実行してください。 |
| 管理タブが空 | サーバーを起動して `hyseed: ログを表示` を確認し、ポートを他のプログラムが占有していないか確認してください。 |

## セキュリティ

- 管理サーバーは `127.0.0.1` のみにバインドします。コンソールには**認証がありません** —
  ローカル専用の画面として扱い、ポートをネットワークに公開しないでください。
- `hyseed serve --transport http` は `KB_MCP_HTTP_TOKEN` を必要とします。拡張機能は token
  ファイルから読み取り、値をコマンドラインに置くことはありません。
- 拡張機能は資格情報を保存せず、プロジェクトの秘密ファイルも読みません。
- エージェントホストのファイル（`~/.claude.json`、Codex／Cline 設定）は `hyseed` CLI だけが
  書き込み、書き込み前にタイムスタンプ付きバックアップを取り、アトミックに置換します。

## 開発

```bash
npm install
npm run build        # dist/extension.js にバンドル
npm run watch        # 増分ビルド
npm run typecheck
npm run check:docs   # README／コマンド／設定／VSIX 内容の整合性
npm run package      # build + ランタイム同梱 + check:docs + vsce package --target win32-x64
```

F5 で拡張機能ホストを起動します。テストはサンドボックス（一時 `KB_MCP_HOME`、一時ポート）で
実行され、実際のデータルートや `config.yaml` には触れません。

## ライセンス

MIT。同梱の `hyseed.exe` は hyseed プロジェクト（MIT）の一部です。hyseed（旧 kb-mcp）の
貢献者に感謝します。