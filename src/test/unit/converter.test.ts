import * as assert from "node:assert/strict";
import * as path from "node:path";
import { resolveConverter, type ConverterOptions } from "../../converter";

function existsIn(paths: readonly string[]): (candidate: string) => boolean {
  return (candidate) => paths.includes(candidate);
}

function options(overrides: Partial<ConverterOptions>): ConverterOptions {
  return { configured: "", env: {}, exists: () => false, ...overrides };
}

describe("resolveConverter", () => {
  it("prefers an explicit setting verbatim, even when the file does not exist", () => {
    const configured = "C:\\elsewhere\\custom-convert.exe";
    const resolved = resolveConverter(
      options({
        configured: `  ${configured} `,
        env: { KB_INGEST_CONVERTER: "C:\\env\\doc-convert.exe" },
        runtimePath: "C:\\bin\\hyseed.exe",
        exists: existsIn([path.join("C:\\bin", "doc-convert.exe")]),
      })
    );
    assert.deepEqual(resolved, { path: configured, source: "setting" });
  });

  it("uses KB_INGEST_CONVERTER verbatim when the setting is blank", () => {
    const resolved = resolveConverter(
      options({
        configured: "   ",
        env: { KB_INGEST_CONVERTER: "  C:\\env\\doc-convert.exe " },
        runtimePath: "C:\\bin\\hyseed.exe",
      })
    );
    assert.deepEqual(resolved, { path: "C:\\env\\doc-convert.exe", source: "env" });
  });

  it("falls back to doc-convert.exe next to the resolved runtime", () => {
    const sibling = path.join("C:\\tools\\hyseed", "doc-convert.exe");
    const resolved = resolveConverter(
      options({
        runtimePath: path.join("C:\\tools\\hyseed", "hyseed.exe"),
        workspaceFolders: ["C:\\work"],
        bundledPath: "C:\\ext\\resources\\doc-convert.exe",
        exists: existsIn([sibling]),
      })
    );
    assert.deepEqual(resolved, { path: sibling, source: "runtime-sibling" });
  });

  it("scans workspace folders in order for ingestion-rt", () => {
    const second = path.join("D:\\repo", "ingestion-rt", "doc-convert.exe");
    const resolved = resolveConverter(
      options({
        workspaceFolders: [undefined, "C:\\empty", "D:\\repo"],
        bundledPath: "C:\\ext\\resources\\doc-convert.exe",
        exists: existsIn([second]),
      })
    );
    assert.deepEqual(resolved, { path: second, source: "workspace" });
  });

  it("uses the bundled copy last", () => {
    const bundled = "C:\\ext\\resources\\doc-convert.exe";
    const resolved = resolveConverter(
      options({
        runtimePath: path.join("C:\\tools\\hyseed", "hyseed.exe"),
        workspaceFolders: ["C:\\work"],
        bundledPath: bundled,
        exists: existsIn([bundled]),
      })
    );
    assert.deepEqual(resolved, { path: bundled, source: "bundled" });
  });

  it("returns undefined when nothing is configured or present", () => {
    assert.equal(
      resolveConverter(
        options({
          runtimePath: path.join("C:\\tools\\hyseed", "hyseed.exe"),
          workspaceFolders: ["C:\\work"],
          bundledPath: "C:\\ext\\resources\\doc-convert.exe",
        })
      ),
      undefined
    );
  });
});