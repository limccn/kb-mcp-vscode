import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Sources: explicit env override, then the monorepo sibling build output, then a
// runtime already staged in resources/ (the standalone-checkout layout).
function sourceFor(envKey, name, sibling) {
  const explicit = process.env[envKey];
  if (explicit) return resolve(explicit);
  if (existsSync(sibling)) return sibling;
  return join(root, "resources", name);
}

const files = [
  {
    name: "hyseed.exe",
    envKey: "HYSEED_RUNTIME_EXE",
    source: sourceFor("HYSEED_RUNTIME_EXE", "hyseed.exe", resolve(root, "..", "kbmcp-rt", "hyseed.exe")),
  },
  {
    name: "doc-convert.exe",
    envKey: "DOC_CONVERT_EXE",
    source: sourceFor("DOC_CONVERT_EXE", "doc-convert.exe", resolve(root, "..", "ingestion-rt", "doc-convert.exe")),
  },
];

for (const { name, envKey, source } of files) {
  if (!existsSync(source)) {
    console.error(
      `[prepare-runtime] missing ${name}: set ${envKey} or place it at ${join(root, "resources", name)}`
    );
    process.exit(1);
  }
}

mkdirSync(join(root, "resources"), { recursive: true });

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

for (const { name, source } of files) {
  const target = join(root, "resources", name);
  const sameFile = resolve(source) === resolve(target);
  if (!sameFile) copyFileSync(source, target);
  const sourceSha = sha256(source);
  const targetSha = sha256(target);
  if (sourceSha !== targetSha) {
    console.error(`[prepare-runtime] copy mismatch for ${name}: ${targetSha} != ${sourceSha}`);
    process.exit(1);
  }
  console.log(`[prepare-runtime] ${sameFile ? "using" : "copied"} ${source} -> ${target}`);
  console.log(`[prepare-runtime] ${name}: bytes=${statSync(target).size} sha256=${targetSha}`);
}