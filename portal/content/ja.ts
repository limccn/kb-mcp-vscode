import type { PortalContent } from "./types";

export const ja: PortalContent = {
  meta: {
    title: "hyseed — AI エージェントのためのオープンソース・ローカルナレッジベース",
    description:
      "hyseed はオープンソースのローカルナレッジベースです。チームの意思決定・教訓・API・ランブックを構造化された事実に変え、Claude Code、Cursor、Cline などの MCP クライアントから直接利用できます。ローカルファースト、Git ネイティブ、MIT。",
    ogAlt: "hyseed — AI エージェントのためのオープンソース・ローカルナレッジベース",
  },
  nav: {
    features: "機能",
    compare: "比較",
    quickstart: "クイックスタート",
    install: "インストール",
    skip: "本文へスキップ",
  },
  hero: {
    eyebrow: "オープンソース · MCP ネイティブ",
    title: "AI エージェントのための\nナレッジベース",
    subtitle:
      "hyseed はオープンソースのローカルナレッジベースです。チームの意思決定・教訓・API・ランブックを構造化された事実に変え、Claude Code、Cursor、Cline などの MCP クライアントから直接利用できます。データはローカルに留まります。",
    primaryCta: "Marketplace からインストール",
    secondaryCta: "機能を見る",
    note: "MIT オープンソース · Windows x64 · VS Code 1.101+",
  },
  terminal: {
    command: 'hyseed search "sqlite fts5 decision"',
    lines: [
      {
        label: "dec/use-sqlite-fts5",
        value: "decision · accepted",
        tone: "accent",
      },
      {
        label: '→ kb_get(..., section="Architecture")',
        value: "target section only",
        tone: "normal",
      },
      {
        label: "context",
        value: "70–90% less on long docs",
        tone: "muted",
      },
    ],
    note: "セクション単位で取得し、文書全体をコンテキストに入れません。",
  },
  positioning: {
    title: "既存ツールに足りないもの",
    subtitle:
      "人が書く方法、似た文章の探し方、会話の覚え方は解決しますが、「AI がチームのレビュー済み事実を確実に使う方法」は解決していません。",
    cards: [
      {
        title: "人間向けノート（Notion / Obsidian）",
        body: "ページ中心で人には使いやすい。AI 接続はコネクタやプラグインに依存し、構造は人の運用に委ねられます。",
      },
      {
        title: "ベクトルストア / RAG（Chroma / LanceDB など）",
        body: "類似検索は得意だが、スキーマ・バージョン・チーム協業はなく、検索パイプラインを自作する必要があります。",
      },
      {
        title: "AI メモリ（Mem0 / Zep など）",
        body: "単一エージェントの会話メモリが中心で、自動抽出が主。チームレビューや長期ガバナンスには向きません。",
      },
    ],
    punchline:
      "hyseed が埋めるのは、チームがレビューした構造化事実を MCP 経由で AI が使えるようにする部分です。",
  },
  features: {
    title: "AI に使われるために設計",
    subtitle:
      "Wiki にチャット欄を足すのではなく、検索・構造・バージョン・協業をプロトコルとデータモデルに組み込みます。",
    items: [
      {
        icon: "mcp",
        title: "MCP ネイティブ",
        body: "文書 CRUD、検索、グラフ、バージョン、スケジュールを MCP で公開。Claude Code、Cursor、Cline などから直接接続できます。軽量に使いたいときは、読み取り専用のシンモードに切り替えられます。",
      },
      {
        icon: "schema",
        title: "自由文ではなく型付きスキーマ",
        body: "プロジェクト、意思決定、教訓、用語集、人物、FAQ、API、ランブック、リリースの 9 種類。型付きメタデータと安定 ID により、AI は事実を正確に抽出できます。",
      },
      {
        icon: "section",
        title: "セクション単位の取得",
        body: "kb_get は見出し単位で取得でき、セクションがない場合は目次を返します。長文のコンテキスト消費を 70–90% 削減できます。",
      },
      {
        icon: "history",
        title: "バージョン・監査・ロールバック",
        body: "変更ごとにバージョン番号を持ち、フィールド単位の差分、任意バージョンへの復元、論理削除からの復元、監査ログを備えます。AI の自動書き込みも安心です。",
      },
      {
        icon: "graph",
        title: "型付きナレッジグラフ",
        body: "10 種類の標準リレーション、自動バックリンク、マルチホップ探索、影響分析、意思決定チェーン。意思決定を変えたとき、影響を受ける文書をたどれます。",
      },
      {
        icon: "git",
        title: "Git ネイティブな協業",
        body: "ナレッジは Git 上の Markdown として存在し、tags / aliases / links / metadata は 3-way マージ。PR レビュー、ブランチ、Code Owners をそのまま使えます。",
      },
    ],
  },
  comparison: {
    title: "並べて見る",
    subtitle:
      "設計の中心からデータ配置まで、4 つの形態の違いがひと目で分かります。",
    dimensionLabel: "比較軸",
    columns: [
      "人間向けノート（Notion / Obsidian）",
      "ベクトルストア + RAG",
      "AI メモリ",
      "hyseed",
    ],
    rows: [
      {
        dimension: "設計の中心",
        values: [
          "人とページ",
          "モデルとベクトル",
          "単一エージェントの会話",
          "AI エージェント + 人、同じ知識を共有",
        ],
      },
      {
        dimension: "AI 接続",
        values: [
          "Web / エディタ。コネクタやプラグイン経由",
          "SDK + 自前の検索パイプライン",
          "SDK / API、フレームワーク依存",
          "MCP ネイティブ + CLI + 管理コンソール + VS Code 拡張",
        ],
      },
      {
        dimension: "データ構造",
        values: [
          "自由形式、運用で規定",
          "ベクトルのみ、スキーマなし",
          "自動抽出されたメモリ項目",
          "9 種の文書タイプ + 型付きメタデータ + 安定 ID",
        ],
      },
      {
        dimension: "検索",
        values: [
          "キーワード / プラグイン",
          "ベクトル類似度が中心",
          "意味的な想起",
          "FTS5 BM25 / 曖昧 / セマンティック（sqlite-vec）/ RRF ハイブリッド",
        ],
      },
      {
        dimension: "コンテキストコスト",
        values: [
          "ページ全体",
          "チャンク返却、まだ削る必要",
          "メモリ注入、粒度は制御しにくい",
          "セクション単位。長文で 70–90% 削減",
        ],
      },
      {
        dimension: "バージョンと監査",
        values: [
          "ページ / ファイル履歴。監査はプランやプラグイン依存",
          "通常なし",
          "重点ではない",
          "バージョン、フィールド差分、復元、論理削除、監査",
        ],
      },
      {
        dimension: "チーム協業",
        values: [
          "Notion はリアルタイム。Obsidian は Git / 同期",
          "なし",
          "弱く、プラットフォーム内",
          "Git ネイティブ + 3-way マージ + PR レビュー",
        ],
      },
      {
        dimension: "データと配備",
        values: [
          "Notion はクラウド。Obsidian はローカルファイル",
          "ローカル / クラウド、セルフマネージド",
          "セルフホストの OSS またはクラウド",
          "単一ファイルの SQLite、完全ローカル、クラウドなし、テレメトリーなし、MIT",
        ],
      },
    ],
  },
  quickstart: {
    title: "3 ステップで既存ワークフローへ",
    subtitle: "拡張機能を入れるだけ。Python ランタイムの別途インストールは不要です。",
    steps: [
      {
        title: "拡張をインストール",
        body: "VS Code Marketplace から hyseed をインストール。Windows x64 と VS Code 1.101+ に対応しています。",
        code: "code --install-extension limccn.kbmcp-vscode",
      },
      {
        title: "管理コンソールを開く",
        body: "コマンドパレットで hyseed: Open admin console を実行すると、ブラウザでローカル管理コンソールが開きます。",
      },
      {
        title: "知識を作成・変換・取り込み",
        body: "文書を作成するか、既存文書を変換するか、Markdown を取り込みます。MCP クライアントから直接 AI に検索させることもできます。変更はすべてバージョン管理されます。",
        code: 'hyseed search "sqlite fts5"',
      },
    ],
    note: "Markdown、Word（.docx）、PowerPoint（.pptx）、Excel（.xlsx / .xlsm / .xls）、PDF、TXT、JSON、CSV に対応。初回利用時にローカル vault が作成されます。",
  },
  status: {
    title: "すぐに使えて、ローカル完結",
    body: "hyseed は MIT ライセンスのオープンソースで、現行バージョンは 0.2.0。単一ファイルの SQLite に保存し、クラウド不要、テレメトリーなし。VS Code 拡張を入れるだけで、チームの意思決定と教訓をいつでも検索・追跡できます。セマンティック検索は sqlite-vec 拡張で有効にできます。",
    items: [
      { label: "バージョン", value: "Marketplace 0.2.0" },
      { label: "ライセンス", value: "MIT · オープンソース" },
      { label: "データ", value: "ローカル SQLite · テレメトリーなし" },
      { label: "対応環境", value: "Windows x64 · VS Code 1.101+" },
      { label: "ランタイム", value: "拡張に同梱、Python 不要" },
      { label: "検索", value: "語彙 / あいまい / セマンティック / RRF ハイブリッド" },
    ],
  },
  cta: {
    title: "チームの知識を AI ワークフローへ",
    body: "VS Code Marketplace から hyseed をインストール。ローカルで追跡可能、協業できるオープンソースのナレッジベースを数分で用意できます。",
    primary: "Marketplace からインストール",
    secondary: "GitHub でソースを見る",
    note: "MIT オープンソース · Windows x64 · ランタイムの別途インストール不要",
  },
  footer: {
    tagline: "AI エージェントのためのオープンソース・ローカルナレッジベース",
    license: "MIT License",
    copyright: "© 2026 hyseed",
  },
};