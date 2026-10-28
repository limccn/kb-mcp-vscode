/** Client for the admin ingest API plus the pre-upload folder/file planner. */

import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { request } from "node:http";
import * as path from "node:path";
import { httpErrorMessage, httpJson, type HttpJson } from "./search";

export interface IngestLimits {
  max_file_bytes: number;
  max_files: number;
  max_total_bytes: number;
}

export interface IngestJobCounts {
  uploaded: number;
  converted: number;
  failed: number;
  skipped: number;
  inserted: number;
  updated: number;
  import_errors: number;
}

export interface IngestJobSummary {
  job_id: string;
  batch_id: string;
  vault: string;
  state: string;
  counts: IngestJobCounts;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface IngestPlanFile {
  absPath: string;
  rel: string;
  size: number;
}

export interface IngestSkippedFile {
  rel: string;
  reason: string;
}

export interface IngestPlan {
  files: IngestPlanFile[];
  skipped: IngestSkippedFile[];
  totalBytes: number;
}

export interface IngestStagedFile {
  rel: string;
  size?: number;
  source?: string;
  state: string;
  error?: string | null;
}

export interface IngestFileResult {
  ok: boolean;
  file?: IngestStagedFile;
}

export interface IngestBatch {
  batch_id: string;
  vault: string;
  limits: IngestLimits;
}

export interface IngestStart {
  job_id: string;
  state: string;
}

export type IngestPlanErrorCode = "max_files" | "max_total_bytes" | "empty";

export class IngestPlanError extends Error {
  constructor(
    readonly code: IngestPlanErrorCode,
    message: string
  ) {
    super(message);
    this.name = "IngestPlanError";
  }
}

export class IngestHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly limit?: string,
    readonly limitValue?: number,
    readonly actual?: number
  ) {
    super(message);
    this.name = "IngestHttpError";
  }
}

const DEFAULT_LIMITS: IngestLimits = {
  max_file_bytes: 52_428_800,
  max_files: 200,
  max_total_bytes: 524_288_000,
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeLimits(value: Partial<IngestLimits> | null | undefined): IngestLimits {
  return {
    max_file_bytes: positiveNumber(value?.max_file_bytes, DEFAULT_LIMITS.max_file_bytes),
    max_files: positiveNumber(value?.max_files, DEFAULT_LIMITS.max_files),
    max_total_bytes: positiveNumber(value?.max_total_bytes, DEFAULT_LIMITS.max_total_bytes),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? (value[key] as number) : undefined;
}

/** Names the admin converter treats as hidden/temporary; never sent to staging. */
export function shouldSkipName(name: string): boolean {
  if (!name) return true;
  if (name.startsWith(".") || name.startsWith("~$")) return true;
  const lower = name.toLowerCase();
  return lower === "thumbs.db" || lower === "desktop.ini";
}

export async function fetchIngestLimits(
  port: number,
  http: HttpJson = httpJson
): Promise<IngestLimits> {
  const body = await http<{ limits?: Partial<IngestLimits> | null }>(port, "/api/ingest/limits");
  return normalizeLimits(body.limits);
}

export async function createIngestBatch(
  port: number,
  vault: string,
  http: HttpJson = httpJson
): Promise<IngestBatch> {
  const body = await http<{
    batch_id?: unknown;
    vault?: unknown;
    limits?: Partial<IngestLimits> | null;
  }>(port, "/api/ingest/batches", {
    method: "POST",
    body: vault ? { vault } : {},
  });
  const batchId = typeof body.batch_id === "string" ? body.batch_id : "";
  if (!batchId) throw new Error("admin server returned no ingest batch id");
  return {
    batch_id: batchId,
    vault: typeof body.vault === "string" ? body.vault : vault,
    limits: normalizeLimits(body.limits),
  };
}

export async function startIngestBatch(
  port: number,
  batchId: string,
  http: HttpJson = httpJson
): Promise<IngestStart> {
  const body = await http<{ job_id?: unknown; state?: unknown }>(
    port,
    `/api/ingest/batches/${encodeURIComponent(batchId)}/start`,
    { method: "POST" }
  );
  const jobId = typeof body.job_id === "string" ? body.job_id : "";
  if (!jobId) throw new Error("admin server returned no ingest job id");
  return { job_id: jobId, state: typeof body.state === "string" ? body.state : "queued" };
}

export async function listIngestJobs(
  port: number,
  http: HttpJson = httpJson
): Promise<IngestJobSummary[]> {
  const body = await http<{ jobs?: unknown }>(port, "/api/ingest/jobs");
  return Array.isArray(body.jobs) ? (body.jobs as IngestJobSummary[]) : [];
}

/**
 * Stream one file as multipart/form-data. The wire filename is constant ASCII;
 * the real relative name travels in the UTF-8 `rel` field. Content-Length is
 * fixed from the plan's size so a file that grows mid-upload cannot hang us.
 */
export function postIngestFile(
  port: number,
  batchId: string,
  file: IngestPlanFile,
  source: "upload" | "folder"
): Promise<IngestFileResult> {
  return new Promise<IngestFileResult>((resolve, reject) => {
    if (file.size <= 0) {
      reject(new Error(`refusing to upload empty file ${file.rel}`));
      return;
    }
    const boundary = `----hyseed${randomUUID().replace(/-/g, "")}`;
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="rel"\r\n\r\n${file.rel}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\n${source}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.bin"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
      "utf8"
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const length = prefix.length + file.size + suffix.length;
    const url = `/api/ingest/batches/${encodeURIComponent(batchId)}/files`;
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: url,
        method: "POST",
        timeout: 120_000,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": length,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const data = parseObject(body);
            reject(
              new IngestHttpError(
                httpErrorMessage(status, body),
                status,
                stringField(data, "limit"),
                numberField(data, "limit_value"),
                numberField(data, "actual")
              )
            );
            return;
          }
          try {
            resolve(JSON.parse(body) as IngestFileResult);
          } catch {
            reject(new Error(`invalid JSON from upload of ${file.rel}`));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`upload of ${file.rel} timed out`));
    });
    req.on("error", reject);
    req.write(prefix);

    const stream = createReadStream(file.absPath, { start: 0, end: file.size - 1 });
    stream.on("error", (error) => {
      req.destroy(error);
    });
    stream.on("end", () => {
      if (!req.destroyed) req.end(suffix);
    });
    req.on("close", () => {
      stream.destroy();
    });
    stream.pipe(req, { end: false });
  });
}

