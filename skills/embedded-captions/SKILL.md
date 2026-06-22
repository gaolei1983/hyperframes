---
name: embedded-captions
description: 'Add captions to a talking-head video. ONE catalog (CATALOG.md) of 48 visual identities behind two engines: column-flow (every caption composited INTO the scene — matte occlusion + mix-blend; cream/ink/editorial/keynote/documentary/loud/neon/glitch/chrome/velocity) and 38 themed constitutions across mechanical/light/craft/interface/uncanny families (the quiet `anchor` verbatim default + ordnance/stomp/terminal/neonsign/scoreboard/vhs/laser/hologram/breaking/cover/blueprint/mirror/seance/… — e.g. a glyph-decode climax or a neon sign WRITTEN stroke by stroke). Route by identity, never by mode. Trigger on "captions/subtitles", "embed/cinematic captions", "VFX captions", "explosive / VFX / flashy captions", a named identity, or top-tier motion-graphics asks. Embedding every word is wrong for most talking-head content — `anchor` is the verbatim default. Pipeline: transcription → hyperframes remove-background matting → HTML render → ffmpeg overlay. Requires hyperframes and a single-subject clip.'
metadata:
  tags: captions, embedded-captions, occlusion, matting, talking-head, rembg-matting, whisper, ffmpeg, cinematic
---

# Embedded Captions

Add captions to a single-subject talking-head video — a verbatim **rail** (lower-third subtitle) plus the occasional word **embedded** behind the speaker (matte occlusion), in one of 48 visual identities. The footage itself is never edited; captions are the only thing added.

> **Routing fence — read before anything.** Route by **IDENTITY**, never by mode/engine. The user picks ONE identity from **[CATALOG.md](CATALOG.md)** — the single routing surface (48 entries; it encodes reading surface, voice, recommend-for, scene needs + adjacency for close pairs like loud↔ordnance, neon↔neonsign, cream↔stardust). Its engine, compiler and authoring file are derived by lookup. The two engines (**column-flow** / **Theme**) and the retired **Standard** are backend names — **never surface "Cinematic vs Theme" as a question** (a product has one UX even with several engines). Identities are engine-locked (no cross-combos; opening one is a validation event). Always **probe → shortlist 2–3 → recommend ONE with a one-line why → the user picks → then author** — never silently default. Unsure → `anchor` (the quiet verbatim default).
>
> _Users say things like:_ "add captions / subtitles", "embed / cinematic captions", "explosive / VFX / flashy captions", or name an identity. Out of scope: editing or cutting the footage itself — this only adds captions.

---

## Caption model — drop / rail / embed

The one concept to hold. Every spoken phrase is one of three things:

|           | What                                             | How it's shown                                                                                                                                   |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **drop**  | filler — um/uh, stutters, self-corrections       | not shown                                                                                                                                        |
| **rail**  | the default — ordinary spoken content (verbatim) | clean lower-third subtitle, **in front**, readable. A punch word can get an inline `emphasis` highlight (accent / active-word pop) — stays rail. |
| **embed** | a promoted peak — the headline beat              | one big word composited **behind the subject** (matte occlusion), designed entrance + exit                                                       |

**The rail carries most of the text; embed is the scarce, earned peak.** Scarcity is **per beat/block, not per clip**: ≤1 hero per block (thought), never two co-visible, ≥ a beat of air between heroes (the compiler warns under 0.6s). Short clip → 1–2; long explainer → ~one per section. Among multiple heroes the **largest authored one is the APEX** (it alone gets the full lockup embed + width-fit raise); smaller ones are **MINOR peaks** that ride their column as oversized emphasis lines (fg, damped motion) — not every beat needs the matte showcase, which is what keeps the apex an event. **Embedding every word is the common mistake** — most explainer / voiceover wants `anchor` or another rail-surface identity. Column-flow identities drop the rail and make everything embed-style — recommend them only for mood-over-verbatim asks, never where the words must read (CATALOG.md encodes this per identity).

---

## The pipeline — Step 0–5

One spine; it **forks at Step 3** by engine, then reconverges. Everything deterministic is computed or compiled — never hand-written.

### Step 0 — pick the identity

Probe the clip → shortlist 2–3 from [CATALOG.md](CATALOG.md) using its **Shortlisting heuristics** (identity-level: "explode" shortlists ordnance/stomp/terminal/loud and picks by WHAT explodes — never category-level) → recommend ONE → the user picks. (See the routing fence above.)
**Gate:** an identity is chosen; you did not surface a mode/engine question.

### Step 1 — decision gate (RUN FIRST) + pre-flight probes

