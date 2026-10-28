import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CliDeps } from "../../cli/flow";
import type { CliUi } from "../../cli/registry";
import {
  createIngestBatch,
  fetchIngestLimits,
  listIngestJobs,
  planFileSelection,
  postIngestFile,
  startIngestBatch,
  type IngestJobSummary,
} from "../../ingest";
import type { SkillsDeps, SkillsUi } from "../../mcp/flow";
import type { VaultScope, VaultsDeps, VaultsUi } from "../../vaults/flow";
import type { VaultListState } from "../../vaults/vaults";

interface HyseedApi {
  provideMcpServerDefinitions(extensionPath: string): Promise<vscode.McpServerDefinition[]>;
  installSkillsFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void>;
  removeSkillsFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void>;
  showSkillsStateFlow(ui: SkillsUi, deps: SkillsDeps): Promise<void>;
  createSkillsDeps(options?: { env?: NodeJS.ProcessEnv; cwd?: string }): SkillsDeps;
  createVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void>;
  switchVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void>;
  clearProjectVaultFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void>;
  listVaultsFlow(ui: VaultsUi, deps: VaultsDeps): Promise<void>;
  createVaultsDeps(options?: { env?: NodeJS.ProcessEnv; cwd?: string }): VaultsDeps;
  runCliCommand(id: string, ui: CliUi, deps: CliDeps): Promise<void>;
  cliCommandIds: readonly string[];
  createCliDeps(options?: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    sendToTerminal?: (lines: string[]) => void;
  }): CliDeps;
}

const COMMAND_IDS = [
  "kbmcp.openAdmin",
  "kbmcp.startServer",
  "kbmcp.stopServer",
  "kbmcp.restartServer",
  "kbmcp.openInBrowser",
  "kbmcp.showRuntimeInfo",
  "kbmcp.showLogs",
  "kbmcp.showMcpStatus",
  "kbmcp.installAgentSkills",
  "kbmcp.removeAgentSkills",
  "kbmcp.showSkillsState",
  "kbmcp.createVault",
  "kbmcp.switchVault",
  "kbmcp.clearProjectVault",
  "kbmcp.listVaults",
  "kbmcp.cli.search",
  "kbmcp.cli.get",
  "kbmcp.cli.list",
  "kbmcp.cli.add",
  "kbmcp.cli.ingest",
  "kbmcp.cli.import",
  "kbmcp.cli.export",
  "kbmcp.cli.doctor",
  "kbmcp.cli.stats",
  "kbmcp.cli.reindex",
  "kbmcp.cli.diff-check",
  "kbmcp.cli.history",
  "kbmcp.cli.vaultList",
  "kbmcp.cli.vaultCreate",
  "kbmcp.cli.vaultSwitch",
  "kbmcp.cli.vaultStatus",
  "kbmcp.cli.skillsList",
  "kbmcp.cli.skillsShow",
  "kbmcp.cli.skillsAdd",
  "kbmcp.cli.skillsRemove",
  "kbmcp.cli.serveHttp",
];

interface SkillsUiRecord {
  confirms: { title: string; detail?: string }[];
  errors: string[];
  notes: string[];
  details: { title: string; lines: string[] }[];
}

function scriptedUi(script: {
  hosts?: string[];
  scope?: "global" | "project";
  confirms?: boolean[];
}): { ui: SkillsUi; record: SkillsUiRecord } {
  const record: SkillsUiRecord = { confirms: [], errors: [], notes: [], details: [] };
  let index = 0;
  const ui: SkillsUi = {
    async pickHosts() {
      return script.hosts;
    },
    async pickScope() {
      return script.scope;
    },
    async confirm(title, detail) {
      record.confirms.push({ title, detail });
      const value = script.confirms?.[index] ?? true;
      index += 1;
      return value;
    },
    notify(message) {
      record.notes.push(message);
    },
    error(message) {
      record.errors.push(message);
    },
    showDetails(title, lines) {
      record.details.push({ title, lines });
    },
  };
  return { ui, record };
}

interface VaultUiRecord {
  errors: string[];
  notes: string[];
  shown: { state: VaultListState; pinned: string | null }[];
  pinned: (string | null)[];
}

