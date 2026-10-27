import { appendFileSync } from "node:fs";
import * as vscode from "vscode";
import { LOG_CHANNEL_NAME } from "./constants";

let channel: vscode.OutputChannel | undefined;

/** Optional file sink (tests / diagnostics): set KB_MCP_VSCODE_LOG to a file path. */
const fileSink = process.env.KB_MCP_VSCODE_LOG;

export function getLogChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME);
  }
  return channel;
}

export function logLine(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  getLogChannel().appendLine(line);
  // Mirror to the extension-host console so integration tests and host logs see it too.
  console.log(`[hyseed] ${message}`);
  if (fileSink) {
    try {
      appendFileSync(fileSink, `${line}\n`);
    } catch {
      // Diagnostics sink is best-effort only.
    }
  }
}