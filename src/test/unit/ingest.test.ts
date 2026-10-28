import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
  IngestHttpError,
  IngestPlanError,
  createIngestBatch,
  fetchIngestLimits,
  listIngestJobs,
  planFileSelection,
  planFolderUpload,
  postIngestFile,
  shouldSkipName,
  startIngestBatch,
  type IngestLimits,
  type IngestPlanFile,
} from "../../ingest";
import type { HttpJson, HttpJsonOptions } from "../../search";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hyseed-ingest-"));
  roots.push(dir);
  return dir;
}

async function writeFile(root: string, rel: string, content: string | Buffer): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}

function limits(overrides: Partial<IngestLimits> = {}): IngestLimits {
  return {
    max_file_bytes: 1024,
    max_files: 20,
    max_total_bytes: 10_000,
    ...overrides,
  };
}

function reasonOf(plan: { skipped: { rel: string; reason: string }[] }, rel: string): string {
  const entry = plan.skipped.find((item) => item.rel === rel);
  assert.ok(entry, `missing skipped entry ${rel}`);
  return entry.reason;
}

after(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ingest planner", () => {
  it("skips hidden/temporary names", () => {
    assert.equal(shouldSkipName(""), true);
    assert.equal(shouldSkipName(".env"), true);
    assert.equal(shouldSkipName("~$draft.docx"), true);
    assert.equal(shouldSkipName("Thumbs.db"), true);
    assert.equal(shouldSkipName("desktop.INI"), true);
    assert.equal(shouldSkipName("notes.md"), false);
  });

  it("walks a folder, skips hidden/oversized/empty files, and sorts relative paths", async () => {
    const root = await tempRoot();
    await writeFile(root, "visible.md", "hello");
    await writeFile(root, "sub/nested.md", "nested!");
    await writeFile(root, ".hidden.md", "hidden");
    await writeFile(root, "~$draft.docx", "temp");
    await writeFile(root, "Thumbs.db", "cache");
    await writeFile(root, ".git/config", "ignored");
    await writeFile(root, "big.bin", Buffer.alloc(21));
    await writeFile(root, "empty.md", "");

    const plan = await planFolderUpload(root, limits({ max_file_bytes: 20 }));
    assert.deepEqual(plan.files.map((file) => file.rel), ["sub/nested.md", "visible.md"]);
    assert.equal(plan.totalBytes, 12);
    for (const file of plan.files) assert.ok(path.isAbsolute(file.absPath), file.rel);

    assert.equal(reasonOf(plan, ".git"), "hidden folder");
    assert.equal(reasonOf(plan, ".hidden.md"), "hidden or temporary file");
    assert.equal(reasonOf(plan, "~$draft.docx"), "hidden or temporary file");
    assert.equal(reasonOf(plan, "Thumbs.db"), "hidden or temporary file");
    assert.equal(reasonOf(plan, "big.bin"), "larger than 20 B");
    assert.equal(reasonOf(plan, "empty.md"), "empty file");
  });

  it("stops a folder walk at the file-count limit", async () => {
    const root = await tempRoot();
    for (const name of ["a.md", "b.md", "c.md"]) await writeFile(root, name, "x");
    await assert.rejects(
      planFolderUpload(root, limits({ max_files: 2 })),
      (error: unknown) => error instanceof IngestPlanError && error.code === "max_files"
    );
  });

  it("stops a folder walk at the total-bytes limit", async () => {
    const root = await tempRoot();
    await writeFile(root, "a.md", "123456");
    await writeFile(root, "b.md", "123456");
    await assert.rejects(
      planFolderUpload(root, limits({ max_total_bytes: 10 })),
      (error: unknown) => error instanceof IngestPlanError && error.code === "max_total_bytes"
    );
  });

  it("rejects a folder with nothing uploadable", async () => {
    const root = await tempRoot();
    await writeFile(root, ".hidden.md", "hidden");
    await writeFile(root, "Thumbs.db", "cache");
    await assert.rejects(
      planFolderUpload(root, limits()),
      (error: unknown) => error instanceof IngestPlanError && error.code === "empty"
    );

    const empty = await tempRoot();
    await assert.rejects(
      planFolderUpload(empty, limits()),
      (error: unknown) => error instanceof IngestPlanError && error.code === "empty"
    );
  });

  it("plans a single file and files from a shared directory", async () => {
    const root = await tempRoot();
    const one = await writeFile(root, "a/one.md", "hello");
    const two = await writeFile(root, "a/two.md", "world!");

    const single = await planFileSelection([one], limits());
    assert.deepEqual(single.files.map((file) => file.rel), ["one.md"]);

    const pair = await planFileSelection([one, two], limits());
    assert.deepEqual(pair.files.map((file) => file.rel), ["one.md", "two.md"]);
    assert.equal(pair.totalBytes, 11);
  });

  it("falls back to basenames across directories and reports collisions", async () => {
    const root = await tempRoot();
    const one = await writeFile(root, "a/one.md", "hello");
    const three = await writeFile(root, "b/three.md", "world!");
    const cross = await planFileSelection([one, three], limits());
    assert.deepEqual(cross.files.map((file) => file.rel), ["one.md", "three.md"]);

    const duplicate = await writeFile(root, "b/one.md", "other");
    const collided = await planFileSelection([one, duplicate], limits());
    assert.deepEqual(collided.files.map((file) => file.rel), ["one.md"]);
    assert.equal(reasonOf(collided, "one.md"), "duplicate file name");
  });

  it("skips hidden, empty, and oversized selections", async () => {
    const root = await tempRoot();
    const one = await writeFile(root, "one.md", "hello");
    const hidden = await writeFile(root, ".hidden.md", "hidden");
    const empty = await writeFile(root, "empty.md", "");
    const big = await writeFile(root, "big.bin", Buffer.alloc(21));
    const plan = await planFileSelection([one, hidden, empty, big], limits({ max_file_bytes: 20 }));
    assert.deepEqual(plan.files.map((file) => file.rel), ["one.md"]);
    assert.equal(reasonOf(plan, ".hidden.md"), "hidden or temporary file");
    assert.equal(reasonOf(plan, "empty.md"), "empty file");
    assert.equal(reasonOf(plan, "big.bin"), "larger than 20 B");
  });

  it("rejects a selection with nothing uploadable", async () => {
    await assert.rejects(
      planFileSelection([], limits()),
      (error: unknown) => error instanceof IngestPlanError && error.code === "empty"
    );
  });
});

