/**
 * Render Orchestrator Service
 *
 * Coordinates the entire video rendering pipeline:
 * 1. Parse composition metadata
 * 2. Pre-extract video frames
 * 3. Pre-process audio tracks
 * 4. Parallel frame capture
 * 5. Video encoding
 * 6. Final assembly (audio mux + faststart)
 *
 * Heavy observability: every stage logs timing, errors include
 * full context, and failures produce a diagnostic summary.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  writeFileSync,
  copyFileSync,
  appendFileSync,
  symlinkSync,
} from "fs";
import { parseHTML } from "linkedom";
import { type CanvasResolution, type Fps, fpsToNumber, fpsToFfmpegArg } from "@hyperframes/core";
import {
  type EngineConfig,
  resolveConfig,
  extractAllVideoFrames,
  resolveProjectRelativeSrc,
  type ExtractedFrames,
  type ExtractionPhaseBreakdown,
  createFrameLookupTable,
  FrameLookupTable,
  type HdrTransfer,
  detectTransfer,
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  prepareCaptureSessionForReuse,
  type CaptureOptions,
  type CaptureVideoMetadataHint,
  type CaptureSession,
  type BeforeCaptureHook,
  createVideoFrameInjector,
  encodeFramesFromDir,
  encodeFramesChunkedConcat,
  muxVideoWithAudio,
  applyFaststart,
  getEncoderPreset,
  processCompositionAudio,
  calculateOptimalWorkers,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  type ParallelProgress,
  type WorkerTask,
  spawnStreamingEncoder,
  createFrameReorderBuffer,
  type StreamingEncoder,
  analyzeCompositionHdr,
  isHdrColorSpace,
  runFfmpeg,
  extractMediaMetadata,
  type VideoColorSpace,
  initTransparentBackground,
  captureAlphaPng,
  applyDomLayerMask,
  removeDomLayerMask,
  decodePng,
  decodePngToRgb48le,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  queryElementStacking,
  groupIntoLayers,
  blitRgb48leAffine,
  parseTransformMatrix,
  TRANSITIONS,
  crossfade,
  convertTransfer,
  resampleRgb48leObjectFit,
  normalizeObjectFit,
  type TransitionFn,
  type ElementStackingInfo,
  type HfTransitionMeta,
} from "@hyperframes/engine";
import { join, dirname, resolve, relative, isAbsolute, basename } from "path";
import { randomUUID } from "crypto";
import { freemem } from "os";
import { fileURLToPath } from "url";
import { createFileServer, type FileServerHandle, VIRTUAL_TIME_SHIM } from "./fileServer.js";
import {
  createShaderTransitionWorkerPool,
  type ShaderTransitionWorkerPool,
} from "./shaderTransitionWorkerPool.js";
import {
  createPngDecodeBlitWorkerPool,
  type PngDecodeBlitWorkerPool,
} from "./pngDecodeBlitWorkerPool.js";
import { type CompiledComposition } from "./htmlCompiler.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { isPathInside } from "../utils/paths.js";
import {
  type HdrImageTransferCache,
  createHdrImageTransferCache,
} from "./hdrImageTransferCache.js";
import { runCompileStage } from "./render/stages/compileStage.js";
import { runProbeStage } from "./render/stages/probeStage.js";

/**
 * Wrap a cleanup operation so it never throws, but logs any failure.
 */
async function safeCleanup(
  label: string,
  fn: () => Promise<void> | void,
  log: ProducerLogger = defaultLogger,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.debug(`Cleanup failed (${label})`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function sampleDirectoryBytes(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile()) {
          total += st.size;
        }
      } catch {
        // ignore
      }
    }
  }
  return total;
}

// Diagnostic helpers used by the HDR layered compositor when KEEP_TEMP=1
// is set. They are pure (capture no state), so we keep them at module scope
// to avoid re-creating closures per frame and to make them callable from
// any future composite path that needs to log non-zero pixel counts.
function countNonZeroAlpha(rgba: Uint8Array): number {
  let n = 0;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] !== 0) n++;
  }
  return n;
}

function countNonZeroRgb48(buf: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < buf.length; p += 6) {
    if (
      buf[p] !== 0 ||
      buf[p + 1] !== 0 ||
      buf[p + 2] !== 0 ||
      buf[p + 3] !== 0 ||
      buf[p + 4] !== 0 ||
      buf[p + 5] !== 0
    )
      n++;
  }
  return n;
}

/**
 * Metadata for a shader transition between two scenes, extracted from
 * `window.__hf.transitions`. Re-exported from the engine so the producer
 * shares the contract with composition runtime code.
 */
type HdrTransitionMeta = HfTransitionMeta;

/** Pre-computed frame range for an active transition. */
export interface TransitionRange extends HdrTransitionMeta {
  startFrame: number;
  endFrame: number;
}

/**
 * Build the set of frame indices that fall inside any active transition window.
 *
 * Layered SDR renders defer to the slow per-frame dual-scene compositor for
 * frames in this set; everything outside the set is eligible for the fast
 * parallel capture path. The two ranges produced by `[startFrame, endFrame]`
 * are inclusive on both ends because the layered loop's `i <= endFrame` check
 * applies the transition blend to the last frame of the window — and the same
 * frame must be excluded from the parallel non-transition path or it would be
 * captured twice (once incorrectly without the blend) and overwritten.
 *
 * Clamps both ends to `[0, totalFrames)` so out-of-range transitions (e.g.
 * trailing slop from rounding the end timestamp) don't try to allocate
 * frames past the end of the composition.
 *
 * @param transitionRanges - Pre-computed frame-aligned transition windows
 *                           (`startFrame`, `endFrame` already rounded from
 *                           `time` / `duration`).
 * @param totalFrames       - Total composition frame count; the resulting set
 *                            never contains an index ≥ totalFrames.
 * @returns A frozen-by-convention `Set<number>` of frame indices that must
 *          flow through the sequential layered path.
 */
export function partitionTransitionFrames(
  transitionRanges: ReadonlyArray<Pick<TransitionRange, "startFrame" | "endFrame">>,
  totalFrames: number,
): Set<number> {
  const frames = new Set<number>();
  if (totalFrames <= 0) return frames;
  for (const range of transitionRanges) {
    const start = Math.max(0, range.startFrame);
    const end = Math.min(totalFrames - 1, range.endFrame);
    for (let i = start; i <= end; i++) {
      frames.add(i);
    }
  }
  return frames;
}

export type RenderStatus =
  | "queued"
  | "preprocessing"
  | "rendering"
  | "encoding"
  | "assembling"
  | "complete"
  | "failed"
  | "cancelled";

export interface RenderConfig {
  /**
   * Frame rate as an exact rational. Integer fps is `{ num: 30, den: 1 }`;
   * NTSC is `{ num: 30000, den: 1001 }`. This shape lets the orchestrator
   * pass the exact rational through to FFmpeg's `-r` / `-framerate` flags
   * without a decimal round-trip — see `fpsToFfmpegArg` in @hyperframes/core.
   *
   * Use `fpsToNumber(config.fps)` at any site that needs a `number` for
   * arithmetic (frame-index → time, telemetry, frame-interval ms). Decimal
   * precision at our scales is more than sufficient.
   */
  fps: Fps;
  quality: "draft" | "standard" | "high";
  /**
   * Output container format. Defaults to `"mp4"`; existing renders are
   * unaffected unless this field is set explicitly.
   *
   * - `"mp4"`: H.264 by default, or H.265 + HDR10 when HDR auto-detect
   *   engages or `hdrMode: "force-hdr"` is set. Opaque. The
   *   default streaming/social deliverable. Faststart is applied so the
   *   `moov` atom sits at the file start and the file plays from a
   *   partial download.
   * - `"webm"`: VP9 + `yuva420p` pixel format → **true alpha channel**, no
   *   chroma key. Plays in Chrome, Edge, and Firefox; Safari support for
   *   alpha-WebM is incomplete. Use this when the output should drop
   *   straight into a `<video>` over a colored background on the web.
   *   Audio is muxed as Opus.
   * - `"mov"`: ProRes 4444 + `yuva444p10le` → **true alpha channel +
   *   10-bit color**. Sized for editor ingest (Premiere, Final Cut Pro,
   *   DaVinci Resolve), not direct web playback. Audio is muxed as AAC.
   * - `"png-sequence"`: a directory of zero-padded RGBA PNGs
   *   (`frame_000001.png` …). Lossless alpha, largest on disk, no muxed
   *   audio (an `audio.aac` sidecar is written alongside the PNGs when
   *   the composition has audio elements). Use for After Effects / Nuke
   *   / Fusion ingest, or when frames need post-processing before
   *   encoding. `outputPath` is treated as a directory; it is created if
   *   it doesn't exist.
   *
   * Alpha output (`"webm"`, `"mov"`, `"png-sequence"`) automatically
   * forces screenshot capture (Chrome's BeginFrame compositor does not
   * preserve alpha on Linux headless-shell) and disables HDR — HDR +
   * alpha is not a supported combination, a warning is logged and HDR
   * falls back to SDR. The transparent-background CSS is injected by
   * the engine's `initTransparentBackground` helper, so authors should
   * not paint a fullscreen `body` / `#root` background in their
   * compositions when targeting alpha output.
   */
  format?: "mp4" | "webm" | "mov" | "png-sequence";
  workers?: number;
  useGpu?: boolean;
  debug?: boolean;
  /** Entry HTML file relative to projectDir. Defaults to "index.html". */
  entryFile?: string;
  /** Full producer config. When provided, env vars are not read. */
  producerConfig?: EngineConfig;
  /** Custom logger. Defaults to console-based defaultLogger. */
  logger?: ProducerLogger;
  /** Override CRF for the video encoder. Mutually exclusive with `videoBitrate`. */
  crf?: number;
  /** Target video bitrate (e.g. "10M"). Mutually exclusive with `crf`. */
  videoBitrate?: string;
  /** HDR rendering mode.
   * - `auto` (default): probe sources; enable HDR if any HDR content is found.
   * - `force-hdr`: enable HDR even on SDR-only compositions (falls back to HLG transfer).
   * - `force-sdr`: skip probing entirely; always render SDR.
   */
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
  /**
   * Render-time variable overrides for the composition. Injected as
   * `window.__hfVariables` before any page script runs and consumed by the
   * runtime helper `getVariables()`, which merges them over the declared
   * defaults from `<html data-composition-variables="...">`.
   *
   * Populated by the CLI from `--variables '<json>'` /
   * `--variables-file <path>`. Must be a JSON-serializable plain object.
   */
  variables?: Record<string, unknown>;
  /**
   * Override the output resolution via Chrome `deviceScaleFactor` (DPR).
   * The composition's authored dimensions are unchanged. See
   * {@link resolveDeviceScaleFactor} for the integer-scale, aspect, and
   * HDR constraints.
   */
  outputResolution?: CanvasResolution;
}

export interface RenderPerfSummary {
  renderId: string;
  totalElapsedMs: number;
  fps: number;
  quality: string;
  workers: number;
  chunkedEncode: boolean;
  chunkSizeFrames: number | null;
  compositionDurationSeconds: number;
  totalFrames: number;
  resolution: { width: number; height: number };
  videoCount: number;
  audioCount: number;
  stages: Record<string, number>;
  /** Per-phase breakdown of the Phase 2 video extraction (resolve, HDR probe, HDR preflight, VFR probe/preflight, per-video extract). Undefined when the composition has no videos. */
  videoExtractBreakdown?: ExtractionPhaseBreakdown;
  /** Bytes on disk in the render's workDir at assembly time (sampled before cleanup). Lets callers correlate peak temp usage with render duration. */
  tmpPeakBytes?: number;
  captureAvgMs?: number;
  capturePeakMs?: number;
  captureCalibration?: {
    sampledFrames: number[];
    p95Ms?: number;
    multiplier: number;
    reasons: string[];
  };
  captureAttempts?: CaptureAttemptSummary[];
  /**
   * Peak resident set size (RSS) observed during the render, in MiB.
   *
   * Sampled every 250ms by a process-wide poller; surfaces gross memory
   * regressions (e.g. unbounded image-cache growth) that wall-clock numbers
   * miss. Optional because callers can serialize older `RenderPerfSummary`
   * shapes back into this type.
   */
  peakRssMb?: number;
  /**
   * Peak V8 heap used observed during the render, in MiB.
   *
   * Useful as a finer-grained complement to {@link peakRssMb} — RSS includes
   * native ffmpeg/Chrome allocations, while heapUsed isolates JS-object growth
   * inside the orchestrator. Optional for the same back-compat reason.
   */
  peakHeapUsedMb?: number;
  hdrDiagnostics?: HdrDiagnostics;
  hdrPerf?: HdrPerfSummary;
}

export interface HdrDiagnostics {
  videoExtractionFailures: number;
  imageDecodeFailures: number;
}

export interface HdrPerfSummary {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<string, number>;
  avgMs: Record<string, number>;
}

type HdrPerfTimingKey =
  | "frameSeekMs"
  | "frameInjectMs"
  | "stackingQueryMs"
  | "canvasClearMs"
  | "normalCompositeMs"
  | "transitionCompositeMs"
  | "transitionShaderBlendMs"
  | "encoderWriteMs"
  | "hdrVideoReadDecodeMs"
  | "hdrVideoTransferMs"
  | "hdrVideoBlitMs"
  | "hdrImageTransferMs"
  | "hdrImageBlitMs"
  | "domLayerSeekMs"
  | "domLayerInjectMs"
  | "domMaskApplyMs"
  | "domScreenshotMs"
  | "domMaskRemoveMs"
  | "domPngDecodeMs"
  | "domBlitMs";

interface HdrPerfCollector {
  frames: number;
  normalFrames: number;
  transitionFrames: number;
  domLayerCaptures: number;
  hdrVideoLayerBlits: number;
  hdrImageLayerBlits: number;
  timings: Record<HdrPerfTimingKey, number>;
}

function createHdrPerfCollector(): HdrPerfCollector {
  return {
    frames: 0,
    normalFrames: 0,
    transitionFrames: 0,
    domLayerCaptures: 0,
    hdrVideoLayerBlits: 0,
    hdrImageLayerBlits: 0,
    timings: {
      frameSeekMs: 0,
      frameInjectMs: 0,
      stackingQueryMs: 0,
      canvasClearMs: 0,
      normalCompositeMs: 0,
      transitionCompositeMs: 0,
      transitionShaderBlendMs: 0,
      encoderWriteMs: 0,
      hdrVideoReadDecodeMs: 0,
      hdrVideoTransferMs: 0,
      hdrVideoBlitMs: 0,
      hdrImageTransferMs: 0,
      hdrImageBlitMs: 0,
      domLayerSeekMs: 0,
      domLayerInjectMs: 0,
      domMaskApplyMs: 0,
      domScreenshotMs: 0,
      domMaskRemoveMs: 0,
      domPngDecodeMs: 0,
      domBlitMs: 0,
    },
  };
}

function addHdrTiming(perf: HdrPerfCollector | undefined, key: HdrPerfTimingKey, startMs: number) {
  if (!perf) return;
  perf.timings[key] += Date.now() - startMs;
}

function averageTiming(totalMs: number, count: number): number {
  return count > 0 ? Math.round((totalMs / count) * 100) / 100 : 0;
}

function finalizeHdrPerf(perf: HdrPerfCollector): HdrPerfSummary {
  const avgMs: Record<string, number> = {};
  const perFrameKeys: HdrPerfTimingKey[] = [
    "frameSeekMs",
    "frameInjectMs",
    "stackingQueryMs",
    "canvasClearMs",
    "encoderWriteMs",
  ];
  for (const key of perFrameKeys) avgMs[key] = averageTiming(perf.timings[key], perf.frames);
  avgMs.normalCompositeMs = averageTiming(perf.timings.normalCompositeMs, perf.normalFrames);
  avgMs.transitionCompositeMs = averageTiming(
    perf.timings.transitionCompositeMs,
    perf.transitionFrames,
  );
  avgMs.transitionShaderBlendMs = averageTiming(
    perf.timings.transitionShaderBlendMs,
    perf.transitionFrames,
  );

  const perDomLayerKeys: HdrPerfTimingKey[] = [
    "domLayerSeekMs",
    "domLayerInjectMs",
    "domMaskApplyMs",
    "domScreenshotMs",
    "domMaskRemoveMs",
    "domPngDecodeMs",
    "domBlitMs",
  ];
  for (const key of perDomLayerKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.domLayerCaptures);
  }

  const perHdrVideoKeys: HdrPerfTimingKey[] = [
    "hdrVideoReadDecodeMs",
    "hdrVideoTransferMs",
    "hdrVideoBlitMs",
  ];
  for (const key of perHdrVideoKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrVideoLayerBlits);
  }

  const perHdrImageKeys: HdrPerfTimingKey[] = ["hdrImageTransferMs", "hdrImageBlitMs"];
  for (const key of perHdrImageKeys) {
    avgMs[key] = averageTiming(perf.timings[key], perf.hdrImageLayerBlits);
  }

  return {
    frames: perf.frames,
    normalFrames: perf.normalFrames,
    transitionFrames: perf.transitionFrames,
    domLayerCaptures: perf.domLayerCaptures,
    hdrVideoLayerBlits: perf.hdrVideoLayerBlits,
    hdrImageLayerBlits: perf.hdrImageLayerBlits,
    timings: { ...perf.timings },
    avgMs,
  };
}

export interface CaptureCostEstimate {
  multiplier: number;
  reasons: string[];
  p95Ms?: number;
}

export interface CaptureCalibrationSample {
  frameIndex: number;
  captureTimeMs: number;
}

export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export interface CaptureAttemptSummary {
  attempt: number;
  workers: number;
  frameCount: number;
  reason: "initial" | "retry";
}

export interface RenderJob {
  id: string;
  config: RenderConfig;
  status: RenderStatus;
  progress: number;
  currentStage: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  outputPath?: string;
  duration?: number;
  totalFrames?: number;
  framesRendered?: number;
  perfSummary?: RenderPerfSummary;
  failedStage?: string;
  errorDetails?: {
    message: string;
    stack?: string;
    elapsedMs: number;
    freeMemoryMB: number;
    browserConsoleTail?: string[];
    perfStages?: Record<string, number>;
    hdrDiagnostics?: HdrDiagnostics;
  };
}

export type ProgressCallback = (job: RenderJob, message: string) => void;

export class RenderCancelledError extends Error {
  reason: "user_cancelled" | "timeout" | "aborted";
  constructor(
    message: string = "render_cancelled",
    reason: "user_cancelled" | "timeout" | "aborted" = "aborted",
  ) {
    super(message);
    this.name = "RenderCancelledError";
    this.reason = reason;
  }
}

function updateJobStatus(
  job: RenderJob,
  status: RenderStatus,
  stage: string,
  progress: number,
  onProgress?: ProgressCallback,
): void {
  job.status = status;
  job.currentStage = stage;
  job.progress = progress;
  if (status === "failed" || status === "complete") job.completedAt = new Date();
  if (onProgress) onProgress(job, stage);
}