function addToPlan(
  files: IngestPlanFile[],
  skipped: IngestSkippedFile[],
  seen: Set<string>,
  totalBytes: number,
  limits: IngestLimits,
  absPath: string,
  rel: string,
  size: number
): number {
  const key = rel.toLowerCase();
  if (seen.has(key)) {
    skipped.push({ rel, reason: "duplicate file name" });
    return totalBytes;
  }
  if (files.length >= limits.max_files) {
    throw new IngestPlanError(
      "max_files",
      `This upload has more than ${limits.max_files} files; select fewer files or split it into batches.`
    );
  }
  if (totalBytes + size > limits.max_total_bytes) {
    throw new IngestPlanError(
      "max_total_bytes",
      `This upload is larger than ${formatBytes(limits.max_total_bytes)}; select fewer files.`
    );
  }
  seen.add(key);
  files.push({ absPath, rel, size });
  return totalBytes + size;
}

export async function planFolderUpload(
  root: string,
  limits: IngestLimits
): Promise<IngestPlan> {
  const files: IngestPlanFile[] = [];
  const skipped: IngestSkippedFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  const walk = async (dir: string, relDir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (shouldSkipName(entry.name)) {
          skipped.push({ rel, reason: "hidden folder" });
          continue;
        }
        await walk(absPath, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (shouldSkipName(entry.name)) {
        skipped.push({ rel, reason: "hidden or temporary file" });
        continue;
      }
      if (/[\r\n]/.test(entry.name)) {
        skipped.push({ rel, reason: "invalid file name" });
        continue;
      }
      const info = await fs.lstat(absPath);
      if (!info.isFile()) continue;
      if (info.size === 0) {
        skipped.push({ rel, reason: "empty file" });
        continue;
      }
      if (info.size > limits.max_file_bytes) {
        skipped.push({
          rel,
          reason: `larger than ${formatBytes(limits.max_file_bytes)}`,
        });
        continue;
      }
      totalBytes = addToPlan(files, skipped, seen, totalBytes, limits, absPath, rel, info.size);
    }
  };

  await walk(root, "");
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  skipped.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  if (!files.length) {
    throw new IngestPlanError("empty", "No uploadable files were found in that folder.");
  }
  return { files, skipped, totalBytes };
}

export async function planFileSelection(
  paths: string[],
  limits: IngestLimits
): Promise<IngestPlan> {
  const files: IngestPlanFile[] = [];
  const skipped: IngestSkippedFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const base = paths.length > 1 ? path.dirname(paths[0]) : "";

  for (const absPath of paths) {
    const name = path.basename(absPath);
    let rel = paths.length > 1 ? path.relative(base, absPath) : name;
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) rel = name;
    rel = rel.split(path.sep).join("/");
    if (rel.split("/").some((segment) => !segment || segment === "..")) {
      skipped.push({ rel: name, reason: "invalid relative path" });
      continue;
    }
    if (/[\r\n]/.test(rel)) {
      skipped.push({ rel, reason: "invalid file name" });
      continue;
    }
    if (shouldSkipName(name)) {
      skipped.push({ rel, reason: "hidden or temporary file" });
      continue;
    }
    const info = await fs.lstat(absPath);
    if (info.isSymbolicLink()) {
      skipped.push({ rel, reason: "symbolic link" });
      continue;
    }
    if (!info.isFile()) {
      skipped.push({ rel, reason: "not a file" });
      continue;
    }
    if (info.size === 0) {
      skipped.push({ rel, reason: "empty file" });
      continue;
    }
    if (info.size > limits.max_file_bytes) {
      skipped.push({ rel, reason: `larger than ${formatBytes(limits.max_file_bytes)}` });
      continue;
    }
    totalBytes = addToPlan(files, skipped, seen, totalBytes, limits, absPath, rel, info.size);
  }

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  skipped.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  if (!files.length) {
    throw new IngestPlanError("empty", "No uploadable files were selected.");
  }
  return { files, skipped, totalBytes };
}