# kbmcp-web — hyseed 产品门户

`https://hyseed.lmlh.net` 的源码与构建产物。单页营销站，中 / 英 / 日三语，
深色开发者风；Next.js 静态导出，部署到 Cloudflare Pages（Wrangler 直传）。

## 目录

```
app/(zh)/            中文根路由（/），<html lang="zh-CN">
app/(intl)/[locale]/ 英文 / 日文（/en/、/ja/），generateStaticParams 预渲染
content/             三语文案（zh.ts 是事实源，en.ts / ja.ts 同类型翻译）
lib/                 SITE_URL、Marketplace 链接、版本号、metadata、JSON-LD
components/          页面区块与图标
public/              _headers、_redirects、icon.png、og.png
scripts/generate-og.mjs  用 sharp 生成 public/og.png（prebuild 自动执行）
out/                 构建产物（已 gitignore，不提交）
```

## 环境

- Node.js ≥ 20.9（本机开发用 22.x）
- npm
- 首次运行 `npm ci`（或 `npm install`）

## 本地开发

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run build        # 静态导出到 out/
npm run preview      # wrangler pages dev out，默认 8788 端口
```

`npm run build` 前会自动跑 `npm run og` 重新生成 `public/og.png`。

## 内容维护

- 文案：`content/zh.ts` 先改，`content/en.ts`、`content/ja.ts` 同步；类型不全会 typecheck 报错。
- 版本号 / 链接：`lib/site.ts`（`PUBLIC_VERSION`、`MARKETPLACE_URL`、`OPEN_VSX_URL`、`GITHUB_URL`、`SITE_URL`）。
- 中 / 日文字体栈在 `app/globals.css` 顶部按 `html[lang]` 定义：中文 Noto Sans SC → 微软雅黑 → 苹方；
  日文 Noto Sans JP → Yu Gothic UI / Meiryo → Hiragino。不加载 Web Font，只用系统已装字体。
- 数字与能力表述必须能追溯到仓库根目录的 `../README.md`，不要写未验证的指标。
- 改版后重新 `npm run build`，并在 360 / 768 / 1280 / 1440 下检查无横向滚动。

## 部署到 Cloudflare Pages

本项目不依赖 Pages 的 Git 集成，统一用 Wrangler 直传 `out/`。

```bash
# 首次：创建项目（只需一次）
npx wrangler pages project create hyseed-portal --production-branch main

# 每次发布
npm run build
npx wrangler pages deploy out --project-name hyseed-portal --branch main
# 等价于 npm run deploy
```

- 部署成功后会输出预览 URL 与 deployment id，记录在发布说明里。
- 自定义域：Cloudflare Dashboard → Pages → `hyseed-portal` → Custom domains →
  添加 `hyseed.lmlh.net`（DNS 已托管在同一账号时会自动建 CNAME）。
- 任何 Cloudflare 写操作（建项目、部署、绑域名）执行前必须先向用户确认。

### 回滚

- Dashboard：Pages → `hyseed-portal` → Deployments → 找到上一个正常版本 → Rollback。
- 代码层面：`git revert` 或切回上一个可构建 commit，重新 `npm run build && npm run deploy`。
- 自定义域异常：在 Custom domains 移除 `hyseed.lmlh.net`，再排查 DNS。

### 凭据

只使用 `wrangler login` 的 OAuth 缓存，或环境变量 `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`。不要把 token 写进 `.env`、源码、命令行参数或任何提交的文件；
排查问题时也不打印 token 值。

## 验证基线（2026-10-29，文案 / 字体 / GitHub 链接调整后）

- `npm run typecheck`、`npm run build` 通过；`out/index.html`、`out/en/index.html`、`out/ja/index.html` 均生成。
- 本地 `wrangler pages dev out`：`/`、`/en/`、`/ja/`、`/og.png`、`/sitemap.xml`、`/robots.txt` 返回 200；`/zh`、`/zh/` 301 到 `/`。
- 320 / 360 / 768 / 1024 / 1025 / 1280 / 1440 × 三语：`scrollWidth == clientWidth`，无横向滚动。
- 三语页面各 4 个 GitHub 链接（页头图标、移动菜单、CTA 次按钮、页脚），JSON-LD 含 `codeRepository` 与 `sameAs`。
- 渲染文本无 `Beta` / `README` / `127.0.0.1` / `PyPI` 等劝退或内部措辞。
- Lighthouse 12：移动 97 / 100 / 100 / 100，桌面 100 / 100 / 100 / 100
  （性能 / 无障碍 / 最佳实践 / SEO）。移动性能在 97–98 间随模拟节流波动。
- 线上部署：`https://hyseed.lmlh.net` 三语路由、`/og.png`、`/sitemap.xml` 均 200（deployment `15256f13.hyseed-portal.pages.dev`）。