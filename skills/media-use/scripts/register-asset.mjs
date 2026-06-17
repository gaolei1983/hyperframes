#!/usr/bin/env node
// Register (upsert) an AssetRecord into the manifest, then regenerate the index.
// Two input modes:
//   --json '{"asset_id":"…","type":"image","path":"…","source":"generated","status":"ready"}'
//   --file record.json
//   …or flags: --id --type --path --source --status --description --tags a,b --usage_intent --derived_from
// Usage: node register-asset.mjs --workspace <dir> [mode]
import { readFileSync } from "node:fs";
import { ensureWorkspace, upsert, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
ensureWorkspace(ws);

let record;
if (a.json && a.json !== true) record = JSON.parse(a.json);
else if (a.file && a.file !== true) record = JSON.parse(readFileSync(a.file, "utf8"));
else {
  record = {
    asset_id: a.id,
    type: a.type,
    path: a.path,
    source: a.source || "generated",
    status: a.status || "ready",
  };
  if (a.description) record.description = a.description;
  if (a.tags)
    record.tags = String(a.tags)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  if (a.usage_intent) record.usage_intent = a.usage_intent;
  if (a.derived_from) record.provenance = { derived_from: a.derived_from };
}

try {
  const saved = upsert(ws, record);
  console.log(JSON.stringify({ ok: true, registered: saved.asset_id, workspace: ws }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(1);
}