interface Capture {
  body: Buffer;
  headers: IncomingHttpHeaders;
}

async function startServer(
  respond: (capture: Capture) => { status: number; body: string }
): Promise<{ port: number; captures: Capture[]; close: () => Promise<void> }> {
  const captures: Capture[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const capture: Capture = { body: Buffer.concat(chunks), headers: req.headers };
      captures.push(capture);
      const reply = respond(capture);
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    captures,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

function fieldBuffer(body: Buffer, name: string): Buffer {
  const marker = Buffer.from(`name="${name}"`);
  const start = body.indexOf(marker);
  assert.ok(start >= 0, `missing field ${name}`);
  const valueStart = body.indexOf(Buffer.from("\r\n\r\n"), start) + 4;
  const valueEnd = body.indexOf(Buffer.from("\r\n--"), valueStart);
  assert.ok(valueEnd > valueStart, `unterminated field ${name}`);
  return body.subarray(valueStart, valueEnd);
}

function field(body: Buffer, name: string): string {
  return fieldBuffer(body, name).toString("utf8");
}

describe("ingest HTTP client", () => {
  it("streams a UTF-8 rel and exact bytes with a consistent Content-Length", async () => {
    const root = await tempRoot();
    const content = Buffer.from("hello 世界");
    const absPath = await writeFile(root, "note.md", content);
    const file: IngestPlanFile = { absPath, rel: "日本語/note.md", size: content.length };
    const server = await startServer(() => ({
      status: 201,
      body: JSON.stringify({ ok: true, file: { rel: file.rel, state: "staged" } }),
    }));
    try {
      const result = await postIngestFile(server.port, "batch-1", file, "folder");
      assert.equal(result.ok, true);
      assert.equal(result.file?.state, "staged");
      assert.equal(server.captures.length, 1);
      const capture = server.captures[0];
      assert.equal(Number(capture.headers["content-length"]), capture.body.length);
      assert.match(String(capture.headers["content-type"]), /^multipart\/form-data; boundary=/);
      assert.equal(field(capture.body, "rel"), "日本語/note.md");
      assert.equal(field(capture.body, "source"), "folder");
      assert.deepEqual(fieldBuffer(capture.body, "file"), content);
      assert.ok(capture.body.includes(Buffer.from('filename="upload.bin"')));
    } finally {
      await server.close();
    }
  });

  it("returns a per-file rejection instead of throwing", async () => {
    const root = await tempRoot();
    const absPath = await writeFile(root, "note.md", "x");
    const file: IngestPlanFile = { absPath, rel: "note.md", size: 1 };
    const server = await startServer(() => ({
      status: 200,
      body: JSON.stringify({
        ok: false,
        file: { rel: "note.md", state: "rejected", error: "too big" },
      }),
    }));
    try {
      const result = await postIngestFile(server.port, "batch-1", file, "upload");
      assert.equal(result.ok, false);
      assert.equal(result.file?.error, "too big");
    } finally {
      await server.close();
    }
  });

  it("parses a 409 batch-limit refusal", async () => {
    const root = await tempRoot();
    const absPath = await writeFile(root, "note.md", "x");
    const file: IngestPlanFile = { absPath, rel: "note.md", size: 1 };
    const server = await startServer(() => ({
      status: 409,
      body: JSON.stringify({
        ok: false,
        error: "batch limit exceeded",
        limit: "max_files",
        limit_value: 2,
        actual: 3,
      }),
    }));
    try {
      await assert.rejects(
        postIngestFile(server.port, "batch-1", file, "upload"),
        (error: unknown) => {
          assert.ok(error instanceof IngestHttpError);
          assert.equal(error.status, 409);
          assert.equal(error.limit, "max_files");
          assert.equal(error.limitValue, 2);
          assert.equal(error.actual, 3);
          return true;
        }
      );
    } finally {
      await server.close();
    }
  });

  it("wraps limits, batch creation, start, and job listing", async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const http: HttpJson = async <T>(
      _port: number,
      requestPath: string,
      options?: HttpJsonOptions
    ) => {
      calls.push({
        path: requestPath,
        method: options?.method ?? "GET",
        body: options?.body,
      });
      if (requestPath === "/api/ingest/limits") {
        return { limits: { max_file_bytes: 1, max_files: 2, max_total_bytes: 3 } } as T;
      }
      if (requestPath === "/api/ingest/batches") {
        return {
          batch_id: "b1",
          vault: "v",
          limits: { max_file_bytes: 1, max_files: 2, max_total_bytes: 3 },
        } as T;
      }
      if (requestPath.endsWith("/start")) return { job_id: "j1", state: "queued" } as T;
      return { jobs: [{ job_id: "j1", state: "queued" }] } as T;
    };

    assert.deepEqual(await fetchIngestLimits(1, http), {
      max_file_bytes: 1,
      max_files: 2,
      max_total_bytes: 3,
    });
    assert.deepEqual(await createIngestBatch(1, "v", http), {
      batch_id: "b1",
      vault: "v",
      limits: { max_file_bytes: 1, max_files: 2, max_total_bytes: 3 },
    });
    assert.deepEqual(await startIngestBatch(1, "b1", http), { job_id: "j1", state: "queued" });
    assert.deepEqual(await listIngestJobs(1, http), [{ job_id: "j1", state: "queued" }]);

    assert.deepEqual(calls, [
      { path: "/api/ingest/limits", method: "GET", body: undefined },
      { path: "/api/ingest/batches", method: "POST", body: { vault: "v" } },
      { path: "/api/ingest/batches/b1/start", method: "POST", body: undefined },
      { path: "/api/ingest/jobs", method: "GET", body: undefined },
    ]);
  });

  it("omits an empty vault and falls back to the server limits", async () => {
    let body: unknown;
    const http: HttpJson = async <T>(
      _port: number,
      requestPath: string,
      options?: HttpJsonOptions
    ) => {
      if (requestPath === "/api/ingest/batches") {
        body = options?.body;
        return { batch_id: "b1", vault: "current" } as T;
      }
      return {} as T;
    };
    assert.equal((await createIngestBatch(1, "", http)).vault, "current");
    assert.deepEqual(body, {});
    assert.deepEqual(await fetchIngestLimits(1, http), {
      max_file_bytes: 52_428_800,
      max_files: 200,
      max_total_bytes: 524_288_000,
    });
  });

  it("rejects malformed batch and job responses", async () => {
    const noBatch: HttpJson = async <T>() => ({}) as T;
    await assert.rejects(createIngestBatch(1, "v", noBatch), /no ingest batch id/);
    await assert.rejects(startIngestBatch(1, "b1", noBatch), /no ingest job id/);
  });
});