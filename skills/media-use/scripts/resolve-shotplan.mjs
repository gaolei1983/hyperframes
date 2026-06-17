#!/usr/bin/env node
// resolve-shotplan — media-use adapter for motion-graphics' source phase (shot-plan.json.asset_needs).
//
// motion-graphics is asset-first and already speaks media-use's language: Director Part 1 emits
// `asset_needs[] {role, kind, query, treatment}`, the source phase must land frozen files in
// <project>/.media/ + an agent-readable index, then Director Part 2 designs AROUND them
// (skills/motion-graphics/phases/source/guide.md — spec'd, unimplemented). This adapter is that
// implementation, agent-first (same contract as resolve-scenes): the MAIN agent decides, this
// script is the hands.
//
//   --plan                      asset_needs + the personal reusable ledger. 0 model calls.
//   --search [--out f]          per need: candidates + cached captions + numbered montage. NO pick.
//                               kinds image|logo -> image search; icon|svg -> icon search;
//                               news|web|tweet -> degraded (backend is image/icon only today).
//   --apply-decisions <file>    freeze the agent's picks into <project>/.media/ (media-use's own
//                               workspace convention — the host adopted it), apply treatment
//                               (cutout = process remove-bg), normalize to EVEN dims (odd dims
//                               break motion-graphics' ffmpeg encode), emit an eyedropper palette
//                               swatch per asset-fusion need, bump personal used_in.
//       decisions.json: {"decisions":[{"role":"hero","entity":"Tesla","query":"...","media":"image",
//                        "treatment":"cutout|none","action":{"type":"fetch","url":"...","description":"..."}
//                        | {"type":"reuse","asset_id":"img_001"} | {"type":"skip"}}]}
//
// maps basemap lane (asset_needs {type|kind:"map-bake"}): mechanical, no search — the decision is
//   {"role":"basemap","action":{"type":"bake","params":{NAME,STYLE,COUNTRIES,CENTER,ZSTART,ZEND,FPS,DUR,...}}}
//   The adapter runs the host's categories/maps/bake-basemap.mjs (pass --skill-dir), lands
//   <NAME>.mp4 + <NAME>-coords.json in .media/maps/, registers both with the tile-provider
//   ATTRIBUTION the maps module makes a hard rule.
//
// Durable copies + reuse keys live in $MEDIA_USE_HOME (entity / used_in); the project keeps its own
// consumed copy + AssetRecord. No --auto here: a motion-graphics run always has a master agent.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join, dirname, basename, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { readManifest, writeManifest, renderIndex, ensureWorkspace, upsert } from "./_ledger.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const PROJECT = arg("project");
if (!PROJECT || PROJECT === true) {
  console.error("--project <motion-graphics project dir> required");
  process.exit(1);
}
const PERSONAL = process.env.MEDIA_USE_HOME || join(homedir(), ".media-use");
const HERE = dirname(new URL(import.meta.url).pathname);
const RESOLVE = join(HERE, "resolve.mjs");
const SELECT_RERANK = join(HERE, "select-rerank.mjs");
const PROCESS = join(HERE, "process.mjs");
const projectName = basename(resolvePath(PROJECT));

const planPath = join(PROJECT, "shot-plan.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const needs = plan.asset_needs || [];

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const lastJSON = (out) => JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
const run = (bin, args, opts) => execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...(opts || {}) });
const reusable = () => readManifest(PERSONAL).filter((r) => r.status === "ready" && r.reusable);
const exactEntity = (e) => (e ? reusable().find((r) => r.entity && r.entity.toLowerCase() === String(e).toLowerCase()) || null : null);
// kind → search media. Real brand logos are images (Noun Project has no brand marks); svg degrades to icon.
const mediaOf = (kind) => (kind === "icon" || kind === "svg" ? "icon" : "image");
const searchable = (kind) => ["image", "logo", "icon", "svg"].includes(kind);
const kindOf = (need) => need.kind || need.type; // maps module uses {type:"map-bake"}; IR uses kind
// tile-provider attribution (maps module hard rule: bake a credit whenever a basemap is on screen)
const ATTRIBUTION = { satellite: "Esri, Maxar, Earthstar Geographics", dark: "© CARTO, © OpenStreetMap", light: "© CARTO, © OpenStreetMap" };

