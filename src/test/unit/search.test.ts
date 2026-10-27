import * as assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  fetchVaults,
  httpJson,
  normalizeLimit,
  runSearch,
  searchPath,
  switchVault,
  type HttpJson,
  type HttpJsonOptions,
} from "../../search";

describe("admin search client", () => {
  it("builds the search query with defaults and optional filters", () => {
    assert.equal(
      searchPath({ query: "  drizzle schema  " }),
      "/api/search?query=drizzle+schema&mode=hybrid&limit=10"
    );
    assert.equal(
      searchPath({ query: "中文 查询", mode: "fuzzy", limit: 500, type: " howto ", tags: " a,b " }),
      "/api/search?query=%E4%B8%AD%E6%96%87+%E6%9F%A5%E8%AF%A2&mode=fuzzy&limit=100&type=howto&tags=a%2Cb"
    );
  });

  it("rejects an empty query and normalizes limit/mode", () => {
    assert.throws(() => searchPath({ query: "   " }), /query must not be empty/);
    assert.equal(normalizeLimit(undefined), 10);
    assert.equal(normalizeLimit(0), 1);
    assert.equal(normalizeLimit(101), 100);
    assert.equal(normalizeLimit(12.9), 12);
    assert.ok(searchPath({ query: "x", mode: "nope" }).includes("mode=hybrid"));
  });

  it("switches the vault only when it differs, then searches", async () => {
    const calls: { method: string; path: string }[] = [];
    const http: HttpJson = async <T>(_port: number, path: string, options?: HttpJsonOptions) => {
      calls.push({ method: options?.method ?? "GET", path });
      if (path === "/api/vaults/switch") return { ok: true, current: "next" } as T;
      return { hits: [], count: 0 } as T;
    };

    const outcome = await runSearch(1, { query: "x", vault: "next" }, "default", { http });
    assert.equal(outcome.current, "next");
    assert.deepEqual(calls, [
      { method: "POST", path: "/api/vaults/switch" },
      { method: "GET", path: "/api/search?query=x&mode=hybrid&limit=10" },
    ]);

    calls.length = 0;
    const same = await runSearch(1, { query: "x", vault: "default" }, "default", { http });
    assert.equal(same.current, "default");
    assert.deepEqual(calls, [
      { method: "GET", path: "/api/search?query=x&mode=hybrid&limit=10" },
    ]);
  });

  it("reports a successful switch before the search runs", async () => {
    const seen: string[] = [];
    const http: HttpJson = async <T>(_port: number, path: string) => {
      if (path === "/api/vaults/switch") return { ok: true, current: "next" } as T;
      return { hits: [], count: 0 } as T;
    };
    await runSearch(1, { query: "x", vault: "next" }, "default", {
      http,
      onVaultChanged: (current) => seen.push(current),
    });
    assert.deepEqual(seen, ["next"]);
  });

  it("fetches the vault registry", async () => {
    const http: HttpJson = async <T>(_port: number, path: string) => {
      assert.equal(path, "/api/vaults");
      return { current: "default", vaults: [{ name: "default", description: "main" }] } as T;
    };
    assert.deepEqual(await fetchVaults(1, http), {
      current: "default",
      vaults: [{ name: "default", description: "main" }],
    });
  });

  it("switches via POST and returns the current vault", async () => {
    let received: unknown;
    const http: HttpJson = async <T>(_port: number, path: string, options?: HttpJsonOptions) => {
      assert.equal(path, "/api/vaults/switch");
      assert.equal(options?.method, "POST");
      received = options?.body;
      return { ok: true, current: "other" } as T;
    };
    assert.equal(await switchVault(1, "other", http), "other");
    assert.deepEqual(received, { name: "other" });
  });
});

describe("httpJson", () => {
  let server: ReturnType<typeof createServer>;
  let port = 0;

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (req.url === "/ok") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ method: req.method, body: body ? JSON.parse(body) : null }));
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad query" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("posts JSON and parses the response", async () => {
    const data = await httpJson<{ method: string; body: { name: string } }>(port, "/ok", {
      method: "POST",
      body: { name: "x" },
    });
    assert.deepEqual(data, { method: "POST", body: { name: "x" } });
  });

  it("surfaces the admin error message", async () => {
    await assert.rejects(httpJson(port, "/bad"), /HTTP 400: bad query/);
  });
});