#!/usr/bin/env node
// Promote a project asset into the PERSONAL store (~/.media/) — the per-user, cross-project layer.
// (Personal is just another media-use ledger, at the user's home; it holds its OWN copies so it stays
// independent of any single project. resolve checks it after the project ledger, before service search.)
// Copies the frozen file + registers it in the personal ledger (reusable=true, used_in=[project]).
// Usage: node promote-personal.mjs --workspace <project> --asset <id> [--home <dir>]
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readManifest, ensureWorkspace, upsert, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const home = a.home && a.home !== true ? a.home : join(homedir(), ".media");
const id = a.asset;
if (!id || id === true) {
  console.error("--asset <id> required");
  process.exit(1);
}

const rec = readManifest(ws).find((r) => r.asset_id === id);
if (!rec) {
  console.error(`asset not found in project: ${id}`);
  process.exit(1);
}
const src = join(ws, rec.path);
if (!existsSync(src)) {
  console.error(`file missing on disk: ${rec.path}`);
  process.exit(1);
}

ensureWorkspace(home);
const dest = join(home, rec.path); // keep the same workspace-relative layout in the personal store
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

const saved = upsert(home, {
  ...rec,
  reusable: true,
  used_in: [...new Set([...(rec.used_in || []), ws])],
});
console.log(JSON.stringify({ ok: true, promoted: saved.asset_id, home, path: rec.path }, null, 2));
