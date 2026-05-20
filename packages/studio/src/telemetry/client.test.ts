// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from "vitest";

// `shouldTrack()` reads `POSTHOG_API_KEY` from module-level const that's
// evaluated at module load time, so changing `import.meta.env` after import
// has no effect on the key. Each test resets module cache and re-imports.

const OPT_OUT_KEY = "hyperframes-studio:telemetryDisabled";

function setKey(value: string | undefined): void {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_POSTHOG_KEY;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_POSTHOG_KEY = value;
  }
}

function setNoTelemetry(value: string | undefined): void {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_NO_TELEMETRY;
  } else {
    (import.meta.env as Record<string, unknown>).VITE_HYPERFRAMES_NO_TELEMETRY = value;
  }
}

function setDev(value: boolean): void {
  (import.meta.env as { DEV: boolean }).DEV = value;
}

async function loadShouldTrack(): Promise<() => boolean> {
  vi.resetModules();
  const mod = await import("./client");
  return mod.shouldTrack;
}

describe("studio client shouldTrack", () => {
  beforeEach(() => {
    setDev(false);
    setKey("phc_test_key");
    setNoTelemetry(undefined);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("returns true when key is configured, not in dev mode, and no opt-outs", async () => {
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(true);
  });

  it("returns false when API key does not start with phc_", async () => {
    setKey("not_a_real_key");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when API key is empty string", async () => {
    setKey("");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when user has opted out via localStorage", async () => {
    localStorage.setItem(OPT_OUT_KEY, "1");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when navigator.doNotTrack is '1'", async () => {
    vi.stubGlobal("navigator", { ...navigator, doNotTrack: "1" });
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when VITE_HYPERFRAMES_NO_TELEMETRY=1 at build time", async () => {
    setNoTelemetry("1");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false when VITE_HYPERFRAMES_NO_TELEMETRY='true'", async () => {
    setNoTelemetry("true");
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("returns false in vite dev mode", async () => {
    setDev(true);
    const shouldTrack = await loadShouldTrack();
    expect(shouldTrack()).toBe(false);
  });

  it("memoizes its decision after the first call", async () => {
    const shouldTrack = await loadShouldTrack();
    const first = shouldTrack();
    // Flip an underlying input — memoized return must not change.
    localStorage.setItem(OPT_OUT_KEY, "1");
    expect(shouldTrack()).toBe(first);
  });
});
