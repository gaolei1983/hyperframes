#!/usr/bin/env node
// Ledger oracle — assert a media-use workspace's manifest is well-formed and FROZEN.
// This is the "organize correct" eval: it defines DONE for organize/freeze and gates regressions.
// Exit 1 if anything fails. Usage: node validate-manifest.mjs --workspace <dir>
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { readManifest, REQUIRED, parseArgs } from "./_ledger.mjs";

const TYPES = ["image", "audio", "bgm", "sfx", "video", "voice", "text", "unknown"];

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const recs = readManifest(ws);
const ids = new Set(recs.map((r) => r.asset_id));

const fails = [];
const fail = (id, msg) => fails.push(`✗ ${id}: ${msg}`);

for (const r of recs) {
  const id = r.asset_id || "(no id)";
  for (const k of REQUIRED) {
    if (r[k] === undefined || r[k] === null || r[k] === "")
      fail(id, `missing required field '${k}'`);
  }
  if (r.type && !TYPES.includes(r.type)) fail(id, `unknown type '${r.type}'`);
  if (r.path) {
    if (/^https?:\/\//.test(r.path))
      fail(id, `path is a remote URL — must freeze locally: ${r.path}`);
    else if (isAbsolute(r.path))
      fail(id, `path is absolute — must be workspace-relative: ${r.path}`);
    else if (!existsSync(join(ws, r.path))) fail(id, `file missing on disk: ${r.path}`);
  }
  const df = r.provenance?.derived_from;
  if (r.source === "processed" && !df) fail(id, `source=processed but no provenance.derived_from`);
  if (df && !ids.has(df)) fail(id, `derived_from '${df}' not found in manifest`);
}

console.log(fails.length ? fails.join("\n") : "(no issues)");
console.log(`\n${recs.length} records · ${fails.length} failures`);
process.exit(fails.length ? 1 : 0);
