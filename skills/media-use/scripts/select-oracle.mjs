#!/usr/bin/env node
// Selection oracle — the "did it pick the RIGHT asset" eval (selection is the hard part).
// Reads a persisted resolve report (intent + candidates + pick); text-only LLM judge;
// multi-class verdict: correct / soft / wrong. The judge runs headless + isolated (same recipe as the
// trigger harness) so it doesn't drag in the dev's skills/memory.
// Usage: node select-oracle.mjs --report <.media/reports/resolve_*.json> [--rubric "..."]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
if (!a.report || a.report === true) {
  console.error("--report <path> required");
  process.exit(1);
}
const rep = JSON.parse(readFileSync(a.report, "utf8"));
const rubric =
  a.rubric && a.rubric !== true
    ? a.rubric
    : "Match the asset to the intent's mood / genre / subject; reject any candidate whose description contradicts the intent.";

const cands = (rep.candidates || [])
  .map(
    (c, i) =>
      `${i + 1}. id=${c.id} · ${c.name} · ${c.description || ""}${c.duration ? ` · ${c.duration}s` : ""}${c.score != null ? ` · score=${c.score}` : ""}`,
  )
  .join("\n");
const picked = (rep.candidates || []).find((c) => c.id === rep.picked);

const prompt = `You are scoring an asset-selection decision. Judge from the text only; do not use any tool.

INTENT: ${rep.intent}
RUBRIC: ${rubric}

CANDIDATES:
${cands}

PICKED: id=${rep.picked}${picked ? ` (${picked.name} — ${picked.description || ""})` : ""}

Is PICKED the best on-intent choice among the candidates?
- correct = clearly the best / fully on-intent
- soft = acceptable, but a clearly better candidate existed
- wrong = off-intent, or a clearly better candidate was ignored

Reply with ONE line of JSON ONLY: {"verdict":"correct|soft|wrong","reason":"<= 15 words"}`;

let raw;
try {
  raw = execFileSync(
    "claude",
    [
      "-p",
      prompt,
      "--max-turns",
      "1",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--permission-mode",
      "bypassPermissions",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
} catch (e) {
  raw = e.stdout || "";
  if (!raw) {
    console.error("judge failed: " + (e.stderr || e.message || "").slice(0, 200));
    process.exit(1);
  }
}

const m = raw.match(/\{[^{}]*"verdict"[^{}]*\}/);
const v = m ? JSON.parse(m[0]) : { verdict: "parse-error", reason: raw.slice(0, 120) };
console.log(JSON.stringify({ intent: rep.intent, picked: rep.picked, ...v }, null, 2));
process.exit(v.verdict === "parse-error" ? 1 : 0);
