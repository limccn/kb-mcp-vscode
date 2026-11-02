#!/usr/bin/env node
/**
 * hyseed admin UI matrix: headless Chrome/Edge + CDP, zero dependencies.
 *
 * Navigates every admin route at a width matrix, asserts layout invariants
 * (no horizontal overflow, sidebar rail widths, nav/h1 presence, a few
 * page-specific contracts) and saves screenshots plus report.json.
 *
 * Usage:
 *   node scripts/ui-check.mjs --base http://127.0.0.1:51999 \
 *     --out .impeccable/critique/evidence/2026-10-29-ui \
 *     [--widths 1440,1024,900,768,600,480,400] [--only search,ingest]
 *     [--offline] [--allow-skip]
 *
 * `--offline` blocks the vendored assets instead of the whole network:
 * localhost is the thing under test, so a global offline emulation would
 * break navigation itself. It then checks the editor fallback and proves
 * nothing keeps retrying in the background.
 *
 * Exit codes: 0 pass, 1 assertion failure, 2 no browser (unless --allow-skip).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PAGES = [
  "/",
  "/documents",
  "/documents/new",
  "/search",
  "/links",
  "/types",
  "/graph",
  "/imports",
  "/ingest",
  "/git",
  "/scheduler",
  "/settings",
];

const BROWSERS = [
  process.env.HYSEED_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

function parseArgs(argv) {
  const options = {
    base: "http://127.0.0.1:51999",
    out: ".impeccable/critique/evidence/2026-10-29-ui",
    widths: null,
    only: null,
    offline: false,
    allowSkip: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    switch (arg) {
      case "--base":
        options.base = value().replace(/\/+$/, "");
        break;
      case "--out":
        options.out = value();
        break;
      case "--widths":
        options.widths = value().split(",").map(Number);
        break;
      case "--only":
        options.only = value().split(",").map((page) => (page.startsWith("/") ? page : `/${page}`));
        break;
      case "--offline":
        options.offline = true;
        break;
      case "--allow-skip":
        options.allowSkip = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.widths) {
    if (options.widths.some((width) => !Number.isInteger(width) || width < 320)) {
      throw new Error("--widths expects integers >= 320");
    }
  }
  return options;
}

function findBrowser() {
  return BROWSERS.find((candidate) => existsSync(candidate)) ?? null;
}

function pageName(route) {
  if (route === "/") return "root";
  return route.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "_");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
        return;
      }
      this.events.push(message);
    };
  }

  send(method, params = {}) {
    const id = (this.seq += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

async function connectPage(port) {
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return new Cdp(ws);
}

async function waitForDevToolsPort(profile, child) {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, "utf8").split(/\r?\n/);
      if (port) return Number(port);
    }
    if (child.exitCode !== null) throw new Error(`browser exited with code ${child.exitCode}`);
    await sleep(100);
  }
  throw new Error("the browser never wrote DevToolsActivePort");
}

async function waitComplete(cdp) {
  for (let i = 0; i < 150; i += 1) {
    const res = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (res.result.value === "complete") return;
    await sleep(100);
  }
  throw new Error("document did not reach readyState=complete");
}

const PROBE = `(() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const vh = window.innerHeight;
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const sidebar = document.getElementById("admin-sidebar");
  const topBar = document.querySelector(".top-bar");
  const h1 = document.querySelector("h1");
  const graph = document.getElementById("graph-container");
  const statPath = document.querySelector(".stat-path");
  const filterActions = document.querySelector(".filter-actions");
  const ingestHead = document.querySelector(".ingest-head");
  return {
    path: location.pathname,
    viewport: { w: vw, h: vh },
    scrollWidth: doc.scrollWidth,
    clientWidth: vw,
    overflow: doc.scrollWidth > vw + 1,
    topBarFits: !topBar || rect(topBar).right <= vw + 1,
    topBarHeight: topBar ? Math.round(rect(topBar).height) : null,
    sidebarWidth: sidebar ? Math.round(rect(sidebar).width) : null,
    navCount: document.querySelectorAll(".nav-link").length,
    h1Visible: !!h1 && rect(h1).width > 0 && rect(h1).height > 0,
    searchSubmitInFilters: !filterActions || !!filterActions.querySelector('button[type="submit"]'),
    ingestHeadDisplay: ingestHead ? getComputedStyle(ingestHead).display : null,
    graphHeight: graph ? Math.round(rect(graph).height) : null,
    statPathWraps: statPath ? statPath.scrollWidth <= statPath.clientWidth + 1 : null,
  };
})()`;

function checkPage(route, width, info) {
  const failures = [];
  if (info.path !== route) failures.push(`location ${info.path}, expected the route to commit`);
  if (info.overflow) failures.push(`horizontal overflow ${info.scrollWidth}/${info.clientWidth}`);
  if (!info.topBarFits) failures.push("top bar extends past the viewport");
  if (width > 768 && (info.topBarHeight === null || info.topBarHeight > 62))
    failures.push(`top bar is ${info.topBarHeight}px tall above 768px (expected one 60px row)`);
  if (info.navCount !== 11) failures.push(`nav links: ${info.navCount}, expected 11`);
  if (!info.h1Visible) failures.push("page h1 is not visible");
  const expectedSidebar = width >= 993 ? 260 : 64;
  if (info.sidebarWidth === null) failures.push("sidebar is missing");
  else if (Math.abs(info.sidebarWidth - expectedSidebar) > 2)
    failures.push(`sidebar width ${info.sidebarWidth}, expected ${expectedSidebar}`);

  if (route === "/search" && !info.searchSubmitInFilters) {
    failures.push("search submit is not inside .filter-actions");
  }
  if (route === "/ingest") {
    if (info.ingestHeadDisplay === null) failures.push("ingest header row is missing");
    else if (width <= 899 && info.ingestHeadDisplay !== "none")
      failures.push("ingest header still visible below 900px");
    else if (width > 899 && info.ingestHeadDisplay === "none")
      failures.push("ingest header hidden above 899px");
  }
  if (route === "/graph") {
    if (info.graphHeight === null) failures.push("graph container is missing");
    else if (info.graphHeight > Math.round(info.viewport.h * 0.75))
      failures.push(`graph height ${info.graphHeight}px exceeds 75% of the viewport`);
  }
  if (route === "/settings" && info.statPathWraps === false) {
    failures.push("the KB_MCP_HOME path does not wrap");
  }
  return failures;
}

function describeError(event) {
  if (event.method === "Runtime.exceptionThrown") {
    const details = event.params.exceptionDetails;
    return `exception: ${details.text} ${(details.exception && details.exception.description) || ""}`.trim();
  }
  return event.params.entry.text;
}

function newErrors(events, from) {
  return events
    .slice(from)
    .filter(
      (event) =>
        event.method === "Runtime.exceptionThrown" ||
        (event.method === "Log.entryAdded" && event.params.entry.level === "error")
    )
    .map(describeError)
    .filter((message) => !/ERR_BLOCKED_BY_CLIENT/.test(message));
}

async function capture(cdp, out, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function runMatrix(cdp, options, routes, widths, report) {
  for (const route of routes) {
    for (const width of widths) {
      const height = width >= 900 ? 900 : 800;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const from = cdp.events.length;
      await cdp.send("Page.navigate", { url: `${options.base}${route}` });
      await waitComplete(cdp);
      await sleep(500);
      const probe = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      const info = probe.result.value;
      const failures = checkPage(route, width, info);
      const errors = newErrors(cdp.events, from);
      if (errors.length) failures.push(...errors.map((message) => `console: ${message}`));
      const name = `${pageName(route)}_${width}x${height}`;
      await capture(cdp, options.out, name);
      report.results.push({ route, width, height, name, info, failures });
      report.passed += failures.length === 0 ? 1 : 0;
      report.failed += failures.length === 0 ? 0 : 1;
      console.log(
        `${failures.length ? "FAIL" : "PASS"} ${route} @${width}x${height}` +
          (failures.length ? ` :: ${failures.join(" | ")}` : "")
      );
    }
  }
}

async function runOffline(cdp, options, widths, report) {
  await cdp.send("Network.setBlockedURLs", { urls: ["*/static/vendor/*"] });
  for (const width of widths) {
    const height = width >= 900 ? 900 : 800;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const from = cdp.events.length;
    await cdp.send("Page.navigate", { url: `${options.base}/documents/new` });
    await waitComplete(cdp);

    // The editor retries for ~9s before giving up; poll past that bound.
    let fallback = false;
    for (let i = 0; i < 30 && !fallback; i += 1) {
      const res = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const notice = document.getElementById("editor-fallback-notice");
          const textarea = document.getElementById("markdown-editor");
          return !!notice && !!textarea && getComputedStyle(textarea).display !== "none";
        })()`,
        returnByValue: true,
      });
      fallback = res.result.value === true;
      if (!fallback) await sleep(500);
    }

    const before = cdp.events.filter((event) => event.method === "Network.requestWillBeSent").length;
    await sleep(2000);
    const after = cdp.events.filter((event) => event.method === "Network.requestWillBeSent").length;

    const probe = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    const info = probe.result.value;
    const failures = [];
    if (!fallback) failures.push("editor fallback notice never appeared");
    if (info.overflow) failures.push(`horizontal overflow ${info.scrollWidth}/${info.clientWidth}`);
    if (after !== before) failures.push(`${after - before} requests kept firing after the fallback`);

    const name = `documents_new_${width}x${height}_offline`;
    await capture(cdp, options.out, name);
    report.results.push({ route: "/documents/new (offline)", width, height, name, info, failures });
    report.passed += failures.length === 0 ? 1 : 0;
    report.failed += failures.length === 0 ? 0 : 1;
    console.log(
      `${failures.length ? "FAIL" : "PASS"} /documents/new offline @${width}x${height}` +
        (failures.length ? ` :: ${failures.join(" | ")}` : "")
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = findBrowser();
  if (!browser) {
    const message = `no Edge/Chrome found; set HYSEED_BROWSER or install one (checked: ${BROWSERS.join(", ")})`;
    if (options.allowSkip) {
      console.warn(`SKIP ${message}`);
      return 0;
    }
    console.error(message);
    return 2;
  }

  const widths = options.widths ?? (options.offline ? [1440, 480] : [1440, 1024, 900, 768, 600, 480, 400]);
  const routes = options.only ?? PAGES;
  for (const route of routes) {
    if (!PAGES.includes(route)) throw new Error(`--only: unknown route ${route}`);
  }

  mkdirSync(options.out, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "hyseed-ui-check-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const report = {
    base: options.base,
    browser,
    offline: options.offline,
    widths,
    startedAt: new Date().toISOString(),
    results: [],
    passed: 0,
    failed: 0,
  };

  let cdp;
  try {
    const port = await waitForDevToolsPort(profile, child);
    cdp = await connectPage(port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

    if (options.offline) await runOffline(cdp, options, widths, report);
    else await runMatrix(cdp, options, routes, widths, report);
  } finally {
    report.finishedAt = new Date().toISOString();
    const reportName = options.offline ? "report-offline.json" : "report.json";
    writeFileSync(join(options.out, reportName), JSON.stringify(report, null, 2));
    try {
      cdp?.close();
    } catch {
      // ignore
    }
    child.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // the browser may still hold a handle on Windows; the temp dir is disposable
    }
  }

  console.log(
    `\n${report.failed === 0 ? "PASS" : "FAIL"} ${report.passed} passed, ${report.failed} failed` +
      ` — report: ${join(options.out, options.offline ? "report-offline.json" : "report.json")}`
  );
  return report.failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });