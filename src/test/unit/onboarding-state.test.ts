import * as assert from "node:assert/strict";
import {
  AUTO_OPEN_DELAY_MS,
  DEFAULT_STEPS,
  DEFAULT_VAULT_NAME,
  ONBOARDED_VERSION_KEY,
  decideOnboarding,
  parseOnboardingSteps,
} from "../../onboarding/state";

describe("decideOnboarding", () => {
  it("opens on a first install", () => {
    assert.deepEqual(decideOnboarding({ current: "0.1.4", firstInstall: true }), {
      open: true,
      reason: "first-install",
    });
  });

  it("opens for a 0.1.4 -> 0.2.0 major.minor upgrade", () => {
    assert.deepEqual(
      decideOnboarding({ current: "0.2.0", onboarded: "0.1.4", firstInstall: false }),
      { open: true, reason: "major-upgrade" }
    );
  });

  it("never auto-opens for a patch upgrade (AC-7)", () => {
    assert.deepEqual(decideOnboarding({ current: "0.2.1", onboarded: "0.2.0" }), {
      open: false,
      reason: "none",
    });
    assert.deepEqual(decideOnboarding({ current: "0.2.0", onboarded: "0.2.1" }), {
      open: false,
      reason: "none",
    });
  });

  it("treats a missing onboarded version as an upgrade of an older install", () => {
    assert.deepEqual(decideOnboarding({ current: "0.2.0" }), {
      open: true,
      reason: "major-upgrade",
    });
    assert.deepEqual(decideOnboarding({ current: "0.2.0", firstInstall: false }), {
      open: true,
      reason: "major-upgrade",
    });
  });

  it("keeps an unparseable onboarded version upgradable", () => {
    assert.deepEqual(decideOnboarding({ current: "0.2.0", onboarded: "garbage" }), {
      open: true,
      reason: "major-upgrade",
    });
  });

  it("ignores versionState when the user already saw this major.minor", () => {
    // The recordVersionState firstInstall flag is diagnostics only: a fresh
    // versionState written by a patch release must not reopen the guide.
    assert.deepEqual(
      decideOnboarding({ current: "0.2.1", onboarded: "0.2.0", firstInstall: true }),
      { open: false, reason: "none" }
    );
  });

  it("tolerates whitespace around versions", () => {
    assert.deepEqual(decideOnboarding({ current: " 0.2.0 ", onboarded: " 0.2.0 " }), {
      open: false,
      reason: "none",
    });
  });
});

describe("onboarding defaults", () => {
  it("recommends CLI tools and leaves MCP/skills opt-in", () => {
    assert.deepEqual({ ...DEFAULT_STEPS }, { cli: true, mcp: false });
  });

  it("parses finish-step messages without trusting arbitrary values", () => {
    // Missing payloads fall back to the recommended defaults.
    assert.deepEqual(parseOnboardingSteps(undefined), { cli: true, mcp: false });
    assert.deepEqual(parseOnboardingSteps(null), { cli: true, mcp: false });
    assert.deepEqual(parseOnboardingSteps("cli"), { cli: true, mcp: false });
    assert.deepEqual(parseOnboardingSteps({ cli: true, mcp: true }), { cli: true, mcp: true });
    assert.deepEqual(parseOnboardingSteps({ cli: "yes", mcp: 1 }), { cli: false, mcp: false });
  });

  it("pins the state key, vault name, and auto-open delay", () => {
    assert.equal(ONBOARDED_VERSION_KEY, "kbmcp.onboardedVersion");
    assert.equal(DEFAULT_VAULT_NAME, "default");
    assert.equal(AUTO_OPEN_DELAY_MS, 800);
  });
});