/**
 * Single reused terminal for palette CLI commands. The `vscode` object is not
 * imported here — the caller injects `create()` so unit tests can watch the
 * send order with a fake terminal.
 */

export interface TerminalLike {
  show(preserveFocus?: boolean): void;
  sendText(text: string, addNewLine?: boolean): void;
}

export interface TerminalSender {
  send(lines: readonly string[]): void;
  /** Called on `onDidCloseTerminal`; clears the cached terminal only when it is the same one. */
  reset(terminal?: TerminalLike): void;
}

export function createTerminalSender(create: () => TerminalLike): TerminalSender {
  let current: TerminalLike | null = null;
  return {
    send(lines) {
      current ??= create();
      current.show(false);
      for (const line of lines) current.sendText(line);
    },
    reset(terminal) {
      if (!terminal || terminal === current) current = null;
    },
  };
}