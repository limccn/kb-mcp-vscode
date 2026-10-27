/**
 * Converter discovery for the two ingest entry points the extension spawns
 * (admin server and the CLI palette). Pure apart from the injectable
 * `exists`/`env`, so it is unit-testable without the vscode module.
 */

import * as path from "node:path";
import { existsSync } from "node:fs";

export type ConverterSource = "setting" | "env" | "runtime-sibling" | "workspace" | "bundled";

export interface ConverterResolution {
  path: string;
  source: ConverterSource;
}

export interface ConverterOptions {
  configured: string;
  runtimePath?: string | null;
  workspaceFolders?: readonly (string | undefined)[];
  bundledPath?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

const CONVERTER_ENV = "KB_INGEST_CONVERTER";
const CONVERTER_NAME = "doc-convert.exe";

export function resolveConverter(options: ConverterOptions): ConverterResolution | undefined {
  const configured = options.configured.trim();
  if (configured) return { path: configured, source: "setting" };

  const env = options.env ?? process.env;
  const fromEnv = (env[CONVERTER_ENV] ?? "").trim();
  if (fromEnv) return { path: fromEnv, source: "env" };

  const exists = options.exists ?? existsSync;
  const runtimePath = options.runtimePath?.trim();
  if (runtimePath) {
    const sibling = path.join(path.dirname(runtimePath), CONVERTER_NAME);
    if (exists(sibling)) return { path: sibling, source: "runtime-sibling" };
  }
  for (const folder of options.workspaceFolders ?? []) {
    const root = folder?.trim();
    if (!root) continue;
    const candidate = path.join(root, "ingestion-rt", CONVERTER_NAME);
    if (exists(candidate)) return { path: candidate, source: "workspace" };
  }
  const bundled = options.bundledPath?.trim();
  if (bundled && exists(bundled)) return { path: bundled, source: "bundled" };
  return undefined;
}