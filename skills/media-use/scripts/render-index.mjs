#!/usr/bin/env node
// Regenerate .media/index.md from .media/manifest.jsonl.
// Usage: node render-index.mjs --workspace <dir>
import { renderIndex, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const idx = renderIndex(ws);
console.log(JSON.stringify({ ok: true, index: idx }, null, 2));
