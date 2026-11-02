#!/usr/bin/env node
/**
 * hyseed 0.2.0 upgrade drill.
 *
 * Builds one sandbox per scenario and proves that the four 0.1.x data layouts
 * migrate to the 0.2.0 root, that the retired locations disappear, that the
 * runtime config points at the new root, that a fresh install runs the setup
 * guide, and that the real profile is never touched (read-only fingerprint
 * before/after).
 *
 * Usage:
 *   node scripts/upgrade-drill.mjs                 # all scenarios
 *   node scripts/upgrade-drill.mjs --only=wal      # one or more (comma list)
 *
 * Exit codes:
 *   0  every selected scenario passed
 *   1  an assertion failed (sandboxes and evidence are kept)
 *   2  a fixture could not be built (missing release runtime / venv / build)
 *
 * The drill never writes to the real HOME: every child process runs with
 * HOME=USERPROFILE=<sandbox>/home, inherited KB_MCP_* overrides removed, and
 * the VS Code host gets sandbox profile/extension directories. The release
 * runtime (kbmcp-rt/hyseed.exe) is copied into each sandbox; the bundled
 * resources/hyseed.exe is never executed by the drill.
 */
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import {
  compareSnapshots,
  defaultDataRoot,
  inspectRoot,
  legacyDataRoot,
  makeSandbox,
  readConfigDataDir,
  resolveEqual,
  runProcess,
  seedLegacy,
  seedLegacyConfig,
  sha256File,
  snapshotRealHome,
  tail,
  vaultCounts,
} from "./drill/fixtures.mjs";

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const root = resolve(SELF_DIR, "..");
const repo = resolve(root, "..");
const EVIDENCE_DIR = join(root, "out", "drill", "evidence");
const RELEASE_EXE = join(repo, "kbmcp-rt", "hyseed.exe");
const BUNDLED_EXE = join(root, "resources", "hyseed.exe");
const VENV_PYTHON = join(repo, "kbmcp", ".venv", "Scripts", "python.exe");
const WAL_FIXTURE = join(root, "scripts", "drill", "wal_fixture.py");
const RUN_INTEGRATION = join(root, "scripts", "run-integration.mjs");
const DIST_EXTENSION = join(root, "dist", "extension.js");
const DRILL_TEST_ENTRY = join(root, "src", "test", "integration", "drill.test.ts");
const EXTENSION_ID = "limccn.kbmcp-vscode";
const EXTENSION_DATA_VERSION = "0.1.2";

// Recorded on 2026-10-30 from the 0.2.0 release build. Informational: the drill
// records the observed hash; freshness is proven by probing the runtime's
// `home` command group, not by comparing it with the bundled copy.
const RELEASE_EXE_SHA = "1eb2cfe1c02558d90fafc71bf87f48fa9b40d52199fec83f2a4722cf9ffe0f94";
const RELEASE_EXE_SIZE = 20_907_371;

const ALL_SCENARIOS = [
  "legacy-root",
  "extension-data",
  "path-exe-data",
  "legacy-config",
  "wal",
  "conflict",
  "fresh",
];

function usage() {
  console.log("usage: node scripts/upgrade-drill.mjs [--only=<scenario>[,<scenario>...]]");
  console.log(`scenarios: ${ALL_SCENARIOS.join(", ")}`);
}

function parseArgs(argv) {
  let only = null;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg.startsWith("--only=")) {
      only = arg
        .slice("--only=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      continue;
    }
    console.error(`[drill] unknown argument: ${arg}`);
    usage();
    process.exit(2);
  }
  if (only) {
    if (only.length === 0) {
      console.error("[drill] --only= selected no scenarios");
      usage();
      process.exit(2);
    }
    const unknown = only.filter((name) => !ALL_SCENARIOS.includes(name));
    if (unknown.length > 0) {
      console.error(`[drill] unknown scenario(s): ${unknown.join(", ")}`);
      usage();
      process.exit(2);
    }
  }
  return only ?? [...ALL_SCENARIOS];
}

const selected = parseArgs(process.argv.slice(2));
const partial = selected.length !== ALL_SCENARIOS.length;

const scenarioResults = [];
const globalRecord = { name: "global", checks: [], commands: [], error: null };
scenarioResults.push(globalRecord);
const failures = [];

function renderArg(arg) {
  return /[ \t"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function beginScenario(name) {
  const record = { name, checks: [], commands: [], error: null };
  scenarioResults.push(record);
  const cmd = (exe, args, env = process.env, options = {}) => {
    const result = runProcess(exe, args, {
      env,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
    });
    record.commands.push({
      command: [basename(exe), ...args.map(renderArg)].join(" "),
      ac: options.ac ?? null,
      rc: result.rc,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    });
    return result;
  };
  const check = (ac, assertion, ok, detail = "", counts = "") => {
    const entry = { ac, assertion, ok: Boolean(ok), detail, counts };
    record.checks.push(entry);
    if (!entry.ok) failures.push({ scenario: name, ...entry });
    return entry;
  };
  return { record, cmd, check };
}

function globalCheck(ac, assertion, ok, detail = "", counts = "") {
  const entry = { ac, assertion, ok: Boolean(ok), detail, counts };
  globalRecord.checks.push(entry);
  if (!entry.ok) failures.push({ scenario: "global", ...entry });
  return entry;
}

function logged(cmd) {
  return (exe, args, options = {}) => cmd(exe, args, options.env ?? process.env, options);
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function total(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function countsEqual(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    JSON.stringify(leftKeys) === JSON.stringify(rightKeys) &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function candidateAt(inspect, target) {
  const candidates = Array.isArray(inspect?.candidates) ? inspect.candidates : [];
  return candidates.find((candidate) => resolveEqual(candidate.path, target)) ?? null;
}

function pathTextEqual(value, target) {
  return typeof value === "string" && value.length > 0 && resolveEqual(value, target);
}

function registryHasDefault(dataRoot) {
  const file = join(dataRoot, "vaults.json");
  if (!existsSync(file)) return false;
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const vaults = Array.isArray(data) ? data : Array.isArray(data?.vaults) ? data.vaults : [];
    return vaults.some((vault) => vault?.name === "default");
  } catch {
    return false;
  }
}

function logLockedOrCorrupt(result) {
  const pattern = /database is locked|malformed|corrupt|disk I\/O error/i;
  return pattern.test(`${result.stdout}\n${result.stderr}`);
}

async function loadExtensionScan(ctx) {
  if (ctx.scan) return ctx.scan;
  const outfile = join(ctx.base, "_lib", "migration-scan.cjs");
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "src", "migration.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    logLevel: "silent",
  });
  globalRecord.commands.push({
    command: `esbuild src/migration.ts -> ${outfile}`,
    ac: "AC-2",
    rc: 0,
    stdout: "",
    stderr: "",
    durationMs: 0,
  });
  const mod = createRequire(import.meta.url)(outfile);
  if (typeof mod.scanExtensionDataDirs !== "function") {
    throw new Error("compiled src/migration.ts does not export scanExtensionDataDirs");
  }
  ctx.scan = mod.scanExtensionDataDirs;
  return ctx.scan;
}

async function loadOnboardingState(ctx) {
  if (ctx.onboarding) return ctx.onboarding;
  const outfile = join(ctx.base, "_lib", "onboarding-state.cjs");
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "src", "onboarding", "state.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  });
  globalRecord.commands.push({
    command: `esbuild src/onboarding/state.ts -> ${outfile}`,
    ac: "AC-7",
    rc: 0,
    stdout: "",
    stderr: "",
    durationMs: 0,
  });
  const mod = createRequire(import.meta.url)(outfile);
  if (typeof mod.decideOnboarding !== "function" || !mod.DEFAULT_STEPS) {
    throw new Error("compiled src/onboarding/state.ts is missing decideOnboarding/DEFAULT_STEPS");
  }
  ctx.onboarding = mod;
  return mod;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioLegacyRoot(ctx) {
  const { cmd, check } = beginScenario("legacy-root");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "legacy-root", ctx.exeSource);
  const legacy = legacyDataRoot(sb.home);
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] legacy-root sandbox=${sb.root}`);

  seedLegacy(
    sb.exe,
    legacy,
    {
      vaults: [
        { name: "default", docs: [{ title: "Legacy Default One" }, { title: "Legacy Default Two" }] },
        { name: "teaching", docs: [{ title: "Legacy Teaching One" }] },
      ],
      current: "default",
    },
    sb.env,
    run
  );
  const before = vaultCounts(sb.exe, legacy, sb.env, run);
  check(
    "AC-1",
    "fixture seeds 2 vaults / 3 documents under ~/.local/share/kb-mcp",
    before.names.length === 2 && total(before.counts) === 3,
    `vaults=${before.names.join(",")}`,
    JSON.stringify(before.counts)
  );

  const pre = inspectRoot(sb.exe, null, sb.env, run);
  check(
    "AC-1",
    "profile resolves the default root before migration (nothing pinned)",
    resolveEqual(pre.data_root.path, newRoot) && pre.data_root.source === "default",
    `path=${pre.data_root.path} source=${pre.data_root.source}`
  );
  check(
    "AC-1",
    "default root is not initialized before migration",
    pre.initialized === false,
    `initialized=${pre.initialized}`
  );
  const candidate = candidateAt(pre, legacy);
  check(
    "AC-1",
    "legacy root is offered as kind=legacy_home with the fixture document count",
    candidate?.kind === "legacy_home" && candidate?.documents === 3,
    `kind=${candidate?.kind} documents=${candidate?.documents} path=${candidate?.path}`,
    JSON.stringify(candidate ?? null)
  );

  const migrated = cmd(
    sb.exe,
    ["home", "migrate", "--from", legacy, "--to", newRoot, "--json"],
    sb.env
  );
  const report = parseJson(migrated);
  check(
    "AC-1",
    "home migrate exits 0",
    migrated.rc === 0 && report?.ok === true,
    `rc=${migrated.rc} mode=${report?.mode} warnings=${JSON.stringify(report?.warnings ?? null)}`,
    JSON.stringify({ vaults: report?.vaults, documents: report?.documents })
  );
  check(
    "AC-1",
    "same-volume migrate moved the tree and removed the source",
    report?.removed_source === true && !existsSync(legacy),
    `mode=${report?.mode} removed_source=${report?.removed_source} source_exists=${existsSync(legacy)}`
  );
  check("AC-1", "new root contains vaults.json", existsSync(join(newRoot, "vaults.json")), newRoot);

  const after = vaultCounts(sb.exe, newRoot, sb.env, run);
  check(
    "AC-1",
    "per-vault document counts are unchanged after migration",
    countsEqual(before.counts, after.counts),
    `before=${JSON.stringify(before.counts)} after=${JSON.stringify(after.counts)}`,
    JSON.stringify(after.counts)
  );

  const configured = readConfigDataDir(sb.home);
  check(
    "AC-1",
    "config.yaml data_dir points at the new root",
    pathTextEqual(configured, newRoot),
    `data_dir=${configured ?? "(missing)"} expected=${newRoot}`
  );

  const post = inspectRoot(sb.exe, null, sb.env, run);
  check(
    "AC-1",
    "inspect resolves the new root from config with every document",
    resolveEqual(post.data_root.path, newRoot) &&
      post.data_root.source === "config" &&
      post.documents === 3,
    `path=${post.data_root.path} source=${post.data_root.source} documents=${post.documents}`,
    JSON.stringify({ documents: post.documents, vaults: post.vaults })
  );
  return sb;
}

async function scenarioExtensionData(ctx) {
  const { cmd, check } = beginScenario("extension-data");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "extension-data", ctx.exeSource);
  const extDir = join(
    sb.home,
    ".vscode",
    "extensions",
    `${EXTENSION_ID}-${EXTENSION_DATA_VERSION}`,
    "resources",
    "data"
  );
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] extension-data sandbox=${sb.root}`);

  seedLegacy(
    sb.exe,
    extDir,
    {
      vaults: [
        { name: "default", docs: [{ title: "Ext Default One" }, { title: "Ext Default Two" }] },
        { name: "notes", docs: [{ title: "Ext Notes One" }] },
      ],
    },
    sb.env,
    run
  );
  const before = vaultCounts(sb.exe, extDir, sb.env, run);

  const scan = await loadExtensionScan(ctx);
  const found = scan({ home: sb.home });
  const hit = found.find((candidate) => resolveEqual(candidate.path, extDir));
  check(
    "AC-2",
    "extension layer finds resources/data (kind=extension_data, vaults=2)",
    hit?.kind === "extension_data" && hit?.vaults === 2,
    `found=${JSON.stringify(found)}`,
    JSON.stringify({ candidates: found.length, vaults: hit?.vaults ?? null })
  );

  const runtimeView = inspectRoot(sb.exe, null, sb.env, run);
  check(
    "AC-2",
    "runtime home inspect does not scan extension directories",
    candidateAt(runtimeView, extDir) === null,
    `runtime candidates=${JSON.stringify(runtimeView.candidates.map((candidate) => candidate.kind))}`,
    JSON.stringify({ candidates: runtimeView.candidates.length })
  );

  const migrated = cmd(sb.exe, ["home", "migrate", "--from", extDir, "--to", newRoot, "--json"], sb.env);
  const report = parseJson(migrated);
  check(
    "AC-2",
    "extension data migrates with home migrate",
    migrated.rc === 0 && report?.ok === true,
    `rc=${migrated.rc} mode=${report?.mode} warnings=${JSON.stringify(report?.warnings ?? null)}`,
    JSON.stringify({ vaults: report?.vaults, documents: report?.documents })
  );
  check(
    "AC-2",
    "extension data directory no longer exists after the move",
    !existsSync(extDir),
    `exists=${existsSync(extDir)}`
  );

  const after = vaultCounts(sb.exe, newRoot, sb.env, run);
  check(
    "AC-2",
    "document counts survive the extension-data migration",
    countsEqual(before.counts, after.counts),
    `before=${JSON.stringify(before.counts)} after=${JSON.stringify(after.counts)}`,
    JSON.stringify(after.counts)
  );
  check(
    "AC-2",
    "config.yaml data_dir points at the new root",
    pathTextEqual(readConfigDataDir(sb.home), newRoot),
    `data_dir=${readConfigDataDir(sb.home) ?? "(missing)"}`
  );
  return sb;
}

async function scenarioPathExeData(ctx) {
  const { cmd, check } = beginScenario("path-exe-data");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "path-exe-data", ctx.exeSource);
  const pathExeData = join(sb.home, ".local", "bin", "data");
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] path-exe-data sandbox=${sb.root}`);

  seedLegacy(
    sb.exe,
    pathExeData,
    {
      vaults: [
        { name: "default", docs: [{ title: "PathExe Default One" }] },
        { name: "guides", docs: [{ title: "PathExe Guide One" }, { title: "PathExe Guide Two" }] },
      ],
    },
    sb.env,
    run
  );
  const before = vaultCounts(sb.exe, pathExeData, sb.env, run);

  const pre = inspectRoot(sb.exe, null, sb.env, run);
  const candidate = candidateAt(pre, pathExeData);
  check(
    "AC-2",
    "~/.local/bin/data is detected as a rescue candidate",
    candidate !== null && (candidate.kind === "path_exe" || candidate.kind === "exe_dir"),
    `kind=${candidate?.kind ?? "(none)"} path=${candidate?.path} (the sandbox exe lives in ~/.local/bin, so path_exe and exe_dir coincide)`,
    JSON.stringify(candidate ?? null)
  );

  const migrated = cmd(sb.exe, ["home", "migrate", "--from", pathExeData, "--to", newRoot, "--json"], sb.env);
  const report = parseJson(migrated);
  check(
    "AC-2",
    "PATH-adjacent data migrates with home migrate",
    migrated.rc === 0 && report?.ok === true,
    `rc=${migrated.rc} mode=${report?.mode}`,
    JSON.stringify({ vaults: report?.vaults, documents: report?.documents })
  );
  check(
    "AC-2",
    "~/.local/bin/data no longer exists after the move",
    !existsSync(pathExeData),
    `exists=${existsSync(pathExeData)}`
  );

  const after = vaultCounts(sb.exe, newRoot, sb.env, run);
  check(
    "AC-2",
    "document counts survive the PATH-exe migration",
    countsEqual(before.counts, after.counts),
    `before=${JSON.stringify(before.counts)} after=${JSON.stringify(after.counts)}`,
    JSON.stringify(after.counts)
  );
  check(
    "AC-2",
    "config.yaml data_dir points at the new root",
    pathTextEqual(readConfigDataDir(sb.home), newRoot),
    `data_dir=${readConfigDataDir(sb.home) ?? "(missing)"}`
  );
  return sb;
}

async function scenarioLegacyConfig(ctx) {
  const { cmd, check } = beginScenario("legacy-config");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "legacy-config", ctx.exeSource);
  const legacyData = join(sb.home, "legacy-config-data");
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] legacy-config sandbox=${sb.root}`);

  seedLegacy(
    sb.exe,
    legacyData,
    {
      vaults: [{ name: "default", docs: [{ title: "LegacyConfig One" }, { title: "LegacyConfig Two" }] }],
    },
    sb.env,
    run
  );
  const before = vaultCounts(sb.exe, legacyData, sb.env, run);
  const legacyConfig = seedLegacyConfig(sb.home, legacyData);
  check("AC-3", "fixture wrote ~/.config/kb-mcp/config.yaml", existsSync(legacyConfig), legacyConfig);

  // The runtime parses the retired file only to surface its data_dir as a
  // candidate; it must never become the effective root or config source.
  const pre = inspectRoot(sb.exe, null, sb.env, run);
  check(
    "AC-3",
    "retired ~/.config/kb-mcp/config.yaml is not the effective root source",
    pre.data_root.source !== "legacy_config" &&
      resolveEqual(pre.data_root.path, newRoot) &&
      pre.data_root.source === "default",
    `path=${pre.data_root.path} source=${pre.data_root.source}`
  );
  check(
    "AC-3",
    "the default root stays uninitialized (the legacy data_dir is not used as a root)",
    pre.initialized === false,
    `initialized=${pre.initialized}`
  );
  const candidate = candidateAt(pre, legacyData);
  check(
    "AC-3",
    "the retired data_dir is reported only as a legacy_config candidate",
    candidate?.kind === "legacy_config",
    `kind=${candidate?.kind ?? "(none)"} path=${candidate?.path}`,
    JSON.stringify(candidate ?? null)
  );
  check(
    "AC-3",
    "home inspect does not write ~/.config/hyseed/config.yaml",
    !existsSync(join(sb.home, ".config", "hyseed", "config.yaml")),
    "config path untouched by inspect"
  );

  // The rescued data itself is still migratable (explicit --from), which is
  // what the extension offers in the guide.
  const migrated = cmd(sb.exe, ["home", "migrate", "--from", legacyData, "--to", newRoot, "--json"], sb.env);
  const report = parseJson(migrated);
  check(
    "AC-3",
    "the legacy-config data_dir is migratable when named explicitly",
    migrated.rc === 0 && report?.ok === true,
    `rc=${migrated.rc} mode=${report?.mode}`,
    JSON.stringify({ vaults: report?.vaults, documents: report?.documents })
  );
  const after = vaultCounts(sb.exe, newRoot, sb.env, run);
  check(
    "AC-3",
    "document counts survive the explicit migration",
    countsEqual(before.counts, after.counts),
    `before=${JSON.stringify(before.counts)} after=${JSON.stringify(after.counts)}`,
    JSON.stringify(after.counts)
  );
  check(
    "AC-3",
    "config.yaml data_dir now points at the new root",
    pathTextEqual(readConfigDataDir(sb.home), newRoot),
    `data_dir=${readConfigDataDir(sb.home) ?? "(missing)"}`
  );
  return sb;
}

async function scenarioWal(ctx) {
  const { cmd, check } = beginScenario("wal");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "wal", ctx.exeSource);
  const walRoot = legacyDataRoot(sb.home);
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] wal sandbox=${sb.root}`);

  const fixture = cmd(ctx.venvPython, [WAL_FIXTURE, walRoot, "--vault", "default", "--docs", "3"], sb.env, {
    timeoutMs: 120_000,
    cwd: root,
  });
  const report = parseJson(fixture);
  check(
    "AC-4",
    "WAL fixture wrote 3 committed documents and exited without checkpointing",
    fixture.rc === 0 && report?.inserted === 3 && report?.documents === 3 && report?.wal_bytes > 0,
    `rc=${fixture.rc} inserted=${report?.inserted} documents=${report?.documents} wal_bytes=${report?.wal_bytes}`,
    JSON.stringify({ documents: report?.documents, wal_bytes: report?.wal_bytes })
  );
  check(
    "AC-4",
    "the -wal sidecar exists on disk before migration",
    typeof report?.wal_path === "string" && existsSync(report.wal_path) && statSync(report.wal_path).size > 0,
    `wal_path=${report?.wal_path}`
  );

  const pre = inspectRoot(sb.exe, walRoot, sb.env, run);
  check(
    "AC-4",
    "read-only home inspect sees all 3 documents in the WAL database",
    pre.documents === 3 && pre.initialized === true,
    `documents=${pre.documents} initialized=${pre.initialized}`,
    JSON.stringify({ documents: pre.documents })
  );
  check(
    "AC-4",
    "home inspect leaves the -wal in place (nothing was checkpointed by the drill)",
    typeof report?.wal_path === "string" && existsSync(report.wal_path) && statSync(report.wal_path).size > 0,
    `wal_bytes=${existsSync(report?.wal_path ?? "") ? statSync(report.wal_path).size : "(gone)"}`
  );

  const migrated = cmd(sb.exe, ["home", "migrate", "--from", walRoot, "--to", newRoot, "--json"], sb.env);
  const moved = parseJson(migrated);
  check(
    "AC-4",
    "WAL root migrates with home migrate",
    migrated.rc === 0 && moved?.ok === true && moved?.removed_source === true,
    `rc=${migrated.rc} mode=${moved?.mode} removed_source=${moved?.removed_source} warnings=${JSON.stringify(moved?.warnings ?? null)}`,
    JSON.stringify({ vaults: moved?.vaults, documents: moved?.documents })
  );
  check(
    "AC-4",
    "no 'database is locked' or corruption in the migrate output",
    !logLockedOrCorrupt(migrated),
    `${tail(migrated.stdout, 300)} ${tail(migrated.stderr, 300)}`
  );

  const listed = cmd(sb.exe, ["list", "--json"], { ...sb.env, KB_MCP_HOME: newRoot });
  const docs = parseJson(listed);
  check(
    "AC-4",
    "hyseed list --json returns the same 3 documents after migration",
    listed.rc === 0 && Array.isArray(docs) && docs.length === 3,
    `rc=${listed.rc} parsed=${Array.isArray(docs) ? docs.length : "n/a"}`,
    JSON.stringify({ documents: Array.isArray(docs) ? docs.length : null })
  );
  check(
    "AC-4",
    "no 'database is locked' or corruption in the post-migration list",
    !logLockedOrCorrupt(listed),
    `${tail(listed.stderr, 300)}`
  );
  check(
    "AC-4",
    "config.yaml data_dir points at the new root",
    pathTextEqual(readConfigDataDir(sb.home), newRoot),
    `data_dir=${readConfigDataDir(sb.home) ?? "(missing)"}`
  );
  return sb;
}

async function scenarioConflict(ctx) {
  const { cmd, check } = beginScenario("conflict");
  const run = logged(cmd);
  const sb = makeSandbox(ctx.base, "conflict", ctx.exeSource);
  const oldRoot = legacyDataRoot(sb.home);
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] conflict sandbox=${sb.root}`);

  seedLegacy(
    sb.exe,
    oldRoot,
    {
      vaults: [
        { name: "default", docs: [{ title: "Old Default One" }] },
        { name: "oldvault", docs: [{ title: "Old Vault One" }, { title: "Old Vault Two" }] },
      ],
    },
    sb.env,
    run
  );
  seedLegacy(
    sb.exe,
    newRoot,
    {
      vaults: [
        { name: "default", docs: [{ title: "New Default One" }] },
        { name: "newvault", docs: [{ title: "New Vault One" }, { title: "New Vault Two" }] },
      ],
    },
    sb.env,
    run
  );
  const preOld = inspectRoot(sb.exe, oldRoot, sb.env, run);
  const preNew = inspectRoot(sb.exe, newRoot, sb.env, run);
  const beforeOld = vaultCounts(sb.exe, oldRoot, sb.env, run);
  const beforeNew = vaultCounts(sb.exe, newRoot, sb.env, run);
  const oldRegistry = sha256File(join(oldRoot, "vaults.json"));
  const newRegistry = sha256File(join(newRoot, "vaults.json"));

  const migrated = cmd(sb.exe, ["home", "migrate", "--from", oldRoot, "--to", newRoot, "--json"], sb.env);
  const refused = parseJson(migrated);
  check(
    "AC-5",
    "migrate into a non-empty target exits 4 with stage=conflict",
    migrated.rc === 4 && refused?.ok === false && refused?.code === 4 && refused?.stage === "conflict",
    `rc=${migrated.rc} code=${refused?.code} stage=${refused?.stage} error=${refused?.error}`
  );
  check(
    "AC-5",
    "both roots still exist after the refusal",
    existsSync(oldRoot) && existsSync(newRoot),
    `old=${existsSync(oldRoot)} new=${existsSync(newRoot)}`
  );

  const afterOldInspect = inspectRoot(sb.exe, oldRoot, sb.env, run);
  const afterNewInspect = inspectRoot(sb.exe, newRoot, sb.env, run);
  check(
    "AC-5",
    "reads report identical document counts on both sides",
    afterOldInspect.documents === preOld.documents && afterNewInspect.documents === preNew.documents,
    `old ${preOld.documents}->${afterOldInspect.documents} new ${preNew.documents}->${afterNewInspect.documents}`,
    JSON.stringify({ old: afterOldInspect.documents, new: afterNewInspect.documents })
  );
  const afterOld = vaultCounts(sb.exe, oldRoot, sb.env, run);
  const afterNew = vaultCounts(sb.exe, newRoot, sb.env, run);
  check(
    "AC-5",
    "per-vault counts and registries are byte-identical after the refusal",
    countsEqual(beforeOld.counts, afterOld.counts) &&
      countsEqual(beforeNew.counts, afterNew.counts) &&
      sha256File(join(oldRoot, "vaults.json")) === oldRegistry &&
      sha256File(join(newRoot, "vaults.json")) === newRegistry,
    `old=${JSON.stringify(afterOld.counts)} new=${JSON.stringify(afterNew.counts)}`,
    JSON.stringify(afterOld.counts)
  );
  check(
    "AC-5",
    "the old vault was not merged into the new root",
    !afterNew.names.includes("oldvault"),
    `new vaults=${afterNew.names.join(",")}`
  );

  // Choose the old root: the config now points there and the new root is kept.
  const chosen = cmd(sb.exe, ["home", "set-data-dir", oldRoot, "--json"], sb.env);
  const chosenReport = parseJson(chosen);
  check(
    "AC-5",
    "choose one side: home set-data-dir exits 0",
    chosen.rc === 0 && chosenReport?.ok === true,
    `rc=${chosen.rc} data_dir=${chosenReport?.data_dir}`
  );
  const resolved = inspectRoot(sb.exe, null, sb.env, run);
  check(
    "AC-5",
    "after choosing the old root, config resolves it",
    resolveEqual(resolved.data_root.path, oldRoot) && resolved.data_root.source === "config",
    `path=${resolved.data_root.path} source=${resolved.data_root.source}`
  );
  const finalNewInspect = inspectRoot(sb.exe, newRoot, sb.env, run);
  const finalNewRegistry = sha256File(join(newRoot, "vaults.json"));
  check(
    "AC-5",
    "the other side (new root) is untouched after the choice",
    finalNewInspect.documents === preNew.documents && finalNewRegistry === newRegistry,
    `new documents=${finalNewInspect.documents} registry_unchanged=${finalNewRegistry === newRegistry}`,
    JSON.stringify({ documents: finalNewInspect.documents })
  );
  return sb;
}

