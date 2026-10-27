/**
 * Minimal "vscode" module stand-in for unit-test bundles.
 * esbuild maps `import ... from "vscode"` to this file when building src/test/unit.
 */

interface Disposable {
  dispose(): void;
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