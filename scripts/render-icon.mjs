// Render resources/icon.png (128x128) from the favicon SVG with offline Edge.
// No dependencies: Edge headless --screenshot, then verify the PNG IHDR.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.resolve(root, "../kbmcp/src/kb_mcp_lite/static/favicon.svg");
const outPath = path.join(root, "resources", "icon.png");
const edgePath =
  process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

if (!fs.existsSync(edgePath)) {
  console.error(`FAIL: Edge not found at ${edgePath} (set EDGE_PATH)`);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath, "utf8").replace(/<svg\b/, '<svg width="128" height="128"');
const html = `<!doctype html><html style="background:transparent"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:transparent">${svg}</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hyseed-icon-"));
const page = path.join(tmp, "icon.html");
const shot = path.join(tmp, "icon.png");
fs.writeFileSync(page, html);

function render(flag) {
  execFileSync(
    edgePath,
    [
      flag,
      "--disable-gpu",
      "--hide-scrollbars",
      // Headless screenshots default to white; 00000000 keeps the page transparent.
      "--default-background-color=00000000",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${path.join(tmp, "profile")}`,
      "--window-size=128,128",
      `--screenshot=${shot}`,
      pathToFileURL(page).href,
    ],
    { stdio: "pipe", timeout: 60000 }
  );
}

function ihdr() {
  if (!fs.existsSync(shot)) return null;
  try {
    const bytes = fs.readFileSync(shot);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!bytes.subarray(0, 8).equals(signature)) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes };
  } catch {
    return null; // still being written
  }
}

// The Edge launcher can exit before the browser process finishes the shot.
function waitForPng(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const png = ihdr();
    if (png) return png;
    if (Date.now() > deadline) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.error(`note: could not remove ${dir} (${error.code})`);
  }
}

let png = null;
for (const flag of ["--headless=new", "--headless"]) {
  try {
    render(flag);
  } catch (error) {
    console.error(`render with ${flag} failed: ${error.message}`);
  }
  png = waitForPng();
  if (png) break;
}

if (!png || png.width !== 128 || png.height !== 128) {
  cleanup(tmp);
  console.error(`FAIL: expected a 128x128 PNG, got ${png ? `${png.width}x${png.height}` : "nothing"}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.copyFileSync(shot, outPath);
cleanup(tmp);

const sha = createHash("sha256").update(png.bytes).digest("hex");
console.log(`OK: ${path.relative(root, outPath)} ${png.width}x${png.height} ${png.bytes.length} B sha256=${sha}`);