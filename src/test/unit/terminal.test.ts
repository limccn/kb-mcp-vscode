import * as assert from "node:assert/strict";
import { createTerminalSender, type TerminalLike } from "../../cli/terminal";

function fakeTerminal(log: string[]): TerminalLike {
  return {
    show(preserveFocus?: boolean) {
      log.push(`show:${preserveFocus}`);
    },
    sendText(text: string) {
      log.push(`send:${text}`);
    },
  };
}

describe("terminal sender", () => {
  it("creates one terminal, shows it without focus steal, then sends in order", () => {
    const log: string[] = [];
    let created = 0;
    const sender = createTerminalSender(() => {
      created += 1;
      return fakeTerminal(log);
    });
    sender.send(["a", "b"]);
    sender.send(["c"]);
    assert.equal(created, 1);
    assert.deepEqual(log, ["show:false", "send:a", "send:b", "show:false", "send:c"]);
  });

  it("clears only for the cached terminal and recreates after reset", () => {
    const log: string[] = [];
    const terminals: TerminalLike[] = [];
    const sender = createTerminalSender(() => {
      const terminal = fakeTerminal(log);
      terminals.push(terminal);
      return terminal;
    });
    sender.send(["a"]);
    sender.reset(fakeTerminal(log));
    sender.send(["b"]);
    assert.equal(terminals.length, 1);
    sender.reset(terminals[0]);
    sender.send(["c"]);
    assert.equal(terminals.length, 2);
  });
});