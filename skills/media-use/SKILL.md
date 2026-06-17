---
name: media-use
description: >
  Root-level, on-demand media operations for any task (HyperFrames or not). Use FIRST
  when a scene or task needs a REAL asset that a model cannot invent — a real person's
  photo (a founder, a CEO, an athlete), a real brand logo, a real product shot or UI
  screenshot, a recognizable real place — instead of web-searching ad hoc or generating
  a look-alike. Also use to find, obtain, process (background removal, transcribe),
  organize, or reuse any image / audio / BGM / voice asset. media-use searches real
  assets, lets the MODEL select the best candidate (never blind top-1), freezes it into
  the workspace, and reuses it across projects (same entity, fetched once). Do NOT use
  for video story planning, workflow routing, full-video review, or timeline editing —
  those belong to /video-workflows. Do NOT use to invent or generate visuals — abstract
  scenes stay with the host workflow.
metadata:
  tags: media, assets, real-photos, logos, search, selection, reuse, workspace, manifest, bgm, tts, background-removal
---

# media-use

Agent Media OS. Turns an **explicit media need** into a frozen, selected, reusable workspace asset plus a readable asset index. It does not own narrative, scene design, review, or composition layout.

The wedge: **real-entity search**. A code-based video agent invents every visual — it cannot show the real Sam Altman, the real Nike swoosh, or the real iPhone. media-use closes that gap, and owns the parts that are actually hard: **selection** (which candidate), **freeze** (deterministic local copy), **provenance + reuse** (same entity, fetched once, used everywhere).

media-use is a thin **orchestration + ledger** layer. It does not re-implement capabilities — it **routes**:

