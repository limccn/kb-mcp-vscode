import { request } from "node:http";

export interface SearchParams {
  query: string;
  vault?: string;
  type?: string;
  tags?: string;
  mode?: string;
  limit?: number;
}

export interface AdminVault {
  name: string;
  description?: string;
  sync_dir?: string;
}

export interface AdminVaults {
  current: string;
  vaults: AdminVault[];
}

export interface SearchDoc {
  id: string;
  type: string;
  title: string;
  tags?: string[];
  body?: string;
}

export interface SearchHitPayload {
  doc: SearchDoc;
  snippet?: string;
  score?: number;
}

export interface AdminSearchResponse {
  hits: SearchHitPayload[];
  count: number;
}

export interface HttpJsonOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

export type HttpJson = <T>(port: number, path: string, options?: HttpJsonOptions) => Promise<T>;

const SEARCH_MODES = ["lexical", "fuzzy", "semantic", "hybrid", "rrf"] as const;

export function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 10;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

/** Build the admin search URL; invalid modes fall back to hybrid, limits clamp to 1..100. */
export function searchPath(params: SearchParams): string {
  const query = params.query.trim();
  if (!query) throw new Error("query must not be empty");
  const mode = SEARCH_MODES.find((candidate) => candidate === params.mode) ?? "hybrid";
  const search = new URLSearchParams({
    query,
    mode,
    limit: String(normalizeLimit(params.limit)),
  });
  if (params.type?.trim()) search.set("type", params.type.trim());
  if (params.tags?.trim()) search.set("tags", params.tags.trim());
  return `/api/search?${search.toString()}`;
}

/** Minimal JSON client for the loopback admin server. */
export function httpJson<T>(port: number, path: string, options: HttpJsonOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const method = options.method ?? "GET";
    const payload = options.body === undefined ? null : JSON.stringify(options.body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        timeout: options.timeoutMs ?? 30_000,
        headers:
          payload === null
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(errorMessage(status, data)));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`invalid JSON from ${path}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`request to ${path} timed out`));
    });
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function errorMessage(status: number, body: string): string {
  const text = body.trim();
  if (!text) return `HTTP ${status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; detail?: unknown };
    const detail = parsed.error ?? parsed.detail;
    if (typeof detail === "string" && detail) return `HTTP ${status}: ${detail}`;
    if (detail !== undefined) return `HTTP ${status}: ${JSON.stringify(detail)}`;
  } catch {
    // Not JSON: keep the raw body below.
  }
  return `HTTP ${status}: ${text.slice(0, 300)}`;
}

export function fetchVaults(port: number, http: HttpJson = httpJson): Promise<AdminVaults> {
  return http<AdminVaults>(port, "/api/vaults");
}

export async function switchVault(
  port: number,
  name: string,
  http: HttpJson = httpJson
): Promise<string> {
  const body = await http<{ current?: string }>(port, "/api/vaults/switch", {
    method: "POST",
    body: { name },
  });
  return body.current ?? name;
}

export interface SearchOutcome {
  current: string;
  result: AdminSearchResponse;
}

export interface RunSearchOptions {
  http?: HttpJson;
  /** Called as soon as the switch succeeds, before the search request. */
  onVaultChanged?: (current: string) => void;
}

/**
 * Switch the admin server's global current vault only when needed, then search.
 * Search hits/searches run against the same store as the admin UI.
 */
export async function runSearch(
  port: number,
  params: SearchParams,
  currentVault: string,
  options: RunSearchOptions = {}
): Promise<SearchOutcome> {
  const http = options.http ?? httpJson;
  let current = currentVault;
  if (params.vault && params.vault !== currentVault) {
    current = await switchVault(port, params.vault, http);
    options.onVaultChanged?.(current);
  }
  const result = await http<AdminSearchResponse>(port, searchPath(params));
  return { current, result };
}