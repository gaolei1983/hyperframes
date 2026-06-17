#!/usr/bin/env node
// resolve — one procedure over search / generate / fetch, so the agent doesn't micro-manage providers.
// Honors the decision order in references/resolve.md: reuse / search before generate; freeze before reference.
// The hard part is SELECTION, not the call — so bgm search hands candidates back for the agent to pick,
// rather than silently taking the first hit.
//
// v0.1 wedge: bgm (heygen audio catalog) + tts (hyperframes, free/local).
//
// Usage:
//   node resolve.mjs --workspace <dir> --type bgm --intent "subtle confident tech launch" [--limit 8]
//       → search mode: prints existing project matches + ranked candidates; registers nothing (you pick)
//   node resolve.mjs --workspace <dir> --type bgm --intent "..." --auto            → take top-1, download, register
//   node resolve.mjs --workspace <dir> --type bgm --intent "..." --pick <id|index> → take that one, download, register
//   node resolve.mjs --workspace <dir> --type tts --text "Welcome to Acme" [--voice af_heart] [--id voice_001]
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { ensureWorkspace, upsert, find, readManifest, parseArgs } from "./_ledger.mjs";

function run(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: String(msg) }));
  process.exit(1);
}
// Stable, count-based id matching the workspace convention (bgm_001, voice_001).
function nextId(ws, type, prefix) {
  return `${prefix}_${String(find(ws, { type }).length + 1).padStart(3, "0")}`;
}
// readable label / source signal for an image candidate whose title is often empty (Google).
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}
// pick a file extension from mime first, then the URL, then a type-appropriate default.
function extOf(mime, url, fallback) {
  const m = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (mime && m[mime]) return m[mime];
  const fromUrl = (url.split("?")[0].match(/\.(jpg|jpeg|png|webp|gif|svg)$/i) || [])[1];
  return fromUrl ? fromUrl.toLowerCase().replace("jpeg", "jpg") : fallback;
}

const a = parseArgs(process.argv.slice(2));
const ws = a.workspace || ".media-use-workspace";
ensureWorkspace(ws);
const type = a.type;

