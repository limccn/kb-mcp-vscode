/**
 * Minimal "vscode" module stand-in for unit-test bundles.
 * esbuild maps `import ... from "vscode"` to this file when building src/test/unit.
 */

import { getLmApi } from "./lmState";

interface Disposable {
  dispose(): void;
}

export class EventEmitter<T> {
  private listeners: ((event: T) => unknown)[] = [];

  readonly event = (listener: (event: T) => unknown): Disposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  dispose(): void {
    this.listeners = [];
  }
}

export const workspace = {
  getConfiguration(_section: string) {
    return {
      get<T>(_key: string): T | undefined {
        return undefined;
      },
    };
  },
  onDidChangeConfiguration(
    _listener: (e: { affectsConfiguration(section: string): boolean }) => void
  ): Disposable {
    return { dispose() {} };
  },
};

export const window = {
  createOutputChannel(_name: string) {
    return {
      appendLine(_line: string): void {},
      dispose(): void {},
    };
  },
};

export const commands = {
  registerCommand(_id: string, _handler: (...args: unknown[]) => unknown): Disposable {
    return { dispose() {} };
  },
};

/** Dynamic so a test can install (or remove) the fake before calling the provider. */
export const lm = {
  get registerMcpServerDefinitionProvider() {
    return getLmApi()?.registerMcpServerDefinitionProvider;
  },
};