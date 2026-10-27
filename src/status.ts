import * as vscode from "vscode";
import { COMMANDS, DISPLAY_NAME } from "./constants";
import type { ServerStatus } from "./server";

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
    this.item.text = `${DISPLAY_NAME}: ${status.state}`;
    const parts = [
      `state: ${status.state}`,
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