import * as vscode from "vscode";
import { COMMANDS } from "./constants";
import { isNonLoopback } from "./host";
import type { ServerState, ServerStatus } from "./server";

const STATUS_LABEL = "Hyseed";
const STATUS_ICONS: Record<ServerState, string> = {
  stopped: "$(circle-slash)",
  starting: "$(sync~spin)",
  "running-own": "$(check)",
  "running-external": "$(check)",
  stopping: "$(sync~spin)",
  error: "$(warning)",
};

export interface StatusInfo {
  runtimePath?: string;
  dataRoot?: string;
}

export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMANDS.openAdmin;
    this.update({ state: "stopped", port: null, message: null });
    this.item.show();
  }

  update(status: ServerStatus, info: StatusInfo = {}): void {
    const running = status.state === "running-own" || status.state === "running-external";
    const lan = running && isNonLoopback(status.host);
    this.item.text = `${lan ? "$(warning)" : STATUS_ICONS[status.state]} ${STATUS_LABEL}`;
    this.item.backgroundColor = lan
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    const parts = [
      `state: ${status.state}`,
      `host: ${status.host ?? "127.0.0.1"}`,
      `port: ${status.port ?? "-"}`,
      `runtime: ${info.runtimePath ?? "auto-detect"}`,
      `data root: ${info.dataRoot || "runtime default"}`,
    ];
    if (status.message) parts.push(status.message);
    parts.push("click: open admin console");
    this.item.tooltip = parts.join("\n");
  }

  dispose(): void {
    this.item.dispose();
  }
}