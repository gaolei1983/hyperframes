#!/usr/bin/env node
// select-sheet — agent-native SELECTION affordance (be-the-boat). media-use does NOT pick the asset;
// it lays the candidates out so the MAIN AGENT can pick by looking. It builds a numbered contact-sheet
// montage of the search candidates (1x3 / 2x2 / 3x2 by count), each cell stamped with its index in the
// top-left, and emits a text candidate table for text-layer rerank. The agent views the montage, decides
// the best-fit index, then freezes it with `resolve --url <that candidate's url>`.
//
// Why this is the boat: selection stays a MODEL decision through a stable affordance. A smarter model (or
// one with better vision) picks better through the SAME montage — no code change. The opposite (--auto
// top-1) is a rock: it caps quality at "first result" and never improves.
//
// Usage: MEDIA_USE_SEARCH_CMD=... node select-sheet.mjs --workspace <ws> --query "OpenAI logo" [--media image] [--num 6]
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "./_ledger.mjs";

const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";
const CELL = 440;

function run(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
async function dl(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (media-use/0.1)" } });
  if (!r.ok) throw new Error("HTTP" + r.status);
  return Buffer.from(await r.arrayBuffer());
}

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace && a.workspace !== true ? a.workspace : ".media-use-workspace";
const query = a.query && a.query !== true ? a.query : a.intent;
if (!query || query === true) {
  console.error("--query (or --intent) required");
  process.exit(1);
}
const media = a.media && a.media !== true ? a.media : "image";
const num = a.num && a.num !== true ? Math.min(6, Number(a.num)) : 6;
const cmd = process.env.MEDIA_USE_SEARCH_CMD;
if (!cmd) {
  console.error("MEDIA_USE_SEARCH_CMD not set");
  process.exit(1);
}

// 1) search
let res;
try {
  const out = run(cmd, ["--query", query, "--media", media, "--num", String(num)]);
  res = JSON.parse(out.trim().split("\n").pop());
} catch (e) {
  console.error("search failed: " + (e.stderr || e.message || e));
  process.exit(1);
}
const cands = (res.candidates || []).slice(0, 6).map((c, i) => ({
  index: i + 1,
  url: c.url,
  thumbnail: c.thumbnail || c.url,
  width: c.width,
  height: c.height,
  title: c.title,
  provider: c.provider,
  host: hostOf(c.url),
}));
if (!cands.length) {
  console.log(JSON.stringify({ ok: true, query, candidates: [], montage: null, note: "0 candidates" }, null, 2));
  process.exit(0);
}

// 2) numbered cells (download thumb → scale+pad+stamp index; placeholder on failure, keeps index aligned)
const dir = join(ws, ".media/sheets");
const cellDir = join(dir, `cells_${slug(query)}`);
rmSync(cellDir, { recursive: true, force: true });
mkdirSync(cellDir, { recursive: true });
for (const c of cands) {
  const cell = join(cellDir, `cell-${String(c.index).padStart(2, "0")}.png`);
  const stamp = `drawtext=fontfile=${FONT}:text='${c.index}':x=16:y=12:fontsize=58:fontcolor=white:box=1:boxcolor=0x000000@0.7:boxborderw=14`;
  try {
    const tmp = join(cellDir, `raw-${c.index}`);
    writeFileSync(tmp, await dl(c.thumbnail));
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp,
      "-vf", `scale=${CELL}:${CELL}:force_original_aspect_ratio=decrease,pad=${CELL}:${CELL}:(ow-iw)/2:(oh-ih)/2:color=0x1b1812,${stamp}`,
      "-frames:v", "1", cell]);
    rmSync(tmp, { force: true });
  } catch {
    c.preview = false;
    run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x332f26:s=${CELL}x${CELL}`,
      "-vf", `${stamp},drawtext=fontfile=${FONT}:text='no preview':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=30:fontcolor=0x9a9282`,
      "-frames:v", "1", cell]);
  }
}

// 3) tile by count: <=3 → Nx1 ; 4 → 2x2 ; 5-6 → 3x2
const n = cands.length;
const [cols, rows] = n <= 3 ? [n, 1] : n === 4 ? [2, 2] : [3, 2];
const montage = join(dir, `montage_${slug(query)}.png`);
run("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "1", "-start_number", "1", "-i", join(cellDir, "cell-%02d.png"),
  "-frames:v", "1", "-vf", `tile=${cols}x${rows}:padding=10:color=0x111111`, montage]);

writeFileSync(join(dir, `sheet_${slug(query)}.json`), JSON.stringify({ query, media, candidates: cands }, null, 2));

// Output: the montage path (agent reads it to pick) + the text candidate table (text-layer rerank).
console.log(JSON.stringify({
  ok: true,
  query,
  grid: `${cols}x${rows}`,
  montage,
  hint: "view the montage, choose the best-fit index, then: resolve --type image --url <candidates[i].url> --entity <name>",
  candidates: cands.map((c) => ({ index: c.index, host: c.host, dims: c.width && c.height ? `${c.width}x${c.height}` : "?", title: c.title || null, preview: c.preview !== false, url: c.url })),
}, null, 2));
