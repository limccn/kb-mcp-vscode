import * as assert from "node:assert/strict";
import { providerEnv, registerMcpProvider } from "../../mcp/provider";

describe("MCP provider", () => {
  it("maps dataRoot and projectVault to the server env", () => {
    assert.deepEqual(providerEnv("", ""), {});
    assert.deepEqual(providerEnv("C:\\data", ""), { KB_MCP_HOME: "C:\\data" });
    assert.deepEqual(providerEnv("", "demo"), { KB_MCP_VAULT: "demo" });
    assert.deepEqual(providerEnv("C:\\data", "demo"), {
      KB_MCP_HOME: "C:\\data",
      KB_MCP_VAULT: "demo",
    });
  });

  it("skips registration without throwing when the host lacks the MCP API", () => {
    const subscriptions: { dispose(): void }[] = [];
    assert.equal(registerMcpProvider("C:\\ext", subscriptions), false);
    assert.equal(subscriptions.length, 0);
  });
});