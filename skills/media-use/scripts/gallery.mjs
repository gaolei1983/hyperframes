#!/usr/bin/env node
// Visual gallery of a media-use workspace — the "preview" surface: real thumbnails / audio players
// + each AssetRecord, generated from the manifest. This is what a human (or a registry UI)
// uses to REVIEW what media-use pulled / froze / organized. Self-contained HTML, no deps.
// Usage: node gallery.mjs --workspace <dir>   → writes <dir>/gallery.html (open in a browser)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readManifest, parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
const records = readManifest(ws);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const AUDIO = ["bgm", "sfx", "voice", "audio"];
function media(r) {
  const p = esc(r.path); // workspace-relative; gallery.html sits at the workspace root
  if (r.type === "image")
    return `<img class="thumb" loading="lazy" src="${p}" alt="${esc(r.asset_id)}">`;
  if (AUDIO.includes(r.type)) return `<audio controls preload="none" src="${p}"></audio>`;
  if (r.type === "video") return `<video class="thumb" controls preload="none" src="${p}"></video>`;
  return `<div class="file">📄 <a href="${p}">${p}</a></div>`;
}
const field = (k, v) =>
  v ? `<div class="f"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : "";
const card = (r) => `
  <div class="card">
    <div class="media">${media(r)}</div>
    <div class="meta">
      <div class="cid">${esc(r.asset_id)} <span class="type">${esc(r.type)}</span></div>
      ${field("source", r.provenance?.derived_from ? `${r.source} ← ${r.provenance.derived_from}` : r.source)}
      ${field("from", r.provenance?.provider)}
      ${field("query", r.provenance?.prompt)}
      ${field("usage", r.usage_intent)}
      ${field("tags", (r.tags || []).join(", "))}
      ${field("desc", r.description)}
    </div>
  </div>`;

const counts = {};
for (const r of records) counts[r.type] = (counts[r.type] || 0) + 1;
const summary = Object.entries(counts)
  .map(([k, v]) => `${v} ${k}`)
  .join(" · ");

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>media-use workspace</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--ink:#1c2330;--muted:#6b7280;--line:#e6e8ec}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:28px 20px 80px}
  h1{font-size:20px;margin:0 0 2px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:22px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .media{background:#0d1117;display:flex;align-items:center;justify-content:center;min-height:170px;padding:8px}
  .thumb{max-width:100%;max-height:240px;object-fit:contain;display:block}
  audio{width:100%}
  .file{color:#9aa1ab;font-size:13px;padding:24px}
  .meta{padding:11px 13px}
  .cid{font-weight:700;font-size:14px;margin-bottom:6px}
  .type{font-weight:600;font-size:11px;color:#fff;background:#6d28d9;border-radius:5px;padding:1px 7px;margin-left:4px}
  .f{display:flex;gap:8px;font-size:12px;padding:1px 0}
  .k{color:var(--muted);flex:0 0 56px}
  .v{color:#374151;word-break:break-word}
</style></head>
<body><div class="wrap">
  <h1>media-use workspace</h1>
  <div class="sub">${esc(ws)} · ${records.length} assets${summary ? ` · ${summary}` : ""}</div>
  <div class="grid">${records.map(card).join("")}</div>
</div></body></html>`;

const out = join(ws, "gallery.html");
writeFileSync(out, html);
console.log("wrote " + out);
