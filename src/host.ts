import { isIP } from "node:net";

export const DEFAULT_HOST = "127.0.0.1";

export interface HostBinding {
  /** Value passed to `--host` / uvicorn; wildcard addresses stay as written. */
  listen: string;
  /** Address clients connect to: 0.0.0.0 -> 127.0.0.1, :: -> ::1. */
  connect: string;
  /** `connect` formatted for a URL authority (IPv6 gets brackets). */
  urlHost: string;
  /** True when the listen address can be reached from outside this machine. */
  nonLoopback: boolean;
  /** Set when the input was rejected; the remaining fields are the default. */
  error: string | null;
}

function isLoopback(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) return value.startsWith("127.");
  if (kind === 6) return value === "::1";
  return value.toLowerCase() === "localhost";
}

function binding(listen: string): HostBinding {
  let connect = listen;
  if (listen === "0.0.0.0") connect = "127.0.0.1";
  else if (listen === "::") connect = "::1";
  return {
    listen,
    connect,
    urlHost: isIP(connect) === 6 ? `[${connect}]` : connect,
    nonLoopback: !isLoopback(listen),
    error: null,
  };
}

/**
 * Normalise a user-supplied bind address. Only IP literals and `localhost`
 * are accepted; DNS names are deliberately rejected so a typo cannot turn
 * into a silent remote bind. Invalid input falls back to the default with
 * an `error` for the caller to log.
 */
export function parseHost(raw: string | null | undefined): HostBinding {
  const value = (raw ?? "").trim();
  if (!value) return binding(DEFAULT_HOST);
  const unbracketed =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (unbracketed.toLowerCase() === "localhost" || isIP(unbracketed) !== 0) {
    return binding(unbracketed);
  }
  return {
    ...binding(DEFAULT_HOST),
    error: `invalid host ${JSON.stringify(value)}: expected an IPv4/IPv6 literal or localhost`,
  };
}

export function connectHost(host?: string | null): string {
  return parseHost(host).connect;
}

export function isNonLoopback(host?: string | null): boolean {
  return parseHost(host).nonLoopback;
}

/** `host:port` for labels and confirmations; IPv6 is bracketed. */
export function hostPort(host: string | null | undefined, port: number | null | undefined): string {
  const binding = parseHost(host);
  return port === null || port === undefined ? binding.urlHost : `${binding.urlHost}:${port}`;
}

/** Admin console base URL for a server status, or null when it has no port. */
export function adminBaseUrl(status: {
  host?: string | null;
  port: number | null;
}): string | null {
  if (status.port === null) return null;
  return `http://${parseHost(status.host).urlHost}:${status.port}`;
}