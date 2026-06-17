#!/usr/bin/env node
// Oracle (the SPEC) for the design: UNIFIED asset management via ONE `.media/` folder.
// Validates the three design pillars + the purpose — "record the trace and the records, completely & correctly":
//   I1  project   <proj>/.media/manifest.jsonl   is the asset-record ledger        (pillar 1 — project tier)
//   I2  global    <root>/.media/manifest.jsonl   mirrors reusable records          (pillar 1 — global tier)
//   I3  manifest = SSOT: exactly one record per managed asset                       (pillar 2)
//   I4  each record carries per-asset METADATA (type + format metadata, e.g. duration) (pillar 3)
//   I5  record.path resolves to a real file on disk
//   I6  COMPLETE project trace: a HOST-owned asset (registered with its OWN path, e.g. public/…)
//       lands in the SAME .media/ ledger as media-use's own assets — one ledger covers the whole project,
//       not a parallel silo. (Validates the ledger CAN hold host assets; the bridge that AUTO-registers
//       them when embedded is a separate integration — tracked in the PRD.)
// Offline + deterministic (register-asset + promote-personal; no network). Run on every change.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const S = (n) => join(here, n);
const proj = mkdtempSync(join(tmpdir(), "media-fold-proj-"));
const root = mkdtempSync(join(tmpdir(), "media-fold-root-")); // stands in for the global/personal .media home

function touch(ws, rel) { const p = join(ws, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, "x"); return rel; }
function sh(script, args) { try { return execFileSync("node", [S(script), ...args], { encoding: "utf8" }); } catch (e) { return (e.stdout || e.stderr || e.message || "").toString(); } }
function readManifest(p) { return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : null; }

// (1) a media-use-owned asset frozen under .media/   (2) a HOST-owned asset that lives outside .media/ (public/)
touch(proj, ".media/audio/bgm/bgm_001.mp3");
sh("register-asset.mjs", ["--workspace", proj, "--json", JSON.stringify({
  asset_id: "bgm_001", type: "bgm", path: ".media/audio/bgm/bgm_001.mp3", source: "search", status: "ready",
  description: "calm ambient tech", metadata: { duration: 42 }, reusable: true,
})]);
touch(proj, "public/logo.png");
sh("register-asset.mjs", ["--workspace", proj, "--json", JSON.stringify({
  asset_id: "host_logo", type: "image", path: "public/logo.png", source: "project_output", status: "ready",
  description: "host-owned brand logo", metadata: { width: 512, height: 512 },
})]);
// promote the media-use asset to the global tier
sh("promote-personal.mjs", ["--workspace", proj, "--asset", "bgm_001", "--home", root]);

const inv = [];
const add = (id, desc, pass, note) => inv.push({ id, desc, pass, note });

const projMan = readManifest(join(proj, ".media", "manifest.jsonl"));
add("I1", "project `.media/manifest.jsonl` is the ledger", !!projMan, projMan ? `${projMan.length} records` : "missing");
add("I2", "global `.media/manifest.jsonl` mirrors reusable", existsSync(join(root, ".media", "manifest.jsonl")), existsSync(join(root, ".media", "manifest.jsonl")) ? "present" : "missing");
const bgm = (projMan || []).find((r) => r.asset_id === "bgm_001");
add("I3", "manifest = SSOT (one record per asset)", !!bgm && (projMan || []).filter((r) => r.asset_id === "bgm_001").length === 1, bgm ? "1 record" : "no record");
add("I4", "record carries metadata (type + duration)", !!(bgm && bgm.type === "bgm" && bgm.metadata && bgm.metadata.duration != null), bgm ? `metadata=${JSON.stringify(bgm.metadata || {})}` : "no record");
add("I5", "record.path resolves to a real file", !!(bgm && existsSync(join(proj, bgm.path))), bgm ? `path=${bgm.path}` : "no record");
const host = (projMan || []).find((r) => r.asset_id === "host_logo");
add("I6", "COMPLETE trace: host-owned asset in the SAME ledger", !!(host && host.path === "public/logo.png" && existsSync(join(proj, host.path))), host ? `host asset recorded @ ${host.path}` : "host asset NOT in the .media/ ledger");

let pass = 0;
for (const i of inv) { if (i.pass) pass++; console.log(`${i.pass ? "PASS" : "GAP "}  ${i.id}  ${i.desc}${i.note ? "  — " + i.note : ""}`); }
console.log(`\n.media UNIFIED-MGMT ORACLE: ${pass}/${inv.length} invariants met`);
process.exit(pass === inv.length ? 0 : 1);
