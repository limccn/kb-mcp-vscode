import * as assert from "node:assert/strict";
import {
  ServerManager,
  findFreePort,
  type ServerChild,
  type ServerOps,
} from "../../server";
import type { RuntimeResolution } from "../../runtime";

const EXE = "C:\\tools\\hyseed.exe";
const RUNTIME: RuntimeResolution = {
  exePath: EXE,
  version: "hyseed, version 0.9.0",
  candidates: [],
  fromSetting: false,
};

interface FakeChild extends ServerChild {
  exit(code: number | null): void;
  stdout(chunk: string): void;
  stderr(chunk: string): void;
}

function fakeChild(): FakeChild {
  let exitCb: ((code: number | null) => void) | null = null;
  let stdoutCb: ((chunk: string) => void) | null = null;
  let stderrCb: ((chunk: string) => void) | null = null;
  return {
    pid: 4321,
    kill() {},
    onExit(cb) {
      exitCb = cb;
    },
    onStdout(cb) {
      stdoutCb = cb;
    },
    onStderr(cb) {
      stderrCb = cb;
    },
    exit(code) {
      exitCb?.(code);
    },
    stdout(chunk) {
      stdoutCb?.(chunk);
    },
    stderr(chunk) {
      stderrCb?.(chunk);
    },
  };
}

interface OpsOptions extends Partial<ServerOps> {
  openPorts?: number[];
  page?: (port: number) => "closed" | "ours" | "other";
  portOpens?: boolean;
  portCloses?: boolean;
  dataRoot?: string;
  adminPort?: number;
  converter?: string;
}

interface TestOps extends ServerOps {
  calls: string[];
  child: FakeChild;
}

function makeOps(options: OpsOptions = {}): TestOps {
  const calls: string[] = [];
  const openPorts = new Set(options.openPorts ?? []);
  const child = fakeChild();
  const ops: TestOps = {
    calls,
    child,
    resolveRuntime: async () => RUNTIME,
    readConfig: () => ({
      runtimePath: "",
      adminPort: options.adminPort ?? 8888,
      dataRoot: options.dataRoot ?? "",
      projectVault: "",
      converterPath: "",
    }),
    resolveConverter: () => options.converter,
    spawnServer: (exePath, args, env, cwd) => {
      calls.push(
        `spawn ${exePath} ${args.join(" ")} cwd=${cwd} KB_MCP_HOME=${env.KB_MCP_HOME ?? ""}` +
          ` KB_INGEST_CONVERTER=${env.KB_INGEST_CONVERTER ?? "<unset>"}`
      );
      return child;
    },
    isPortOpen: async (port) => openPorts.has(port),
    probeAdminPage: async (port) => (options.page ?? (() => "ours"))(port),
    waitForPortOpen: async () => options.portOpens ?? true,
    waitForPortClosed: async () => options.portCloses ?? true,
    findFreePort: async (preferred) => {
      calls.push(`findFreePort ${preferred}`);
      return preferred + 1;
    },
    killTree: async (pid) => {
      calls.push(`killTree ${pid}`);
    },
  };
  return ops;
}

