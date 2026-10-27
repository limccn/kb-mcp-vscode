import { spawn } from "node:child_process";
import { request } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import {
  HTTP_PROBE_TIMEOUT_MS,
  PORT_RELEASE_TIMEOUT_MS,
  SCAN_PORT_LIMIT,
  SERVER_MARKERS,
  SERVER_START_TIMEOUT_MS,
} from "./constants";
import { readConfig, type KbMcpConfig } from "./config";
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
  isPortOpen(port: number): Promise<boolean>;
  probeAdminPage(port: number): Promise<"closed" | "ours" | "other">;
  waitForPortOpen(port: number, timeoutMs: number): Promise<boolean>;
  waitForPortClosed(port: number, timeoutMs: number): Promise<boolean>;
  findFreePort(preferred: number): Promise<number>;
  killTree(pid: number): Promise<void>;
  /** Optional: explicit or auto-discovered document converter for ingest. */
  resolveConverter?(runtime: RuntimeResolution): string | undefined;
}

export class ServerManager {
  private state: ServerState = "stopped";
  private port: number | null = null;
  private message: string | null = null;
  private child: ServerChild | null = null;
  private startPromise: Promise<ServerStatus> | null = null;
  private disposed = false;

  constructor(
    private readonly ops: ServerOps,
    private readonly onStatus: (status: ServerStatus) => void = () => {}
  ) {}

  getStatus(): ServerStatus {
    return { state: this.state, port: this.port, message: this.message };
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

      let port = preferred;
      if (await this.ops.isPortOpen(preferred)) {
        const page = await this.ops.probeAdminPage(preferred);
        logLine(`ensureRunning: preferred port ${preferred} page=${page}`);
        if (page === "ours") {
          this.setStatus("running-external", preferred, "reusing an existing admin instance");
          return this.getStatus();
        }
        port = await this.ops.findFreePort(preferred);
      }

      if (this.disposed) {
        throw new Error("server manager was disposed during startup");
      }
      const converter = this.ops.resolveConverter?.(runtime);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(config.dataRoot ? { KB_MCP_HOME: config.dataRoot } : {}),
        ...(converter ? { KB_INGEST_CONVERTER: converter } : {}),
      };
      this.setStatus("starting", port, null);
      logLine(`starting server: ${runtime.exePath} admin start --port ${port}`);
      const child = this.ops.spawnServer(
        runtime.exePath,
        ["admin", "start", "--port", String(port)],
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
        this.ops.waitForPortOpen(port, SERVER_START_TIMEOUT_MS),
        exitDuringStartup,
      ]);
      logLine(`ensureRunning: port ${port} open=${opened}`);
      if (!opened) {
        throw new Error(`server did not open port ${port} within ${SERVER_START_TIMEOUT_MS}ms`);
      }
      const page = await this.ops.probeAdminPage(port);
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

    const closed = port === null ? true : await this.ops.waitForPortClosed(port, PORT_RELEASE_TIMEOUT_MS);
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

export function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
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

export async function waitForPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await delay(250);
  }
  return isPortOpen(port);
}

export async function waitForPortClosed(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await delay(250);
  }
  return !(await isPortOpen(port));
}

export function probeAdminPage(
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
      { host: "127.0.0.1", port, path: "/", method: "GET", timeout: timeoutMs },
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

export function createServerOps(extensionPath: string): ServerOps {
  return {
    resolveRuntime: () => resolveRuntimeFromDisk(readConfig(), extensionPath),
    readConfig,
    spawnServer: spawnServerAdapter,
    isPortOpen: (port) => isPortOpen(port),
    probeAdminPage: (port) => probeAdminPage(port),
    waitForPortOpen: (port, timeoutMs) => waitForPortOpen(port, timeoutMs),
    waitForPortClosed: (port, timeoutMs) => waitForPortClosed(port, timeoutMs),
    findFreePort: (preferred) => findFreePort(preferred, (port) => isPortOpen(port)),
    killTree: (pid) => killTree(pid),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}