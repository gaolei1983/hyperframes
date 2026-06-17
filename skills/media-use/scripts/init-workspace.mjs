#!/usr/bin/env node
// Lazy-init a media-use workspace. Idempotent.
// Usage: node init-workspace.mjs --workspace <dir>   (default: ./.media-use-workspace)
import { readFileSync } from "node:fs";
import { ensureWorkspace, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const p = ensureWorkspace(ws);
const providers = JSON.parse(readFileSync(p.config, "utf8")).providers;
console.log(
  JSON.stringify(
    { ok: true, workspace: ws, manifest: p.manifest, index: p.index, config: p.config, providers },
    null,
    2,
  ),
);