function dims(file) {
  try {
    const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file]).trim();
    const [w, h] = out.split("x").map(Number);
    return { w, h };
  } catch {
    return null;
  }
}
// motion-graphics gotcha: odd width OR height breaks/distorts the ffmpeg encode — normalize on landing.
function evenize(file) {
  const d = dims(file);
  if (!d || (d.w % 2 === 0 && d.h % 2 === 0)) return d;
  const tmp = file + ".even.png";
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", tmp]);
  copyFileSync(tmp, file);
  try { run("rm", [tmp]); } catch {}
  return dims(file);
}
// eyedropper affordance: a palette swatch image the DIRECTOR reads colors from (agent-first — no
// baked hexes; the vision model eyedrops the swatch + the asset itself).
function paletteSwatch(file, role) {
  try {
    const out = join(PROJECT, ".media/preview", `palette_${role}.png`);
    mkdirSync(dirname(out), { recursive: true });
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", "palettegen=max_colors=8:reserve_transparent=0", out]);
    return `.media/preview/palette_${role}.png`;
  } catch {
    return null;
  }
}

// ───────────────────────────── --plan ─────────────────────────────
if (arg("plan", false)) {
  console.log(JSON.stringify({
    mode: "plan",
    project: resolvePath(PROJECT),
    personal_scope: PERSONAL,
    search_backend_set: !!process.env.MEDIA_USE_SEARCH_CMD,
    asset_needs: needs,
    reusable: reusable().map((r) => ({ asset_id: r.asset_id, entity: r.entity || null, description: r.description, used_in: r.used_in || [] })),
    next: "YOU (the master agent) own the decisions. Optionally add `entity` (bare canonical name, the reuse key) to each need. Entities already in `reusable` can go straight to --apply-decisions with {type:'reuse',asset_id}. Otherwise run --search, read the captions / view the montages, and write decisions.json. kinds news/web/tweet are degraded today (image/icon backend only) — let the category fall back per its degrade rule.",
  }, null, 2));
  process.exit(0);
}

