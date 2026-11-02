/**
 * Sandbox + fixture helpers for the hyseed 0.2.0 upgrade drill.
 *
 * Every fixture is built by the *real* runtime executable inside a sandbox
 * home; nothing is copied from `ddl/`, `data/` or the testdoc folders. All
 * fixture strings are ASCII on purpose: the frozen exe may print cp932 and
 * the drill decodes child output as UTF-8.
 *
 * The sandbox layout mirrors the design (§2): `<scenario>/home` is HOME and
 * USERPROFILE, `<scenario>/profile` + `<scenario>/extensions` belong to the
 * VS Code host, `<scenario>/report` keeps copied logs.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const DEFAULT_TIMEOUT_MS = 120_000;
const HASH_CAP_BYTES = 1024 * 1024;

/**
 * Environment for every drill child process: profile sandboxed, inherited
 * root/vault overrides removed. `PYTHONIOENCODING` only affects the venv
 * python fixture; the frozen exe ignores it (ASCII fixtures keep the
 * decoded output unambiguous either way).
 *
 * Host-config overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CLINE_*`) are
 * cleared as well: the extension host's setup guide runs `hyseed skills
 * list`, and those variables would point the CLI at the real agent configs
 * instead of the sandbox home (same rule as the skills integration leg).
 */
export function cleanChildEnv(home) {
  const env = { ...process.env };
  delete env.KB_MCP_HOME;
  delete env.KB_MCP_CONFIG;
  delete env.KB_MCP_VAULT;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLINE_")) delete env[key];
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env.PYTHONIOENCODING = "utf-8";
  return env;
}

