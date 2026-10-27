import * as assert from "node:assert/strict";
import { buildLines, quoteArg, UnsafeArgError } from "../../cli/quote";

describe("quoteArg", () => {
  it("leaves simple values bare and quotes values with spaces or metacharacters", () => {
    assert.equal(quoteArg("demo"), "demo");
    assert.equal(quoteArg("C:\\work\\kb"), "C:\\work\\kb");
    assert.equal(quoteArg("My Project"), '"My Project"');
    assert.equal(quoteArg("a&b"), '"a&b"');
    assert.equal(quoteArg("a|b"), '"a|b"');
    assert.equal(quoteArg("a^b"), '"a^b"');
    assert.equal(quoteArg("(x)"), '"(x)"');
    assert.equal(quoteArg(""), '""');
  });

  it("doubles trailing backslashes when quoting (CRT argument rules)", () => {
    assert.equal(quoteArg("C:\\Program Files\\kb\\"), '"C:\\Program Files\\kb\\\\"');
  });

  it("refuses characters cmd.exe would expand instead of escaping them", () => {
    for (const value of ['a"b', "a%b", "a!b", "a\rb", "a\nb"]) {
      assert.throws(() => quoteArg(value), UnsafeArgError, JSON.stringify(value));
    }
    assert.throws(() => quoteArg("%USERPROFILE%"), /cmd\.exe/);
  });
});

describe("buildLines", () => {
  it("puts env prefixes first, then the command, then the exit echo", () => {
    const lines = buildLines("C:\\bin\\hyseed.exe", ["vault", "list"], {
      KB_MCP_HOME: "C:\\data root",
      KB_MCP_VAULT: "demo",
    });
    assert.deepEqual(lines, [
      'set "KB_MCP_HOME=C:\\data root"',
      'set "KB_MCP_VAULT=demo"',
      '"C:\\bin\\hyseed.exe" vault list',
      "echo [hyseed exit=%errorlevel%]",
    ]);
  });

  it("omits empty env values and has no token line by default", () => {
    assert.deepEqual(buildLines("hyseed.exe", ["stats"], {}), [
      '"hyseed.exe" stats',
      "echo [hyseed exit=%errorlevel%]",
    ]);
  });

  it("reads the token from a quoted file path, never from the command line", () => {
    const tokenFile = "C:\\Users\\me\\.hyseed-http-token";
    const lines = buildLines(
      "hyseed.exe",
      ["serve", "--transport", "http", "--port", "8000"],
      {},
      tokenFile
    );
    assert.equal(lines[0], `set /p KB_MCP_HTTP_TOKEN=<"${tokenFile}"`);
    assert.equal(lines[1], '"hyseed.exe" serve --transport http --port 8000');
    assert.equal(lines[2], "echo [hyseed exit=%errorlevel%]");
    assert.ok(lines.every((line) => !line.includes("SECRET")));
  });

  it("refuses env values and token paths with expansion characters", () => {
    assert.throws(
      () => buildLines("hyseed.exe", ["stats"], { KB_MCP_HOME: "%TEMP%" }),
      UnsafeArgError
    );
    assert.throws(
      () => buildLines("hyseed.exe", ["stats"], {}, "C:\\a%b\\.hyseed-http-token"),
      UnsafeArgError
    );
  });
});