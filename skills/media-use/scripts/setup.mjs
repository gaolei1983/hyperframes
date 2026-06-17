#!/usr/bin/env node
// media-use setup — the onboarding journey. Lazy-init the workspace, probe providers, declare the
// FREE tiers, and guide toward the heygen account ("one account for everything"). Never blocks:
// local-free works immediately; the heygen login is a nudge, not a gate.
// Usage:
//   node setup.mjs [--workspace <dir>]   → init + probe + declare tiers + print the journey
//   node setup.mjs --self-test           → assert the journey state across stubbed probes
import { readFileSync, writeFileSync } from "node:fs";
import { ensureWorkspace, probeProviders, parseArgs } from "./_ledger.mjs";

// Pure: probe → free tiers + journey state + readable lines. Testable with stubbed probes.
export function journeyFromProbe(p) {
  const hf = !!p.hyperframes?.cli;
  const heygen = !!p.heygen?.authed;
  const free = {
    local: { available: hf, caps: ["remove-bg", "transcribe", "tts"] }, // no account
    heygen: { unlocked: heygen, caps: ["search", "bgm"] }, // the free hook — needs a heygen account
  };
  let state, lines;
  if (heygen && hf) {
    state = "ready";
    lines = ["✓ Ready. Free now: search, bgm (heygen) + remove-bg, transcribe, tts (local)."];
  } else if (hf && !heygen) {
    state = "needs-heygen-login";
    lines = [
      "✓ Local free ready: remove-bg, transcribe, tts.",
      "🔑 search + bgm are FREE — run `heygen auth login` to unlock (one account for everything).",
    ];
  } else if (!hf && heygen) {
    state = "no-local";
    lines = [
      "✓ search, bgm ready (heygen).",
      "• install the hyperframes CLI to add local-free remove-bg / transcribe / tts.",
    ];
  } else {
    state = "bare";
    lines = [
      "Only the asset ledger is active.",
      "🔑 `heygen auth login` → free search + bgm.   • install hyperframes CLI → local remove-bg / transcribe / tts.",
    ];
  }
  return { state, free, lines };
}

const a = parseArgs(process.argv.slice(2));

if (a["self-test"]) {
  const cases = [
    {
      name: "authed + hyperframes",
      probe: { heygen: { authed: true }, hyperframes: { cli: true } },
      expect: "ready",
    },
    {
      name: "hyperframes only (THE FUNNEL)",
      probe: { heygen: { authed: false }, hyperframes: { cli: true } },
      expect: "needs-heygen-login",
    },
    {
      name: "heygen only",
      probe: { heygen: { authed: true }, hyperframes: { cli: false } },
      expect: "no-local",
    },
    {
      name: "bare",
      probe: { heygen: { authed: false }, hyperframes: { cli: false } },
      expect: "bare",
    },
  ];
  let fails = 0;
  for (const c of cases) {
    const j = journeyFromProbe(c.probe);
    const ok = j.state === c.expect;
    if (!ok) fails++;
    console.log(`${ok ? "✓" : "✗"} ${c.name}: state=${j.state} (expect ${c.expect})`);
    for (const l of j.lines) console.log(`      ${l}`);
  }
  console.log(`\n${cases.length} states · ${fails} failures`);
  process.exit(fails ? 1 : 0);
}

const ws = a.workspace || ".media-use-workspace";
const p = ensureWorkspace(ws);
const probe = probeProviders();
const j = journeyFromProbe(probe);

const cfg = JSON.parse(readFileSync(p.config, "utf8"));
cfg.providers = probe; // refresh
cfg.free = j.free;
cfg.setup_state = j.state;
writeFileSync(p.config, JSON.stringify(cfg, null, 2) + "\n");

console.log(j.lines.join("\n"));
console.log(`\nworkspace: ${ws}  ·  state: ${j.state}`);
