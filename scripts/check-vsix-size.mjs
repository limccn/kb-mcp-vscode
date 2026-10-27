// Hard release gate: the packaged VSIX must stay at or below 100 MiB.
// Mirrors vsce's default name (`<name>-<target>-<version>.vsix`).

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT_BYTES = 100 * 1024 * 1024;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let limit = LIMIT_BYTES;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== "--limit-bytes") {
    console.error(`[check-vsix-size] unknown argument: ${args[i]}`);
    process.exit(2);
  }
  const value = Number(args[i + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    console.error(`[check-vsix-size] invalid --limit-bytes: ${args[i + 1] ?? "<missing>"}`);
    process.exit(2);
  }
  limit = value;
  i += 1;
}

const vsix = join(root, `${pkg.name}-win32-x64-${pkg.version}.vsix`);
if (!existsSync(vsix)) {
  console.error(`[check-vsix-size] missing package: ${vsix}`);
  process.exit(1);
}

const bytes = statSync(vsix).size;
if (bytes > limit) {
  console.error(`[check-vsix-size] ${vsix} is ${bytes} bytes, over the ${limit}-byte limit`);
  process.exit(1);
}
console.log(`[check-vsix-size] OK: ${bytes} bytes (limit ${limit})`);