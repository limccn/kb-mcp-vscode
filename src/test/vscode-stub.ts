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

interface FakeWebview {
  html: string;
  /** Every message the extension posted to the webview, in order. */
  readonly messages: unknown[];
  onDidReceiveMessage(listener: (message: unknown) => unknown): Disposable;
  postMessage(message: unknown): PromiseLike<boolean>;
}

export interface FakeWebviewPanel {
  readonly viewType: string;
  readonly title: string;
  readonly options: Record<string, unknown>;
  readonly webview: FakeWebview;
  /** Number of times `webview.html` was assigned. */
  readonly htmlSets: number;
  readonly revealCount: number;
  reveal(): void;
  fireMessage(message: unknown): void;
  onDidDispose(listener: () => void): Disposable;
  dispose(): void;
}

/** Every panel created through the stub, in creation order. */
export const createdWebviewPanels: FakeWebviewPanel[] = [];

export const ViewColumn = { Active: -1 };

function createFakeWebviewPanel(
  viewType: string,
  title: string,
  options: Record<string, unknown>
): FakeWebviewPanel {
  let html = "";
  let htmlSets = 0;
  let revealCount = 0;
  let disposed = false;
  const messages: unknown[] = [];
  const messageListeners: ((message: unknown) => unknown)[] = [];
  let disposeListeners: (() => void)[] = [];
  const panel: FakeWebviewPanel = {
    viewType,
    title,
    options,
    webview: {
      get html() {
        return html;
      },
      set html(value: string) {
        html = value;
        htmlSets += 1;
      },
      get messages() {
        return messages;
      },
      onDidReceiveMessage(listener) {
        messageListeners.push(listener);
        return { dispose() {} };
      },
      postMessage(message) {
        messages.push(message);
        return Promise.resolve(true);
      },
    },
    get htmlSets() {
      return htmlSets;
    },
    get revealCount() {
      return revealCount;
    },
    reveal() {
      revealCount += 1;
    },
    fireMessage(message) {
      for (const listener of [...messageListeners]) listener(message);
    },
    onDidDispose(listener) {
      disposeListeners.push(listener);
      return { dispose() {} };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const listener of disposeListeners) listener();
      disposeListeners = [];
    },
  };
  return panel;
}

export const window = {
  createOutputChannel(_name: string) {
    return {
      appendLine(_line: string): void {},
      dispose(): void {},
    };
  },
  createWebviewPanel(
    viewType: string,
    title: string,
    _showOptions: unknown,
    options: Record<string, unknown> = {}
  ): FakeWebviewPanel {
    const panel = createFakeWebviewPanel(viewType, title, options);
    createdWebviewPanels.push(panel);
    return panel;
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