function installDebugLogger(logPath: string, log: ProducerLogger = defaultLogger): () => void {
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  const write = (prefix: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${prefix} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    try {
      appendFileSync(logPath, line);
    } catch (err) {
      log.debug("Debug log write failed", {
        logPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  console.log = (...args: unknown[]) => {
    write("LOG", args);
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    write("ERR", args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    write("WRN", args);
    origWarn(...args);
  };

  return () => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  };
}

export function createCompiledFrameSrcResolver(
  compiledDir: string,
): (framePath: string) => string | null {
  const compiledRoot = resolve(compiledDir);
  return (framePath: string): string | null => {
    const resolvedFramePath = resolve(framePath);
    if (!isPathInside(resolvedFramePath, compiledRoot)) return null;

    const relativePath = relative(compiledRoot, resolvedFramePath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return null;
    }

    return `/${relativePath
      .split(/[\\/]+/)
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  };
}

type MaterializedExtractedFrames = Pick<ExtractedFrames, "videoId" | "outputDir" | "framePaths">;

type MaterializePathModule = {
  resolve: (...segments: string[]) => string;
  join: (...segments: string[]) => string;
  dirname: (path: string) => string;
  basename: (path: string) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (path: string) => boolean;
};

type MaterializeFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => unknown;
  symlinkSync: (target: string, path: string) => unknown;
};

type MaterializeExtractedFramesOptions = {
  pathModule?: MaterializePathModule;
  fileSystem?: MaterializeFileSystem;
};

const materializePathModule: MaterializePathModule = {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
};

const materializeFileSystem: MaterializeFileSystem = {
  existsSync,
  mkdirSync,
  symlinkSync,
};

export function materializeExtractedFramesForCompiledDir(
  extracted: MaterializedExtractedFrames[],
  compiledDir: string,
  options: MaterializeExtractedFramesOptions = {},
): void {
  const pathModule = options.pathModule ?? materializePathModule;
  const fileSystem = options.fileSystem ?? materializeFileSystem;
  const resolvedCompiledDir = pathModule.resolve(compiledDir);
  const compiledFrameRoot = pathModule.join(resolvedCompiledDir, "__hyperframes_video_frames");

  for (const ext of extracted) {
    const resolvedOut = pathModule.resolve(ext.outputDir);
    if (isPathInside(resolvedOut, resolvedCompiledDir, { pathModule })) continue;

    const linkPath = pathModule.join(compiledFrameRoot, ext.videoId);
    if (!fileSystem.existsSync(linkPath)) {
      fileSystem.mkdirSync(pathModule.dirname(linkPath), { recursive: true });
      fileSystem.symlinkSync(resolvedOut, linkPath);
    }

    const remapped = new Map<number, string>();
    for (const [idx, framePath] of ext.framePaths) {
      remapped.set(idx, pathModule.join(linkPath, pathModule.basename(framePath)));
    }
    ext.framePaths = remapped;
    ext.outputDir = linkPath;
  }
}

export function collectVideoReadinessSkipIds(
  nativeHdrVideoIds: ReadonlySet<string>,
  extractedVideos: readonly ExtractedVideoReadinessInput[],
): string[] {
  return Array.from(
    new Set([
      ...nativeHdrVideoIds,
      ...extractedVideos
        .filter((video) => hasUsableVideoDimensions(video.metadata))
        .map((video) => video.videoId),
    ]),
  ).sort();
}

interface ExtractedVideoReadinessInput {
  videoId: string;
  metadata: {
    width: number;
    height: number;
  };
}

function hasUsableVideoDimensions(metadata: ExtractedVideoReadinessInput["metadata"]) {
  return (
    Number.isFinite(metadata.width) &&
    Number.isFinite(metadata.height) &&
    metadata.width > 0 &&
    metadata.height > 0
  );
}

export function collectVideoMetadataHints(
  extractedVideos: readonly ExtractedVideoReadinessInput[],
): CaptureVideoMetadataHint[] {
  return extractedVideos
    .filter((video) => hasUsableVideoDimensions(video.metadata))
    .map((video) => ({
      id: video.videoId,
      width: video.metadata.width,
      height: video.metadata.height,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveRenderWorkerCount(
  totalFrames: number,
  requestedWorkers: number | undefined,
  cfg: EngineConfig,
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
  log: ProducerLogger = defaultLogger,
  measuredCaptureCost?: CaptureCostEstimate,
): number {
  const captureCost = combineCaptureCostEstimates(
    estimateCaptureCostMultiplier(compiled),
    measuredCaptureCost,
  );
  const workerCount = calculateOptimalWorkers(totalFrames, requestedWorkers, {
    ...cfg,
    captureCostMultiplier: captureCost.multiplier,
  });

  if (requestedWorkers !== undefined || captureCost.multiplier <= 1) {
    return workerCount;
  }

  const baselineWorkers = calculateOptimalWorkers(totalFrames, undefined, cfg);
  if (workerCount < baselineWorkers) {
    log.warn(
      "[Render] Reduced auto worker count for high-cost capture workload to avoid Chrome compositor starvation.",
      {
        from: baselineWorkers,
        to: workerCount,
        costMultiplier: captureCost.multiplier,
        reasons: captureCost.reasons,
      },
    );
  }

  return workerCount;
}

/**
 * Optional cost-shaping inputs for `estimateCaptureCostMultiplier`.
 *
 * `transitionFrameRatio` is the fraction (0..1) of frames that will hit the
 * expensive sequential layered compositor — the rest run on the fast parallel
 * path post-#677. When provided alongside `hasShaderTransitions`, the cost is
 * blended (`1 + ratio * 1.5`) so auto-worker sizing reflects the post-hybrid
 * workload instead of charging the legacy flat `+2`. Pre-hybrid callers and
 * pre-#677 callers that don't yet know the ratio fall back to the flat charge.
 */
export interface CaptureCostShape {
  /** Fraction of total frames inside an active transition window (0..1). */
  transitionFrameRatio?: number;
}

export function estimateCaptureCostMultiplier(
  compiled: Pick<CompiledComposition, "hasShaderTransitions" | "renderModeHints">,
  shape?: CaptureCostShape,
): CaptureCostEstimate {
  let multiplier = 1;
  const reasons: string[] = [];

  if (compiled.hasShaderTransitions) {
    const ratio = shape?.transitionFrameRatio;
    if (typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      // Hybrid path (issue #677): only `ratio` of frames pay the expensive
      // sequential layered cost; the rest go through the parallel capture
      // pool. Blend the historical flat `+2` charge by the ratio plus a
      // small base bump so the per-worker provisioning still leaves CPU
      // headroom for the transition processor running alongside the pool.
      // A composition with no live transitions (e.g. all transitions sit
      // before/after the composition window) collapses to `1 + 0 = 1` and
      // gets the same auto-worker count as a plain SDR render.
      multiplier += ratio * 1.5;
      reasons.push(`shader-transitions(${(ratio * 100).toFixed(0)}%-frames)`);
    } else {
      multiplier += 2;
      reasons.push("shader-transitions");
    }
  }

  const reasonCodes = new Set(compiled.renderModeHints.reasons.map((reason) => reason.code));
  if (reasonCodes.has("requestAnimationFrame")) {
    multiplier += 1;
    reasons.push("requestAnimationFrame");
  }
  if (reasonCodes.has("iframe")) {
    multiplier += 0.5;
    reasons.push("iframe");
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    reasons,
  };
}

function combineCaptureCostEstimates(
  staticCost: CaptureCostEstimate,
  measuredCost?: CaptureCostEstimate,
): CaptureCostEstimate {
  if (!measuredCost || measuredCost.multiplier <= 1) return staticCost;
  if (staticCost.multiplier >= measuredCost.multiplier) {
    return {
      multiplier: staticCost.multiplier,
      reasons: [...staticCost.reasons, ...measuredCost.reasons],
      p95Ms: measuredCost.p95Ms,
    };
  }
  return {
    multiplier: measuredCost.multiplier,
    reasons: [...measuredCost.reasons, ...staticCost.reasons],
    p95Ms: measuredCost.p95Ms,
  };
}

const CAPTURE_CALIBRATION_TARGET_MS = 600;
const MAX_MEASURED_CAPTURE_COST_MULTIPLIER = 8;
const CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS = 30_000;

export function createCaptureCalibrationConfig(cfg: EngineConfig): EngineConfig {
  return {
    ...cfg,
    protocolTimeout: Math.min(cfg.protocolTimeout, CAPTURE_CALIBRATION_PROTOCOL_TIMEOUT_MS),
  };
}

export function estimateMeasuredCaptureCostMultiplier(
  samples: CaptureCalibrationSample[],
): CaptureCostEstimate {
  if (samples.length === 0) {
    return { multiplier: 1, reasons: [] };
  }

  const sorted = [...samples].sort((a, b) => a.captureTimeMs - b.captureTimeMs);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95Sample = sorted[p95Index] ?? sorted[sorted.length - 1];
  if (!p95Sample) {
    return { multiplier: 1, reasons: [] };
  }
  const p95Ms = Math.round(p95Sample.captureTimeMs);
  const multiplier = Math.min(
    MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
    Math.max(1, Math.round((p95Ms / CAPTURE_CALIBRATION_TARGET_MS) * 100) / 100),
  );

  return {
    multiplier,
    reasons: multiplier > 1 ? [`calibration-p95=${p95Ms}ms`] : [],
    p95Ms,
  };
}

export function selectCaptureCalibrationFrames(totalFrames: number): number[] {
  if (totalFrames <= 0) return [];
  const lastFrame = totalFrames - 1;
  const candidates = [
    0,
    Math.floor(totalFrames * 0.25),
    Math.floor(totalFrames * 0.5),
    Math.floor(totalFrames * 0.75),
    lastFrame,
  ];
  return Array.from(
    new Set(candidates.map((frame) => Math.max(0, Math.min(lastFrame, frame)))),
  ).sort((a, b) => a - b);
}

export function findMissingFrameRanges(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): FrameRange[] {
  const ranges: FrameRange[] = [];
  let rangeStart: number | null = null;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.${frameExt}`);
    const missing = !existsSync(framePath);
    if (missing && rangeStart === null) {
      rangeStart = frameIndex;
    } else if (!missing && rangeStart !== null) {
      ranges.push({ startFrame: rangeStart, endFrame: frameIndex });
      rangeStart = null;
    }
  }

  if (rangeStart !== null) {
    ranges.push({ startFrame: rangeStart, endFrame: totalFrames });
  }

  return ranges;
}

export function buildMissingFrameRetryBatches(
  ranges: FrameRange[],
  maxWorkers: number,
  workDir: string,
  attempt: number,
): WorkerTask[][] {
  const workersPerBatch = Math.max(1, Math.floor(maxWorkers));
  const batches: WorkerTask[][] = [];

  for (let i = 0; i < ranges.length; i += workersPerBatch) {
    const batchIndex = batches.length;
    const batch = ranges.slice(i, i + workersPerBatch).map((range, workerId) => ({
      workerId,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      outputDir: join(workDir, `retry-${attempt}-batch-${batchIndex}-worker-${workerId}`),
    }));
    batches.push(batch);
  }

  return batches;
}

export function getNextRetryWorkerCount(currentWorkers: number): number {
  return Math.max(1, Math.floor(currentWorkers / 2));
}

export function isRecoverableParallelCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("[Parallel] Capture failed") &&
    /Runtime\.callFunctionOn timed out|HeadlessExperimental\.beginFrame timed out|Waiting failed|timeout exceeded|timed out|Navigation timeout|Protocol error|Target closed/i.test(
      message,
    )
  );
}

export function shouldFallbackToScreenshotAfterCalibrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HeadlessExperimental\.beginFrame timed out|beginFrame probe timeout|Another frame is pending|Frame still pending|Protocol error.*HeadlessExperimental\.beginFrame|Runtime\.callFunctionOn timed out|Runtime\.evaluate timed out/i.test(
    message,
  );
}

function countCapturedFrames(
  totalFrames: number,
  framesDir: string,
  frameExt: "jpg" | "png",
): number {
  let captured = 0;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const framePath = join(framesDir, `frame_${String(frameIndex).padStart(6, "0")}.${frameExt}`);
    if (existsSync(framePath)) captured++;
  }
  return captured;
}

function countFrameRanges(ranges: FrameRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.endFrame - range.startFrame), 0);
}

async function measureCaptureCostFromSession(
  session: CaptureSession,
  totalFrames: number,
  fps: number,
): Promise<{ estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] }> {
  const sampledFrames = selectCaptureCalibrationFrames(totalFrames);
  const samples: CaptureCalibrationSample[] = [];

  for (const frameIndex of sampledFrames) {
    const time = frameIndex / fps;
    const startedAt = Date.now();
    const result = await captureFrameToBuffer(session, frameIndex, time);
    samples.push({
      frameIndex,
      captureTimeMs: result.captureTimeMs || Date.now() - startedAt,
    });
  }

  return {
    estimate: estimateMeasuredCaptureCostMultiplier(samples),
    samples,
  };
}

