import * as vscode from "vscode";
import { MCP_PROVIDER_ID, MCP_PROVIDER_LABEL } from "../constants";
import { readConfig } from "../config";
import { logLine } from "../log";
import { resolveRuntimeFromDisk } from "../runtime";

/** Env carried by the registered MCP definition (empty values are omitted). */
export function providerEnv(dataRoot: string, projectVault: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (dataRoot) env.KB_MCP_HOME = dataRoot;
  if (projectVault) env.KB_MCP_VAULT = projectVault;
  return env;
}

/** Current server definitions; returns [] (never throws) when no runtime resolves. */
export async function provideMcpServerDefinitions(
  extensionPath: string
): Promise<vscode.McpServerDefinition[]> {
  try {
    const cfg = readConfig();
    const resolution = await resolveRuntimeFromDisk(cfg, extensionPath);
    return [
      new vscode.McpStdioServerDefinition(
        MCP_PROVIDER_LABEL,
        resolution.exePath,
        ["serve"],
        providerEnv(cfg.dataRoot, cfg.projectVault)
      ),
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine(`MCP provider: no server definition (${message})`);
    return [];
  }
}

export interface McpProviderHandle {
  /** The VS Code host exposes the MCP definition provider API. */
  available: boolean;
  registered: boolean;
  /** Ask VS Code to re-read definitions; false when the API is unavailable. */
  reload: () => boolean;
}

/**
 * Registers the MCP definition provider. Guarded so an older VS Code host without
 * the API degrades to "no provider" instead of failing activation.
 */
export function registerMcpProvider(
  extensionPath: string,
  subscriptions: vscode.Disposable[]
): McpProviderHandle {
  const lm = vscode.lm as typeof vscode.lm | undefined;
  if (!lm || typeof lm.registerMcpServerDefinitionProvider !== "function") {
    logLine("MCP provider API is not available in this VS Code host; skipping registration");
    return { available: false, registered: false, reload: () => false };
  }
  const emitter = new vscode.EventEmitter<void>();
  subscriptions.push(emitter);
  subscriptions.push(
    lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      provideMcpServerDefinitions: () => provideMcpServerDefinitions(extensionPath),
      onDidChangeMcpServerDefinitions: emitter.event,
    })
  );
  logLine(`MCP provider registered: ${MCP_PROVIDER_ID} (${MCP_PROVIDER_LABEL})`);
  return {
    available: true,
    registered: true,
    reload: () => {
      emitter.fire();
      return true;
    },
  };
}