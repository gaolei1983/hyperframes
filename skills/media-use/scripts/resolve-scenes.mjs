#!/usr/bin/env node
// resolve-scenes — the media-use ↔ host-workflow bridge, AGENT-FIRST.
//
// The DECISIONS (which scenes need a real asset, which candidate, reuse-or-fetch) belong to the
// MAIN agent driving the workflow — it has the conversation context (user preferences, brand,
// host style) and rides every model/harness improvement. This script is the HANDS: mechanical
// search, captioning (cached), freezing, copying, ledger bookkeeping. No decision sub-calls.
//
// Agent-first flow (a host playbook step):
//   1. --plan                      → scenes + the personal reusable ledger, in one JSON (read it)
//   2. agent writes needs.json     {"needs":[{"scene":2,"entity":"Elon Musk","query":"Elon Musk portrait","media":"image"}]}
//   3. --search-needs needs.json   → per need: candidates with cached text captions + a numbered
//                                    montage; exact-entity reuse matches are surfaced (search skipped)
//   4. agent decides, writes decisions.json
//        {"decisions":[{"scene":2,"entity":"Elon Musk","action":{"type":"reuse","asset_id":"img_001"}},
//                      {"scene":3,"entity":"Gigafactory","query":"Tesla Gigafactory aerial",
//                       "action":{"type":"fetch","url":"https://...","description":"aerial photo ..."}}]}
//   5. --apply-decisions decisions.json → freeze into personal scope, copy ONE consumed copy into
//        <project>/public/, append the thin project ledger, bump used_in, inject assetCandidates
//
// Headless fallback (no main agent in the loop, e.g. batch runs): --auto [--apply] keeps the old
// inline behavior — judge + text-rerank pick + reuse judgment via `claude -p` sub-calls.
//
// EMBEDDED layout: <project>/public/<basename> (consumed copy, what the composition references) ·
// <project>/.media/{manifest.jsonl,index.md,reports/} (thin ledger, path == composition path) ·
// $MEDIA_USE_HOME (default ~/.media-use) = durable reusable originals (entity, used_in, captions).

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname, basename, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { readManifest, writeManifest, renderIndex } from "./_ledger.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const PROJECT = arg("project");
if (!PROJECT || PROJECT === true) {
  console.error("--project <host_project_dir> required");
  process.exit(1);
}
const PERSONAL = process.env.MEDIA_USE_HOME || join(homedir(), ".media-use");
const LEDGER = join(PROJECT, ".media-use");
const HERE = dirname(new URL(import.meta.url).pathname);
const RESOLVE = join(HERE, "resolve.mjs");
const SELECT_RERANK = join(HERE, "select-rerank.mjs");
const projectName = basename(resolvePath(PROJECT));

const nsPath = join(PROJECT, "narrator_scripts.json");
const ns = JSON.parse(readFileSync(nsPath, "utf8"));
const scenes = ns.scenes || [];

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const lastJSON = (out) => JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
function reusableLedger() {
  return readManifest(PERSONAL).filter((r) => r.status === "ready" && r.reusable);
}
function exactEntity(entity) {
  if (!entity) return null;
  return reusableLedger().find((r) => r.entity && r.entity.toLowerCase() === String(entity).toLowerCase()) || null;
}

// Bump a personal-scope asset's reuse bookkeeping for this project (used_in / usage_count).
function bumpPersonalUsage(assetId) {
  const recs = readManifest(PERSONAL);
  const rec = recs.find((r) => r.asset_id === assetId);
  if (!rec) return;
  rec.used_in = Array.from(new Set([...(rec.used_in || []), projectName]));
  rec.usage_count = rec.used_in.length;
  writeManifest(PERSONAL, recs);
  renderIndex(PERSONAL);
}

// Mechanical landing of one resolved need: copy personal → public/, append the thin project record,
// copy the resolve report, inject assetCandidates (append — a scene may carry several entities).
const projManifest = join(LEDGER, "manifest.jsonl");
function landAsset({ sceneNum, entity, query, media, personalId, personalPath, sourceUrl, provider, reused, description, selectReason }) {
  const scene = scenes.find((s) => s.sceneNumber === sceneNum);
  if (!scene) throw new Error(`scene ${sceneNum} not found in narrator_scripts.json`);
  mkdirSync(join(PROJECT, "public"), { recursive: true });
  mkdirSync(join(LEDGER, "reports"), { recursive: true });
  const base = basename(personalPath);
  copyFileSync(join(PERSONAL, personalPath), join(PROJECT, "public", base));
  bumpPersonalUsage(personalId);
  const rec = {
    asset_id: personalId,
    type: "image",
    path: `public/${base}`,
    source: "search",
    reused: !!reused,
    status: "ready",
    description: description || query || entity,
    entity: entity || undefined,
    tags: media === "icon" ? ["image", "icon"] : ["image"],
    provenance: { provider, prompt: query, source_url: sourceUrl, derived_from: `personal:${personalId}`, select_reason: selectReason || undefined },
  };
  appendFileSync(projManifest, JSON.stringify(rec) + "\n");
  const repSrc = join(PERSONAL, `.media/reports/resolve_${personalId}.json`);
  if (existsSync(repSrc)) copyFileSync(repSrc, join(LEDGER, "reports", `resolve_${personalId}.json`));
  if (!Array.isArray(scene.assetCandidates)) scene.assetCandidates = [];
  scene.assetCandidates.push({ path: rec.path, description: rec.description });
  return rec;
}

