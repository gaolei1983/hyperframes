#!/usr/bin/env node
// Image-resolve oracle — media-use's image/icon search wired to an HTTP search backend
// (GET /v3/assets/search) via the asset-search-cli adapter.
//
// Runs resolve --type image|icon with MEDIA_USE_SEARCH_CMD = asset-search-cli.mjs and asserts the
// search wiring: the adapter is called, candidates come back in media-use's shape (url-keyed,
// scored), and resolve surfaces them for selection. (Freeze-from-URL is already covered live by the
// audio oracle + the --url path; UC1 covers register/provenance.)
//
//   ASSET_SEARCH_URL set  → hits the real (dev) endpoint.
//   otherwise             → runs the adapter in MOCK mode (canned candidates, offline) to prove
//                           the media-use ↔ adapter ↔ contract wiring before a dev URL exists.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resolve = join(here, "resolve.mjs");
const adapter = join(here, "asset-search-cli.mjs");
chmodSync(adapter, 0o755); // resolve calls it via execFile → needs the exec bit + shebang

const real = !!process.env.ASSET_SEARCH_URL;
const childEnv = { ...process.env, MEDIA_USE_SEARCH_CMD: adapter };
if (!real) childEnv.ASSET_SEARCH_MOCK = "1";

const CASES = [
  { type: "image", intent: "pepperoni pizza on a wooden table" },
  { type: "icon", intent: "minimalist rocket icon" },
];

let pass = 0;
for (const c of CASES) {
  const ws = mkdtempSync(join(tmpdir(), `mu-img-${c.type}-`));
  const problems = [];
  let out;
  try {
    const raw = execFileSync(
      "node",
      [resolve, "--workspace", ws, "--type", c.type, "--intent", c.intent],
      { encoding: "utf8", env: childEnv },
    );
    out = JSON.parse(raw);
  } catch (e) {
    out = { ok: false, error: (e.stdout || e.stderr || e.message || "").toString().trim().slice(0, 220) };
  }

  if (out.ok !== true) {
    problems.push(`resolve failed: ${out.error || "?"}`);
  } else {
    if (out.mode !== "search") problems.push(`expected mode "search", got "${out.mode}"`);
    const cands = out.candidates || [];
    if (!cands.length) problems.push("adapter returned no candidates");
    else {
      if (!cands[0].id) problems.push("candidate missing id");
      if (cands.some((x) => x.id && !String(x.id).startsWith("http"))) problems.push("candidate id is not a URL");
    }
  }

  const okc = problems.length === 0;
  if (okc) pass++;
  console.log(`${okc ? "PASS" : "FAIL"}  resolve --type ${c.type}  "${c.intent}"  ${okc ? `(${(out.candidates || []).length} candidates)` : ""}`);
  problems.forEach((p) => console.log(`        - ${p}`));
}

console.log(`\nIMAGE ORACLE (${real ? "LIVE backend" : "MOCK adapter"}): ${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
