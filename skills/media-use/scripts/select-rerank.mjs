#!/usr/bin/env node
// select-rerank — SELECTION method 2 (text-layer rerank). Distinct from select-sheet (vision montage).
// Each candidate gets a detailed vision caption, then the PICK happens in the TEXT layer (rerank over the
// descriptions + intent), decoupled from looking. Auditable (the reasoning is text), swappable (you can
// fold in brand rules / usage history as text signals), and headless-friendly (no human views an image).
// be-the-boat: both the describe step and the rerank step are model calls through a stable affordance —
// a better model writes better captions and reranks better, no code change.
//
// Usage: MEDIA_USE_SEARCH_CMD=... node select-rerank.mjs --workspace <ws> --query "OpenAI logo" [--num 6]
//
// --describe-only (agent-first mode): search + caption (cached) + build a numbered montage, but make NO
// pick — the MAIN agent reads the descriptions / views the montage and decides. The inline rerank pick
// below is the headless fallback only.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "./_ledger.mjs";

function run(bin, args, opts) {
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...(opts || {}) });
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
function extOf(u) { const m = u.split("?")[0].match(/\.(jpg|jpeg|png|webp|gif)$/i); return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg"; }
async function dl(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (media-use/0.1)" } });
  if (!r.ok) throw new Error("HTTP" + r.status);
  return Buffer.from(await r.arrayBuffer());
}
function claude(prompt, extra) {
  const base = ["-p", prompt, "--setting-sources", "project", "--permission-mode", "bypassPermissions"];
  try { return run("claude", base.concat(extra || [])); } catch (e) { return (e.stdout || "").toString(); }
}

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace && a.workspace !== true ? a.workspace : ".media-use-workspace";
const query = a.query && a.query !== true ? a.query : a.intent;
if (!query || query === true) { console.error("--query required"); process.exit(1); }
const media = a.media && a.media !== true ? a.media : "image";
const num = a.num && a.num !== true ? Math.min(6, Number(a.num)) : 6;
const describeOnly = !!a["describe-only"];
const cmd = process.env.MEDIA_USE_SEARCH_CMD;
if (!cmd) { console.error("MEDIA_USE_SEARCH_CMD not set"); process.exit(1); }

// Caption cache: text-ify each image ONCE at search time, keyed by URL, and persist.
// Rerank/reuse later compare only the stored text — same image never re-visioned. Lives in the personal
// scope so it amortizes across every project/video.
const CACHE_PATH = join(process.env.MEDIA_USE_HOME || join(homedir(), ".media"), ".captions.json");
let capCache = {};
try { if (existsSync(CACHE_PATH)) capCache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); } catch {}
let cacheDirty = false;

// 1) search
let res;
try { res = JSON.parse(run(cmd, ["--query", query, "--media", media, "--num", String(num)]).trim().split("\n").pop()); }
catch (e) { console.error("search failed: " + (e.stderr || e.message)); process.exit(1); }
const cands = (res.candidates || []).slice(0, 6).map((c, i) => ({ index: i + 1, url: c.url, thumbnail: c.thumbnail || c.url, width: c.width, height: c.height, host: hostOf(c.url) }));
if (!cands.length) { console.log(JSON.stringify({ ok: true, query, candidates: [], pick: null, note: "0 candidates" }, null, 2)); process.exit(0); }

