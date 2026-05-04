import { useState, useCallback, useRef, useEffect, useMemo, type MouseEvent } from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { liveTime, usePlayerStore } from "./player";
import type { TimelineElement } from "./player";
import { LintModal } from "./components/LintModal";
import type { LintFinding } from "./components/LintModal";
import { MediaPreview } from "./components/MediaPreview";
import { RotateCcw, RotateCw } from "./icons/SystemIcons";
import { FONT_EXT, isMediaFile } from "./utils/mediaTypes";
import {
  buildTimelineAssetId,
  buildTimelineAssetInsertHtml,
  buildTimelineFileDropPlacements,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetInitialGeometry,
  resolveTimelineAssetSrc,
  type TimelineAssetKind,
} from "./utils/timelineAssetDrop";
import { CaptionOverlay } from "./captions/components/CaptionOverlay";
import { CaptionPropertyPanel } from "./captions/components/CaptionPropertyPanel";
import { CaptionTimeline } from "./captions/components/CaptionTimeline";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { parseCaptionComposition } from "./captions/parser";
import { copyTextToClipboard } from "./utils/clipboard";
import { useSharedEditHistory } from "./hooks/useSharedEditHistory";
import {
  applyPatchByTarget,
  findSourceLocationByTarget,
  readAttributeByTarget,
  readTagSnippetByTarget,
  type PatchOperation,
} from "./utils/sourcePatcher";
import {
  buildTrackZIndexMap,
  formatTimelineAttributeNumber,
} from "./player/components/timelineEditing";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "./player/components/timelineZoom";
import {
  getTimelineToggleTitle,
  shouldHandleTimelineToggleHotkey,
} from "./utils/timelineDiscovery";
import { buildFrameCaptureFilename, buildFrameCaptureUrl } from "./utils/frameCapture";
import { Camera } from "./icons/SystemIcons";
import { PropertyPanel } from "./components/editor/PropertyPanel";
import { TimelineThumbnailContent } from "./player/components/TimelineThumbnailContent";
import { AudioWaveform } from "./player/components/AudioWaveform";
import { googleFontStylesheetUrl } from "./components/editor/fontCatalog";
import {
  fontFamilyFromAssetPath,
  importedFontFaceCss,
  type ImportedFontAsset,
} from "./components/editor/fontAssets";
import { DomEditOverlay } from "./components/editor/DomEditOverlay";
import { TimelineLayerPanel } from "./components/editor/TimelineLayerPanel";
import {
  buildDefaultDomEditTextField,
  buildDomEditDetachPatchOperations,
  buildDomEditMovePatchOperations,
  buildDomEditResizePatchOperations,
  buildDomEditStylePatchOperation,
  buildDomEditTextPatchOperation,
  buildElementAgentPrompt,
  collectDomEditLayerItems,
  countDomEditChildLayers,
  findElementForSelection,
  getDomEditLayerKey,
  isTextEditableSelection,
  serializeDomEditTextFields,
  resolveDomEditCapabilities,
  resolveDomEditSelection,
  type DomEditLayerItem,
  type DomEditTextField,
  type DomEditSelection,
} from "./components/editor/domEditing";
import {
  buildMotionAgentContext,
  buildDomEditMotionPatchOperations,
  buildMotionVarsId,
  clampMotionDraftToTimeline,
  detectMotionOwnership,
  parseMotionDraft,
  type MotionDraft,
} from "./components/editor/motionEditing";
import { saveProjectFilesWithHistory } from "./utils/studioFileHistory";
import { getStudioThumbnailService } from "./thumbnails/studioThumbnailService";
import { hashThumbnailSource } from "./thumbnails/sourceHash";
import {
  canInspectTimelineElement,
  getTimelineLayerVisibilityInPreview,
  getTimelineElementKey,
  isTimelineLayerVisibleInPreview,
  isAudioTimelineElement,
  shouldShowTimelineInspectorBounds,
} from "./utils/timelineInspector";

interface EditingFile {
  path: string;
  content: string | null;
}

interface AppToast {
  message: string;
  tone: "error" | "info";
}

interface PreviewPlayerCompat {
  getTime: () => number;
  renderSeek: (timeSeconds: number) => void;
}

type RightPanelTab = "design" | "renders";

function getPreviewPlayer(win: Window | null | undefined): PreviewPlayerCompat | null {
  const player = (win as (Window & { __player?: unknown }) | null | undefined)?.__player;
  if (!player || typeof player !== "object") return null;
  const maybePlayer = player as Partial<PreviewPlayerCompat>;
  return typeof maybePlayer.getTime === "function" && typeof maybePlayer.renderSeek === "function"
    ? (maybePlayer as PreviewPlayerCompat)
    : null;
}

function parseFiniteSeconds(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveLayerVisibleSeekTime(
  layerElement: HTMLElement,
  timelineElement: TimelineElement | null,
  player: PreviewPlayerCompat | null,
): number | null {
  if (!timelineElement || !player) return null;

  const clipStart = Math.max(0, timelineElement.start);
  const clipEnd = Math.max(clipStart, clipStart + Math.max(0, timelineElement.duration));
  const authoredStart = parseFiniteSeconds(
    layerElement.getAttribute("data-start") ??
      layerElement.closest<HTMLElement>("[data-start]")?.getAttribute("data-start") ??
      null,
  );
  const preferredTime =
    authoredStart == null
      ? clipStart
      : Math.min(clipEnd, Math.max(clipStart, clipStart + authoredStart));

  const candidates = [preferredTime, clipStart];
  const duration = Math.max(0, clipEnd - clipStart);
  if (duration > 0) {
    const maxSamples = 180;
    const frameStep = 1 / 24;
    const step = Math.max(frameStep, duration / maxSamples);
    for (let time = clipStart; time <= clipEnd + 0.0001; time += step) {
      candidates.push(Math.min(clipEnd, time));
    }
  }
  candidates.push(clipEnd);

  let lastTried = preferredTime;
  let clearestVisibleTime: number | null = null;
  let clearestVisibleOpacity = 0;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const time = Math.min(clipEnd, Math.max(clipStart, candidate));
    const key = time.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    lastTried = time;
    player.renderSeek(time);
    const visibility = getTimelineLayerVisibilityInPreview(layerElement);
    if (visibility.visible && visibility.compositeOpacity > clearestVisibleOpacity) {
      clearestVisibleTime = time;
      clearestVisibleOpacity = visibility.compositeOpacity;
    }
    if (isTimelineLayerVisibleInPreview(layerElement, { minCompositeOpacity: 0.9 })) return time;
  }

  return clearestVisibleTime ?? lastTried;
}

const GENERIC_FONT_FAMILIES = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

