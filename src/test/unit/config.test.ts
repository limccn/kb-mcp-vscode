import * as assert from "node:assert/strict";
import { parseConfig, type ConfigReader } from "../../config";
import { DEFAULT_ADMIN_PORT } from "../../constants";

function reader(values: Record<string, unknown>): ConfigReader {
  return { get: <T>(key: string) => values[key] as T | undefined };
}

describe("parseConfig", () => {
  it("falls back to defaults when nothing is set", () => {
    assert.deepEqual(parseConfig(reader({})), {
      runtimePath: "",
      adminPort: DEFAULT_ADMIN_PORT,
      dataRoot: "",
      projectVault: "",
      converterPath: "",
    });
  });

  it("trims explicit paths", () => {
    const cfg = parseConfig(
      reader({
        runtimePath: "  C:\\tools\\hyseed.exe ",
        dataRoot: " D:\\kb ",
        projectVault: " demo ",
        converterPath: " C:\\tools\\doc-convert.exe ",
      })
    );
    assert.equal(cfg.runtimePath, "C:\\tools\\hyseed.exe");
    assert.equal(cfg.dataRoot, "D:\\kb");
    assert.equal(cfg.projectVault, "demo");
    assert.equal(cfg.converterPath, "C:\\tools\\doc-convert.exe");
  });

  it("rejects out-of-range ports in favor of the default", () => {
    assert.equal(parseConfig(reader({ adminPort: 0 })).adminPort, DEFAULT_ADMIN_PORT);
    assert.equal(parseConfig(reader({ adminPort: 70000 })).adminPort, DEFAULT_ADMIN_PORT);
    assert.equal(parseConfig(reader({ adminPort: 8890 })).adminPort, 8890);
  });
});