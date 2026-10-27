// Mechanical consistency checks for release assets.
// Usage: node scripts/check-docs.mjs [--root <dir>] [--vsce-list <file>]
// --root      check a copy instead of this checkout (negative self-tests)
// --vsce-list read a captured `vsce ls` listing instead of spawning vsce
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

function parseArgs(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let vsceList = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") root = path.resolve(argv[++i]);
    else if (argv[i] === "--vsce-list") vsceList = path.resolve(argv[++i]);
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return { root, vsceList };
}

const { root, vsceList } = parseArgs(process.argv.slice(2));
const failures = [];
let checks = 0;

function must(condition, message) {
  if (!condition) failures.push(message);
}

function check(label, fn) {
  checks += 1;
  try {
    fn();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

// Alpha of pixel (0,0): filter byte + the first RGBA pixel of the inflated first scanline.
function firstPixelAlpha(bytes) {
  let offset = 8;
  const parts = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return zlib.inflateSync(Buffer.concat(parts))[4];
}

const pkg = JSON.parse(read("package.json"));
const commandIds = (pkg.contributes?.commands ?? []).map((entry) => entry.command);
const settingKeys = Object.keys(pkg.contributes?.configuration?.properties ?? {});
const displayName = pkg.displayName ?? "";
must(commandIds.length > 0, "package.json: no contributed commands");
must(settingKeys.length > 0, "package.json: no contributed settings");

function checkReadme(file) {
  const text = read(file);
  for (const id of commandIds) must(text.includes(id), `${file}: missing command id ${id}`);
  for (const key of settingKeys) must(text.includes(key), `${file}: missing setting ${key}`);
  must(displayName && text.includes(displayName), `${file}: missing displayName "${displayName}"`);
}

check("publisher", () => {
  must(typeof pkg.publisher === "string" && pkg.publisher.length > 0, "package.json: no publisher");
  must(pkg.publisher !== "placeholder-publisher", "package.json: publisher is still the placeholder");
});

check("readme-en", () => checkReadme("README.md"));
check("readme-zh", () => checkReadme("README.zh-CN.md"));
check("readme-ja", () => checkReadme("README.ja.md"));

function listing() {
  if (vsceList) return fs.readFileSync(vsceList, "utf8");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileSync(npx, ["--no-install", "vsce", "ls"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

let entries = [];
let listingError = null;
try {
  entries = listing()
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
} catch (error) {
  listingError = error;
}

const REQUIRED = [
  "dist/extension.js",
  "resources/hyseed.exe",
  "resources/doc-convert.exe",
  "resources/icon.png",
  "resources/activitybar.svg",
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "CHANGELOG.md",
  "LICENSE",
];
const FORBIDDEN = ["src/", "scripts/", "test/", "docs/", "node_modules/", "out/"];

check("vsix-includes", () => {
  if (listingError) throw listingError;
  for (const entry of REQUIRED) must(entries.includes(entry), `vsce ls: missing ${entry}`);
});
check("vsix-excludes", () => {
  if (listingError) throw listingError;
  for (const entry of entries) {
    for (const prefix of FORBIDDEN) {
      must(!entry.startsWith(prefix), `vsce ls: unexpected ${entry}`);
    }
  }
});

check("icon", () => {
  must(pkg.icon === "resources/icon.png", `package.json: icon is ${pkg.icon}`);
  const bytes = fs.readFileSync(path.join(root, "resources/icon.png"));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  must(bytes.subarray(0, 8).equals(signature), "resources/icon.png: not a PNG");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  must(width === 128 && height === 128, `resources/icon.png: ${width}x${height}, expected 128x128`);
  must(bytes[24] === 8 && bytes[25] === 6, "resources/icon.png: expected 8-bit RGBA");
  must(bytes[28] === 0, "resources/icon.png: interlaced PNG is not supported");
  const alpha = firstPixelAlpha(bytes);
  must(alpha === 0, `resources/icon.png: top-left alpha ${alpha}, expected 0 (transparent background)`);
});

// Activity bar icons are drawn as a monochrome theme mask: a filled PNG turns
// into a solid block, so this must stay stroke-only line art with no background.
check("activitybar-icon", () => {
  const container = pkg.contributes?.viewsContainers?.activitybar?.[0];
  must(
    container?.icon === "resources/activitybar.svg",
    `package.json: activity bar icon is ${container?.icon}`
  );
  const svg = read("resources/activitybar.svg");
  must(svg.includes("<svg"), "resources/activitybar.svg: not an SVG");
  must(
    svg.includes('viewBox="0 0 24 24"'),
    "resources/activitybar.svg: expected viewBox 0 0 24 24"
  );
  must(!svg.includes("<rect"), "resources/activitybar.svg: must not contain a background rect");
});

check("changelog-version", () => {
  const match = read("CHANGELOG.md").match(/^##\s+v?([0-9]+\.[0-9]+\.[0-9]+)/m);
  must(match, "CHANGELOG.md: no '## <version>' heading");
  if (match) must(match[1] === pkg.version, `CHANGELOG ${match[1]} != package.json ${pkg.version}`);
});

check("legacy-names", () => {
  const legacy = /kb-mcp\.exe|share[\\/]kb-mcp/;
  const src = path.join(root, "src");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const relative = path.relative(src, full).replace(/\\/g, "/");
        if (!relative.endsWith(".ts")) continue;
        if (relative === "constants.ts" || relative.startsWith("test/")) continue;
        must(!legacy.test(fs.readFileSync(full, "utf8")), `src/${relative}: legacy name`);
      }
    }
  };
  walk(src);
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`OK: ${checks} checks`);