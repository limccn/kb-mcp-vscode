import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  { name: "hyseed.exe", source: resolve(root, "..", "kbmcp-rt", "hyseed.exe") },
  { name: "doc-convert.exe", source: resolve(root, "..", "ingestion-rt", "doc-convert.exe") },
];

for (const { source } of files) {
  if (!existsSync(source)) {
    console.error(`[prepare-runtime] missing source executable: ${source}`);
    process.exit(1);
  }
}

mkdirSync(join(root, "resources"), { recursive: true });

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

for (const { name, source } of files) {
  const target = join(root, "resources", name);
  copyFileSync(source, target);
  const sourceSha = sha256(source);
  const targetSha = sha256(target);
  if (sourceSha !== targetSha) {
    console.error(`[prepare-runtime] copy mismatch for ${name}: ${targetSha} != ${sourceSha}`);
    process.exit(1);
  }
  console.log(`[prepare-runtime] copied ${source} -> ${target}`);
  console.log(`[prepare-runtime] ${name}: bytes=${statSync(target).size} sha256=${targetSha}`);
}