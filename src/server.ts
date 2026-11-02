import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import {
  ADMIN_HOST_PROBE_TIMEOUT_MS,
  HTTP_PROBE_TIMEOUT_MS,
  PORT_RELEASE_TIMEOUT_MS,
  SCAN_PORT_LIMIT,
  SERVER_MARKERS,
  SERVER_START_TIMEOUT_MS,
} from "./constants";
import { readConfig, type KbMcpConfig } from "./config";
import { connectHost, DEFAULT_HOST } from "./host";
import type { RuntimeResolution } from "./runtime";
import { resolveRuntimeFromDisk } from "./runtime";
import { logLine } from "./log";

export type ServerState =
  | "stopped"
  | "starting"
  | "running-own"
  | "running-external"
  | "stopping"
  | "error";

export interface ServerStatus {
  state: ServerState;
  port: number | null;
  /** Listen address; absent on older literals means the loopback default. */
  host?: string | null;
  message: string | null;
}

export interface ServerChild {
  pid?: number;
  kill(): void;
  onExit(cb: (code: number | null) => void): void;
  onStdout(cb: (chunk: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
}

export interface ServerOps {
  resolveRuntime(): Promise<RuntimeResolution>;
  readConfig(): KbMcpConfig;
  spawnServer(exePath: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): ServerChild;
  isPortOpen(host: string, port: number): Promise<boolean>;
  probeAdminPage(host: string, port: number): Promise<"closed" | "ours" | "other">;
  waitForPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean>;
  waitForPortClosed(host: string, port: number, timeoutMs: number): Promise<boolean>;
  findFreePort(host: string, preferred: number): Promise<number>;
  killTree(pid: number): Promise<void>;
  /** Optional: explicit or auto-discovered document converter for ingest. */
  resolveConverter?(runtime: RuntimeResolution): string | undefined;
  /** Optional: probes `admin start --help`; only called for a non-default host. */
  supportsAdminHost?(exePath: string): Promise<boolean>;
  /** Optional: fires for a non-default admin host before every spawn. */
  warnAdminHost?(host: string): void;
}

export class ServerManager {
  private state: ServerState = "stopped";
  private port: number | null = null;
  private host: string = DEFAULT_HOST;
  private message: string | null = null;
  private child: ServerChild | null = null;
  private startPromise: Promise<ServerStatus> | null = null;
  private disposed = false;

  constructor(
    private readonly ops: ServerOps,
    private readonly onStatus: (status: ServerStatus) => void = () => {}
  ) {}

  getStatus(): ServerStatus {
    return { state: this.state, port: this.port, host: this.host, message: this.message };
  }

  async ensureRunning(): Promise<ServerStatus> {
    if (this.state === "running-own" || this.state === "running-external") {
      return this.getStatus();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<ServerStatus> {
    try {
      logLine("ensureRunning: resolving runtime");
      const runtime = await this.ops.resolveRuntime();
      logLine(`ensureRunning: runtime=${runtime.exePath} (${runtime.version})`);
      const config = this.ops.readConfig();
      const preferred = config.adminPort;
      const listen = config.adminHost || DEFAULT_HOST;
      const connect = connectHost(listen);
      const customHost = listen !== DEFAULT_HOST;
      this.host = listen;
      if (customHost) this.ops.warnAdminHost?.(listen);

      let port = preferred;
      if (await this.ops.isPortOpen(connect, preferred)) {
        const page = await this.ops.probeAdminPage(connect, preferred);
        logLine(`ensureRunning: preferred port ${preferred} page=${page}`);
        if (page === "ours") {
          this.setStatus("running-external", preferred, "reusing an existing admin instance");
          return this.getStatus();
        }
        port = await this.ops.findFreePort(connect, preferred);
      } else if (customHost && (await this.ops.isPortOpen(DEFAULT_HOST, preferred))) {
        logLine(
          `ensureRunning: an admin instance listens on ${DEFAULT_HOST}:${preferred}; ` +
            `not reusing it because kbMcp.adminHost is ${listen}`
        );
      }

      if (this.disposed) {
        throw new Error("server manager was disposed during startup");
      }
      if (customHost && this.ops.supportsAdminHost) {
        const supported = await this.ops.supportsAdminHost(runtime.exePath);
        logLine(`ensureRunning: admin --host support=${supported}`);
        if (!supported) {
          throw new Error(
            `runtime ${runtime.exePath} does not support 'admin start --host'; ` +
              `update hyseed or set kbMcp.adminHost to ${DEFAULT_HOST}`
          );
        }
      }
      const converter = this.ops.resolveConverter?.(runtime);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(config.dataRoot ? { KB_MCP_HOME: config.dataRoot } : {}),
        ...(converter ? { KB_INGEST_CONVERTER: converter } : {}),
      };
      this.setStatus("starting", port, null);
      const args = customHost
        ? ["admin", "start", "--host", listen, "--port", String(port)]
        : ["admin", "start", "--port", String(port)];
      logLine(`starting server: ${runtime.exePath} ${args.join(" ")}`);
      const child = this.ops.spawnServer(
        runtime.exePath,
        args,
        env,
        dirname(runtime.exePath)
      );
      this.child = child;
      child.onStdout((chunk) => logLine(`[server] ${chunk.trimEnd()}`));
      child.onStderr((chunk) => logLine(`[server:err] ${chunk.trimEnd()}`));
      let rejectStartup: ((err: Error) => void) | null = null;
      const exitDuringStartup = new Promise<never>((_, reject) => {
        rejectStartup = reject;
      });
      exitDuringStartup.catch(() => undefined);
      child.onExit((code) => {
        if (this.child !== child) return;
        const message = `server exited unexpectedly (code ${code})`;
        const duringStartup = this.state === "starting";
        this.child = null;
        if (this.state === "starting" || this.state === "running-own") {
          this.setStatus("error", this.port, message);
        }
        if (duringStartup) rejectStartup?.(new Error(message));
      });

      logLine(`ensureRunning: waiting for port ${port} to open`);
      const opened = await Promise.race([
        this.ops.waitForPortOpen(connect, port, SERVER_START_TIMEOUT_MS),
        exitDuringStartup,
      ]);
      logLine(`ensureRunning: port ${port} open=${opened}`);
      if (!opened) {
        throw new Error(`server did not open port ${port} within ${SERVER_START_TIMEOUT_MS}ms`);
      }
      const page = await this.ops.probeAdminPage(connect, port);
      logLine(`ensureRunning: admin page probe=${page}`);
      if (page === "closed") {
        throw new Error(`server closed port ${port} during startup`);
      }
      if (page !== "ours") {
        throw new Error(`port ${port} does not serve the admin console`);
      }
      if (this.disposed) {
        throw new Error("server manager was disposed during startup");
      }
      this.setStatus("running-own", port, null);
      return this.getStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const child = this.child;
      this.child = null;
      if (child?.pid !== undefined) {
        await this.ops.killTree(child.pid).catch(() => undefined);
      } else {
        child?.kill();
      }
      if (!this.disposed) {
        this.setStatus("error", this.port, message);
      }
      throw err;
    }
  }

  async stop(): Promise<ServerStatus> {
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    if (this.state === "running-external") {
      this.setStatus(
        "running-external",
        this.port,
        "this instance was not started by the extension; stop it where it was launched"
      );
      return this.getStatus();
    }
    if (this.state !== "running-own") {
      return this.getStatus();
    }

    const child = this.child;
    const port = this.port;
    const pid = child?.pid;
    this.setStatus("stopping", port, null);
    if (child?.pid !== undefined) {
      await this.ops.killTree(child.pid).catch(() => undefined);
    } else {
      child?.kill();
    }
    this.child = null;

    const closed =
      port === null
        ? true
        : await this.ops.waitForPortClosed(connectHost(this.host), port, PORT_RELEASE_TIMEOUT_MS);
    if (!closed) {
      const hint =
        pid !== undefined ? ` (pid ${pid}); try: taskkill /PID ${pid} /T /F` : "";
      const message = `port ${port} is still open after stopping${hint}`;
      this.setStatus("error", port, message);
      throw new Error(message);
    }
    this.setStatus("stopped", null, null);
    return this.getStatus();
  }

  async restart(): Promise<ServerStatus> {
    if (this.state === "running-own") {
      await this.stop();
    }
    return this.ensureRunning();
  }

  dispose(): void {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    if (child) {
      if (child.pid !== undefined) {
        void this.ops.killTree(child.pid).catch(() => undefined);
      } else {
        child.kill();
      }
    }
    this.state = "stopped";
    this.port = null;
    this.message = null;
  }

  private setStatus(state: ServerState, port: number | null, message: string | null): void {
    this.state = state;
    this.port = port;
    this.message = message;
    this.onStatus(this.getStatus());
  }
}

export async function findFreePort(
  preferred: number,
  isOpen: (port: number) => Promise<boolean>,
  limit: number = SCAN_PORT_LIMIT
): Promise<number> {
  for (let port = preferred; port < preferred + limit; port++) {
    if (port > 65535) break;
    if (!(await isOpen(port))) {
      return port;
    }
  }
  throw new Error(`no free port found in [${preferred}, ${preferred + limit})`);
}

export function isPortOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPortOpen(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return true;
    await delay(250);
  }
  return isPortOpen(host, port);
}

export async function waitForPortClosed(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(host, port))) return true;
    await delay(250);
  }
  return !(await isPortOpen(host, port));
}

