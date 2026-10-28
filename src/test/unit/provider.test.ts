import * as assert from "node:assert/strict";
import { MCP_PROVIDER_ID } from "../../constants";
import { providerEnv, registerMcpProvider } from "../../mcp/provider";
import { setLmApi } from "../lmState";

interface CapturedProvider {
  provideMcpServerDefinitions(): Promise<unknown>;
  onDidChangeMcpServerDefinitions?: (listener: () => unknown) => { dispose(): void };
}

afterEach(() => {
  setLmApi(undefined);
});

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
    setLmApi(undefined);
    const subscriptions: { dispose(): void }[] = [];
    const handle = registerMcpProvider("C:\\ext", subscriptions);
    assert.equal(handle.available, false);
    assert.equal(handle.registered, false);
    assert.equal(handle.reload(), false);
    assert.equal(subscriptions.length, 0);
  });

  it("registers a reloadable provider when the API exists", () => {
    let captured: { id: string; provider: CapturedProvider } | undefined;
    setLmApi({
      registerMcpServerDefinitionProvider(id, provider) {
        captured = { id, provider: provider as CapturedProvider };
        return { dispose() {} };
      },
    });

    const subscriptions: { dispose(): void }[] = [];
    const handle = registerMcpProvider("C:\\ext", subscriptions);
    assert.equal(handle.available, true);
    assert.equal(handle.registered, true);
    assert.equal(subscriptions.length, 2);
    assert.ok(captured, "provider was not registered");
    assert.equal(captured.id, MCP_PROVIDER_ID);
    assert.equal(typeof captured.provider.provideMcpServerDefinitions, "function");

    let fired = 0;
    const subscribe = captured.provider.onDidChangeMcpServerDefinitions;
    assert.ok(subscribe, "provider has no change event");
    const subscription = subscribe(() => {
      fired += 1;
    });
    assert.equal(handle.reload(), true);
    assert.equal(fired, 1);
    subscription.dispose();
    assert.equal(handle.reload(), true);
    assert.equal(fired, 1);

    for (const item of subscriptions) item.dispose();
  });
});