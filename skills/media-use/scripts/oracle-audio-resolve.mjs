#!/usr/bin/env node
// Oracle (the SPEC) for the v0.1 audio-catalog resolve contract: bgm + sfx, both via
// `heygen audio sounds list`. Eval-first — run this BEFORE implementing sfx to prove it FAILS,
// then implement `--type sfx` in resolve.mjs until it PASSES.
//
// Integration oracle: it really calls the heygen catalog and really downloads the pick, so it
// verifies the whole search -> select -> freeze -> register -> report chain end to end. Asserts are
// STRUCTURAL (no specific track ids), so catalog changes don't make it flaky.
//
// Selection *quality* (did it pick the RIGHT clip) is a separate, already-built eval: select-oracle.mjs.
//
// Usage: node scripts/oracle-audio-resolve.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resolve = join(here, "resolve.mjs");

// SFX_MAX_DUR encodes the selection nuance we verified: SFX clips live in the music catalog and must
// be biased short (1-10s), or `--auto` would grab a 70s "music" track for a "whoosh" query.
const SFX_MAX_DUR = 15;

const CASES = [
  { type: "bgm", intent: "subtle confident tech launch", dir: ".media/audio/bgm" },
  { type: "sfx", intent: "short whoosh for a scene transition", dir: ".media/audio/sfx", maxDur: SFX_MAX_DUR },
  // This UI-sound query returned EMPTY at heygen's default min-score 0.7 — it locks the min-score fix.
  { type: "sfx", intent: "ui click confirmation tone", dir: ".media/audio/sfx", maxDur: SFX_MAX_DUR },
];

let allPass = true;
for (const c of CASES) {
  const ws = mkdtempSync(join(tmpdir(), `mu-oracle-${c.type}-`));
  const problems = [];
  let out;
  try {
    const raw = execFileSync(
      "node",
      [resolve, "--workspace", ws, "--type", c.type, "--intent", c.intent, "--auto"],
      { encoding: "utf8" },
    );
    out = JSON.parse(raw);
  } catch (e) {
    out = { ok: false, error: (e.stdout || e.stderr || e.message || "").toString().trim().slice(0, 200) };
  }

  if (out.ok !== true) {
    problems.push(`resolve not ok: ${out.error || "?"}`);
  } else {
    if (!out.registered) problems.push("nothing registered");
    if (!out.path) problems.push("no path returned");
    else if (!out.path.startsWith(c.dir)) problems.push(`froze into ${out.path} (want ${c.dir}/)`);
    else if (!existsSync(join(ws, out.path))) problems.push(`frozen file missing on disk: ${out.path}`);

    const repDir = join(ws, ".media", "reports");
    const reps = existsSync(repDir) ? readdirSync(repDir).filter((f) => f.startsWith("resolve_")) : [];
    if (!reps.length) {
      problems.push("no resolve report written (selection trace)");
    } else {
      const rep = JSON.parse(readFileSync(join(repDir, reps[0]), "utf8"));
      if (!Array.isArray(rep.candidates) || rep.candidates.length === 0) problems.push("report has no candidates");
      if (!rep.picked) problems.push("report records no pick");
      if (c.maxDur != null) {
        const picked = (rep.candidates || []).find((x) => x.id === rep.picked);
        if (picked && picked.duration != null && picked.duration > c.maxDur)
          problems.push(`sfx pick ${picked.duration}s > ${c.maxDur}s — must bias to short clips`);
      }
    }
  }

  const pass = problems.length === 0;
  allPass = allPass && pass;
  console.log(`${pass ? "PASS" : "FAIL"}  resolve --type ${c.type}  "${c.intent}"`);
  if (pass) console.log(`        registered=${out.registered}  path=${out.path}`);
  else problems.forEach((p) => console.log(`        - ${p}`));
}

console.log(allPass ? "\nORACLE: PASS" : "\nORACLE: FAIL");
process.exit(allPass ? 0 : 1);
