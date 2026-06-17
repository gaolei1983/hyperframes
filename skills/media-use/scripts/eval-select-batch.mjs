#!/usr/bin/env node
// Batch SELECTION-QUALITY eval for the BGM/SFX MVP. The contract oracle (oracle-audio-resolve) proves the
// search->freeze->register chain RUNS; this proves it PICKS WELL. For each intent: resolve --auto -> read the
// decision report -> select-oracle (LLM judge) -> collect correct/soft/wrong. Live (heygen catalog + claude judge).
//
// Usage: node scripts/eval-select-batch.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resolveMjs = join(here, "resolve.mjs");
const selectOracle = join(here, "select-oracle.mjs");

const CASES = [
  { type: "bgm", intent: "subtle confident tech launch" },
  { type: "bgm", intent: "energetic upbeat product reveal" },
  { type: "bgm", intent: "calm ambient background for a tutorial" },
  { type: "bgm", intent: "dramatic cinematic trailer build-up" },
  { type: "sfx", intent: "short whoosh for a scene transition" },
  { type: "sfx", intent: "ui click confirmation tone" },
  { type: "sfx", intent: "success chime notification ding" },
];

const rows = [];
for (const c of CASES) {
  const ws = mkdtempSync(join(tmpdir(), "mu-selbatch-"));
  let verdict = "error", reason = "", track = "";
  try {
    const out = JSON.parse(
      execFileSync("node", [resolveMjs, "--workspace", ws, "--type", c.type, "--intent", c.intent, "--auto"], {
        encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      }).trim(),
    );
    track = out.track || out.path || "";
    const repDir = join(ws, ".media-use", "reports");
    const rep = existsSync(repDir) ? readdirSync(repDir).find((f) => f.startsWith("resolve_")) : null;
    if (!rep) {
      reason = "no decision report written";
    } else {
      const j = JSON.parse(
        execFileSync("node", [selectOracle, "--report", join(repDir, rep)], {
          encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
        }).trim(),
      );
      verdict = j.verdict;
      reason = j.reason || "";
    }
  } catch (e) {
    reason = (e.stdout || e.stderr || e.message || "").toString().replace(/\s+/g, " ").trim().slice(0, 120);
  }
  const mark = verdict === "correct" ? "✓" : verdict === "soft" ? "~" : "✗";
  console.log(`${mark} [${c.type}] "${c.intent}"  ->  ${verdict}  (${track})${reason ? "  - " + reason : ""}`);
  rows.push({ ...c, verdict, reason });
}

const n = rows.length;
const k = (v) => rows.filter((r) => r.verdict === v).length;
const correct = k("correct"), soft = k("soft"), wrong = k("wrong");
const err = n - correct - soft - wrong;
console.log(`\nSELECT BATCH: ${correct} correct · ${soft} soft · ${wrong} wrong · ${err} error  (of ${n})`);
process.exit(wrong + err > 0 ? 1 : 0);