// ───────────────────────────── --search ─────────────────────────────
if (arg("search", false)) {
  const num = arg("num", "4");
  const out = [];
  for (const need of needs) {
    const kind = kindOf(need);
    const entry = { role: need.role, kind, query: need.query, treatment: need.treatment || "none", entity: need.entity || null };
    if (kind === "map-bake") {
      entry.note = "mechanical bake — no search. Write a decision {type:'bake', params:{NAME,STYLE,COUNTRIES,CENTER,ZSTART,ZEND,FPS,DUR,...}} (Director sets/adjusts camera params).";
      entry.params = need.params || need.bake || null;
      out.push(entry);
      console.error(`[resolve-shotplan] ${need.role}: map-bake (mechanical)`);
      continue;
    }
    if (!searchable(kind)) {
      entry.degraded = `kind '${kind}' not searchable with the current backend (image/icon only) — category should degrade per phases/source/guide.md`;
      out.push(entry);
      console.error(`[resolve-shotplan] ${need.role}: degraded (${kind})`);
      continue;
    }
    const hit = exactEntity(need.entity);
    entry.reuse_matches = hit ? [{ asset_id: hit.asset_id, entity: hit.entity, description: hit.description, used_in: hit.used_in || [] }] : [];
    if (hit && !arg("force-search", false)) {
      entry.candidates = [];
      entry.note = "exact entity match in the personal scope — write a reuse decision, or --force-search";
    } else {
      try {
        const sout = run("node", [SELECT_RERANK, "--workspace", PERSONAL, "--query", need.query, "--media", mediaOf(kind), "--num", String(num), "--describe-only"], { timeout: 300000 });
        const sel = lastJSON(sout);
        entry.candidates = sel.candidates || [];
        entry.montage = sel.montage || null;
      } catch (e) {
        entry.candidates = [];
        entry.error = (e.stderr || e.message || "search failed").toString().slice(0, 160);
      }
    }
    out.push(entry);
    console.error(`[resolve-shotplan] ${need.role} "${need.query}": ${entry.reuse_matches?.length ? "reuse match" : (entry.candidates || []).length + " candidates"}`);
  }
  const result = { mode: "search", needs: out, next: "decide per need; write decisions.json (action fetch{url,description} | reuse{asset_id} | skip, plus treatment) and run --apply-decisions. Prefer clean, on-intent, high-res candidates whose background fits the shot." };
  const outFile = arg("out");
  if (outFile && outFile !== true) writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ───────────────────────── --apply-decisions ─────────────────────────
const decisionsFile = arg("apply-decisions");
if (!decisionsFile || decisionsFile === true) {
  console.error("usage: resolve-shotplan --project <dir> [--plan | --search [--out f] [--force-search] | --apply-decisions <decisions.json>]");
  process.exit(1);
}
ensureWorkspace(PROJECT); // the host adopted media-use's own convention: <project>/.media/ + manifest + index
const decisions = readJSON(decisionsFile).decisions || [];
const applied = [], skipped = [], failed = [];

function bumpPersonal(assetId) {
  const recs = readManifest(PERSONAL);
  const rec = recs.find((r) => r.asset_id === assetId);
  if (!rec) return;
  rec.used_in = Array.from(new Set([...(rec.used_in || []), projectName]));
  rec.usage_count = rec.used_in.length;
  writeManifest(PERSONAL, recs);
  renderIndex(PERSONAL);
}

for (const d of decisions) {
  const action = d.action || {};
  if (action.type === "skip" || !action.type) {
    skipped.push({ role: d.role });
    continue;
  }
  try {
    // maps basemap lane: mechanical bake via the host's helper (no personal copy — tiles are
    // location+style parametric, the durable thing is the params, which live in shot-plan.json)
    if (action.type === "bake") {
      const skillDir = arg("skill-dir");
      if (!skillDir || skillDir === true) throw new Error("--skill-dir <motion-graphics skill dir> required for bake decisions");
      const bake = join(skillDir, "categories/maps/bake-basemap.mjs");
      if (!existsSync(bake)) throw new Error(`bake helper not found: ${bake}`);
      const params = action.params || d.params || {};
      const outDir = join(PROJECT, ".media/maps");
      mkdirSync(outDir, { recursive: true });
      // ESM bare imports ignore NODE_PATH and resolve from the SCRIPT's own path upward — so a
      // helper living in the installed skill dir can't see the project's deps. Stage the helper
      // inside the project and make `puppeteer-core` resolvable there (symlink if missing).
      const staged = join(outDir, ".bake-basemap.mjs");
      copyFileSync(bake, staged);
      const pcTarget = join(PROJECT, "node_modules/puppeteer-core");
      if (!existsSync(pcTarget)) {
        const cands = [
          process.env.MEDIA_USE_NODE_PATH && join(process.env.MEDIA_USE_NODE_PATH, "puppeteer-core"),
          join(HERE, "../../../packages/cli/node_modules/puppeteer-core"), // skills installed inside the hyperframes repo
        ].filter(Boolean);
        const src = cands.find((p) => existsSync(p));
        if (src) {
          mkdirSync(join(PROJECT, "node_modules"), { recursive: true });
          symlinkSync(src, pcTarget);
        }
      }
      run("node", [staged], {
        timeout: 600000,
        cwd: PROJECT,
        env: { ...process.env, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), OUT: outDir },
      });
      const name = params.NAME || "basemap";
      const mp4 = `.media/maps/${name}.mp4`;
      const coords = `.media/maps/${name}-coords.json`;
      if (!existsSync(join(PROJECT, mp4))) throw new Error(`bake produced no ${mp4}`);
      const credit = ATTRIBUTION[params.STYLE || "satellite"] || "third-party tiles — verify attribution";
      upsert(PROJECT, {
        asset_id: `map_${name}`, type: "video", path: mp4, source: "generated", status: "ready", role: d.role,
        description: `baked basemap (${params.STYLE || "satellite"}) — ATTRIBUTION REQUIRED on screen: "${credit}"`,
        tags: ["map", "basemap", `role:${d.role}`],
        provenance: { provider: `maplibre:${params.STYLE || "satellite"}`, prompt: JSON.stringify(params).slice(0, 180) },
      });
      applied.push({ role: d.role, path: mp4, coords: existsSync(join(PROJECT, coords)) ? coords : null, baked: true, attribution: credit });
      continue;
    }

    // 1) durable copy in PERSONAL (fetch freezes; reuse already has one)
    let personalId, personalPath, sourceUrl, description;
    if (action.type === "reuse") {
      const rec = readManifest(PERSONAL).find((r) => r.asset_id === action.asset_id);
      if (!rec) throw new Error(`personal asset ${action.asset_id} not found`);
      personalId = rec.asset_id; personalPath = rec.path; sourceUrl = rec.provenance?.source_url;
      description = action.description || rec.description;
    } else if (action.type === "fetch") {
      if (!action.url) throw new Error("fetch decision missing url");
      const args = [RESOLVE, "--workspace", PERSONAL, "--type", mediaOf(d.media || d.kind || "image"), "--url", action.url, "--entity", d.entity || "", "--intent", d.query || d.role];
      if (action.description) args.push("--desc", action.description);
      const r = lastJSON(run("node", args, { timeout: 180000 }));
      if (!r.ok || !r.path) throw new Error(r.error || "freeze failed");
      personalId = r.registered; personalPath = r.path; sourceUrl = r.source_url; description = action.description;
    } else throw new Error(`unknown action.type '${action.type}'`);

    // 2) consumed copy in the PROJECT workspace, registered as a proper AssetRecord (role on the record)
    const base = basename(personalPath);
    const rel = `.media/images/${base}`;
    mkdirSync(dirname(join(PROJECT, rel)), { recursive: true });
    copyFileSync(join(PERSONAL, personalPath), join(PROJECT, rel));
    let finalRel = rel;
    let rec = upsert(PROJECT, {
      asset_id: personalId, type: "image", path: rel, source: "search", status: "ready",
      description: description || d.query || d.role, entity: d.entity || undefined, role: d.role,
      tags: ["image", `role:${d.role}`], reused: action.type === "reuse",
      provenance: { provider: "media-use", prompt: d.query, source_url: sourceUrl, derived_from: `personal:${personalId}` },
    });

    // 3) treatment: cutout → process remove-bg, role points at the processed file
    if ((d.treatment || "none") === "cutout") {
      const p = lastJSON(run("node", [PROCESS, "--workspace", PROJECT, "--asset", personalId, "--action", "remove-bg"], { timeout: 400000 }));
      if (p.ok && p.path) finalRel = p.path;
    }

    // 4) EVEN dims + palette swatch (asset-fusion affordances)
    const d2 = evenize(join(PROJECT, finalRel));
    const palette = paletteSwatch(join(PROJECT, finalRel), d.role);
    bumpPersonal(personalId);
    applied.push({ role: d.role, entity: d.entity || null, path: finalRel, reused: action.type === "reuse", dims: d2 ? `${d2.w}x${d2.h}` : null, palette_swatch: palette });
  } catch (e) {
    failed.push({ role: d.role, error: (e.message || String(e)).slice(0, 160) });
  }
}

