import type { PortalContent } from "./types";

export const en: PortalContent = {
  meta: {
    title: "hyseed — An open-source local knowledge base for AI agents",
    description:
      "hyseed is an open-source local knowledge base that turns team decisions, lessons, APIs, and runbooks into structured facts MCP clients like Claude Code, Cursor, and Cline can use directly. Local-first, Git-native, MIT.",
    ogAlt: "hyseed — An open-source local knowledge base for AI agents",
  },
  nav: {
    features: "Features",
    compare: "Compare",
    quickstart: "Quick start",
    install: "Install",
    skip: "Skip to content",
  },
  hero: {
    eyebrow: "OPEN SOURCE · LOCAL-FIRST · MCP-NATIVE",
    title: "A queryable, traceable knowledge base for your AI agents",
    subtitle:
      "hyseed is an open-source local knowledge base: it turns team decisions, lessons, APIs, and runbooks into structured facts that MCP clients like Claude Code, Cursor, and Cline can use directly — with data staying on your machine.",
    primaryCta: "Install from VS Code Marketplace",
    secondaryCta: "Explore capabilities",
    note: "MIT open source · Windows x64 · VS Code 1.101+",
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
    note: "Section-level retrieval keeps whole documents out of the context window.",
  },
  positioning: {
    title: "Notes, vector stores, and AI memory each miss a piece",
    subtitle:
      "They solve how humans write, how to find similar text, and how to remember a conversation — but not how AI reliably uses facts your team has reviewed.",
    cards: [
      {
        title: "Human-first notes (Notion / Obsidian)",
        body: "Page-centric and great for people; AI access depends on connectors or plugins, and structure is a human convention.",
      },
      {
        title: "Vector stores / RAG (Chroma / LanceDB, etc.)",
        body: "Strong at similarity search, but no schema, versioning, or team collaboration; you build the retrieval pipeline.",
      },
      {
        title: "AI memory (Mem0 / Zep, etc.)",
        body: "Per-agent conversational memory, mostly auto-extracted; not designed for team review or long-term governance.",
      },
    ],
    punchline:
      "hyseed fills the gap: structured, team-reviewed facts that AI can use through MCP.",
  },
  features: {
    title: "Designed to be used by AI",
    subtitle:
      "Not a chat box bolted onto a wiki — retrieval, structure, versioning, and collaboration live in the protocol and the data model.",
    items: [
      {
        icon: "mcp",
        title: "MCP-native",
        body: "CRUD, search, graph, versioning, and scheduling are exposed through MCP. Claude Code, Cursor, Cline, and other clients can connect directly. For a lighter integration, switch to the read-only thin mode.",
      },
      {
        icon: "schema",
        title: "Typed schema, not free text",
        body: "Nine built-in document types: project, decision, lesson, glossary, person, FAQ, API, runbook, and release. Typed metadata and stable IDs let AI extract exact facts.",
      },
      {
        icon: "section",
        title: "Section-level retrieval",
        body: "kb_get can return a single heading section; when the section is missing, it returns the table of contents. Long-document context drops by 70–90%.",
      },
      {
        icon: "history",
        title: "Versioning, audit, rollback",
        body: "Every change has a version number, with field-level diffs, restore to any version, soft-delete recovery, and an audit log. AI writes become safe to trust.",
      },
      {
        icon: "graph",
        title: "Typed knowledge graph",
        body: "Ten standard relation types, automatic backlinks, multi-hop traversal, impact analysis, and decision chains. Change a decision and follow the graph to affected docs.",
      },
      {
        icon: "git",
        title: "Git-native collaboration",
        body: "Knowledge lives as Markdown in Git; tags, aliases, links, and metadata are three-way merged. PR review, branches, and Code Owners keep working.",
      },
    ],
  },
  comparison: {
    title: "Side by side",
    subtitle:
      "From design center to data deployment, the differences between the four approaches are clear at a glance.",
    dimensionLabel: "Dimension",
    columns: [
      "Human-first notes (Notion / Obsidian)",
      "Vector stores + RAG",
      "AI memory",
      "hyseed",
    ],
    rows: [
      {
        dimension: "Design center",
        values: [
          "People and pages",
          "Models and vectors",
          "One agent's conversation",
          "AI agents + people, one shared body of knowledge",
        ],
      },
      {
        dimension: "AI access",
        values: [
          "Web / editor; connectors or plugins",
          "SDK + custom retrieval pipeline",
          "SDK / API tied to a framework",
          "MCP-native + CLI + admin console + VS Code extension",
        ],
      },
      {
        dimension: "Structure",
        values: [
          "Free-form, by convention",
          "Vectors only, no schema",
          "Auto-extracted memory entries",
          "9 document types + typed metadata + stable IDs",
        ],
      },
      {
        dimension: "Retrieval",
        values: [
          "Keywords / plugins",
          "Mostly vector similarity",
          "Semantic recall",
          "FTS5 BM25 / fuzzy / semantic (sqlite-vec) / RRF hybrid",
        ],
      },
      {
        dimension: "Context cost",
        values: [
          "Whole page",
          "Chunks, still need trimming",
          "Injected memory, uncontrolled granularity",
          "Section-level; 70–90% less on long docs",
        ],
      },
      {
        dimension: "Versioning & audit",
        values: [
          "Page/file history; audit depends on plan or plugin",
          "Usually none",
          "Not the focus",
          "Versions, field-level diffs, restore, soft delete, audit",
        ],
      },
      {
        dimension: "Team collaboration",
        values: [
          "Notion: real-time; Obsidian: Git/sync",
          "None",
          "Weak, platform-bound",
          "Git-native + three-way merge + PR review",
        ],
      },
      {
        dimension: "Data & deployment",
        values: [
          "Notion: cloud; Obsidian: local files",
          "Local or cloud, self-managed",
          "Self-hosted open source or cloud",
          "Single-file SQLite, fully local, no cloud, no telemetry, MIT",
        ],
      },
    ],
  },
  quickstart: {
    title: "Three steps into your workflow",
    subtitle: "Install the extension and go; no separate Python runtime required.",
    steps: [
      {
        title: "Install the extension",
        body: "Install hyseed from the VS Code Marketplace, with support for Windows x64 and VS Code 1.101+.",
        code: "code --install-extension limccn.kbmcp-vscode",
      },
      {
        title: "Open the admin console",
        body: "Run hyseed: Open admin console from the Command Palette; the local admin console opens in your browser.",
      },
      {
        title: "Create, convert or import knowledge",
        body: "Create a document, convert an existing document or import Markdown — or let AI search directly from your MCP client. Every change is versioned.",
        code: 'hyseed search "sqlite fts5"',
      },
    ],
    note: "Supports Markdown, Word (.docx), PowerPoint (.pptx), Excel (.xlsx / .xlsm / .xls), PDF, TXT, JSON and CSV; a local vault is created on first use.",
  },
  status: {
    title: "Ready out of the box, with data staying local",
    body: "hyseed is open source under MIT, currently at 0.2.0. Single-file SQLite storage, no cloud service, no telemetry; install the VS Code extension and your team's decisions and lessons are searchable and traceable. Semantic search can be enabled with the sqlite-vec extension.",
    items: [
      { label: "Version", value: "Marketplace 0.2.0" },
      { label: "License", value: "MIT · open source" },
      { label: "Data", value: "Local SQLite · no telemetry" },
      { label: "Compatibility", value: "Windows x64 · VS Code 1.101+" },
      { label: "Runtime", value: "Bundled, no Python required" },
      { label: "Search", value: "Lexical / fuzzy / semantic / RRF hybrid" },
    ],
  },
  cta: {
    title: "Bring team knowledge into your AI workflow",
    body: "Install hyseed from the VS Code Marketplace and get a local, traceable, collaborative open-source knowledge base in minutes.",
    primary: "Install from Marketplace",
    secondary: "View source on GitHub",
    note: "MIT open source · Windows x64 · no separate runtime install",
  },
  footer: {
    tagline: "An open-source local knowledge base for AI agents",
    license: "MIT License",
    copyright: "© 2026 hyseed",
  },
};