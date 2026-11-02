/**
 * Upgrade drill — fresh-install leg (AC-6, AC-7).
 *
 * Runs inside a real VS Code extension host started by
 * `scripts/run-integration.mjs` with `HYSEED_IT_ENTRY=.../drill.test.ts` and
 * `HYSEED_DRILL_HOME` pointing at the drill sandbox home. The host profile is
 * the sandbox, so the migration gate sees an empty profile: the guide must
 * auto-open as a first install, Finish must persist the data folder through
 * the runtime CLI, and the CLI install step must not run (test hook passes
 * cli:false). Nothing here touches the real profile.
 */
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { renderOnboardingHtml } from "../../onboarding/panel";
import { decideOnboarding, DEFAULT_STEPS } from "../../onboarding/state";

interface DrillApi {
  onboardingStateForTest(): {
    open: boolean;
    reason: string | null;
    creations: number;
    onboardedVersion: string | null;
  };
  finishOnboardingForTest(skipped: boolean): Promise<void>;
}

function withTimeout<T>(promise: Thenable<T> | Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ]);
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Top-level `data_dir:` of `~/.config/hyseed/config.yaml` (null when absent). */
function readConfigDataDir(home: string): string | null {
  const file = path.join(home, ".config", "hyseed", "config.yaml");
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^data_dir\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let raw = match[1];
    if (raw.length >= 2 && ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))) {
      raw = raw.slice(1, -1);
    }
    return raw || null;
  }
  return null;
}

function pathEqual(a: string, b: string): boolean {
  const norm = (value: string) =>
    path.resolve(value).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

export async function run(): Promise<void> {
  await Promise.race([
    body(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("drill integration test timed out after 180s")), 180_000)
    ),
  ]);
}

async function body(): Promise<void> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  assert.ok(home, "the drill host must run with HOME/USERPROFILE set");
  console.log(`[drill] host home=${home}`);

  const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === "kbmcp-vscode");
  assert.ok(extension, "kbmcp-vscode extension not found in the test host");
  const api = (await withTimeout(extension.activate(), 60_000, "extension activation")) as unknown as DrillApi;
  assert.equal(typeof api.onboardingStateForTest, "function", "onboarding test hooks are missing");
  console.log(`[drill] extension activated version=${extension.packageJSON.version}`);

  // AC-7: the version matrix is decided by `decideOnboarding` (pure).
  const matrix: [string, Parameters<typeof decideOnboarding>[0], boolean, string][] = [
    ["first install", { current: "0.2.0", onboarded: null, firstInstall: true }, true, "first-install"],
    ["no marker, no versionState", { current: "0.2.0", onboarded: null, firstInstall: false }, true, "major-upgrade"],
    ["0.1.4 -> 0.2.0", { current: "0.2.0", onboarded: "0.1.4", firstInstall: false }, true, "major-upgrade"],
    ["0.2.0 already seen", { current: "0.2.0", onboarded: "0.2.0", firstInstall: false }, false, "none"],
    ["0.2.0 -> 0.2.1 patch", { current: "0.2.1", onboarded: "0.2.0", firstInstall: false }, false, "none"],
  ];
  for (const [label, args, open, reason] of matrix) {
    assert.deepEqual(decideOnboarding(args), { open, reason }, `version matrix: ${label}`);
  }
  console.log(`[drill] version matrix cases=${matrix.length}`);

  // AC-6: three steps with the documented defaults.
  assert.deepEqual(DEFAULT_STEPS, { cli: true, mcp: false }, "CLI step is recommended, MCP step is opt-in");
  const html = renderOnboardingHtml({ nonce: "drill-nonce", version: extension.packageJSON.version });
  assert.match(html, /id="step-cli-enabled" checked/, "CLI step must render checked");
  assert.ok(!/id="step-mcp-enabled" checked/.test(html), "MCP step must render unchecked");
  for (const id of ["step-cli-title", "step-mcp-title", "step-data-title", "finish", "skip"]) {
    assert.ok(html.includes(`id="${id}"`), `setup guide is missing ${id}`);
  }
  console.log("[drill] guide html: three steps, cli checked, mcp unchecked");

  // Fresh profile: the gate settles empty, then the guide auto-opens.
  let guide = api.onboardingStateForTest();
  await waitFor(() => {
    guide = api.onboardingStateForTest();
    return guide.open;
  }, 10_000, "setup guide auto-open");
  assert.equal(guide.reason, "first-install", "an empty sandbox profile is a first install");
  assert.equal(guide.onboardedVersion, null, "nothing has marked the guide as seen yet");
  assert.ok(guide.creations >= 1, `unexpected guide creations: ${guide.creations}`);
  console.log(`[drill] guide auto-opened reason=${guide.reason} creations=${guide.creations}`);

  // Finish must not run the CLI install step (the hook passes cli:false).
  const exe = path.join(home, ".local", "bin", "hyseed.exe");
  assert.ok(fs.existsSync(exe), `drill runtime missing: ${exe}`);
  const exeBefore = sha256File(exe);

  await withTimeout(api.finishOnboardingForTest(false), 60_000, "finishOnboardingForTest");
  const finished = api.onboardingStateForTest();
  assert.equal(finished.open, false, "finish must close the guide");
  assert.equal(
    finished.onboardedVersion,
    String(extension.packageJSON.version),
    "finish must persist the onboarded version"
  );
  assert.equal(sha256File(exe), exeBefore, "Finish with cli:false must not replace the runtime executable");
  assert.ok(
    !fs.existsSync(path.join(home, ".local", "bin", "doc-convert.exe")),
    "Finish with cli:false must not install CLI tools into the host home"
  );
  assert.ok(
    !fs.existsSync(path.join(home, ".claude.json")) && !fs.existsSync(path.join(home, ".claude")),
    "Finish with mcp:false must not install agent skills into the host home"
  );
  console.log(`[drill] finished onboardedVersion=${finished.onboardedVersion}`);

  // Finish persists the effective root (`home set-data-dir`) and registers a
  // default vault, while leaving the root lazy (no kb.db required).
  const defaultRoot = path.join(home, ".local", "share", "hyseed");
  const configured = readConfigDataDir(home);
  assert.ok(configured, "Finish must write ~/.config/hyseed/config.yaml");
  assert.ok(pathEqual(configured, defaultRoot), `config data_dir=${configured}, expected ${defaultRoot}`);
  const registryFile = path.join(defaultRoot, "vaults.json");
  assert.ok(fs.existsSync(registryFile), `Finish must register a vault in ${registryFile}`);
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8")) as {
    vaults: { name: string }[];
    current: string;
  };
  assert.ok(
    registry.vaults.some((vault) => vault.name === "default"),
    `registry must contain 'default': ${JSON.stringify(registry.vaults)}`
  );
  console.log(`[drill] config data_dir=${configured} vaults=${registry.vaults.length} current=${registry.current}`);
}