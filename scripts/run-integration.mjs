import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testEntry = join(root, "out", "integration", "extension.test.js");

await esbuild.build({
  entryPoints: [join(root, "src", "test", "integration", "extension.test.ts")],
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

const userDataDir = mkdtempSync(join(tmpdir(), "hyseed-vscode-host-"));
const args = [
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${testEntry}`,
  `--user-data-dir=${userDataDir}`,
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
const logPath = join(root, "out", "it-host.log");
writeFileSync(logPath, "");
env.KB_MCP_VSCODE_LOG = logPath;
// Safety trap: if the dataRoot setting ever fails to reach the spawn env, the server
// writes here instead of the real user data root.
const trapHome = join(userDataDir, "trap-home");
mkdirSync(trapHome, { recursive: true });
env.KB_MCP_HOME = trapHome;

console.log(`[test:integration] ${code} ${args.join(" ")}`);
const result = spawnSync(code, args, { stdio: "inherit", env });

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
process.exit(result.status ?? 1);