function scriptedVaultUi(script: {
  scope?: VaultScope | "cancel";
  names?: (string | "__default__" | undefined)[];
  confirms?: boolean[];
  pick?: string;
}): { ui: VaultsUi; record: VaultUiRecord } {
  const record: VaultUiRecord = { errors: [], notes: [], shown: [], pinned: [] };
  let confirmIndex = 0;
  const ui: VaultsUi = {
    async pickScope() {
      return script.scope === "cancel" ? undefined : script.scope;
    },
    async inputName(defaultValue) {
      const next = script.names?.shift();
      if (next === undefined) return undefined;
      return next === "__default__" ? defaultValue : next;
    },
    async confirm() {
      const value = script.confirms?.[confirmIndex] ?? true;
      confirmIndex += 1;
      return value;
    },
    async pickVault(_state, pinned) {
      record.pinned.push(pinned);
      return script.pick;
    },
    async showVaults(state, pinned) {
      record.shown.push({ state, pinned });
    },
    notify(message) {
      record.notes.push(message);
    },
    error(message) {
      record.errors.push(message);
    },
  };
  return { ui, record };
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFilesRecursive(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

function backupsIn(dir: string, prefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.includes(".bak-"))
    .sort();
}

interface CliAnswers {
  inputs?: (string | undefined)[];
  folders?: (string | undefined)[];
  files?: (string | undefined)[];
  picks?: (string | undefined)[];
  many?: (string[] | undefined)[];
  confirms?: boolean[];
}

interface CliUiRecord {
  errors: string[];
  pickTitles: string[];
}

function scriptedCliUi(answers: CliAnswers): { ui: CliUi; record: CliUiRecord } {
  const record: CliUiRecord = { errors: [], pickTitles: [] };
  let confirmIndex = 0;
  const ui: CliUi = {
    async input() {
      return answers.inputs?.shift();
    },
    async pickFolder() {
      return answers.folders?.shift();
    },
    async pickFile() {
      return answers.files?.shift();
    },
    async pickOne(title) {
      record.pickTitles.push(title);
      return answers.picks?.shift();
    },
    async pickMany(title) {
      record.pickTitles.push(title);
      return answers.many?.shift();
    },
    async confirm() {
      const value = answers.confirms?.[confirmIndex] ?? false;
      confirmIndex += 1;
      return value;
    },
    error(message) {
      record.errors.push(message);
    },
  };
  return { ui, record };
}

/** Independent of src/cli/quote.ts on purpose: only space-quoting is needed for these args. */
function expectedCliLine(exe: string, args: string[]): string {
  return `"${exe}" ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`;
}

function withTimeout<T>(promise: Thenable<T> | Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ]);
}

function httpGet(port: number, pathName = "/"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathName, timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error("could not allocate a free port")));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export async function run(): Promise<void> {
  await Promise.race([
    body(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("integration test timed out after 240s")), 240_000)
    ),
  ]);
}

