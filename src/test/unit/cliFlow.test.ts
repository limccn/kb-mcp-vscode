import * as assert from "node:assert/strict";
import { COMMANDS } from "../../constants";
import { resolveToken, runCliCommand, type CliDeps, type TokenSource } from "../../cli/flow";
import type { CliUi } from "../../cli/registry";

interface Answers {
  inputs?: (string | undefined)[];
  confirms?: boolean[];
  picks?: (string | undefined)[];
  files?: (string | undefined)[];
  folders?: (string | undefined)[];
}

class ScriptedUi implements CliUi {
  readonly errors: string[] = [];
  constructor(private readonly answers: Answers = {}) {}
  async input(): Promise<string | undefined> {
    return this.answers.inputs?.shift();
  }
  async pickFolder(): Promise<string | undefined> {
    return this.answers.folders?.shift();
  }
  async pickFile(): Promise<string | undefined> {
    return this.answers.files?.shift();
  }
  async pickOne(): Promise<string | undefined> {
    return this.answers.picks?.shift();
  }
  async pickMany(): Promise<string[] | undefined> {
    return undefined;
  }
  async confirm(): Promise<boolean> {
    return this.answers.confirms?.shift() ?? false;
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

const NEW_TOKEN = "C:/home/.hyseed-http-token";
const LEGACY_TOKEN = "C:/home/.kb-mcp-http-token";

function fakeToken(files: Record<string, string> = {}) {
  const generated: string[] = [];
  const source: TokenSource = {
    newFile: NEW_TOKEN,
    legacyFile: LEGACY_TOKEN,
    read(file) {
      return files[file] ?? null;
    },
    generate(file) {
      generated.push(file);
      files[file] = "f".repeat(32);
    },
  };
  return { source, generated, files };
}

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    resolveExe: async () => "C:/bin/hyseed.exe",
    workspaceRoot: () => "C:/work",
    run: async () => ({ rc: 0, stdout: "", stderr: "" }),
    sendToTerminal: () => {},
    token: fakeToken().source,
    env: () => ({}),
    log: () => {},
    ...overrides,
  };
}

describe("resolveToken", () => {
  it("prefers the new token file, then the pre-rename fallback", async () => {
    const both = fakeToken({ [NEW_TOKEN]: "NEW", [LEGACY_TOKEN]: "OLD" });
    assert.equal(await resolveToken(new ScriptedUi(), both.source), NEW_TOKEN);
    const legacyOnly = fakeToken({ [LEGACY_TOKEN]: "OLD" });
    assert.equal(await resolveToken(new ScriptedUi(), legacyOnly.source), LEGACY_TOKEN);
  });

  it("generates a new token only after confirmation", async () => {
    const declined = fakeToken();
    assert.equal(await resolveToken(new ScriptedUi({ confirms: [false] }), declined.source), null);
    assert.deepEqual(declined.generated, []);

    const accepted = fakeToken();
    assert.equal(await resolveToken(new ScriptedUi({ confirms: [true] }), accepted.source), NEW_TOKEN);
    assert.deepEqual(accepted.generated, [NEW_TOKEN]);
  });

  it("reports a token file that stays empty after writing", async () => {
    const source: TokenSource = {
      newFile: NEW_TOKEN,
      legacyFile: LEGACY_TOKEN,
      read: () => null,
      generate: () => {},
    };
    const ui = new ScriptedUi({ confirms: [true] });
    assert.equal(await resolveToken(ui, source), null);
    assert.equal(ui.errors.length, 1);
  });
});

