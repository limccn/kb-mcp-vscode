import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CFG_SECTION,
  COMMANDS,
  COMMAND_PREFIX,
  DISPLAY_NAME,
  EXE_NAMES,
  LAUNCHER_CONTAINER_ID,
  LAUNCHER_VIEW_ID,
  MCP_PROVIDER_ID,
  MCP_PROVIDER_LABEL,
  PANEL_PREFIX,
  PANEL_VIEW_TYPE,
  PATH_CLI_NAMES,
  PROBE_DIRS,
  SERVER_MARKERS,
  VERSION_LINE_RE,
} from "../../constants";

describe("constants single point", () => {
  it("keeps hyseed first and kb-mcp only as a compatibility fallback", () => {
    assert.deepEqual([...EXE_NAMES], ["hyseed.exe", "kb-mcp.exe"]);
    assert.deepEqual([...PATH_CLI_NAMES], ["hyseed", "kb-mcp"]);
    assert.equal(PROBE_DIRS[0], ".local/bin");
    assert.ok(PROBE_DIRS.includes(`.local/share/${DISPLAY_NAME}`));
    assert.ok(PROBE_DIRS.includes(".local/share/kb-mcp"));
  });

  it("pins the user-visible prefix and the technical ids", () => {
    assert.equal(PANEL_PREFIX, "hyseed:");
    assert.equal(CFG_SECTION, "kbMcp");
    assert.equal(COMMAND_PREFIX, "kbmcp");
    for (const id of Object.values(COMMANDS)) {
      assert.ok(id.startsWith(`${COMMAND_PREFIX}.`), id);
    }
  });

  it("keeps package.json contributions in sync with the single point", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      displayName: string;
      activationEvents?: string[];
      contributes: {
        commands: { command: string; title: string }[];
        configuration: { properties: Record<string, unknown> };
        menus: Record<string, { command: string; when?: string }[]>;
        mcpServerDefinitionProviders?: { id: string; label: string }[];
        viewsContainers?: {
          activitybar?: { id: string; title: string; icon: string }[];
        };
        views?: Record<string, { id: string; name: string; type: string }[]>;
      };
    };
    assert.equal(pkg.displayName, DISPLAY_NAME);
    assert.deepEqual(
      pkg.contributes.commands.map((c) => c.command).sort(),
      Object.values(COMMANDS).sort()
    );
    for (const command of pkg.contributes.commands) {
      assert.ok(command.title.startsWith(`${DISPLAY_NAME}:`), command.title);
    }
    assert.deepEqual(Object.keys(pkg.contributes.configuration.properties).sort(), [
      `${CFG_SECTION}.adminPort`,
      `${CFG_SECTION}.converterPath`,
      `${CFG_SECTION}.dataRoot`,
      `${CFG_SECTION}.projectVault`,
      `${CFG_SECTION}.runtimePath`,
    ]);
    assert.deepEqual(pkg.contributes.mcpServerDefinitionProviders, [
      { id: MCP_PROVIDER_ID, label: MCP_PROVIDER_LABEL },
    ]);
    assert.deepEqual(pkg.contributes.viewsContainers?.activitybar, [
      { id: LAUNCHER_CONTAINER_ID, title: DISPLAY_NAME, icon: "resources/activitybar.svg" },
    ]);
    assert.deepEqual(pkg.contributes.views?.[LAUNCHER_CONTAINER_ID], [
      { id: LAUNCHER_VIEW_ID, name: DISPLAY_NAME, type: "webview" },
    ]);
    for (const items of Object.values(pkg.contributes.menus)) {
      for (const item of items) {
        assert.equal(item.when, `activeWebviewPanelId == ${PANEL_VIEW_TYPE}`);
      }
    }
    assert.ok(pkg.activationEvents?.includes("onStartupFinished"));
  });

  it("accepts both brand shapes in version output, without pinning a version", () => {
    assert.ok(VERSION_LINE_RE.test("hyseed, version 0.9.0"));
    assert.ok(VERSION_LINE_RE.test("kb, version 0.8.7"));
    assert.ok(!VERSION_LINE_RE.test("something else"));
  });

  it("has at least one admin console marker", () => {
    assert.ok(SERVER_MARKERS.length >= 1);
  });
});