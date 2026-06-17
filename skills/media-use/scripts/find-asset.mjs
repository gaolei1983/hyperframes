#!/usr/bin/env node
// "grep for media" — query the manifest by type / tag / free-text.
// Usage: node find-asset.mjs --workspace <dir> [--type image] [--tag logo] [--query "previous bgm"] [--human]
import { find, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const recs = find(ws, { type: a.type, tag: a.tag, query: a.query });

if (a.human) {
  for (const r of recs) console.log(`${r.asset_id}\t${r.type}\t${r.status}\t${r.path}`);
  if (!recs.length) console.error("(no matches)");
} else {
  console.log(JSON.stringify(recs, null, 2));
}