describe("ServerManager lifecycle", () => {
  it("starts as running-own on the preferred port", async () => {
    const ops = makeOps();
    const manager = new ServerManager(ops);
    const status = await manager.ensureRunning();
    assert.equal(status.state, "running-own");
    assert.equal(status.port, 8888);
    const spawnCall = ops.calls.find((c) => c.startsWith("spawn"));
    assert.ok(spawnCall?.includes("admin start --port 8888"));
    assert.ok(spawnCall?.includes("cwd=C:\\tools"));
  });

  it("passes the data root through KB_MCP_HOME", async () => {
    const ops = makeOps({ dataRoot: "D:\\sandbox" });
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    assert.ok(ops.calls.some((c) => c.includes("KB_MCP_HOME=D:\\sandbox")));
  });

  it("passes a resolved converter through KB_INGEST_CONVERTER", async () => {
    const ops = makeOps({ converter: "C:\\tools\\doc-convert.exe" });
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    assert.ok(
      ops.calls.some((c) => c.includes("KB_INGEST_CONVERTER=C:\\tools\\doc-convert.exe"))
    );
  });

  it("omits KB_INGEST_CONVERTER when no converter resolves", async () => {
    const ops = makeOps();
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    assert.ok(ops.calls.some((c) => c.includes("KB_INGEST_CONVERTER=<unset>")));
  });

  it("reuses an external instance without spawning or killing", async () => {
    const ops = makeOps({ openPorts: [8888] });
    const manager = new ServerManager(ops);
    const status = await manager.ensureRunning();
    assert.equal(status.state, "running-external");
    assert.ok(!ops.calls.some((c) => c.startsWith("spawn")));
    assert.ok(!ops.calls.some((c) => c.startsWith("killTree")));
  });

  it("moves to the next free port when another program holds the preferred one", async () => {
    const ops = makeOps({
      openPorts: [8888],
      page: (port) => (port === 8888 ? "other" : "ours"),
    });
    const manager = new ServerManager(ops);
    const status = await manager.ensureRunning();
    assert.equal(status.state, "running-own");
    assert.equal(status.port, 8889);
    assert.ok(ops.calls.some((c) => c === "findFreePort 8888"));
    assert.ok(ops.calls.some((c) => c.includes("--port 8889")));
  });

  it("stops the owned tree and confirms the port is released", async () => {
    const ops = makeOps();
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    const status = await manager.stop();
    assert.equal(status.state, "stopped");
    assert.equal(status.port, null);
    assert.ok(ops.calls.includes("killTree 4321"));
  });

  it("reports an error when the port does not close in time", async () => {
    const ops = makeOps({ portCloses: false });
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    await assert.rejects(
      () => manager.stop(),
      (err: Error) => /still open/.test(err.message) && /taskkill \/PID 4321 \/T \/F/.test(err.message)
    );
    assert.equal(manager.getStatus().state, "error");
    assert.equal(manager.getStatus().port, 8888);
  });

  it("shares one spawn across concurrent ensureRunning calls", async () => {
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const ops = makeOps();
    ops.waitForPortOpen = () => gate;
    const manager = new ServerManager(ops);

    const first = manager.ensureRunning();
    const second = manager.ensureRunning();
    release(true);
    const [a, b] = await Promise.all([first, second]);

    assert.equal(a.state, "running-own");
    assert.equal(b.state, "running-own");
    assert.equal(ops.calls.filter((call) => call.startsWith("spawn")).length, 1);
  });

  it("waits for an in-flight start before stopping", async () => {
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const ops = makeOps();
    ops.waitForPortOpen = () => gate;
    const manager = new ServerManager(ops);

    const start = manager.ensureRunning();
    const stop = manager.stop();
    release(true);
    const [started, stopped] = await Promise.all([start, stop]);

    assert.equal(started.state, "running-own");
    assert.equal(stopped.state, "stopped");
    assert.ok(ops.calls.includes("killTree 4321"));
  });

  it("kills a child spawned while the manager is still starting", async () => {
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const ops = makeOps();
    ops.waitForPortOpen = () => gate;
    const manager = new ServerManager(ops);

    const start = manager.ensureRunning();
    const guarded = start.catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(ops.calls.some((call) => call.startsWith("spawn")), "expected the child to spawn");

    manager.dispose();
    assert.ok(ops.calls.includes("killTree 4321"));
    release(true);
    await guarded;
    assert.equal(manager.getStatus().state, "stopped");
  });

  it("restarts an owned server", async () => {
    const ops = makeOps();
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    const status = await manager.restart();
    assert.equal(status.state, "running-own");
    assert.ok(ops.calls.includes("killTree 4321"));
    assert.equal(ops.calls.filter((call) => call.startsWith("spawn")).length, 2);
  });

  it("refuses to kill an external instance and explains why", async () => {
    const ops = makeOps({ openPorts: [8888] });
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    const status = await manager.stop();
    assert.equal(status.state, "running-external");
    assert.ok(status.message?.includes("not started by the extension"));
    assert.ok(!ops.calls.some((c) => c.startsWith("killTree")));
  });

  it("kills the spawned tree when the port answers but is not ours", async () => {
    const ops = makeOps({ page: () => "other" });
    const manager = new ServerManager(ops);
    await assert.rejects(() => manager.ensureRunning(), /does not serve the admin console/);
    assert.equal(manager.getStatus().state, "error");
    assert.ok(ops.calls.includes("killTree 4321"));
  });

  it("flips to error when the server exits unexpectedly", async () => {
    const ops = makeOps();
    const manager = new ServerManager(ops);
    await manager.ensureRunning();
    ops.child.exit(1);
    assert.equal(manager.getStatus().state, "error");
    assert.ok(manager.getStatus().message?.includes("code 1"));
  });
});

describe("findFreePort", () => {
  it("skips busy ports in the window", async () => {
    const port = await findFreePort(8888, async (candidate) => candidate < 8890, 50);
    assert.equal(port, 8890);
  });

  it("throws when the whole window is busy", async () => {
    await assert.rejects(() => findFreePort(8888, async () => true, 5), /no free port/);
  });
});