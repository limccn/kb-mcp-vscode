#!/usr/bin/env node
/**
 * Setup-guide webview DOM probe. Bundles `renderOnboardingHtml` (esbuild + a
 * stub `vscode`), loads it in headless Chrome/Edge over CDP with a fake
 * `acquireVsCodeApi`, and asserts the rendered contract:
 *
 * - three steps, CLI pre-checked / MCP opt-in, polite aria-live status, native
 *   focusable buttons
 * - the two `hyseed setup guide` script messages (ready/state/busy/notice) and
 *   every button dispatch (run, finish, skip)
 * - pinned data roots are read-only (Change… disabled, Open settings shown)
 * - no external requests and no console errors
 *
 * Usage: node scripts/onboarding-probe.mjs [--out <dir>] [--allow-skip]
 * Exit codes: 0 pass, 1 assertion failure, 2 no browser (unless --allow-skip).
 */
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BROWSERS = [
  process.env.HYSEED_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const INJECT = `
window.__posted = [];
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (message) { window.__posted.push(message); },
    getState: function () { return undefined; },
    setState: function () {},
  };
};
window.__hostSend = function (message) {
  // The real webview delivers the posted value as event.data.
  window.postMessage(message, "*");
};
`;

const SAMPLE_STATE = {
  version: "0.2.0",
  cli: {
    status: "ready",
    targetDir: "C:\\probe\\.local\\bin",
    tools: [
      { name: "hyseed.exe", state: "up-to-date" },
      { name: "doc-convert.exe", state: "missing" },
    ],
    pathContainsTarget: false,
    pathHint: "C:\\probe\\.local\\bin is not on PATH.",
  },
  mcp: {
    status: "ready",
    targets: [
      {
        agent: "claude",
        scope: "user",
        mcp: "present",
        legacy: { agent: "claude", scope: "user", skills: [], mcp: "absent" },
      },
    ],
    legacy: [
      { agent: "cline", scope: "workspace", skills: ["kb-usage"], mcp: "present" },
    ],
  },
  data: {
    status: "ready",
    dataRoot: "C:\\probe\\data",
    configDataDir: "C:\\probe\\config-data",
    pinnedBy: null,
    initialized: true,
    vaults: 1,
    candidates: [],
  },
};

const PINNED_STATE = {
  ...SAMPLE_STATE,
  data: {
    ...SAMPLE_STATE.data,
    pinnedBy: "setting",
    candidates: [
      { path: "C:\\probe\\legacy", kind: "extension", vaults: 2, documents: 5 },
    ],
  },
};

function parseArgs(argv) {
  const options = { out: "out/onboarding-probe", allowSkip: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      i += 1;
      if (i >= argv.length) throw new Error("--out needs a value");
      options.out = argv[i];
    } else if (arg === "--allow-skip") {
      options.allowSkip = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function findBrowser() {
  return BROWSERS.find((candidate) => existsSync(candidate)) ?? null;
}

async function buildHtml() {
  const result = await esbuild.build({
    stdin: {
      contents:
        'import { renderOnboardingHtml } from "./src/onboarding/panel";\n' +
        'export const html = renderOnboardingHtml({ nonce: "probe-nonce", version: "0.2.0" });\n',
      resolveDir: root,
      sourcefile: "onboarding-dom-probe-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "vscode-stub",
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "vscode-stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "vscode-stub" }, () => ({
            contents:
              "export const window = {};\n" +
              "export const ViewColumn = { Active: -1 };\n",
            loader: "js",
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  const sandboxModule = { exports: {} };
  const requireFn = createRequire(join(root, "onboarding-probe.cjs"));
  new Function("module", "exports", "require", code)(
    sandboxModule,
    sandboxModule.exports,
    requireFn
  );
  return sandboxModule.exports.html;
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
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
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
  await new Promise((resolvePromise, reject) => {
    ws.onopen = resolvePromise;
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

async function evaluate(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text ?? "Runtime.evaluate threw");
  }
  return res.result.value;
}

async function waitComplete(cdp) {
  for (let i = 0; i < 150; i += 1) {
    if ((await evaluate(cdp, "document.readyState")) === "complete") return;
    await sleep(100);
  }
  throw new Error("document did not reach readyState=complete");
}

async function capture(cdp, out, name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
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

  mkdirSync(options.out, { recursive: true });
  const html = await buildHtml();
  const htmlPath = join(options.out, "setup-guide.html");
  writeFileSync(htmlPath, html);

  const report = {
    html: htmlPath,
    browser,
    startedAt: new Date().toISOString(),
    checks: [],
    passed: 0,
    failed: 0,
  };
  const failures = [];
  const check = (name, condition, detail) => {
    if (condition) {
      report.passed += 1;
    } else {
      report.failed += 1;
      failures.push(detail ? `${name}: ${detail}` : name);
    }
  };

  const profile = mkdtempSync(join(tmpdir(), "hyseed-onboarding-probe-"));
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

  let cdp;
  try {
    const port = await waitForDevToolsPort(profile, child);
    cdp = await connectPage(port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });

    const notFileRequests = [];
    const from = cdp.events.length;
    await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await waitComplete(cdp);

    let ready = false;
    for (let i = 0; i < 50 && !ready; i += 1) {
      ready = await evaluate(
        cdp,
        "!!window.__posted && window.__posted.some((m) => m.type === 'ready')"
      );
      if (!ready) await sleep(100);
    }

    const initial = await evaluate(
      cdp,
      `(() => {
        const $ = (id) => document.getElementById(id);
        const ids = ["run-cli", "run-mcp", "change-data-dir", "open-settings", "review-migration", "cleanup-legacy", "skip", "finish"];
        return {
          ready: (window.__posted || []).some((m) => m.type === "ready"),
          guide: !!$("guide"),
          steps: ["step-cli", "step-mcp", "step-data"].every((id) => !!$(id)),
          cliChecked: $("step-cli-enabled").checked,
          mcpChecked: $("step-mcp-enabled").checked,
          statusRole: $("status").getAttribute("role"),
          statusLive: $("status").getAttribute("aria-live"),
          buttons: ids.filter((id) => !$(id)),
          focusable: (() => { const b = $("run-cli"); b.focus(); return document.activeElement === b; })(),
        };
      })()`
    );
    check("script sends ready", initial.ready);
    check("main region present", initial.guide);
    check("three steps rendered", initial.steps);
    check("CLI tools pre-checked", initial.cliChecked === true);
    check("MCP opt-in unchecked", initial.mcpChecked === false);
    check(
      "status is a polite live region",
      initial.statusRole === "status" && initial.statusLive === "polite",
      `role=${initial.statusRole} aria-live=${initial.statusLive}`
    );
    check("every button exists", initial.buttons.length === 0, initial.buttons.join(", "));
    check("buttons take keyboard focus", initial.focusable === true);

    const send = async (message) => {
      await evaluate(cdp, `window.__hostSend(${JSON.stringify(message)})`);
      await sleep(120);
    };

    await send({ type: "state", state: SAMPLE_STATE });
    const rendered = await evaluate(
      cdp,
      `(() => {
        const text = (id) => document.getElementById(id).textContent;
        const hidden = (id) => document.getElementById(id).hidden;
        return {
          cliList: [...document.querySelectorAll("#cli-tools li")].map((li) => li.textContent),
          cliBadge: text("step-cli-badge"),
          cliPath: text("cli-path"),
          mcpList: [...document.querySelectorAll("#mcp-targets li")].map((li) => li.textContent),
          mcpBadge: text("step-mcp-badge"),
          legacyHidden: hidden("legacy-box"),
          legacySummary: text("legacy-summary"),
          dataRoot: text("data-root"),
          dataConfig: text("data-config"),
          dataBadge: text("step-data-badge"),
          changeDisabled: document.getElementById("change-data-dir").disabled,
          pinHidden: hidden("data-pin"),
          settingsHidden: hidden("open-settings"),
          reviewHidden: hidden("review-migration"),
        };
      })()`
    );
    check(
      "CLI tools render with state labels",
      rendered.cliList.includes("hyseed.exe — up to date") &&
        rendered.cliList.includes("doc-convert.exe — not installed"),
      JSON.stringify(rendered.cliList)
    );
    check("CLI badge stays pending with one missing tool", rendered.cliBadge === "pending");
    check("PATH hint rendered", rendered.cliPath.includes("not on PATH"));
    check(
      "MCP targets render",
      rendered.mcpList.length === 1 && rendered.mcpList[0].includes("claude/user"),
      JSON.stringify(rendered.mcpList)
    );
    check("MCP badge configured", rendered.mcpBadge === "configured");
    check(
      "legacy entries surface for cleanup",
      rendered.legacyHidden === false && /kb-usage/.test(rendered.legacySummary),
      rendered.legacySummary
    );
    check("data root rendered", rendered.dataRoot === "C:\\probe\\data", rendered.dataRoot);
    check(
      "config data_dir rendered",
      rendered.dataConfig === "C:\\probe\\config-data",
      rendered.dataConfig
    );
    check("data badge ready", rendered.dataBadge === "ready");
    check("Change… enabled without a pin", rendered.changeDisabled === false);
    check("pin hints hidden without a pin", rendered.pinHidden && rendered.settingsHidden);
    check("migration review hidden without candidates", rendered.reviewHidden === true);
    await capture(cdp, options.out, "setup-guide-ready");

    await send({ type: "state", state: PINNED_STATE });
    const pinned = await evaluate(
      cdp,
      `(() => {
        const text = (id) => document.getElementById(id).textContent;
        const hidden = (id) => document.getElementById(id).hidden;
        return {
          pinText: text("data-pin"),
          pinHidden: hidden("data-pin"),
          changeDisabled: document.getElementById("change-data-dir").disabled,
          settingsHidden: hidden("open-settings"),
          reviewHidden: hidden("review-migration"),
          candidateText: text("data-candidates"),
        };
      })()`
    );
    check(
      "pinned root shows why Change… is unavailable",
      pinned.pinHidden === false && /kbMcp\.dataRoot/.test(pinned.pinText),
      pinned.pinText
    );
    check("pinned root disables Change…", pinned.changeDisabled === true);
    check("pinned root offers Open settings", pinned.settingsHidden === false);
    check(
      "migration candidates are visible",
      pinned.reviewHidden === false &&
        /2 vault\(s\)/.test(pinned.candidateText) &&
        /5 document\(s\)/.test(pinned.candidateText),
      pinned.candidateText
    );
    await capture(cdp, options.out, "setup-guide-pinned");

    await send({ type: "busy", step: "data", busy: true });
    const busyOn = await evaluate(
      cdp,
      `(() => ["run-cli", "run-mcp", "finish", "skip", "open-settings", "review-migration"].filter((id) => !document.getElementById(id).disabled))()`
    );
    check("busy disables every action", busyOn.length === 0, busyOn.join(", "));
    await send({ type: "busy", step: "data", busy: false });
    const busyOff = await evaluate(
      cdp,
      `(() => ({
        runCli: document.getElementById("run-cli").disabled,
        finish: document.getElementById("finish").disabled,
        change: document.getElementById("change-data-dir").disabled,
      }))()`
    );
    check(
      "busy off re-enables actions",
      busyOff.runCli === false && busyOff.finish === false,
      JSON.stringify(busyOff)
    );
    check(
      "a pinned Change… stays disabled after busy",
      busyOff.change === true,
      JSON.stringify(busyOff)
    );

    await send({ type: "notice", level: "error", message: "probe boom" });
    const notice = await evaluate(
      cdp,
      `(() => ({ text: document.getElementById("status").textContent, level: document.getElementById("status").getAttribute("data-level") }))()`
    );
    check("error notice reaches the status region", notice.text === "probe boom");
    check("error notice is styled as an error", notice.level === "error");

    await evaluate(
      cdp,
      `(() => { document.getElementById("run-cli").click(); document.getElementById("run-mcp").click(); document.getElementById("open-settings").click(); return true; })()`
    );
    await sleep(100);
    const clicks = await evaluate(cdp, "window.__posted.slice(-3)");
    check(
      "buttons post run/run/settings messages",
      JSON.stringify(clicks) ===
        JSON.stringify([
          { type: "run", step: "cli" },
          { type: "run", step: "mcp" },
          { type: "openSettings" },
        ]),
      JSON.stringify(clicks)
    );

    await evaluate(
      cdp,
      `(() => { document.getElementById("step-mcp-enabled").checked = true; document.getElementById("finish").click(); return true; })()`
    );
    await sleep(100);
    const finishMessage = await evaluate(cdp, "window.__posted[window.__posted.length - 1]");
    check(
      "finish sends the checked steps",
      JSON.stringify(finishMessage) ===
        JSON.stringify({ type: "finish", skipped: false, steps: { cli: true, mcp: true } }),
      JSON.stringify(finishMessage)
    );

    await evaluate(
      cdp,
      `(() => { document.getElementById("step-mcp-enabled").checked = false; document.getElementById("skip").click(); return true; })()`
    );
    await sleep(100);
    const skipMessage = await evaluate(cdp, "window.__posted[window.__posted.length - 1]");
    check(
      "skip sends skipped=true with the current steps",
      JSON.stringify(skipMessage) ===
        JSON.stringify({ type: "finish", skipped: true, steps: { cli: true, mcp: false } }),
      JSON.stringify(skipMessage)
    );

    for (const event of cdp.events.slice(from)) {
      if (event.method === "Network.requestWillBeSent") {
        const url = event.params.request.url;
        if (!url.startsWith("file://") && !url.startsWith("data:")) notFileRequests.push(url);
      }
    }
    check(
      "the guide makes no external requests",
      notFileRequests.length === 0,
      notFileRequests.join(", ")
    );

    const consoleErrors = cdp.events
      .slice(from)
      .filter(
        (event) =>
          event.method === "Runtime.exceptionThrown" ||
          (event.method === "Log.entryAdded" && event.params.entry.level === "error")
      )
      .map((event) =>
        event.method === "Runtime.exceptionThrown"
          ? event.params.exceptionDetails.text
          : event.params.entry.text
      );
    check("no console errors or CSP violations", consoleErrors.length === 0, consoleErrors.join(" | "));
  } finally {
    report.finishedAt = new Date().toISOString();
    report.checks = failures;
    writeFileSync(join(options.out, "report.json"), JSON.stringify(report, null, 2));
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

  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(
    `\n${report.failed === 0 ? "PASS" : "FAIL"} ${report.passed} passed, ${report.failed} failed` +
      ` — report: ${join(options.out, "report.json")}`
  );
  return report.failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });