import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// HYSEED_IT_ENTRY selects a different test entry (used by the upgrade drill);
// the default entry and its output path stay exactly as before.
const entrySource = process.env.HYSEED_IT_ENTRY?.trim()
  ? resolve(root, process.env.HYSEED_IT_ENTRY.trim())
  : join(root, "src", "test", "integration", "extension.test.ts");
const testEntry = join(root, "out", "integration", `${basename(entrySource, ".ts")}.js`);

// HYSEED_DRILL_HOME points at a sandbox home owned by the drill. When set, the
// host profile and extensions directory are siblings of that home and nothing
// is deleted on exit (the drill keeps the sandbox as evidence).
const drillHome = process.env.HYSEED_DRILL_HOME?.trim()
  ? resolve(process.env.HYSEED_DRILL_HOME.trim())
  : "";

if (!existsSync(entrySource)) {
  console.error(`[test:integration] test entry not found: ${entrySource}`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entrySource],
  outfile: testEntry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});

function findCodeExecutable() {
  const candidates = [
    process.env.VSCODE_EXECUTABLE,
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    "C:\\Program Files\\Microsoft VS Code\\Code.exe",
  ].filter((candidate) => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

const code = findCodeExecutable();
if (!code) {
  console.error("[test:integration] VS Code executable not found; set VSCODE_EXECUTABLE");
  process.exit(1);
}

// Sandbox the user profile too: the migration gate scans HOME for legacy data
// roots and the VS Code extensions directory. A real profile must never take
// part in a test run.
const userDataDir = drillHome
  ? join(drillHome, "..", "profile")
  : mkdtempSync(join(tmpdir(), "hyseed-vscode-host-"));
const hostHome = drillHome || join(userDataDir, "home");
const extensionsDir = drillHome ? join(drillHome, "..", "extensions") : join(userDataDir, "extensions");
mkdirSync(hostHome, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
const args = [
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${testEntry}`,
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  "--disable-extensions",
  "--disable-workspace-trust",
  "--disable-telemetry",
  "--disable-gpu",
  "--skip-welcome",
  "--skip-release-notes",
];

// Some shells export ELECTRON_RUN_AS_NODE=1, which turns Code.exe into plain node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KB_MCP_CONFIG;
env.USERPROFILE = hostHome;
env.HOME = hostHome;
const logPath = join(root, "out", "it-host.log");
writeFileSync(logPath, "");
env.KB_MCP_VSCODE_LOG = logPath;
if (drillHome) {
  // The drill home is the sandbox: no trap redirection, and inherited root
  // overrides must not leak into the host.
  delete env.KB_MCP_HOME;
  delete env.KB_MCP_VAULT;
} else {
  // Safety trap: if the dataRoot setting ever fails to reach the spawn env, the server
  // writes here instead of the real user data root.
  const trapHome = join(userDataDir, "trap-home");
  mkdirSync(trapHome, { recursive: true });
  env.KB_MCP_HOME = trapHome;
}

console.log(`[test:integration] ${code} ${args.join(" ")}`);
const result = spawnSync(code, args, { stdio: "inherit", env });

if (drillHome) {
  // Keep the sandbox intact: the drill copies logs out of it as evidence.
  console.log(`[test:integration] drill sandbox kept: ${hostHome}`);
} else {
  // The host may still be releasing log file handles right after exit.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  if (existsSync(userDataDir)) {
    console.warn(`[test:integration] could not remove temp profile: ${userDataDir}`);
  }
}
process.exit(result.status ?? 1);