async function scenarioFresh(ctx) {
  const { cmd, check } = beginScenario("fresh");
  const sb = makeSandbox(ctx.base, "fresh", ctx.exeSource);
  const newRoot = defaultDataRoot(sb.home);
  console.log(`[drill] fresh sandbox=${sb.root}`);

  const env = {
    ...sb.env,
    HYSEED_IT_ENTRY: DRILL_TEST_ENTRY,
    HYSEED_DRILL_HOME: sb.home,
  };
  const result = cmd(process.execPath, [RUN_INTEGRATION], env, {
    timeoutMs: 300_000,
    cwd: root,
  });
  check(
    "AC-6",
    "fresh extension-host leg (drill.test.ts) exits 0",
    result.rc === 0,
    tail(result.stderr, 1200) || tail(result.stdout, 1200)
  );
  check(
    "AC-6",
    "Finish wrote ~/.config/hyseed/config.yaml pointing at the default root",
    pathTextEqual(readConfigDataDir(sb.home), newRoot),
    `data_dir=${readConfigDataDir(sb.home) ?? "(missing)"}`
  );
  check(
    "AC-6",
    "vaults.json registers the default vault (kb.db is created by the runtime's first-access semantics, never by the drill)",
    registryHasDefault(newRoot),
    `vaults.json=${existsSync(join(newRoot, "vaults.json"))} default=${registryHasDefault(newRoot)}` +
      ` kb.db=${existsSync(join(newRoot, "default", "kb.db"))}`,
    JSON.stringify({ registry: registryHasDefault(newRoot) })
  );
  check(
    "AC-9",
    "the sandbox runtime copy is intact after the host leg (Finish with cli:false never replaced it)",
    sha256File(sb.exe) === ctx.exeSha,
    `sandbox exe sha256=${sha256File(sb.exe)}`
  );

  const hostLog = join(root, "out", "it-host.log");
  if (existsSync(hostLog)) {
    copyFileSync(hostLog, join(sb.report, "it-host.log"));
  }
  // Host-side proof that the release runtime served the extension: only a
  // 0.2.0 runtime answers `home inspect` (gate settles `fresh`, not
  // `runtime-too-old`/`error`) and succeeds at `home set-data-dir`.
  const hostText = existsSync(hostLog) ? readFileSync(hostLog, "utf8") : "";
  check(
    "AC-9",
    "the host ran the home command through the sandbox runtime (gate=fresh, data folder persisted)",
    /migration gate: fresh/.test(hostText) &&
      /onboarding: default data folder persisted:/.test(hostText),
    `host log bytes=${hostText.length} lines=${hostText.split(/\r?\n/).filter(Boolean).length}`
  );
  return sb;
}

