import * as assert from "node:assert/strict";
import { COMMANDS } from "../../constants";
import { documentUrl, renderLauncherHtml } from "../../launcher";

type Webview = Parameters<typeof renderLauncherHtml>[0];
type Options = Parameters<typeof renderLauncherHtml>[1];

const html = renderLauncherHtml(
  { cspSource: "vscode-resource:" } as unknown as Webview,
  {
    iconUri: { toString: () => "vscode-resource:/icon.png" } as unknown as Options["iconUri"],
    nonce: "testnonce",
  }
);

describe("launcher webview", () => {
  it("runs a nonce script and loads only local resources", () => {
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-testnonce'"));
    assert.ok(html.includes('<script nonce="testnonce">'));
    assert.ok(html.includes("vscode-resource:/icon.png"));
    assert.ok(html.includes("acquireVsCodeApi"));
  });

  it("offers the admin browser action and the quick actions", () => {
    assert.ok(html.includes('id="open-admin"'));
    assert.ok(html.includes('id="open-settings"'));
    assert.ok(html.includes(`command:${COMMANDS.createVault}`));
    assert.ok(html.includes(`command:${COMMANDS.installAgentSkills}`));
    assert.ok(html.includes(`command:${COMMANDS.cliDoctor}`));
    assert.ok(html.includes(">Create<"));
    assert.ok(html.includes("Create vault"));
    assert.ok(!html.includes(`command:${COMMANDS.openAdmin}`));
  });

  it("renders the vault search form and its modes", () => {
    for (const id of [
      "vault",
      "query",
      "mode",
      "limit",
      "type",
      "tags",
      "search-form",
      "search",
      "status",
      "results",
    ]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    for (const mode of ["hybrid", "lexical", "fuzzy", "semantic", "rrf"]) {
      assert.ok(html.includes(`value="${mode}"`), mode);
    }
  });

  it("bridges search, vault switching, and document opening through messages", () => {
    assert.ok(html.includes('vscode.postMessage({ type: "ready" })'));
    assert.ok(html.includes('type: "search"'));
    assert.ok(html.includes('type: "switchVault"'));
    assert.ok(html.includes('type: "openDocument"'));
    assert.ok(html.includes('type: "openSettings"'));
    assert.ok(html.includes("built-in browser"));
  });

  it("keeps slashes in document ids and encodes each segment", () => {
    assert.equal(
      documentUrl(1234, "notes/2026 plan"),
      "http://127.0.0.1:1234/documents/notes/2026%20plan"
    );
  });
});