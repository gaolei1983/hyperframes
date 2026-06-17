#!/usr/bin/env node
// process — transform an existing asset (free / local first), write to .media/processed/,
// then register a new AssetRecord with provenance.derived_from pointing at the input. See references/process.md.
//
// v0.1: remove-bg (hyperframes remove-background) + transcribe (hyperframes transcribe). Both local + free.
//
// Usage:
//   node process.mjs --workspace <dir> --asset <id> --action remove-bg [--output .media/processed/foo.png]
//   node process.mjs --workspace <dir> --asset <id> --action transcribe [--model small.en]
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { ensureWorkspace, upsert, readManifest, parseArgs } from "./_ledger.mjs";

function run(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: String(msg) }));
  process.exit(1);
}

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
ensureWorkspace(ws);

const id = a.asset;
if (!id || id === true) fail("--asset <id> is required");
const action = String(a.action || "");
const input = readManifest(ws).find((r) => r.asset_id === id);
if (!input) fail(`asset not found in manifest: ${id}`);
const inAbs = join(ws, input.path);
if (!existsSync(inAbs)) fail(`asset file missing on disk: ${input.path}`);

if (action === "remove-bg" || action === "remove-background") {
  const isVideo = [".mp4", ".mov", ".webm", ".mkv"].includes(extname(inAbs).toLowerCase());
  const outExt = isVideo ? ".webm" : ".png"; // transparent webm for video, transparent png for image
  const asset_id = `${id}_cutout`;
  const rel = a.output && a.output !== true ? a.output : `.media/processed/${asset_id}${outExt}`;
  const out = join(ws, rel);
  mkdirSync(dirname(out), { recursive: true });
  try {
    run("hyperframes", ["remove-background", inAbs, "-o", out, "--json"]);
  } catch (e) {
    fail(`hyperframes remove-background failed: ${e.message || e}`);
  }
  const saved = upsert(ws, {
    asset_id,
    type: isVideo ? "video" : "image",
    path: rel,
    source: "processed",
    status: "ready",
    description: `${input.description || id} — background removed`,
    tags: [...new Set([...(input.tags || []), "cutout", "alpha"])],
    provenance: { provider: "hyperframes.remove-background", derived_from: id },
    metadata: { has_alpha: true },
  });
  console.log(
    JSON.stringify({ ok: true, registered: saved.asset_id, path: rel, derived_from: id }, null, 2),
  );
} else if (action === "transcribe") {
  const model = a.model && a.model !== true ? a.model : "small.en";
  let status;
  try {
    status = JSON.parse(run("hyperframes", ["transcribe", inAbs, "--model", model, "--json"]));
  } catch (e) {
    fail(`hyperframes transcribe failed: ${e.message || e}`);
  }
  // `transcribe --json` prints a STATUS summary; the transcript itself lands at status.transcriptPath
  // (a generic name next to the input — collides on repeat). Move it to a stable per-asset path.
  const asset_id = `${id}_transcript`;
  const rel = `.media/processed/${asset_id}.json`;
  const out = join(ws, rel);
  mkdirSync(dirname(out), { recursive: true });
  if (status.transcriptPath && existsSync(status.transcriptPath)) {
    copyFileSync(status.transcriptPath, out);
    rmSync(status.transcriptPath, { force: true });
  } else {
    writeFileSync(out, JSON.stringify(status) + "\n"); // fallback: persist what we got
  }
  const saved = upsert(ws, {
    asset_id,
    type: "text",
    path: rel,
    source: "processed",
    status: "ready",
    description: `Transcript of ${id} (whisper ${model}, ${status.wordCount ?? "?"} words)`,
    tags: ["transcript"],
    provenance: { provider: "hyperframes.transcribe", model, derived_from: id },
    metadata: { duration: status.durationSeconds },
  });
  console.log(
    JSON.stringify({ ok: true, registered: saved.asset_id, path: rel, derived_from: id }, null, 2),
  );
} else {
  fail(
    `unsupported --action '${action}'. v0.1: remove-bg | transcribe (see references/process.md)`,
  );
}
