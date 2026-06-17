// media-use ledger helpers — zero-dependency node ESM.
// The workspace is the interface: .media/manifest.jsonl is the source of truth,
// .media/index.md is a generated, agent-readable view. The unified .media/ folder
// (present at BOTH the project and the global/personal tier) holds the ledger, each
// asset's metadata, config, and the decision traces (reports/). These helpers are the
// thin bookkeeping layer behind the setup / organize / find verbs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const SUBDIRS = [
  ".media/raw",
  ".media/generated",
  ".media/images",
  ".media/icons",
  ".media/processed",
  ".media/audio/bgm",
  ".media/audio/sfx",
  ".media/audio/voice",
  ".media/preview",
  ".media/reports",
  ".media/snippets",
];

export const REQUIRED = ["asset_id", "type", "path", "source", "status"];

export const DEFAULT_CONFIG = {
  profile: "free-first",
  default_provider: "free-first",
  auto_register_outputs: true,
  composition_ref_policy: "project_local_asset_id",
};

// PATH scan, no spawn — best-effort "is this binary available".
function onPath(bin) {
  return (process.env.PATH || "").split(":").some((d) => d && existsSync(join(d, bin)));
}

// What the agent can currently use. fs/env only; the skill never hardcodes model state.
export function probeProviders() {
  const heygenAuthed =
    existsSync(join(homedir(), ".heygen/credentials")) || !!process.env.HEYGEN_API_KEY;
  return {
    heygen: {
      cli: onPath("heygen"),
      authed: heygenAuthed,
      capabilities: heygenAuthed
        ? ["tts (voice speech)", "bgm (audio sounds)", "asset upload"]
        : [],
    },
    hyperframes: {
      cli: onPath("hyperframes"),
      capabilities: ["tts", "transcribe", "remove-background"],
    },
    elevenlabs: { key: !!process.env.ELEVENLABS_API_KEY },
    local: { ffmpeg: onPath("ffmpeg"), python3: onPath("python3") },
  };
}

// Write .media/config.json once (defaults + a provider probe). Idempotent.
export function ensureConfig(ws) {
  const cfg = join(ws, ".media/config.json");
  if (!existsSync(cfg)) {
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(
      cfg,
      JSON.stringify({ ...DEFAULT_CONFIG, providers: probeProviders() }, null, 2) + "\n",
    );
  }
  return cfg;
}

export function paths(ws) {
  return { ws, manifest: join(ws, ".media/manifest.jsonl"), index: join(ws, ".media/index.md") };
}

export function ensureWorkspace(ws) {
  for (const d of SUBDIRS) mkdirSync(join(ws, d), { recursive: true });
  const p = paths(ws);
  if (!existsSync(p.manifest)) writeFileSync(p.manifest, "");
  if (!existsSync(p.index)) renderIndex(ws);
  p.config = ensureConfig(ws);
  return p;
}

export function readManifest(ws) {
  const { manifest } = paths(ws);
  if (!existsSync(manifest)) return [];
  return readFileSync(manifest, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function writeManifest(ws, records) {
  const { manifest } = paths(ws);
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(
    manifest,
    records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""),
  );
}

// Upsert by asset_id (re-runs are idempotent), then regenerate the index.
export function upsert(ws, record) {
  for (const k of REQUIRED) {
    if (record[k] === undefined || record[k] === null || record[k] === "") {
      throw new Error(`AssetRecord missing required field: ${k}`);
    }
  }
  const records = readManifest(ws);
  const i = records.findIndex((r) => r.asset_id === record.asset_id);
  if (i >= 0) records[i] = record;
  else records.push(record);
  writeManifest(ws, records);
  renderIndex(ws);
  return record;
}

export function renderIndex(ws) {
  const { index } = paths(ws);
  const records = readManifest(ws);
  const cell = (s) =>
    String(s ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
  const rows = records
    .map((r) => {
      const src = r.provenance?.derived_from
        ? `${r.source} (← ${r.provenance.derived_from})`
        : r.source;
      return `| ${cell(r.asset_id)} | ${cell(r.type)} | ${cell(r.path)} | ${cell(src)} | ${cell(r.usage_intent || "—")} | ${cell(r.status)} | ${cell((r.description || "").slice(0, 80))} |`;
    })
    .join("\n");
  const counts = {};
  for (const r of records) counts[r.source] = (counts[r.source] || 0) + 1;
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(" · ");
  const md =
    `# Assets — index (generated)\n\n` +
    `> Generated from \`.media/manifest.jsonl\` by media-use. Do not hand-edit.\n\n` +
    `| asset_id | type | path | source | usage_intent | status | description |\n` +
    `| --- | --- | --- | --- | --- | --- | --- |\n` +
    `${rows}\n\n` +
    `_${records.length} assets${summary ? ` · ${summary}` : ""}_\n`;
  mkdirSync(dirname(index), { recursive: true });
  writeFileSync(index, md);
  return index;
}

export function find(ws, { type, tag, query } = {}) {
  let recs = readManifest(ws);
  if (type) recs = recs.filter((r) => r.type === type);
  if (tag) recs = recs.filter((r) => (r.tags || []).includes(tag));
  if (query) {
    const q = String(query).toLowerCase();
    recs = recs.filter((r) =>
      `${r.asset_id} ${r.description || ""} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q),
    );
  }
  return recs;
}

// Minimal --key value / --flag parser (no deps).
export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const next = argv[i + 1];
      a[k] = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
    }
  }
  return a;
}
