import * as assert from "node:assert/strict";
import { ONBOARDING_TITLE, ONBOARDING_VIEW_TYPE } from "../../constants";
import type { OnboardingActions } from "../../onboarding/actions";
import { OnboardingPanel, renderOnboardingHtml } from "../../onboarding/panel";
import type { OnboardingState, OnboardingSteps } from "../../onboarding/state";
import { createdWebviewPanels, type FakeWebviewPanel } from "../vscode-stub";

function render(nonce = "nonce-abc123"): string {
  return renderOnboardingHtml({ nonce, version: "0.2.0" });
}

function sampleState(): OnboardingState {
  return {
    version: "0.2.0",
    cli: {
      status: "ready",
      targetDir: "C:\\bin",
      tools: [{ name: "hyseed.exe", state: "up-to-date" }],
      pathContainsTarget: true,
      pathHint: "C:\\bin is on PATH.",
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
      legacy: [],
    },
    data: {
      status: "ready",
      dataRoot: "C:\\data",
      configDataDir: "",
      pinnedBy: null,
      initialized: true,
      vaults: 1,
      candidates: [],
    },
  };
}

describe("renderOnboardingHtml", () => {
  it("locks the webview down with a nonce CSP and no external resources", () => {
    const html = render();
    const match = /script-src 'nonce-([^']+)'/.exec(html);
    assert.ok(match, "CSP has no script nonce");
    assert.ok(html.includes(`<script nonce="${match[1]}">`), "the inline script must share the CSP nonce");
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(!/https?:\/\//.test(html), "the guide must not reference external URLs");
    assert.ok(!html.includes("<link"));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("@import"));
  });

  it("renders the three steps with a polite live status region", () => {
    const html = render();
    assert.ok(html.includes('id="step-cli"'));
    assert.ok(html.includes('id="step-mcp"'));
    assert.ok(html.includes('id="step-data"'));
    assert.ok(html.includes('role="status" aria-live="polite"'));
    assert.ok(html.includes('id="step-cli-badge"'));
    assert.ok(html.includes('id="step-data-root"') === false);
    assert.ok(html.includes('id="data-root"'));
  });

  it("starts with CLI tools recommended and MCP opt-in", () => {
    const html = render();
    assert.ok(/<input type="checkbox" id="step-cli-enabled" checked>/.test(html));
    assert.ok(/<input type="checkbox" id="step-mcp-enabled">/.test(html));
  });

  it("exposes every action as a native, focusable button", () => {
    const html = render();
    for (const id of [
      "run-cli",
      "run-mcp",
      "change-data-dir",
      "open-settings",
      "review-migration",
      "cleanup-legacy",
      "skip",
      "finish",
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing button #${id}`);
    }
    assert.ok(!/onclick=/i.test(html), "handlers must be wired with addEventListener");
    assert.ok(html.includes("button:focus-visible"));
  });

  it("themes with VS Code variables only and never assigns innerHTML", () => {
    const html = render();
    assert.ok(html.includes("var(--vscode-foreground)"));
    assert.ok(html.includes("var(--vscode-button-background)"));
    assert.ok(!html.includes("innerHTML"));
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(html));
  });

  it("shows the version and parses as valid inline JavaScript", () => {
    const html = render("nonce-xyz");
    assert.ok(html.includes("Version 0.2.0"));
    assert.ok(html.includes("hyseed setup guide"));
    const match = /<script nonce="nonce-xyz">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, "inline script not found");
    assert.doesNotThrow(() => new Function(match[1]));
    assert.ok(match[1].includes("acquireVsCodeApi()"));
  });
});

interface FakeActionLog {
  calls: string[];
  finishArgs: { skipped: boolean; steps: OnboardingSteps }[];
  handleClosedCount: number;
  failCollect: boolean;
  runCliError: Error | null;
  state: OnboardingState;
}

function createFakeActions(log: FakeActionLog): OnboardingActions {
  return {
    async collectState() {
      log.calls.push("collectState");
      if (log.failCollect) throw new Error("collect boom");
      return log.state;
    },
    async runCliStep() {
      log.calls.push("runCliStep");
      if (log.runCliError) throw log.runCliError;
    },
    async runMcpStep() {
      log.calls.push("runMcpStep");
    },
    async chooseDataDir() {
      log.calls.push("chooseDataDir");
    },
    async reviewMigration() {
      log.calls.push("reviewMigration");
    },
    async openSettings() {
      log.calls.push("openSettings");
    },
    async cleanupLegacyMcp() {
      log.calls.push("cleanupLegacyMcp");
    },
    async finish(skipped, steps) {
      log.calls.push("finish");
      log.finishArgs.push({ skipped, steps });
    },
    async handleClosed() {
      log.calls.push("handleClosed");
      log.handleClosedCount += 1;
    },
  };
}