function logCaptureCalibrationResult(
  calibration: { estimate: CaptureCostEstimate; samples: CaptureCalibrationSample[] },
  log: ProducerLogger,
): void {
  if (calibration.estimate.multiplier > 1) {
    log.warn("[Render] Measured slow frame capture during auto-worker calibration.", {
      multiplier: calibration.estimate.multiplier,
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  } else {
    log.debug("[Render] Auto-worker calibration kept baseline capture cost.", {
      p95Ms: calibration.estimate.p95Ms,
      sampledFrames: calibration.samples.map((sample) => sample.frameIndex),
    });
  }
}

function createFailedCaptureCalibrationEstimate(reason: string): {
  estimate: CaptureCostEstimate;
  samples: CaptureCalibrationSample[];
} {
  return {
    estimate: {
      multiplier: MAX_MEASURED_CAPTURE_COST_MULTIPLIER,
      reasons: [reason],
    },
    samples: [],
  };
}

async function executeDiskCaptureWithAdaptiveRetry(options: {
  serverUrl: string;
  workDir: string;
  framesDir: string;
  totalFrames: number;
  initialWorkerCount: number;
  allowRetry: boolean;
  frameExt: "jpg" | "png";
  captureOptions: CaptureOptions;
  createBeforeCaptureHook: () => BeforeCaptureHook | null;
  abortSignal?: AbortSignal;
  onProgress?: (progress: ParallelProgress) => void;
  cfg: EngineConfig;
  log: ProducerLogger;
}): Promise<CaptureAttemptSummary[]> {
  const attempts: CaptureAttemptSummary[] = [];
  let currentWorkers = options.initialWorkerCount;
  let missingRanges: FrameRange[] | null = null;
  let attempt = 0;

  while (true) {
    const frameCount = missingRanges ? countFrameRanges(missingRanges) : options.totalFrames;
    attempts.push({
      attempt,
      workers: currentWorkers,
      frameCount,
      reason: attempt === 0 ? "initial" : "retry",
    });

    const attemptWorkDir = join(options.workDir, `capture-attempt-${attempt}`);
    const batches = missingRanges
      ? buildMissingFrameRetryBatches(missingRanges, currentWorkers, attemptWorkDir, attempt)
      : [distributeFrames(options.totalFrames, currentWorkers, attemptWorkDir)];

    try {
      for (const tasks of batches) {
        const capturedBeforeBatch = countCapturedFrames(
          options.totalFrames,
          options.framesDir,
          options.frameExt,
        );
        try {
          await executeParallelCapture(
            options.serverUrl,
            attemptWorkDir,
            tasks,
            options.captureOptions,
            options.createBeforeCaptureHook,
            options.abortSignal,
            options.onProgress
              ? (progress) => {
                  options.onProgress?.({
                    ...progress,
                    totalFrames: options.totalFrames,
                    capturedFrames: Math.min(
                      options.totalFrames,
                      capturedBeforeBatch + progress.capturedFrames,
                    ),
                  });
                }
              : undefined,
            undefined,
            options.cfg,
          );
        } finally {
          await mergeWorkerFrames(attemptWorkDir, tasks, options.framesDir);
        }
      }

      const remaining = findMissingFrameRanges(
        options.totalFrames,
        options.framesDir,
        options.frameExt,
      );
      if (remaining.length === 0) {
        return attempts;
      }
      if (!options.allowRetry || currentWorkers <= 1) {
        throw new Error(
          `[Render] Capture completed but ${countFrameRanges(remaining)} frame(s) are missing`,
        );
      }

      const nextWorkers = getNextRetryWorkerCount(currentWorkers);
      options.log.warn("[Render] Retrying missing captured frames with fewer workers.", {
        fromWorkers: currentWorkers,
        toWorkers: nextWorkers,
        missingFrames: countFrameRanges(remaining),
      });
      currentWorkers = nextWorkers;
      missingRanges = remaining;
      attempt++;
    } catch (error) {
      const remaining = findMissingFrameRanges(
        options.totalFrames,
        options.framesDir,
        options.frameExt,
      );
      if (remaining.length === 0) {
        return attempts;
      }
      if (!options.allowRetry || currentWorkers <= 1 || !isRecoverableParallelCaptureError(error)) {
        throw error;
      }

      const nextWorkers = getNextRetryWorkerCount(currentWorkers);
      options.log.warn("[Render] Parallel capture timed out; retrying missing frames.", {
        fromWorkers: currentWorkers,
        toWorkers: nextWorkers,
        missingFrames: countFrameRanges(remaining),
        error: error instanceof Error ? error.message : String(error),
      });
      currentWorkers = nextWorkers;
      missingRanges = remaining;
      attempt++;
    }
  }
}

/**
 * Crop an rgb48le buffer to a sub-region. Returns a new Buffer containing
 * only the cropped pixels.
 */
function cropRgb48le(
  src: Buffer,
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): Buffer {
  const BPP = 6;
  const dst = Buffer.alloc(cropW * cropH * BPP);
  for (let row = 0; row < cropH; row++) {
    const srcRow = cropY + row;
    if (srcRow < 0 || srcRow >= srcH) continue;
    const srcOff = (srcRow * srcW + cropX) * BPP;
    const dstOff = row * cropW * BPP;
    const copyLen = Math.min(cropW, srcW - cropX) * BPP;
    if (copyLen > 0) src.copy(dst, dstOff, srcOff, srcOff + copyLen);
  }
  return dst;
}

/**
 * Blit a single HDR video layer onto an rgb48le canvas.
 *
 * Shared between the normal-frame compositing path (compositeToBuffer)
 * and the transition dual-scene compositing loop to avoid duplicating
 * the frame lookup, raw read, transfer, transform, and blit logic.
 */
interface HdrVideoFrameSource {
  dir: string;
  rawPath: string;
  fd: number;
  width: number;
  height: number;
  frameSize: number;
  frameCount: number;
  scratch: Buffer;
}

function closeHdrVideoFrameSource(source: HdrVideoFrameSource, log?: ProducerLogger): void {
  try {
    closeSync(source.fd);
  } catch (err) {
    log?.warn("Failed to close HDR raw frame file", {
      rawPath: source.rawPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function blitHdrVideoLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  time: number,
  fps: number,
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>,
  hdrStartTimes: Map<string, number>,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const frameSource = hdrVideoFrameSources.get(el.id);
  const startTime = hdrStartTimes.get(el.id);
  if (!frameSource || startTime === undefined || el.opacity <= 0) {
    return;
  }

  // Frame index within the video. Clamp to the extracted raw frame count so
  // a composition that outlives the source clip freezes on the last frame,
  // matching Chrome's <video> behavior.
  const videoFrameIndex = Math.round((time - startTime) * fps) + 1;
  if (videoFrameIndex < 1) return;
  const effectiveIndex = Math.min(videoFrameIndex, frameSource.frameCount);
  if (effectiveIndex < 1) return;
  const frameOffset = (effectiveIndex - 1) * frameSource.frameSize;

  try {
    if (hdrPerf) hdrPerf.hdrVideoLayerBlits += 1;
    let timingStart = Date.now();
    const bytesRead = readSync(
      frameSource.fd,
      frameSource.scratch,
      0,
      frameSource.frameSize,
      frameOffset,
    );
    if (bytesRead !== frameSource.frameSize) return;
    const hdrRgb = frameSource.scratch;
    const srcW = frameSource.width;
    const srcH = frameSource.height;
    addHdrTiming(hdrPerf, "hdrVideoReadDecodeMs", timingStart);

    // Convert between HDR transfer functions if source doesn't match output
    if (sourceTransfer && targetTransfer && sourceTransfer !== targetTransfer) {
      timingStart = Date.now();
      convertTransfer(hdrRgb, sourceTransfer, targetTransfer);
      addHdrTiming(hdrPerf, "hdrVideoTransferMs", timingStart);
    }

    const viewportMatrix = parseTransformMatrix(el.transform);

    // Pass border-radius for rounded-corner masking (only when non-zero)
    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    // Apply ancestor overflow:hidden clip rect by constraining the blit
    // bounds. For the no-transform (region) path, we crop the source
    // image and adjust the destination position. For the affine path,
    // clip rect support is not yet implemented (would require per-pixel
    // scissor in the affine blit); log a warning and skip clipping.
    let blitX = el.x;
    let blitY = el.y;
    let blitSrcX = 0;
    let blitSrcY = 0;
    let blitW = srcW;
    let blitH = srcH;
    let clipped = false;

    if (el.clipRect) {
      const cr = el.clipRect;
      const cx1 = Math.max(blitX, cr.x);
      const cy1 = Math.max(blitY, cr.y);
      const cx2 = Math.min(blitX + blitW, cr.x + cr.width);
      const cy2 = Math.min(blitY + blitH, cr.y + cr.height);
      if (cx2 <= cx1 || cy2 <= cy1) return; // fully clipped
      blitSrcX = cx1 - blitX;
      blitSrcY = cy1 - blitY;
      blitW = cx2 - cx1;
      blitH = cy2 - cy1;
      blitX = cx1;
      blitY = cy1;
      clipped = true;
    }

    // Detect translation-only matrix (no scale/rotation) — route through the
    // region path which supports clip rects. Chrome reports a viewport matrix
    // for all HDR elements, even untransformed ones or those with only layout
    // translation (e.g. `left: 960px` → `matrix(1,0,0,1,960,0)`). The region
    // blit handles translation via el.x/el.y, so we only need the affine path
    // for actual scale/rotation transforms.
    // parseTransformMatrix returns a 6-element array or null — length check unnecessary.
    const isTranslationOnly = !!(
      viewportMatrix &&
      Math.abs(viewportMatrix[0]! - 1) < 0.001 &&
      Math.abs(viewportMatrix[1]!) < 0.001 &&
      Math.abs(viewportMatrix[2]!) < 0.001 &&
      Math.abs(viewportMatrix[3]! - 1) < 0.001
    );

    timingStart = Date.now();
    if (viewportMatrix && !isTranslationOnly) {
      if (clipped && log) {
        log.debug(
          `HDR clip rect on affine-transformed element ${el.id} — clip not applied (affine scissor not yet supported)`,
        );
      }
      blitRgb48leAffine(
        canvas,
        hdrRgb,
        viewportMatrix,
        srcW,
        srcH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    } else if (clipped) {
      // Crop the source buffer to the clipped region before blitting
      const croppedBuf = cropRgb48le(hdrRgb, srcW, srcH, blitSrcX, blitSrcY, blitW, blitH);
      blitRgb48leRegion(
        canvas,
        croppedBuf,
        blitX,
        blitY,
        blitW,
        blitH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    } else {
      blitRgb48leRegion(
        canvas,
        hdrRgb,
        el.x,
        el.y,
        srcW,
        srcH,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    }
    addHdrTiming(hdrPerf, "hdrVideoBlitMs", timingStart);
  } catch (err) {
    if (log) {
      log.debug(`HDR blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Pre-decoded HDR image buffer with its native pixel dimensions.
 *
 * Static images decode exactly once at setup time and are blitted on every
 * visible frame, unlike video frames which are read fresh per timestamp.
 */
interface HdrImageBuffer {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Blit a single HDR image layer onto an rgb48le canvas.
 *
 * Image-equivalent of `blitHdrVideoLayer` — the buffer is pre-decoded and
 * static, so there's no time-based frame lookup or per-frame PNG read.
 */
function blitHdrImageLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  hdrImageBuffers: Map<string, HdrImageBuffer>,
  hdrImageTransferCache: HdrImageTransferCache,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const buf = hdrImageBuffers.get(el.id);
  if (!buf || el.opacity <= 0) {
    return;
  }
  if (el.clipRect && log) {
    log.debug(`HDR clip rect on image element ${el.id} — clip not yet supported for images`);
  }

  try {
    if (hdrPerf) hdrPerf.hdrImageLayerBlits += 1;
    // The cache returns `buf.data` unchanged when no conversion is needed,
    // and otherwise returns a per-(imageId, targetTransfer) buffer that was
    // converted exactly once and reused across every subsequent frame.
    let timingStart = Date.now();
    const hdrRgb =
      sourceTransfer && targetTransfer
        ? hdrImageTransferCache.getConverted(el.id, sourceTransfer, targetTransfer, buf.data)
        : buf.data;
    addHdrTiming(hdrPerf, "hdrImageTransferMs", timingStart);

    const viewportMatrix = parseTransformMatrix(el.transform);

    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    timingStart = Date.now();
    if (viewportMatrix) {
      blitRgb48leAffine(
        canvas,
        hdrRgb,
        viewportMatrix,
        buf.width,
        buf.height,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    } else {
      blitRgb48leRegion(
        canvas,
        hdrRgb,
        el.x,
        el.y,
        buf.width,
        buf.height,
        width,
        height,
        el.opacity < 0.999 ? el.opacity : undefined,
        borderRadiusParam,
      );
    }
    addHdrTiming(hdrPerf, "hdrImageBlitMs", timingStart);
  } catch (err) {
    if (log) {
      log.debug(`HDR image blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Dependencies passed to `compositeHdrFrame`.
 *
 * Every field except the per-frame arguments is captured once when the HDR
 * render path opens its `try { ... }` block and reused across every frame —
 * extracting them into an explicit struct lets the helper live at module
 * scope (no closure-over-renderJob) and keeps the per-call signature small.
 */
type CompositeTransfer = HdrTransfer | "srgb";

export function shouldUseLayeredComposite(options: {
  hasHdrContent: boolean;
  hasShaderTransitions: boolean;
  isPngSequence: boolean;
}): boolean {
  return options.hasHdrContent || (options.hasShaderTransitions && !options.isPngSequence);
}

export function resolveCompositeTransfer(
  hasHdrContent: boolean,
  effectiveHdr: { transfer: HdrTransfer } | undefined,
): CompositeTransfer {
  return hasHdrContent && effectiveHdr ? effectiveHdr.transfer : "srgb";
}

interface HdrCompositeContext {
  log: ProducerLogger;
  domSession: CaptureSession;
  beforeCaptureHook: BeforeCaptureHook | null;
  width: number;
  height: number;
  fps: number;
  compositeTransfer: CompositeTransfer;
  nativeHdrImageIds: Set<string>;
  hdrImageBuffers: Map<string, HdrImageBuffer>;
  hdrImageTransferCache: HdrImageTransferCache;
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>;
  hdrVideoStartTimes: Map<string, number>;
  imageTransfers: Map<string, HdrTransfer>;
  videoTransfers: Map<string, HdrTransfer>;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
  hdrPerf?: HdrPerfCollector;
  /**
   * Optional worker-threads pool for off-main-thread PNG decode + rgba8-over-
   * rgb48le blit. When set, the layered-composite helpers dispatch DOM-layer
   * decode/blit to the pool instead of running it inline on the calling
   * thread. This pipelines Chrome's next CDP screenshot against the prior
   * frame's (or scene's) decode+blit. hf#732 lever-4. Falls back to inline
   * decode+blit when null/undefined; correctness is byte-equivalent across
   * paths because the worker calls the same `decodePng` + `blitRgba8OverRgb48le`
   * the inline path uses.
   */
  pngDecodeBlitPool?: PngDecodeBlitWorkerPool | null;
}

/**
 * Composite a single HDR frame into a pre-allocated `rgb48le` canvas.
 *
 * Bottom-to-top z-order: HDR layers are blitted directly from cached image
 * buffers / extracted video frames; DOM layers are screenshotted with a
 * mass-hide mask (so each layer paints only its own elements) and then
 * blended into the canvas via `blitRgba8OverRgb48le` in the active HDR
 * transfer space.
 *
 * The `elementFilter` parameter exists so the transition path can composite
 * each scene independently; pass `undefined` for whole-stack rendering.
 *
 * @param ctx - Long-lived dependencies (logger, browser session, dimensions,
 *              HDR layer maps). Captured once per render — see
 *              {@link HdrCompositeContext}.
 * @param canvas - Pre-allocated `width * height * 6` byte buffer. Caller must
 *                 zero-fill before every frame (this helper does not).
 * @param time - Seek time in seconds.
 * @param fullStacking - Stacking info for ALL elements at this time. Even when
 *                       filtering, every other element id is needed to build
 *                       the DOM-layer hide-list.
 * @param elementFilter - When set, only elements whose id is in the set are
 *                        composited.
 * @param debugFrameIndex - Frame index used to label per-layer diagnostic
 *                          dumps. Pass `-1` to disable per-layer dumps even
 *                          when `KEEP_TEMP=1` (e.g. for warmup frames).
 */
async function compositeHdrFrame(
  ctx: HdrCompositeContext,
  canvas: Buffer,
  time: number,
  fullStacking: ElementStackingInfo[],
  elementFilter?: Set<string>,
  debugFrameIndex: number = -1,
): Promise<Buffer> {
  const {
    log,
    domSession,
    beforeCaptureHook,
    width,
    height,
    fps,
    compositeTransfer,
    nativeHdrImageIds,
    hdrImageBuffers,
    hdrImageTransferCache,
    hdrVideoFrameSources,
    hdrVideoStartTimes,
    imageTransfers,
    videoTransfers,
    debugDumpEnabled,
    debugDumpDir,
    hdrPerf,
  } = ctx;
  const pool = ctx.pngDecodeBlitPool ?? null;
  // Per-frame pending decode+blit. When non-null, the canvas
  // ArrayBuffer has been transferred to the pool and the local `canvas`
  // variable points at a detached Buffer view. We MUST await this before
  // any read/write of the canvas (subsequent HDR layer blits, the next
  // DOM-layer dispatch, or the function's return value).
  //
  // The pool pattern saves ~70-80ms per consecutive DOM layer pair by
  // overlapping layer N's decode+blit (worker thread) with layer N+1's
  // CDP screenshot (Chrome thread). HDR layers force a drain because
  // they composite onto the canvas synchronously on the calling thread.
  let pendingDecodeBlit: Promise<Buffer> | null = null;
  let liveCanvas: Buffer = canvas;
  const drainPending = async (): Promise<void> => {
    if (!pendingDecodeBlit) return;
    const fresh = await pendingDecodeBlit;
    pendingDecodeBlit = null;
    liveCanvas = fresh;
  };

  const filteredStacking = elementFilter
    ? fullStacking.filter((e) => elementFilter.has(e.id))
    : fullStacking;

  // Zero-opacity elements stay in the stacking for correct hide-list
  // generation (their <img> replacements must be hidden from sibling
  // screenshots). The actual blit is skipped in the compositing loop below.
  const layers = groupIntoLayers(filteredStacking);

  const shouldLog = debugDumpEnabled && debugFrameIndex >= 0;
  if (shouldLog) {
    log.info("[diag] compositeToBuffer plan", {
      frame: debugFrameIndex,
      time: time.toFixed(3),
      filterSize: elementFilter?.size,
      fullStackingCount: fullStacking.length,
      filteredCount: filteredStacking.length,
      layerCount: layers.length,
      layers: layers.map((l) =>
        l.type === "hdr"
          ? {
              type: "hdr",
              id: l.element.id,
              z: l.element.zIndex,
              visible: l.element.visible,
              opacity: l.element.opacity,
              bounds: `${Math.round(l.element.x)},${Math.round(l.element.y)} ${Math.round(l.element.width)}x${Math.round(l.element.height)}`,
            }
          : { type: "dom", ids: l.elementIds },
      ),
    });
  }

  for (const [layerIdx, layer] of layers.entries()) {
    if (layer.type === "hdr") {
      // Skip zero-opacity HDR elements — their parent scene may have faded out.
      if (layer.element.opacity <= 0) continue;
      // HDR layer composites onto the canvas synchronously on the
      // calling thread, so we MUST await any in-flight DOM decode+blit
      // first (otherwise the underlying ArrayBuffer is still detached).
      await drainPending();
      const before = shouldLog ? countNonZeroRgb48(liveCanvas) : 0;
      const isHdrImage = nativeHdrImageIds.has(layer.element.id);
      const hdrTargetTransfer = compositeTransfer === "srgb" ? undefined : compositeTransfer;
      if (isHdrImage) {
        blitHdrImageLayer(
          liveCanvas,
          layer.element,
          hdrImageBuffers,
          hdrImageTransferCache,
          width,
          height,
          log,
          imageTransfers.get(layer.element.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      } else {
        blitHdrVideoLayer(
          liveCanvas,
          layer.element,
          time,
          fps,
          hdrVideoFrameSources,
          hdrVideoStartTimes,
          width,
          height,
          log,
          videoTransfers.get(layer.element.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      }
      if (shouldLog) {
        const after = countNonZeroRgb48(liveCanvas);
        if (isHdrImage) {
          const buf = hdrImageBuffers.get(layer.element.id);
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "image",
            pixelsAdded: after - before,
            totalNonZero: after,
            bufferDecoded: !!buf,
            bufferDims: buf ? `${buf.width}x${buf.height}` : null,
          });
        } else {
          const frameSource = hdrVideoFrameSources.get(layer.element.id);
          const startTime = hdrVideoStartTimes.get(layer.element.id) ?? 0;
          const localTime = time - startTime;
          const frameNum = Math.floor(localTime * fps) + 1;
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "video",
            pixelsAdded: after - before,
            totalNonZero: after,
            startTime,
            localTime: localTime.toFixed(3),
            hdrFrameNum: frameNum,
            rawPath: frameSource?.rawPath ?? null,
            frameCount: frameSource?.frameCount ?? null,
          });
        }
      }
    } else {
      // DOM layer: capture only elements in this layer.
      //
      // Each layer gets a fresh seek + inject cycle to guarantee correct
      // visibility state — avoids fragile interactions between the frame
      // injector, applyDomLayerMask, removeDomLayerMask, and GSAP re-seek.
      //
      // The mask:
      //   - mass-hides every body descendant via stylesheet
      //   - re-shows the layer's elements (and their descendants and
      //     their injected `__render_frame_*` siblings) so deep-nested
      //     content stays visible even though intermediate ancestors
      //     are hidden
      //   - inline-hides every other data-start element so they don't
      //     paint when they happen to be descendants of a layer element
      //     (most importantly: HDR videos and other-layer SDR videos
      //     that live inside `#root` when capturing the root DOM layer)
      //
      // Without the mask, every DOM screenshot captures the full page
      // (root background, sibling scenes' static content, the painted
      // border/box-shadow of cards, etc.) and the resulting opaque
      // pixels overwrite previously composited HDR content beneath.
      const allElementIds = fullStacking.map((e) => e.id);
      const layerIds = new Set(layer.elementIds);
      const hideIds = allElementIds.filter((id) => !layerIds.has(id));
      if (hdrPerf) hdrPerf.domLayerCaptures += 1;

      // 1. Seek GSAP to restore all animated properties from clean state.
      //    This is CDP work that does NOT touch the canvas, so we can
      //    proceed even while a prior layer's decode+blit is in flight on
      //    the pool — the overlap is the whole point of lever-4. Step 6
      //    is where we drain before dispatching this layer's blit.
      let timingStart = Date.now();
      await domSession.page.evaluate((t: number) => {
        if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
      }, time);
      addHdrTiming(hdrPerf, "domLayerSeekMs", timingStart);

      // 2. Run frame injector to set correct SDR video visibility
      if (beforeCaptureHook) {
        timingStart = Date.now();
        await beforeCaptureHook(domSession.page, time);
        addHdrTiming(hdrPerf, "domLayerInjectMs", timingStart);
      }

      // 3. Install the mask (mass-hide stylesheet + inline-hide non-layer ids)
      timingStart = Date.now();
      await applyDomLayerMask(domSession.page, layer.elementIds, hideIds);
      addHdrTiming(hdrPerf, "domMaskApplyMs", timingStart);

      // 4. Screenshot
      timingStart = Date.now();
      const domPng = await captureAlphaPng(domSession.page, width, height);
      addHdrTiming(hdrPerf, "domScreenshotMs", timingStart);

      // 5. Tear down the mask
      timingStart = Date.now();
      await removeDomLayerMask(domSession.page, hideIds);
      addHdrTiming(hdrPerf, "domMaskRemoveMs", timingStart);

      // 6. Drain any prior layer's decode+blit before reading or writing
      //    the canvas. On the pool path the prior layer's blit was
      //    dispatched without an await; this is where its in-flight
      //    promise resolves and `liveCanvas` is reattached. On the inline
      //    path `pendingDecodeBlit` is always null so this is a no-op.
      await drainPending();

      // 7. Decode + blit. Pool path: dispatch and store the promise so
      //    the next iteration's CDP work can overlap. Inline path: do it
      //    synchronously, preserving the legacy code shape.
      if (pool) {
        const inFlightLayerIdx = layerIdx;
        const inFlightLayerIds = layer.elementIds;
        const inFlightHideCount = hideIds.length;
        const beforeForDiag = shouldLog ? countNonZeroRgb48(liveCanvas) : 0;
        const destForPool = liveCanvas;
        pendingDecodeBlit = (async (): Promise<Buffer> => {
          try {
            const result = await pool.run({
              png: domPng,
              dest: destForPool,
              width,
              height,
              transfer: compositeTransfer,
            });
            if (hdrPerf) {
              hdrPerf.timings.domPngDecodeMs += result.decodeMs;
              hdrPerf.timings.domBlitMs += result.blitMs;
            }
            if (shouldLog && debugDumpDir) {
              const after = countNonZeroRgb48(result.dest);
              const dumpName = `frame_${String(debugFrameIndex).padStart(4, "0")}_layer_${String(
                inFlightLayerIdx,
              ).padStart(2, "0")}_dom.png`;
              const dumpPath = join(debugDumpDir, dumpName);
              writeFileSync(dumpPath, domPng);
              log.info("[diag] dom layer blit (pool)", {
                frame: debugFrameIndex,
                layerIdx: inFlightLayerIdx,
                layerIds: inFlightLayerIds,
                hideCount: inFlightHideCount,
                pngBytes: domPng.length,
                pixelsAdded: after - beforeForDiag,
                totalNonZero: after,
                dumpPath,
              });
            }
            return result.dest;
          } catch (err) {
            log.warn("DOM layer decode/blit pool task failed; skipping overlay", {
              layerIds: inFlightLayerIds,
              error: err instanceof Error ? err.message : String(err),
            });
            // The dest ArrayBuffer was transferred out and may be lost.
            // Return a freshly-allocated zero canvas so the next layer
            // has something to write into; the frame may have missing
            // pixels but the render does not abort.
            return Buffer.alloc(width * height * 6);
          }
        })();
      } else {
        try {
          timingStart = Date.now();
          const { data: domRgba } = decodePng(domPng);
          addHdrTiming(hdrPerf, "domPngDecodeMs", timingStart);
          const before = shouldLog ? countNonZeroRgb48(liveCanvas) : 0;
          const alphaPixels = shouldLog ? countNonZeroAlpha(domRgba) : 0;
          timingStart = Date.now();
          blitRgba8OverRgb48le(domRgba, liveCanvas, width, height, compositeTransfer);
          addHdrTiming(hdrPerf, "domBlitMs", timingStart);
          if (shouldLog && debugDumpDir) {
            const after = countNonZeroRgb48(liveCanvas);
            const dumpName = `frame_${String(debugFrameIndex).padStart(4, "0")}_layer_${String(layerIdx).padStart(2, "0")}_dom.png`;
            const dumpPath = join(debugDumpDir, dumpName);
            writeFileSync(dumpPath, domPng);
            log.info("[diag] dom layer blit", {
              frame: debugFrameIndex,
              layerIdx,
              layerIds: layer.elementIds,
              hideCount: hideIds.length,
              pngBytes: domPng.length,
              alphaPixels,
              pixelsAdded: after - before,
              totalNonZero: after,
              dumpPath,
            });
          }
        } catch (err) {
          log.warn("DOM layer decode/blit failed; skipping overlay", {
            layerIds: layer.elementIds,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Drain the last layer's in-flight decode+blit (if any) before returning
  // — otherwise the caller would see a detached canvas.
  await drainPending();

  if (shouldLog && debugDumpDir) {
    const finalNonZero = countNonZeroRgb48(liveCanvas);
    log.info("[diag] compositeToBuffer end", {
      frame: debugFrameIndex,
      finalNonZeroPixels: finalNonZero,
      totalPixels: width * height,
      coverage: ((finalNonZero / (width * height)) * 100).toFixed(1) + "%",
    });
  }

  return liveCanvas;
}

// ── Layered-frame helpers (issue #677 hybrid path) ──────────────────────────
//
// These helpers run a single frame through the layered SDR/HDR compositor and
// emit one rgb48le buffer. They share the same context (`HdrCompositeContext`)
// the legacy sequential loop already used, but accept a session parameter so a
// pool of worker sessions can drive them in parallel for non-transition
// frames. The transition variant is still serialized — dual-scene composites
// re-seek the same DOM session twice and write masked, screenshot-derived
// scenes into per-frame buffers that the shader blend reads back-to-back.
//
// Behavioral parity with the legacy inline loop is essential: per-frame
// timings are recorded into the same `hdrPerf` collector keys so
// `perf-summary.json` rollups stay comparable across the migration. Workers
// share a single collector; the increments are integer arithmetic on hot
// counters and the dispatcher is bounded by Node's main-thread async runtime
// (workers await on Puppeteer, never on each other), so the appends interleave
// safely without locking.
//
// IMPORTANT: each worker passes its own session in via the first argument
// rather than reading from `ctx.domSession`. As of the hf#732 follow-up,
// the transition path also runs on per-worker sessions — the dual-scene
// (seek → mask fromScene → screenshot → mask toScene → screenshot → blend)
// pipeline is self-contained inside a single `processLayeredTransitionFrame`
// call and only requires the same `window.__hf` state across both scenes
// within that call. There's no inter-frame dependency on a specific
// session, so multiple workers can each run the full transition pipeline
// against their own browser concurrently.

interface LayeredTransitionBuffers {
  // Mutable fields: the hf#677 shader-pool path swaps these references
  // after each transferList round-trip with the worker thread. The
  // underlying memory is the same; the Buffer headers are fresh views
  // over the re-attached ArrayBuffers. The legacy synchronous path
  // never reassigns these.
  bufferA: Buffer;
  bufferB: Buffer;
  output: Buffer;
}

/**
 * Composite a single non-transition (normal) layered frame on a given DOM
 * session. Mirrors the legacy inline normal-frame branch — seek, inject,
 * query stacking, then delegate per-layer compositing to
 * `compositeHdrFrame`. The caller owns the `canvas` Buffer and is responsible
 * for zero-fill bookkeeping (the helper does it here so callers don't repeat
 * the same `.fill(0)` shape).
 *
 * @param session - The DOM capture session to drive. Workers in the hybrid
 *                  parallel pool pass their own session; the legacy
 *                  sequential path passes the main `domSession`.
 * @param frameIdx - Frame index in composition timeline. Used for debug dumps
 *                   only — timing math uses `time` derived from fps.
 * @param time - Seek time in seconds for this frame.
 * @param ctx - Long-lived layered-composite context. The helper rebinds
 *              `ctx.domSession` to `session` for the duration of the call
 *              so per-layer DOM screenshots in `compositeHdrFrame` go to the
 *              right session.
 * @param canvas - Pre-allocated rgb48le canvas (width * height * 6 bytes).
 *                 Zero-filled by this helper.
 * @param nativeHdrIds - Set of HDR element ids used by `queryElementStacking`.
 *
 * @returns The (possibly re-attached) canvas buffer. When `ctx.pngDecodeBlitPool`
 *          is set, per-layer DOM decode+blit transfers the canvas ArrayBuffer
 *          across the worker boundary and a fresh Buffer view is returned —
 *          the input `canvas` reference is detached and unusable by the
 *          caller. The legacy inline path returns the same Buffer the caller
 *          passed in.
 */
export async function processLayeredNormalFrame(
  session: CaptureSession,
  frameIdx: number,
  time: number,
  ctx: HdrCompositeContext,
  canvas: Buffer,
  nativeHdrIds: Set<string>,
): Promise<Buffer> {
  const hdrPerf = ctx.hdrPerf;
  if (hdrPerf) hdrPerf.frames += 1;
  if (hdrPerf) hdrPerf.normalFrames += 1;

  let timingStart = Date.now();
  await session.page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
  }, time);
  addHdrTiming(hdrPerf, "frameSeekMs", timingStart);

  if (ctx.beforeCaptureHook) {
    timingStart = Date.now();
    await ctx.beforeCaptureHook(session.page, time);
    addHdrTiming(hdrPerf, "frameInjectMs", timingStart);
  }

  timingStart = Date.now();
  const stackingInfo = await queryElementStacking(session.page, nativeHdrIds);
  addHdrTiming(hdrPerf, "stackingQueryMs", timingStart);

  timingStart = Date.now();
  canvas.fill(0);
  addHdrTiming(hdrPerf, "canvasClearMs", timingStart);

  // Rebind the context to this worker's session for the per-layer DOM
  // screenshot work inside compositeHdrFrame. The legacy path passed
  // `domSession` via the closure-captured ctx; for the worker pool we need
  // each worker's session to drive its own captures.
  const sessionScopedCtx: HdrCompositeContext = { ...ctx, domSession: session };
  timingStart = Date.now();
  const finalCanvas = await compositeHdrFrame(
    sessionScopedCtx,
    canvas,
    time,
    stackingInfo,
    undefined,
    frameIdx,
  );
  addHdrTiming(hdrPerf, "normalCompositeMs", timingStart);
  return finalCanvas;
}

/**
 * Metadata describing a captured-but-not-yet-blended transition frame. Used
 * to hand a unit of blend work off from the DOM-capture phase to the
 * `worker_threads` pool. Carries `frameIdx` so the reorder buffer at the
 * encoder gate can fence ordering, and `shader`/`progress` so the blend
 * dispatch is fully self-contained (the pool need not understand transition
 * windows).
 */
export interface CapturedTransitionFrame {
  frameIdx: number;
  /** Width in pixels (854 etc.). Matches `ctx.width`. */
  width: number;
  /** Height in pixels (480 etc.). Matches `ctx.height`. */
  height: number;
  /** Transition progress in [0, 1]. */
  progress: number;
  /** Shader id from the transition metadata; unknowns fall back to crossfade. */
  shader: string;
  /** Filled by the capture: from-scene rgb48le pixels. */
  buffers: LayeredTransitionBuffers;
}

/**
 * Capture both scenes of a transition frame into `buffers.bufferA` and
 * `buffers.bufferB`. Does NOT run the shader blend — the caller dispatches
 * that synchronously (HDR / single-worker fallback) or via the
 * `worker_threads` pool (hybrid path, hf#732 follow-up to close the JS
 * event-loop ceiling).
 *
 * Splitting capture from blend is the linchpin of the new dispatcher
 * contract: each DOM worker can capture its next frame while the previous
 * frame's blend runs on a worker thread, so the pool sees up to
 * `N_dom × K` concurrent tasks instead of a single in-flight blend per DOM
 * worker. K is bounded by a small per-worker buffer-triple ring (default 2)
 * to cap memory; the encoder reorder buffer fences ordering downstream so
 * out-of-order blend completions still hit the muxer in ascending index
 * order.
 *
 * Self-contained per call: the per-scene seek/inject/mask/screenshot/remove-
 * mask pattern requires the same `window.__hf` state across both scenes
 * within ONE invocation, but holds no inter-frame state on the session.
 *
 * @param session - DOM capture session to drive. The hybrid path passes the
 *                  worker's own session; the legacy sequential / HDR fallback
 *                  passes the main `domSession`.
 * @param frameIdx - Composition frame index (used for warn-level error logs
 *                   and the returned metadata).
 * @param time - Seek time in seconds.
 * @param transition - The transition window that contains this frame.
 * @param ctx - Layered-composite context (HDR layer maps, transfer, etc.).
 * @param sceneElements - Scene-id → element-id list.
 * @param buffers - Pre-allocated dual-scene buffers + output buffer. bufferA
 *                  and bufferB are zero-filled before each scene composite;
 *                  `output` is untouched here (filled by the blend step).
 * @param assertNotAborted - Render-level abort check between scenes.
 * @param nativeHdrIds - Set of HDR element ids.
 *
 * @returns Captured-frame descriptor the caller passes to the blend step.
 */
export async function captureTransitionFrame(
  session: CaptureSession,
  frameIdx: number,
  time: number,
  transition: TransitionRange,
  ctx: HdrCompositeContext,
  sceneElements: Record<string, string[]>,
  buffers: LayeredTransitionBuffers,
  assertNotAborted: () => void,
  nativeHdrIds: Set<string>,
): Promise<CapturedTransitionFrame> {
  const {
    log,
    beforeCaptureHook,
    width,
    height,
    fps,
    compositeTransfer,
    nativeHdrImageIds,
    hdrImageBuffers,
    hdrImageTransferCache,
    hdrVideoFrameSources,
    hdrVideoStartTimes,
    imageTransfers,
    videoTransfers,
    hdrPerf,
  } = ctx;
  const hdrTargetTransfer = compositeTransfer === "srgb" ? undefined : compositeTransfer;

  if (hdrPerf) hdrPerf.frames += 1;
  if (hdrPerf) hdrPerf.transitionFrames += 1;
  const transitionCaptureStart = Date.now();

  let timingStart = Date.now();
  await session.page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
  }, time);
  addHdrTiming(hdrPerf, "frameSeekMs", timingStart);

  if (beforeCaptureHook) {
    timingStart = Date.now();
    await beforeCaptureHook(session.page, time);
    addHdrTiming(hdrPerf, "frameInjectMs", timingStart);
  }

  timingStart = Date.now();
  const stackingInfo = await queryElementStacking(session.page, nativeHdrIds);
  addHdrTiming(hdrPerf, "stackingQueryMs", timingStart);

  const progress =
    transition.endFrame === transition.startFrame
      ? 1
      : (frameIdx - transition.startFrame) / (transition.endFrame - transition.startFrame);

  const sceneAIds = new Set(sceneElements[transition.fromScene] ?? []);
  const sceneBIds = new Set(sceneElements[transition.toScene] ?? []);

  timingStart = Date.now();
  buffers.bufferA.fill(0);
  buffers.bufferB.fill(0);
  addHdrTiming(hdrPerf, "canvasClearMs", timingStart);

  // hf#732 lever-4: pipeline the two scenes' decode+blit work against each
  // other (and against the next CDP screenshot). The per-scene loop body
  // captures its DOM PNG and either dispatches decode+blit to the
  // `pngDecodeBlitPool` (non-blocking, returns a Promise that re-attaches
  // the scene buffer) or falls back to inline decode+blit on the calling
  // thread (legacy path, no pool). Both scenes' promises are awaited at
  // the end of the function so the captured frame's buffers are guaranteed
  // ready before the caller dispatches the shader blend.
  //
  // The HDR layer blits stay synchronous on the calling thread — they're
  // already cheap relative to the DOM-screenshot path and they need to
  // complete before the buffer is transferred into the worker pool (the
  // pool's blit composites the DOM RGBA over whatever pixels are already
  // in the rgb48le buffer).
  const pool = ctx.pngDecodeBlitPool ?? null;
  type ScenePending = { promise: Promise<Buffer>; sceneIdsList: string[] };
  const scenePromises: ScenePending[] = [];

  const isSceneA: ReadonlyArray<readonly [Buffer, Set<string>, "A" | "B"]> = [
    [buffers.bufferA, sceneAIds, "A"],
    [buffers.bufferB, sceneBIds, "B"],
  ];

  for (const [sceneBuf, sceneIds, sceneTag] of isSceneA) {
    assertNotAborted();
    timingStart = Date.now();
    await session.page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
    }, time);
    addHdrTiming(hdrPerf, "domLayerSeekMs", timingStart);
    if (beforeCaptureHook) {
      timingStart = Date.now();
      await beforeCaptureHook(session.page, time);
      addHdrTiming(hdrPerf, "domLayerInjectMs", timingStart);
    }

    for (const el of stackingInfo) {
      if (!el.isHdr || !sceneIds.has(el.id)) continue;
      if (nativeHdrImageIds.has(el.id)) {
        blitHdrImageLayer(
          sceneBuf,
          el,
          hdrImageBuffers,
          hdrImageTransferCache,
          width,
          height,
          log,
          imageTransfers.get(el.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      } else {
        blitHdrVideoLayer(
          sceneBuf,
          el,
          time,
          fps,
          hdrVideoFrameSources,
          hdrVideoStartTimes,
          width,
          height,
          log,
          videoTransfers.get(el.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      }
    }

    const showIds = Array.from(sceneIds);
    const hideIds = stackingInfo
      .map((e) => e.id)
      .filter((id) => !sceneIds.has(id) || nativeHdrIds.has(id));
    if (hdrPerf) hdrPerf.domLayerCaptures += 1;
    timingStart = Date.now();
    await applyDomLayerMask(session.page, showIds, hideIds);
    addHdrTiming(hdrPerf, "domMaskApplyMs", timingStart);
    timingStart = Date.now();
    const domPng = await captureAlphaPng(session.page, width, height);
    addHdrTiming(hdrPerf, "domScreenshotMs", timingStart);
    timingStart = Date.now();
    await removeDomLayerMask(session.page, hideIds);
    addHdrTiming(hdrPerf, "domMaskRemoveMs", timingStart);

    const sceneIdsList = Array.from(sceneIds);
    if (pool) {
      // Pool path: kick off decode + blit asynchronously and store the
      // promise. The ArrayBuffer of `sceneBuf` is detached on dispatch —
      // we cannot touch it again until the promise resolves. The two
      // scenes use disjoint buffers (A and B), so dispatching scene A's
      // decode/blit while moving on to scene B's CDP work is safe.
      const dispatch: Promise<Buffer> = (async () => {
        try {
          const result = await pool.run({
            png: domPng,
            dest: sceneBuf,
            width,
            height,
            transfer: compositeTransfer,
          });
          if (hdrPerf) {
            // Per-worker timings reported back from the pool reflect actual
            // CPU time on the worker thread; rolling them into the same
            // hdrPerf counters keeps perf-summary.json comparable to the
            // inline path. The wall-clock cost on the orchestrator thread
            // is effectively zero (postMessage round-trip).
            hdrPerf.timings.domPngDecodeMs += result.decodeMs;
            hdrPerf.timings.domBlitMs += result.blitMs;
          }
          return result.dest;
        } catch (err) {
          log.warn(
            "DOM layer decode/blit pool task failed; falling back to inline for transition scene",
            {
              frameIndex: frameIdx,
              scene: sceneTag,
              sceneIds: sceneIdsList,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          // Best-effort: if the pool task rejected, the underlying
          // ArrayBuffer may have been detached on the way out. We can't
          // safely recover the scene buffer at this point — return a
          // freshly-allocated zero buffer so the shader blend has
          // something well-formed to read. The frame may show the wrong
          // pixels but the render does not abort.
          return Buffer.alloc(width * height * 6);
        }
      })();
      scenePromises.push({ promise: dispatch, sceneIdsList });
    } else {
      // Inline path (no pool): same code shape as the pre-#732-lever-4
      // implementation. Preserves byte-equivalence and serves as the
      // fallback when the pool can't be spawned.
      try {
        timingStart = Date.now();
        const { data: domRgba } = decodePng(domPng);
        addHdrTiming(hdrPerf, "domPngDecodeMs", timingStart);
        timingStart = Date.now();
        blitRgba8OverRgb48le(domRgba, sceneBuf, width, height, compositeTransfer);
        addHdrTiming(hdrPerf, "domBlitMs", timingStart);
      } catch (err) {
        log.warn("DOM layer decode/blit failed; skipping overlay for transition scene", {
          frameIndex: frameIdx,
          scene: sceneTag,
          sceneIds: sceneIdsList,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      scenePromises.push({ promise: Promise.resolve(sceneBuf), sceneIdsList });
    }
  }

  // Await both scene decode+blit promises before returning. On the inline
  // path these are no-ops; on the pool path this is where the second
  // scene's CDP-overlapped decode/blit drains. Re-assign buffers so the
  // returned `CapturedTransitionFrame` references the re-attached views.
  const [bufA, bufB] = await Promise.all([
    scenePromises[0]?.promise ?? Promise.resolve(buffers.bufferA),
    scenePromises[1]?.promise ?? Promise.resolve(buffers.bufferB),
  ]);
  buffers.bufferA = bufA;
  buffers.bufferB = bufB;

  // `transitionCaptureMs` is the dual-scene capture cost only — the blend is
  // accounted for separately in `transitionShaderBlendMs`. Their sum is no
  // longer equal to `transitionCompositeMs` (which now covers capture only
  // along this path); perf-summary.json viewers should treat capture + blend
  // as the per-frame composite cost in the decoupled pipeline.
  addHdrTiming(hdrPerf, "transitionCompositeMs", transitionCaptureStart);

  return {
    frameIdx,
    width,
    height,
    progress,
    shader: transition.shader,
    buffers,
  };
}

/**
 * Synchronous inline blend, identical to the pool's per-worker behavior but
 * running on the calling thread. Used by:
 *
 * - the legacy sequential / HDR fallback path (no pool spawned)
 * - the hybrid path if the pool spawn fails at render start
 * - the hybrid path if a pool task rejects mid-render (best-effort
 *   correctness preservation; the render falls back to inline blending for
 *   that frame rather than aborting)
 *
 * Mutates `buffers.output` in place. `buffers.bufferA` and `buffers.bufferB`
 * are read-only inputs.
 */
function blendTransitionFrameInline(
  captured: CapturedTransitionFrame,
  hdrPerf: HdrPerfCollector | undefined,
): void {
  const { buffers, width, height, progress, shader } = captured;
  const blendStart = Date.now();
  const transitionFn: TransitionFn = TRANSITIONS[shader] ?? crossfade;
  transitionFn(buffers.bufferA, buffers.bufferB, buffers.output, width, height, progress);
  addHdrTiming(hdrPerf, "transitionShaderBlendMs", blendStart);
}

/**
 * Composite a single transition frame on a given DOM session — combined
 * capture + blend. Retained for the legacy sequential path / HDR fallback /
 * single-worker SDR, which call this directly and write `buffers.output` to
 * the encoder synchronously after the function resolves.
 *
 * The hybrid parallel path does NOT call this helper. It calls
 * `captureTransitionFrame` and dispatches the blend asynchronously to the
 * `worker_threads` pool, so capture pipelines with blend across frames.
 *
 * Self-contained per call: the per-scene seek/inject/mask/screenshot/remove-
 * mask pattern requires the same `window.__hf` state across the two scenes
 * within one invocation, but it holds no inter-frame state on the session.
 *
 * @param session - DOM capture session to drive.
 * @param frameIdx - Composition frame index.
 * @param time - Seek time in seconds.
 * @param transition - The transition window that contains this frame.
 * @param ctx - Layered-composite context.
 * @param sceneElements - Scene-id → element-id list.
 * @param buffers - Pre-allocated dual-scene buffers + output buffer.
 * @param assertNotAborted - Render-level abort check between scenes.
 * @param nativeHdrIds - Set of HDR element ids.
 */
export async function processLayeredTransitionFrame(
  session: CaptureSession,
  frameIdx: number,
  time: number,
  transition: TransitionRange,
  ctx: HdrCompositeContext,
  sceneElements: Record<string, string[]>,
  buffers: LayeredTransitionBuffers,
  assertNotAborted: () => void,
  nativeHdrIds: Set<string>,
): Promise<void> {
  const captured = await captureTransitionFrame(
    session,
    frameIdx,
    time,
    transition,
    ctx,
    sceneElements,
    buffers,
    assertNotAborted,
    nativeHdrIds,
  );
  blendTransitionFrameInline(captured, ctx.hdrPerf);
}

/**
 * Decide whether the hybrid parallel layered path is safe to use for a given
 * render. Returns `false` (i.e. fall back to the legacy sequential loop) for:
 *
 * - HDR content (HDR video raw-frame sources are file-descriptor-bound to a
 *   single worker — sharing would require per-worker `dup(fd)` and
 *   worker-local scratch buffers, out of scope for the #677 fix).
 * - Compositions where every frame falls inside a transition window
 *   (parallel workers would have nothing to do; legacy loop is fine).
 * - Worker budgets at or below 1 — the legacy loop is already optimal for
 *   single-worker SDR.
 *
 * Surfaced as a top-level helper so the call site can log the gating
 * decision next to the worker-count choice, and so tests can assert the
 * exact predicate without spinning up a real render.
 */
/**
 * Distribute the contiguous frame range [0, totalFrames) across
 * `workerCount` workers as roughly equal contiguous slices. Each worker's
 * slice carries whatever mix of normal and transition frames falls inside
 * it — the hybrid path runs both types of compositing on per-worker
 * sessions, so the partition does not split on transition-frame boundaries.
 *
 * Exported so the unit test can pin the partitioning contract (e.g.
 * "transition frames at indices 60-69 are NOT all assigned to worker 0,
 * because contiguous chunking spreads them across whichever workers' slices
 * cover that index range").
 *
 * Returns ranges with the invariant: ranges are non-overlapping, contiguous,
 * cover exactly [0, totalFrames), and any worker beyond `totalFrames /
 * framesPerWorker` gets a zero-width range. `workerCount` is clamped to 1
 * for non-positive inputs.
 */
export function distributeLayeredHybridFrameRanges(
  totalFrames: number,
  workerCount: number,
): Array<{ start: number; end: number }> {
  const safeWorkers = Math.max(1, workerCount);
  const safeFrames = Math.max(0, totalFrames);
  const framesPerWorker = Math.max(1, Math.ceil(safeFrames / safeWorkers));
  const ranges: Array<{ start: number; end: number }> = [];
  for (let w = 0; w < safeWorkers; w++) {
    const start = Math.min(safeFrames, w * framesPerWorker);
    const end = Math.min(safeFrames, start + framesPerWorker);
    ranges.push({ start, end });
  }
  return ranges;
}

export function shouldUseHybridLayeredPath(args: {
  hasHdrContent: boolean;
  transitionFramesCount: number;
  totalFrames: number;
  workerCount: number;
}): boolean {
  if (args.hasHdrContent) return false;
  if (args.workerCount <= 1) return false;
  if (args.totalFrames <= 0) return false;
  if (args.transitionFramesCount >= args.totalFrames) return false;
  return true;
}

export function createRenderJob(config: RenderConfig): RenderJob {
  return {
    id: randomUUID(),
    config,
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    createdAt: new Date(),
  };
}

function normalizeCompositionSrcPath(srcPath: string): string {
  return srcPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function createStandaloneEntryRenderClone(root: Element, host: Element): Element {
  const hostClone = host.cloneNode(true) as Element;
  hostClone.setAttribute("data-start", "0");

  if (root === host) return hostClone;

  const rootClone = root.cloneNode(false) as Element;
  rootClone.appendChild(hostClone);
  return rootClone;
}

function replaceBodyWithRenderClone(body: HTMLElement, renderClone: Element): void {
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }
  body.appendChild(renderClone);
}

export function shouldUseStreamingEncode(
  cfg: Pick<EngineConfig, "enableStreamingEncode" | "streamingEncodeMaxDurationSeconds">,
  outputFormat: NonNullable<RenderConfig["format"]>,
  workerCount: number,
  // Composition timeline duration in seconds.
  durationSeconds: number,
): boolean {
  if (!cfg.enableStreamingEncode) return false;
  if (outputFormat === "png-sequence") return false;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (durationSeconds > cfg.streamingEncodeMaxDurationSeconds) return false;
  return workerCount === 1;
}

/**
 * Main render pipeline
 */

export function extractStandaloneEntryFromIndex(
  indexHtml: string,
  entryFile: string,
): string | null {
  const normalizedEntryFile = normalizeCompositionSrcPath(entryFile);
  const { document } = parseHTML(indexHtml);
  const body = document.querySelector("body");
  if (!body) return null;

  const hosts = Array.from(document.querySelectorAll("[data-composition-src]")) as Element[];
  const host = hosts.find(
    (candidate) =>
      normalizeCompositionSrcPath(candidate.getAttribute("data-composition-src") || "") ===
      normalizedEntryFile,
  );
  if (!host) return null;

  const root =
    (Array.from(body.children) as Element[]).find((candidate) =>
      candidate.hasAttribute("data-composition-id"),
    ) ?? null;
  if (!root) return null;

  const renderClone = createStandaloneEntryRenderClone(root, host);
  replaceBodyWithRenderClone(body, renderClone);

  return document.toString();
}

export async function executeRenderJob(
  job: RenderJob,
  projectDir: string,
  outputPath: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const producerRoot = process.env.PRODUCER_RENDERS_DIR
    ? resolve(process.env.PRODUCER_RENDERS_DIR, "..")
    : resolve(moduleDir, "../..");
  const debugDir = join(producerRoot, ".debug");
  const workDir = job.config.debug
    ? join(debugDir, job.id)
    : join(dirname(outputPath), `work-${job.id}`);
  const pipelineStart = Date.now();
  const log = job.config.logger ?? defaultLogger;
  let fileServer: FileServerHandle | null = null;
  let probeSession: CaptureSession | null = null;
  let lastBrowserConsole: string[] = [];
  let restoreLogger: (() => void) | null = null;
  const perfStages: Record<string, number> = {};
  const hdrDiagnostics: HdrDiagnostics = {
    videoExtractionFailures: 0,
    imageDecodeFailures: 0,
  };
  let hdrPerf: HdrPerfCollector | undefined;
  const perfOutputPath = join(workDir, "perf-summary.json");
  const cfg = { ...(job.config.producerConfig ?? resolveConfig()) };
  const outputFormat = (job.config.format ?? "mp4") as NonNullable<RenderConfig["format"]>;
  const isWebm = outputFormat === "webm";
  const isMov = outputFormat === "mov";
  const isPngSequence = outputFormat === "png-sequence";
  const needsAlpha = isWebm || isMov || isPngSequence;
  // Transparency requires screenshot mode — beginFrame doesn't support alpha channel
  if (needsAlpha) {
    cfg.forceScreenshot = true;
  }
  const enableChunkedEncode = cfg.enableChunkedEncode;
  const chunkedEncodeSize = cfg.chunkSizeFrames;
  // Periodic memory sampler — surfaces peak RSS/heap so the benchmark harness
  // can detect memory regressions (e.g. unbounded image-cache growth) that
  // wall-clock numbers miss. Sampled every 250ms; the interval is `unref`'d so
  // it never keeps the event loop alive on its own, and always cleared in the
  // finally block below regardless of how the render exits.
  let peakRssBytes = 0;
  let peakHeapUsedBytes = 0;
  const sampleMemory = (): void => {
    try {
      const m = process.memoryUsage();
      if (m.rss > peakRssBytes) peakRssBytes = m.rss;
      if (m.heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = m.heapUsed;
    } catch {
      // Defensive: process.memoryUsage() shouldn't throw, but if it ever
      // does we don't want to take down the render for a benchmark accessory.
    }
  };
  sampleMemory();
  const memSamplerInterval: NodeJS.Timeout = setInterval(sampleMemory, 250);
  memSamplerInterval.unref?.();

  try {
    const assertNotAborted = () => {
      if (abortSignal?.aborted) {
        throw new RenderCancelledError("render_cancelled");
      }
    };

    job.startedAt = new Date();
    assertNotAborted();
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    if (job.config.debug) {
      const logPath = join(workDir, "render.log");
      restoreLogger = installDebugLogger(logPath, log);
    }

    const entryFile = job.config.entryFile || "index.html";
    let htmlPath = join(projectDir, entryFile);
    if (!existsSync(htmlPath)) {
      throw new Error(`Entry file not found: ${htmlPath}`);
    }
    assertNotAborted();

    // If entryFile is a sub-composition (<template> wrapper), reuse the real
    // index.html shell and isolate the matching host instead of fabricating
    // a new standalone document.
    const rawEntry = readFileSync(htmlPath, "utf-8");
    if (entryFile !== "index.html" && rawEntry.trimStart().startsWith("<template")) {
      const wrapperPath = join(workDir, "standalone-entry.html");
      const projectIndexPath = join(projectDir, "index.html");
      if (!existsSync(projectIndexPath)) {
        throw new Error(
          `Template entry file "${entryFile}" requires a project index.html to extract its render shell.`,
        );
      }
      const standaloneHtml = extractStandaloneEntryFromIndex(
        readFileSync(projectIndexPath, "utf-8"),
        entryFile,
      );
      if (!standaloneHtml) {
        throw new Error(
          `Entry file "${entryFile}" is not mounted from index.html via data-composition-src, so it cannot be rendered independently.`,
        );
      }
      writeFileSync(wrapperPath, standaloneHtml, "utf-8");
      htmlPath = wrapperPath;
      log.info("Extracted standalone entry from index.html host context", {
        entryFile,
      });
    }

    // ── Stage 1: Compile ─────────────────────────────────────────────────
    const stage1Start = Date.now();
    updateJobStatus(job, "preprocessing", "Compiling composition", 5, onProgress);

    const compileResult = await runCompileStage({
      projectDir,
      workDir,
      htmlPath,
      entryFile,
      job,
      cfg,
      needsAlpha,
      log,
      assertNotAborted,
    });
    let compiled = compileResult.compiled;
    const composition = compileResult.composition;
    const { deviceScaleFactor, outputWidth, outputHeight } = compileResult;
    const { width, height } = composition;
    perfStages.compileOnlyMs = compileResult.compileOnlyMs;

    const probeResult = await runProbeStage({
      projectDir,
      workDir,
      job,
      cfg,
      log,
      assertNotAborted,
      compiled,
      composition,
      width,
      height,
      needsAlpha,
      deviceScaleFactor,
    });
    compiled = probeResult.compiled;
    fileServer = probeResult.fileServer;
    probeSession = probeResult.probeSession;
    lastBrowserConsole = probeResult.lastBrowserConsole;
    // The probe stage produces `duration` / `totalFrames` values; the
    // sequencer owns the `RenderJob` and writes them onto it.
    job.duration = probeResult.duration;
    job.totalFrames = probeResult.totalFrames;
    const totalFrames = probeResult.totalFrames;
    perfStages.browserProbeMs = probeResult.browserProbeMs;
    perfStages.compileMs = Date.now() - stage1Start;

    // ── Stage 2: Video frame extraction ─────────────────────────────────
    const stage2Start = Date.now();
    updateJobStatus(job, "preprocessing", "Extracting video frames", 10, onProgress);

    let frameLookup: FrameLookupTable | null = null;
    const compiledDir = join(workDir, "compiled");
    let extractionResult: Awaited<ReturnType<typeof extractAllVideoFrames>> | null = null;
    let videoReadinessSkipIds: string[] = [];
    let videoMetadataHints: CaptureVideoMetadataHint[] = [];

    // Probe ORIGINAL color spaces before extraction (which may convert SDR→HDR).
    // This is needed to identify which videos are natively HDR vs converted-SDR
    // for the two-pass compositing path. Skipped only in force-sdr mode to
    // avoid ffprobe overhead when the user has explicitly opted out.
    const nativeHdrVideoIds = new Set<string>();
    const videoTransfers = new Map<string, HdrTransfer>();
    if (job.config.hdrMode !== "force-sdr" && composition.videos.length > 0) {
      await Promise.all(
        composition.videos.map(async (v) => {
          // Use the shared resolver so a `<video src="../assets/foo">` in a
          // sub-composition resolves the same way the browser would (see
          // resolveProjectRelativeSrc in videoFrameExtractor for the full
          // explanation). isAbsolute (not `startsWith("/")`) so Windows
          // absolute paths like `C:\...` skip the join correctly.
          const videoPath = isAbsolute(v.src)
            ? v.src
            : resolveProjectRelativeSrc(v.src, projectDir, compiledDir);
          if (!existsSync(videoPath)) return;
          const meta = await extractMediaMetadata(videoPath);
          if (isHdrColorSpace(meta.colorSpace)) {
            nativeHdrVideoIds.add(v.id);
            videoTransfers.set(v.id, detectTransfer(meta.colorSpace));
          }
        }),
      );
    }

    // Probe images for HDR color spaces (16-bit PNGs tagged BT.2020 PQ/HLG).
    // Mirrors the video probe loop above so image-only compositions can
    // trigger HDR output without any video sources present. Skipped only in
    // force-sdr mode to avoid ffprobe overhead when the user has explicitly
    // opted out.
    const nativeHdrImageIds = new Set<string>();
    const imageTransfers = new Map<string, HdrTransfer>();
    const hdrImageSrcPaths = new Map<string, string>();
    const imageColorSpaces: (VideoColorSpace | null)[] = [];
    if (job.config.hdrMode !== "force-sdr" && composition.images.length > 0) {
      const probed = await Promise.all(
        composition.images.map(async (img) => {
          let imgPath = img.src;
          if (!imgPath.startsWith("/")) {
            const fromCompiled = existsSync(join(compiledDir, imgPath))
              ? join(compiledDir, imgPath)
              : join(projectDir, imgPath);
            imgPath = fromCompiled;
          }
          if (!existsSync(imgPath)) return null;
          const meta = await extractMediaMetadata(imgPath);
          if (isHdrColorSpace(meta.colorSpace)) {
            nativeHdrImageIds.add(img.id);
            imageTransfers.set(img.id, detectTransfer(meta.colorSpace));
            hdrImageSrcPaths.set(img.id, imgPath);
          }
          return meta.colorSpace;
        }),
      );
      imageColorSpaces.push(...probed);
    }

    if (composition.videos.length > 0) {
      extractionResult = await extractAllVideoFrames(
        composition.videos,
        projectDir,
        // extractAllVideoFrames takes fps as a number (decimal). Frames sampled
        // from a video at 29.97 vs 30 differ by ~1 frame in 1000 — not enough
        // to break visual parity, and the encoder-side rational keeps the
        // output framerate exact.
        {
          fps: fpsToNumber(job.config.fps),
          outputDir: join(compiledDir, "__hyperframes_video_frames"),
        },
        abortSignal,
        { extractCacheDir: cfg.extractCacheDir },
        compiledDir,
      );
      assertNotAborted();

      materializeExtractedFramesForCompiledDir(extractionResult.extracted, compiledDir);

      if (extractionResult.extracted.length > 0) {
        frameLookup = createFrameLookupTable(composition.videos, extractionResult.extracted);
      }
      videoReadinessSkipIds = collectVideoReadinessSkipIds(
        nativeHdrVideoIds,
        extractionResult.extracted,
      );
      videoMetadataHints = collectVideoMetadataHints(extractionResult.extracted);
      perfStages.videoExtractMs = Date.now() - stage2Start;

      // Auto-detect audio from video files via ffprobe metadata
      const existingAudioSrcs = new Set(composition.audios.map((a) => a.src));
      for (const ext of extractionResult.extracted) {
        if (ext.metadata.hasAudio) {
          const video = composition.videos.find((v) => v.id === ext.videoId);
          if (video && !existingAudioSrcs.has(video.src)) {
            composition.audios.push({
              id: `${video.id}-audio`,
              src: video.src,
              start: video.start,
              end: video.end,
              mediaStart: video.mediaStart,
              layer: 0,
              volume: 1.0,
              type: "video",
            });
            existingAudioSrcs.add(video.src);
          }
        }
      }
    } else {
      perfStages.videoExtractMs = Date.now() - stage2Start;
    }

    // ── HDR auto-detection ──────────────────────────────────────────────
    // Analyze probed video AND image color spaces. In auto mode, any HDR
    // source enables HDR output. force-hdr always enables HDR, and force-sdr
    // always disables it. Image-only compositions can trigger HDR output
    // without any video.
    let effectiveHdr: { transfer: HdrTransfer } | undefined;
    let forcedHdrWithoutSources = false;
    {
      const hdrMode = job.config.hdrMode ?? "auto";
      const videoColorSpaces = (extractionResult?.extracted ?? []).map(
        (ext) => ext.metadata.colorSpace,
      );
      const allColorSpaces = [...videoColorSpaces, ...imageColorSpaces];
      const info = allColorSpaces.length > 0 ? analyzeCompositionHdr(allColorSpaces) : null;

      if (hdrMode === "force-sdr") {
        effectiveHdr = undefined;
      } else if (hdrMode === "force-hdr") {
        if (info?.hasHdr && info.dominantTransfer) {
          effectiveHdr = { transfer: info.dominantTransfer };
        } else {
          effectiveHdr = { transfer: "hlg" };
          forcedHdrWithoutSources = true;
        }
      } else {
        if (info?.hasHdr && info.dominantTransfer) {
          effectiveHdr = { transfer: info.dominantTransfer };
        }
      }
    }
    if (effectiveHdr && outputFormat !== "mp4") {
      const hdrSourceReason = forcedHdrWithoutSources
        ? "HDR was forced without detected HDR sources"
        : "HDR source detected";
      log.warn(
        `[Render] ${hdrSourceReason}, but format is "${outputFormat}" — falling back to SDR. ` +
          `HDR + alpha is not supported. Use --format mp4 for HDR10 output.`,
      );
      effectiveHdr = undefined;
    }
    {
      const hdrMode = job.config.hdrMode ?? "auto";
      if (forcedHdrWithoutSources) {
        log.warn(
          "[Render] HDR forced by --hdr flag, but no HDR sources were detected — defaulting to HLG. SDR-only compositions may look perceptually wrong on HDR displays.",
        );
      }
      if (effectiveHdr) {
        const reason =
          hdrMode === "force-hdr"
            ? forcedHdrWithoutSources
              ? "forced by --hdr flag (no HDR sources detected — defaulting to HLG)"
              : "forced by --hdr flag"
            : "auto-detected from source(s)";
        log.info(
          `[Render] HDR ${reason} — output: ${effectiveHdr.transfer.toUpperCase()} (BT.2020, 10-bit H.265)`,
        );
      } else if (hdrMode === "force-sdr") {
        log.info("[Render] SDR forced by --sdr flag");
      } else {
        log.info("[Render] No HDR sources detected — rendering SDR");
      }
    }

    // ── Stage 3: Audio processing ───────────────────────────────────────
    const stage3Start = Date.now();
    updateJobStatus(job, "preprocessing", "Processing audio tracks", 20, onProgress);

    const audioOutputPath = join(workDir, "audio.aac");
    let hasAudio = false;

    if (composition.audios.length > 0) {
      const audioResult = await processCompositionAudio(
        composition.audios,
        projectDir,
        join(workDir, "audio-work"),
        audioOutputPath,
        job.duration,
        abortSignal,
        undefined,
        compiledDir,
      );
      assertNotAborted();

      hasAudio = audioResult.success;
      perfStages.audioProcessMs = Date.now() - stage3Start;
    } else {
      perfStages.audioProcessMs = Date.now() - stage3Start;
    }

    // ── Stage 4: Frame capture ──────────────────────────────────────────
    const stage4Start = Date.now();
    updateJobStatus(job, "rendering", "Starting frame capture", 25, onProgress);

    // Start file server (may already be running from duration discovery)
    if (!fileServer) {
      fileServer = await createFileServer({
        projectDir,
        compiledDir: join(workDir, "compiled"),
        port: 0,
        preHeadScripts: [VIRTUAL_TIME_SHIM],
      });
      assertNotAborted();
    }

    const framesDir = join(workDir, "captured-frames");
    if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

    const captureOptions: CaptureOptions = {
      width,
      height,
      fps: job.config.fps,
      format: needsAlpha ? "png" : "jpeg",
      quality: needsAlpha ? undefined : job.config.quality === "draft" ? 80 : 95,
      variables: job.config.variables,
      deviceScaleFactor,
    };

    // Capture sessions do not need native browser metadata for videos whose
    // pixels come from out-of-band FFmpeg frame extraction. Waiting on those
    // `<video>` elements lets browser decode/cache quirks block renders even
    // though the browser never supplies their pixels. We still pass FFmpeg
    // dimensions as metadata hints so CSS layouts that depend on intrinsic
    // aspect ratio stay stable before the first injected frame. Native HDR
    // videos are included for the same reason: Chrome may not decode them at
    // all, while the renderer composites their extracted frames separately.
    const buildCaptureOptions = (): CaptureOptions => ({
      ...captureOptions,
      videoMetadataHints,
      skipReadinessVideoIds: videoReadinessSkipIds,
    });
    const frameSrcResolver = createCompiledFrameSrcResolver(compiledDir);
    const createRenderVideoFrameInjector = (): BeforeCaptureHook | null =>
      createVideoFrameInjector(frameLookup, {
        frameDataUriCacheLimit: cfg.frameDataUriCacheLimit,
        frameDataUriCacheBytesLimitMb: cfg.frameDataUriCacheBytesLimitMb,
        frameSrcResolver,
      });

    let captureCalibration:
      | {
          estimate: CaptureCostEstimate;
          samples: CaptureCalibrationSample[];
        }
      | undefined;

    if (job.config.workers === undefined && totalFrames >= 60) {
      const calibrationDir = join(workDir, "capture-calibration");
      const calibrationCfg = createCaptureCalibrationConfig(cfg);
      const videoInjector = createRenderVideoFrameInjector();
      let calibrationSession: CaptureSession | null = null;
      try {
        calibrationSession = await createCaptureSession(
          fileServer.url,
          calibrationDir,
          buildCaptureOptions(),
          videoInjector,
          calibrationCfg,
        );
        if (!calibrationSession.isInitialized) {
          await initializeSession(calibrationSession);
        }
        assertNotAborted();

        captureCalibration = await measureCaptureCostFromSession(
          calibrationSession,
          totalFrames,
          fpsToNumber(job.config.fps),
        );
        logCaptureCalibrationResult(captureCalibration, log);
      } catch (error) {
        const shouldFallbackToScreenshot =
          !cfg.forceScreenshot && shouldFallbackToScreenshotAfterCalibrationError(error);
        if (shouldFallbackToScreenshot) {
          cfg.forceScreenshot = true;
          if (probeSession) {
            lastBrowserConsole = probeSession.browserConsoleBuffer;
            await closeCaptureSession(probeSession).catch(() => {});
            probeSession = null;
          }
          if (calibrationSession) {
            lastBrowserConsole = calibrationSession.browserConsoleBuffer;
            await closeCaptureSession(calibrationSession).catch(() => {});
            calibrationSession = null;
          }

          log.warn(
            "[Render] BeginFrame auto-worker calibration timed out; retrying calibration in screenshot capture mode.",
            {
              protocolTimeout: calibrationCfg.protocolTimeout,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          const screenshotCalibrationCfg = createCaptureCalibrationConfig(cfg);
          try {
            calibrationSession = await createCaptureSession(
              fileServer.url,
              join(workDir, "capture-calibration-screenshot"),
              buildCaptureOptions(),
              createRenderVideoFrameInjector(),
              screenshotCalibrationCfg,
            );
            if (!calibrationSession.isInitialized) {
              await initializeSession(calibrationSession);
            }
            assertNotAborted();

            captureCalibration = await measureCaptureCostFromSession(
              calibrationSession,
              totalFrames,
              fpsToNumber(job.config.fps),
            );
            logCaptureCalibrationResult(captureCalibration, log);
          } catch (fallbackError) {
            captureCalibration = createFailedCaptureCalibrationEstimate(
              "calibration-screenshot-failed",
            );
            log.warn(
              "[Render] Screenshot auto-worker calibration failed after BeginFrame fallback; using conservative worker budget.",
              {
                protocolTimeout: screenshotCalibrationCfg.protocolTimeout,
                error:
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              },
            );
          }
        } else {
          captureCalibration = createFailedCaptureCalibrationEstimate("calibration-failed");
          log.warn("[Render] Auto-worker calibration failed; using conservative worker budget.", {
            protocolTimeout: calibrationCfg.protocolTimeout,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (calibrationSession) {
          lastBrowserConsole = calibrationSession.browserConsoleBuffer;
          await closeCaptureSession(calibrationSession).catch(() => {});
        }
      }
    }

    let workerCount = resolveRenderWorkerCount(
      totalFrames,
      job.config.workers,
      cfg,
      compiled,
      log,
      captureCalibration?.estimate,
    );

    if (workerCount > 1 && probeSession) {
      lastBrowserConsole = probeSession.browserConsoleBuffer;
      await closeCaptureSession(probeSession);
      probeSession = null;
    }

    // Streaming encode pipes captured frames through ffmpeg's stdin to produce
    // a single video file. Keep the default enabled for sequential capture, but
    // let auto-parallel renders use disk frames: the current ordered streaming
    // writer would otherwise stall later workers behind earlier frame ranges.
    // png-sequence has no encoded video output, so streaming is always bypassed.
    let useStreamingEncode = shouldUseStreamingEncode(cfg, outputFormat, workerCount, job.duration);
    log.info("streaming-encode gate", {
      enabled: useStreamingEncode,
      configFlag: cfg.enableStreamingEncode,
      outputFormat,
      workerCount,
      durationSeconds: job.duration,
      maxDurationSeconds: cfg.streamingEncodeMaxDurationSeconds,
    });

    const captureAttempts: CaptureAttemptSummary[] = [];

    // png-sequence is "no container" — outputPath is treated as a directory and
    // the encode/mux/faststart stages are skipped entirely. The empty extension
    // keeps `videoOnlyPath` (which is constructed below) sensible even though
    // it will not be written.
    const FORMAT_EXT: Record<string, string> = {
      mp4: ".mp4",
      webm: ".webm",
      mov: ".mov",
      "png-sequence": "",
    };
    const videoExt = FORMAT_EXT[outputFormat] ?? ".mp4";
    const videoOnlyPath = join(workDir, `video-only${videoExt}`);
    // Only use the HDR encoder preset when there's HDR content to pass through —
    // either native HDR videos OR native HDR images. For SDR-only compositions,
    // auto mode stays SDR since H.265 10-bit causes browser color management
    // issues (orange shift) with no quality benefit.
    const nativeHdrIds = new Set([...nativeHdrVideoIds, ...nativeHdrImageIds]);
    const hasHdrContent = Boolean(effectiveHdr && nativeHdrIds.size > 0);
    const useLayeredComposite = shouldUseLayeredComposite({
      hasHdrContent,
      hasShaderTransitions: compiled.hasShaderTransitions,
      isPngSequence,
    });
    const encoderHdr = hasHdrContent ? effectiveHdr : undefined;
    // png-sequence has no encoder, but the rest of the orchestrator still
    // reads `preset.quality` for `effectiveQuality` and `preset.codec` for
    // unrelated bookkeeping. Fall back to the mp4 preset shape — its values
    // are never written to ffmpeg in the png-sequence path.
    const presetFormat: "mp4" | "webm" | "mov" = isPngSequence ? "mp4" : outputFormat;
    const preset = getEncoderPreset(job.config.quality, presetFormat, encoderHdr);

    // CLI overrides (--crf, --video-bitrate) flow through job.config and must
    // win over the preset-derived defaults. The CLI enforces mutual exclusivity
    // upstream, but we still resolve them defensively. Without this, the flags
    // are silently ignored at the encoder spawn sites below — see PR #268 which
    // dropped the prior baseEncoderOpts wiring.
    //
    // Programmatic callers can construct RenderConfig directly and bypass the
    // CLI's mutual-exclusivity guard. If both are set we honor crf (matches the
    // CLI semantics where --crf is the explicit override) and warn loudly so
    // the caller doesn't get a quietly-different bitrate than they passed in.
    if (job.config.crf != null && job.config.videoBitrate) {
      log.warn(
        `[Render] Both crf=${job.config.crf} and videoBitrate=${job.config.videoBitrate} were set. ` +
          `These are mutually exclusive; honoring crf and ignoring videoBitrate. ` +
          `Set only one to silence this warning.`,
      );
    }
    const effectiveQuality = job.config.crf ?? preset.quality;
    const effectiveBitrate = job.config.crf != null ? undefined : job.config.videoBitrate;

    job.framesRendered = 0;

    // ── Z-ordered multi-layer compositing ─────────────────────────────────
    // Per frame: query all elements' z-order, group into layers (DOM or HDR),
    // composite bottom-to-top in Node.js memory. HDR layers use native
    // pre-extracted pixels; DOM layers use Chrome alpha screenshots converted
    // into the active rgb48le signal space. Shader transitions use this same
    // path for SDR compositions so the engine can apply transition math to
    // isolated scene buffers instead of recording plain DOM screenshots.
    if (useLayeredComposite) {
      log.info(
        hasHdrContent
          ? "[Render] HDR layered composite: z-ordered DOM + native HDR video/image layers"
          : "[Render] Shader transition composite: z-ordered SDR DOM layers",
      );
      hdrPerf = createHdrPerfCollector();

      // Layered compositing relies on captureAlphaPng (Page.captureScreenshot
      // with a transparent background) for DOM layers. That CDP call hangs
      // indefinitely when Chrome is launched with --enable-begin-frame-control
      // (the default on Linux/headless-shell), because the compositor is paused
      // and never produces a frame to capture. Force screenshot mode for the
      // entire layered path — same constraint as alpha output formats above.
      cfg.forceScreenshot = true;

      // Use NATIVE HDR IDs (probed before SDR→HDR conversion) so only originally-HDR
      // videos are hidden + extracted natively. SDR videos stay in the DOM screenshot
      // (injected via the frame injector) and get sRGB→HLG conversion in the blit.
      // HDR images don't need an equivalent array — they're keyed off
      // `nativeHdrImageIds` directly (decoded once into `hdrImageBuffers` and blitted
      // by `blitHdrImageLayer`, with the DOM mask hiding them via `nativeHdrIds`).
      const hdrVideoIds = composition.videos
        .filter((v) => nativeHdrVideoIds.has(v.id))
        .map((v) => v.id);

      // Resolve HDR video source paths
      const hdrVideoSrcPaths = new Map<string, string>();
      for (const v of composition.videos) {
        if (!hdrVideoIds.includes(v.id)) continue;
        let srcPath = v.src;
        if (!srcPath.startsWith("/")) {
          const fromCompiled = join(compiledDir, srcPath);
          srcPath = existsSync(fromCompiled) ? fromCompiled : join(projectDir, srcPath);
        }
        hdrVideoSrcPaths.set(v.id, srcPath);
      }

      // Launch headless Chrome for DOM capture.
      // Pass the video frame injector so SDR videos are rendered correctly in Chrome.
      // HDR videos get injected too but are masked out via applyDomLayerMask
      // before each DOM screenshot — only the native FFmpeg-extracted HLG
      // frames are used for HDR pixels.
      if (!fileServer) throw new Error("fileServer must be initialized before HDR compositing");
      // Native HDR videos (e.g. HEVC) may be undecodable by Chrome on the
      // current platform — Linux headless-shell ships without HEVC support.
      // Their pixels come from out-of-band ffmpeg extraction, so the DOM
      // `<video>` element is only kept around for layout. Skip the per-page
      // readiness wait for these IDs; otherwise the render hangs 45s and
      // throws "video metadata not ready" even though we never asked the
      // browser to decode the video.
      const domSession = await createCaptureSession(
        fileServer.url,
        framesDir,
        buildCaptureOptions(),
        createRenderVideoFrameInjector(),
        cfg,
      );
      // Track lifecycle of resources spawned during HDR rendering so the
      // outer finally block can defensively reclaim anything that wasn't
      // cleaned up via the success path. Both closeCaptureSession and
      // StreamingEncoder.close() are idempotent, but the flags let us avoid
      // redundant work and make the intent explicit.
      let hdrEncoder: StreamingEncoder | null = null;
      let hdrEncoderClosed = false;
      let domSessionClosed = false;
      // Open raw HDR frame files at this scope so cleanup can close descriptors
      // on both success and early failure paths.
      const hdrVideoFrameSources = new Map<string, HdrVideoFrameSource>();
      try {
        await initializeSession(domSession);
        assertNotAborted();
        lastBrowserConsole = domSession.browserConsoleBuffer;

        // Set transparent background once for this dedicated DOM session.
        // captureAlphaPng() per frame skips the per-frame CDP set/reset overhead.
        await initTransparentBackground(domSession.page);

        // ── Scene detection for shader transitions ──────────────────────────
        // Query the browser for transition metadata written by @hyperframes/shader-transitions
        // (window.__hf.transitions) and discover which elements belong to each scene.
        const transitionMeta: HdrTransitionMeta[] = await domSession.page.evaluate(() => {
          return window.__hf?.transitions ?? [];
        });

        // Contract: compositions using window.__hf.transitions must wrap each
        // scene's elements in a <div class="scene" id="sceneName"> where the id
        // matches the fromScene/toScene values declared in the transition metadata.
        const sceneElements: Record<string, string[]> = await domSession.page.evaluate(() => {
          const scenes = document.querySelectorAll(".scene");
          const map: Record<string, string[]> = {};
          for (const scene of scenes) {
            if (!scene.id) continue;
            const ids = new Set<string>([scene.id]);
            const els = scene.querySelectorAll("[id]");
            for (const el of els) {
              if (el.id) ids.add(el.id);
            }
            map[scene.id] = Array.from(ids);
          }
          return map;
        });

        const fpsDecimal = fpsToNumber(job.config.fps);
        const transitionRanges: TransitionRange[] = transitionMeta.map((t) => ({
          ...t,
          startFrame: Math.floor(t.time * fpsDecimal),
          endFrame: Math.ceil((t.time + t.duration) * fpsDecimal),
        }));

        if (transitionRanges.length > 0) {
          log.info("[Render] Detected shader transitions for layered compositing", {
            count: transitionRanges.length,
            transitions: transitionRanges.map((t) => ({
              shader: t.shader,
              from: t.fromScene,
              to: t.toScene,
              frames: `${t.startFrame}-${t.endFrame}`,
            })),
          });
        }

        // Spawn HDR streaming encoder accepting raw rgb48le composited frames.
        // Assigned to the let declared above so the outer finally can close it
        // if any of the work between here and hdrEncoder.close() throws.
        hdrEncoder = await spawnStreamingEncoder(
          videoOnlyPath,
          {
            fps: job.config.fps,
            width,
            height,
            codec: preset.codec,
            preset: preset.preset,
            quality: effectiveQuality,
            bitrate: effectiveBitrate,
            pixelFormat: preset.pixelFormat,
            hdr: preset.hdr,
            rawInputFormat: "rgb48le",
          },
          abortSignal,
          { ffmpegStreamingTimeout: 3_600_000 },
        );
        assertNotAborted();

        // ── Query element bounds for HDR extraction dimensions ────────────
        // Extract at each HDR video's display dimensions (not composition dimensions)
        // so the source stride matches the blit dimensions. Elements that aren't
        // visible at t=0 (e.g., data-start > 0) need to be queried at their own
        // start time so their layout dimensions are available.
        const hdrExtractionDims = new Map<string, { width: number; height: number }>();
        // CSS `object-fit` / `object-position` for HDR <img> elements. Captured
        // alongside `hdrExtractionDims` so the static-image decoder can resample
        // the rgb48le buffer into the element's layout box the same way the
        // browser would, instead of blitting the source PNG at native size.
        const hdrImageFitInfo = new Map<string, { fit: string; position: string }>();
        const hdrVideoStartTimes = new Map<string, number>();
        for (const v of composition.videos) {
          if (hdrVideoIds.includes(v.id)) {
            hdrVideoStartTimes.set(v.id, v.start);
          }
        }
        const hdrImageStartTimes = new Map<string, number>();
        for (const img of composition.images) {
          if (nativeHdrImageIds.has(img.id)) {
            hdrImageStartTimes.set(img.id, img.start);
          }
        }

        // Collect unique start times to minimize seek operations. Merge HDR
        // video AND image start times so an HDR image with `data-start > 0`
        // also gets a stacking-query pass at its appearance moment.
        const uniqueStartTimes = [
          ...new Set([...hdrVideoStartTimes.values(), ...hdrImageStartTimes.values()]),
        ].sort((a, b) => a - b);
        for (const seekTime of uniqueStartTimes) {
          await domSession.page.evaluate((t: number) => {
            if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
          }, seekTime);
          if (domSession.onBeforeCapture) {
            await domSession.onBeforeCapture(domSession.page, seekTime);
          }
          const stacking = await queryElementStacking(domSession.page, nativeHdrIds);
          for (const el of stacking) {
            // Use layout dimensions (offsetWidth/offsetHeight) for extraction — these
            // are unaffected by CSS transforms (GSAP scale/rotation). getBoundingClientRect
            // returns the transformed bounding box which can be wrong for extraction.
            if (
              el.isHdr &&
              el.layoutWidth > 0 &&
              el.layoutHeight > 0 &&
              !hdrExtractionDims.has(el.id)
            ) {
              hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
            }
            // Record `object-fit` / `object-position` for HDR images so the
            // static-image decode pass can resample to layout dimensions with
            // the same semantics the browser would apply.
            if (el.isHdr && nativeHdrImageIds.has(el.id) && !hdrImageFitInfo.has(el.id)) {
              hdrImageFitInfo.set(el.id, {
                fit: el.objectFit,
                position: el.objectPosition,
              });
            }
          }
        }

        // Fallback probe for HDR images that weren't captured above.
        // When an image's `data-start` aligns with the exact visibility
        // boundary (or precedes a GSAP `from` tween that animates it in
        // later), Chrome reports 0 layout dimensions at that instant.
        // Re-probe slightly into the element's visible range so the
        // resample path gets real layout dims.
        for (const [imageId, startTime] of hdrImageStartTimes) {
          if (hdrExtractionDims.has(imageId)) continue;
          const img = composition.images.find((i) => i.id === imageId);
          if (!img) continue;
          const duration = img.end - img.start;
          const retryTime = startTime + Math.min(0.5, duration * 0.1);
          await domSession.page.evaluate((t: number) => {
            if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
          }, retryTime);
          if (domSession.onBeforeCapture) {
            await domSession.onBeforeCapture(domSession.page, retryTime);
          }
          const retryStacking = await queryElementStacking(domSession.page, nativeHdrIds);
          for (const el of retryStacking) {
            if (el.id === imageId && el.isHdr && el.layoutWidth > 0 && el.layoutHeight > 0) {
              hdrExtractionDims.set(el.id, { width: el.layoutWidth, height: el.layoutHeight });
              if (!hdrImageFitInfo.has(el.id)) {
                hdrImageFitInfo.set(el.id, { fit: el.objectFit, position: el.objectPosition });
              }
              break;
            }
          }
        }

        // ── Pre-extract all HDR video frames in a single FFmpeg pass ──────
        // Use raw rgb48le instead of PNG sequences so the hot loop can read a
        // fixed byte range per frame and skip PNG decode entirely.
        for (const [videoId, srcPath] of hdrVideoSrcPaths) {
          const video = composition.videos.find((v) => v.id === videoId);
          if (!video) continue;
          const frameDir = join(framesDir, `hdr_${videoId}`);
          mkdirSync(frameDir, { recursive: true });
          const duration = video.end - video.start;
          const dims = hdrExtractionDims.get(videoId) ?? { width, height };
          const rawPath = join(frameDir, "frames.rgb48le");
          const ffmpegArgs = [
            "-ss",
            String(video.mediaStart),
            "-i",
            srcPath,
            "-t",
            String(duration),
            "-r",
            // Pass the rational form to FFmpeg so NTSC stays exact end-to-end.
            fpsToFfmpegArg(job.config.fps),
            "-vf",
            `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height}`,
            "-pix_fmt",
            "rgb48le",
            "-f",
            "rawvideo",
            "-y",
            rawPath,
          ];
          const result = await runFfmpeg(ffmpegArgs, { signal: abortSignal });
          if (!result.success) {
            hdrDiagnostics.videoExtractionFailures += 1;
            log.error("HDR frame pre-extraction failed; aborting render", {
              videoId,
              srcPath,
              stderr: result.stderr.slice(-400),
            });
            throw new Error(
              `HDR frame extraction failed for video "${videoId}". ` +
                `Aborting render to avoid shipping black HDR layers.`,
            );
          }
          const frameSize = dims.width * dims.height * 6;
          const frameCount = Math.floor(statSync(rawPath).size / frameSize);
          if (frameCount < 1) {
            hdrDiagnostics.videoExtractionFailures += 1;
            throw new Error(
              `HDR frame extraction produced no frames for video "${videoId}". ` +
                `Aborting render to avoid shipping black HDR layers.`,
            );
          }
          hdrVideoFrameSources.set(videoId, {
            dir: frameDir,
            rawPath,
            fd: openSync(rawPath, "r"),
            width: dims.width,
            height: dims.height,
            frameSize,
            frameCount,
            scratch: Buffer.allocUnsafe(frameSize),
          });
        }

        // ── Pre-decode all HDR image buffers once ────────────────────────
        // Static images decode exactly once, then the resulting rgb48le buffer
        // is blitted on every visible frame. Caching the decode here keeps the
        // per-frame cost to a memcpy + blit. Failures are logged and skipped so
        // a single broken file doesn't kill the render.
        //
        // We resample the decoded buffer to the element's *layout* dimensions
        // here (using CSS `object-fit` / `object-position` semantics), so the
        // affine blit downstream can treat the buffer as if the source was
        // sized to the element's box. Without this step, an `<img>` element
        // styled `object-fit: cover` would render its source PNG at native
        // pixel size inside the layout box — visually a small image floating
        // in the top-left corner of its container instead of filling it.
        const hdrImageBuffers = new Map<string, HdrImageBuffer>();
        for (const [imageId, srcPath] of hdrImageSrcPaths) {
          try {
            const decoded = decodePngToRgb48le(readFileSync(srcPath));
            const layout = hdrExtractionDims.get(imageId);
            const fitInfo = hdrImageFitInfo.get(imageId);
            if (layout && (layout.width !== decoded.width || layout.height !== decoded.height)) {
              const fit = normalizeObjectFit(fitInfo?.fit);
              const resampled = resampleRgb48leObjectFit(
                decoded.data,
                decoded.width,
                decoded.height,
                layout.width,
                layout.height,
                fit,
                fitInfo?.position,
              );
              hdrImageBuffers.set(imageId, {
                data: resampled,
                width: layout.width,
                height: layout.height,
              });
            } else {
              hdrImageBuffers.set(imageId, {
                data: Buffer.from(decoded.data),
                width: decoded.width,
                height: decoded.height,
              });
            }
          } catch (err) {
            hdrDiagnostics.imageDecodeFailures += 1;
            log.error("HDR image decode failed; aborting render", {
              imageId,
              srcPath,
              error: err instanceof Error ? err.message : String(err),
            });
            throw new Error(
              `HDR image decode failed for image "${imageId}". ` +
                `Aborting render to avoid shipping missing HDR image layers.`,
            );
          }
        }

        assertNotAborted();

        try {
          // The beforeCaptureHook injects SDR video frames into the DOM.
          // We call it manually since the HDR loop doesn't use captureFrame().
          const beforeCaptureHook = domSession.onBeforeCapture;

          // Track which HDR video raw frame sources have been cleaned up.
          // Once a video's last frame has been used (time > video.end), its
          // extraction directory is deleted to free disk space. This prevents
          // disk exhaustion on compositions with many HDR videos.
          const cleanedUpVideos = new Set<string>();
          // Build a map of video end times for quick lookup
          const hdrVideoEndTimes = new Map<string, number>();
          for (const v of composition.videos) {
            if (hdrVideoFrameSources.has(v.id)) {
              hdrVideoEndTimes.set(v.id, v.end);
            }
          }

          // ── HDR composite helper context ───────────────────────────────────
          // The actual layer-compositing logic lives at module scope in
          // `compositeHdrFrame`; we just pre-bind its long-lived dependencies
          // here so call sites stay short.
          const debugDumpEnabled = process.env.KEEP_TEMP === "1";
          const debugDumpDir = debugDumpEnabled ? join(framesDir, "debug-composite") : null;
          if (debugDumpDir && !existsSync(debugDumpDir)) {
            mkdirSync(debugDumpDir, { recursive: true });
          }
          const compositeTransfer = resolveCompositeTransfer(hasHdrContent, effectiveHdr);
          // `hdrTargetTransfer` (compositeTransfer normalized to `undefined`
          // for sRGB) is now computed inside `processLayeredTransitionFrame`
          // and `compositeHdrFrame`; the inline copy that the legacy loop
          // body referenced was removed in the hybrid-dispatch refactor.
          //
          // Per-job LRU cache for transfer-converted HDR image buffers. Static HDR
          // images that need PQ↔HLG conversion are converted exactly once per
          // (imageId, targetTransfer) and then reused for every subsequent frame
          // instead of paying a fresh `Buffer.from` + `convertTransfer` on every
          // composite. The cache is local to this render job so concurrent renders
          // do not share state.
          const hdrCacheMaxBytes = process.env.HDR_TRANSFER_CACHE_MAX_BYTES
            ? Number(process.env.HDR_TRANSFER_CACHE_MAX_BYTES)
            : undefined;
          const hdrImageTransferCache = createHdrImageTransferCache(
            hdrCacheMaxBytes !== undefined ? { maxBytes: hdrCacheMaxBytes } : {},
          );
          const hdrCompositeCtx: HdrCompositeContext = {
            log,
            domSession,
            beforeCaptureHook,
            width,
            height,
            fps: fpsToNumber(job.config.fps),
            compositeTransfer,
            nativeHdrImageIds,
            hdrImageBuffers,
            hdrImageTransferCache,
            hdrVideoFrameSources,
            hdrVideoStartTimes,
            imageTransfers,
            videoTransfers,
            debugDumpEnabled,
            debugDumpDir,
            hdrPerf,
          };

          // ── Pre-allocate transition buffers ─────────────────────────────────
          // Each buffer is width * height * 6 bytes (~37 MB at 1080p). Reused
          // across frames to avoid per-frame allocation in the hot loop.
          const bufSize = width * height * 6;
          const hasTransitions = transitionRanges.length > 0;
          const transBufferA = hasTransitions ? Buffer.alloc(bufSize) : null;
          const transBufferB = hasTransitions ? Buffer.alloc(bufSize) : null;
          const transOutput = hasTransitions ? Buffer.alloc(bufSize) : null;
          // Pre-allocate the normal-frame canvas too — reused via .fill(0) each iteration
          // to avoid ~37 MB allocation per frame in the hot loop.
          // `let` (not `const`): the legacy sequential path may rebind
          // this if `processLayeredNormalFrame` ever runs with the
          // decode/blit pool wired into `hdrCompositeCtx`. In the current
          // wiring the legacy path runs WITHOUT a pool (the pool is only
          // spawned inside the hybrid try-block below), so the rebind is
          // effectively a no-op here — but keeping it `let` future-proofs
          // any change that hands the pool to the sequential path too.
          // The explicit `Buffer` annotation is required because newer
          // `@types/node` narrows `Buffer.alloc` to `Buffer<ArrayBuffer>`
          // while `processLayeredNormalFrame` returns the union-typed
          // `Buffer` (the pool reply re-attaches a generic ArrayBufferLike).
          let normalCanvas: Buffer = Buffer.alloc(bufSize);

          // ── Hybrid layered dispatch (issue #677) ───────────────────────────
          // Pre-#677 this path was a single sequential for-loop that drove the
          // dual-scene transition compositor for every transition frame and
          // the normal layered compositor for every other frame — even when
          // the composition had no HDR content and could trivially be
          // parallelized. For an SDR shader-transition composition with 14
          // 0.3s transitions on a 28s timeline, ~83% of frames were sitting
          // on a fast non-transition path serialized behind a single browser.
          //
          // The fix here computes the transition-frame set up front and,
          // when the workload qualifies (SDR + multi-worker), spawns a pool
          // of additional `domSession`s. Every worker drains a contiguous
          // slice of the timeline including any transition frames that
          // happen to fall inside its range — see the hf#732 follow-up
          // notes at the dispatch site below for why the dual-scene
          // transition compositor is safe to run in parallel across
          // sessions. A shared `FrameReorderBuffer` gates
          // `hdrEncoder.writeFrame` so frames hit the encoder in ascending
          // index order regardless of which session finished them first.
          //
          // HDR + shader-transitions falls back to the legacy sequential
          // loop: each worker session would need its own `dup(fd)` into the
          // pre-extracted HDR raw frame files (the existing
          // `HdrVideoFrameSource` shape carries a single shared fd and a
          // single scratch Buffer — a 16-bit pixel format is not safe to
          // read concurrently from the same fd because `readSync` advances
          // the file offset). Splitting HDR raw-frame sources per worker is
          // a follow-up; the #677 fix targets the SDR transition path that
          // produced the reported 24× regression.
          const transitionFrames = partitionTransitionFrames(transitionRanges, totalFrames);
          const transitionFrameCount = transitionFrames.size;
          const hybridEligible = shouldUseHybridLayeredPath({
            hasHdrContent,
            transitionFramesCount: transitionFrameCount,
            totalFrames,
            workerCount,
          });

          if (transitionRanges.length > 0) {
            log.info("[Render] Layered hybrid dispatch decision", {
              hybridEnabled: hybridEligible,
              hasHdrContent,
              workerCount,
              transitionFrameCount,
              totalFrames,
              transitionRatio:
                totalFrames > 0
                  ? Math.round((transitionFrameCount / totalFrames) * 1000) / 1000
                  : 0,
            });
          }

          // Recompute the worker count using the actual transition ratio now
          // that we have it — the pre-discovery worker count was sized with
          // the legacy flat shader-transition charge. With the hybrid path
          // most frames are cheap, so auto-worker sizing can comfortably
          // climb back up to the SDR baseline. Explicit `--workers` requests
          // are still honored verbatim (resolveRenderWorkerCount clamps).
          let layeredWorkerCount = workerCount;
          if (hybridEligible && transitionRanges.length > 0) {
            const ratio = transitionFrameCount / totalFrames;
            const shapedCost = combineCaptureCostEstimates(
              estimateCaptureCostMultiplier(compiled, { transitionFrameRatio: ratio }),
              captureCalibration?.estimate,
            );
            const shapedWorkers = calculateOptimalWorkers(totalFrames, job.config.workers, {
              ...cfg,
              captureCostMultiplier: shapedCost.multiplier,
            });
            if (shapedWorkers > layeredWorkerCount) {
              log.info("[Render] Bumping layered worker count for hybrid SDR path", {
                from: layeredWorkerCount,
                to: shapedWorkers,
                blendedCostMultiplier: shapedCost.multiplier,
                transitionFrameRatio: ratio,
              });
              layeredWorkerCount = shapedWorkers;
            }
          }

          const transitionBuffers: LayeredTransitionBuffers | null = hasTransitions
            ? {
                bufferA: transBufferA as Buffer,
                bufferB: transBufferB as Buffer,
                output: transOutput as Buffer,
              }
            : null;

          // Shared by both dispatch paths. `framesWritten` is the encoder
          // cursor; both transition and normal-frame writers increment it
          // *only* after `hdrEncoder.writeFrame` succeeds so progress updates
          // stay tied to actual encoder ingestion.
          let framesWritten = 0;
          const reorderBuffer = createFrameReorderBuffer(0, totalFrames);
          // Snapshot `hdrEncoder` into a non-null local. `hdrEncoder` is the
          // outer `let` that the finally block uses for defensive close; the
          // compiler can't narrow it across the writer closure, so capture
          // the freshly-spawned encoder once at this point. It's a stable
          // reference for the duration of the writer's lifetime.
          const encoder = hdrEncoder;
          if (!encoder) {
            throw new Error("hdrEncoder is null when starting the layered writer");
          }

          const writeEncoded = async (frameIdx: number, buf: Buffer): Promise<void> => {
            await reorderBuffer.waitForFrame(frameIdx);
            const writeStart = Date.now();
            encoder.writeFrame(buf);
            addHdrTiming(hdrPerf, "encoderWriteMs", writeStart);
            reorderBuffer.advanceTo(frameIdx + 1);
            framesWritten += 1;
            job.framesRendered = framesWritten;
            if (framesWritten % 10 === 0 || framesWritten === totalFrames) {
              const frameProgress = framesWritten / totalFrames;
              updateJobStatus(
                job,
                "rendering",
                `Layered composite frame ${framesWritten}/${job.totalFrames}`,
                Math.round(25 + frameProgress * 55),
                onProgress,
              );
            }
            // HDR raw-frame cleanup ran after every frame in the legacy loop.
            // It's a no-op when `hdrVideoEndTimes` is empty (the SDR hybrid
            // case), so we keep the same call shape here without forking the
            // cleanup branch. The `time` is derived back from frameIdx so we
            // don't have to thread it through the writer plumbing.
            if (process.env.KEEP_TEMP !== "1" && hdrVideoEndTimes.size > 0) {
              const frameTime = (frameIdx * job.config.fps.den) / job.config.fps.num;
              for (const [videoId, endTime] of hdrVideoEndTimes) {
                if (frameTime > endTime && !cleanedUpVideos.has(videoId)) {
                  // In the legacy loop this check also gated on whether an
                  // active transition still referenced the video's scene.
                  // The hybrid path doesn't know the per-frame
                  // `activeTransition` at write time, but the SDR hybrid
                  // case is the only one that exercises this writer in
                  // parallel and it has no HDR videos, so the simpler
                  // "after end time" gate is sufficient. The HDR fallback
                  // path goes through `runSequentialLayered` below and
                  // does the full check inline.
                  const frameSource = hdrVideoFrameSources.get(videoId);
                  if (frameSource) {
                    closeHdrVideoFrameSource(frameSource, log);
                    try {
                      rmSync(frameSource.dir, { recursive: true, force: true });
                    } catch (err) {
                      log.warn("Failed to clean up HDR raw frame directory", {
                        videoId,
                        frameDir: frameSource.dir,
                        rawPath: frameSource.rawPath,
                        error: err instanceof Error ? err.message : String(err),
                      });
                    }
                    hdrVideoFrameSources.delete(videoId);
                  }
                  cleanedUpVideos.add(videoId);
                }
              }
            }
          };

          // ── Hybrid path: parallel pool drains BOTH non-transition and
          // transition frames. Every worker owns its own browser session and
          // per-scene transition scratch buffers, so the per-frame
          // seek/inject/mask/screenshot pipeline runs concurrently across the
          // pool. Both feed into the same reorder buffer → encoder.
          //
          // hf#732 fix-up: the prior iteration kept transition frames pinned
          // to the main session, which left ~110s of the 171s wall-clock
          // sitting on a single-CDP serial path (141 transition frames ×
          // ~780 ms each). perf-summary.json showed the transition phase
          // dominated by `domScreenshotMs` (70.8s) — fundamentally a
          // Puppeteer round-trip cost that only parallelizes by spreading
          // captures across additional browser sessions. Each worker now
          // walks a contiguous slice of frame indices that includes any
          // transition frames in its range, so the dual-scene capture
          // pattern runs on worker-local `window.__hf` state. Correctness
          // is preserved because the per-frame state (seek time → fromScene
          // mask → screenshot → toScene mask → screenshot → blend) is fully
          // self-contained inside a single `processLayeredTransitionFrame`
          // call against a single session — there's no inter-frame
          // dependency on the same session. The SDR gate
          // (`hasHdrContent === false` inside `shouldUseHybridLayeredPath`)
          // still applies; HDR renders take the sequential path below
          // because `hdrVideoFrameSources` carries a single shared fd per
          // raw frame source that's not safe to read concurrently.
          if (hybridEligible) {
            const workerSessions: CaptureSession[] = [];
            const workerCanvasesNeeded = Math.max(0, layeredWorkerCount - 1);

            // hf#677 follow-up: spawn a worker_threads pool for the per-pixel
            // shader-blend. The prior hf#732 commit parallelized DOM-session
            // work across `layeredWorkerCount` browsers, but the JS shader
            // call at the tail of `processLayeredTransitionFrame` still
            // executed on the Node main event loop — six DOM workers all
            // firing `TRANSITIONS[shader](...)` saturated the single thread
            // and the worker-count sweep flattened after w=2. Moving the
            // blend onto `worker_threads` removes that ceiling. Pool size
            // matches `layeredWorkerCount` (clamped to CPU count inside
            // the pool) so each DOM worker has a CPU peer for its blend
            // calls; no benefit from oversubscribing. Only allocated when
            // there are actually transition frames to blend.
            let shaderPool: ShaderTransitionWorkerPool | null = null;
            let pngDecodeBlitPool: PngDecodeBlitWorkerPool | null = null;
            try {
              // Worker 0 reuses the main `domSession`; spawn the rest.
              for (let w = 0; w < workerCanvasesNeeded; w++) {
                const session = await createCaptureSession(
                  fileServer.url,
                  framesDir,
                  buildCaptureOptions(),
                  createRenderVideoFrameInjector(),
                  cfg,
                );
                await initializeSession(session);
                await initTransparentBackground(session.page);
                workerSessions.push(session);
              }

              const sessions: CaptureSession[] = [domSession, ...workerSessions];
              const activeWorkerCount = sessions.length;

              // Spawn the shader-blend pool now that we know the actual
              // DOM-worker count. Skipping when there are no transitions
              // avoids ~10–50ms × N worker spawn cost on the SDR
              // non-transition fast path.
              if (hasTransitions) {
                try {
                  shaderPool = await createShaderTransitionWorkerPool({
                    size: activeWorkerCount,
                    log,
                  });
                } catch (err) {
                  log.warn(
                    "[Render] Failed to spawn shader-blend worker pool; falling back to inline shader blend",
                    { error: err instanceof Error ? err.message : String(err) },
                  );
                  shaderPool = null;
                }
              }

              // hf#732 lever-4: spawn the PNG decode + alpha-blit pool. Used by
              // both `captureTransitionFrame` (per-scene DOM decode+blit, 2× per
              // transition frame) and `compositeHdrFrame` (per-layer DOM
              // decode+blit, 3-6× per normal layered frame). Sizing rationale:
              // every DOM worker hits this pool every frame, so the pool wants
              // to be at least as wide as the DOM-worker count — but the per-
              // task work is short (~80ms) so we can amortize across more
              // concurrent tasks. We size to `2× activeWorkerCount` capped to
              // cpu count internally; this absorbs the 2× per-frame burst
              // (transition scenes A+B fire simultaneously) without leaving
              // workers idle. Skippable when the inline fallback is OK; the
              // hybrid path always wants it on though so we don't gate by
              // hasTransitions like the shader pool.
              try {
                pngDecodeBlitPool = await createPngDecodeBlitWorkerPool({
                  size: Math.max(activeWorkerCount, activeWorkerCount * 2),
                  log,
                });
              } catch (err) {
                log.warn(
                  "[Render] Failed to spawn PNG decode+blit worker pool; falling back to inline decode/blit",
                  { error: err instanceof Error ? err.message : String(err) },
                );
                pngDecodeBlitPool = null;
              }

              // Per-worker normal-frame canvas, allocated once and reused.
              // Worker 0 reuses `normalCanvas` (already allocated above).
              const workerCanvases: Buffer[] = [normalCanvas];
              for (let w = 1; w < activeWorkerCount; w++) {
                workerCanvases.push(Buffer.alloc(bufSize));
              }

              // hf#732 lever-4: hand the PNG decode+blit pool to the
              // composite context. Both the transition path
              // (`captureTransitionFrame` per-scene) and the normal-layered
              // path (`compositeHdrFrame` per-layer) read this field; null
              // means inline-decode-blit fallback. Set here (after the pool
              // is spawned) rather than at context construction because the
              // pool lifecycle is tied to the hybrid try/finally.
              hdrCompositeCtx.pngDecodeBlitPool = pngDecodeBlitPool;

              // Per-worker transition scratch buffer RING. Each entry is a
              // triple (bufferA + bufferB + output); the DOM worker
              // round-robins through the ring so it can capture frames
              // N+1..N+K-1 while the pool is still blending earlier frames
              // from the older ring slots. Ring depth K trades memory for
              // pool utilization:
              //
              // - K=1: worker awaits each blend before the next capture →
              //   pool sees max 1 task per worker → empirically ~135s
              //   wall on the hf#677 fixture with N=6 workers (no
              //   improvement over the un-decoupled `bde9b886` baseline).
              // - K=2: covers the average transition cluster well enough
              //   to keep the pool with 2-4 concurrent tasks → ~135s.
              // - K=4-5: pool saturates around max busy ≈ pool size during
              //   peak transition clusters → ~100s wall. This is the
              //   sweet spot per empirical sweep.
              // - K≥10: diminishing returns; pool already saturated, so
              //   adding more in-flight tasks just adds memory.
              //
              // The right K, mathematically, is `blend_per_frame /
              // capture_per_frame`. For 854×480 rgb48le with complex
              // shaders this is ~910ms / ~175ms ≈ 5. K=4 strikes the
              // balance between perf and memory. Override at runtime via
              // `HF_TRANSITION_RING_DEPTH` if a workload's blend/capture
              // ratio is very different (e.g. simpler shaders that blend
              // in 100ms can drop K to 1-2 with no perf loss).
              //
              // Memory budget: 6 workers × 4 × 3 buffers × 854×480×6 bytes
              // ≈ 180MB peak; safely within the SDR render budget. With
              // K=10 it's ~450MB, still fine but unnecessary.
              //
              // hf#732 follow-up rationale: the prior fix-up
              // (`bde9b886`) awaited each `pool.run` inline inside
              // `processLayeredTransitionFrame`, which serialized every
              // DOM worker through one in-flight blend. With N=6 DOM
              // workers walking contiguous frame slices and transition
              // windows being temporally localized, typically only 1-2
              // DOM workers held a transition at a time — so the pool
              // only ever had ≤2 tasks in flight, fed through slots 0-1
              // with postMessage overhead on top. CPU graphs showed
              // workers 0-1 active and workers 2-5 idle. Decoupling +
              // the K-deep ring is the fix: each DOM worker fires off the
              // blend without awaiting, then on its (K+1)-th transition
              // frame awaits the oldest in-flight blend on this worker.
              // The pool sustains up to min(N_workers × K, poolSize)
              // concurrent blends.
              const DEFAULT_TRANSITION_RING_DEPTH = 4;
              const TRANSITION_RING_DEPTH = Math.max(
                1,
                Number(
                  process.env.HF_TRANSITION_RING_DEPTH ?? String(DEFAULT_TRANSITION_RING_DEPTH),
                ),
              );
              const workerTransitionRings: Array<LayeredTransitionBuffers[] | null> = [];
              for (let w = 0; w < activeWorkerCount; w++) {
                if (!hasTransitions) {
                  workerTransitionRings.push(null);
                  continue;
                }
                const ring: LayeredTransitionBuffers[] = [];
                // Slot 0 of worker 0 reuses the already-allocated outer-scope
                // `transitionBuffers` so the legacy sequential branch's buffer
                // allocation is not wasted when both branches share the
                // hasTransitions path. The remaining K-1 slots for worker 0
                // plus all slots for workers 1..N are freshly allocated.
                for (let k = 0; k < TRANSITION_RING_DEPTH; k++) {
                  if (w === 0 && k === 0 && transitionBuffers) {
                    ring.push(transitionBuffers);
                  } else {
                    ring.push({
                      bufferA: Buffer.alloc(bufSize),
                      bufferB: Buffer.alloc(bufSize),
                      output: Buffer.alloc(bufSize),
                    });
                  }
                }
                workerTransitionRings.push(ring);
              }

              // Flat partition over the entire frame range — every worker
              // gets a contiguous slice that includes whatever mix of normal
              // and transition frames falls inside it. Ordering correctness
              // is enforced by `reorderBuffer.waitForFrame` at the encoder
              // gate, not by the dispatch order here.
              const workerRanges = distributeLayeredHybridFrameRanges(
                totalFrames,
                activeWorkerCount,
              );

              // Snapshot the pool into a non-null local for the closure. The
              // pool reference is mutated to `null` on spawn failure; once
              // we're past that point, the closure can safely treat it as
              // a definite value (or fall back to inline blend).
              const poolRef = shaderPool;

              const workerTaskOf = async (w: number): Promise<void> => {
                const session = sessions[w];
                // `let` (not `const`): when the decode/blit pool is in
                // use, `processLayeredNormalFrame` returns the re-attached
                // canvas Buffer (the input's ArrayBuffer is detached on
                // transfer). We swap the local + the slot in
                // `workerCanvases` so the next frame in this worker's
                // slice uses the fresh view.
                let canvas = workerCanvases[w];
                if (!session || !canvas) return;
                const range = workerRanges[w];
                if (!range) return;
                const ring = workerTransitionRings[w] ?? null;
                // Per-ring-slot in-flight promise. When a slot is mid-blend,
                // its promise is non-null; before reusing the slot for a
                // new capture we await it (backpressure → bounds memory).
                const ringInFlight: Array<Promise<void> | null> = ring ? ring.map(() => null) : [];
                let nextRingIdx = 0;

                for (let i = range.start; i < range.end; i++) {
                  assertNotAborted();
                  const time = (i * job.config.fps.den) / job.config.fps.num;
                  const activeTransition = transitionFrames.has(i)
                    ? transitionRanges.find((t) => i >= t.startFrame && i <= t.endFrame)
                    : undefined;

                  if (activeTransition && ring) {
                    // Pick the next ring slot. If it's still in flight from
                    // an earlier capture, wait for it to drain before
                    // reusing its buffer triple.
                    const slot = nextRingIdx;
                    nextRingIdx = (nextRingIdx + 1) % TRANSITION_RING_DEPTH;
                    const prev = ringInFlight[slot];
                    if (prev) await prev;
                    const buffers = ring[slot];
                    if (!buffers) continue;

                    // CAPTURE on the DOM worker (this thread). Fills
                    // bufferA / bufferB synchronously w.r.t. this loop —
                    // we can't pipeline DOM work because the per-worker
                    // browser session is single-threaded.
                    const captured = await captureTransitionFrame(
                      session,
                      i,
                      time,
                      activeTransition,
                      hdrCompositeCtx,
                      sceneElements,
                      buffers,
                      assertNotAborted,
                      nativeHdrIds,
                    );

                    // BLEND + ENCODE without awaiting. The promise drains
                    // back into `ringInFlight[slot]`; the next iteration
                    // that picks `slot` will await it. The encoder reorder
                    // buffer fences ordering so out-of-order blend
                    // completion is fine.
                    const dispatch: Promise<void> = (async () => {
                      if (poolRef) {
                        const blendStart = Date.now();
                        try {
                          const result = await poolRef.run({
                            shader: captured.shader,
                            bufferA: buffers.bufferA,
                            bufferB: buffers.bufferB,
                            output: buffers.output,
                            width: captured.width,
                            height: captured.height,
                            progress: captured.progress,
                          });
                          // The originals were detached. Swap in the
                          // re-attached views so the ring slot stays
                          // usable for the next round-trip.
                          buffers.bufferA = result.bufferA;
                          buffers.bufferB = result.bufferB;
                          buffers.output = result.output;
                          addHdrTiming(
                            hdrCompositeCtx.hdrPerf,
                            "transitionShaderBlendMs",
                            blendStart,
                          );
                        } catch (err) {
                          // Pool task failed (worker crash / detach race).
                          // The transferred ArrayBuffers are lost; we
                          // cannot recover them, so we surface this as a
                          // fatal render error. The outer Promise.all
                          // rejects and the finally block tears down.
                          log.warn("[Render] Shader-blend pool task failed; aborting render", {
                            frameIndex: captured.frameIdx,
                            shader: captured.shader,
                            error: err instanceof Error ? err.message : String(err),
                          });
                          throw err;
                        }
                      } else {
                        // No pool (spawn failed) — synchronous fallback.
                        blendTransitionFrameInline(captured, hdrCompositeCtx.hdrPerf);
                      }
                      await writeEncoded(captured.frameIdx, buffers.output);
                    })();

                    // Catch on a separate handle so an unhandled-rejection
                    // can't fire if no one awaits this slot before the
                    // worker exits. The settled error is re-thrown when
                    // the slot is reused OR at the drain at function end.
                    ringInFlight[slot] = dispatch.catch((err: unknown) => {
                      // Re-throw on next await so the worker task rejects.
                      throw err instanceof Error ? err : new Error(String(err));
                    });
                  } else {
                    canvas = await processLayeredNormalFrame(
                      session,
                      i,
                      time,
                      hdrCompositeCtx,
                      canvas,
                      nativeHdrIds,
                    );
                    workerCanvases[w] = canvas;
                    if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
                      const previewPath = join(
                        debugDumpDir,
                        `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`,
                      );
                      writeFileSync(previewPath, canvas);
                    }
                    await writeEncoded(i, canvas);
                  }
                }

                // Drain any blends still in flight on this worker before
                // returning. If any rejected, the rejection bubbles here.
                for (const pending of ringInFlight) {
                  if (pending) await pending;
                }
              };

              // Run every worker concurrently. The reorder buffer fences
              // ordering so the encoder never sees frame N+1 before frame N.
              // `Promise.all` rethrows the first rejection, which (combined
              // with `assertNotAborted` in the per-frame helpers) bubbles
              // cancellation up cleanly.
              const workerPromises = sessions.map((_, w) => workerTaskOf(w));
              await Promise.all(workerPromises);
              await reorderBuffer.waitForAllDone();
            } finally {
              for (const session of workerSessions) {
                await closeCaptureSession(session).catch((err) => {
                  log.warn("Hybrid worker session close failed", {
                    err: err instanceof Error ? err.message : String(err),
                  });
                });
              }
              if (shaderPool) {
                await shaderPool.terminate().catch((err) => {
                  log.warn("Shader-blend worker pool terminate failed", {
                    err: err instanceof Error ? err.message : String(err),
                  });
                });
              }
              if (pngDecodeBlitPool) {
                await pngDecodeBlitPool.terminate().catch((err) => {
                  log.warn("PNG decode+blit worker pool terminate failed", {
                    err: err instanceof Error ? err.message : String(err),
                  });
                });
                // Clear the context reference so downstream callers can't
                // accidentally hit a terminated pool after teardown.
                hdrCompositeCtx.pngDecodeBlitPool = null;
              }
            }
          } else {
            // ── Legacy sequential path ─────────────────────────────────────
            // Preserves bit-for-bit output for HDR renders, single-worker
            // renders, and the all-transition edge case (which the hybrid
            // path early-outs). The helpers `processLayeredNormalFrame` /
            // `processLayeredTransitionFrame` keep the per-frame work in
            // sync with the hybrid path so `hdrPerf` rollups are
            // consistent across both branches.
            for (let i = 0; i < totalFrames; i++) {
              assertNotAborted();
              const time = (i * job.config.fps.den) / job.config.fps.num;
              const activeTransition = transitionRanges.find(
                (t) => i >= t.startFrame && i <= t.endFrame,
              );

              if (i % 30 === 0 && (log.isLevelEnabled?.("debug") ?? true)) {
                log.debug("[Render] HDR layer composite frame", {
                  frame: i,
                  time: time.toFixed(2),
                  activeTransition: activeTransition?.shader,
                });
              }

              if (activeTransition && transitionBuffers) {
                await processLayeredTransitionFrame(
                  domSession,
                  i,
                  time,
                  activeTransition,
                  hdrCompositeCtx,
                  sceneElements,
                  transitionBuffers,
                  assertNotAborted,
                  nativeHdrIds,
                );
                await writeEncoded(i, transitionBuffers.output);
              } else {
                normalCanvas = await processLayeredNormalFrame(
                  domSession,
                  i,
                  time,
                  hdrCompositeCtx,
                  normalCanvas,
                  nativeHdrIds,
                );
                if (debugDumpEnabled && debugDumpDir && i % 30 === 0) {
                  const previewPath = join(
                    debugDumpDir,
                    `frame_${String(i).padStart(4, "0")}_final_rgb48le.bin`,
                  );
                  writeFileSync(previewPath, normalCanvas);
                }
                await writeEncoded(i, normalCanvas);
              }
            }
          }
        } finally {
          lastBrowserConsole = domSession.browserConsoleBuffer;
          await closeCaptureSession(domSession);
          domSessionClosed = true;
        }

        const hdrEncodeResult = await hdrEncoder.close();
        hdrEncoderClosed = true;
        assertNotAborted();
        if (!hdrEncodeResult.success) {
          throw new Error(`HDR encode failed: ${hdrEncodeResult.error}`);
        }

        perfStages.captureMs = Date.now() - stage4Start;
        perfStages.encodeMs = hdrEncodeResult.durationMs;
      } finally {
        // Defensive cleanup: if anything between domSession creation and the
        // success-path closes threw, the encoder ffmpeg subprocess and the
        // browser would otherwise be leaked. Both close() methods are
        // idempotent so it's safe to call them when the flags are already set,
        // but we skip the redundant work to keep logs clean.
        if (hdrEncoder && !hdrEncoderClosed) {
          try {
            await hdrEncoder.close();
          } catch (err) {
            log.warn("hdrEncoder defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (!domSessionClosed) {
          await closeCaptureSession(domSession).catch((err) => {
            log.warn("closeCaptureSession defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
        // Close any raw frame files that survived in-loop cleanup (early
        // failures, KEEP_TEMP=1, videos still active when the render exits).
        // The on-disk frames themselves are torn down with workDir.
        for (const frameSource of hdrVideoFrameSources.values()) {
          closeHdrVideoFrameSource(frameSource, log);
        }
        hdrVideoFrameSources.clear();
      }
    } else // ── Standard capture paths (SDR or DOM-only HDR) ──────────────────
    // Streaming encode mode: pipe frame buffers directly to FFmpeg stdin,
    // skipping disk writes and the separate Stage 5 encode step.
    {
      let streamingEncoder: StreamingEncoder | null = null;
      let streamingEncoderClosed = false;

      if (useStreamingEncode) {
        try {
          streamingEncoder = await spawnStreamingEncoder(
            videoOnlyPath,
            {
              fps: job.config.fps,
              width,
              height,
              codec: preset.codec,
              preset: preset.preset,
              quality: effectiveQuality,
              bitrate: effectiveBitrate,
              pixelFormat: preset.pixelFormat,
              useGpu: job.config.useGpu,
              imageFormat: captureOptions.format || "jpeg",
              hdr: preset.hdr,
            },
            abortSignal,
          );
          assertNotAborted();
        } catch (err) {
          if (abortSignal?.aborted) {
            if (streamingEncoder && !streamingEncoderClosed) {
              await streamingEncoder.close().catch(() => {});
              streamingEncoderClosed = true;
            }
            throw err;
          }
          useStreamingEncode = false;
          streamingEncoder = null;
          log.warn("[Render] Streaming encoder spawn failed; falling back to disk-frame encode.", {
            error: err instanceof Error ? err.message : String(err),
            outputFormat,
            workerCount,
            durationSeconds: job.duration,
          });
        }
      }

      try {
        if (useStreamingEncode && streamingEncoder) {
          // ── Streaming capture + encode (Stage 4 absorbs Stage 5) ──────────
          // Streaming encode is locked in here; capture retries may shrink
          // workerCount later, but must not grow a streaming render past one worker.
          const reorderBuffer = createFrameReorderBuffer(0, totalFrames);
          const currentEncoder = streamingEncoder;

          if (workerCount > 1) {
            // Parallel capture → streaming encode
            const tasks = distributeFrames(job.totalFrames, workerCount, workDir);

            const onFrameBuffer = async (frameIndex: number, buffer: Buffer): Promise<void> => {
              await reorderBuffer.waitForFrame(frameIndex);
              currentEncoder.writeFrame(buffer);
              reorderBuffer.advanceTo(frameIndex + 1);
            };

            await executeParallelCapture(
              fileServer.url,
              workDir,
              tasks,
              buildCaptureOptions(),
              createRenderVideoFrameInjector,
              abortSignal,
              (progress) => {
                job.framesRendered = progress.capturedFrames;
                const frameProgress = progress.capturedFrames / progress.totalFrames;
                const progressPct = 25 + frameProgress * 55;

                if (
                  progress.capturedFrames % 30 === 0 ||
                  progress.capturedFrames === progress.totalFrames
                ) {
                  updateJobStatus(
                    job,
                    "rendering",
                    `Streaming frame ${progress.capturedFrames}/${progress.totalFrames} (${workerCount} workers)`,
                    Math.round(progressPct),
                    onProgress,
                  );
                }
              },
              onFrameBuffer,
              cfg,
            );

            if (probeSession) {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          } else {
            // Sequential capture → streaming encode

            const videoInjector = createRenderVideoFrameInjector();
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildCaptureOptions(),
                videoInjector,
                cfg,
              ));
            if (probeSession) {
              prepareCaptureSessionForReuse(session, framesDir, videoInjector);
              probeSession = null;
            }

            try {
              if (!session.isInitialized) {
                await initializeSession(session);
              }
              assertNotAborted();
              lastBrowserConsole = session.browserConsoleBuffer;

              for (let i = 0; i < totalFrames; i++) {
                assertNotAborted();
                const time = (i * job.config.fps.den) / job.config.fps.num;
                const { buffer } = await captureFrameToBuffer(session, i, time);
                await reorderBuffer.waitForFrame(i);
                currentEncoder.writeFrame(buffer);
                reorderBuffer.advanceTo(i + 1);
                job.framesRendered = i + 1;

                const frameProgress = (i + 1) / totalFrames;
                const progress = 25 + frameProgress * 55;

                updateJobStatus(
                  job,
                  "rendering",
                  `Streaming frame ${i + 1}/${job.totalFrames}`,
                  Math.round(progress),
                  onProgress,
                );
              }
            } finally {
              lastBrowserConsole = session.browserConsoleBuffer;
              await closeCaptureSession(session);
            }
          }

          // Close encoder and get result
          const encodeResult = await currentEncoder.close();
          streamingEncoderClosed = true;
          assertNotAborted();

          if (!encodeResult.success) {
            throw new Error(`Streaming encode failed: ${encodeResult.error}`);
          }

          perfStages.captureMs = Date.now() - stage4Start;
          perfStages.encodeMs = encodeResult.durationMs; // Overlapped with capture
        } else {
          // ── Disk-based capture (original flow) ────────────────────────────
          if (workerCount > 1) {
            // Parallel capture
            const attempts = await executeDiskCaptureWithAdaptiveRetry({
              serverUrl: fileServer.url,
              workDir,
              framesDir,
              totalFrames: job.totalFrames,
              initialWorkerCount: workerCount,
              allowRetry: job.config.workers === undefined,
              frameExt: needsAlpha ? "png" : "jpg",
              captureOptions: buildCaptureOptions(),
              createBeforeCaptureHook: createRenderVideoFrameInjector,
              abortSignal,
              onProgress: (progress) => {
                job.framesRendered = progress.capturedFrames;
                const frameProgress = progress.capturedFrames / progress.totalFrames;
                const progressPct = 25 + frameProgress * 45;

                if (
                  progress.capturedFrames % 30 === 0 ||
                  progress.capturedFrames === progress.totalFrames
                ) {
                  updateJobStatus(
                    job,
                    "rendering",
                    `Capturing frame ${progress.capturedFrames}/${progress.totalFrames} (${progress.activeWorkers} workers)`,
                    Math.round(progressPct),
                    onProgress,
                  );
                }
              },
              cfg,
              log,
            });
            captureAttempts.push(...attempts);
            const lastAttempt = attempts[attempts.length - 1];
            if (lastAttempt) {
              workerCount = lastAttempt.workers;
            }
            if (probeSession) {
              lastBrowserConsole = probeSession.browserConsoleBuffer;
              await closeCaptureSession(probeSession);
              probeSession = null;
            }
          } else {
            // Sequential capture

            const videoInjector = createRenderVideoFrameInjector();
            const session =
              probeSession ??
              (await createCaptureSession(
                fileServer.url,
                framesDir,
                buildCaptureOptions(),
                videoInjector,
                cfg,
              ));
            if (probeSession) {
              prepareCaptureSessionForReuse(session, framesDir, videoInjector);
              probeSession = null;
            }

            try {
              if (!session.isInitialized) {
                await initializeSession(session);
              }
              assertNotAborted();
              lastBrowserConsole = session.browserConsoleBuffer;

              for (let i = 0; i < job.totalFrames; i++) {
                assertNotAborted();
                const time = (i * job.config.fps.den) / job.config.fps.num;
                await captureFrame(session, i, time);
                job.framesRendered = i + 1;

                const frameProgress = (i + 1) / job.totalFrames;
                const progress = 25 + frameProgress * 45;

                updateJobStatus(
                  job,
                  "rendering",
                  `Capturing frame ${i + 1}/${job.totalFrames}`,
                  Math.round(progress),
                  onProgress,
                );
              }
            } finally {
              lastBrowserConsole = session.browserConsoleBuffer;
              await closeCaptureSession(session);
            }
          }

          perfStages.captureMs = Date.now() - stage4Start;

          if (isPngSequence) {
            // ── Stage 5 (png-sequence): copy captured PNGs to outputDir ──────
            // No encoder, no mux, no faststart — captured frames already carry
            // alpha and are the deliverable. We rename to `frame_NNNNNN.png`
            // (zero-padded) so consumers (After Effects, Nuke, Fusion, ffmpeg
            // image2 demuxer) can globbed-import without surprises.
            const stage5Start = Date.now();
            updateJobStatus(job, "encoding", "Writing PNG sequence", 75, onProgress);
            if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });
            const captured = readdirSync(framesDir)
              .filter((name) => name.endsWith(".png"))
              .sort();
            if (captured.length === 0) {
              throw new Error(
                `[Render] png-sequence output requested but no PNGs were captured to ${framesDir}`,
              );
            }
            captured.forEach((name, i) => {
              const dst = join(outputPath, `frame_${String(i + 1).padStart(6, "0")}.png`);
              copyFileSync(join(framesDir, name), dst);
            });
            if (hasAudio && existsSync(audioOutputPath)) {
              // Sidecar audio for callers that need to re-mux later. png-sequence
              // has no container of its own, so this is the only place audio
              // can land alongside the frames.
              copyFileSync(audioOutputPath, join(outputPath, "audio.aac"));
              log.info(
                `[Render] png-sequence: audio.aac sidecar written to ${outputPath}/audio.aac`,
              );
            }
            perfStages.encodeMs = Date.now() - stage5Start;
          } else {
            // ── Stage 5: Encode ───────────────────────────────────────────────
            const stage5Start = Date.now();
            updateJobStatus(job, "encoding", "Encoding video", 75, onProgress);

            const frameExt = needsAlpha ? "png" : "jpg";
            const framePattern = `frame_%06d.${frameExt}`;
            const encoderOpts = {
              fps: job.config.fps,
              width,
              height,
              codec: preset.codec,
              preset: preset.preset,
              quality: effectiveQuality,
              bitrate: effectiveBitrate,
              pixelFormat: preset.pixelFormat,
              useGpu: job.config.useGpu,
              hdr: preset.hdr,
            };
            const encodeResult = enableChunkedEncode
              ? await encodeFramesChunkedConcat(
                  framesDir,
                  framePattern,
                  videoOnlyPath,
                  encoderOpts,
                  chunkedEncodeSize,
                  abortSignal,
                )
              : await encodeFramesFromDir(
                  framesDir,
                  framePattern,
                  videoOnlyPath,
                  encoderOpts,
                  abortSignal,
                );
            assertNotAborted();

            if (!encodeResult.success) {
              throw new Error(`Encoding failed: ${encodeResult.error}`);
            }

            perfStages.encodeMs = Date.now() - stage5Start;
          }
        }
      } finally {
        // Defensive cleanup: if the streaming encoder branch threw before
        // currentEncoder.close() (e.g. capture failure, abort, broken pipe),
        // the ffmpeg subprocess would otherwise leak. close() is idempotent so
        // this is safe to call alongside the success-path close — we just gate
        // on the flag to avoid redundant work.
        if (streamingEncoder && !streamingEncoderClosed) {
          try {
            await streamingEncoder.close();
          } catch (err) {
            log.warn("streamingEncoder defensive close failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } // end SDR capture paths block

    if (probeSession !== null) {
      const remainingProbeSession: CaptureSession = probeSession;
      lastBrowserConsole = remainingProbeSession.browserConsoleBuffer;
      await closeCaptureSession(remainingProbeSession);
      probeSession = null;
    }

    if (frameLookup) frameLookup.cleanup();

    // Stop file server
    fileServer.close();
    fileServer = null;

    // ── Stage 6: Assemble ───────────────────────────────────────────────
    // Skipped for png-sequence — there is no encoded video to mux/faststart.
    // The frames were copied directly to outputPath in Stage 5.
    if (!isPngSequence) {
      const stage6Start = Date.now();
      updateJobStatus(job, "assembling", "Assembling final video", 90, onProgress);

      if (hasAudio) {
        const muxResult = await muxVideoWithAudio(
          videoOnlyPath,
          audioOutputPath,
          outputPath,
          abortSignal,
        );
        assertNotAborted();
        if (!muxResult.success) {
          throw new Error(`Audio muxing failed: ${muxResult.error}`);
        }
      } else {
        const faststartResult = await applyFaststart(videoOnlyPath, outputPath, abortSignal);
        assertNotAborted();
        if (!faststartResult.success) {
          throw new Error(`Faststart failed: ${faststartResult.error}`);
        }
      }

      perfStages.assembleMs = Date.now() - stage6Start;
    }

    // ── Complete ─────────────────────────────────────────────────────────
    job.outputPath = outputPath;
    updateJobStatus(job, "complete", "Render complete", 100, onProgress);

    const totalElapsed = Date.now() - pipelineStart;
    sampleMemory();

    const tmpPeakBytes = existsSync(workDir) ? sampleDirectoryBytes(workDir) : 0;

    const perfSummary: RenderPerfSummary = {
      renderId: job.id,
      totalElapsedMs: totalElapsed,
      // RenderPerfSummary surfaces fps as a decimal because it lands in JSON
      // payloads (CLI telemetry, regression-harness reports) where a single
      // number is friendlier than `{num,den}`. Callers needing the rational
      // back can read `job.config.fps`.
      fps: fpsToNumber(job.config.fps),
      quality: job.config.quality,
      workers: workerCount,
      chunkedEncode: enableChunkedEncode,
      chunkSizeFrames: enableChunkedEncode ? chunkedEncodeSize : null,
      compositionDurationSeconds: composition.duration,
      totalFrames: totalFrames,
      resolution: { width: outputWidth, height: outputHeight },
      videoCount: composition.videos.length,
      audioCount: composition.audios.length,
      stages: perfStages,
      videoExtractBreakdown: extractionResult?.phaseBreakdown,
      tmpPeakBytes,
      captureCalibration: captureCalibration
        ? {
            sampledFrames: captureCalibration.samples.map((sample) => sample.frameIndex),
            p95Ms: captureCalibration.estimate.p95Ms,
            multiplier: captureCalibration.estimate.multiplier,
            reasons: captureCalibration.estimate.reasons,
          }
        : undefined,
      captureAttempts: captureAttempts.length > 0 ? captureAttempts : undefined,
      hdrDiagnostics:
        hdrDiagnostics.videoExtractionFailures > 0 || hdrDiagnostics.imageDecodeFailures > 0
          ? { ...hdrDiagnostics }
          : undefined,
      hdrPerf: hdrPerf ? finalizeHdrPerf(hdrPerf) : undefined,
      captureAvgMs:
        totalFrames > 0 ? Math.round((perfStages.captureMs ?? 0) / totalFrames) : undefined,
      peakRssMb: Math.round(peakRssBytes / (1024 * 1024)),
      peakHeapUsedMb: Math.round(peakHeapUsedBytes / (1024 * 1024)),
    };
    job.perfSummary = perfSummary;
    // Write `perf-summary.json` whenever the workDir is going to be retained
    // (debug mode or `KEEP_TEMP=1`). Surfacing the hdrPerf timing rollups
    // alongside the captured frames was added for issue #677 so future
    // regressions in the layered shader-transition path are immediately
    // diagnosable from a single artifact. Production renders (no debug, no
    // KEEP_TEMP) still skip the write — the workDir is torn down below.
    if (job.config.debug || process.env.KEEP_TEMP === "1") {
      try {
        writeFileSync(perfOutputPath, JSON.stringify(perfSummary, null, 2), "utf-8");
      } catch (err) {
        log.debug("Failed to write perf summary", {
          perfOutputPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    if (job.config.debug) {
      // Copy output MP4 (or single-file alpha output) into the debug dir for
      // easy access. Skipped for png-sequence: outputPath is a directory, not
      // a single file — the captured frames already live in `framesDir` under
      // workDir during a debug run anyway.
      if (!isPngSequence && existsSync(outputPath)) {
        const debugOutput = join(workDir, `output${videoExt}`);
        copyFileSync(outputPath, debugOutput);
      }
    } else if (process.env.KEEP_TEMP === "1") {
      log.info("KEEP_TEMP=1 — leaving workDir on disk for inspection", { workDir });
    } else {
      await safeCleanup(
        "remove workDir",
        () => {
          rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
  } catch (error) {
    if (error instanceof RenderCancelledError || abortSignal?.aborted) {
      job.error = error instanceof Error ? error.message : "render_cancelled";
      updateJobStatus(job, "cancelled", "Render cancelled", job.progress, onProgress);
      if (fileServer) {
        const fs = fileServer;
        await safeCleanup(
          "close file server (cancel)",
          () => {
            fs.close();
          },
          log,
        );
      }
      if (probeSession) {
        const session = probeSession;
        await safeCleanup("close probe session (cancel)", () => closeCaptureSession(session), log);
      }
      if (!job.config.debug) {
        await safeCleanup(
          "remove workDir (cancel)",
          () => {
            rmSync(workDir, { recursive: true, force: true });
          },
          log,
        );
      }
      if (restoreLogger) restoreLogger();
      throw error instanceof RenderCancelledError
        ? error
        : new RenderCancelledError("render_cancelled");
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Suggest single-worker retry on parallel capture timeout.
    // Video-heavy compositions often cause multi-worker timeouts because
    // Chrome can't seek multiple video elements simultaneously.
    const isTimeoutError =
      errorMessage.includes("Waiting failed") ||
      errorMessage.includes("timeout exceeded") ||
      errorMessage.includes("Navigation timeout");
    const wasParallel = job.config.workers !== 1;
    if (isTimeoutError && wasParallel) {
      log.warn(
        `Parallel capture timed out with ${job.config.workers ?? "auto"} workers. ` +
          `Video-heavy compositions often need sequential capture. Retry with --workers 1`,
      );
    }

    job.error = errorMessage;
    updateJobStatus(job, "failed", `Failed: ${errorMessage}`, job.progress, onProgress);

    // Diagnostic summary
    const elapsed = Date.now() - pipelineStart;
    const freeMemMB = Math.round(freemem() / (1024 * 1024));

    // Populate structured error details for downstream consumers (SSE, sync response)
    job.failedStage = job.currentStage;
    job.errorDetails = {
      message: errorMessage,
      stack: errorStack,
      elapsedMs: elapsed,
      freeMemoryMB: freeMemMB,
      browserConsoleTail: lastBrowserConsole.length > 0 ? lastBrowserConsole.slice(-30) : undefined,
      perfStages: Object.keys(perfStages).length > 0 ? { ...perfStages } : undefined,
      hdrDiagnostics:
        hdrDiagnostics.videoExtractionFailures > 0 || hdrDiagnostics.imageDecodeFailures > 0
          ? { ...hdrDiagnostics }
          : undefined,
    };

    // Cleanup
    if (fileServer) {
      const fs = fileServer;
      await safeCleanup(
        "close file server (error)",
        () => {
          fs.close();
        },
        log,
      );
    }
    if (probeSession) {
      const session = probeSession;
      await safeCleanup("close probe session (error)", () => closeCaptureSession(session), log);
    }

    if (!job.config.debug) {
      await safeCleanup(
        "remove workDir (error)",
        () => {
          if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
        },
        log,
      );
    }

    if (restoreLogger) restoreLogger();
    throw error;
  } finally {
    clearInterval(memSamplerInterval);
  }
}
