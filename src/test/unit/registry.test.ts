import * as assert from "node:assert/strict";
import { CLI_COMMAND_IDS, COMMANDS } from "../../constants";
import { CLI_COMMANDS, type CliContext, type CliUi } from "../../cli/registry";
import type { CliRunResult } from "../../mcp/skillsCli";

interface Answers {
  inputs?: (string | undefined)[];
  folders?: (string | undefined)[];
  files?: (string | undefined)[];
  picks?: (string | undefined)[];
  many?: (string[] | undefined)[];
  confirms?: boolean[];
}

class ScriptedUi implements CliUi {
  readonly errors: string[] = [];
  readonly pickTitles: string[] = [];
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
  async pickOne(title: string): Promise<string | undefined> {
    this.pickTitles.push(title);
    return this.answers.picks?.shift();
  }
  async pickMany(title: string): Promise<string[] | undefined> {
    this.pickTitles.push(title);
    return this.answers.many?.shift();
  }
  async confirm(): Promise<boolean> {
    return this.answers.confirms?.shift() ?? false;
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

function ok(stdout = ""): CliRunResult {
  return { rc: 0, stdout, stderr: "" };
}

function ctx(run: CliContext["run"] = async () => ok(), converter?: string): CliContext {
  return { exe: "C:/bin/hyseed.exe", cwd: "C:/work", run, converter };
}

async function build(id: string, ui: CliUi, context = ctx()) {
  const spec = CLI_COMMANDS[id];
  assert.ok(spec, `missing registry entry for ${id}`);
  return spec.build(ui, context);
}

const NO_PROMPT_FORMS: Record<string, string[]> = {
  [COMMANDS.cliList]: ["list"],
  [COMMANDS.cliDoctor]: ["doctor"],
  [COMMANDS.cliStats]: ["stats"],
  [COMMANDS.cliDiffCheck]: ["diff-check"],
  [COMMANDS.cliVaultList]: ["vault", "list"],
  [COMMANDS.cliVaultStatus]: ["vault", "status"],
  [COMMANDS.cliSkillsList]: ["skills", "list"],
};

describe("CLI registry", () => {
  it("covers every contributed cli command and nothing else", () => {
    assert.deepEqual(Object.keys(CLI_COMMANDS).sort(), [...CLI_COMMAND_IDS].sort());
    assert.equal(CLI_COMMAND_IDS.length, 21);
    const contributed = Object.values(COMMANDS) as string[];
    for (const id of Object.keys(CLI_COMMANDS)) {
      assert.ok(id.startsWith("kbmcp.cli."), id);
      assert.ok(contributed.includes(id), id);
      assert.ok(Array.isArray(CLI_COMMANDS[id].prompts), id);
    }
  });

  it("maps the no-prompt commands onto the calibrated forms", async () => {
    for (const [id, args] of Object.entries(NO_PROMPT_FORMS)) {
      assert.deepEqual((await build(id, new ScriptedUi()))?.args, args, id);
    }
  });

  it("asks for query and document ids", async () => {
    assert.deepEqual(
      (await build(COMMANDS.cliSearch, new ScriptedUi({ inputs: ["hello world"] })))?.args,
      ["search", "hello world"]
    );
    assert.deepEqual(
      (await build(COMMANDS.cliGet, new ScriptedUi({ inputs: ["doc-1"] })))?.args,
      ["get", "doc-1"]
    );
    assert.deepEqual(
      (await build(COMMANDS.cliHistory, new ScriptedUi({ inputs: ["doc-1"] })))?.args,
      ["history", "doc-1"]
    );
  });

  it("rejects empty required input with an error", async () => {
    const ui = new ScriptedUi({ inputs: ["   "] });
    assert.equal(await build(COMMANDS.cliGet, ui), null);
    assert.equal(ui.errors.length, 1);
  });

  it("builds add with the required type/title and an optional body", async () => {
    assert.deepEqual(
      (await build(COMMANDS.cliAdd, new ScriptedUi({ inputs: ["decision", "Pick X", "because"] })))
        ?.args,
      ["add", "--type", "decision", "--title", "Pick X", "--body", "because"]
    );
    assert.deepEqual(
      (await build(COMMANDS.cliAdd, new ScriptedUi({ inputs: ["decision", "Pick X", ""] })))?.args,
      ["add", "--type", "decision", "--title", "Pick X"]
    );
  });

  it("builds ingest for a file and for a folder with the required --out", async () => {
    assert.deepEqual(
      (
        await build(
          COMMANDS.cliIngest,
          new ScriptedUi({ picks: ["File"], files: ["C:/in/a.pdf"], folders: ["C:/out"] })
        )
      )?.args,
      ["ingest", "-f", "C:/in/a.pdf", "--out", "C:/out"]
    );
    assert.deepEqual(
      (
        await build(
          COMMANDS.cliIngest,
          new ScriptedUi({ picks: ["Folder"], folders: ["C:/in", "C:/out"] })
        )
      )?.args,
      ["ingest", "C:/in", "--out", "C:/out"]
    );
  });

  it("appends --converter to ingest when the context resolves one", async () => {
    assert.deepEqual(
      (
        await build(
          COMMANDS.cliIngest,
          new ScriptedUi({ picks: ["File"], files: ["C:/in/a.pdf"], folders: ["C:/out"] }),
          ctx(undefined, "C:/tools/doc-convert.exe")
        )
      )?.args,
      ["ingest", "-f", "C:/in/a.pdf", "--out", "C:/out", "--converter", "C:/tools/doc-convert.exe"]
    );
  });

  it("requires the directory for import and export", async () => {
    assert.deepEqual(
      (await build(COMMANDS.cliImport, new ScriptedUi({ folders: ["C:/md"] })))?.args,
      ["import", "C:/md"]
    );
    assert.deepEqual(
      (await build(COMMANDS.cliExport, new ScriptedUi({ folders: ["C:/out"] })))?.args,
      ["export", "C:/out"]
    );
    assert.equal(await build(COMMANDS.cliExport, new ScriptedUi({ folders: [undefined] })), null);
  });

  it("confirms before reindex", async () => {
    assert.equal(await build(COMMANDS.cliReindex, new ScriptedUi({ confirms: [false] })), null);
    assert.deepEqual(
      (await build(COMMANDS.cliReindex, new ScriptedUi({ confirms: [true] })))?.args,
      ["reindex"]
    );
  });

  it("validates the vault name before create", async () => {
    assert.deepEqual(
      (await build(COMMANDS.cliVaultCreate, new ScriptedUi({ inputs: ["demo"] })))?.args,
      ["vault", "create", "demo"]
    );
    const ui = new ScriptedUi({ inputs: [""] });
    assert.equal(await build(COMMANDS.cliVaultCreate, ui), null);
    assert.equal(ui.errors.length, 1);
  });

  it("switches the vault from the live list and shows the current one", async () => {
    const run: CliContext["run"] = async (_exe, args) => {
      const form = args.join(" ");
      if (form === "vault list --json") {
        return ok(
          JSON.stringify([
            { name: "default", path: "C:/v/default" },
            { name: "demo", path: "C:/v/demo" },
          ])
        );
      }
      if (form === "vault list") return ok("Default vault: demo\n");
      throw new Error(`unexpected ${form}`);
    };
    const ui = new ScriptedUi({ picks: ["default"] });
    assert.deepEqual((await build(COMMANDS.cliVaultSwitch, ui, ctx(run)))?.args, [
      "vault",
      "switch",
      "default",
    ]);
    assert.match(ui.pickTitles[0], /current: demo/);
  });

  it("shows a bundled skill from the CLI listing", async () => {
    const run: CliContext["run"] = async (_exe, args) => {
      assert.deepEqual(args, ["skills", "list", "--json"]);
      return ok(
        JSON.stringify({
          bundled: [
            { name: "hyseed", files: 3, bytes: 10 },
            { name: "hyseed-manage", files: 2, bytes: 8 },
          ],
          targets: [],
        })
      );
    };
    const ui = new ScriptedUi({ picks: ["hyseed-manage"] });
    assert.deepEqual((await build(COMMANDS.cliSkillsShow, ui, ctx(run)))?.args, [
      "skills",
      "show",
      "hyseed-manage",
    ]);
  });

  it("surfaces a skills listing failure instead of an empty picker", async () => {
    const run: CliContext["run"] = async () => ({ rc: 1, stdout: "", stderr: "boom\nmore" });
    await assert.rejects(() => build(COMMANDS.cliSkillsShow, new ScriptedUi(), ctx(run)), /boom/);
  });

  it("builds skills add/remove with repeated agents and a confirmed scope", async () => {
    assert.deepEqual(
      (
        await build(
          COMMANDS.cliSkillsAdd,
          new ScriptedUi({ many: [["claude", "cline"]], picks: ["global"] })
        )
      )?.args,
      ["skills", "add", "--agent", "claude", "--agent", "cline", "--scope", "global"]
    );
    assert.deepEqual(
      (
        await build(
          COMMANDS.cliSkillsRemove,
          new ScriptedUi({ many: [["codex"]], picks: ["project"], confirms: [true] })
        )
      )?.args,
      ["skills", "remove", "--agent", "codex", "--scope", "project"]
    );
    assert.equal(
      await build(
        COMMANDS.cliSkillsRemove,
        new ScriptedUi({ many: [["codex"]], picks: ["project"], confirms: [false] })
      ),
      null
    );
    assert.equal(await build(COMMANDS.cliSkillsAdd, new ScriptedUi({ many: [[]] })), null);
  });

  it("validates the serve port and requests the token", async () => {
    const invocation = await build(
      COMMANDS.cliServeHttp,
      new ScriptedUi({ inputs: ["8000"], confirms: [true] })
    );
    assert.deepEqual(invocation?.args, ["serve", "--transport", "http", "--port", "8000"]);
    assert.equal(invocation?.needsToken, true);

    const custom = await build(
      COMMANDS.cliServeHttp,
      new ScriptedUi({ inputs: ["8000"], confirms: [true] }),
      { ...ctx(), host: "::" }
    );
    assert.deepEqual(custom?.args, [
      "serve",
      "--transport",
      "http",
      "--host",
      "::",
      "--port",
      "8000",
    ]);

    for (const answers of [
      { inputs: ["70000"] },
      { inputs: ["abc"] },
      { inputs: ["8000"], confirms: [false] },
      { inputs: [undefined] },
    ] as Answers[]) {
      assert.equal(await build(COMMANDS.cliServeHttp, new ScriptedUi(answers)), null);
    }
  });

  it("returns null when the user cancels a prompt", async () => {
    assert.equal(await build(COMMANDS.cliSearch, new ScriptedUi({ inputs: [undefined] })), null);
    assert.equal(await build(COMMANDS.cliImport, new ScriptedUi({ folders: [undefined] })), null);
    assert.equal(await build(COMMANDS.cliSkillsAdd, new ScriptedUi({ many: [undefined] })), null);
  });
});