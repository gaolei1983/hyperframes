#!/usr/bin/env node
// Use-case oracle — evals derived from the "Agent Media OS" design's use cases.
// Deterministic + OFFLINE: exercises the REAL ledger/helper scripts
// (register-asset, promote-personal, find-asset, resolve) over the durable-structure contract each
// UC describes — obtain → register → provenance → reuse → usage_intent → index. Model-backed
// acquisition (heygen search, remove-bg, tts) is covered LIVE by oracle-audio-resolve.mjs; this
// oracle covers the workspace lifecycle, which should hold without any network or local model.
//
//   UC1 standalone   : obtain → process(derived) → provenance + findable + index link
//   UC3 session-end  : promote a project asset into the personal reusable store
//   UC4 2nd project  : auto-reuse a personal asset by entity (NO re-fetch)
//   UC5 multi-turn   : replace BGM — add new + mark old superseded
//   UC6 brand-kit    : usage_intent tag carried into manifest + index
//   (UC2 = the embedded workflow bridge resolve-scenes.mjs — out of this standalone lifecycle eval.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const S = (n) => join(here, n);

function sh(script, args, env) {
  try {
    const out = execFileSync("node", [S(script), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...(env || {}) },
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout || "", err: (e.stderr || e.message || "").toString() };
  }
}
const mkWs = (tag) => mkdtempSync(join(tmpdir(), `mu-uc-${tag}-`));
function touch(ws, rel) {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "dummy-bytes");
}
function manifest(ws) {
  const p = join(ws, ".media/manifest.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const indexMd = (ws) => (existsSync(join(ws, ".media/index.md")) ? readFileSync(join(ws, ".media/index.md"), "utf8") : "");
const reg = (ws, record) => sh("register-asset.mjs", ["--workspace", ws, "--json", JSON.stringify(record)]);

const results = [];
const add = (uc, name, problems, note) => results.push({ uc, name, pass: problems.length === 0, problems, note });

// ── UC1: obtain → process(derived) → provenance + findable + index link ──
{
  const p = [], ws = mkWs("uc1");
  touch(ws, ".media/raw/elon_001.jpg");
  reg(ws, { asset_id: "img_001", type: "image", path: ".media/raw/elon_001.jpg", source: "search", status: "ready", entity: "Elon Musk", description: "Elon Musk portrait" });
  touch(ws, ".media/processed/elon_cutout_001.png");
  reg(ws, { asset_id: "elon_cutout_001", type: "image", path: ".media/processed/elon_cutout_001.png", source: "processed", status: "ready", provenance: { derived_from: "img_001" }, description: "Elon Musk cutout, bg removed" });
  const m = manifest(ws);
  if (m.length !== 2) p.push(`expected 2 records, got ${m.length}`);
  const cut = m.find((r) => r.asset_id === "elon_cutout_001");
  if (cut?.provenance?.derived_from !== "img_001") p.push("cutout missing provenance.derived_from=img_001");
  if (!indexMd(ws).includes("← img_001")) p.push("index.md does not show the derived-from link");
  let arr = []; try { arr = JSON.parse(sh("find-asset.mjs", ["--workspace", ws, "--query", "Elon"]).out); } catch {}
  if (!arr.some((r) => r.asset_id === "img_001")) p.push("find --query Elon did not return img_001");
  add("UC1", "obtain → process(derived) → provenance + findable", p);
}

// ── UC6: brand-kit upload → usage_intent tagged in manifest + index ──
{
  const p = [], ws = mkWs("uc6");
  touch(ws, ".media/raw/logo.png");
  sh("register-asset.mjs", ["--workspace", ws, "--id", "logo_001", "--type", "image", "--path", ".media/raw/logo.png", "--source", "uploaded", "--usage_intent", "must_use", "--tags", "brand,logo", "--description", "Acme logo, must appear in CTA"]);
  const r = manifest(ws).find((x) => x.asset_id === "logo_001");
  if (!r) p.push("logo_001 not registered");
  else if (r.usage_intent !== "must_use") p.push(`usage_intent not stored (got ${JSON.stringify(r.usage_intent)})`);
  if (!indexMd(ws).includes("must_use")) p.push("index.md does not surface usage_intent");
  add("UC6", "brand-kit upload → usage_intent tagged in manifest + index", p);
}

// ── UC3: session-end → promote to personal reusable store ──
let sharedHome;
{
  const p = [], ws = mkWs("uc3");
  sharedHome = mkWs("home");
  touch(ws, ".media/raw/elon_001.jpg");
  reg(ws, { asset_id: "img_001", type: "image", path: ".media/raw/elon_001.jpg", source: "search", status: "ready", entity: "Elon Musk", description: "Elon Musk portrait" });
  const res = sh("promote-personal.mjs", ["--workspace", ws, "--asset", "img_001", "--home", sharedHome]);
  if (!res.ok) p.push(`promote-personal failed: ${(res.err || "").slice(0, 120)}`);
  const hm = manifest(sharedHome).find((r) => r.asset_id === "img_001");
  if (!hm) p.push("img_001 not in personal store");
  else {
    if (hm.reusable !== true) p.push("personal record not marked reusable");
    if (!(hm.used_in || []).includes(ws)) p.push("personal record used_in missing the project");
  }
  if (!existsSync(join(sharedHome, ".media/raw/elon_001.jpg"))) p.push("file not copied into personal store");
  add("UC3", "session-end → promote to personal reusable store", p);
}

// ── UC4: second project → auto-reuse personal asset by entity (no re-fetch) ──
{
  const p = [], ws2 = mkWs("uc4");
  // sharedHome already holds entity "Elon Musk". Per UC4, a new project asking for it should REUSE
  // from personal (resolve order: project → personal → search), not re-fetch.
  const res = sh("resolve.mjs", ["--workspace", ws2, "--type", "image", "--intent", "Elon Musk portrait", "--entity", "Elon Musk", "--auto"], { MEDIA_USE_HOME: sharedHome, MEDIA_USE_SEARCH_CMD: "" });
  let out = {}; try { out = JSON.parse(res.out || res.err); } catch {}
  const reused = res.ok && out.ok === true && out.mode !== "search";
  if (!reused) p.push(`resolve did not reuse from personal by entity (got: ${(res.err || res.out || "").toString().replace(/\s+/g, " ").trim().slice(0, 140)})`);
  add("UC4", "second project → auto-reuse personal asset by entity (no re-fetch)", p, "probes whether resolve checks the personal store");
}

// ── UC5: multi-turn edit → replace BGM (add new + mark old superseded) ──
{
  const p = [], ws = mkWs("uc5");
  touch(ws, ".media/audio/bgm/bgm_001.wav");
  reg(ws, { asset_id: "bgm_001", type: "bgm", path: ".media/audio/bgm/bgm_001.wav", source: "search", status: "ready", description: "calm ambient" });
  touch(ws, ".media/audio/bgm/bgm_002.wav");
  reg(ws, { asset_id: "bgm_002", type: "bgm", path: ".media/audio/bgm/bgm_002.wav", source: "search", status: "ready", description: "energetic upbeat" });
  // agent marks the old one superseded (the ledger supports this via re-register with a new status)
  reg(ws, { asset_id: "bgm_001", type: "bgm", path: ".media/audio/bgm/bgm_001.wav", source: "search", status: "superseded", description: "calm ambient (superseded by bgm_002)" });
  const m = manifest(ws);
  const b1 = m.find((r) => r.asset_id === "bgm_001"), b2 = m.find((r) => r.asset_id === "bgm_002");
  if (!b1 || !b2) p.push("both bgm versions not present after replace");
  if (b1 && b1.status !== "superseded") p.push("old bgm not markable as superseded");
  if (m.filter((r) => r.type === "bgm").length !== 2) p.push("expected exactly 2 bgm records");
  add("UC5", "multi-turn edit → replace BGM (add new + mark old superseded)", p, "supersede is agent-driven — no auto-supersede / dedicated replace verb");
}

// ── report ──
let pass = 0;
for (const r of results) {
  if (r.pass) pass++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.uc}] ${r.name}`);
  if (r.note) console.log(`        note: ${r.note}`);
  for (const pr of r.problems) console.log(`        - ${pr}`);
}
console.log(`\nUSE-CASE ORACLE: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
