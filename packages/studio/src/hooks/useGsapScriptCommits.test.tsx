// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two preview-sync primitives so we can assert which path runCommit took.
// `patchRuntimeTweenInPlace` is the instant in-place patch; `applySoftReload` is
// the existing fallback. `extractGsapScriptText` is re-exported from the same
// module and used elsewhere in the hook — keep it a harmless stub.
const patchRuntimeTweenInPlace = vi.fn<(...args: unknown[]) => boolean>();
const applySoftReload = vi.fn<(...args: unknown[]) => boolean>();

vi.mock("./gsapRuntimePatch", () => ({
  patchRuntimeTweenInPlace: (...args: unknown[]) => patchRuntimeTweenInPlace(...args),
}));
vi.mock("../utils/gsapSoftReload", () => ({
  applySoftReload: (...args: unknown[]) => applySoftReload(...args),
  extractGsapScriptText: () => "",
}));

// Tell React this is an act-capable environment so act(...) flushes effects
// without warning (React reads this global at call time).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { MutationResult } from "./gsapScriptCommitTypes";
import { applyPreviewSync, useGsapScriptCommits } from "./useGsapScriptCommits";

// ── applyPreviewSync (pure preview-sync decision) ────────────────────────────

const FAKE_IFRAME = {} as HTMLIFrameElement;

function result(over: Partial<MutationResult> = {}): MutationResult {
  return { ok: true, scriptText: "tl.set('#a',{})", ...over };
}

describe("applyPreviewSync", () => {
  beforeEach(() => {
    patchRuntimeTweenInPlace.mockReset();
    applySoftReload.mockReset();
  });

  it("instantPatch + patch succeeds: skips both soft reload and full reload", () => {
    patchRuntimeTweenInPlace.mockReturnValue(true);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result(),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    expect(patchRuntimeTweenInPlace).toHaveBeenCalledWith(FAKE_IFRAME, "#a", {
      kind: "set",
      props: { x: 10 },
    });
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("instantPatch + patch fails: falls back to the soft reload", () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue(true);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT");
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("instantPatch + patch fails + soft reload fails: escalates to full reload", () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue(false);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("no instantPatch + softReload + scriptText: soft reloads (today's behavior)", () => {
    applySoftReload.mockReturnValue(true);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      { label: "x", softReload: true },
      reloadPreview,
    );

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT");
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("no instantPatch + softReload that fails: full reload (today's behavior)", () => {
    applySoftReload.mockReturnValue(false);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      { label: "x", softReload: true },
      reloadPreview,
    );

    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("no instantPatch + no softReload: full reload (today's behavior)", () => {
    const reloadPreview = vi.fn();

    applyPreviewSync(FAKE_IFRAME, result(), { label: "x" }, reloadPreview);

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});

// ── runCommit (full hook path: persist + preview sync) ───────────────────────

type HookApi = ReturnType<typeof useGsapScriptCommits>;

let cleanup: (() => void) | null = null;

function renderCommitHook() {
  const reloadPreview = vi.fn();
  const onCacheInvalidate = vi.fn();
  const forceReloadSdkSession = vi.fn();
  const recordEdit = vi.fn(async () => {});
  const showToast = vi.fn();

  const captured: { api: HookApi | null } = { api: null };
  function Probe() {
    captured.api = useGsapScriptCommits({
      projectIdRef: { current: "proj-1" },
      activeCompPath: "index.html",
      previewIframeRef: { current: FAKE_IFRAME },
      editHistory: { recordEdit },
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview,
      onCacheInvalidate,
      onFileContentChanged: undefined,
      showToast,
      sdkSession: null,
      writeProjectFile: undefined,
      forceReloadSdkSession,
    });
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  cleanup = () => act(() => root.unmount());
  const hookApi = captured.api;
  if (!hookApi) throw new Error("hook did not initialize");
  return {
    api: hookApi,
    reloadPreview,
    onCacheInvalidate,
    forceReloadSdkSession,
    recordEdit,
    showToast,
  };
}

const selection: DomEditSelection = { id: "a", selector: "#a" } as DomEditSelection;

function mockFetchResult(over: Partial<MutationResult> = {}): void {
  const body: MutationResult = {
    ok: true,
    changed: true,
    before: "BEFORE",
    after: "AFTER",
    scriptText: "SCRIPT",
    ...over,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
  );
}

describe("runCommit — instantPatch wiring", () => {
  beforeEach(() => {
    patchRuntimeTweenInPlace.mockReset();
    applySoftReload.mockReset();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.unstubAllGlobals();
  });

  it("instantPatch succeeds: persists, invalidates cache, NO reload", async () => {
    patchRuntimeTweenInPlace.mockReturnValue(true);
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(
        selection,
        { x: 10 },
        {
          label: "drag",
          softReload: true,
          instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        },
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1); // source mutation persisted
    expect(deps.recordEdit).toHaveBeenCalledTimes(1);
    expect(deps.onCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });

  it("instantPatch fails: persists AND falls back to soft reload", async () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue(true);
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(
        selection,
        { x: 10 },
        {
          label: "drag",
          softReload: true,
          instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        },
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT");
    expect(deps.reloadPreview).not.toHaveBeenCalled();
    expect(deps.onCacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it("no instantPatch: identical to today — soft reload when softReload+scriptText", async () => {
    applySoftReload.mockReturnValue(true);
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(selection, { x: 10 }, { label: "drag", softReload: true });
    });

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT");
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });
});