async function body(): Promise<void> {
  console.log("[it] locating extension");
  const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === "kbmcp-vscode");
  assert.ok(extension, "kbmcp-vscode extension not found in the test host");
  const api = (await withTimeout(
    extension.activate(),
    60_000,
    "extension activation"
  )) as unknown as HyseedApi;
  assert.ok(typeof api.provideMcpServerDefinitions === "function", "extension exports are missing");
  console.log("[it] extension activated");

  const commands = await withTimeout(vscode.commands.getCommands(true), 10_000, "getCommands");
  for (const id of COMMAND_IDS) {
    assert.ok(commands.includes(id), `missing command ${id}`);
  }
  console.log("[it] commands registered");

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-vscode-it-"));
  const port = await freePort();
  console.log(`[it] sandbox=${sandbox} port=${port}`);
  const config = vscode.workspace.getConfiguration("kbMcp");
  try {
    await withTimeout(config.update("dataRoot", sandbox, vscode.ConfigurationTarget.Global), 10_000, "update dataRoot");
    await withTimeout(config.update("adminPort", port, vscode.ConfigurationTarget.Global), 10_000, "update adminPort");
    const written = vscode.workspace.getConfiguration("kbMcp");
    assert.equal(written.get("dataRoot"), sandbox, "dataRoot setting did not round-trip");
    assert.equal(written.get("adminPort"), port, "adminPort setting did not round-trip");
    console.log("[it] settings written and verified");

    let runtimeExe = "";
    console.log("[it] provider definitions");
    const definitions = await withTimeout(
      api.provideMcpServerDefinitions(extension.extensionPath),
      30_000,
      "provideMcpServerDefinitions"
    );
    assert.equal(definitions.length, 1, "expected exactly one MCP definition");
    const definition = definitions[0] as vscode.McpStdioServerDefinition;
    assert.equal(definition.label, "hyseed");
    assert.deepEqual(definition.args, ["serve"]);
    assert.ok(fs.existsSync(definition.command), `definition command missing: ${definition.command}`);
    runtimeExe = definition.command;
    const providerEnv = definition.env ?? {};
    assert.equal(providerEnv.KB_MCP_HOME, sandbox);
    assert.equal(providerEnv.KB_MCP_VAULT, undefined);

    const liveConfig = vscode.workspace.getConfiguration("kbMcp");
    await withTimeout(
      liveConfig.update("projectVault", "demo", vscode.ConfigurationTarget.Global),
      10_000,
      "update projectVault"
    );
    assert.equal(
      vscode.workspace.getConfiguration("kbMcp").get("projectVault"),
      "demo",
      "projectVault did not round-trip"
    );
    const pinned = await withTimeout(
      api.provideMcpServerDefinitions(extension.extensionPath),
      30_000,
      "provideMcpServerDefinitions (pinned)"
    );
    assert.equal(((pinned[0] as vscode.McpStdioServerDefinition).env ?? {}).KB_MCP_VAULT, "demo");
    await withTimeout(
      liveConfig.update("projectVault", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset projectVault"
    );
    await withTimeout(
      liveConfig.update("runtimePath", runtimeExe, vscode.ConfigurationTarget.Global),
      10_000,
      "pin runtimePath"
    );
    console.log("[it] provider definitions verified");

    await withTimeout(vscode.commands.executeCommand("kbmcp.startServer"), 90_000, "kbmcp.startServer");
    console.log("[it] startServer returned");

    let page: { status: number; body: string } | undefined;
    await waitFor(
      async () => {
        page = await httpGet(port);
        return page.status === 200 && page.body.includes("HySeed");
      },
      45_000,
      `admin console on port ${port}`
    );
    assert.ok(page, "admin console page was never fetched");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("HySeed"));
    const sandboxEntries = fs.readdirSync(sandbox);
    console.log(`[it] sandbox entries: ${sandboxEntries.join(", ")}`);
    assert.ok(
      sandboxEntries.includes("vaults.json"),
      "server did not initialize the sandbox vault registry"
    );
    console.log("[it] admin console answered from the sandbox data root");

    await withTimeout(vscode.commands.executeCommand("kbmcp.openAdmin"), 90_000, "kbmcp.openAdmin");
    await waitFor(
      async () =>
        vscode.window.tabGroups.all.some((group) =>
          group.tabs.some((tab) => tab.label === "hyseed admin")
        ),
      15_000,
      "admin panel tab"
    );
    console.log("[it] admin panel open");

    await withTimeout(vscode.commands.executeCommand("kbmcp.stopServer"), 60_000, "kbmcp.stopServer");
    console.log("[it] stopServer returned");
    await waitFor(
      async () => {
        try {
          await httpGet(port);
          return false;
        } catch {
          return true;
        }
      },
      15_000,
      "port release after stop"
    );
    console.log("[it] port released");

    await withTimeout(vscode.commands.executeCommand("kbmcp.startServer"), 90_000, "kbmcp.startServer (second)");
    await waitFor(
      async () => {
        try {
          const again = await httpGet(port);
          return again.status === 200 && again.body.includes("HySeed");
        } catch {
          return false;
        }
      },
      45_000,
      "admin console after second start"
    );
    console.log("[it] second start answered");

    console.log("[it] ingest upload leg");
    const uploadDir = path.join(sandbox, "upload-in");
    fs.mkdirSync(uploadDir, { recursive: true });
    const uploadFile = path.join(uploadDir, "integration-note.md");
    fs.writeFileSync(uploadFile, "# Integration note\n\nhyseed upload leg.\n");
    const ingestLimits = await withTimeout(fetchIngestLimits(port), 10_000, "ingest limits");
    const ingestPlan = await withTimeout(
      planFileSelection([uploadFile], ingestLimits),
      10_000,
      "plan file upload"
    );
    assert.equal(ingestPlan.files.length, 1, "upload plan should hold one file");
    const ingestBatch = await withTimeout(
      createIngestBatch(port, "default"),
      10_000,
      "create ingest batch"
    );
    const staged = await withTimeout(
      postIngestFile(port, ingestBatch.batch_id, ingestPlan.files[0], "upload"),
      30_000,
      "upload ingest file"
    );
    assert.equal(staged.ok, true, "server rejected the markdown upload");
    const ingestStart = await withTimeout(
      startIngestBatch(port, ingestBatch.batch_id),
      10_000,
      "start ingest batch"
    );
    let ingestJob: IngestJobSummary | undefined;
    await waitFor(
      async () => {
        const jobs = await listIngestJobs(port);
        ingestJob = jobs.find((candidate) => candidate.job_id === ingestStart.job_id);
        return ingestJob !== undefined && (ingestJob.state === "done" || ingestJob.state === "failed");
      },
      30_000,
      "ingest job terminal state"
    );
    assert.ok(ingestJob, "ingest job was not listed by /api/ingest/jobs");
    assert.equal(ingestJob!.state, "done", `ingest job failed: ${ingestJob!.error ?? ""}`);
    assert.equal(ingestJob!.counts.uploaded, 1);
    assert.equal(ingestJob!.counts.converted + ingestJob!.counts.skipped, 1);
    console.log("[it] ingest upload reached done with uploaded=1");

    console.log("[it] vault flows");
    const vaultWorkspace = path.join(sandbox, "vault-workspace");
    fs.mkdirSync(vaultWorkspace, { recursive: true });
    const vaultsDeps = api.createVaultsDeps({ cwd: vaultWorkspace });
    const registryPath = path.join(sandbox, "vaults.json");
    const registry = (): { current: string; vaults: { name: string }[] } =>
      JSON.parse(fs.readFileSync(registryPath, "utf8"));
    assert.equal(registry().current, "default", "fresh sandbox should start on the default vault");

    const globalCreate = scriptedVaultUi({
      scope: "global",
      names: ["it-global"],
      confirms: [true, true],
    });
    await withTimeout(api.createVaultFlow(globalCreate.ui, vaultsDeps), 120_000, "createVaultFlow (global)");
    assert.deepEqual(globalCreate.record.errors, []);
    assert.equal(registry().current, "it-global");
    assert.ok(fs.existsSync(path.join(sandbox, "it-global")), "global vault directory missing");
    console.log("[it] global vault created and switched");

    const duplicate = scriptedVaultUi({
      scope: "global",
      names: ["default"],
      confirms: [true, false],
    });
    await withTimeout(api.createVaultFlow(duplicate.ui, vaultsDeps), 120_000, "createVaultFlow (duplicate)");
    assert.ok(
      duplicate.record.errors.some((message) => /already exists/.test(message)),
      "duplicate create did not surface the CLI error"
    );
    assert.equal(registry().current, "it-global");
    console.log("[it] duplicate create surfaced and left current alone");

    const invalid = scriptedVaultUi({ scope: "global", names: ["bad/name"] });
    await withTimeout(api.createVaultFlow(invalid.ui, vaultsDeps), 120_000, "createVaultFlow (invalid)");
    assert.match(invalid.record.errors[0] ?? "", /must not contain/);
    console.log("[it] invalid name refused before spawning");

    const noEntry = scriptedVaultUi({
      scope: "project",
      names: ["vault-workspace"],
      confirms: [true],
    });
    await withTimeout(api.createVaultFlow(noEntry.ui, vaultsDeps), 120_000, "createVaultFlow (project, no entry)");
    assert.deepEqual(noEntry.record.errors, []);
    assert.match(noEntry.record.notes.at(-1) ?? "", /Install agent skills/);
    const settingsPath = path.join(vaultWorkspace, ".vscode", "settings.json");
    assert.equal(
      JSON.parse(fs.readFileSync(settingsPath, "utf8")).kbMcp.projectVault,
      "vault-workspace",
      "project pin was not written"
    );
    assert.equal(registry().current, "it-global", "project create must not change current");
    const mcpPath = path.join(vaultWorkspace, ".mcp.json");
    assert.ok(!fs.existsSync(mcpPath), "flow must not create .mcp.json");
    console.log("[it] project vault pinned without an MCP entry");

    const mcpSeed = {
      mcpServers: {
        hyseed: { type: "stdio", command: runtimeExe, args: ["serve"], env: { KB_MCP_HOME: sandbox } },
        other: { command: "keep.exe" },
      },
      custom: { keep: true },
    };
    fs.writeFileSync(mcpPath, JSON.stringify(mcpSeed, null, 2));
    const mcpBefore = fs.readFileSync(mcpPath, "utf8");

    const merged = scriptedVaultUi({
      scope: "project",
      names: ["it-project"],
      confirms: [true],
    });
    await withTimeout(api.createVaultFlow(merged.ui, vaultsDeps), 120_000, "createVaultFlow (project, merge)");
    assert.deepEqual(merged.record.errors, []);
    const mcpAfter = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.equal(mcpAfter.mcpServers.hyseed.env.KB_MCP_VAULT, "it-project");
    assert.deepEqual(mcpAfter.mcpServers.other, { command: "keep.exe" });
    assert.deepEqual(mcpAfter.custom, { keep: true });
    const mcpBackups = fs.readdirSync(vaultWorkspace).filter((name) => name.startsWith(".mcp.json.bak-"));
    assert.equal(mcpBackups.length, 1, "expected exactly one .mcp.json backup");
    assert.equal(fs.readFileSync(path.join(vaultWorkspace, mcpBackups[0]), "utf8"), mcpBefore);
    assert.equal(
      JSON.parse(fs.readFileSync(settingsPath, "utf8")).kbMcp.projectVault,
      "it-project",
      "pin was not updated to the merged vault"
    );
    assert.equal(registry().current, "it-global", "project merge must not change current");
    console.log("[it] project vault merged its MCP entry env with a backup");

    const switched = scriptedVaultUi({ pick: "default" });
    await withTimeout(api.switchVaultFlow(switched.ui, vaultsDeps), 120_000, "switchVaultFlow");
    assert.deepEqual(switched.record.errors, []);
    assert.equal(registry().current, "default");
    assert.match(switched.record.notes[0] ?? "", /is now current/);
    console.log("[it] switch flow verified against the text listing");

    const apiVaults = await withTimeout(
      httpGet(port, "/api/vaults"),
      10_000,
      "GET /api/vaults"
    );
    assert.equal(apiVaults.status, 200);
    const apiState = JSON.parse(apiVaults.body) as {
      current: string;
      vaults: { name: string }[];
    };
    assert.equal(apiState.current, "default");
    const names = apiState.vaults.map((vault) => vault.name);
    for (const expected of ["default", "it-global", "vault-workspace", "it-project"]) {
      assert.ok(names.includes(expected), `admin /api/vaults is missing ${expected}`);
    }
    console.log("[it] admin /api/vaults sees the new vaults");

    const cleared = scriptedVaultUi({ confirms: [true] });
    await withTimeout(
      api.clearProjectVaultFlow(cleared.ui, vaultsDeps),
      120_000,
      "clearProjectVaultFlow"
    );
    assert.deepEqual(cleared.record.errors, []);
    const settingsAfterClear = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(settingsAfterClear.kbMcp?.projectVault, undefined);
    const mcpCleared = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    assert.equal("KB_MCP_VAULT" in mcpCleared.mcpServers.hyseed.env, false);
    assert.equal(mcpCleared.mcpServers.hyseed.env.KB_MCP_HOME, sandbox);
    assert.deepEqual(mcpCleared.mcpServers.other, { command: "keep.exe" });
    assert.deepEqual(mcpCleared.custom, { keep: true });
    assert.match(cleared.record.notes.at(-1) ?? "", /pin cleared/);
    console.log("[it] project pin cleared round-trip");

    const listed = scriptedVaultUi({});
    await withTimeout(api.listVaultsFlow(listed.ui, vaultsDeps), 120_000, "listVaultsFlow");
    assert.equal(listed.record.shown.length, 1);
    assert.ok(listed.record.shown[0].state.vaults.some((vault) => vault.name === "it-global"));
    assert.equal(listed.record.shown[0].pinned, null);
    console.log("[it] list flow rendered");

    console.log("[it] cli palette");
    const cliConverter = path.join(sandbox, "doc-convert-it.exe");
    await withTimeout(
      config.update("converterPath", cliConverter, vscode.ConfigurationTarget.Global),
      10_000,
      "pin converterPath"
    );
    const cliHome = path.join(sandbox, "cli-home");
    fs.mkdirSync(cliHome, { recursive: true });
    const cliToken = "cli-it-token-0123456789abcdef";
    fs.writeFileSync(path.join(cliHome, ".hyseed-http-token"), `${cliToken}\r\n`);
    const cliEnv = { ...process.env, USERPROFILE: cliHome, HOME: cliHome };
    const cliIn = path.join(sandbox, "cli-in");
    const cliOut = path.join(sandbox, "cli-out");
    let cliSent: string[][] = [];
    const cliDeps = api.createCliDeps({
      env: cliEnv,
      cwd: vaultWorkspace,
      sendToTerminal: (lines) => cliSent.push(lines),
    });
    const resolveOnce = cliDeps.resolveExe;
    let resolved: Promise<string> | null = null;
    cliDeps.resolveExe = () => (resolved ??= resolveOnce());

    const cliCases: { id: string; answers: CliAnswers; args: string[] }[] = [
      { id: "kbmcp.cli.search", answers: { inputs: ["hello world"] }, args: ["search", "hello world"] },
      { id: "kbmcp.cli.get", answers: { inputs: ["doc-1"] }, args: ["get", "doc-1"] },
      { id: "kbmcp.cli.list", answers: {}, args: ["list"] },
      {
        id: "kbmcp.cli.add",
        answers: { inputs: ["note", "Title", "body"] },
        args: ["add", "--type", "note", "--title", "Title", "--body", "body"],
      },
      {
        id: "kbmcp.cli.ingest",
        answers: { picks: ["Folder"], folders: [cliIn, cliOut] },
        args: ["ingest", cliIn, "--out", cliOut, "--converter", cliConverter],
      },
      { id: "kbmcp.cli.import", answers: { folders: [cliIn] }, args: ["import", cliIn] },
      { id: "kbmcp.cli.export", answers: { folders: [cliOut] }, args: ["export", cliOut] },
      { id: "kbmcp.cli.doctor", answers: {}, args: ["doctor"] },
      { id: "kbmcp.cli.stats", answers: {}, args: ["stats"] },
      { id: "kbmcp.cli.reindex", answers: { confirms: [true] }, args: ["reindex"] },
      { id: "kbmcp.cli.diff-check", answers: {}, args: ["diff-check"] },
      { id: "kbmcp.cli.history", answers: { inputs: ["doc-1"] }, args: ["history", "doc-1"] },
      { id: "kbmcp.cli.vaultList", answers: {}, args: ["vault", "list"] },
      {
        id: "kbmcp.cli.vaultCreate",
        answers: { inputs: ["cli-it-vault"] },
        args: ["vault", "create", "cli-it-vault"],
      },
      {
        id: "kbmcp.cli.vaultSwitch",
        answers: { picks: ["default"] },
        args: ["vault", "switch", "default"],
      },
      { id: "kbmcp.cli.vaultStatus", answers: {}, args: ["vault", "status"] },
      { id: "kbmcp.cli.skillsList", answers: {}, args: ["skills", "list"] },
      {
        id: "kbmcp.cli.skillsShow",
        answers: { picks: ["hyseed"] },
        args: ["skills", "show", "hyseed"],
      },
      {
        id: "kbmcp.cli.skillsAdd",
        answers: { many: [["claude"]], picks: ["global"] },
        args: ["skills", "add", "--agent", "claude", "--scope", "global"],
      },
      {
        id: "kbmcp.cli.skillsRemove",
        answers: { many: [["claude"]], picks: ["global"], confirms: [true] },
        args: ["skills", "remove", "--agent", "claude", "--scope", "global"],
      },
    ];
    for (const cliCase of cliCases) {
      const scripted = scriptedCliUi(cliCase.answers);
      cliSent = [];
      await withTimeout(
        api.runCliCommand(cliCase.id, scripted.ui, cliDeps),
        60_000,
        `runCliCommand ${cliCase.id}`
      );
      assert.deepEqual(scripted.record.errors, [], cliCase.id);
      assert.equal(cliSent.length, 1, cliCase.id);
      const lines = cliSent[0];
      assert.equal(lines.at(-1), "echo [hyseed exit=%errorlevel%]", cliCase.id);
      assert.equal(lines.at(-2), expectedCliLine(runtimeExe, cliCase.args), cliCase.id);
      assert.equal(lines.at(0), `set "KB_MCP_HOME=${sandbox}"`, cliCase.id);
    }
    console.log("[it] cli palette forms sent for 20 commands");

    const serve = scriptedCliUi({ inputs: ["8123"], confirms: [true] });
    cliSent = [];
    await withTimeout(
      api.runCliCommand("kbmcp.cli.serveHttp", serve.ui, cliDeps),
      60_000,
      "runCliCommand serveHttp"
    );
    assert.deepEqual(serve.record.errors, []);
    const serveLines = cliSent[0];
    assert.equal(serveLines[0], `set "KB_MCP_HOME=${sandbox}"`);
    assert.equal(
      serveLines[1],
      `set /p KB_MCP_HTTP_TOKEN=<"${path.join(cliHome, ".hyseed-http-token")}"`
    );
    assert.equal(
      serveLines[2],
      expectedCliLine(runtimeExe, ["serve", "--transport", "http", "--port", "8123"])
    );
    assert.equal(serveLines[3], "echo [hyseed exit=%errorlevel%]");
    assert.ok(serveLines.every((line) => !line.includes(cliToken)));
    console.log("[it] cli serve reads the token from its file, not the command line");

    const generatedHome = path.join(sandbox, "cli-token-home");
    fs.mkdirSync(generatedHome, { recursive: true });
    const generatedSent: string[][] = [];
    const generatedDeps = api.createCliDeps({
      env: { ...process.env, USERPROFILE: generatedHome, HOME: generatedHome },
      cwd: vaultWorkspace,
      sendToTerminal: (lines) => generatedSent.push(lines),
    });
    const generatedUi = scriptedCliUi({ inputs: ["8001"], confirms: [true, true] });
    await withTimeout(
      api.runCliCommand("kbmcp.cli.serveHttp", generatedUi.ui, generatedDeps),
      60_000,
      "runCliCommand serveHttp (generate)"
    );
    assert.deepEqual(generatedUi.record.errors, []);
    const generatedTokenFile = path.join(generatedHome, ".hyseed-http-token");
    assert.ok(fs.existsSync(generatedTokenFile), "token file was not generated");
    const generatedToken = fs.readFileSync(generatedTokenFile, "utf8").trim();
    assert.match(generatedToken, /^[0-9a-f]{32}$/);
    assert.ok(generatedSent[0].includes(`set /p KB_MCP_HTTP_TOKEN=<"${generatedTokenFile}"`));
    assert.ok(generatedSent[0].every((line) => !line.includes(generatedToken)));
    console.log("[it] cli token generated into the sandbox home, never on the command line");

    const unsafeUi = scriptedCliUi({ inputs: ["100%"] });
    const unsafeSent: string[][] = [];
    const unsafeDeps = api.createCliDeps({
      env: cliEnv,
      cwd: vaultWorkspace,
      sendToTerminal: (lines) => unsafeSent.push(lines),
    });
    await withTimeout(
      api.runCliCommand("kbmcp.cli.search", unsafeUi.ui, unsafeDeps),
      60_000,
      "runCliCommand unsafe"
    );
    assert.match(unsafeUi.record.errors[0] ?? "", /own terminal/);
    assert.deepEqual(unsafeSent, []);
    console.log("[it] cli unsafe input refused with guidance");

    console.log("[it] cli real terminal smoke");
    await withTimeout(vscode.commands.executeCommand("kbmcp.cli.stats"), 15_000, "cli stats");
    await waitFor(
      async () => vscode.window.terminals.some((terminal) => terminal.name === "hyseed"),
      15_000,
      "cli terminal"
    );
    for (const terminal of vscode.window.terminals.filter((item) => item.name === "hyseed")) {
      terminal.dispose();
    }
    await waitFor(
      async () => !vscode.window.terminals.some((terminal) => terminal.name === "hyseed"),
      15_000,
      "cli terminal closed"
    );
    console.log("[it] cli terminal created and disposed");

    await withTimeout(vscode.commands.executeCommand("kbmcp.stopServer"), 60_000, "kbmcp.stopServer (second)");
    await waitFor(
      async () => {
        try {
          await httpGet(port);
          return false;
        } catch {
          return true;
        }
      },
      15_000,
      "port release after second stop"
    );
    console.log("[it] second stop released port");

    // Activity bar panel: revealing the view container starts the admin server for
    // search. The panel itself must open the console in the Simple Browser instead.
    await withTimeout(
      vscode.commands.executeCommand("workbench.view.extension.kbmcp"),
      10_000,
      "open kbmcp activity view"
    );
    await waitFor(
      async () => {
        try {
          return (await httpGet(port)).status === 200;
        } catch {
          return false;
        }
      },
      90_000,
      "activity panel started the admin server"
    );
    const vaultRegistry = JSON.parse((await httpGet(port, "/api/vaults")).body) as {
      current: string;
      vaults: { name: string }[];
    };
    if (
      !vaultRegistry.current ||
      !Array.isArray(vaultRegistry.vaults) ||
      vaultRegistry.vaults.length === 0
    ) {
      throw new Error(
        `activity panel: unexpected vault registry ${JSON.stringify(vaultRegistry)}`
      );
    }
    console.log(`[it] activity panel started the admin server (vault=${vaultRegistry.current})`);
    await withTimeout(vscode.commands.executeCommand("kbmcp.stopServer"), 60_000, "stop launcher server");
    await waitFor(
      async () => {
        try {
          await httpGet(port);
          return false;
        } catch {
          return true;
        }
      },
      15_000,
      "port release after launcher stop"
    );
    console.log("[it] launcher server stopped");

    console.log("[it] skills sandbox");
    const skillsHome = path.join(sandbox, "host-home");
    const skillsProject = path.join(sandbox, "project");
    fs.mkdirSync(skillsHome, { recursive: true });
    fs.mkdirSync(skillsProject, { recursive: true });
    const claudeJsonPath = path.join(skillsHome, ".claude.json");
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify(
        { custom: { keep: true }, mcpServers: { other: { command: "keep.exe" } } },
        null,
        2
      )
    );
    const skillsEnv: NodeJS.ProcessEnv = {
      ...process.env,
      USERPROFILE: skillsHome,
      HOME: skillsHome,
    };
    for (const key of [
      "CLAUDE_CONFIG_DIR",
      "CODEX_HOME",
      "CLINE_DIR",
      "CLINE_DATA_DIR",
      "CLINE_MCP_SETTINGS_PATH",
    ]) {
      delete skillsEnv[key];
    }
    const skillsDeps = api.createSkillsDeps({ env: skillsEnv, cwd: skillsProject });

    const install = scriptedUi({ hosts: ["claude"], scope: "global" });
    await withTimeout(api.installSkillsFlow(install.ui, skillsDeps), 120_000, "installAgentSkills flow");
    assert.deepEqual(install.record.errors, []);
    assert.match(install.record.notes[0] ?? "", /installed/);

    const sourceSkills = path.resolve(
      extension.extensionPath,
      "..",
      "kbmcp",
      "src",
      "kb_mcp_lite",
      "skills_data"
    );
    const installedSkills = path.join(skillsHome, ".claude", "skills");
    const sourceFiles = listFilesRecursive(sourceSkills);
    assert.equal(sourceFiles.length, 8, "expected 8 bundled skill files");
    for (const relative of sourceFiles) {
      assert.equal(
        sha256File(path.join(installedSkills, relative)),
        sha256File(path.join(sourceSkills, relative)),
        `skill file differs: ${relative}`
      );
    }

    interface ClaudeConfig {
      custom?: unknown;
      mcpServers: Record<
        string,
        { type?: string; command?: string; args?: string[]; env?: Record<string, string> }
      >;
    }
    const entryOf = (): ClaudeConfig =>
      JSON.parse(fs.readFileSync(claudeJsonPath, "utf8")) as ClaudeConfig;
    const installedEntry = entryOf().mcpServers.hyseed;
    assert.equal(installedEntry.type, "stdio");
    assert.equal(installedEntry.command, runtimeExe);
    assert.deepEqual(installedEntry.args, ["serve"]);
    assert.equal(installedEntry.env?.KB_MCP_HOME, sandbox);
    assert.deepEqual(entryOf().mcpServers.other, { command: "keep.exe" });
    assert.deepEqual(entryOf().custom, { keep: true });
    console.log("[it] skills installed into the sandbox host home");

    const backupsBefore = backupsIn(skillsHome, ".claude.json");
    const again = scriptedUi({ hosts: ["claude"], scope: "global" });
    await withTimeout(api.installSkillsFlow(again.ui, skillsDeps), 120_000, "installAgentSkills flow (idempotent)");
    assert.deepEqual(again.record.errors, []);
    assert.deepEqual(backupsIn(skillsHome, ".claude.json"), backupsBefore);
    assert.equal(entryOf().mcpServers.hyseed.command, runtimeExe);
    console.log("[it] repeated install is idempotent");

    const tampered = entryOf();
    const tamperedEntry = { ...tampered.mcpServers.hyseed, args: ["tampered"] };
    tampered.mcpServers.hyseed = tamperedEntry;
    fs.writeFileSync(claudeJsonPath, JSON.stringify(tampered, null, 2));
    const forced = scriptedUi({ hosts: ["claude"], scope: "global" });
    await withTimeout(api.installSkillsFlow(forced.ui, skillsDeps), 120_000, "installAgentSkills flow (force)");
    assert.deepEqual(forced.record.errors, []);
    assert.match(forced.record.confirms[0]?.title ?? "", /conflict/);
    const backupsAfter = backupsIn(skillsHome, ".claude.json");
    assert.ok(backupsAfter.length > backupsBefore.length, "force did not create a backup");
    const newestBackup = path.join(skillsHome, backupsAfter[backupsAfter.length - 1]);
    const backedUpEntry = (
      JSON.parse(fs.readFileSync(newestBackup, "utf8")) as ClaudeConfig
    ).mcpServers.hyseed;
    assert.deepEqual(backedUpEntry, tamperedEntry, "backup does not hold the pre-force entry");
    assert.deepEqual(entryOf().mcpServers.hyseed.args, ["serve"]);
    console.log("[it] conflict forced through with a backup");

    const state = scriptedUi({});
    await withTimeout(api.showSkillsStateFlow(state.ui, skillsDeps), 120_000, "showSkillsState flow");
    assert.deepEqual(state.record.errors, []);
    assert.ok(
      state.record.details[0]?.lines.some((line) => line.startsWith("claude/global:")),
      "skills state did not include claude/global"
    );
    console.log("[it] skills state rendered");

    const removed = scriptedUi({ hosts: ["claude"], scope: "global" });
    await withTimeout(api.removeSkillsFlow(removed.ui, skillsDeps), 120_000, "removeAgentSkills flow");
    assert.deepEqual(removed.record.errors, []);
    assert.ok(!fs.existsSync(path.join(installedSkills, "hyseed")), "hyseed skill dir was not removed");
    assert.ok(
      !fs.existsSync(path.join(installedSkills, "hyseed-manage")),
      "hyseed-manage dir was not removed"
    );
    assert.equal(entryOf().mcpServers.hyseed, undefined);
    assert.deepEqual(entryOf().mcpServers.other, { command: "keep.exe" });
    console.log("[it] skills removed, foreign entries preserved");

    const foreign = entryOf();
    foreign.mcpServers.hyseed = { type: "stdio", command: "foreign.exe", args: [] };
    fs.writeFileSync(claudeJsonPath, JSON.stringify(foreign, null, 2));
    const refused = scriptedUi({ hosts: ["claude"], scope: "global" });
    await withTimeout(
      api.removeSkillsFlow(refused.ui, skillsDeps),
      120_000,
      "removeAgentSkills flow (foreign)"
    );
    assert.ok(refused.record.errors.length > 0, "remove of a foreign entry was not refused");
    assert.equal(entryOf().mcpServers.hyseed?.command, "foreign.exe");
    console.log("[it] foreign entry refusal verified");
  } finally {
    await withTimeout(
      config.update("dataRoot", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset dataRoot"
    ).catch(() => undefined);
    await withTimeout(
      config.update("adminPort", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset adminPort"
    ).catch(() => undefined);
    await withTimeout(
      config.update("runtimePath", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset runtimePath"
    ).catch(() => undefined);
    await withTimeout(
      config.update("converterPath", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset converterPath"
    ).catch(() => undefined);
    await withTimeout(
      config.update("projectVault", undefined, vscode.ConfigurationTarget.Global),
      10_000,
      "reset projectVault"
    ).catch(() => undefined);
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      console.warn(`[it] could not remove sandbox ${sandbox} (server may still hold it)`);
    }
  }
}