function setup() {
  createdWebviewPanels.length = 0;
  const log: FakeActionLog = {
    calls: [],
    finishArgs: [],
    handleClosedCount: 0,
    failCollect: false,
    runCliError: null,
    state: sampleState(),
  };
  const logLines: string[] = [];
  const panel = new OnboardingPanel({
    actions: createFakeActions(log),
    version: "0.2.0",
    log: (message) => logLines.push(message),
  });
  return { panel, log, logLines };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

type WireMessage = Record<string, unknown>;

function messages(fake: FakeWebviewPanel): WireMessage[] {
  return fake.webview.messages as WireMessage[];
}

function panelMessages(fake: FakeWebviewPanel, type: string): WireMessage[] {
  return messages(fake).filter((message) => message.type === type);
}

describe("OnboardingPanel singleton", () => {
  it("creates one panel, then only reveals and refreshes it", async () => {
    const { panel } = setup();
    panel.show("first-install");
    await tick();
    assert.equal(createdWebviewPanels.length, 1);
    const fake = createdWebviewPanels[0];
    assert.equal(fake.viewType, ONBOARDING_VIEW_TYPE);
    assert.equal(fake.title, ONBOARDING_TITLE);
    assert.equal(fake.options.enableScripts, true);
    assert.deepEqual(panel.snapshotForTest(), { open: true, reason: "first-install", creations: 1 });
    assert.equal(panelMessages(fake, "state").length, 1);

    panel.show("manual");
    await tick();
    assert.equal(createdWebviewPanels.length, 1, "show must not create a second panel");
    assert.ok(fake.revealCount >= 2);
    assert.equal(panel.snapshotForTest().reason, "manual");
    assert.equal(panelMessages(fake, "state").length, 2);
    panel.dispose();
  });

  it("disposing internally does not mark the guide as closed", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    panel.dispose();
    await tick();
    assert.equal(log.handleClosedCount, 0);
    assert.equal(panel.snapshotForTest().open, false);

    panel.show("manual");
    await tick();
    assert.equal(createdWebviewPanels.length, 2, "a fresh panel after dispose");
    panel.dispose();
  });

  it("treats a user close as 'seen' and applies the data defaults", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    createdWebviewPanels[0].dispose();
    await tick();
    assert.equal(log.handleClosedCount, 1);
    assert.equal(panel.snapshotForTest().open, false);
  });
});

describe("OnboardingPanel message dispatch", () => {
  it("refreshes on ready", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    const fake = createdWebviewPanels[0];
    messages(fake).length = 0;

    await panel.dispatch({ type: "ready" });
    assert.deepEqual(log.calls, ["collectState", "collectState"]);
    assert.equal(panelMessages(fake, "state").length, 1);
    panel.dispose();
  });

  it("runs each step action with a busy/refresh cycle", async () => {
    const cases: { message: WireMessage; call: string; step: string }[] = [
      { message: { type: "run", step: "cli" }, call: "runCliStep", step: "cli" },
      { message: { type: "run", step: "mcp" }, call: "runMcpStep", step: "mcp" },
      { message: { type: "chooseDataDir" }, call: "chooseDataDir", step: "data" },
      { message: { type: "reviewMigration" }, call: "reviewMigration", step: "data" },
      { message: { type: "cleanupLegacyMcp" }, call: "cleanupLegacyMcp", step: "mcp" },
    ];
    for (const entry of cases) {
      const { panel, log } = setup();
      panel.show("manual");
      await tick();
      const fake = createdWebviewPanels[0];
      messages(fake).length = 0;

      await panel.dispatch(entry.message);
      assert.ok(log.calls.includes(entry.call), `${entry.call} was not called`);
      const busy = panelMessages(fake, "busy");
      assert.deepEqual(
        busy.map((message) => [message.step, message.busy]),
        [
          [entry.step, true],
          [entry.step, false],
        ]
      );
      assert.equal(panelMessages(fake, "state").length, 1, "state refreshes after the action");
      panel.dispose();
    }
  });

  it("dispatches openSettings without a busy cycle", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    const fake = createdWebviewPanels[0];
    messages(fake).length = 0;

    await panel.dispatch({ type: "openSettings" });
    assert.ok(log.calls.includes("openSettings"));
    assert.deepEqual(messages(fake), []);
    panel.dispose();
  });

  it("finish passes the checked steps and closes without a close-handler callback", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();

    await panel.dispatch({ type: "finish", skipped: false, steps: { cli: true, mcp: false } });
    assert.deepEqual(log.finishArgs, [{ skipped: false, steps: { cli: true, mcp: false } }]);
    assert.equal(panel.snapshotForTest().open, false);
    assert.equal(log.handleClosedCount, 0, "finish must not also apply the close defaults");
  });

  it("parses malformed finish payloads to the safe defaults", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    await panel.dispatch({ type: "finish", skipped: "yes", steps: { cli: "yes" } });
    assert.deepEqual(log.finishArgs, [{ skipped: false, steps: { cli: false, mcp: false } }]);

    const second = setup();
    second.panel.show("manual");
    await tick();
    await second.panel.dispatch({ type: "finish" });
    assert.deepEqual(second.log.finishArgs, [{ skipped: false, steps: { cli: true, mcp: false } }]);
  });

  it("posts an accessible error notice when the state cannot be read", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    const fake = createdWebviewPanels[0];
    messages(fake).length = 0;
    log.failCollect = true;
    await panel.dispatch({ type: "ready" });
    const notices = panelMessages(fake, "notice");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].level, "error");
    assert.match(String(notices[0].message), /could not read setup state: collect boom/);
    panel.dispose();
  });

  it("ignores malformed or unknown messages", async () => {
    const { panel, log } = setup();
    panel.show("manual");
    await tick();
    await panel.dispatch(null);
    await panel.dispatch("nope");
    await panel.dispatch({ type: "unknown" });
    // A run message without a declared step must never start an install.
    await panel.dispatch({ type: "run" });
    await panel.dispatch({ type: "run", step: "bogus" });
    assert.deepEqual(log.calls, ["collectState"]);
    panel.dispose();
  });

  it("logs and releases the busy state when an action rejects", async () => {
    const { panel, log, logLines } = setup();
    panel.show("manual");
    await tick();
    const fake = createdWebviewPanels[0];
    messages(fake).length = 0;
    log.runCliError = new Error("cli boom");

    fake.fireMessage({ type: "run", step: "cli" });
    await tick();
    assert.ok(logLines.some((line) => /onboarding: message failed: cli boom/.test(line)));
    assert.deepEqual(
      panelMessages(fake, "busy").map((message) => message.busy),
      [true, false]
    );
    panel.dispose();
  });
});