describe("runCliCommand", () => {
  it("runs the prompts and sends the exact lines to the terminal", async () => {
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliSearch,
      new ScriptedUi({ inputs: ["hello world"] }),
      makeDeps({ sendToTerminal: (lines) => sent.push(lines) })
    );
    assert.deepEqual(sent, [
      ['"C:/bin/hyseed.exe" search "hello world"', "echo [hyseed exit=%errorlevel%]"],
    ]);
  });

  it("hands the resolved converter to the ingest command", async () => {
    const sent: string[][] = [];
    const asked: string[] = [];
    await runCliCommand(
      COMMANDS.cliIngest,
      new ScriptedUi({ picks: ["File"], files: ["C:/in/a.pdf"], folders: ["C:/out"] }),
      makeDeps({
        converter: (exe) => {
          asked.push(exe);
          return "C:/tools/doc-convert.exe";
        },
        sendToTerminal: (lines) => sent.push(lines),
      })
    );
    assert.deepEqual(asked, ["C:/bin/hyseed.exe"]);
    assert.ok(sent[0][0].includes("--converter"));
    assert.ok(sent[0][0].includes("C:/tools/doc-convert.exe"));
  });

  it("injects the data root and the workspace vault as env prefixes", async () => {
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliList,
      new ScriptedUi(),
      makeDeps({
        env: () => ({ KB_MCP_HOME: "C:/data root", KB_MCP_VAULT: "demo" }),
        sendToTerminal: (lines) => sent.push(lines),
      })
    );
    assert.deepEqual(sent[0], [
      'set "KB_MCP_HOME=C:/data root"',
      'set "KB_MCP_VAULT=demo"',
      '"C:/bin/hyseed.exe" list',
      "echo [hyseed exit=%errorlevel%]",
    ]);
  });

  it("sends nothing when the user cancels", async () => {
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliSearch,
      new ScriptedUi({ inputs: [undefined] }),
      makeDeps({ sendToTerminal: (lines) => sent.push(lines) })
    );
    assert.deepEqual(sent, []);
  });

  it("reports a runtime resolution failure and sends nothing", async () => {
    const ui = new ScriptedUi();
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliStats,
      ui,
      makeDeps({
        resolveExe: async () => {
          throw new Error("no runtime");
        },
        sendToTerminal: (lines) => sent.push(lines),
      })
    );
    assert.deepEqual(ui.errors, ["no runtime"]);
    assert.deepEqual(sent, []);
  });

  it("refuses unsafe env values with a pointer to a real terminal", async () => {
    const ui = new ScriptedUi();
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliStats,
      ui,
      makeDeps({ env: () => ({ KB_MCP_HOME: "%TEMP%" }), sendToTerminal: (lines) => sent.push(lines) })
    );
    assert.match(ui.errors[0], /own terminal/);
    assert.deepEqual(sent, []);
  });

  it("builds the serve lines from the token file without exposing its value", async () => {
    const { source } = fakeToken({ [NEW_TOKEN]: "SECRET-TOKEN-VALUE" });
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliServeHttp,
      new ScriptedUi({ inputs: ["8123"], confirms: [true] }),
      makeDeps({
        token: source,
        env: () => ({ KB_MCP_HOME: "C:/data" }),
        sendToTerminal: (lines) => sent.push(lines),
      })
    );
    const lines = sent[0];
    assert.deepEqual(lines, [
      'set "KB_MCP_HOME=C:/data"',
      `set /p KB_MCP_HTTP_TOKEN=<"${NEW_TOKEN}"`,
      '"C:/bin/hyseed.exe" serve --transport http --port 8123',
      "echo [hyseed exit=%errorlevel%]",
    ]);
    assert.ok(lines.every((line) => !line.includes("SECRET-TOKEN-VALUE")));
  });

  it("generates the token when missing and stops when generation is declined", async () => {
    const generated = fakeToken();
    const sent: string[][] = [];
    await runCliCommand(
      COMMANDS.cliServeHttp,
      new ScriptedUi({ inputs: ["8000"], confirms: [true, true] }),
      makeDeps({ token: generated.source, sendToTerminal: (lines) => sent.push(lines) })
    );
    assert.deepEqual(generated.generated, [NEW_TOKEN]);
    assert.ok(sent[0].includes(`set /p KB_MCP_HTTP_TOKEN=<"${NEW_TOKEN}"`));

    const declined = fakeToken();
    const quiet: string[][] = [];
    await runCliCommand(
      COMMANDS.cliServeHttp,
      new ScriptedUi({ inputs: ["8000"], confirms: [true, false] }),
      makeDeps({ token: declined.source, sendToTerminal: (lines) => quiet.push(lines) })
    );
    assert.deepEqual(declined.generated, []);
    assert.deepEqual(quiet, []);
  });

  it("rejects an unknown command id", async () => {
    const ui = new ScriptedUi();
    await runCliCommand("kbmcp.cli.nope", ui, makeDeps());
    assert.match(ui.errors[0], /unknown CLI command/);
  });
});