if (type === "bgm") {
  const intent = a.intent && a.intent !== true ? a.intent : a.query;
  if (!intent || intent === true) fail("--intent (or --query) is required for --type bgm");

  // step 1 (resolve.md): reuse — surface existing project bgm so we don't re-fetch needlessly.
  const existing = find(ws, { type: "bgm", query: intent }).map((r) => ({
    asset_id: r.asset_id,
    path: r.path,
    description: r.description,
  }));

  // step 3: provider search — heygen audio catalog (semantic, ranked, pre-signed URLs).
  const limit = a.limit && a.limit !== true ? String(a.limit) : "8";
  let res;
  try {
    res = JSON.parse(
      run("heygen", ["audio", "sounds", "list", "--query", intent, "--limit", limit]),
    );
  } catch (e) {
    fail(`heygen audio search failed: ${e.message || e}`);
  }
  const tracks = (res.data || []).map((t, i) => ({
    index: i,
    id: t.id,
    name: t.name,
    description: t.description,
    duration: t.duration,
    score: t.score,
    audio_url: t.audio_url,
  }));

  // SELECTION is agentic unless --auto / --pick (resolve.md: "get the selection right, not just the call").
  let chosen = null;
  if (a.auto) chosen = tracks[0];
  else if (a.pick !== undefined && a.pick !== true) {
    const pick = String(a.pick);
    chosen = tracks.find((t) => t.id === pick) || tracks[Number(pick)];
  }
  if (!chosen) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "search",
          type: "bgm",
          intent,
          existing,
          candidates: tracks.map((t) => ({
            index: t.index,
            id: t.id,
            name: t.name,
            description: t.description,
            duration: t.duration,
            score: t.score,
          })),
          hint: "review candidates, then re-run with --pick <id> (or --auto for top-1)",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // fetch + freeze (resolve.md: resolve first, then freeze — never let a composition reference a signed URL).
  const ext = (chosen.audio_url.split("?")[0].match(/\.(\w+)$/) || ["", "mp3"])[1];
  const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "bgm", "bgm");
  const rel = `.media/audio/bgm/${asset_id}.${ext}`;
  const out = join(ws, rel);
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(chosen.audio_url);
  if (!r.ok) fail(`download failed: HTTP ${r.status}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));

  const saved = upsert(ws, {
    asset_id,
    type: "bgm",
    path: rel,
    source: "search",
    status: "ready",
    description: chosen.description || chosen.name || intent,
    tags: ["bgm"],
    provenance: { provider: "heygen.audio.sounds", prompt: intent },
    metadata: { duration: chosen.duration },
  });

  // persist the resolve decision (intent + candidates + pick) so the selection oracle can score it
  const reportRel = `.media/reports/resolve_${asset_id}.json`;
  mkdirSync(dirname(join(ws, reportRel)), { recursive: true });
  writeFileSync(
    join(ws, reportRel),
    JSON.stringify(
      {
        verb: "resolve:bgm",
        intent,
        picked: chosen.id,
        candidates: tracks.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          duration: t.duration,
          score: t.score,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { ok: true, mode: "resolve", registered: saved.asset_id, path: rel, track: chosen.name },
      null,
      2,
    ),
  );
} else if (type === "sfx") {
  // SFX shares the heygen audio catalog with bgm (the `sound_effect` type is reserved, but SFX clips
  // live in the catalog under `music` and surface via SFX-worded queries). Same flow as bgm; the only
  // difference is SELECTION bias: SFX must be SHORT, so --auto prefers the top-scored clip <= SFX_MAX_DUR
  // rather than blind top-1 (else a 70s "music" track would win a "whoosh" query).
  const SFX_MAX_DUR = 15; // seconds; matches the oracle's contract (oracle-audio-resolve.mjs)
  const intent = a.intent && a.intent !== true ? a.intent : a.query;
  if (!intent || intent === true) fail("--intent (or --query) is required for --type sfx");

  // step 1 (resolve.md): reuse — surface existing project sfx so we don't re-fetch needlessly.
  const existing = find(ws, { type: "sfx", query: intent }).map((r) => ({
    asset_id: r.asset_id,
    path: r.path,
    description: r.description,
  }));

  // step 3: provider search — same heygen audio catalog. SFX is sparse in this music-first catalog,
  // so we lower min-score: the default 0.7 is tuned for music similarity and excludes real SFX clips
  // (they score ~0.6-0.69). The duration bias below drops the longer music false-positives that the
  // lower gate lets in (verified: "ui click" SFX exist at 0.66-0.69, empty at 0.7).
  const limit = a.limit && a.limit !== true ? String(a.limit) : "12";
  let res;
  try {
    res = JSON.parse(
      run("heygen", ["audio", "sounds", "list", "--query", intent, "--limit", limit, "--min-score", "0.4"]),
    );
  } catch (e) {
    fail(`heygen audio search failed: ${e.message || e}`);
  }
  const tracks = (res.data || []).map((t, i) => ({
    index: i,
    id: t.id,
    name: t.name,
    description: t.description,
    duration: t.duration,
    score: t.score,
    audio_url: t.audio_url,
  }));

  // SELECTION is agentic unless --auto / --pick. --auto biases SHORT (the SFX nuance), not blind top-1.
  let chosen = null;
  if (a.auto) chosen = tracks.filter((t) => t.duration != null && t.duration <= SFX_MAX_DUR)[0] || tracks[0];
  else if (a.pick !== undefined && a.pick !== true) {
    const pick = String(a.pick);
    chosen = tracks.find((t) => t.id === pick) || tracks[Number(pick)];
  }
  if (!chosen) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "search",
          type: "sfx",
          intent,
          existing,
          candidates: tracks.map((t) => ({
            index: t.index,
            id: t.id,
            name: t.name,
            description: t.description,
            duration: t.duration,
            score: t.score,
          })),
          hint: "review candidates (short clips = SFX), then re-run with --pick <id> (or --auto for the top short clip)",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // fetch + freeze (resolve.md: resolve first, then freeze — never reference a signed URL).
  const ext = (chosen.audio_url.split("?")[0].match(/\.(\w+)$/) || ["", "mp3"])[1];
  const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "sfx", "sfx");
  const rel = `.media/audio/sfx/${asset_id}.${ext}`;
  const out = join(ws, rel);
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(chosen.audio_url);
  if (!r.ok) fail(`download failed: HTTP ${r.status}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));

  const saved = upsert(ws, {
    asset_id,
    type: "sfx",
    path: rel,
    source: "search",
    status: "ready",
    description: chosen.description || chosen.name || intent,
    tags: ["sfx"],
    provenance: { provider: "heygen.audio.sounds", prompt: intent },
    metadata: { duration: chosen.duration },
  });

  // persist the resolve decision so the selection oracle (select-oracle.mjs) can score it.
  const reportRel = `.media/reports/resolve_${asset_id}.json`;
  mkdirSync(dirname(join(ws, reportRel)), { recursive: true });
  writeFileSync(
    join(ws, reportRel),
    JSON.stringify(
      {
        verb: "resolve:sfx",
        intent,
        picked: chosen.id,
        candidates: tracks.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          duration: t.duration,
          score: t.score,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { ok: true, mode: "resolve", registered: saved.asset_id, path: rel, track: chosen.name },
      null,
      2,
    ),
  );
} else if (type === "image" || type === "icon") {
  // Real-asset search (the search wedge): photos/icons of real entities the agent can't invent.
  // media-use is a THIN client — it does NOT retrieve. It shells out to a configured backend
  // (MEDIA_USE_SEARCH_CMD; a pluggable search backend) and owns
  // the part that's actually hard: SELECTION + freeze + provenance (resolve.md).

  // Agent-selected freeze (be-the-boat): the main agent viewed a select-sheet montage and chose a URL.
  // Freeze exactly that candidate — no search, no heuristic pick; the DECISION was the model's.
  if (a.url && a.url !== true) {
    const entity = a.entity && a.entity !== true ? a.entity : undefined;
    const label = a.intent && a.intent !== true ? a.intent : entity || "agent-selected asset";
    const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "image", type === "icon" ? "icon" : "img");
    const ext = extOf(undefined, a.url, type === "icon" ? "png" : "jpg");
    const rel = `.media/${type === "icon" ? "icons" : "images"}/${asset_id}.${ext}`;
    const out = join(ws, rel);
    mkdirSync(dirname(out), { recursive: true });
    let buf;
    try {
      const r = await fetch(a.url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 (media-use/0.1)" } });
      if (!r.ok) fail(`download failed: HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      fail(`download failed: ${(e.message || e).toString().slice(0, 120)}`);
    }
    writeFileSync(out, buf);
    const saved = upsert(ws, {
      asset_id,
      type: "image",
      path: rel,
      source: "search",
      status: "ready",
      description: a.desc && a.desc !== true ? a.desc : entity || label,
      entity,
      reusable: true,
      tags: type === "icon" ? ["image", "icon"] : ["image"],
      provenance: { provider: "agent-selected", prompt: label, source_url: a.url },
    });
    console.log(JSON.stringify({ ok: true, mode: "resolve", registered: saved.asset_id, path: rel, source_url: a.url }, null, 2));
    process.exit(0);
  }

  const intent = a.intent && a.intent !== true ? a.intent : a.query;
  if (!intent || intent === true) fail(`--intent (or --query) is required for --type ${type}`);

  // step 2 (resolve.md): personal reusable scope — same canonical ENTITY already owned? reuse it
  // (copy a project-local consumed copy + bump used_in) BEFORE any provider search. This is what lets
  // a second similar project auto-fetch history (design UC4) without re-fetching or needing a backend.
  {
    const entity = a.entity && a.entity !== true ? a.entity : undefined;
    const home = process.env.MEDIA_USE_HOME || join(homedir(), ".media");
    if (entity && existsSync(join(home, ".media/manifest.jsonl"))) {
      const owned = readManifest(home).find(
        (r) => r.type === "image" && r.entity === entity && existsSync(join(home, r.path)),
      );
      if (owned) {
        const ext = (owned.path.match(/\.(\w+)$/) || ["", "jpg"])[1];
        const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "image", type === "icon" ? "icon" : "img");
        const rel = `.media/${type === "icon" ? "icons" : "images"}/${asset_id}.${ext}`;
        mkdirSync(dirname(join(ws, rel)), { recursive: true });
        copyFileSync(join(home, owned.path), join(ws, rel));
        const saved = upsert(ws, {
          asset_id,
          type: "image",
          path: rel,
          source: "reuse",
          status: "ready",
          description: owned.description || entity,
          entity,
          reusable: true,
          tags: owned.tags || (type === "icon" ? ["image", "icon"] : ["image"]),
          provenance: { provider: "personal-reuse", reused_from: owned.asset_id, home },
        });
        // bump the personal record's usage so the cross-project ledger reflects the reuse
        upsert(home, {
          ...owned,
          used_in: [...new Set([...(owned.used_in || []), ws])],
          usage_count: (owned.usage_count || (owned.used_in || []).length || 0) + 1,
        });
        console.log(
          JSON.stringify(
            { ok: true, mode: "reuse", registered: saved.asset_id, path: rel, reused_from: owned.asset_id, scope: "personal" },
            null,
            2,
          ),
        );
        process.exit(0);
      }
    }
  }

  const cmd = process.env.MEDIA_USE_SEARCH_CMD;
  if (!cmd) {
    fail(
      "search backend not configured: set MEDIA_USE_SEARCH_CMD to the search executable " +
        "(e.g. a search.sh wrapping your provider). media-use does not retrieve; it calls a backend.",
    );
  }

  // step 1 (resolve.md): reuse — surface existing project images so we don't re-fetch.
  const existing = find(ws, { type: "image", query: intent })
    .filter((r) => (type === "icon" ? (r.tags || []).includes("icon") : true))
    .map((r) => ({ asset_id: r.asset_id, path: r.path, description: r.description }));

  // step 3: provider search via the configured backend (real GoogleImages / NounProject).
  const limit = a.limit && a.limit !== true ? String(a.limit) : "8";
  let res;
  try {
    const out = execFileSync(cmd, ["--query", intent, "--media", type, "--num", limit], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
    });
    res = JSON.parse(out.trim().split("\n").pop()); // last line = JSON (backend logs go to stderr)
  } catch (e) {
    fail(`search backend failed: ${(e.stderr || e.message || e).toString().slice(0, 300)}`);
  }
  if (!res || res.ok === false) fail(`search backend error: ${res ? res.error : "no output"}`);

  const cands = (res.candidates || []).map((c, i) => ({
    index: i,
    id: c.url, // the backend uses the URL as the stable id
    url: c.url,
    name: c.title || hostOf(c.url),
    description: c.title || `${type} from ${hostOf(c.url)}`,
    width: c.width,
    height: c.height,
    mime_type: c.mime_type,
    provider: c.provider,
  }));

  // SELECTION is agentic unless --auto / --pick (resolve.md: get the selection right, not just the call).
  // Ordered download attempts: --pick = just that one; --auto = top candidates in rank order, so a
  // hotlink-blocked top pick falls back to the next instead of failing the whole scene.
  let attempts = [];
  if (a.pick !== undefined && a.pick !== true) {
    const pick = String(a.pick);
    const one = cands.find((c) => c.id === pick) || cands[Number(pick)];
    if (one) attempts = [one];
  } else if (a.auto) {
    attempts = cands.slice(0, 5);
  }
  if (!attempts.length) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "search",
          type,
          intent,
          existing,
          candidates: cands.map((c) => ({
            index: c.index,
            id: c.id,
            name: c.name,
            description: c.description,
            width: c.width,
            height: c.height,
            provider: c.provider,
          })),
          hint: "review candidates (open the urls), then re-run with --pick <index> (or --auto for top-1)",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // fetch + freeze with fallback (resolve.md: resolve first, then freeze). Download can 403 / time out on
  // hotlink-protected hosts (etsy / amazon / some CDNs); try candidates in order until one lands, and send a
  // browser UA since some hosts reject UA-less fetches.
  const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "image", type === "icon" ? "icon" : "img");
  let chosen = null;
  let rel = null;
  const tried = [];
  for (const cand of attempts) {
    const ext = extOf(cand.mime_type, cand.url, type === "icon" ? "png" : "jpg");
    const candRel = `.media/${type === "icon" ? "icons" : "images"}/${asset_id}.${ext}`;
    const out = join(ws, candRel);
    try {
      const r = await fetch(cand.url, {
        signal: AbortSignal.timeout(15000),
        headers: { "user-agent": "Mozilla/5.0 (media-use/0.1)" },
      });
      if (!r.ok) {
        tried.push(`#${cand.index} HTTP${r.status}`);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1024) {
        tried.push(`#${cand.index} tiny(${buf.length}b)`);
        continue;
      }
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buf);
      chosen = cand;
      rel = candRel;
      break;
    } catch (e) {
      tried.push(`#${cand.index} ${(e.name || e.message || "err").toString().slice(0, 24)}`);
    }
  }
  if (!chosen) fail(`all ${attempts.length} candidate download(s) failed: ${tried.join("; ")}`);

  const entity = a.entity && a.entity !== true ? a.entity : undefined;
  const saved = upsert(ws, {
    asset_id,
    type: "image",
    path: rel,
    source: "search",
    status: "ready",
    description: chosen.description || intent,
    entity, // canonical real-entity name, for cross-project reuse matching (resolve order step 2)
    reusable: true, // personal-scope assets are reuse candidates by default
    tags: type === "icon" ? ["image", "icon"] : ["image"],
    provenance: { provider: chosen.provider, prompt: intent, source_url: chosen.url },
    metadata: { width: chosen.width, height: chosen.height, mime_type: chosen.mime_type },
  });

  // persist the resolve decision so the selection oracle can score it (intent + candidates + pick).
  const reportRel = `.media/reports/resolve_${asset_id}.json`;
  mkdirSync(dirname(join(ws, reportRel)), { recursive: true });
  writeFileSync(
    join(ws, reportRel),
    JSON.stringify(
      {
        verb: `resolve:${type}`,
        intent,
        picked: chosen.id,
        candidates: cands.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          provider: c.provider,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { ok: true, mode: "resolve", registered: saved.asset_id, path: rel, source_url: chosen.url },
      null,
      2,
    ),
  );
} else if (type === "tts") {
  const text = a.text;
  if (!text || text === true) fail("--text is required for --type tts");
  const voice = a.voice && a.voice !== true ? a.voice : "af_heart";
  const asset_id = a.id && a.id !== true ? a.id : nextId(ws, "voice", "voice");
  const rel = `.media/audio/voice/${asset_id}.wav`;
  const out = join(ws, rel);
  mkdirSync(dirname(out), { recursive: true });
  try {
    run("hyperframes", ["tts", text, "-o", out, "-v", voice, "--json"]);
  } catch (e) {
    fail(`hyperframes tts failed: ${e.message || e}`);
  }
  const saved = upsert(ws, {
    asset_id,
    type: "voice",
    path: rel,
    source: "generated",
    status: "ready",
    description: `TTS: ${String(text).slice(0, 80)}`,
    tags: ["voice", "tts"],
    provenance: { provider: "hyperframes.tts", model: voice, prompt: String(text).slice(0, 200) },
  });
  console.log(
    JSON.stringify({ ok: true, mode: "resolve", registered: saved.asset_id, path: rel }, null, 2),
  );
} else {
  fail(`unsupported --type '${type}'. v0.1 wedge: bgm | sfx | tts (see references/resolve.md)`);
}