const IMPLEMENTATIONS = {
  "legacy-root": scenarioLegacyRoot,
  "extension-data": scenarioExtensionData,
  "path-exe-data": scenarioPathExeData,
  "legacy-config": scenarioLegacyConfig,
  wal: scenarioWal,
  conflict: scenarioConflict,
  fresh: scenarioFresh,
};

// ---------------------------------------------------------------------------
// Preconditions / fingerprint / evidence
// ---------------------------------------------------------------------------

function findCodeExecutable() {
  const candidates = [
    process.env.VSCODE_EXECUTABLE,
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    "C:\\Program Files\\Microsoft VS Code\\Code.exe",
  ].filter((candidate) => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

function newestMtimeMs(dir, skipNames = new Set(["test", "node_modules"])) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(full, skipNames));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(full, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    }
  }
  return newest;
}

function dateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderEvidence(exitCode, note, facts, beforeSnapshot, afterSnapshot, fingerprintDiffs) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  push(`# hyseed 0.2.0 upgrade drill — ${dateStamp()}`);
  push();
  push(`- generated: ${new Date().toISOString()}`);
  push(`- scenarios: ${selected.join(", ")}${partial ? " (partial run: --only)" : " (full run)"}`);
  push(`- exit code: ${exitCode}${note ? ` — ${note}` : ""}`);
  if (facts.exe) {
    push(
      `- drill runtime: \`${facts.exe.path}\` — ${facts.exe.size} B, sha256 \`${facts.exe.sha256}\`` +
        ` (baseline ${RELEASE_EXE_SIZE} B / \`${RELEASE_EXE_SHA}\`: ${facts.exe.matchesBaseline ? "match" : "differs"})`
    );
    if (facts.exe.homeHelp) {
      push(
        `- runtime capability: \`hyseed home --help\` rc ${facts.exe.homeHelp.rc} (${facts.exe.homeHelp.durationMs} ms)`
      );
    }
  } else {
    push(`- drill runtime: MISSING at \`${RELEASE_EXE}\``);
  }
  if (facts.bundled) {
    push(
      `- bundled runtime (never executed by the drill): \`${facts.bundled.path}\` — ${facts.bundled.size} B, sha256 \`${facts.bundled.sha256}\`` +
        ` (same bytes as the release runtime: ${facts.bundled.sameAsRelease ? "yes" : "no"})`
    );
  }
  if (facts.dist) {
    push(
      `- extension build: \`${facts.dist.path}\` — sha256 \`${facts.dist.sha256}\`, mtime ${facts.dist.mtime}` +
        ` (newest src outside src/test: ${facts.dist.newestSrc})`
    );
  }
  if (facts.code) push(`- VS Code host: \`${facts.code}\``);
  push(`- sandbox root (kept for manual review): \`${facts.base}\``);
  push();

  push("## Real HOME fingerprint (AC-8)");
  push();
  push("Read-only: size + mtime + sha256 of the first 1 MiB per file; no SQLite connection is opened.");
  push("Host skill surfaces (`~/.claude/settings.json`, `skills`, `agents`, `commands`, `plugins`) are");
  push("included: the drill must never install CLI tools or agent skills into the real profile.");
  push("`~/.claude.json` and the session directories (`projects`/transcripts, `todos`, `telemetry`,");
  push("`sessions`, `state`) are excluded: the orchestrating agent session (and any parallel session");
  push("sharing the profile) writes them live while the drill runs, so a change there would not come");
  push("from the product under test.");
  push();
  push("| target | before | after |");
  push("|---|---|---|");
  for (const label of Object.keys(beforeSnapshot)) {
    const state = (entry) =>
      entry?.state === "directory" ? `directory (${Object.keys(entry.entries).length} files)` : entry?.state ?? "absent";
    push(`| \`${label}\` | ${state(beforeSnapshot[label])} | ${state(afterSnapshot[label])} |`);
  }
  push();
  push(
    fingerprintDiffs.length === 0
      ? "Result: unchanged (no differences)."
      : `Result: CHANGED — ${fingerprintDiffs.join(", ")}`
  );
  push();

  const acs = ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7", "AC-8", "AC-9"];
  push("## Assertions by AC");
  push();
  push("| AC | checks | failed |");
  push("|---|---|---|");
  for (const ac of acs) {
    const items = scenarioResults.flatMap((scenario) =>
      scenario.checks.filter((check) => check.ac === ac).map((check) => ({ scenario, check }))
    );
    if (items.length === 0) continue;
    const failed = items.filter((item) => !item.check.ok).length;
    push(`| ${ac} | ${items.length} | ${failed} |`);
  }
  push();

  for (const ac of acs) {
    const items = scenarioResults.flatMap((scenario) =>
      scenario.checks.filter((check) => check.ac === ac).map((check) => ({ scenario, check }))
    );
    if (items.length === 0) continue;
    push(`### ${ac}`);
    push();
    push("| scenario | assertion | result | detail | counts |");
    push("|---|---|---|---|---|");
    for (const { scenario, check } of items) {
      push(
        `| ${scenario.name} | ${escapeTable(check.assertion)} | ${check.ok ? "PASS" : "FAIL"} | ` +
          `${escapeTable(check.detail) || ""} | ${escapeTable(check.counts) || ""} |`
      );
    }
    push();
    push("Commands used (exit codes):");
    push();
    push("| scenario | rc | command |");
    push("|---|---|---|");
    const scenariosWithCommands = [...new Set(items.map((item) => item.scenario.name))];
    for (const scenarioName of scenariosWithCommands) {
      const scenario = scenarioResults.find((candidate) => candidate.name === scenarioName);
      for (const command of scenario?.commands ?? []) {
        // Global commands (esbuild fixtures) belong only to their own AC.
        if (scenarioName === "global" && command.ac !== ac) continue;
        push(`| ${scenarioName} | ${command.rc} | \`${escapeTable(command.command)}\` |`);
      }
    }
    push();
  }

  push("## Scenario status");
  push();
  push("| scenario | checks | failed | error |");
  push("|---|---|---|---|");
  for (const scenario of scenarioResults) {
    const failed = scenario.checks.filter((check) => !check.ok).length;
    if (scenario.name === "global" && scenario.checks.length === 0) continue;
    push(
      `| ${scenario.name} | ${scenario.checks.length} | ${failed} | ${escapeTable(scenario.error) || ""} |`
    );
  }
  push();

  if (failures.length > 0) {
    push("## Failures");
    push();
    for (const failure of failures) {
      push(`- **${failure.ac}** (${failure.scenario}): ${failure.assertion} — ${failure.detail || "(no detail)"}`);
    }
    push();
  }

  push("## Raw outputs (each trimmed to the last 3000 chars)");
  push();
  for (const scenario of scenarioResults) {
    for (const command of scenario.commands) {
      if (!command.stdout.trim() && !command.stderr.trim()) continue;
      push(`### ${scenario.name} · \`${command.command}\` — rc ${command.rc}`);
      push();
      if (command.stdout.trim()) {
        push("```text");
        push(tail(command.stdout, 3000));
        push("```");
      }
      if (command.stderr.trim()) {
        push("stderr:");
        push("```text");
        push(tail(command.stderr, 3000));
        push("```");
      }
      push();
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeFailureEvidence(message, facts) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, `drill-${dateStamp()}.md`);
  const lines = [
    `# hyseed 0.2.0 upgrade drill — ${dateStamp()}`,
    "",
    `- generated: ${new Date().toISOString()}`,
    `- scenarios: ${selected.join(", ")}`,
    `- exit code: 2 — ${message}`,
    "",
    "## Precondition failure",
    "",
    message,
    "",
  ];
  if (facts.exe) {
    lines.push(
      `- runtime: \`${facts.exe.path}\` — ${facts.exe.size} B, sha256 \`${facts.exe.sha256}\``
    );
  }
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  const stamp = `${dateStamp(startedAt).replace(/-/g, "")}-${String(startedAt.getHours()).padStart(2, "0")}${String(startedAt.getMinutes()).padStart(2, "0")}${String(startedAt.getSeconds()).padStart(2, "0")}`;
  const base = join(root, "out", "drill", stamp);
  mkdirSync(base, { recursive: true });

  const facts = { base };
  const problems = [];

  if (existsSync(RELEASE_EXE)) {
    facts.exe = {
      path: RELEASE_EXE,
      size: statSync(RELEASE_EXE).size,
      sha256: sha256File(RELEASE_EXE),
    };
    facts.exe.matchesBaseline =
      facts.exe.size === RELEASE_EXE_SIZE && facts.exe.sha256 === RELEASE_EXE_SHA;
  } else {
    problems.push(`release runtime missing: ${RELEASE_EXE}`);
  }
  if (existsSync(BUNDLED_EXE)) {
    facts.bundled = {
      path: BUNDLED_EXE,
      size: statSync(BUNDLED_EXE).size,
      sha256: sha256File(BUNDLED_EXE),
    };
    facts.bundled.sameAsRelease = facts.exe?.sha256 === facts.bundled.sha256;
  }
  if (existsSync(DIST_EXTENSION)) {
    const distStat = statSync(DIST_EXTENSION);
    facts.dist = {
      path: DIST_EXTENSION,
      size: distStat.size,
      sha256: sha256File(DIST_EXTENSION),
      mtime: new Date(distStat.mtimeMs).toISOString(),
      newestSrc: new Date(newestMtimeMs(join(root, "src"))).toISOString(),
    };
  }
  if (facts.exe) {
    // 0.2.0 packaging installs the release build as resources/hyseed.exe, so
    // byte equality with the bundled copy proves nothing. Probe the command
    // group the scenarios depend on: a pre-0.2.0 runtime answers `home` with
    // click's usage text and a non-zero exit.
    const probe = runProcess(RELEASE_EXE, ["home", "--help"], { timeoutMs: 120_000 });
    facts.exe.homeHelp = probe;
    const text = `${probe.stdout}\n${probe.stderr}`;
    const missing = ["inspect", "migrate", "set-data-dir"].filter((name) => !text.includes(name));
    if (probe.rc !== 0 || missing.length > 0) {
      problems.push(
        `the release runtime does not expose the 0.2.0 'home' command group ` +
          `(hyseed home --help rc ${probe.rc}${missing.length > 0 ? `, missing ${missing.join("/")}` : ""})`
      );
    }
  }
  if (selected.includes("wal") && !existsSync(VENV_PYTHON)) {
    problems.push(`WAL fixture needs the kbmcp venv python: ${VENV_PYTHON} (fixture could not be built)`);
  }
  if (selected.includes("wal") && !existsSync(WAL_FIXTURE)) {
    problems.push(`WAL fixture missing: ${WAL_FIXTURE}`);
  }
  if (selected.includes("fresh")) {
    if (!existsSync(DIST_EXTENSION)) {
      problems.push(`extension build missing: ${DIST_EXTENSION} (run npm run build)`);
    } else if (newestMtimeMs(join(root, "src")) > statSync(DIST_EXTENSION).mtimeMs + 1000) {
      problems.push(
        `dist/extension.js is older than src (${facts.dist?.newestSrc ?? "?"} > ${facts.dist?.mtime ?? "?"}): run npm run build`
      );
    }
    const code = findCodeExecutable();
    if (!code) {
      problems.push("VS Code executable not found; set VSCODE_EXECUTABLE");
    } else {
      facts.code = code;
    }
    if (!existsSync(DRILL_TEST_ENTRY)) {
      problems.push(`drill test entry missing: ${DRILL_TEST_ENTRY}`);
    }
  }

  if (problems.length > 0) {
    const evidenceFile = writeFailureEvidence(problems.join("; "), facts);
    for (const problem of problems) console.error(`[drill] PRECONDITION: ${problem}`);
    console.error(`[drill] evidence: ${evidenceFile}`);
    console.error(`KEEP: ${base}`);
    process.exit(2);
  }

  const realHome = process.env.USERPROFILE || process.env.HOME || "";
  if (!realHome) {
    const evidenceFile = writeFailureEvidence("cannot determine the real HOME", facts);
    console.error(`[drill] PRECONDITION: cannot determine the real HOME`);
    console.error(`[drill] evidence: ${evidenceFile}`);
    console.error(`KEEP: ${base}`);
    process.exit(2);
  }
  console.log(`[drill] release runtime sha256=${facts.exe.sha256} size=${facts.exe.size}`);
  console.log(`[drill] real HOME (read-only fingerprint): ${realHome}`);
  const beforeSnapshot = snapshotRealHome(realHome);

  const ctx = {
    base,
    exeSource: RELEASE_EXE,
    exeSha: facts.exe.sha256,
    exeSize: facts.exe.size,
    venvPython: VENV_PYTHON,
    scan: null,
    onboarding: null,
  };

  // AC-7 matrix is pure; evaluate it independently of the host leg.
  if (selected.includes("fresh") || selected.includes("legacy-root")) {
    try {
      const state = await loadOnboardingState(ctx);
      const matrix = [
        ["0.1.4 -> 0.2.0", { current: "0.2.0", onboarded: "0.1.4", firstInstall: false }, true, "major-upgrade"],
        ["0.2.0 -> 0.2.1", { current: "0.2.1", onboarded: "0.2.0", firstInstall: false }, false, "none"],
        ["marker missing", { current: "0.2.0", onboarded: null, firstInstall: false }, true, "major-upgrade"],
        ["marker missing, first install", { current: "0.2.0", onboarded: null, firstInstall: true }, true, "first-install"],
      ];
      for (const [label, args, open, reason] of matrix) {
        const actual = state.decideOnboarding(args);
        globalCheck(
          "AC-7",
          `decideOnboarding(${label}) opens=${open} reason=${reason}`,
          actual.open === open && actual.reason === reason,
          `actual=${JSON.stringify(actual)}`
        );
      }
      globalCheck(
        "AC-7",
        "DEFAULT_STEPS is {cli:true, mcp:false}",
        JSON.stringify(state.DEFAULT_STEPS) === JSON.stringify({ cli: true, mcp: false }),
        JSON.stringify(state.DEFAULT_STEPS)
      );
    } catch (error) {
      globalCheck(
        "AC-7",
        "version-trigger matrix could not be evaluated",
        false,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  for (const name of selected) {
    console.log(`[drill] scenario ${name} ...`);
    try {
      const sandbox = await IMPLEMENTATIONS[name](ctx);
      if (sandbox) console.log(`[drill] scenario ${name} done sandbox=${sandbox.root}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record = scenarioResults.find((scenario) => scenario.name === name && !scenario.error);
      if (record) record.error = message;
      failures.push({ scenario: name, ac: "-", assertion: "scenario completed", detail: message });
      console.error(`[drill] scenario ${name} FAILED: ${message}`);
    }
  }

  const afterSnapshot = snapshotRealHome(realHome);
  const fingerprintDiffs = compareSnapshots(beforeSnapshot, afterSnapshot);
  globalCheck(
    "AC-8",
    "real HOME fingerprint unchanged (hyseed data/config, retired dirs, host skill surfaces)",
    fingerprintDiffs.length === 0,
    fingerprintDiffs.length === 0 ? "no differences" : `changed: ${fingerprintDiffs.join(", ")}`,
    JSON.stringify({ targets: Object.keys(beforeSnapshot).length, changed: fingerprintDiffs.length })
  );
  if (facts.exe) {
    const probe = facts.exe.homeHelp;
    const text = `${probe?.stdout ?? ""}\n${probe?.stderr ?? ""}`;
    const missing = ["inspect", "migrate", "set-data-dir"].filter((name) => !text.includes(name));
    globalCheck(
      "AC-9",
      "drill runtime is a 0.2.0 build that exposes the 'home' command group",
      Boolean(probe) && probe.rc === 0 && missing.length === 0,
      `home --help rc ${probe?.rc ?? "?"}${missing.length > 0 ? `, missing ${missing.join("/")}` : ""}; ` +
        `release=${facts.exe.sha256} bundled=${facts.bundled?.sha256 ?? "(missing)"}`,
      JSON.stringify({ helpMs: probe?.durationMs ?? null })
    );
  }
  if (facts.dist) {
    globalCheck(
      "AC-9",
      "extension host loads the npm run build output (dist/extension.js is up to date)",
      statSync(DIST_EXTENSION).mtimeMs + 1000 >= newestMtimeMs(join(root, "src")),
      `dist mtime=${facts.dist.mtime} newest src=${facts.dist.newestSrc}`,
      JSON.stringify({ bytes: facts.dist.size })
    );
  }

  const exitCode = failures.length === 0 ? 0 : 1;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidenceFile = join(EVIDENCE_DIR, `drill-${dateStamp()}.md`);
  writeFileSync(
    evidenceFile,
    renderEvidence(
      exitCode,
      failures.length === 0 ? "all selected scenarios passed" : `${failures.length} assertion failure(s)`,
      facts,
      beforeSnapshot,
      afterSnapshot,
      fingerprintDiffs
    )
  );

  console.log("");
  if (failures.length === 0) {
    console.log(`[drill] PASS — ${selected.length} scenario(s), ${scenarioResults.reduce((sum, s) => sum + s.checks.length, 0)} checks`);
  } else {
    console.error(`[drill] FAIL — ${failures.length} assertion failure(s):`);
    for (const failure of failures) {
      console.error(`[drill]   ${failure.ac} ${failure.scenario}: ${failure.assertion} — ${failure.detail}`);
    }
  }
  console.log(`[drill] evidence: ${evidenceFile}`);
  console.log(`KEEP: ${base}`);
  process.exit(exitCode);
}

await main();