export function probeAdminPage(
  host: string,
  port: number,
  timeoutMs: number = HTTP_PROBE_TIMEOUT_MS
): Promise<"closed" | "ours" | "other"> {
  return new Promise((resolve) => {
    let settled = false;
    let body = "";
    const finish = (result: "closed" | "ours" | "other") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = request(
      { host, port, path: "/", method: "GET", timeout: timeoutMs },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length < 262_144) body += chunk;
        });
        res.on("end", () => {
          const markerFound = SERVER_MARKERS.some((marker) => body.includes(marker));
          finish(res.statusCode === 200 && markerFound ? "ours" : "other");
        });
        res.on("error", () => finish("other"));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      finish("other");
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ECONNREFUSED" ? "closed" : "other");
    });
    req.end();
  });
}

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

function spawnServerAdapter(
  exePath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
): ServerChild {
  const child = spawn(exePath, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const listeners: {
    exit?: (code: number | null) => void;
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
  } = {};
  child.stdout?.on("data", (chunk: Buffer) => listeners.stdout?.(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => listeners.stderr?.(chunk.toString()));
  child.on("exit", (code) => listeners.exit?.(code));
  child.on("error", (err) => {
    logLine(`spawn failed: ${err.message}`);
    listeners.exit?.(null);
  });
  return {
    pid: child.pid,
    kill: () => child.kill(),
    onExit: (cb) => {
      listeners.exit = cb;
    },
    onStdout: (cb) => {
      listeners.stdout = cb;
    },
    onStderr: (cb) => {
      listeners.stderr = cb;
    },
  };
}

const adminHostProbes = new Map<string, boolean>();

/**
 * Does this runtime understand `admin start --host`? The version string cannot
 * tell old and new frozen builds apart (both report 0.9.0), so ask the CLI once
 * per exe build (size + mtime key). Only called for a non-default host.
 */
export async function probeAdminHostSupport(exePath: string): Promise<boolean> {
  let key: string;
  try {
    const info = await stat(exePath);
    key = `${exePath}|${info.size}|${info.mtimeMs}`;
  } catch {
    return false;
  }
  const cached = adminHostProbes.get(key);
  if (cached !== undefined) return cached;

  const supported = await new Promise<boolean>((resolve) => {
    let output = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(exePath, ["admin", "start", "--help"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, ADMIN_HOST_PROBE_TIMEOUT_MS);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", () => finish(false));
    // Decide on close: stdout may still be draining when exit fires.
    child.on("close", () => finish(output.includes("--host")));
  });
  adminHostProbes.set(key, supported);
  return supported;
}

export function createServerOps(extensionPath: string): ServerOps {
  return {
    resolveRuntime: () => resolveRuntimeFromDisk(readConfig(), extensionPath),
    readConfig,
    spawnServer: spawnServerAdapter,
    isPortOpen: (host, port) => isPortOpen(host, port),
    probeAdminPage: (host, port) => probeAdminPage(host, port),
    waitForPortOpen: (host, port, timeoutMs) => waitForPortOpen(host, port, timeoutMs),
    waitForPortClosed: (host, port, timeoutMs) => waitForPortClosed(host, port, timeoutMs),
    findFreePort: (host, preferred) => findFreePort(preferred, (port) => isPortOpen(host, port)),
    killTree: (pid) => killTree(pid),
    supportsAdminHost: (exePath) => probeAdminHostSupport(exePath),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}