- search backend — `MEDIA_USE_SEARCH_CMD` (env var; query in, JSON candidates out). The backend is pluggable (**dev/eval only: licensing for open-web images is unresolved**); the shipped path is `heygen` CLI search over licensed assets (pending).
- `heygen` CLI — account-backed: `heygen audio sounds list` (BGM catalog, shipped), `heygen voice speech create` (TTS), `heygen asset create` (upload).
- `/hyperframes-media` — local / free: `npx hyperframes tts | transcribe | remove-background`.
- `/hyperframes-core` — placing a resolved asset into a composition (placement is not media-use's job).

> Status: **v0.3**. Image/icon search + selection + cross-project reuse + the faceless-explainer bridge, plus BGM / TTS / remove-bg / transcribe — verified end-to-end on rendered videos. **SFX wired** (heygen audio catalog, min-score-tuned); upscale / crop / trim not wired.

## When to use — and when to stay silent

Use on an **explicit media need**: a real person / brand / product / place must appear ("show the founder", "put the real logo on screen", "find a CTA click sound", "remove this background", "reuse the previous logo").

**Stay silent otherwise.** Root-level reach means this skill can trigger anywhere — default conservative. Abstract or conceptual scenes get nothing from media-use; the host invents those. Never run a media operation the user did not ask for.

## Decisions belong to the MAIN agent (agent-first)

media-use is the **hands and the memory; the model is the brain**. The skill never makes a creative judgment with a baked heuristic — it lays out candidates and lets the calling agent decide, through two affordances:

- **Look:** `select-sheet.mjs` / the bridge's montage — candidates tiled 1x3 / 2x2 / 3x2, index stamped top-left; the agent views and picks.
- **Read:** every searched image is captioned to text **once** (cached per URL in `$MEDIA_USE_HOME/.captions.json`, written into the manifest `description`); reranking and reuse compare only the stored text. Same image is never re-visioned.

Inline `claude -p` judgments exist only as the **headless fallback** (`--auto`) for runs with no main agent in the loop.

## The six verbs

| Verb           | What it does                                                                    | Runnable                                                                                                      |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| setup          | lazy-init workspace; probe provider / auth status                               | `setup.mjs` (journey + `--self-test`), `init-workspace.mjs`                                                   |
| organize       | register assets → AssetRecords → manifest → regenerate index                    | `register-asset.mjs`, `render-index.mjs`                                                                      |
| find / preview | read the workspace ("grep for media") / visual gallery                          | `find-asset.mjs`, `gallery.mjs`                                                                               |
| resolve        | reuse → search → **select** → freeze → register (one procedure)                 | `resolve.mjs --type bgm\|tts\|image\|icon` · `--url` freezes the agent's pick · `--entity` tags the reuse key |
| process        | transform an asset; output registered with `provenance.derived_from`            | `process.mjs --asset <id> --action remove-bg\|transcribe`                                                     |
| prepare ◇      | declarative snippet — embedded answer: **speak the host's format** (see bridge) | not built standalone; the bridge injects `assetCandidates`                                                    |

Resolve order: project assets → personal reusable (by canonical **entity**) → provider search → select → freeze → register. Generation of visuals is **deliberately out**: search = real assets only; invention stays with the host.

## Embedded in a host workflow — the bridge (`resolve-scenes.mjs`)

For scene-based hosts (e.g. faceless-explainer), the bridge sits between scriptwriting and the build and rides the host's own asset path (`assetCandidates` + `public/`) — zero host changes. **Agent-first contract** (a host playbook step):

```
1  resolve-scenes --project <dir> --plan
       → scenes + the personal reusable ledger (stored captions included). 0 model calls.
2  YOU decide which scenes depict a real entity; write needs.json
       {"needs":[{"scene":2,"entity":"Elon Musk","query":"Elon Musk portrait","media":"image"}]}
       entity = bare canonical name (the reuse key). A real brand logo is media:"image", never "icon".
       Entities already in `reusable` skip straight to step 5 with a reuse decision.
3  resolve-scenes --project <dir> --search-needs needs.json [--out cands.json]
       → per need: candidates with cached text captions + a numbered montage. NO pick is made.
       Exact-entity reuse matches are surfaced and search is skipped (--force-search to override).
4  YOU decide per need — captions shortlist, but ALWAYS VIEW THE MONTAGE before a fetch
       decision (captions can miss overlaid text / renders / collages); write decisions.json
       {"decisions":[{"scene":2,"entity":"Elon Musk","action":{"type":"reuse","asset_id":"img_001"}},
                     {"scene":3,"entity":"Gigafactory","query":"...","action":{"type":"fetch","url":"https://...","description":"..."}}]}
5  resolve-scenes --project <dir> --apply-decisions decisions.json
       → freeze into personal scope, copy ONE consumed copy into <project>/public/, append the thin
         project ledger, bump used_in, inject assetCandidates. Mechanical; exits non-zero on failures.
```

Headless fallback: `resolve-scenes --auto [--apply]` (inline judge + rerank + reuse via `claude -p`) — batch runs only.

When a real asset is injected, it **is** the scene's hero: workers must build around it, never overlay invented placeholders on top of it.

## Workspace contract

Two scopes (embedded):

- **Project**: `<project>/public/<file>` = the single consumed copy the composition references. `<project>/.media/manifest.jsonl` = thin SSOT (the record's `path` **==** the composition path, i.e. `public/<file>`) + generated `index.md` + `reports/` (selection traces).
- **Personal** (`$MEDIA_USE_HOME`, default `~/.media`): the durable reusable originals + manifest (fields: `entity`, `reusable`, `used_in[]`, `usage_count`) + the caption cache. Cross-project reuse lives here.

Standalone (no host): the skill's own `.media/` workspace layout (`.media/` + manifest + index) per `references/workspace.md`.

Always: manifest = SSOT, `index.md` = generated view (never hand-edit), compositions reference **frozen project-local files only** — never prompts or remote URLs. Lazy init on first use.

## Provider routing (free-first)

Default = free / local first: `npx hyperframes` tools before any paywall. `HEYGEN_API_KEY` / OAuth → `heygen` CLI; neither → free / local. Long-term, provider/model status is the CLI's job; the skill reads it (debt: today the skill probes for itself).

## Relationship to other skills

- `/video-workflows` workflows **call media-use on demand** — the bridge is the explicit handshake for scene-based hosts. media-use never routes workflows or reviews the whole video.
- `/hyperframes-media` owns the local tool docs; media-use invokes and records.
- `/hyperframes-core` owns placement.

## Hard rules

- No video story planning, workflow routing, full-video review, or timeline editing.
- No visual generation — search real assets; invention is the host's.
- Selection is never a baked heuristic: the model looks or reads, then picks. `--auto` top-N fallback is for headless runs only.
- After creating or processing an asset, always append to the manifest and regenerate the index.
- Never write an unresolved prompt or remote URL into a composition — only a frozen, project-local reference.
- A scene may carry several entities: **append** to `assetCandidates`, never overwrite.
- Gate paid capability at resolve / process — never at planning / organize / find.
