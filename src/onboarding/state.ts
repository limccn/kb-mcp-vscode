/**
 * Pure first-run / major-upgrade decisions for the setup guide.
 *
 * No `vscode` import: the version matrix (PRD AC-2/AC-7) is unit-testable.
 * `kbmcp.onboardedVersion` is the authoritative trigger. `kbmcp.versionState`
 * (written by `recordVersionState`) only labels the reason; it must never
 * reopen a version the user already finished or skipped (0.2.0 → 0.2.1).
 */

import type { CliToolState } from "../cliTools";
import { majorMinor } from "../migration";

export type { CliToolState } from "../cliTools";

/** Written when the guide is finished, skipped, or closed. */
export const ONBOARDED_VERSION_KEY = "kbmcp.onboardedVersion";

/** Vault registered for a brand-new data root. */
export const DEFAULT_VAULT_NAME = "default";

/** Delay after the migration gate settles before the guide auto-opens. */
export const AUTO_OPEN_DELAY_MS = 800;

export type OnboardingReason = "first-install" | "major-upgrade" | "manual" | "none";

export interface OnboardingDecision {
  open: boolean;
  reason: OnboardingReason;
}

export interface OnboardingDecisionArgs {
  current: string;
  onboarded?: string | null;
  /** `kbmcp.versionState.firstInstall`; labels a missing `onboarded`, never forces a reopen. */
  firstInstall?: boolean;
}

/**
 * Auto-open matrix:
 * - no `onboardedVersion` → open (`first-install` when versionState says so,
 *   otherwise `major-upgrade`: an install that predates the guide)
 * - onboarded major.minor differs from current → open (`major-upgrade`)
 * - same major.minor → never auto-open (patch upgrades included)
 */
export function decideOnboarding(args: OnboardingDecisionArgs): OnboardingDecision {
  const current = args.current.trim();
  const onboarded = (args.onboarded ?? "").trim();
  if (onboarded === "") {
    return { open: true, reason: args.firstInstall ? "first-install" : "major-upgrade" };
  }
  const currentKey = majorMinor(current);
  const onboardedKey = majorMinor(onboarded);
  if (currentKey !== "" && currentKey === onboardedKey) {
    return { open: false, reason: "none" };
  }
  return { open: true, reason: "major-upgrade" };
}

/** Checkbox defaults: CLI tools are recommended, MCP/skills are opt-in. */
export interface OnboardingSteps {
  cli: boolean;
  mcp: boolean;
}

export const DEFAULT_STEPS: OnboardingSteps = { cli: true, mcp: false };

export function parseOnboardingSteps(raw: unknown): OnboardingSteps {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STEPS };
  const message = raw as Record<string, unknown>;
  return { cli: message.cli === true, mcp: message.mcp === true };
}

export interface OnboardingToolStatus {
  name: string;
  state: CliToolState;
}

export interface OnboardingCliState {
  status: "ready" | "unavailable";
  targetDir: string;
  tools: OnboardingToolStatus[];
  pathContainsTarget: boolean;
  pathHint: string;
  message?: string;
}

export interface OnboardingMcpLegacy {
  agent: string;
  scope: string;
  skills: string[];
  mcp: string;
}

export interface OnboardingMcpTarget {
  agent: string;
  scope: string;
  mcp: string;
  legacy: OnboardingMcpLegacy;
}

export interface OnboardingMcpState {
  status: "ready" | "unavailable";
  targets: OnboardingMcpTarget[];
  legacy: OnboardingMcpLegacy[];
  message?: string;
}

export interface OnboardingDataState {
  status: "ready" | "unavailable";
  /** Effective root the extension's child processes use. */
  dataRoot: string;
  /** Raw `data_dir` from the runtime config ("" when unset). */
  configDataDir: string;
  /** `kbMcp.dataRoot` or an inherited KB_MCP_HOME pin. */
  pinnedBy: "setting" | "env" | null;
  initialized: boolean;
  vaults: number;
  candidates: { path: string; kind: string; vaults: number; documents: number | null }[];
  message?: string;
}

export interface OnboardingState {
  version: string;
  cli: OnboardingCliState;
  mcp: OnboardingMcpState;
  data: OnboardingDataState;
}