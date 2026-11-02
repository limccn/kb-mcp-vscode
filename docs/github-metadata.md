# GitHub repository metadata

Ready-to-paste copy for the repository's **About** panel, topics, and social preview.
This file is for maintainers and is excluded from the VSIX.

## About

Short description (GitHub allows up to 350 characters):

> hi, 🌱 A local-first knowledge base for AI agents, growing inside VS Code. Sidebar search, admin console, MCP & skills, vaults, and backups — with the `hyseed.exe` runtime bundled. No cloud, no telemetry. MIT, Windows x64.

**Website:** <https://hyseed.lmlh.net>

Chinese alternative:

> hi, 🌱 为 AI 代理准备的本地优先知识库，生长在 VS Code 里。侧栏检索、管理台、MCP 与技能、vault 和备份，自带 `hyseed.exe`；无云端、无遥测。MIT，Windows x64。

### Longer description

Use this in directories, awesome lists, or anywhere that allows a paragraph:

> hyseed is an open-source, local-first knowledge base for AI agents. It turns team decisions, lessons, APIs, and runbooks into structured facts that MCP clients such as Claude Code, Cursor, and Cline can query directly. The VS Code extension adds sidebar search, the full admin console, MCP and skill installation, per-workspace vault pinning, and Markdown backup/restore. The `hyseed.exe` runtime ships inside the extension, and data stays on your machine. MIT, Windows x64.

## Topics

GitHub topics are lowercase and hyphenated. Suggested set (16):

```text
vscode-extension
vscode
knowledge-base
local-first
mcp
model-context-protocol
ai-agents
rag
markdown
sqlite
typescript
windows
open-source
hyseed
developer-tools
semantic-search
```

## Set the About panel and topics

In the browser: **Repository → About (gear icon) → Description / Website / Topics**.

Or with the GitHub CLI:

```bash
gh repo edit limccn/kb-mcp-vscode \
  --description "hi, 🌱 A local-first knowledge base for AI agents, growing inside VS Code. Sidebar search, admin console, MCP & skills, vaults, and backups — with the hyseed.exe runtime bundled. No cloud, no telemetry. MIT, Windows x64." \
  --homepage "https://hyseed.lmlh.net" \
  --add-topic vscode-extension \
  --add-topic vscode \
  --add-topic knowledge-base \
  --add-topic local-first \
  --add-topic mcp \
  --add-topic model-context-protocol \
  --add-topic ai-agents \
  --add-topic rag \
  --add-topic markdown \
  --add-topic sqlite \
  --add-topic typescript \
  --add-topic windows \
  --add-topic open-source \
  --add-topic hyseed \
  --add-topic developer-tools \
  --add-topic semantic-search
```

The GitHub CLI cannot set the social preview image; use the web UI for that step.

## Social preview

1. Open **Repository → Settings → General → Social preview**.
2. Click **Edit → Upload an image**.
3. Upload `assets/social-preview.png` (1280×640, about 190 KB, below GitHub's 1 MB limit).
4. The editable source is `assets/social-preview.svg`. Keep both in sync if the wording changes.

The README banner is `assets/banner.png` (1600×420); its source is `assets/banner.svg`.

## Optional: package metadata

Once the repository is public, add the following to `package.json` so Marketplace and VSIX links resolve to the repository:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/limccn/kb-mcp-vscode.git"
},
"homepage": "https://hyseed.lmlh.net",
"bugs": {
  "url": "https://github.com/limccn/kb-mcp-vscode/issues"
}
```

This changes the packaged manifest, so do it with a version bump rather than editing an already-published artifact.