function writeProjectIndex() {
  const recs = existsSync(projManifest)
    ? readFileSync(projManifest, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const rows = recs
    .map((r) => `| ${r.asset_id} | ${r.entity || "—"} | ${r.path} | ${r.reused ? "reused" : "search"} | ${(r.description || "").replace(/\|/g, "\\|").slice(0, 50)} |`)
    .join("\n");
  writeFileSync(
    join(LEDGER, "index.md"),
    `# media-use — project assets (generated)\n\n> Consumed copies in \`public/\`; durable reusable originals + traces in \`${PERSONAL}\`.\n\n| asset_id | entity | path | source | description |\n| --- | --- | --- | --- | --- |\n${rows}\n\n_${recs.length} assets (${recs.filter((r) => r.reused).length} reused from personal scope)_\n`,
  );
}

// Freeze an agent-picked (or auto-picked) URL into the personal scope. Returns the personal record info.
function freezeUrl({ url, entity, query, media, description }) {
  const args = [RESOLVE, "--workspace", PERSONAL, "--type", media === "icon" ? "icon" : "image", "--url", url, "--entity", entity, "--intent", query || entity];
  if (description) args.push("--desc", description);
  const out = execFileSync("node", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
  const r = lastJSON(out);
  if (!r.ok || !r.path) throw new Error(r.error || "freeze failed");
  return { personalId: r.registered, personalPath: r.path, sourceUrl: r.source_url };
}

// ───────────────────────── mode: --plan (mechanical, zero model calls) ─────────────────────────
if (arg("plan", false)) {
  console.log(JSON.stringify({
    mode: "plan",
    project: resolvePath(PROJECT),
    personal_scope: PERSONAL,
    search_backend_set: !!process.env.MEDIA_USE_SEARCH_CMD,
    scenes: scenes.map((s) => ({
      scene: s.sceneNumber,
      name: s.sceneName,
      keyMessage: s.narrativeIntent?.keyMessage,
      script: s.script,
      assetCandidates: s.assetCandidates || [],
    })),
    reusable: reusableLedger().map((r) => ({ asset_id: r.asset_id, entity: r.entity || null, description: r.description, used_in: r.used_in || [] })),
    next: "YOU (the main agent) decide which scenes depict a real fetchable entity (person/brand/product/place; abstract scenes get nothing). For entities already in `reusable`, go straight to --apply-decisions with {type:'reuse',asset_id}. For new entities, write needs.json {needs:[{scene,entity,query,media:'image'|'icon'}]} (entity = bare canonical name, the reuse key; brand logos are media:'image') and run --search-needs.",
  }, null, 2));
  process.exit(0);
}

// ──────────────── mode: --search-needs <file> (mechanical search + cached captions) ────────────────
const needsFile = arg("search-needs");
if (needsFile && needsFile !== true) {
  const needs = readJSON(needsFile).needs || [];
  const forceSearch = !!arg("force-search", false);
  const num = arg("num", "4");
  const out = [];
  for (const need of needs) {
    const entity = (need.entity || need.query || "").trim();
    const exact = exactEntity(entity);
    const entry = { scene: need.scene, entity, query: need.query, media: need.media || "image", reuse_matches: exact ? [{ asset_id: exact.asset_id, entity: exact.entity, description: exact.description, used_in: exact.used_in || [] }] : [] };
    if (exact && !forceSearch) {
      entry.candidates = [];
      entry.montage = null;
      entry.note = "exact entity match in the personal scope — search skipped; write a reuse decision, or re-run with --force-search";
    } else {
      try {
        const sout = execFileSync("node", [SELECT_RERANK, "--workspace", PERSONAL, "--query", need.query, "--media", entry.media, "--num", String(num), "--describe-only"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 300000 });
        const sel = lastJSON(sout);
        entry.candidates = sel.candidates || [];
        entry.montage = sel.montage || null;
      } catch (e) {
        entry.candidates = [];
        entry.error = (e.stderr || e.message || "search failed").toString().slice(0, 160);
      }
    }
    out.push(entry);
    console.error(`[resolve-scenes] scene ${need.scene} "${entity}": ${entry.reuse_matches.length ? "reuse match" : (entry.candidates || []).length + " candidates"}`);
  }
  const result = {
    mode: "search",
    needs: out,
    next: "YOU (the main agent) decide per need: read each candidate's description (and/or view its montage), then write decisions.json {decisions:[{scene,entity,query,media,action:{type:'fetch',url,description} | {type:'reuse',asset_id} | {type:'skip'}}]} and run --apply-decisions. Prefer on-intent, clean, high-res candidates whose background fits the host style.",
  };
  const outFile = arg("out");
  if (outFile && outFile !== true) writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ─────────────── mode: --apply-decisions <file> (mechanical freeze/copy/inject/ledger) ───────────────
const decisionsFile = arg("apply-decisions");
if (decisionsFile && decisionsFile !== true) {
  const decisions = readJSON(decisionsFile).decisions || [];
  const applied = [], skipped = [], failed = [];
  for (const d of decisions) {
    const action = d.action || {};
    if (action.type === "skip" || !action.type) {
      skipped.push({ scene: d.scene, entity: d.entity });
      continue;
    }
    try {
      if (action.type === "reuse") {
        const rec = readManifest(PERSONAL).find((r) => r.asset_id === action.asset_id);
        if (!rec) throw new Error(`personal asset ${action.asset_id} not found`);
        const landed = landAsset({
          sceneNum: d.scene, entity: d.entity || rec.entity, query: d.query || rec.provenance?.prompt, media: d.media || "image",
          personalId: rec.asset_id, personalPath: rec.path, sourceUrl: rec.provenance?.source_url, provider: rec.provenance?.provider,
          reused: true, description: action.description || rec.description, selectReason: "agent decision: reuse",
        });
        applied.push({ scene: d.scene, entity: d.entity, reused: true, path: landed.path });
      } else if (action.type === "fetch") {
        if (!action.url) throw new Error("fetch decision missing url");
        const f = freezeUrl({ url: action.url, entity: d.entity, query: d.query, media: d.media || "image", description: action.description });
        const landed = landAsset({
          sceneNum: d.scene, entity: d.entity, query: d.query, media: d.media || "image",
          personalId: f.personalId, personalPath: f.personalPath, sourceUrl: f.sourceUrl,
          provider: (d.media || "image") === "icon" ? "noun_project" : "google_images",
          reused: false, description: action.description, selectReason: "agent decision: fetch",
        });
        applied.push({ scene: d.scene, entity: d.entity, reused: false, path: landed.path });
      } else {
        throw new Error(`unknown action.type '${action.type}'`);
      }
    } catch (e) {
      failed.push({ scene: d.scene, entity: d.entity, error: (e.message || String(e)).slice(0, 160) });
    }
  }
  if (applied.length) {
    writeProjectIndex();
    writeFileSync(nsPath, JSON.stringify(ns, null, 2) + "\n");
  }
  console.error(`[resolve-scenes] APPLIED ${applied.length} (${applied.filter((x) => x.reused).length} reused), skipped ${skipped.length}, failed ${failed.length}`);
  console.log(JSON.stringify({ mode: "apply", project: resolvePath(PROJECT), applied, skipped, failed }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

// ───────────── mode: --auto [--apply] — HEADLESS FALLBACK (inline decision sub-calls) ─────────────
// Only for runs with no main agent in the loop (batch evals). Each judgment spawns `claude -p`.
if (!arg("auto", false) && !arg("apply", false)) {
  console.error("usage: resolve-scenes --project <dir> [--plan | --search-needs <needs.json> [--out f] [--force-search] | --apply-decisions <decisions.json> | --auto [--apply]]");
  process.exit(1);
}
const APPLY = !!arg("apply", false);

function claudeJSON(prompt) {
  try {
    return execFileSync("claude", ["-p", prompt, "--max-turns", "1", "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--permission-mode", "bypassPermissions"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    return (e.stdout || "").toString();
  }
}

const sceneList = scenes
  .map((s) => `${s.sceneNumber}. [${s.sceneName}] ${s.narrativeIntent?.keyMessage || ""} :: ${(s.script || "").replace(/<[^>]+>/g, "").slice(0, 180)}`)
  .join("\n");
const judgeRaw = claudeJSON(`You decide which explainer scenes would be served by a REAL fetchable visual — a real PERSON, a real BRAND/LOGO, a real PRODUCT UI/screenshot, or a recognizable real PLACE. Abstract/conceptual scenes must NOT get a real asset.

SCENES:
${sceneList}

For each real-entity scene emit: a precise search query, the media type, a short description, and a CANONICAL entity name (a REUSE KEY: bare proper name only, e.g. "Elon Musk", so the same entity in two videos produces the same string).

MEDIA TYPE: use "image" for a real brand/company logo, photo, portrait, product shot, or screenshot. Use "icon" ONLY for a generic abstract symbol with no real brand. A real company's logo is an IMAGE, never an icon.

Reply with ONE line of JSON ONLY:
{"needs":[{"scene":<n>,"query":"<query>","media":"image|icon","description":"<=10 words","entity":"<canonical name>"}]}
If no scene depicts a real entity, reply {"needs":[]}.`);
const jm = judgeRaw.match(/\{[\s\S]*"needs"[\s\S]*\}/);
if (!jm) throw new Error("judge returned no parseable JSON: " + judgeRaw.slice(0, 200));
const needs = JSON.parse(jm[0]).needs || [];
console.error(`[resolve-scenes] judge flagged ${needs.length}/${scenes.length} scenes as real-entity`);

function reuseJudge(entity, query) {
  const pool = reusableLedger();
  if (!pool.length || !entity) return null;
  const exact = exactEntity(entity);
  if (exact) return exact;
  const list = pool.map((r) => `${r.asset_id} · entity="${r.entity || "?"}" · ${(r.description || "").slice(0, 60)}`).join("\n");
  const raw = claudeJSON(`A new scene needs an asset for the real entity "${entity}" (search query "${query}"). Do any of these already-owned assets depict the SAME real entity (so we reuse it instead of re-fetching)?\n${list}\nReply ONE line of JSON: {"reuse":"<asset_id or none>"}`);
  const m = raw.match(/\{[^{}]*"reuse"[^{}]*\}/);
  const id = m ? JSON.parse(m[0]).reuse : "none";
  return id && id !== "none" ? pool.find((r) => r.asset_id === id) || null : null;
}

const injected = [];
for (const need of needs) {
  const entity = (need.entity || need.query || "").trim();
  const isIcon = need.media === "icon";
  const hit = reuseJudge(entity, need.query);
  try {
    let info, reused = false, selectReason, description = need.description;
    if (hit) {
      info = { personalId: hit.asset_id, personalPath: hit.path, sourceUrl: hit.provenance?.source_url };
      reused = true;
      selectReason = "auto: reused (same entity)";
    } else {
      let pickedUrl = null, pickedDesc = null;
      try {
        const sout = execFileSync("node", [SELECT_RERANK, "--workspace", PERSONAL, "--query", need.query, "--media", isIcon ? "icon" : "image", "--num", "4"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000 });
        const sel = lastJSON(sout);
        pickedUrl = sel.picked_url || null;
        selectReason = sel.reason ? `auto: ${sel.reason}` : null;
        pickedDesc = sel.picked_description || null;
      } catch (e) {
        console.error(`[resolve-scenes] scene ${need.scene} select-rerank error: ${(e.stderr || e.message || "").toString().slice(0, 100)}`);
      }
      if (!pickedUrl) throw new Error("no candidates");
      info = freezeUrl({ url: pickedUrl, entity, query: need.query, media: need.media, description: pickedDesc });
      description = pickedDesc || description;
    }
    if (APPLY) {
      landAsset({
        sceneNum: need.scene, entity, query: need.query, media: need.media || "image",
        ...info, provider: isIcon ? "noun_project" : "google_images", reused, description, selectReason,
      });
    }
    injected.push({ scene: need.scene, entity, query: need.query, media: need.media, reused, personal_id: info.personalId, select_reason: selectReason });
  } catch (e) {
    injected.push({ scene: need.scene, entity, query: need.query, media: need.media, failed: true, reason: (e.message || String(e)).slice(0, 120) });
  }
}

if (APPLY) {
  writeProjectIndex();
  writeFileSync(nsPath, JSON.stringify(ns, null, 2) + "\n");
  const ok = injected.filter((i) => !i.failed);
  console.error(`[resolve-scenes] AUTO APPLIED: ${ok.length} scenes (${ok.filter((i) => i.reused).length} reused, ${injected.filter((i) => i.failed).length} failed)`);
} else {
  console.error(`[resolve-scenes] AUTO DRY RUN. would inject ${injected.filter((i) => !i.failed).length}.`);
}
console.log(JSON.stringify({ mode: "auto", project: resolvePath(PROJECT), personal: PERSONAL, applied: APPLY, scenes: scenes.length, injected }, null, 2));
