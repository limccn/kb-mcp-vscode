/** Test-only seam for the `vscode.lm` stand-in used by the unit-test bundle. */

export interface LmRegistration {
  dispose(): void;
}

export interface LmApi {
  registerMcpServerDefinitionProvider(id: string, provider: unknown): LmRegistration;
}

let current: LmApi | undefined;

export function setLmApi(value: LmApi | undefined): void {
  current = value;
}

export function getLmApi(): LmApi | undefined {
  return current;
}