// 2) vision caption per candidate → detailed text description
const dir = join(ws, ".media/sheets", `rerank_${slug(query)}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const c of cands) {
  const cached = !!capCache[c.url];
  // download the thumb when we need it: for captioning (cache miss) or for the montage (describe-only)
  if (!cached || describeOnly) {
    try {
      const f = join(dir, `cand-${String(c.index).padStart(2, "0")}.${extOf(c.thumbnail)}`);
      writeFileSync(f, await dl(c.thumbnail));
      c.file = f;
    } catch {
      c.preview = false;
    }
  }
  if (cached) {
    c.description = capCache[c.url]; // already text-ified — reuse the stored caption, no re-vision
    c.cached = true;
    continue;
  }
  if (!c.file) {
    c.description = "(no preview — host blocked download)";
    continue;
  }
  const out = claude(
    `Read the image at ${c.file}. In <=45 words describe it as an asset candidate for the intent "${query}": what it depicts, its TYPE (clean logo / real photograph / official render / portrait / screenshot / chart / illustration / article-thumbnail / spec-sheet collage), the background, and EVERY quality issue — watermark, OVERLAID TEXT of any kind (title text, graffiti wordmark, captions ON the image), play-button overlay, busy collage, low-res, off-topic. Distinguish a real photograph from a render. Reply with ONLY the description sentence.`,
    ["--allowedTools", "Read", "--max-turns", "3"],
  );
  c.description = out.trim().split("\n").filter(Boolean).pop() || "(no description)";
  capCache[c.url] = c.description; // store the text-ified image info for all future reranks
  cacheDirty = true;
}
if (cacheDirty) {
  try { mkdirSync(dirname(CACHE_PATH), { recursive: true }); writeFileSync(CACHE_PATH, JSON.stringify(capCache, null, 2)); } catch {}
}

// AGENT-FIRST exit: emit descriptions + a numbered montage, make NO pick (the main agent decides).
if (describeOnly) {
  const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";
  const CELL = 440;
  let montage = null;
  try {
    for (const c of cands) {
      const cell = join(dir, `cell-${String(c.index).padStart(2, "0")}.png`);
      const stamp = `drawtext=fontfile=${FONT}:text='${c.index}':x=16:y=12:fontsize=58:fontcolor=white:box=1:boxcolor=0x000000@0.7:boxborderw=14`;
      if (c.file) {
        run("ffmpeg", ["-y", "-loglevel", "error", "-i", c.file,
          "-vf", `scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=0x1b1812,${stamp}`,
          "-frames:v", "1", cell]);
      } else {
        run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x332f26:s=${CELL}x${CELL}`,
          "-vf", `${stamp},drawtext=fontfile=${FONT}:text='no preview':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=30:fontcolor=0x9a9282`,
          "-frames:v", "1", cell]);
      }
    }
    const n = cands.length;
    const [cols, rows] = n <= 3 ? [n, 1] : n === 4 ? [2, 2] : [3, 2];
    montage = join(dir, `montage_${slug(query)}.png`);
    run("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1", "-start_number", "1", "-i", join(dir, "cell-%02d.png"),
      "-frames:v", "1", "-vf", `tile=${cols}x${rows}:padding=10:color=0x111111`, montage]);
  } catch {
    montage = null; // montage is a bonus affordance; descriptions alone are enough to decide
  }
  console.log(JSON.stringify({
    ok: true, query, method: "describe-only", montage,
    candidates: cands.map((c) => ({ index: c.index, host: c.host, dims: c.width && c.height ? `${c.width}x${c.height}` : "?", description: c.description, url: c.url, cached: !!c.cached, preview: c.preview !== false })),
    hint: "MAIN AGENT decides: read the descriptions (and/or view the montage), then put the chosen url in a decisions file for resolve-scenes --apply-decisions",
  }, null, 2));
  process.exit(0);
}

// 3) text-layer rerank (no image): pick best-fit from descriptions + intent
const list = cands.map((c) => `${c.index}. [${c.host}, ${c.width && c.height ? c.width + "x" + c.height : "?"}] ${c.description}`).join("\n");
const raw = claude(
  `You are reranking asset candidates for the intent: "${query}". Judge from the DESCRIPTIONS only.\n\nCANDIDATES:\n${list}\n\nRank best-fit first and pick the single best. Prefer: on-intent subject, clean/usable (a real logo over an article thumbnail; a clear portrait over a busy collage), good resolution, neutral background. Reply with ONE line of JSON: {"ranked":[indices high→low],"pick":<index>,"reason":"<=18 words"}`,
  ["--max-turns", "1", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'],
);
const m = raw.match(/\{[\s\S]*"pick"[\s\S]*\}/);
const verdict = m ? JSON.parse(m[0]) : { ranked: cands.map((c) => c.index), pick: cands[0].index, reason: "parse-error → top-1 fallback" };
const picked = cands.find((c) => c.index === verdict.pick) || cands[0];

writeFileSync(join(dir, "rerank.json"), JSON.stringify({ query, candidates: cands, verdict }, null, 2));
console.log(JSON.stringify({
  ok: true, query, method: "text-rerank",
  candidates: cands.map((c) => ({ index: c.index, host: c.host, description: c.description, url: c.url })),
  ranked: verdict.ranked, pick: verdict.pick, reason: verdict.reason, picked_url: picked.url, picked_description: picked.description,
  cached_count: cands.filter((c) => c.cached).length,
  hint: `freeze with: resolve --type image --url "${picked.url}" --entity <name>`,
}, null, 2));
