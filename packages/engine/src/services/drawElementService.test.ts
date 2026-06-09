import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { detectSwiftShader, resolveDrawElementCaptureMode } from "./drawElementService.js";

// ── detectSwiftShader ──────────────────────────────────────────────────────────

describe("detectSwiftShader", () => {
  function makePage(evaluateResult: unknown): Page {
    return {
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
    } as unknown as Page;
  }

  it("returns true when renderer includes 'swiftshader'", async () => {
    const page = makePage(true);
    expect(await detectSwiftShader(page)).toBe(true);
  });

  it("returns false for a standard GPU renderer string", async () => {
    const page = makePage(false);
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("returns false when WebGL is unavailable", async () => {
    const page = makePage(false);
    expect(await detectSwiftShader(page)).toBe(false);
  });

  it("passes a function to page.evaluate", async () => {
    const page = makePage(false);
    await detectSwiftShader(page);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ── resolveDrawElementCaptureMode ──────────────────────────────────────────────

describe("resolveDrawElementCaptureMode", () => {
  // signature: (isSwiftShader, transparent, hasVideo?, beginFramePaints?)
  it("opaque + SwiftShader → drawelement (opaque works on SwiftShader)", () => {
    expect(resolveDrawElementCaptureMode(true, false)).toBe("drawelement");
  });

  it("transparent + SwiftShader → screenshot (SwiftShader bug: sub-layers dropped)", () => {
    expect(resolveDrawElementCaptureMode(true, true)).toBe("screenshot");
  });

  it("transparent + GPU → drawelement (GPU handles transparent correctly)", () => {
    expect(resolveDrawElementCaptureMode(false, true)).toBe("drawelement");
  });

  it("opaque + GPU → drawelement", () => {
    expect(resolveDrawElementCaptureMode(false, false)).toBe("drawelement");
  });

  // ── video routing: drawElementImage can't capture video on any platform ──
  it("video → screenshot (drawElementImage does not capture video frames)", () => {
    expect(resolveDrawElementCaptureMode(false, false, /* hasVideo */ true)).toBe("screenshot");
  });

  it("video + GPU still screenshot (verified broken on macOS and Linux/BeginFrame)", () => {
    expect(resolveDrawElementCaptureMode(false, false, true)).toBe("screenshot");
  });

  it("no video → drawelement", () => {
    expect(resolveDrawElementCaptureMode(false, false, false)).toBe("drawelement");
  });
});
