import type { PortalContent } from "./types";

export const zh: PortalContent = {
  meta: {
    title: "hyseed — 开源的本地知识库，为 AI 代理而生",
    description:
      "hyseed 是开源的本地知识库，把团队的决策、经验、API 与运维手册变成结构化事实，让 Claude Code、Cursor、Cline 等 MCP 客户端直接取用。本地优先、Git 协作、MIT 开源。",
    ogAlt: "hyseed — 开源的本地知识库，为 AI 代理而生",
  },
  nav: {
    features: "核心能力",
    compare: "对比",
    quickstart: "快速开始",
    install: "安装",
    skip: "跳到主要内容",
  },
  hero: {
    eyebrow: "开源 · 本地优先 · MCP 原生",
    title: "给 AI 代理一个可查询、可追溯的团队知识库",
    subtitle:
      "hyseed 是开源的本地知识库：把团队的决策、经验、API 与运维手册变成结构化事实，让 Claude Code、Cursor、Cline 等 MCP 客户端直接取用——数据始终留在本地。",
    primaryCta: "从 VS Code Marketplace 安装",
    secondaryCta: "查看核心能力",
    note: "MIT 开源 · Windows x64 · VS Code 1.101+",
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
    note: "按章节取用，不把整篇文档塞进上下文。",
  },
  positioning: {
    title: "笔记、向量库、AI 记忆，各缺一块",
    subtitle:
      "它们分别解决了“人怎么写”“怎么找相似”“怎么记住对话”，但没有解决“AI 怎么可靠地取用团队审阅过的事实”。",
    cards: [
      {
        title: "人类笔记（Notion / Obsidian）",
        body: "以页面为中心，适合人写和看；AI 接入依赖连接器或插件，结构靠人约定。",
      },
      {
        title: "向量库 / RAG（Chroma / LanceDB 等）",
        body: "擅长相似度检索，但没有 schema、版本和团队协作；检索管线要自己搭。",
      },
      {
        title: "AI 记忆层（Mem0 / Zep 类）",
        body: "面向单个 Agent 的会话记忆，以自动抽取为主；不面向团队审阅和长期治理。",
      },
    ],
    punchline:
      "hyseed 补的是：团队审阅过的结构化事实，以 MCP 原生方式被 AI 取用。",
  },
  features: {
    title: "为“被 AI 取用”而设计",
    subtitle:
      "不是给知识库加一个聊天框，而是把检索、结构、版本和协作都放进协议与数据模型里。",
    items: [
      {
        icon: "mcp",
        title: "MCP 原生",
        body: "文档、搜索、图谱、版本、调度都在 MCP 协议内暴露；Claude Code、Cursor、Cline 等客户端接上就能用。需要轻量接入时，还可切换只读瘦模式。",
      },
      {
        icon: "schema",
        title: "强 Schema，不是自由文本",
        body: "内置 9 种文档类型：项目、决策、经验、术语、人员、FAQ、API、Runbook、发布日志。类型化 metadata + 稳定 ID，AI 能精确抽取事实。",
      },
      {
        icon: "section",
        title: "Section 级取用",
        body: "kb_get 支持按标题取章节，章节不存在时返回目录；长文档上下文消耗可降低 70%–90%。",
      },
      {
        icon: "history",
        title: "版本、审计、可回滚",
        body: "每次变更带版本号，支持字段级 diff、任意版本恢复、软删除恢复和审计日志。AI 自动写入也可放心。",
      },
      {
        icon: "graph",
        title: "类型化知识图谱",
        body: "10 种标准关系类型，自动反向链接、多跳遍历、影响分析和决策演进链。改一个决策，能顺着图找到受影响文档。",
      },
      {
        icon: "git",
        title: "Git 原生协作",
        body: "知识以 Markdown 存在 Git 仓库；tags / aliases / links / metadata 三方合并，PR 评审、分支和 Code Owner 全部沿用。",
      },
    ],
  },
  comparison: {
    title: "放在一起看",
    subtitle: "从设计中心到数据部署，四种形态的差异一目了然。",
    dimensionLabel: "对比维度",
    columns: [
      "人类笔记（Notion / Obsidian）",
      "向量库 + RAG",
      "AI 记忆层",
      "hyseed",
    ],
    rows: [
      {
        dimension: "设计中心",
        values: ["人和页面", "模型与向量", "单个 Agent 的会话", "AI 代理 + 人，共用一份知识"],
      },
      {
        dimension: "AI 接入",
        values: [
          "Web / 编辑器；靠连接器或插件",
          "SDK + 自建检索管线",
          "SDK / API，绑定框架",
          "MCP 原生 + CLI + 管理台 + VS Code 扩展",
        ],
      },
      {
        dimension: "数据结构",
        values: [
          "自由格式，靠人约定",
          "只有向量，无 schema",
          "自动抽取的记忆条目",
          "9 种文档类型 + 类型化 metadata + 稳定 ID",
        ],
      },
      {
        dimension: "检索",
        values: [
          "关键词 / 插件",
          "向量相似度为主",
          "语义回忆",
          "FTS5 BM25 / 模糊 / 语义（sqlite-vec）/ RRF 混合",
        ],
      },
      {
        dimension: "上下文成本",
        values: [
          "整页返回",
          "返回 chunk，仍需裁剪",
          "记忆注入，粒度不可控",
          "按章节取用；长文档降 70%–90%",
        ],
      },
      {
        dimension: "版本与审计",
        values: [
          "页面 / 文件历史；审计依套餐或插件",
          "通常无",
          "非重点",
          "版本、字段级 diff、恢复、软删除、审计",
        ],
      },
      {
        dimension: "团队协作",
        values: [
          "Notion 实时协同强；Obsidian 靠 Git",
          "无",
          "弱，偏平台内",
          "Git 原生 + 三方合并 + PR 评审",
        ],
      },
      {
        dimension: "数据与部署",
        values: [
          "Notion 云服务；Obsidian 本地文件",
          "本地 / 云皆可，需自行运维",
          "开源自托管或云服务",
          "单文件 SQLite，完全本地，无云、无遥测，MIT",
        ],
      },
    ],
  },
  quickstart: {
    title: "三步接进现有工作流",
    subtitle: "装好扩展即可使用，无需单独安装 Python 运行时。",
    steps: [
      {
        title: "安装扩展",
        body: "从 VS Code Marketplace 安装 hyseed，支持 Windows x64 与 VS Code 1.101+。",
        code: "code --install-extension limccn.kbmcp-vscode",
      },
      {
        title: "打开管理台",
        body: "在命令面板运行 hyseed: Open admin console，浏览器会打开本地管理台。",
      },
      {
        title: "创建、转换或导入知识",
        body: "创建文档、转换文档或导入 Markdown，也可以直接在 MCP 客户端里让 AI 搜索。每次修改都有版本记录。",
        code: 'hyseed search "sqlite fts5"',
      },
    ],
    note: "支持 Markdown、Word（.docx）、PowerPoint（.pptx）、Excel（.xlsx / .xlsm / .xls）、PDF、TXT、JSON 与 CSV；首次使用会自动创建本地 vault。",
  },
  status: {
    title: "开箱即用，数据始终在本地",
    body: "hyseed 以 MIT 许可开源，当前版本 0.2.0。单文件 SQLite 存储、无需云服务、无遥测；装好 VS Code 扩展就能用，团队决策与经验随时可查、可追溯。语义检索可通过 sqlite-vec 扩展启用。",
    items: [
      { label: "版本", value: "Marketplace 0.2.0" },
      { label: "许可", value: "MIT · 开源" },
      { label: "数据", value: "本地 SQLite · 无遥测" },
      { label: "兼容", value: "Windows x64 · VS Code 1.101+" },
      { label: "运行时", value: "扩展内置，无需 Python" },
      { label: "检索", value: "词法 / 模糊 / 语义 / RRF 混合" },
    ],
  },
  cta: {
    title: "把团队知识接进 AI 工作流",
    body: "从 VS Code Marketplace 安装 hyseed，几分钟内拥有一个本地、可追溯、可协作的开源知识库。",
    primary: "从 Marketplace 安装",
    secondary: "在 GitHub 查看源码",
    note: "MIT 开源 · Windows x64 · 无需单独安装运行时",
  },
  footer: {
    tagline: "开源的本地知识库，为 AI 代理而生",
    license: "MIT License",
    copyright: "© 2026 hyseed",
  },
};