function primaryFontFamilyFromCss(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

function injectPreviewGoogleFont(doc: Document, fontFamilyValue: string): void {
  const family = primaryFontFamilyFromCss(fontFamilyValue);
  if (!family || GENERIC_FONT_FAMILIES.has(family.toLowerCase())) return;

  const id = `studio-preview-google-font-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (doc.getElementById(id)) return;

  const link = doc.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = googleFontStylesheetUrl(family);
  doc.head.appendChild(link);
}

function primaryFontFamilyValue(value: string): string {
  return (
    value
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "")
      .trim() ?? ""
  );
}

function injectPreviewImportedFont(doc: Document, asset: ImportedFontAsset): void {
  const id = `studio-imported-font-${asset.family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = importedFontFaceCss(asset);
  doc.head.appendChild(style);
}

function normalizeProjectAssetPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function normalizeRelativeProjectPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function extractPreviewAssetPath(value: string): string | null {
  try {
    const parsed = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : null;
    const path = parsed?.pathname ?? value;
    const marker = "/preview/";
    const markerIndex = path.indexOf(marker);
    if (markerIndex < 0) return null;
    const encodedPath = path.slice(markerIndex + marker.length);
    if (!encodedPath || encodedPath.startsWith("comp/")) return null;
    return normalizeRelativeProjectPath(decodeURIComponent(encodedPath));
  } catch {
    return null;
  }
}

function resolveTimelineAudioAssetPath(
  element: Pick<TimelineElement, "tag" | "src" | "sourceFile">,
): string | null {
  if (!isAudioTimelineElement(element) || !element.src) return null;
  const src = element.src.trim();
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;

  const previewPath = extractPreviewAssetPath(src);
  if (previewPath) return previewPath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;

  const cleanPath = src.split(/[?#]/)[0] ?? src;
  const baseDir = element.sourceFile?.includes("/")
    ? element.sourceFile.slice(0, element.sourceFile.lastIndexOf("/"))
    : "";
  return normalizeRelativeProjectPath(baseDir ? `${baseDir}/${cleanPath}` : cleanPath);
}

function encodeProjectRoutePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildWaveformUrl(projectId: string, assetPath: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/waveform/${encodeProjectRoutePath(assetPath)}`;
}

function getPreviewCompositionPathFromIframe(iframe: HTMLIFrameElement | null): string | null {
  if (!iframe?.src) return null;
  try {
    const pathname = new URL(iframe.src).pathname;
    const marker = "/preview/comp/";
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const encodedPath = pathname.slice(markerIndex + marker.length).replace(/^\/+/, "");
    return encodedPath ? decodeURIComponent(encodedPath) : null;
  } catch {
    return null;
  }
}

function getRenderedPreviewIframe(): HTMLIFrameElement | null {
  if (typeof document === "undefined") return null;
  const player = document.querySelector("hyperframes-player");
  const iframe = player?.shadowRoot?.querySelector("iframe");
  return iframe instanceof HTMLIFrameElement ? iframe : null;
}

function getCurrentPreviewIframe(
  refIframe: HTMLIFrameElement | null,
  stateIframe: HTMLIFrameElement | null,
): HTMLIFrameElement | null {
  return getRenderedPreviewIframe() ?? refIframe ?? stateIframe;
}

function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
  const fromParts = normalizeProjectAssetPath(sourceFile).split("/").filter(Boolean);
  const targetParts = normalizeProjectAssetPath(assetPath).split("/").filter(Boolean);

  fromParts.pop();

  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }

  return [...fromParts.map(() => ".."), ...targetParts].join("/") || assetPath;
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function toProjectAbsolutePath(projectDir: string | null, sourceFile: string): string | undefined {
  const trimmedSource = sourceFile.trim();
  if (!trimmedSource) return undefined;

  const normalizedSource = trimmedSource.replace(/\\/g, "/");
  if (isAbsoluteFilePath(normalizedSource)) return normalizedSource;

  const normalizedRoot = projectDir?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedRoot) return undefined;

  return `${normalizedRoot}/${normalizedSource.replace(/^\.?\//, "")}`;
}

function formatElementLocatorClipboardText({
  selection,
  absolutePath,
  sourceLocation,
  currentTime,
}: {
  selection: DomEditSelection;
  absolutePath: string;
  sourceLocation: NonNullable<ReturnType<typeof findSourceLocationByTarget>> | null;
  currentTime: number;
}): string {
  const pathWithLocation = sourceLocation
    ? `${absolutePath}:${sourceLocation.line}:${sourceLocation.column}`
    : absolutePath;
  const lines = [
    pathWithLocation,
    "",
    "HyperFrames selected element locator",
    `Absolute path: ${absolutePath}`,
    sourceLocation
      ? `LOC: ${sourceLocation.line}:${sourceLocation.column}`
      : "LOC: unavailable from current source",
    `Source file: ${selection.sourceFile}`,
    `Composition: ${selection.compositionPath}`,
    `Selector: ${selection.selector ?? "(none)"}`,
    `Selector index: ${selection.selectorIndex ?? 0}`,
    `DOM id: ${selection.id ?? "(none)"}`,
    `Tag: <${selection.tagName}>`,
    `Playback time: ${currentTime.toFixed(3)}s`,
  ];

  return lines.join("\n");
}

function ensureImportedFontFace(
  html: string,
  asset: ImportedFontAsset,
  sourceFile: string,
): string {
  const css = importedFontFaceCss(asset, toRelativeProjectAssetPath(sourceFile, asset.path));
  if (html.includes(css)) return html;

  const styleRe = /<style\b[^>]*data-hf-studio-fonts=(["'])true\1[^>]*>([\s\S]*?)<\/style>/i;
  const styleMatch = styleRe.exec(html);
  if (styleMatch) {
    const nextCss = `${styleMatch[2].trim()}\n${css}`.trim();
    return html.replace(styleMatch[0], `<style data-hf-studio-fonts="true">\n${nextCss}\n</style>`);
  }

  const styleTag = `<style data-hf-studio-fonts="true">\n${css}\n</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${styleTag}\n  </head>`);
  }
  return `${styleTag}\n${html}`;
}
function normalizeDomEditStyleValue(property: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (
    ["left", "top", "width", "height", "border-radius", "font-size"].includes(property) &&
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return `${trimmed}px`;
  }

  return trimmed;
}

function isImageBackgroundValue(value: string): boolean {
  return /^url\(/i.test(value.trim());
}

function shouldDetachOppositeEdges(selection: DomEditSelection): boolean {
  return Boolean(
    selection.inlineStyles.inset || selection.inlineStyles.right || selection.inlineStyles.bottom,
  );
}

function buildOppositeEdgePatchOperations(
  selection: DomEditSelection,
  dimension: "width" | "height" | "both",
): PatchOperation[] {
  if (!shouldDetachOppositeEdges(selection)) return [];
  const operations: PatchOperation[] = [];
  if (dimension === "width" || dimension === "both") {
    operations.push({ type: "inline-style", property: "right", value: "auto" });
  }
  if (dimension === "height" || dimension === "both") {
    operations.push({ type: "inline-style", property: "bottom", value: "auto" });
  }
  return operations;
}

function getEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object") return null;
  const maybeNode = target as {
    nodeType?: number;
    parentElement?: Element | null;
  };
  if (maybeNode.nodeType === 1) return target as HTMLElement;
  if (maybeNode.nodeType === 3 && maybeNode.parentElement) {
    return maybeNode.parentElement as HTMLElement;
  }
  return null;
}

function shouldIgnoreHistoryShortcut(target: EventTarget | null): boolean {
  const el = getEventTargetElement(target);
  if (!el) return false;
  return Boolean(
    el.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor"),
  );
}

function getHistoryShortcutLabel(action: "undo" | "redo"): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return action === "undo" ? `${modifier}+Z` : `${modifier}+Shift+Z`;
}

function isDomHTMLElement(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    (value as { nodeType?: unknown }).nodeType === 1 &&
    "getBoundingClientRect" in value &&
    typeof (value as { getBoundingClientRect?: unknown }).getBoundingClientRect === "function"
  );
}

function getDomEditCoalesceKey(
  selection: Pick<DomEditSelection, "id" | "selector" | "sourceFile">,
  action: "move" | "resize" | "motion",
): string {
  const target = selection.id || selection.selector || "selection";
  return `${action}:${selection.sourceFile || "index.html"}:${target}`;
}

function findMatchingTimelineElementId(
  selection: Pick<
    DomEditSelection,
    "id" | "selector" | "selectorIndex" | "sourceFile" | "compositionSrc" | "isCompositionHost"
  >,
  elements: TimelineElement[],
): string | null {
  for (const element of elements) {
    if (selection.id && element.domId === selection.id) {
      return element.key ?? element.id;
    }
    if (
      selection.isCompositionHost &&
      selection.compositionSrc &&
      element.compositionSrc === selection.compositionSrc
    ) {
      return element.key ?? element.id;
    }
    if (
      selection.selector &&
      element.selector === selection.selector &&
      (element.selectorIndex ?? 0) === (selection.selectorIndex ?? 0) &&
      (element.sourceFile ?? "index.html") === selection.sourceFile
    ) {
      return element.key ?? element.id;
    }
  }

  return null;
}

function findMappedCompositionHost(
  target: HTMLElement,
  timelineElements: TimelineElement[],
  compIdToSrc: Map<string, string>,
  fileTree: string[],
): { host: HTMLElement; compositionSrc: string } | null {
  const rootCompositionId =
    target.ownerDocument
      .querySelector("[data-composition-id]")
      ?.getAttribute("data-composition-id") ?? null;

  let nestedCurrent: HTMLElement | null = target;
  while (nestedCurrent) {
    const nestedCompId = nestedCurrent.getAttribute("data-composition-id");
    if (nestedCompId && nestedCompId !== rootCompositionId) {
      const hostCandidate = nestedCurrent.parentElement?.closest(".clip");
      if (isDomHTMLElement(hostCandidate)) {
        const hostCompId = hostCandidate.getAttribute("data-composition-id");
        const compositionSrc =
          hostCandidate.getAttribute("data-composition-src") ??
          hostCandidate.getAttribute("data-composition-file") ??
          (hostCompId ? compIdToSrc.get(hostCompId) : undefined) ??
          compIdToSrc.get(nestedCompId) ??
          fileTree.find((path) => path.endsWith(`${nestedCompId}.html`)) ??
          undefined;
        if (compositionSrc) {
          return { host: hostCandidate, compositionSrc };
        }
      }
    }
    nestedCurrent = nestedCurrent.parentElement;
  }

  let current: HTMLElement | null = target;
  while (current) {
    const compId = current.getAttribute("data-composition-id");
    const directSrc =
      current.getAttribute("data-composition-src") ??
      current.getAttribute("data-composition-file") ??
      undefined;
    const timelineMatch =
      timelineElements.find(
        (element) =>
          Boolean(element.compositionSrc) &&
          (element.domId === current?.id ||
            (current?.id && element.id === current.id) ||
            (compId && element.id === compId)),
      ) ?? null;
    const compositionSrc =
      directSrc ??
      timelineMatch?.compositionSrc ??
      (compId ? compIdToSrc.get(compId) : undefined) ??
      (compId ? fileTree.find((path) => path.endsWith(`${compId}.html`)) : undefined);
    if (compositionSrc) {
      return { host: current, compositionSrc };
    }
    current = current.parentElement;
  }

  return null;
}

function isMoveStyleProperty(property: string): boolean {
  return property === "left" || property === "top";
}

function isResizeStyleProperty(property: string): boolean {
  return property === "width" || property === "height";
}

function getDomDetachCoordinateRoot(element: HTMLElement): HTMLElement {
  const offsetParent = element.offsetParent;
  if (isDomHTMLElement(offsetParent)) return offsetParent;

  let current = element.parentElement;
  while (current) {
    if (current.hasAttribute("data-composition-id")) return current;
    current = current.parentElement;
  }

  return element.ownerDocument.body;
}

function measureDomDetachRect(element: HTMLElement): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const root = getDomDetachCoordinateRoot(element);
  const rect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();

  return {
    left: rect.left - rootRect.left + root.scrollLeft,
    top: rect.top - rootRect.top + root.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

// ── Ask Agent Modal ──

function AskAgentModal({
  selectionLabel,
  motionContextIncluded,
  onSubmit,
  onClose,
}: {
  selectionLabel: string;
  motionContextIncluded?: boolean;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useMountEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/60">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">Ask agent</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              {selectionLabel.length > 50 ? `${selectionLabel.slice(0, 49)}…` : selectionLabel}
            </p>
            {motionContextIncluded && (
              <div className="mt-2 inline-flex rounded-full border border-[#3ce6ac]/30 bg-[#3ce6ac]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#c4fff0]">
                Motion context included
              </div>
            )}
          </div>
          <button
            className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <textarea
            ref={inputRef}
            className="w-full h-24 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-sm text-neutral-200 placeholder-neutral-600 resize-none focus:outline-none focus:border-studio-accent/60 focus:ring-1 focus:ring-studio-accent/30"
            placeholder="Describe what you want to change…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-800/60">
          <span className="text-[11px] text-neutral-600">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to copy
          </span>
          <button
            className="px-4 py-1.5 rounded-lg bg-studio-accent/90 text-xs font-medium text-neutral-950 hover:bg-studio-accent disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!value.trim()}
            onClick={handleSubmit}
          >
            Copy prompt
          </button>
        </div>
      </div>
    </div>
  );
}

function selectionHasMotionAgentContext(selection: DomEditSelection): boolean {
  if (selection.dataAttributes["hf-motion"]) return true;
  return (
    detectMotionOwnership({
      element: selection.element,
      dataAttributes: selection.dataAttributes,
      computedStyles: selection.computedStyles,
    }).badges.length > 0
  );
}

function resolveSelectionMotionMaxDuration(
  selection: DomEditSelection | null,
  fallbackDuration: number,
): number {
  const clipElement = selection?.element.closest(".clip") ?? selection?.element ?? null;
  const rawDuration =
    clipElement?.getAttribute("data-duration") ?? selection?.element.getAttribute("data-duration");
  const parsedDuration = rawDuration != null ? Number.parseFloat(rawDuration) : null;
  if (parsedDuration != null && Number.isFinite(parsedDuration) && parsedDuration > 0) {
    return parsedDuration;
  }
  return fallbackDuration;
}

const DEFAULT_TIMELINE_ASSET_DURATION: Record<TimelineAssetKind, number> = {
  image: 3,
  video: 5,
  audio: 5,
};

function collectHtmlIds(source: string): string[] {
  return Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1] ?? "");
}

async function resolveDroppedAssetDuration(
  projectId: string,
  assetPath: string,
  kind: TimelineAssetKind,
): Promise<number> {
  if (kind === "image") return DEFAULT_TIMELINE_ASSET_DURATION.image;

  const media = document.createElement(kind === "video" ? "video" : "audio");
  media.preload = "metadata";
  media.src = `/api/projects/${projectId}/preview/${assetPath}`;

  const duration = await new Promise<number>((resolve) => {
    const timeout = window.setTimeout(() => resolve(DEFAULT_TIMELINE_ASSET_DURATION[kind]), 3000);
    const finalize = (value: number) => {
      window.clearTimeout(timeout);
      resolve(value);
    };

    media.addEventListener(
      "loadedmetadata",
      () => {
        const raw = Number(media.duration);
        finalize(
          Number.isFinite(raw) && raw > 0
            ? Math.round(raw * 100) / 100
            : DEFAULT_TIMELINE_ASSET_DURATION[kind],
        );
      },
      { once: true },
    );
    media.addEventListener("error", () => finalize(DEFAULT_TIMELINE_ASSET_DURATION[kind]), {
      once: true,
    });
  });

  media.src = "";
  media.load();
  return duration;
}

// ── Main App ──

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useMountEffect(() => {
    const hashMatch = window.location.hash.match(/^#project\/([^/]+)/);
    if (hashMatch) {
      setProjectId(hashMatch[1]);
      setResolving(false);
      return;
    }
    // No hash — auto-select first available project
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const first = (data.projects ?? [])[0];
        if (first) {
          setProjectId(first.id);
          window.location.hash = `#project/${first.id}`;
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  });

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);

  // Resizable and collapsible panel widths
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("renders");
  const [domEditSelection, setDomEditSelection] = useState<DomEditSelection | null>(null);
  const [agentPromptTagSnippet, setAgentPromptTagSnippet] = useState<string | undefined>();
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [copiedElementLocator, setCopiedElementLocator] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [previewIframe, setPreviewIframe] = useState<HTMLIFrameElement | null>(null);
  const [previewDocumentVersion, setPreviewDocumentVersion] = useState(0);
  // Auto-enter caption edit mode when the iframe contains .caption-group elements.
  // This is a subscription to external events (postMessage from runtime) — useEffect
  // is appropriate here. The runtime fires "state"/"timeline" messages after all
  // compositions load, which triggers caption detection.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    let activating = false;

    const tryActivateCaptions = () => {
      if (useCaptionStore.getState().isEditMode || activating) {
        return;
      }

      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      let win: Window | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
        win = iframe?.contentWindow ?? null;
      } catch {
        return;
      }
      if (!doc || !win) return;

      const groups = doc.querySelectorAll(".caption-group");
      if (groups.length === 0) return;

      // Find the captions composition source path.
      // The runtime strips data-composition-src after loading, so also check
      // data-composition-file (set by the bundler) and the compIdToSrc map.
      let captionSrcPath: string | null = null;

      // Strategy 1: data-composition-src or data-composition-file attributes
      const compHosts = doc.querySelectorAll("[data-composition-src], [data-composition-file]");
      for (const host of compHosts) {
        const src =
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
        if (src && src.includes("captions")) {
          captionSrcPath = src;
          break;
        }
      }

      // Strategy 2: compIdToSrc map (built from raw index.html before runtime strips attrs)
      if (!captionSrcPath) {
        for (const [id, src] of compIdToSrc) {
          if (id.includes("caption") || src.includes("caption")) {
            captionSrcPath = src;
            break;
          }
        }
      }

      // Strategy 3: activeCompPath if viewing captions directly
      if (!captionSrcPath && activeCompPath?.includes("captions")) {
        captionSrcPath = activeCompPath;
      }

      // Strategy 4: find composition element with "caption" in its ID
      if (!captionSrcPath) {
        const captionComp = doc.querySelector('[data-composition-id*="caption"]');
        if (captionComp) {
          const compId = captionComp.getAttribute("data-composition-id") || "";
          captionSrcPath = compIdToSrc.get(compId) || null;
        }
      }

      if (!captionSrcPath) return;

      activating = true;
      const srcPath = captionSrcPath;
      fetch(`/api/projects/${projectId}/files/${encodeURIComponent(srcPath)}`)
        .then((r) => r.json())
        .then((data: { content?: string }) => {
          if (!data.content || !doc || !win || useCaptionStore.getState().isEditMode) return;
          const root = doc.querySelector("[data-composition-id]");
          const w = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
          const h = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
          const dur = parseFloat(root?.getAttribute("data-duration") ?? "0");
          const model = parseCaptionComposition(doc, win, data.content, w, h, dur);
          if (!model) return;
          const store = useCaptionStore.getState();
          store.setModel(model);
          store.setSourceFilePath(srcPath);
          store.setEditMode(true);
          captionSync.loadOverrides();
        })
        .catch(() => {})
        .finally(() => {
          activating = false;
        });
    };

    // Listen for runtime messages that signal composition loading is complete
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        const currentIframe = getRenderedPreviewIframe();
        if (currentIframe && currentIframe !== previewIframeRef.current) {
          previewIframeRef.current = currentIframe;
          setPreviewIframe(currentIframe);
        }
        setPreviewDocumentVersion((version) => version + 1);
        tryActivateCaptions();
      }
    };

    window.addEventListener("message", handleMessage);
    // Try immediately in case compositions are already loaded
    tryActivateCaptions();

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [activeCompPath, projectId, compIdToSrc, captionSync]);

  // Auto-expand right panel when a caption word is selected
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) {
      setRightCollapsed(!captionHasSelection);
    }
  }, [captionHasSelection, captionEditMode]);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [captureFrameTime, setCaptureFrameTime] = useState(0);
  const [thumbnailedTimelineElementIds, setThumbnailedTimelineElementIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [inspectedTimelineElementId, setInspectedTimelineElementId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlockedTimelineToastAtRef = useRef(0);
  const lastBlockedDomMoveToastAtRef = useRef(0);
  const selectedTimelineLayerRevealTimeRef = useRef<number | null>(null);
  const selectedTimelineLayerRevealUntilRef = useRef(0);
  const importedFontAssetsRef = useRef<ImportedFontAsset[]>([]);
  const previewHotkeyWindowRef = useRef<Window | null>(null);
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const refreshPreviewDocumentVersion = useCallback(() => {
    setPreviewDocumentVersion((version) => version + 1);
    window.setTimeout(() => setPreviewDocumentVersion((version) => version + 1), 50);
    window.setTimeout(() => setPreviewDocumentVersion((version) => version + 1), 250);
    window.setTimeout(() => setPreviewDocumentVersion((version) => version + 1), 1000);
  }, []);

  const isMasterView = !activeCompPath || activeCompPath === "index.html";
  const layerInspectionCompositionPath = useMemo(() => {
    void previewDocumentVersion;
    if (activeCompPath && activeCompPath !== "index.html") return activeCompPath;
    return (
      getPreviewCompositionPathFromIframe(
        getCurrentPreviewIframe(previewIframeRef.current, previewIframe),
      ) ?? activeCompPath
    );
  }, [activeCompPath, previewDocumentVersion, previewIframe]);
  const layerInspectionIsMasterView =
    !layerInspectionCompositionPath || layerInspectionCompositionPath === "index.html";
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!layerInspectionCompositionPath) return;
    let attempts = 0;
    let intervalId: number | null = null;
    const tick = () => {
      const iframe = getCurrentPreviewIframe(previewIframeRef.current, previewIframe);
      const hasCompositionRoot = Boolean(
        iframe?.contentDocument?.querySelector("[data-composition-id]"),
      );
      setPreviewDocumentVersion((version) => version + 1);
      attempts += 1;
      if ((hasCompositionRoot || attempts >= 20) && intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    tick();
    intervalId = window.setInterval(tick, 100);
    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [layerInspectionCompositionPath, previewIframe]);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const timelineElements = usePlayerStore((s) => s.elements);
  const setSelectedTimelineElementId = usePlayerStore((s) => s.setSelectedElementId);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const inspectedTimelineElement = useMemo(
    () =>
      timelineElements.find(
        (element) => getTimelineElementKey(element) === inspectedTimelineElementId,
      ) ?? null,
    [inspectedTimelineElementId, timelineElements],
  );
  const showInspectedTimelineBounds = useMemo(
    () => shouldShowTimelineInspectorBounds(currentTime, inspectedTimelineElement),
    [currentTime, inspectedTimelineElement],
  );
  const effectiveTimelineDuration = useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((element) => element.start + element.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
  const selectedMotionMaxDuration = useMemo(
    () => resolveSelectionMotionMaxDuration(domEditSelection, effectiveTimelineDuration),
    [domEditSelection, effectiveTimelineDuration],
  );
  const displayedTimelineZoomPercent = useMemo(
    () => getTimelineZoomPercent(zoomMode, manualZoomPercent),
    [zoomMode, manualZoomPercent],
  );
  useEffect(() => {
    setThumbnailedTimelineElementIds((current) => {
      if (current.size === 0) return current;
      const available = new Set(
        timelineElements
          .map(getTimelineElementKey)
          .filter((id): id is string => typeof id === "string"),
      );
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [timelineElements]);
  const handleTimelineElementThumbnailToggle = useCallback((element: TimelineElement) => {
    const elementKey = getTimelineElementKey(element);
    if (!elementKey) return;
    setThumbnailedTimelineElementIds((current) => {
      const next = new Set(current);
      if (next.has(elementKey)) {
        next.delete(elementKey);
      } else {
        next.add(elementKey);
      }
      return next;
    });
  }, []);
  const toggleTimelineVisibility = useCallback(() => {
    setTimelineVisible((visible) => !visible);
  }, []);
  const toggleLeftSidebar = useCallback(() => {
    setLeftCollapsed((collapsed) => !collapsed);
  }, []);
  const refreshCaptureFrameTime = useCallback(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
  }, []);

  useMountEffect(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
    return liveTime.subscribe(setCaptureFrameTime);
  });

  const captureFrameHref = projectId
    ? buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime: captureFrameTime,
      })
    : "#";
  const captureFrameFilename = buildFrameCaptureFilename(activeCompPath, captureFrameTime);
  useMountEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  });
  const handleTimelineToggleHotkey = useCallback(
    (event: KeyboardEvent) => {
      if (!shouldHandleTimelineToggleHotkey(event)) return;
      event.preventDefault();
      toggleTimelineVisibility();
    },
    [toggleTimelineVisibility],
  );

  useMountEffect(() => {
    window.addEventListener("keydown", handleTimelineToggleHotkey);
    return () => {
      window.removeEventListener("keydown", handleTimelineToggleHotkey);
    };
  });

  const syncPreviewTimelineHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const nextWindow = iframe?.contentWindow ?? null;
      if (previewHotkeyWindowRef.current === nextWindow) return;
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", handleTimelineToggleHotkey);
      }
      previewHotkeyWindowRef.current = nextWindow;
      nextWindow?.addEventListener("keydown", handleTimelineToggleHotkey);
    },
    [handleTimelineToggleHotkey],
  );

  useEffect(
    () => () => {
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", handleTimelineToggleHotkey);
        previewHotkeyWindowRef.current = null;
      }
    },
    [handleTimelineToggleHotkey],
  );

  const timelineToolbar = (
    <div className="border-b border-neutral-800/40 bg-neutral-950/96">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
          Timeline
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomMode("fit")}
            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
              zoomMode === "fit"
                ? "border-studio-accent/30 bg-studio-accent/10 text-studio-accent"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
            title="Fit timeline to width"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent));
            }}
            className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            title="Zoom out"
          >
            -
          </button>
          <div className="min-w-[58px] text-center text-[10px] font-medium tabular-nums text-neutral-500">
            {`${displayedTimelineZoomPercent}%`}
          </div>
          <button
            type="button"
            onClick={() => {
              setZoomMode("manual");
              setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
            }}
            className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={toggleTimelineVisibility}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
            title={getTimelineToggleTitle(true)}
            aria-label="Hide timeline editor"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 7h14" />
              <path d="m8 11 4 4 4-4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const consoleErrorsRef = useRef<LintFinding[]>([]);
  const copiedAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedElementLocatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domEditSelectionRef = useRef<DomEditSelection | null>(domEditSelection);
  const lastPreviewClickRef = useRef<{ key: string; at: number } | null>(null);
  const domEditSaveTimestampRef = useRef(0);
  const domTextCommitVersionRef = useRef(0);
  const fileContentCacheRef = useRef<Map<string, string>>(new Map());

  // Listen for external file changes (user editing HTML outside the editor).
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  // Suppress file-change events that echo back from a recent DOM edit save —
  // those changes are already applied to the iframe DOM and a full reload
  // would flash the preview.
  useMountEffect(() => {
    const handler = () => {
      if (Date.now() - domEditSaveTimestampRef.current < 1200) return;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 400);
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for embedded studio server
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  });
  projectIdRef.current = projectId;
  domEditSelectionRef.current = domEditSelection;

  // Load file tree when projectId changes.
  // Note: This is one of the few places where useEffect with deps is acceptable —
  // it's data fetching tied to a prop change. Ideally this would use a data-fetching
  // library (useQuery/useSWR) or the parent component would own the fetch.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fileContentCacheRef.current.clear();
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[]; dir?: string }) => {
        if (!cancelled && data.files) setFileTree(data.files);
        if (!cancelled) setProjectDir(typeof data.dir === "string" ? data.dir : null);
      })
      .catch(() => {
        if (!cancelled) setProjectDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadFileIntoEditor = useCallback((path: string, options?: { expandPanel?: boolean }) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    if (options?.expandPanel !== false) {
      setLeftWidth((prev) => Math.max(prev, Math.floor(window.innerWidth * 0.5)));
    }
    // Skip fetching binary content for media files — just set the path for preview
    if (isMediaFile(path)) {
      setEditingFile({ path, content: null });
      return;
    }
    const cacheKey = `${pid}\0${path}`;
    const cached = fileContentCacheRef.current.get(cacheKey);
    if (cached != null) {
      setEditingFile({ path, content: cached });
      return;
    }
    setEditingFile({ path, content: null });
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          fileContentCacheRef.current.set(cacheKey, data.content);
          if (editingPathRef.current && editingPathRef.current !== path) return;
          setEditingFile({ path, content: data.content });
        }
      })
      .catch(() => {});
  }, []);

  const handleFileSelect = useCallback(
    (path: string) => loadFileIntoEditor(path, { expandPanel: true }),
    [loadFileIntoEditor],
  );

  const handleCompositionSelect = useCallback(
    (comp: string) => {
      setActiveCompPath(comp === "index.html" || comp.startsWith("compositions/") ? comp : null);
      loadFileIntoEditor(comp, { expandPanel: false });
    },
    [loadFileIntoEditor],
  );

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;
  const editHistory = useSharedEditHistory({ projectId });

  const readProjectFile = useCallback(async (path: string): Promise<string> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`Failed to read ${path}`);
    const data = (await response.json()) as { content?: string };
    if (typeof data.content !== "string") throw new Error(`Missing file contents for ${path}`);
    fileContentCacheRef.current.set(`${pid}\0${path}`, data.content);
    return data.content;
  }, []);

  const writeProjectFile = useCallback(async (path: string, content: string): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid) throw new Error("No active project");
    const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!response.ok) throw new Error(`Failed to save ${path}`);
    fileContentCacheRef.current.set(`${pid}\0${path}`, content);
    if (editingPathRef.current === path) {
      setEditingFile({ path, content });
    }
  }, []);

  const resolveCompositionSourceHash = useCallback(
    async (path: string): Promise<string> => hashThumbnailSource(await readProjectFile(path)),
    [readProjectFile],
  );

  const renderTimelineClipContent = useCallback(
    (element: TimelineElement, style: { clip: string; label: string; accent?: string }) => {
      const activeProjectId = projectIdRef.current ?? projectId ?? "";
      if (isAudioTimelineElement(element)) {
        const audioAssetPath = resolveTimelineAudioAssetPath(element);
        return (
          <AudioWaveform
            audioUrl={element.src ?? ""}
            waveformUrl={
              activeProjectId && audioAssetPath
                ? buildWaveformUrl(activeProjectId, audioAssetPath)
                : undefined
            }
            label={element.label || element.id || element.tag}
            labelColor={style.label}
          />
        );
      }
      return (
        <TimelineThumbnailContent
          element={element}
          projectId={activeProjectId}
          style={style}
          resolveSourceHash={resolveCompositionSourceHash}
        />
      );
    },
    [projectId, resolveCompositionSourceHash],
  );

  // Project-scoped edit events cover shared history transactions and adopted
  // external/agent writes. The older HMR/file-change listener above remains as
  // a broad preview invalidation fallback for dev and embedded servers.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    const refreshFromProjectEvent = (event: MessageEvent | Event) => {
      let changedPaths: string[] = [];
      try {
        const data =
          event instanceof MessageEvent
            ? (JSON.parse(event.data) as { changedPaths?: unknown; unmanagedPaths?: unknown })
            : ((event as CustomEvent).detail as {
                changedPaths?: unknown;
                unmanagedPaths?: unknown;
              });
        if (Array.isArray(data.changedPaths)) {
          changedPaths = data.changedPaths.filter(
            (path): path is string => typeof path === "string",
          );
        }
        if (Array.isArray(data.unmanagedPaths)) {
          changedPaths.push(
            ...data.unmanagedPaths.filter((path): path is string => typeof path === "string"),
          );
        }
      } catch {
        changedPaths = [];
      }
      if (changedPaths.length === 0) {
        fileContentCacheRef.current.clear();
        void getStudioThumbnailService().clearProject(projectId);
      } else {
        for (const path of changedPaths) {
          fileContentCacheRef.current.delete(`${projectId}\0${path}`);
        }
      }

      const activePath = editingPathRef.current;
      if (activePath && (changedPaths.length === 0 || changedPaths.includes(activePath))) {
        readProjectFile(activePath)
          .then((content) => setEditingFile({ path: activePath, content }))
          .catch(() => {});
      }

      // NLELayout owns the actual preview refresh. Keep project events on the
      // same path as timeline/source edits so refreshPlayer() can preserve the
      // current player instance and seek position.
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((key) => key + 1), 250);
    };

    const events = new EventSource(`/api/projects/${projectId}/events`);
    events.addEventListener("file-change", refreshFromProjectEvent);
    events.addEventListener("project-edit", refreshFromProjectEvent);
    events.addEventListener("history-updated", refreshFromProjectEvent);
    window.addEventListener("hf:project-history-event", refreshFromProjectEvent);
    return () => {
      events.close();
      window.removeEventListener("hf:project-history-event", refreshFromProjectEvent);
    };
  }, [projectId, readProjectFile]);

  const handleContentChange = useCallback(
    (content: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const path = editingPathRef.current;
      if (!path) return;

      // Debounce the server write (600ms)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveProjectFilesWithHistory({
          projectId: pid,
          label: "Edit source",
          kind: "source",
          coalesceKey: `source:${path}`,
          files: { [path]: content },
          readFile: readProjectFile,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        })
          .then(() => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 600);
          })
          .catch(() => {});
      }, 600);
    },
    [editHistory.recordEdit, readProjectFile, writeProjectFile],
  );

  const handleTimelineElementMove = useCallback(
    async (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements
        .map((timelineElement) =>
          (timelineElement.key ?? timelineElement.id) === (element.key ?? element.id)
            ? { ...timelineElement, start: updates.start, track: updates.track }
            : timelineElement,
        )
        .filter(
          (timelineElement) =>
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
      const trackZIndices = buildTrackZIndexMap(
        relevantElements.map((timelineElement) => timelineElement.track),
      );
      const movedElementZIndex = trackZIndices.get(updates.track);

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "track-index",
        value: String(updates.track),
      });
      if (movedElementZIndex != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: "inline-style",
          property: "z-index",
          value: String(movedElementZIndex),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Move timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath, editHistory.recordEdit, timelineElements, writeProjectFile],
  );

  const handleTimelineElementResize = useCallback(
    async (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const playbackStartAttrName =
        element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
      const currentPlaybackStartValue =
        readAttributeByTarget(originalContent, patchTarget, "playback-start") ??
        readAttributeByTarget(originalContent, patchTarget, "media-start");
      const currentPlaybackStart =
        currentPlaybackStartValue != null ? parseFloat(currentPlaybackStartValue) : undefined;
      const trimDelta = updates.start - element.start;
      const fallbackPlaybackStart =
        updates.playbackStart == null &&
        trimDelta !== 0 &&
        Number.isFinite(currentPlaybackStart) &&
        currentPlaybackStart != null
          ? Math.max(0, currentPlaybackStart + trimDelta * Math.max(element.playbackRate ?? 1, 0.1))
          : undefined;
      const nextPlaybackStart = updates.playbackStart ?? fallbackPlaybackStart;

      let patchedContent = originalContent;
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "duration",
        value: formatTimelineAttributeNumber(updates.duration),
      });
      if (nextPlaybackStart != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: "attribute",
          property: playbackStartAttrName,
          value: formatTimelineAttributeNumber(nextPlaybackStart),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: "Resize timeline clip",
        kind: "timeline",
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath, editHistory.recordEdit, writeProjectFile],
  );

  const showToast = useCallback((message: string, tone: AppToast["tone"] = "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAppToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setAppToast(null), 4000);
  }, []);

  const handleCaptureFrameClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      if (!projectId) return;
      event.preventDefault();

      const currentTime = usePlayerStore.getState().currentTime;
      setCaptureFrameTime(currentTime);
      const href = buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime,
      });
      const filename = buildFrameCaptureFilename(activeCompPath, currentTime);

      try {
        const response = await fetch(href, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Capture failed (${response.status})`);
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Capture failed";
        showToast(message);
      }
    },
    [activeCompPath, projectId, showToast],
  );

  const handleTimelineElementDelete = useCallback(
    async (element: TimelineElement) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to read ${targetPath}`);
        }

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string") {
          throw new Error(`Missing file contents for ${targetPath}`);
        }

        const patchTarget = element.domId
          ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
          : element.selector
            ? { selector: element.selector, selectorIndex: element.selectorIndex }
            : null;
        if (!patchTarget) {
          throw new Error(`Timeline element ${element.id} is missing a patchable target`);
        }

        const resolvedTargetPath = targetPath || "index.html";
        const remainingElements = timelineElements.filter(
          (timelineElement) =>
            (timelineElement.key ?? timelineElement.id) !== (element.key ?? element.id) &&
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const trackZIndices = buildTrackZIndexMap(
          remainingElements.map((timelineElement) => timelineElement.track),
        );

        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) {
          throw new Error(`Failed to delete ${element.id} from ${targetPath}`);
        }

        const removeData = (await removeResponse.json()) as {
          changed?: boolean;
          content?: string;
        };
        let patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;
        for (const timelineElement of remainingElements) {
          const elementTarget = timelineElement.domId
            ? {
                id: timelineElement.domId,
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : timelineElement.selector
              ? {
                  selector: timelineElement.selector,
                  selectorIndex: timelineElement.selectorIndex,
                }
              : null;
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(timelineElement.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Delete timeline clip",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        usePlayerStore
          .getState()
          .setElements(
            timelineElements.filter(
              (timelineElement) =>
                (timelineElement.key ?? timelineElement.id) !== (element.key ?? element.id),
            ),
          );
        usePlayerStore.getState().setSelectedElementId(null);
        setRefreshKey((k) => k + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete timeline clip";
        showToast(message);
      }
    },
    [activeCompPath, editHistory.recordEdit, showToast, timelineElements, writeProjectFile],
  );

  const handleBlockedTimelineEdit = useCallback(
    (_element: TimelineElement) => {
      const now = Date.now();
      if (now - lastBlockedTimelineToastAtRef.current < 1500) return;
      lastBlockedTimelineToastAtRef.current = now;
      showToast("This clip can’t be moved or resized from the timeline yet.", "info");
    },
    [showToast],
  );

  const handleBlockedDomMove = useCallback(
    (selection: DomEditSelection) => {
      const now = Date.now();
      if (now - lastBlockedDomMoveToastAtRef.current < 1500) return;
      lastBlockedDomMoveToastAtRef.current = now;
      showToast(
        selection.capabilities.canDetachFromLayout
          ? "This layer is controlled by layout. Use Make movable in the panel to detach it."
          : (selection.capabilities.reasonIfDisabled ??
              "This element can’t be moved directly from the preview."),
        "info",
      );
    },
    [showToast],
  );

  const applyDomSelection = useCallback(
    (
      selection: DomEditSelection | null,
      options?: { revealPanel?: boolean; preserveTimelineSelection?: boolean },
    ) => {
      setDomEditSelection(selection);
      setAgentPromptTagSnippet(undefined);
      setCopiedAgentPrompt(false);
      if (selection) {
        if (options?.revealPanel !== false) {
          setRightCollapsed(false);
          setRightPanelTab("design");
        }
        const nextSelectedTimelineId = findMatchingTimelineElementId(selection, timelineElements);
        if (!options?.preserveTimelineSelection) {
          setSelectedTimelineElementId(nextSelectedTimelineId);
        }
        return;
      }

      if (!options?.preserveTimelineSelection) {
        setSelectedTimelineElementId(null);
      }
    },
    [setSelectedTimelineElementId, timelineElements],
  );

  const clearDomSelection = useCallback(() => {
    selectedTimelineLayerRevealTimeRef.current = null;
    selectedTimelineLayerRevealUntilRef.current = 0;
    setInspectedTimelineElementId(null);
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection]);

  useEffect(() => {
    if (!inspectedTimelineElementId || inspectedTimelineElement) return;
    setInspectedTimelineElementId(null);
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection, inspectedTimelineElement, inspectedTimelineElementId]);

  const handleUndo = useCallback(async () => {
    const result = await editHistory.undo({
      readFile: readProjectFile,
      writeFile: writeProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Undo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelection();
      setRefreshKey((key) => key + 1);
      showToast(`Undid ${result.label}`, "info");
    }
  }, [clearDomSelection, editHistory, readProjectFile, showToast, writeProjectFile]);

  const handleRedo = useCallback(async () => {
    const result = await editHistory.redo({
      readFile: readProjectFile,
      writeFile: writeProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Redo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelection();
      setRefreshKey((key) => key + 1);
      showToast(`Redid ${result.label}`, "info");
    }
  }, [clearDomSelection, editHistory, readProjectFile, showToast, writeProjectFile]);

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (shouldIgnoreHistoryShortcut(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void handleUndoRef.current();
        return;
      }
      if ((key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
        event.preventDefault();
        void handleRedoRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const buildDomSelectionFromTarget = useCallback(
    (target: HTMLElement, options?: { preferClipAncestor?: boolean }) => {
      if (isMasterView) {
        const mappedHost = findMappedCompositionHost(
          target,
          timelineElements,
          compIdToSrc,
          fileTree,
        );
        if (mappedHost) {
          const hostSelection = resolveDomEditSelection(mappedHost.host, {
            activeCompositionPath: activeCompPath,
            isMasterView,
            preferClipAncestor: options?.preferClipAncestor,
          });
          if (!hostSelection) return null;
          return {
            ...hostSelection,
            compositionSrc: mappedHost.compositionSrc,
            isCompositionHost: true,
            capabilities: resolveDomEditCapabilities({
              selector: hostSelection.selector,
              tagName: hostSelection.tagName,
              className: hostSelection.element.getAttribute("class") ?? "",
              inlineStyles: hostSelection.inlineStyles,
              computedStyles: hostSelection.computedStyles,
              hasStudioOwnedMotion: Boolean(hostSelection.dataAttributes["hf-motion"]),
              isCompositionHost: true,
              isMasterView: true,
            }),
          } satisfies DomEditSelection;
        }
      }

      return resolveDomEditSelection(target, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: options?.preferClipAncestor,
      });
    },
    [activeCompPath, compIdToSrc, fileTree, isMasterView, timelineElements],
  );

  const buildDomSelectionForTimelineElement = useCallback(
    (element: TimelineElement): DomEditSelection | null => {
      const iframe = getCurrentPreviewIframe(previewIframeRef.current, previewIframe);
      const doc = iframe?.contentDocument;
      if (!doc) return null;
      const effectiveCompositionPath = layerInspectionCompositionPath;

      const target = findElementForSelection(
        doc,
        {
          id: element.domId,
          selector: element.selector,
          selectorIndex: element.selectorIndex,
          sourceFile: element.sourceFile ?? effectiveCompositionPath ?? "index.html",
        },
        effectiveCompositionPath,
      );
      if (target) {
        if (!layerInspectionIsMasterView) {
          return (
            resolveDomEditSelection(target, {
              activeCompositionPath: effectiveCompositionPath,
              isMasterView: false,
              preferClipAncestor: false,
            }) ?? buildDomSelectionFromTarget(target)
          );
        }
        return buildDomSelectionFromTarget(target);
      }

      if (!layerInspectionIsMasterView) {
        const compositionRoot = doc.querySelector("[data-composition-id]");
        if (isDomHTMLElement(compositionRoot)) {
          return resolveDomEditSelection(compositionRoot, {
            activeCompositionPath: effectiveCompositionPath,
            isMasterView: false,
            preferClipAncestor: false,
          });
        }
      }

      return null;
    },
    [
      buildDomSelectionFromTarget,
      layerInspectionCompositionPath,
      layerInspectionIsMasterView,
      previewIframe,
    ],
  );

  const timelineLayerChildCounts = useMemo(() => {
    void previewDocumentVersion;
    const counts = new Map<string, number>();
    if (!getCurrentPreviewIframe(previewIframeRef.current, previewIframe)) return counts;

    for (const element of timelineElements) {
      if (!canInspectTimelineElement(element)) continue;
      const elementKey = getTimelineElementKey(element);
      if (!elementKey) continue;
      const selection = buildDomSelectionForTimelineElement(element);
      const childCount = countDomEditChildLayers(selection?.element, {
        activeCompositionPath: layerInspectionCompositionPath,
        isMasterView: layerInspectionIsMasterView,
      });
      if (childCount > 0) counts.set(elementKey, childCount);
    }

    return counts;
  }, [
    buildDomSelectionForTimelineElement,
    layerInspectionCompositionPath,
    layerInspectionIsMasterView,
    previewDocumentVersion,
    previewIframe,
    timelineElements,
  ]);

  const inspectedTimelineLayers = useMemo(() => {
    void previewDocumentVersion;
    if (!inspectedTimelineElement) return [];
    const selection = buildDomSelectionForTimelineElement(inspectedTimelineElement);
    return collectDomEditLayerItems(selection?.element, {
      activeCompositionPath: layerInspectionCompositionPath,
      isMasterView: layerInspectionIsMasterView,
    });
  }, [
    buildDomSelectionForTimelineElement,
    inspectedTimelineElement,
    layerInspectionCompositionPath,
    layerInspectionIsMasterView,
    previewDocumentVersion,
  ]);

  const selectedTimelineLayerKey = useMemo(
    () => (domEditSelection ? getDomEditLayerKey(domEditSelection) : null),
    [domEditSelection],
  );
  const selectedNestedTimelineLayer = Boolean(
    selectedTimelineLayerKey &&
    inspectedTimelineLayers.length > 0 &&
    selectedTimelineLayerKey !== inspectedTimelineLayers[0]?.key,
  );
  const showDomEditSelectionOverlay = Boolean(
    !rightCollapsed &&
    rightPanelTab === "design" &&
    inspectedTimelineElementId &&
    domEditSelection &&
    (showInspectedTimelineBounds || selectedNestedTimelineLayer),
  );
  const revealTimelineLayerElement = useCallback(
    (element: HTMLElement, options?: { settle?: boolean; preferStoredTime?: boolean }) => {
      const currentIframe = getCurrentPreviewIframe(previewIframeRef.current, previewIframe);
      const player = getPreviewPlayer(currentIframe?.contentWindow);
      const storedTime = selectedTimelineLayerRevealTimeRef.current;
      const targetTime =
        options?.preferStoredTime && storedTime != null
          ? storedTime
          : resolveLayerVisibleSeekTime(element, inspectedTimelineElement, player);
      if (targetTime == null || !player) return;

      selectedTimelineLayerRevealTimeRef.current = targetTime;
      player.renderSeek(targetTime);
      liveTime.notify(targetTime);
      usePlayerStore.getState().setCurrentTime(targetTime);

      if (options?.settle) {
        selectedTimelineLayerRevealUntilRef.current = Date.now() + 2000;
        window.setTimeout(
          () => revealTimelineLayerElement(element, { preferStoredTime: true }),
          50,
        );
        window.setTimeout(
          () => revealTimelineLayerElement(element, { preferStoredTime: true }),
          250,
        );
        window.setTimeout(
          () => revealTimelineLayerElement(element, { preferStoredTime: true }),
          750,
        );
        window.setTimeout(
          () => revealTimelineLayerElement(element, { preferStoredTime: true }),
          1500,
        );
      }
    },
    [inspectedTimelineElement, previewIframe],
  );

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!selectedNestedTimelineLayer || !domEditSelection) return;
    if (selectedTimelineLayerRevealTimeRef.current == null) return;
    if (Date.now() > selectedTimelineLayerRevealUntilRef.current) return;

    const currentIframe = getCurrentPreviewIframe(previewIframeRef.current, previewIframe);
    const doc = currentIframe?.contentDocument;
    if (!doc) return;

    const element = findElementForSelection(doc, domEditSelection, domEditSelection.sourceFile);
    if (!element) return;

    revealTimelineLayerElement(element, { preferStoredTime: true });
  }, [
    domEditSelection,
    previewDocumentVersion,
    previewIframe,
    revealTimelineLayerElement,
    selectedNestedTimelineLayer,
  ]);

  const handleTimelineElementSelect = useCallback(
    (element: TimelineElement | null) => {
      if (!element) {
        selectedTimelineLayerRevealTimeRef.current = null;
        selectedTimelineLayerRevealUntilRef.current = 0;
        setInspectedTimelineElementId(null);
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const elementKey = getTimelineElementKey(element);
      if (!elementKey || inspectedTimelineElementId !== elementKey) {
        selectedTimelineLayerRevealTimeRef.current = null;
        selectedTimelineLayerRevealUntilRef.current = 0;
        setInspectedTimelineElementId(null);
        applyDomSelection(null, { revealPanel: false, preserveTimelineSelection: true });
      }
    },
    [applyDomSelection, inspectedTimelineElementId],
  );

  const handleTimelineLayerSelect = useCallback(
    (layer: DomEditLayerItem) => {
      const initialSelection =
        resolveDomEditSelection(layer.element, {
          activeCompositionPath: layerInspectionCompositionPath,
          isMasterView: false,
          preferClipAncestor: false,
        }) ?? buildDomSelectionFromTarget(layer.element);
      if (!initialSelection) {
        showToast("Could not select that nested layer in the preview.", "info");
        return;
      }
      if (inspectedTimelineElementId) {
        setSelectedTimelineElementId(inspectedTimelineElementId);
      }
      revealTimelineLayerElement(layer.element);
      const selection =
        resolveDomEditSelection(layer.element, {
          activeCompositionPath: layerInspectionCompositionPath,
          isMasterView: false,
          preferClipAncestor: false,
        }) ??
        buildDomSelectionFromTarget(layer.element) ??
        initialSelection;
      applyDomSelection(selection, { preserveTimelineSelection: true });
    },
    [
      applyDomSelection,
      buildDomSelectionFromTarget,
      inspectedTimelineElementId,
      layerInspectionCompositionPath,
      revealTimelineLayerElement,
      setSelectedTimelineElementId,
      showToast,
    ],
  );

  const handleTimelineLayerPanelClose = useCallback(() => {
    selectedTimelineLayerRevealTimeRef.current = null;
    selectedTimelineLayerRevealUntilRef.current = 0;
    setInspectedTimelineElementId(null);
    applyDomSelection(null, { revealPanel: false, preserveTimelineSelection: true });
  }, [applyDomSelection]);

  const handleTimelineElementInspect = useCallback(
    (element: TimelineElement) => {
      const elementKey = getTimelineElementKey(element);
      if (!elementKey) return;

      if (!canInspectTimelineElement(element)) {
        selectedTimelineLayerRevealTimeRef.current = null;
        selectedTimelineLayerRevealUntilRef.current = 0;
        setInspectedTimelineElementId(null);
        applyDomSelection(null, { revealPanel: false, preserveTimelineSelection: true });
        showToast(
          "Audio clips use timeline timing controls, not the visual design inspector.",
          "info",
        );
        return;
      }

      if (inspectedTimelineElementId === elementKey) {
        selectedTimelineLayerRevealTimeRef.current = null;
        selectedTimelineLayerRevealUntilRef.current = 0;
        setInspectedTimelineElementId(null);
        applyDomSelection(null, { revealPanel: false, preserveTimelineSelection: true });
        return;
      }

      const selection = buildDomSelectionForTimelineElement(element);
      if (!selection) {
        showToast("Could not find that clip in the preview.", "info");
        return;
      }

      setSelectedTimelineElementId(elementKey);
      setInspectedTimelineElementId(elementKey);
      applyDomSelection(selection);

      const targetTime = Math.max(0, element.start);
      const currentIframe = getCurrentPreviewIframe(previewIframeRef.current, previewIframe);
      const player = getPreviewPlayer(currentIframe?.contentWindow);
      if (player) {
        player.renderSeek(targetTime);
      }
      liveTime.notify(targetTime);
      usePlayerStore.getState().setCurrentTime(targetTime);
    },
    [
      applyDomSelection,
      buildDomSelectionForTimelineElement,
      inspectedTimelineElementId,
      previewIframe,
      setSelectedTimelineElementId,
      showToast,
    ],
  );

  const preloadAgentPromptSnippet = useCallback(
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) return;

        const data = (await response.json()) as { content?: string };
        const html = data.content;
        const tagSnippet =
          typeof html === "string" ? readTagSnippetByTarget(html, selection) : undefined;

        setAgentPromptTagSnippet((current) => {
          if (domEditSelectionRef.current !== selection) return current;
          return tagSnippet;
        });
      } catch {
        // Runtime outerHTML is still available as a synchronous copy fallback.
      }
    },
    [activeCompPath],
  );

  const resolveImportedFontAsset = useCallback(
    (fontFamilyValue: string): ImportedFontAsset | null => {
      const family = primaryFontFamilyValue(fontFamilyValue);
      if (!family) return null;
      const imported = importedFontAssetsRef.current.find(
        (font) => font.family.toLowerCase() === family.toLowerCase(),
      );
      if (imported) return imported;
      const asset = fileTree.find(
        (path) =>
          FONT_EXT.test(path) &&
          fontFamilyFromAssetPath(path).toLowerCase() === family.toLowerCase(),
      );
      if (!asset) return null;
      return {
        family: fontFamilyFromAssetPath(asset),
        path: asset,
        url: `/api/projects/${projectId}/preview/${asset}`,
      };
    },
    [fileTree, projectId],
  );

  const persistDomEditOperations = useCallback(
    async (
      selection: DomEditSelection,
      operations: Parameters<typeof applyPatchByTarget>[2][],
      options?: {
        label?: string;
        kind?: "manual" | "timeline" | "source" | "motion";
        coalesceKey?: string;
        skipRefresh?: boolean;
        prepareContent?: (html: string, sourceFile: string) => string;
        shouldSave?: () => boolean;
      },
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      let patchedContent = originalContent;
      for (const operation of operations) {
        patchedContent = applyPatchByTarget(patchedContent, selection, operation);
      }
      if (options?.prepareContent) {
        patchedContent = options.prepareContent(patchedContent, targetPath);
      }
      if (options?.shouldSave && !options.shouldSave()) return;

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch ${selection.selector ?? selection.id ?? "selection"}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: options?.label ?? "Edit layer",
        kind: options?.kind ?? "manual",
        coalesceKey: options?.coalesceKey,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      if (options?.skipRefresh) {
        domEditSaveTimestampRef.current = Date.now();
      } else {
        setRefreshKey((k) => k + 1);
      }
    },
    [activeCompPath, editHistory.recordEdit, writeProjectFile],
  );

  const handleDomMoveCommit = useCallback(
    async (selection: DomEditSelection, next: { left: number; top: number }) => {
      await persistDomEditOperations(
        selection,
        [
          ...buildDomEditMovePatchOperations(next.left, next.top),
          ...buildOppositeEdgePatchOperations(selection, "both"),
        ],
        {
          skipRefresh: true,
          label: "Move layer",
          coalesceKey: getDomEditCoalesceKey(selection, "move"),
        },
      );
    },
    [persistDomEditOperations],
  );

  const handleDomResizeCommit = useCallback(
    async (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (shouldDetachOppositeEdges(selection)) {
        selection.element.style.right = "auto";
        selection.element.style.bottom = "auto";
      }
      await persistDomEditOperations(
        selection,
        [
          ...buildDomEditResizePatchOperations(next.width, next.height),
          ...buildOppositeEdgePatchOperations(selection, "both"),
        ],
        {
          skipRefresh: true,
          label: "Resize layer",
          coalesceKey: getDomEditCoalesceKey(selection, "resize"),
        },
      );
    },
    [persistDomEditOperations],
  );

  const handleDomDetachFromLayout = useCallback(async () => {
    const selection = domEditSelection;
    if (!selection?.capabilities.canDetachFromLayout) return;

    const doc = previewIframeRef.current?.contentDocument;
    const element = doc
      ? findElementForSelection(doc, selection, selection.sourceFile)
      : selection.element;
    if (!element) {
      showToast("Could not find the selected layer in the preview.", "info");
      return;
    }

    const rect = measureDomDetachRect(element);
    const operations = buildDomEditDetachPatchOperations(rect);

    for (const operation of operations) {
      element.style.setProperty(operation.property, operation.value);
    }

    await persistDomEditOperations(selection, operations, {
      skipRefresh: true,
      label: "Make layer movable",
    });

    const refreshed = doc ? findElementForSelection(doc, selection, selection.sourceFile) : element;
    if (refreshed) {
      const nextSelection = buildDomSelectionFromTarget(refreshed);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false });
      }
    }
    showToast("Layer detached from layout. You can move it now.", "info");
  }, [
    applyDomSelection,
    buildDomSelectionFromTarget,
    domEditSelection,
    persistDomEditOperations,
    showToast,
  ]);

  const handleDomStyleCommit = useCallback(
    async (property: string, value: string) => {
      if (!domEditSelection) return;
      const isMoveStyle = isMoveStyleProperty(property);
      const isResizeStyle = isResizeStyleProperty(property);
      if (isMoveStyle && !domEditSelection.capabilities.canMove) return;
      if (isResizeStyle && !domEditSelection.capabilities.canResize) return;
      if (!isMoveStyle && !isResizeStyle && !domEditSelection.capabilities.canEditStyles) return;
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let liveElement: HTMLElement | null = null;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, domEditSelection.sourceFile);
        if (el) {
          liveElement = el;
          el.style.setProperty(property, normalizeDomEditStyleValue(property, value));
          if (property === "font-family") {
            injectPreviewGoogleFont(doc, value);
            if (importedFont) injectPreviewImportedFont(doc, importedFont);
          }
          if (shouldDetachOppositeEdges(domEditSelection)) {
            if (property === "width") el.style.right = "auto";
            if (property === "height") el.style.bottom = "auto";
          }
          if (property === "background-image" && isImageBackgroundValue(value)) {
            el.style.setProperty("background-position", "center");
            el.style.setProperty("background-repeat", "no-repeat");
            el.style.setProperty("background-size", "contain");
          }
        }
      }
      const operations: PatchOperation[] = [
        buildDomEditStylePatchOperation(property, normalizeDomEditStyleValue(property, value)),
      ];
      if (property === "width") {
        operations.push(...buildOppositeEdgePatchOperations(domEditSelection, "width"));
      } else if (property === "height") {
        operations.push(...buildOppositeEdgePatchOperations(domEditSelection, "height"));
      } else if (property === "background-image" && isImageBackgroundValue(value)) {
        operations.push(
          buildDomEditStylePatchOperation("background-position", "center"),
          buildDomEditStylePatchOperation("background-repeat", "no-repeat"),
          buildDomEditStylePatchOperation("background-size", "contain"),
        );
      }
      await persistDomEditOperations(domEditSelection, operations, {
        label: "Edit layer style",
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      });
      if (doc && liveElement) {
        const refreshed = findElementForSelection(
          doc,
          domEditSelection,
          domEditSelection.sourceFile,
        );
        if (refreshed) {
          const nextSelection = buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false });
          }
          revealTimelineLayerElement(refreshed, { preferStoredTime: true, settle: true });
        }
      }
    },
    [
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
      resolveImportedFontAsset,
      revealTimelineLayerElement,
    ],
  );

  const handleDomMotionCommit = useCallback(
    async (motion: MotionDraft | null) => {
      if (!domEditSelection) return;
      if (!domEditSelection.capabilities.canEditStyles) return;

      const nextMotion = motion
        ? clampMotionDraftToTimeline(motion, selectedMotionMaxDuration)
        : null;
      const motionVarsId = buildMotionVarsId(
        domEditSelection.id || domEditSelection.selector || domEditSelection.label,
      );
      const operations = buildDomEditMotionPatchOperations(nextMotion, motionVarsId);
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      let refreshedElement: HTMLElement | null = null;

      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, domEditSelection.sourceFile);
        if (el) {
          for (const operation of operations) {
            const attr = operation.property.startsWith("data-")
              ? operation.property
              : `data-${operation.property}`;
            if (operation.value == null) {
              el.removeAttribute(attr);
            } else {
              el.setAttribute(attr, operation.value);
            }
          }
          refreshedElement = el;
          const player = getPreviewPlayer(iframe.contentWindow);
          if (player) {
            player.renderSeek(player.getTime());
          }
        }
      }

      await persistDomEditOperations(domEditSelection, operations, {
        label: nextMotion ? "Edit layer motion" : "Clear layer motion",
        kind: "motion",
        coalesceKey: getDomEditCoalesceKey(domEditSelection, "motion"),
        skipRefresh: true,
      });

      if (refreshedElement) {
        const nextSelection = buildDomSelectionFromTarget(refreshedElement);
        if (nextSelection) {
          applyDomSelection(nextSelection, { revealPanel: false });
        }
      }
    },
    [
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
      selectedMotionMaxDuration,
    ],
  );

  const handleDomTextCommit = useCallback(
    async (value: string, fieldKey?: string) => {
      if (!domEditSelection) return;
      if (!isTextEditableSelection(domEditSelection)) return;
      const commitVersion = domTextCommitVersionRef.current + 1;
      domTextCommitVersionRef.current = commitVersion;
      const nextTextFields =
        domEditSelection.textFields.length > 0
          ? domEditSelection.textFields.map((field) =>
              field.key === fieldKey ? { ...field, value } : field,
            )
          : [];
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : value;
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, domEditSelection, domEditSelection.sourceFile);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = value;
          }
        }
      }
      await persistDomEditOperations(
        domEditSelection,
        [buildDomEditTextPatchOperation(nextContent)],
        {
          label: "Edit text",
          skipRefresh: true,
          shouldSave: () => domTextCommitVersionRef.current === commitVersion,
        },
      );
      if (domTextCommitVersionRef.current !== commitVersion) return;

      if (doc) {
        const refreshed = findElementForSelection(
          doc,
          domEditSelection,
          domEditSelection.sourceFile,
        );
        if (refreshed) {
          const nextSelection = buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false });
          }
          revealTimelineLayerElement(refreshed, { preferStoredTime: true, settle: true });
        }
      }
    },
    [
      applyDomSelection,
      buildDomSelectionFromTarget,
      domEditSelection,
      persistDomEditOperations,
      revealTimelineLayerElement,
    ],
  );

  const commitDomTextFields = useCallback(
    async (
      selection: DomEditSelection,
      nextTextFields: DomEditTextField[],
      options?: { importedFont?: ImportedFontAsset | null },
    ) => {
      const nextContent =
        nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child")
          ? serializeDomEditTextFields(nextTextFields)
          : (nextTextFields[0]?.value ?? "");

      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      if (doc) {
        const el = findElementForSelection(doc, selection, selection.sourceFile);
        if (el) {
          if (
            nextTextFields.length > 1 ||
            nextTextFields.some((field) => field.source === "child")
          ) {
            el.innerHTML = nextContent;
          } else {
            el.textContent = nextContent;
          }
        }
      }

      const importedFont = options?.importedFont ?? null;
      await persistDomEditOperations(selection, [buildDomEditTextPatchOperation(nextContent)], {
        label: "Edit text",
        skipRefresh: true,
        prepareContent: importedFont
          ? (html, sourceFile) => ensureImportedFontFace(html, importedFont, sourceFile)
          : undefined,
      });

      if (doc) {
        const refreshed = findElementForSelection(doc, selection, selection.sourceFile);
        if (refreshed) {
          const nextSelection = buildDomSelectionFromTarget(refreshed);
          if (nextSelection) {
            applyDomSelection(nextSelection, { revealPanel: false });
          }
          revealTimelineLayerElement(refreshed, { preferStoredTime: true, settle: true });
        }
      }
    },
    [
      applyDomSelection,
      buildDomSelectionFromTarget,
      persistDomEditOperations,
      revealTimelineLayerElement,
    ],
  );

  const handleDomTextFieldStyleCommit = useCallback(
    async (fieldKey: string, property: string, value: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomStyleCommit(property, value);
        return;
      }

      const normalizedValue = normalizeDomEditStyleValue(property, value);
      const importedFont = property === "font-family" ? resolveImportedFontAsset(value) : null;
      if (property === "font-family") {
        const doc = previewIframeRef.current?.contentDocument;
        if (doc) {
          injectPreviewGoogleFont(doc, normalizedValue);
          if (importedFont) injectPreviewImportedFont(doc, importedFont);
        }
      }
      const nextTextFields = domEditSelection.textFields.map((entry) =>
        entry.key === fieldKey
          ? {
              ...entry,
              inlineStyles: {
                ...entry.inlineStyles,
                [property]: normalizedValue,
              },
              computedStyles: {
                ...entry.computedStyles,
                [property]: normalizedValue,
              },
            }
          : entry,
      );

      await commitDomTextFields(domEditSelection, nextTextFields, { importedFont });
    },
    [commitDomTextFields, domEditSelection, handleDomStyleCommit, resolveImportedFontAsset],
  );

  const handleDomAddTextField = useCallback(
    async (afterFieldKey?: string) => {
      if (!domEditSelection) return null;
      if (!domEditSelection.textFields.some((field) => field.source === "child")) return null;

      const insertionIndex = domEditSelection.textFields.findIndex(
        (field) => field.key === afterFieldKey,
      );
      const baseField =
        domEditSelection.textFields[insertionIndex >= 0 ? insertionIndex : 0] ??
        domEditSelection.textFields[0];
      const nextField = buildDefaultDomEditTextField(baseField);
      const nextTextFields = [...domEditSelection.textFields];
      nextTextFields.splice(
        insertionIndex >= 0 ? insertionIndex + 1 : nextTextFields.length,
        0,
        nextField,
      );

      await commitDomTextFields(domEditSelection, nextTextFields);
      return nextField.key;
    },
    [commitDomTextFields, domEditSelection],
  );

  const handleDomRemoveTextField = useCallback(
    async (fieldKey: string) => {
      if (!domEditSelection) return;
      const field = domEditSelection.textFields.find((entry) => entry.key === fieldKey);
      if (!field) return;

      if (field.source === "self") {
        await handleDomTextCommit("", fieldKey);
        return;
      }

      const nextTextFields = domEditSelection.textFields.filter((entry) => entry.key !== fieldKey);
      await commitDomTextFields(domEditSelection, nextTextFields);
    },
    [commitDomTextFields, domEditSelection, handleDomTextCommit],
  );

  const handleAskAgent = useCallback(() => {
    if (!domEditSelection) return;
    setAgentPromptTagSnippet(undefined);
    void preloadAgentPromptSnippet(domEditSelection);
    setAgentModalOpen(true);
  }, [domEditSelection, preloadAgentPromptSnippet]);

  const handleAgentModalSubmit = useCallback(
    async (userInstruction: string) => {
      if (!domEditSelection) return;

      const targetPath = domEditSelection.sourceFile || activeCompPath || "index.html";
      const tagSnippet = agentPromptTagSnippet ?? domEditSelection.element.outerHTML;
      const hfMotionAttribute = domEditSelection.dataAttributes["hf-motion"];
      const motionOwnership = detectMotionOwnership({
        element: domEditSelection.element,
        dataAttributes: domEditSelection.dataAttributes,
        computedStyles: domEditSelection.computedStyles,
      });
      const parsedMotionDraft = parseMotionDraft(hfMotionAttribute);
      const motionContext =
        hfMotionAttribute || motionOwnership.badges.length > 0
          ? buildMotionAgentContext({
              hfMotionAttribute,
              draft: parsedMotionDraft
                ? clampMotionDraftToTimeline(parsedMotionDraft, selectedMotionMaxDuration)
                : null,
              ownership: motionOwnership,
            })
          : undefined;
      const prompt = buildElementAgentPrompt({
        selection: domEditSelection,
        currentTime,
        tagSnippet,
        userInstruction,
        sourceFilePath: toProjectAbsolutePath(projectDir, targetPath),
        motionContext,
      });

      const copied = await copyTextToClipboard(prompt);
      if (!copied) {
        showToast("Could not copy prompt to clipboard.", "error");
        return;
      }

      setAgentModalOpen(false);
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
      setCopiedAgentPrompt(true);
      copiedAgentTimerRef.current = setTimeout(() => setCopiedAgentPrompt(false), 1600);
    },
    [
      activeCompPath,
      agentPromptTagSnippet,
      currentTime,
      domEditSelection,
      projectDir,
      selectedMotionMaxDuration,
      showToast,
    ],
  );

  const handleCopyElementLocator = useCallback(async () => {
    if (!domEditSelection) return;

    const pid = projectIdRef.current;
    const targetPath = domEditSelection.sourceFile || activeCompPath || "index.html";
    const absolutePath = toProjectAbsolutePath(projectDir, targetPath) ?? targetPath;
    let sourceLocation: NonNullable<ReturnType<typeof findSourceLocationByTarget>> | null = null;

    if (pid) {
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (response.ok) {
          const data = (await response.json()) as { content?: string };
          if (typeof data.content === "string") {
            sourceLocation = findSourceLocationByTarget(data.content, domEditSelection);
          }
        }
      } catch {
        // The absolute file path and DOM selector still make a useful locator.
      }
    }

    const locator = formatElementLocatorClipboardText({
      selection: domEditSelection,
      absolutePath,
      sourceLocation,
      currentTime,
    });
    const copied = await copyTextToClipboard(locator);
    if (!copied) {
      showToast("Could not copy element location to clipboard.", "error");
      return;
    }

    if (copiedElementLocatorTimerRef.current) {
      clearTimeout(copiedElementLocatorTimerRef.current);
    }
    setCopiedElementLocator(true);
    copiedElementLocatorTimerRef.current = setTimeout(() => setCopiedElementLocator(false), 1600);
    showToast("Copied element location.", "info");
  }, [activeCompPath, currentTime, domEditSelection, projectDir, showToast]);

  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      setPreviewIframe(iframe);
      refreshPreviewDocumentVersion();
      syncPreviewTimelineHotkey(iframe);
      consoleErrorsRef.current = [];
      setConsoleErrors(null);
    },
    [refreshPreviewDocumentVersion, syncPreviewTimelineHotkey],
  );

  const handlePreviewCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, _options?: { preferClipAncestor?: boolean }) => {
      if (captionEditMode) return;
      if (inspectedTimelineElementId) {
        e.preventDefault();
        e.stopPropagation();
      }
      lastPreviewClickRef.current = null;
    },
    [captionEditMode, inspectedTimelineElementId],
  );

  const handlePreviewCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (captionEditMode) return;
      if (inspectedTimelineElementId) {
        e.preventDefault();
        e.stopPropagation();
      }
      lastPreviewClickRef.current = null;
    },
    [captionEditMode, inspectedTimelineElementId],
  );

  const handleSelectedOverlayDoubleClick = useCallback(() => {
    const selection = domEditSelectionRef.current;
    if (!selection?.isCompositionHost || !selection.compositionSrc) return;
    applyDomSelection(null, { revealPanel: false });
    setActiveCompPath(selection.compositionSrc);
  }, [applyDomSelection]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe || captionEditMode) return;

    const syncSelectionFromDocument = () => {
      const currentSelection = domEditSelectionRef.current;
      if (!currentSelection) return;
      let doc: Document | null = null;
      try {
        doc = previewIframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const syncCompositionPath = inspectedTimelineElementId
        ? layerInspectionCompositionPath
        : activeCompPath;
      const nextElement = findElementForSelection(doc, currentSelection, syncCompositionPath);
      if (!nextElement) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const nextSelection = inspectedTimelineElementId
        ? (resolveDomEditSelection(nextElement, {
            activeCompositionPath: layerInspectionCompositionPath,
            isMasterView: false,
            preferClipAncestor: false,
          }) ?? buildDomSelectionFromTarget(nextElement))
        : buildDomSelectionFromTarget(nextElement);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false });
      }
    };

    const attachErrorCapture = () => {
      try {
        const win = previewIframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
        (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
        const origError = win.console.error.bind(win.console);
        win.console.error = function (...args: unknown[]) {
          origError(...args);
          const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
          if (text.includes("favicon")) return;
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        };
        win.addEventListener("error", (e: ErrorEvent) => {
          const text = e.message || String(e);
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        });
      } catch {
        // same-origin only
      }
    };

    attachErrorCapture();
    syncSelectionFromDocument();

    const handleLoad = () => {
      consoleErrorsRef.current = [];
      setConsoleErrors(null);
      refreshPreviewDocumentVersion();
      attachErrorCapture();
      syncSelectionFromDocument();
    };

    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
    };
  }, [
    activeCompPath,
    applyDomSelection,
    buildDomSelectionFromTarget,
    captionEditMode,
    inspectedTimelineElementId,
    layerInspectionCompositionPath,
    previewIframe,
    refreshPreviewDocumentVersion,
  ]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!captionEditMode) return;
    applyDomSelection(null, { revealPanel: false });
  }, [applyDomSelection, captionEditMode]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(
    () => () => {
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
      if (copiedElementLocatorTimerRef.current) {
        clearTimeout(copiedElementLocatorTimerRef.current);
      }
    },
    [],
  );

  const refreshFileTree = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const res = await fetch(`/api/projects/${pid}`);
    const data = await res.json();
    if (data.files) setFileTree(data.files);
  }, []);

  const uploadProjectFiles = useCallback(
    async (files: Iterable<File>, dir?: string): Promise<string[]> => {
      const pid = projectIdRef.current;
      const fileList = Array.from(files);
      if (!pid || fileList.length === 0) return [];

      const formData = new FormData();
      for (const file of fileList) {
        formData.append("file", file);
      }

      const qs = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      try {
        const res = await fetch(`/api/projects/${pid}/upload${qs}`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.skipped?.length) {
            showToast(`Skipped (too large): ${data.skipped.join(", ")}`);
          }
          if (data.invalid?.length) {
            const names = data.invalid.map((entry: { name: string }) => entry.name).join(", ");
            showToast(`Unsupported media skipped: ${names}`);
          }
          await refreshFileTree();
          setRefreshKey((k) => k + 1);
          return Array.isArray(data.files) ? data.files : [];
        } else if (res.status === 413) {
          showToast("Upload rejected: payload too large");
        } else {
          showToast(`Upload failed (${res.status})`);
        }
      } catch {
        showToast("Upload failed: network error");
      }
      return [];
    },
    [refreshFileTree, showToast],
  );

  const handleTimelineAssetDrop = useCallback(
    async (
      assetPath: string,
      placement: Pick<TimelineElement, "start" | "track">,
      durationOverride?: number,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be dropped onto the timeline.");
        return;
      }

      const targetPath = activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to read ${targetPath}`);
        }

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string") {
          throw new Error(`Missing file contents for ${targetPath}`);
        }

        const normalizedStart = Number(formatTimelineAttributeNumber(placement.start));
        const duration =
          Number.isFinite(durationOverride) && durationOverride != null && durationOverride > 0
            ? durationOverride
            : await resolveDroppedAssetDuration(pid, assetPath, kind);
        const normalizedDuration = Number(formatTimelineAttributeNumber(duration));
        const newId = buildTimelineAssetId(assetPath, collectHtmlIds(originalContent));
        const resolvedAssetSrc = resolveTimelineAssetSrc(targetPath, assetPath);

        const resolvedTargetPath = targetPath || "index.html";
        const relevantElements = timelineElements.filter(
          (timelineElement) =>
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
        const trackZIndices = buildTrackZIndexMap([
          ...relevantElements.map((timelineElement) => timelineElement.track),
          placement.track,
        ]);

        let patchedContent = originalContent;
        for (const timelineElement of relevantElements) {
          const elementTarget = timelineElement.domId
            ? {
                id: timelineElement.domId,
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : timelineElement.selector
              ? {
                  selector: timelineElement.selector,
                  selectorIndex: timelineElement.selectorIndex,
                }
              : null;
          if (!elementTarget) continue;
          const nextZIndex = trackZIndices.get(timelineElement.track);
          if (nextZIndex == null) continue;
          patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
            type: "inline-style",
            property: "z-index",
            value: String(nextZIndex),
          });
        }

        patchedContent = insertTimelineAssetIntoSource(
          patchedContent,
          buildTimelineAssetInsertHtml({
            id: newId,
            assetPath: resolvedAssetSrc,
            kind,
            start: normalizedStart,
            duration: normalizedDuration,
            track: placement.track,
            zIndex: trackZIndices.get(placement.track) ?? 1,
            geometry: resolveTimelineAssetInitialGeometry(originalContent),
          }),
        );

        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Add timeline asset",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        setRefreshKey((k) => k + 1);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to drop asset onto timeline";
        showToast(message);
      }
    },
    [activeCompPath, editHistory.recordEdit, showToast, timelineElements, writeProjectFile],
  );

  const handleTimelineFileDrop = useCallback(
    async (files: File[], placement?: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const uploaded = await uploadProjectFiles(files);
      if (uploaded.length === 0) return;
      const durations: number[] = [];
      for (const assetPath of uploaded) {
        const kind = getTimelineAssetKind(assetPath);
        const duration = kind ? await resolveDroppedAssetDuration(pid, assetPath, kind) : 0;
        durations.push(Number(formatTimelineAttributeNumber(duration)));
      }
      const placements = buildTimelineFileDropPlacements(
        placement ?? { start: 0, track: 0 },
        durations,
        timelineElements
          .filter(
            (timelineElement) =>
              (timelineElement.sourceFile || activeCompPath || "index.html") ===
              (activeCompPath || "index.html"),
          )
          .map((timelineElement) => ({
            start: timelineElement.start,
            duration: timelineElement.duration,
            track: timelineElement.track,
          })),
      );
      for (const [index, assetPath] of uploaded.entries()) {
        await handleTimelineAssetDrop(
          assetPath,
          placements[index] ?? placements[0],
          durations[index],
        );
      }
    },
    [activeCompPath, handleTimelineAssetDrop, timelineElements, uploadProjectFiles],
  );

  // ── File Management Handlers ──

  const handleCreateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      let content = "";
      if (path.endsWith(".html")) {
        content =
          '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body>\n\n</body>\n</html>\n';
      }
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (res.ok) {
        await refreshFileTree();
        handleFileSelect(path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create file failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleCreateFolder = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      // Create a .gitkeep inside the folder so it appears in the tree
      const res = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(path + "/.gitkeep")}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "",
        },
      );
      if (res.ok) {
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create folder failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingPathRef.current === path) setEditingFile(null);
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Delete failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(oldPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (res.ok) {
        if (editingPathRef.current === oldPath) {
          handleFileSelect(newPath);
        }
        await refreshFileTree();
        // Refresh preview — references in compositions may have been updated
        setRefreshKey((k) => k + 1);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Rename failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/duplicate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = await res.json();
        await refreshFileTree();
        if (data.path) handleFileSelect(data.path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Duplicate failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleMoveFile = handleRenameFile;

  const handleImportFiles = useCallback(
    async (files: FileList | File[], dir?: string) => {
      return uploadProjectFiles(Array.from(files), dir);
    },
    [uploadProjectFiles],
  );

  const handleImportFonts = useCallback(
    async (files: FileList | File[]) => {
      const uploaded = await uploadProjectFiles(
        Array.from(files).filter((file) => FONT_EXT.test(file.name)),
        "assets/fonts",
      );
      const pid = projectIdRef.current;
      const imported = uploaded
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${pid}/preview/${asset}`,
        }));
      importedFontAssetsRef.current = [
        ...imported,
        ...importedFontAssetsRef.current.filter(
          (existing) =>
            !imported.some((font) => font.family.toLowerCase() === existing.family.toLowerCase()),
        ),
      ];
      return imported;
    },
    [uploadProjectFiles],
  );

  const handleLint = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setLinting(true);
    try {
      const res = await fetch(`/api/projects/${pid}/lint`);
      const data = await res.json();
      const findings: LintFinding[] = (data.findings ?? []).map(
        (f: { severity?: string; message?: string; file?: string; fixHint?: string }) => ({
          severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
          message: f.message ?? "",
          file: f.file,
          fixHint: f.fixHint,
        }),
      );
      setLintModal(findings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, []);

  // Panel resize via pointer events (works for both left sidebar and right panel)
  const handlePanelResizeStart = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panelDragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const maxLeft = Math.floor(window.innerWidth * 0.5);
    const newW = Math.max(
      160,
      Math.min(
        drag.side === "left" ? maxLeft : 600,
        drag.startW + (drag.side === "left" ? delta : -delta),
      ),
    );
    if (drag.side === "left") setLeftWidth(newW);
    else setRightWidth(newW);
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    panelDragRef.current = null;
  }, []);

  const compositions = useMemo(
    () => fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/")),
    [fileTree],
  );
  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );
  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      assets
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: `/api/projects/${projectId}/preview/${asset}`,
        })),
    [assets, projectId],
  );

  if (resolving || !projectId) {
    return (
      <div className="h-full w-full bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-studio-accent animate-pulse" />
      </div>
    );
  }

  // At this point projectId is guaranteed non-null (narrowed by the guard above)

  return (
    <div
      className="flex flex-col h-full w-full bg-neutral-950 relative"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current++;
        setGlobalDragOver(true);
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setGlobalDragOver(false);
      }}
      onDrop={(e) => {
        dragCounterRef.current = 0;
        setGlobalDragOver(false);
        // Skip if a child (e.g. AssetsTab) already handled the drop
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (e.dataTransfer.files.length) handleImportFiles(e.dataTransfer.files);
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between h-10 px-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        {/* Left: project name */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-neutral-400">{projectId}</span>
        </div>
        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={!editHistory.canUndo}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              editHistory.canUndo
                ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                : "border-neutral-900 text-neutral-700"
            }`}
            title={
              editHistory.undoLabel
                ? `Undo ${editHistory.undoLabel} (${getHistoryShortcutLabel("undo")})`
                : `Undo (${getHistoryShortcutLabel("undo")})`
            }
            aria-label="Undo"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={() => void handleRedo()}
            disabled={!editHistory.canRedo}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              editHistory.canRedo
                ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                : "border-neutral-900 text-neutral-700"
            }`}
            title={
              editHistory.redoLabel
                ? `Redo ${editHistory.redoLabel} (${getHistoryShortcutLabel("redo")})`
                : `Redo (${getHistoryShortcutLabel("redo")})`
            }
            aria-label="Redo"
          >
            <RotateCw size={14} />
          </button>
          <a
            href={captureFrameHref}
            download={captureFrameFilename}
            onClick={handleCaptureFrameClick}
            onFocus={refreshCaptureFrameTime}
            onPointerDown={refreshCaptureFrameTime}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-neutral-700 text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
            title="Capture current frame"
            aria-label="Capture current frame"
          >
            <Camera size={14} />
            <span>Capture</span>
          </a>
          <button
            onClick={() => {
              if (rightCollapsed || rightPanelTab !== "design") {
                setRightPanelTab("design");
                setRightCollapsed(false);
                return;
              }
              clearDomSelection();
              setRightCollapsed(true);
            }}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
              !rightCollapsed
                ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-transparent"
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
            </svg>
            Inspector
          </button>
        </div>
      </div>

      {/* Main content: sidebar + preview + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Compositions + Assets (resizable, collapsible) */}
        {leftCollapsed ? (
          <div className="flex w-10 flex-shrink-0 flex-col items-center border-r border-neutral-800/50 bg-neutral-950 pt-1">
            <button
              type="button"
              onClick={toggleLeftSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-300"
              title="Show sidebar"
              aria-label="Show sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 4v16" />
                <path d="m10 7 5 5-5 5" />
              </svg>
            </button>
          </div>
        ) : (
          <LeftSidebar
            width={leftWidth}
            projectId={projectId}
            compositions={compositions}
            assets={assets}
            activeComposition={activeCompPath ?? editingFile?.path ?? null}
            onSelectComposition={handleCompositionSelect}
            resolveCompositionSourceContent={readProjectFile}
            fileTree={fileTree}
            editingFile={editingFile}
            onSelectFile={handleFileSelect}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
            onDuplicateFile={handleDuplicateFile}
            onMoveFile={handleMoveFile}
            onImportFiles={handleImportFiles}
            codeChildren={
              editingFile ? (
                isMediaFile(editingFile.path) ? (
                  <MediaPreview projectId={projectId ?? ""} filePath={editingFile.path} />
                ) : (
                  <SourceEditor
                    content={editingFile.content ?? ""}
                    filePath={editingFile.path}
                    onChange={handleContentChange}
                  />
                )
              ) : undefined
            }
            onLint={handleLint}
            linting={linting}
            onToggleCollapse={toggleLeftSidebar}
          />
        )}

        {/* Left resize handle */}
        {!leftCollapsed && (
          <div
            className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handlePanelResizeStart("left", e)}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
          >
            <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
          </div>
        )}

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            timelineToolbar={timelineToolbar}
            onDeleteElement={handleTimelineElementDelete}
            onAssetDrop={handleTimelineAssetDrop}
            onFileDrop={handleTimelineFileDrop}
            onMoveElement={handleTimelineElementMove}
            onResizeElement={handleTimelineElementResize}
            onBlockedEditAttempt={handleBlockedTimelineEdit}
            onSelectTimelineElement={handleTimelineElementSelect}
            onInspectTimelineElement={handleTimelineElementInspect}
            inspectedTimelineElementId={inspectedTimelineElementId}
            timelineLayerChildCounts={timelineLayerChildCounts}
            thumbnailedTimelineElementIds={thumbnailedTimelineElementIds}
            onToggleTimelineElementThumbnail={handleTimelineElementThumbnailToggle}
            onCompIdToSrcChange={setCompIdToSrc}
            renderClipContent={renderTimelineClipContent}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              setActiveCompPath(compPath);
            }}
            onIframeRef={handlePreviewIframeRef}
            previewOverlay={
              captionEditMode ? (
                <CaptionOverlay iframeRef={previewIframeRef} />
              ) : (
                <>
                  <DomEditOverlay
                    iframeRef={previewIframeRef}
                    selection={showDomEditSelectionOverlay ? domEditSelection : null}
                    onCanvasMouseDown={handlePreviewCanvasMouseDown}
                    onCanvasDoubleClick={handlePreviewCanvasDoubleClick}
                    onSelectedDoubleClick={handleSelectedOverlayDoubleClick}
                    onBlockedMove={handleBlockedDomMove}
                    onMoveCommit={handleDomMoveCommit}
                    onResizeCommit={handleDomResizeCommit}
                  />
                  {inspectedTimelineElement && inspectedTimelineLayers.length > 0 && (
                    <TimelineLayerPanel
                      clipLabel={
                        inspectedTimelineElement.label ||
                        inspectedTimelineElement.id ||
                        inspectedTimelineElement.tag
                      }
                      layers={inspectedTimelineLayers}
                      selectedLayerKey={selectedTimelineLayerKey}
                      onSelectLayer={handleTimelineLayerSelect}
                      onClose={handleTimelineLayerPanelClose}
                    />
                  )}
                </>
              )
            }
            timelineFooter={
              captionEditMode ? (
                <div
                  className="border-t border-neutral-800/30 flex-shrink-0"
                  style={{ height: 60 }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                      Captions
                    </span>
                  </div>
                  <CaptionTimeline pixelsPerSecond={100} />
                </div>
              ) : undefined
            }
            timelineVisible={timelineVisible}
            onToggleTimeline={toggleTimelineVisibility}
          />
        </div>

        {/* Right panel: Renders-only (resizable, collapsible via header Renders button) */}
        {!rightCollapsed && (
          <>
            <div
              className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => handlePanelResizeStart("right", e)}
              onPointerMove={handlePanelResizeMove}
              onPointerUp={handlePanelResizeEnd}
            >
              <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
            </div>
            <div
              className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
              style={{ width: rightWidth }}
            >
              {captionEditMode ? (
                <CaptionPropertyPanel iframeRef={previewIframeRef} />
              ) : (
                <>
                  <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-2">
                    <button
                      type="button"
                      data-right-panel-tab="design"
                      onClick={() => setRightPanelTab("design")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "design"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Design
                    </button>
                    <button
                      type="button"
                      data-right-panel-tab="renders"
                      onClick={() => setRightPanelTab("renders")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "renders"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      {renderQueue.jobs.length > 0
                        ? `Renders (${renderQueue.jobs.length})`
                        : "Renders"}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    {rightPanelTab === "renders" ? (
                      <RenderQueue
                        jobs={renderQueue.jobs}
                        projectId={projectId}
                        onDelete={renderQueue.deleteRender}
                        onClearCompleted={renderQueue.clearCompleted}
                        onStartRender={(format, quality) =>
                          renderQueue.startRender(30, quality, format)
                        }
                        isRendering={renderQueue.isRendering}
                      />
                    ) : (
                      <PropertyPanel
                        mode="design"
                        projectId={projectId}
                        assets={assets}
                        element={domEditSelection}
                        motionMaxDuration={selectedMotionMaxDuration}
                        copiedAgentPrompt={copiedAgentPrompt}
                        copiedElementLocator={copiedElementLocator}
                        onClearSelection={clearDomSelection}
                        onSetStyle={handleDomStyleCommit}
                        onSetMotion={handleDomMotionCommit}
                        onSetText={handleDomTextCommit}
                        onSetTextFieldStyle={handleDomTextFieldStyleCommit}
                        onAddTextField={handleDomAddTextField}
                        onRemoveTextField={handleDomRemoveTextField}
                        onDetachFromLayout={handleDomDetachFromLayout}
                        onAskAgent={handleAskAgent}
                        onCopyElementLocator={handleCopyElementLocator}
                        onCopyAgentInstruction={handleAgentModalSubmit}
                        onImportAssets={handleImportFiles}
                        fontAssets={fontAssets}
                        onImportFonts={handleImportFonts}
                        allowLayoutDetach={false}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lint modal */}
      {lintModal !== null && projectId && (
        <LintModal findings={lintModal} projectId={projectId} onClose={() => setLintModal(null)} />
      )}

      {/* Console errors modal — auto-shows when composition has runtime errors */}
      {consoleErrors !== null && consoleErrors.length > 0 && projectId && (
        <LintModal
          findings={consoleErrors}
          projectId={projectId}
          onClose={() => setConsoleErrors(null)}
        />
      )}

      {/* Ask agent modal */}
      {agentModalOpen && domEditSelection && (
        <AskAgentModal
          selectionLabel={domEditSelection.label}
          motionContextIncluded={selectionHasMotionAgentContext(domEditSelection)}
          onSubmit={handleAgentModalSubmit}
          onClose={() => setAgentModalOpen(false)}
        />
      )}

      {/* Global drag-drop overlay */}
      {globalDragOver && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl border-2 border-dashed border-studio-accent/60 bg-studio-accent/[0.06]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-studio-accent"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-sm font-medium text-studio-accent">
              Drop files to import into project
            </span>
          </div>
        </div>
      )}
      {appToast && (
        <div
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-[91] px-4 py-2 rounded-lg border text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${
            appToast.tone === "error"
              ? "bg-red-900/90 border-red-700/50 text-red-200"
              : "bg-neutral-900/95 border-neutral-700/60 text-neutral-100"
          }`}
        >
          {appToast.message}
        </div>
      )}
    </div>
  );
}