/** spawnSync wrapper with a uniform result shape (rc, stdout, stderr, duration). */
export function runProcess(exe, args, options = {}) {
  const { env = process.env, cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const started = Date.now();
  const result = spawnSync(exe, args, {
    env,
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    rc: typeof result.status === "number" ? result.status : -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message ?? result.error) : null,
    durationMs: Date.now() - started,
  };
}

/** Create `<baseDir>/<name>/{home,profile,extensions,report}` and the sandbox exe. */
export function makeSandbox(baseDir, name, exeSource) {
  const root = join(baseDir, name);
  const home = join(root, "home");
  for (const dir of [
    join(home, ".local", "bin"),
    join(root, "profile"),
    join(root, "extensions"),
    join(root, "report"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const exe = join(home, ".local", "bin", "hyseed.exe");
  copyFileSync(exeSource, exe);
  return {
    name,
    root,
    home,
    profile: join(root, "profile"),
    extensions: join(root, "extensions"),
    report: join(root, "report"),
    exe,
    env: cleanChildEnv(home),
  };
}

export function defaultDataRoot(home) {
  return join(home, ".local", "share", "hyseed");
}

export function legacyDataRoot(home) {
  return join(home, ".local", "share", "kb-mcp");
}

/**
 * Seed a data root through the runtime CLI. Every vault (including `default`)
 * receives at least one document so a later `list` never scaffolds a new
 * database.
 *
 * spec = { vaults: [{ name, docs: [{ title, body?, type? }] }], current? }
 */
export function seedLegacy(exe, root, spec, env, run = runProcess) {
  mkdirSync(root, { recursive: true });
  const pinned = { ...env, KB_MCP_HOME: root };
  const call = (args, allowRc = [0]) => {
    const result = run(exe, args, { env: pinned });
    if (!allowRc.includes(result.rc)) {
      throw new Error(
        `seed command failed (rc ${result.rc}): hyseed ${args.join(" ")}\n` +
          `${(result.stderr || result.stdout).trim().slice(0, 800)}`
      );
    }
    return result;
  };
  const counts = {};
  for (const vault of spec.vaults) {
    if (vault.name !== "default") {
      // rc 4 = the vault already exists (idempotent re-seed).
      call(["vault", "create", vault.name, "--json"], [0, 4]);
    }
    call(["vault", "switch", vault.name]);
    for (const doc of vault.docs) {
      call([
        "add",
        "--type",
        doc.type ?? "lesson",
        "--title",
        doc.title,
        "--body",
        doc.body ?? `${doc.title} body`,
        "--json",
      ]);
    }
    counts[vault.name] = vault.docs.length;
  }
  const current = spec.current ?? spec.vaults[0]?.name ?? "default";
  call(["vault", "switch", current]);
  return { root, counts, current };
}

/** `hyseed home inspect --json`; `root` pins KB_MCP_HOME, null uses the config chain. */
export function inspectRoot(exe, root, env, run = runProcess) {
  const pinned = { ...env };
  if (root) pinned.KB_MCP_HOME = root;
  else delete pinned.KB_MCP_HOME;
  const result = run(exe, ["home", "inspect", "--json"], { env: pinned, timeoutMs: 60_000 });
  if (result.rc !== 0) {
    throw new Error(
      `home inspect failed (rc ${result.rc}): ${(result.stderr || result.stdout).trim().slice(0, 800)}`
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`home inspect did not print JSON: ${result.stdout.trim().slice(0, 500)}`);
  }
}

/**
 * Per-vault document counts (vault list → switch → list). The previous current
 * vault is restored afterwards. Only call on roots where every vault already
 * has a database, otherwise `list` would scaffold one.
 */
export function vaultCounts(exe, root, env, run = runProcess) {
  const pinned = { ...env, KB_MCP_HOME: root };
  const listed = run(exe, ["vault", "list", "--json"], { env: pinned });
  if (listed.rc !== 0) {
    throw new Error(`vault list failed (rc ${listed.rc}): ${listed.stderr.trim().slice(0, 500)}`);
  }
  const vaults = JSON.parse(listed.stdout);
  const inspect = run(exe, ["home", "inspect", "--json"], { env: pinned });
  const current = inspect.rc === 0 ? JSON.parse(inspect.stdout).current : null;
  const counts = {};
  for (const vault of vaults) {
    const switched = run(exe, ["vault", "switch", vault.name], { env: pinned });
    if (switched.rc !== 0) {
      throw new Error(`vault switch ${vault.name} failed (rc ${switched.rc})`);
    }
    const docs = run(exe, ["list", "--json"], { env: pinned });
    if (docs.rc !== 0) {
      throw new Error(`list failed in vault ${vault.name} (rc ${docs.rc})`);
    }
    counts[vault.name] = JSON.parse(docs.stdout).length;
  }
  if (current) run(exe, ["vault", "switch", current], { env: pinned });
  return { root, names: vaults.map((vault) => vault.name), counts, current };
}

/** Retired pre-rename config: `~/.config/kb-mcp/config.yaml` pointing at data. */
export function seedLegacyConfig(home, dataDir) {
  const file = join(home, ".config", "kb-mcp", "config.yaml");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `data_dir: ${dataDir}\n`, "utf8");
  return file;
}

/** Top-level `data_dir:` line of `~/.config/hyseed/config.yaml`, or null. */
export function readConfigDataDir(home) {
  const file = join(home, ".config", "hyseed", "config.yaml");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^data_dir\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let raw = match[1];
    const quoted =
      raw.length >= 2 &&
      ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')));
    if (quoted) raw = raw.slice(1, -1);
    return raw || null;
  }
  return null;
}

/** Windows-tolerant path equality (slashes normalized, case folded). */
export function resolveEqual(a, b) {
  const norm = (value) =>
    resolve(value).replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

export function sha256File(file, cap = Number.POSITIVE_INFINITY) {
  let data = readFileSync(file);
  if (data.length > cap) data = data.subarray(0, cap);
  return createHash("sha256").update(data).digest("hex");
}

function fileFingerprint(file, stat) {
  const hashedBytes = Math.min(stat.size, HASH_CAP_BYTES);
  const hash = createHash("sha256");
  try {
    const fd = openSync(file, "r");
    try {
      const buffer = Buffer.alloc(hashedBytes);
      readSync(fd, buffer, 0, hashedBytes, 0);
      hash.update(buffer);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    return {
      state: "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      error: String(error.message ?? error),
    };
  }
  return {
    state: "file",
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hashedBytes,
    sha256Head: hash.digest("hex"),
  };
}

function walkFingerprint(root, dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out[`${relative(root, dir).replace(/\\/g, "/")}/`] = {
      state: "unreadable",
      error: String(error.message ?? error),
    };
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFingerprint(root, full, out);
    } else if (entry.isFile()) {
      const stat = statSync(full, { throwIfNoEntry: false });
      if (!stat) continue;
      out[relative(root, full).replace(/\\/g, "/")] = fileFingerprint(full, stat);
    }
  }
}

/**
 * Read-only fingerprint of a file or directory tree: size + mtime + sha256 of
 * the first 1 MiB per file (large databases are never fully read).
 */
export function fingerprintPath(target) {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return { state: "absent" };
  if (stat.isFile()) return fileFingerprint(target, stat);
  if (!stat.isDirectory()) {
    return { state: "other", size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const entries = {};
  walkFingerprint(target, target, entries);
  return { state: "directory", entries };
}

/**
 * Read-only snapshot of the real profile (AC-8/R7). Covers the current data
 * root's registry, every per-vault database (first 1 MiB + size + mtime), the
 * current config file, both pre-rename locations (absent-vs-unchanged), and
 * the host skill surfaces the product could write (`~/.claude/settings.json`,
 * `skills`, `agents`, `commands`, `plugins`).
 *
 * `~/.claude.json` and the session directories (`~/.claude/projects`,
 * transcripts, `todos`, `telemetry`, `sessions`, `state`) are deliberately
 * excluded: the orchestrating agent session — and any parallel session sharing
 * the same profile — writes them live while the drill runs, so a difference
 * there would not come from the product under test.
 */
export function snapshotRealHome(home) {
  const share = join(home, ".local", "share", "hyseed");
  const targets = {
    "~/.local/share/hyseed/vaults.json": join(share, "vaults.json"),
    "~/.config/hyseed/config.yaml": join(home, ".config", "hyseed", "config.yaml"),
    "~/.local/share/kb-mcp": join(home, ".local", "share", "kb-mcp"),
    "~/.config/kb-mcp": join(home, ".config", "kb-mcp"),
  };
  if (existsSync(join(share, "kb.db"))) {
    targets["~/.local/share/hyseed/kb.db"] = join(share, "kb.db");
  }
  try {
    for (const entry of readdirSync(share, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const db = join(share, entry.name, "kb.db");
      if (existsSync(db)) targets[`~/.local/share/hyseed/${entry.name}/kb.db`] = db;
    }
  } catch {
    // No current data root: nothing to add.
  }
  for (const rel of [
    ".claude/settings.json",
    ".claude/skills",
    ".claude/agents",
    ".claude/commands",
    ".claude/plugins",
  ]) {
    targets[`~/${rel}`] = join(home, ...rel.split("/"));
  }
  const snapshot = {};
  for (const [label, target] of Object.entries(targets)) {
    snapshot[label] = fingerprintPath(target);
  }
  return snapshot;
}

/** Labels whose fingerprint differs between the two snapshots. */
export function compareSnapshots(before, after) {
  const diffs = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      diffs.push(key);
    }
  }
  return diffs;
}

/** Trim a captured stream for evidence files. */
export function tail(text, max = 4000) {
  const value = (text ?? "").trim();
  if (value.length <= max) return value;
  return `... (${value.length - max} chars trimmed)\n${value.slice(-max)}`;
}