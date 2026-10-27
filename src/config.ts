import * as vscode from "vscode";
import { CFG_SECTION, DEFAULT_ADMIN_PORT } from "./constants";

export interface KbMcpConfig {
  runtimePath: string;
  adminPort: number;
  dataRoot: string;
  projectVault: string;
  converterPath: string;
}

/** Minimal reader surface so parsing stays unit-testable without the real vscode module. */
export interface ConfigReader {
  get<T>(key: string): T | undefined;
}

export function parseConfig(cfg: ConfigReader): KbMcpConfig {
  const runtimePath = (cfg.get<string>("runtimePath") ?? "").trim();
  const dataRoot = (cfg.get<string>("dataRoot") ?? "").trim();
  const projectVault = (cfg.get<string>("projectVault") ?? "").trim();
  const converterPath = (cfg.get<string>("converterPath") ?? "").trim();
  const rawPort = cfg.get<number>("adminPort") ?? DEFAULT_ADMIN_PORT;
  const adminPort =
    Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_ADMIN_PORT;
  return { runtimePath, adminPort, dataRoot, projectVault, converterPath };
}

export function readConfig(): KbMcpConfig {
  return parseConfig(vscode.workspace.getConfiguration(CFG_SECTION));
}

export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(CFG_SECTION)) {
      listener();
    }
  });
}