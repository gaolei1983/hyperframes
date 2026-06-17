#!/usr/bin/env node
// asset-search-cli — the MEDIA_USE_SEARCH_CMD bridge from media-use's search contract to an
// HTTP image-search backend (GET /v3/assets/search → re-hosted public images + icons).
// resolve.mjs calls this as:
//     asset-search-cli --query "<text>" --media image|icon --num <N>
// and reads ONE JSON line from stdout: {"ok":true,"candidates":[{url,score,type,width,height,...}]}
//
// Env:
//   ASSET_SEARCH_URL     base URL of the API host (dev/staging). Required for a real call.
//   HEYGEN_API_KEY       API key, sent as `X-Api-Key` (endpoint auth = API key / OAuth).
//   ASSET_SEARCH_MOCK=1  return canned candidates in the real response shape — offline wiring test
//                        for before a reachable dev URL exists.
//
// Notes on the contract (EF #39468 / #39467):
//   - request = {query, limit(1-50), token}; there is NO server-side media-type filter, so we
//     over-fetch and filter by the item `type` client-side.
//   - response item = {id, url, score, type:"image"|"icon", width?, height?, orientation?,
//     is_transparent?}; title/provider/mime are intentionally dropped at the endpoint.
//   - no score floor server-side (text→image cosine); the caller (the model) does selection.
//   - dev-only: prod returns 404 until launch (asset_search_enabled() = ENV != "prod").
import { parseArgs } from "./_ledger.mjs";

const a = parseArgs(process.argv.slice(2));
const query = a.query && a.query !== true ? a.query : "";
const media = a.media && a.media !== true ? a.media : "image"; // "image" | "icon"
const num = a.num && a.num !== true ? Math.max(1, parseInt(a.num, 10) || 8) : 8;

function fail(error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
}
function emit(candidates) {
  console.log(JSON.stringify({ ok: true, candidates }));
  process.exit(0);
}
if (!query) fail("--query is required");

// ── mock mode: canned candidates in the post-mapping shape (offline wiring test) ──
if (process.env.ASSET_SEARCH_MOCK === "1") {
  emit(
    [
      { url: "https://static.example.com/assets/aaa111.png", score: 0.42, type: media, width: 1024, height: 768, is_transparent: media === "icon" },
      { url: "https://static.example.com/assets/bbb222.png", score: 0.39, type: media, width: 800, height: 800, is_transparent: media === "icon" },
      { url: "https://static.example.com/assets/ccc333.png", score: 0.35, type: media, width: 1200, height: 630, is_transparent: media === "icon" },
    ].slice(0, num),
  );
}

// ── real mode: hit GET /v3/assets/search ──
const base = process.env.ASSET_SEARCH_URL;
if (!base) {
  fail(
    "ASSET_SEARCH_URL not set (dev/staging host of GET /v3/assets/search). " +
      "Set it (+ HEYGEN_API_KEY), or set ASSET_SEARCH_MOCK=1 for an offline wiring test.",
  );
}

// No server-side type filter → over-fetch, then filter by item `type` and take the top `num`.
const fetchLimit = Math.min(50, Math.max(num * 3, num));
let u;
try {
  u = new URL("/v3/assets/search", base);
} catch {
  fail(`ASSET_SEARCH_URL is not a valid base URL: ${base}`);
}
u.searchParams.set("query", query);
u.searchParams.set("limit", String(fetchLimit));

const headers = { accept: "application/json" };
if (process.env.HEYGEN_API_KEY) headers["x-api-key"] = process.env.HEYGEN_API_KEY;

try {
  const r = await fetch(u, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const hint = r.status === 404 ? " (dev-gated? prod returns 404 until launch)" : "";
    fail(`HTTP ${r.status} from ${u.pathname}${hint}`);
  }
  const body = await r.json();
  // StandardAPIListResponse wraps results in `data`; tolerate a bare array too.
  const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const candidates = items
    .filter((it) => !media || !it.type || it.type === media)
    .slice(0, num)
    .map((it) => ({
      url: it.url,
      score: it.score,
      type: it.type || media,
      width: it.width,
      height: it.height,
      is_transparent: it.is_transparent,
      // endpoint omits title/provider/mime → resolve labels by URL host
    }));
  emit(candidates);
} catch (e) {
  fail(`asset-search request failed: ${(e.message || e).toString().slice(0, 160)}`);
}