// 5) the source-phase ledger their guide asks for: role → frozen path + provenance (+ geometry/palette)
renderIndex(PROJECT);
if (applied.length) {
  const rows = applied.map((a) => {
    const src = a.baked ? "baked" : a.reused ? "reused" : "search";
    const notes = a.baked
      ? `coords: ${a.coords || "—"} · ATTRIBUTION: ${a.attribution}`
      : `palette: ${a.palette_swatch || "—"}`;
    return `| ${a.role} | ${a.path} | ${a.dims || "—"} | ${src} | ${notes} |`;
  }).join("\n");
  const section = `\n## Source phase — roles (generated by media-use resolve-shotplan)\n\n| role | frozen path | dims (even) | source | notes |\n| --- | --- | --- | --- | --- |\n${rows}\n\n> Eyedrop real colors from the palette swatch / the asset itself (never generic #FFF/#000). Geometry: ground with grounding/PROTOCOL.md — never eyeball coords. Baked basemaps MUST show their attribution on screen.\n`;
  const idx = join(PROJECT, ".media/index.md");
  writeFileSync(idx, readFileSync(idx, "utf8") + section);
}
console.error(`[resolve-shotplan] APPLIED ${applied.length} (${applied.filter((a) => a.reused).length} reused), skipped ${skipped.length}, failed ${failed.length}`);
console.log(JSON.stringify({ mode: "apply", project: resolvePath(PROJECT), applied, skipped, failed }, null, 2));
process.exit(failed.length ? 1 : 0);