```bash
ffprobe <video.mp4>                                   # specs
ffmpeg -ss <t> -i <video.mp4> -vframes 1 sample.png   # at 20/50/80%
```

**Refuse if:** multiple speakers / hard cuts (split per shot or refuse) · no human subject · under 3s, no speech, or face never clearly visible (`transcribe.cjs` warns on near-silent audio — Whisper hallucinates words like "Thank you." over silence; **heed it and refuse**) · **source already has burned-in captions / subtitles / heavy text** (a 2nd caption system conflicts and the footage ships untouched; burned text often appears only mid-clip, so sample a **1fps contact sheet** — `ffmpeg -i in.mp4 -vf "fps=1,scale=160:-1,tile=10x5" sheet.png` — don't trust 3 frames) · **transcript is garbage** (heavy-accent → confident gibberish; sanity-read `transcript.json`, try `WHISPER_MODEL=medium` once, else refuse — a verbatim rail of fabricated words is worse than none) · busy handheld with fast motion (matte flickers).

Pre-flight probes (cost nothing, prevent the worst failures): **shot-cut** — sample 20/50/80%, trim before any different subject/scene · **letterbox/pillarbox** — black bars on frame 1 → compute the safe content rect, constrain placement inside it · **luminance** — caption region: `<60` light text reads as-is, `60–180` add the glyph scrim, `>180` opaque text + scrim; use it to **pick a fitting identity** (bright → `ink` / `anchor`), never to recolour.
**Gate:** clip accepted (not refused); safe rect + region luminance known.

### Step 2 — prepare

```bash
hyperframes init <project> --non-interactive --video <video.mp4> --skip-skills   # skip if the dir already holds the video — matte/transcribe adopt any video as source.mp4
bash scripts/prepare.sh <project>   # matte ∥ transcribe ∥ audio-envelope (parallel) → safe-zones v2 (scene palette/optics/lighting). One command.
```

**Gate:** `frames_fg/`, `transcript.json`, `safe-zones.json` all exist. **Read `safe-zones.json` before authoring.**

### Step 3 — author the identity's spec (the only creative step) — FORK by engine

Read **[references/composition-craft.md](references/composition-craft.md)** before authoring any embed (Cinematic or Theme) — it governs how a promoted phrase sits INTO the scene (role-annotation, grouping, planes & clean-zone anchoring, climax pop, the occlusion 3-step, accumulation/persistence). The default rail track has its own, simpler spec → [references/rail.md](references/rail.md).

**Cinematic (column-flow)** — author `<project>/cinematic.json`: `"dna":"<name>"` (the Step-0 identity; sanity-check vs scene — hero-band luma >150 wants `ink`) + thought-**BLOCKS** (lines of 2–5 words at clause boundaries) + the plane each stacks in + per-line `css` (size/weight/style only — no positions) + at most ONE line `"hero":true` (`"text"` for display form). Narration planes go in **`zones.hugLeft`/`hugRight`** (clean strips ABUTTING the silhouette — text far from the body floats; far corners are the fallback, not the default). The hero defaults to `heroAnchor`/`heroBands.best` (centered ON the subject, ~30–55% occluded); `recommendation:"fg"` moves NARRATION forward, but the **hero stays embedded whenever `heroBands.feasible`** (hero-fg = last resort). Schema: the `make-cinematic.cjs` header.

```bash
node scripts/make-cinematic.cjs <project>   # blocks → plan.json → index.html
```

Generated for you: transcript-sequenced timings, accumulate-within-block, page-flip-between-blocks, the hero **LOCKUP** (a hero block's pre-context + HERO + post-context stack as ONE bonded composition centered on the subject — reading order top→bottom = spoken order by construction; context floats in FRONT while the hero embeds BEHIND = the depth sandwich; a mass rule keeps the hero dominating its context), the apex/minor split, fg fallback per safe-zones. _(Legacy `plan.template:"cinematic-cream"` maps to `dna:"cream"` automatically.)_

**Theme (themed constitution)** — **read [themes/README.md](identities/themes/README.md) FIRST** (paradigm/setpiece registries, linkages, hard rules, exact schema). Author `<project>/theme.json`: `dna`, `lines` (verbatim, transcript order, 1–5 words each — for `takeover` each line is one CARD), `minors` (emphasis words), `hero:{match}` (the climax word/phrase — leave it OUT of `lines` for embed setpieces, keep it IN for inline setpieces and panel+redact).

```bash
bash scripts/render-theme.sh <project>   # compiles (verbatim-completeness gate) + renders both layers + composites + plate reaction → final_fx.mp4
```

**Gate:** it compiles; the verbatim-completeness gate passes.

### Step 4 — Visual QA (preview; don't render to discover problems)

```bash
node scripts/preview-frames.cjs <project> [t…]   # faithful composite previews, ~2s/frame
```

**Gate:** the § Visual QA failure list AND the 5 positive checks both pass. A full render costs minutes — never use it to _find_ layout bugs.

### Step 5 — render

```bash
bash scripts/render-and-composite.sh <project>   # gates (timing / occlusion+hero / overflow / hand-off) → final.mp4 + history/ snapshot
```

**Theme mode skips this step** — `render-theme.sh` already ran compile + render-and-composite + `_postfx.sh`; the deliverable is **final_fx.mp4** (`final.mp4` is pre-plate-reaction).
**Gate:** all gates green; the deliverable exists.

---

## Visual QA — preview BEFORE you render

`preview-frames.cjs` composites **faithful** frames (caption layers screenshotted at seek-time + the real video frame + matte occlusion + rail overlay = what the final composite looks like at that moment) in ~2s each; default samples = each group/climax window. Check `<project>/preview/sheet.png` against the failures the geometric gates **cannot** catch:

1. **Washout** — light text over a bright region (window/sign/sky) → move the plane or change to `ink`.
2. **Text-on-text** — captions over the scene's own text/graphics, or two groups colliding.
3. **Reading order** — on-screen vertical order must match spoken order; the hero must not sit below later words.
4. **Hero presence** — the climax is BIG and visibly behind the subject (~30–55% occluded), not a floating margin label.
5. **Balance** — one coherent column/band; margins breathing; nothing clipped.

Then the **5 positive checks** in [references/reference-bar.md](references/reference-bar.md) (poster · timid · one-glance hierarchy · scene handshake · dead-air) — the failure list keeps a render from being broken; the positive list is what makes it _designed_. Ship when both pass.
**Fresh-eyes review (recommended for anything user-facing):** spawn a subagent with ONLY the preview sheet + this checklist; ask PASS/FIX per frame. Apply fixes in `plan.json` / `theme.json`, recompile, re-preview (seconds each). Render once, when the previews pass.

---

## Non-negotiables

**A gate catches these — but you usually can't predict them before previewing, so PREVIEW and iterate (the first compile/render often won't be right):**

- **Occlusion.** Depends on the actual matte at that instant — not predictable from the JSON. The embed TARGET is ~30–55% occluded (big + visibly behind the speaker, not minimized); `check-occlusion.cjs --strict` ABORTS the render if the subject hides a caption word (>65%). On failure: move the hero to a clearer band / a different beat, or demote it. Catch it in `preview-frames.cjs`, never in a paid render.
- **Captions stay on-frame.** Off-frame bleed depends on rendered text metrics, not the JSON — Cinematic hard-gates it (`check-occlusion.cjs`), Theme warns (`check-overflow.cjs`). Preview; if text clips, move/shrink the plane (intentional bleed is the only exception).
- **Cinematic word timing / group windows / overlap.** `check-timing.cjs --strict` enforces on your `plan.json`: timings within **80ms** of `transcript.json`; `group.in ≤ first word.start` and `group.out ≥ last word.end` (else the word is silently delayed/clipped); no two groups overlapping in **both** time and vertical band. Caption text = transcript verbatim (intentional subs → `CREATIVE_SUBS`); **one transcript word per entry** (never pack `"FUTURE OF"` — the 2nd inherits the 1st's timestamp; keep two words on one line via CSS `white-space`, **not `<br>`**); resolve overlap by a separate band, a handoff (`earlier.out ≤ later.in`), or `"allow_overlap": true`.
- _(The non-gated iterative checks — washout, text-on-text, reading order, hero presence, balance — live in § Visual QA; the gates can't see those either.)_

**On you — no gate sees these (design judgement):**

- **Never grade/recolor the footage.** It ships untouched; captions are the only addition. No full-frame scanlines / duotone / darken / vignette over the a-roll — CRT/cyberpunk texture belongs _inside_ a caption element. (Theme's register-gated **PLATE** reaction — charge-dim / punch / shake / grain on the composite, applied AFTER the matte so subject+text+plate move as one frame — is the one sanctioned exception.)
- **Rail-first; embed is scarce + spaced** — ≤1 per beat/thought, never two co-visible, ≥ a beat of air apart, at most one `apex`. (Cinematic _warns_ when heroes are under a beat apart; in Theme it's on you.) Full model → § Caption model.
- **Readable contrast — there is NO automatic WCAG lint.** Low-contrast scene/palette → add the glyph scrim or pick a higher-contrast identity. **Bright region (>180 luma) → `ink`** (built for bright surfaces) or the opaque-rail `anchor` — never recolour `cream` (its `screen` blend is locked and washes out).
- **Trust the matte only after sampling it.** `frames_fg/` is u2net human segmentation: mic booms are usually excluded (captions render over them, behind the person), but large props near the subject can leak in (occluding captions) and held objects can drop out (captions pass in front). Sample 2–3 `frames_fg/` timestamps before placing the hero.
- **safe-zones is PROP-BLIND** — zones/heroBands score subject-occlusion + luma only; a mic / screen / telescope sitting in a "clean" zone is invisible to them (and a leaked prop skews `heroAnchor.centerXPct`). Eyeball one frame of every band you use. _(Auto prop-saliency is a known gap — `peakLuma` only catches **moving** bright objects.)_
- **Don't bury the face.** A **fg** caption or hero must never cover the face 100% continuously — keep the face bbox ≥ 30% uncovered in every ~0.3s window. (A bg-layer hero sits behind the subject, so this only bites fg-layer captions.) No gate checks this — it's on you.
- **Each caption ≥ 0.5s on screen** — shorter is unreadable.

_(Matting is CPU-only — ~2 fps @1080p ≈ 2–3 min per 10s clip, budget for it. CoreML is avoided: its mixed-precision partitioning corrupted face alpha — don't re-enable it. More dev gotchas → § Reference map, tier 4.)_

---

## Concepts & registries (cross-cutting — read by need)

**Aesthetic decision — tone × shot × platform.** An INPUT to the CATALOG shortlist, NOT a second router. Classify the clip on 3 axes and feed the result into [CATALOG.md](CATALOG.md)'s shortlisting (it has a tone × shot × platform crosswalk for direction language; the catalog stays the only routing surface):

- **Tone:** documentary | conversational | energetic | poetic | keynote | investigative | music-video
- **Shot:** close-up (head + shoulders) | mid-shot (torso+) | wide (full body+) | cut-montage (mixed shots)
- **Platform:** 9:16 portrait (TikTok/IG/Shorts) | 16:9 landscape (YouTube/web) | 1:1 square | broadcast export

**DNA registries.** Every identity is backed by one **DNA file** — its complete visual language (type, palette logic, motion grammar, hero orchestration), **parameterized per scene** (accent sampled from the footage, contact shadow along the measured light, depth-match blur, RMS-coupled hero amplitude). The 48 DNAs live in two registries, one per engine — you never browse DNAs to route:

- **Cinematic** → the 10 column-flow languages in **[dna/](identities/dna/README.md)**: `cream` `ink` `editorial` `keynote` `documentary` `loud` `neon` `glitch` `chrome` `velocity`. `dna/README.md` holds the full table + the `bandLuma × register` decision rule; `cinematic.json` takes `"dna":"<name>"`.
- **Theme** → the 38 themed constitutions in **[themes/](identities/themes/README.md)**: `anchor` `ordnance` `terminal` … (each a body paradigm × hero setpiece × front fx × plate reaction, composed from registries; incl. the verbatim-rail `anchor`, which replaced the retired Standard mode). `theme.json` takes `"dna":"<name>"`.

The engine generates the **hero three-act** from the DNA (no authoring needed): co-visible captions dim (setup) → per-letter entrance with amplitude ∝ spoken loudness (impact) → breathe + glow until exit (afterglow).

_(Legacy `plan.template:"cinematic-cream"` maps to `dna:"cream"` automatically; `references/_motion.md` is the in-skill motion-verb catalog.)_

---

## Reference map — which file, when

Grouped by when you reach for them; **read the aesthetic principles FIRST**, then the two rulebooks, then mechanics, then the gotcha store (skim tiers 3–4 by need). Routing surface = **[CATALOG.md](CATALOG.md)** (the 48-identity table — single source of truth for routing).

**1 · Taste — read first**

| Doc                                                                      | What                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [references/aesthetic-principles.md](references/aesthetic-principles.md) | **The 18 rules** + the self-critique checklist. Beat Veed AI on taste.                |
| [references/reference-bar.md](references/reference-bar.md)               | **The taste bar** — per-register world-class references + the 5 positive ship-checks. |

**2 · Two rulebooks — the core split**

| Doc                                                                | What                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [references/rail.md](references/rail.md)                           | **The rail track** — standard lower-third subtitle spec (the default; carries most text).                                |
| [references/composition-craft.md](references/composition-craft.md) | **The embed-track playbook** — grouping, planes, climax pop, occlusion, accumulation/persistence. Read before embedding. |

**3 · Authoring mechanics — skim by need**

| Doc                                                                  | What                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/layout-heuristics.md](references/layout-heuristics.md)   | Step 0 embed-viability gate (is a surface usable — 4 conditions); plane positioning, clean-zone selection, crown 3 conditions, pillarbox math. |
| [references/caption-grouping.md](references/caption-grouping.md)     | Word → group rules (pauses, sentence boundaries, editorial drop).                                                                              |
| [references/typography-presets.md](references/typography-presets.md) | Font-size × column-width matrix (starting points).                                                                                             |
| [references/typographic-moves.md](references/typographic-moves.md)   | Per-group typographic palette — the named moves + size-vs-length sanity.                                                                       |
| [references/bespoke-vs-presets.md](references/bespoke-vs-presets.md) | Clone-and-tweak from the canonical example renders; when presets fall short.                                                                   |
| [dna/README.md](identities/dna/README.md)                            | **Cinematic DNA registry** — the 10 scene-parameterized column-flow languages; how to pick.                                                    |
| [themes/README.md](identities/themes/README.md)                      | **Theme registry** — the 38 themed constitutions + paradigm/setpiece registries, linkages, the `theme.json` schema.                            |

**4 · Gotcha store — by section, on failure**

| Doc                                                        | What                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [references/anti-patterns.md](references/anti-patterns.md) | Terse "you default to this, stop" rules (CoreML, letter-spacing reflow, …).        |
| [references/failure-modes.md](references/failure-modes.md) | The mechanism + named bug instances behind each gotcha (SHARP→ARP, cg-4 y=700, …). |
| [references/\_motion.md](references/_motion.md)            | The motion catalog — FLOW/CLIMAX entrance/exit recipes + mood→motion.              |

---

## Dependencies

- **hyperframes**, built (`packages/cli/dist/cli.js`). Scripts auto-resolve the checkout: `HYPERFRAMES_ROOT` env → repo root if this skill ships _inside_ hyperframes → `~/Downloads/hyperframes`. Build with `bun install && bun run build`.
- **Node-first; no host Python required.** Theme's stroke setpieces run `node scripts/gen-stroke-path.cjs` at compile time (a Node port — no Python), and WhisperX runs inside `uvx`'s own isolated env (uv fetches its own Python), never the host's. Everything else runs on the toolchain hyperframes already ships: matting via the hyperframes CLI's **`remove-background`** (u2net_human_seg, Apache-2.0; weights auto-download once, ~168 MB, to `~/.cache/hyperframes/`), image/alpha math via **`sharp`**, layout/occlusion/overflow via **`puppeteer`**, plus **`ffmpeg`**.
- **Transcription = WhisperX via `uvx`** (wav2vec2 word alignment — tighter than whisper.cpp's segment-interpolated timings, which the 80ms gates want). `uv` is the one prereq a stock hyperframes install lacks: `transcribe.cjs` auto-detects it and, **when missing, auto-installs uv by default** (official standalone installer → `~/.local/bin`; single binary, no Python/npm). Opt out with **`EC_NO_UV_INSTALL=1`** (then it STOPS and asks rather than downgrading) or **`TRANSCRIBE_ENGINE=whisper`** (skip uv → looser whisper.cpp). Reuses an existing word-level `transcript.json` if present.
- **Source video** — `matte.cjs` / `transcribe.cjs` auto-resolve `source.mp4` (or glob the clip / read `hyperframes.json`), so `hyperframes init --video X.mp4` needs no manual rename.
- **fps** — `matte.cjs` extracts at the source's native rate and records `matte.fps`; `render-and-composite.sh` uses that so the matte stays frame-aligned. Matting weights are NOT bundled — first prepare on a fresh machine needs network for the one ~168 MB u2net_human_seg download.
- **Matte engine — HeyGen Bria by default when a key is set, else local:** matting uses the live HeyGen **Background Removal API** (real Bria GPU — sharper edges + fewer furniture leaks) **by default whenever a HeyGen credential is present** — `$HEYGEN_API_KEY` (or `$HYPERFRAMES_API_KEY`), or `hyperframes auth login` → shared `~/.heygen/credentials`; otherwise the local hyperframes `remove-background` (u2net). `scripts/matte-cloud.cjs` calls `/v3/background-removals` directly over REST — the same self-contained pattern as `hyperframes-media`'s HeyGen TTS, **no separate `heygen` binary** (hyperframes doesn't bundle one). `EC_MATTE=local` forces local; `EC_MATTE=cloud` forces a cloud attempt (surfacing why if it can't); any cloud failure falls back to local, so a render never breaks. (Free at launch; per-second billing is planned — `EC_MATTE=local` opts out.)

**If a hard dependency is missing, STOP and ask the user — don't silently skip steps.**
