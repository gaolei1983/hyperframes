---
name: embedded-captions
description: 'Add captions to a talking-head video. ONE catalog (CATALOG.md) of 48 visual identities behind two engines: column-flow (every caption composited INTO the scene — matte occlusion + mix-blend; cream/ink/editorial/keynote/documentary/loud/neon/glitch/chrome/velocity) and 38 themed constitutions across mechanical/light/craft/interface/uncanny families (the quiet `anchor` verbatim default + ordnance/stomp/terminal/neonsign/scoreboard/vhs/laser/hologram/breaking/cover/blueprint/mirror/seance/… — e.g. a glyph-decode climax or a neon sign WRITTEN stroke by stroke). Route by identity, never by mode. Trigger on "captions/subtitles", "embed/cinematic captions", "VFX captions", "explosive / VFX / flashy captions", a named identity, or top-tier motion-graphics asks. Embedding every word is wrong for most talking-head content — `anchor` is the verbatim default. Pipeline: transcription → hyperframes remove-background matting → HTML render → ffmpeg overlay. Requires hyperframes and a single-subject clip.'
metadata:
  tags: captions, embedded-captions, occlusion, matting, talking-head, rembg-matting, whisper, ffmpeg, cinematic
---

# Embedded Captions

**One catalog, picked up front** ([CATALOG.md](CATALOG.md) — 48 identities; the two engines behind it are backend detail). **Column-flow** (Cinematic) is pure embed — no rail, every caption composited _into_ the scene behind the subject (hero typography, accumulation, occlusion as the effect): `cream` `ink` `editorial` `keynote` `documentary` `loud` `neon` `glitch` `chrome` `velocity`. **Theme** is a complete themed constitution — body paradigm × hero setpiece × front fx × plate reaction, composed from registries ([themes/README.md](themes/README.md)); 38 of them, from the quiet verbatim `anchor` (the conservative default — a lower-third rail + a settled climax) through `ordnance` `terminal` `neonsign` `scoreboard` `laser` `breaking` `mirror` …. Most explainer / voiceover wants `anchor` or another rail-surface theme; **embed is the scarce, earned peak** — embedding every word is the common mistake; the loud themes are for VFX-grade asks ("explode", "VFX", "AE-style"). _(The old Standard rail engine was retired 2026-06-12; `anchor` replaced it.)_

---

## Operational flow (TL;DR)

The craft prose below is long; the **pipeline itself is short** — and everything
deterministic is computed or compiled, never hand-written:

1. **Decision gate** (refuse bad clips) → **pick ONE identity from [CATALOG.md](CATALOG.md)** (48 identities; engine/compiler derived by lookup — never surface a mode/category question)
2. `hyperframes init` (skip it if the project dir already exists with the video inside — `matte.cjs`/`transcribe.cjs` adopt any video in the dir as source.mp4) → **`bash scripts/prepare.sh <project>`** (matte ∥ transcribe ∥ audio-envelope in parallel, then safe-zones v2 with scene palette/optics/lighting — one command, nothing forgotten)
3. **author a small JSON of creative choices** (read `safe-zones.json` first):
   Cinematic → `plan.json` → `fill-timings.cjs` → `fit-fonts.cjs` → `make-composition.cjs`;
   Theme → `theme.json` → `make-theme.cjs` (rail/panel/poem/takeover paradigms; `anchor` is the quiet rail default)
4. **Visual QA**: `node scripts/preview-frames.cjs <project>` → faithful composite previews in ~2s/frame (no render). Check § Visual QA before paying for a render.
5. `render-and-composite.sh` → gates (timing / occlusion+hero / overflow / hand-off) → `final.mp4`

Load-bearing rules people miss:

- **rail (default) + embed (promotion).** `drop` (filler, not shown) / `rail` (verbatim lower-third subtitle, in front, carries most text) / `embed` (a peak word composited behind the subject). **Rail-surface themes (e.g. `anchor`) do both**, embedding only the peak(s). See **§ Caption model**.
- **The video is delivered UNTOUCHED (column-flow; **Theme mode's PLATE budget is the one sanctioned exception** — register-gated reaction beats (charge-dim, punch, shake, grain) defined per theme DNA and applied AFTER the matte composite so subject+text+plate move as one frame)** — captions are the only thing added; the matte just lets the subject occlude the embed track. Never grade/recolor/scanline the footage.
- Two rulebooks: **rail → [references/rail.md](references/rail.md)** (thin), **embed craft → [references/composition-craft.md](references/composition-craft.md)** (rich, embed-only). Skim by need.

---

## Caption model — rail + embed

Every spoken phrase is one of three things:

|           | What                                             | How it's shown                                                                                                                                                    |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **drop**  | filler — um/uh, stutters, self-corrections       | not shown                                                                                                                                                         |
| **rail**  | the default — ordinary spoken content (verbatim) | clean lower-third subtitle, **in front**, readable. A punch word can get an inline `emphasis` highlight (accent colour / active-word pop) — it stays on the rail. |
| **embed** | a promoted peak — the headline beat              | one big word composited **behind the subject** (matte occlusion), designed entrance + exit                                                                        |

**The rail carries most of the text; embed is the scarce, earned peak.** Scarcity is **per beat/block, not per clip**: ≤1 hero per block (thought), never two co-visible, ≥ a beat of air between hero windows (the compiler warns under 0.6s). A short clip → usually 1–2; a long explainer → ~one per section. Among multiple heroes, the **largest authored one is the APEX** (it alone gets the full lockup embed + width-fit raise); smaller ones are **MINOR peaks** that ride their column as oversized emphasis lines (fg, damped motion) — not every beat needs the matte showcase, which is exactly what keeps the apex an event. Embedding every word is still the common mistake.

Rail-surface identities build exactly this (rail = `rail.html`, embed = the climax in `index.html`). Column-flow identities drop the rail and make everything embed-style — recommend them only for mood-over-verbatim asks, never for explainer / voiceover where the words must read (CATALOG.md encodes this per identity).

---

## Step 0 — pick ONE identity from the CATALOG

**One front-end, two engines behind.** The user picks an IDENTITY from
[CATALOG.md](CATALOG.md) (48 entries: 10 column-flow + 38 themed); the engine,
compiler and authoring file are derived by lookup from the catalog row.
**Never surface "Cinematic vs Theme" (or the retired Standard) as a question** — those are
backend names (a product has one UX even with several engines). The catalog
encodes everything routing needs: reading surface, voice, recommend-for, scene
needs, adjacency notes for the genuinely-close pairs (loud↔ordnance,
neon↔neonsign, cream↔stardust).

Procedure: probe the clip → shortlist 2–3 identities from the catalog →
recommend ONE with a one-line why → **the user picks** → author that identity's
file. Identities are engine-locked (no cross combos; opening one is a
validation event — see dna/README.md).

**Always present your recommendation and let the user pick before you author.** Don't silently default.

(The full identity table lives in [CATALOG.md](CATALOG.md) — single source of truth for routing. The engine docs below describe each backend's authoring contract.)

**Recommendation heuristic**: use the "Shortlisting heuristics" in [CATALOG.md](CATALOG.md) — they are identity-level (e.g. "explode" shortlists ordnance/stomp/terminal/loud and picks by WHAT should explode), never category-level. Unsure → `anchor`.

- **Cinematic** → write `plan.json` for a locked template, compiled by `make-composition.cjs`.
- **Theme** → read [themes/README.md](themes/README.md), author `theme.json`, run `scripts/render-theme.sh` (compiles + renders + plate reaction → **final_fx.mp4**).

---

## Decision gate — RUN FIRST

Probe the video and classify the scene before either mode.

```bash
ffprobe <video.mp4>                    # specs
ffmpeg -ss <t> -i <video.mp4> -vframes 1 sample.png   # at 20/50/80%
```

Read the samples. Refuse if:

- Multiple speakers / hard cuts (split & render each shot, or refuse)
- No human subject (this skill is for talking-head)
- Under 3 seconds, **no speech**, or face never clearly visible — `transcribe.cjs` warns when audio is near-silent (Whisper hallucinates words like "Thank you." over silence); **heed it and refuse** rather than caption fabricated words
- **Source already has burned-in captions / subtitles / heavy text graphics** — adding a second caption system conflicts and the footage ships untouched (no covering/inpainting). Burned text often appears only mid-clip: sample a **1fps contact sheet** (`ffmpeg -i in.mp4 -vf "fps=1,scale=160:-1,tile=10x5" sheet.png`), don't trust 3 spot frames.
- **Transcript is garbage** — non-native/heavy-accent speech can transcribe into confident gibberish. Sanity-read `transcript.json` before authoring; if it doesn't parse as language, try `WHISPER_MODEL=medium` once, else refuse (a verbatim rail of fabricated words is worse than no captions).
- Busy handheld with fast motion (matte flickers)

### Pre-flight probes (cost nothing, prevent the worst failures)

1. **Shot-cut probe.** Sample frames at 20%, 50%, 80%. If a different subject/scene appears, **trim the clip** before the cut.
2. **Letterbox / pillarbox probe.** Black bars on the first frame? Compute safe content rect and constrain caption placement inside it.
3. **Luminance probe.** Sample the caption region's average luminance — `under 60` → light text reads as-is, `60-180` → add the glyph scrim, `180+` → opaque text + scrim (never bare light text). **Cinematic templates are cream+`screen` and LOCKED** — use this probe to _pick a fitting identity_ (bright scenes → `ink`, or the opaque-rail `anchor` theme), never to recolour one.
4. **Identity recommendation by tone (you recommend; the user picks — see Step 0 + CATALOG.md).** explainer / interview / must-read words → rail/panel-surface identities; poetic / social / "cinematic" → column-flow identities by register; "explode / VFX" / named worlds → themed identities. When unsure → `anchor` (words read, scene safe) — but present a shortlist and let the user choose.

---

## Pipeline — 5 steps

```
1. hyperframes init <project> --non-interactive --video <video.mp4> --skip-skills
2. bash scripts/prepare.sh <project>       # matte ∥ transcribe (parallel) → safe-zones. One command.
                                           #   → frames_fg/ transcript.json safe-zones.json
3. [AGENT STEP — the only creative step] author a small JSON; see below by mode
   Cinematic: author plan.json → node scripts/fill-timings.cjs → fit-fonts.cjs → make-composition.cjs
   Theme:     author theme.json → bash scripts/render-theme.sh <project>   (compiles + renders + plate fx)
4. node scripts/preview-frames.cjs <project>   # ~2s/frame composite previews → § Visual QA (BEFORE the render)
5. bash scripts/render-and-composite.sh <project>  # gates → final.mp4 + history/ snapshot
   (Theme mode: SKIP steps 3b/5 — render-theme.sh already runs compile + render-and-composite
    + _postfx.sh; the deliverable is final_fx.mp4, final.mp4 is pre-plate-reaction)
```

Step 3 differs by mode:

### Step 3 — Cinematic mode (pure embed)

1. **Read `safe-zones.json` first.** Narration planes go in **`zones.hugLeft`/`hugRight`** — clean strips ABUTTING the silhouette (text far from the body reads as floating, not embedded; far corners are the fallback, not the default). The hero defaults to `heroAnchor`/`heroBands.best` (centered ON the subject, ~30–55% occluded). `recommendation:"fg"` moves NARRATION in front for legibility; **the hero stays embedded whenever `heroBands.feasible`** — hero-fg is the last resort.
2. **The DNA is the identity you picked in Step 0** (CATALOG.md) — do not re-open the choice here. Sanity-check it against the scene (bright hero band luma > 150 wants `ink`; full pick guidance lives in the catalog, covering all ten incl. neon / glitch / chrome / velocity). State your pick + why; the user decides. The DNA locks type/palette/blend/motion + hero three-act; safe-zones v2 (`palette`/`optics`/`lighting`) parameterizes it to THIS scene automatically.
3. **Author `<project>/cinematic.json`** — `"dna": "<name>"` + thought-BLOCKS, not raw groups: each block = lines of words (grouped 2–5 at clause boundaries) + the plane it stacks in + per-line `css` (size/weight/style only — no positions) + at most ONE line marked `"hero": true` (the promoted word; `"text"` for display form). Schema: `scripts/make-cinematic.cjs` header.
4. **Compile**: `node scripts/make-cinematic.cjs <project>` — lowers blocks → plan.json → index.html. Generated for you: transcript-sequenced timings, accumulate-within-block, page-flip-between-blocks, **the hero LOCKUP** (a hero block's pre-context, HERO and post-context stack as ONE bonded composition centered on the subject — reading order top→bottom = spoken order by construction; context floats in FRONT while the hero embeds BEHIND = the depth sandwich; a mass rule keeps the hero dominating its context), apex/minor hero split, **reading order by construction**, fg fallback per safe-zones. Then the gates run as usual. _(Hand-authoring plan.json directly remains possible for designs blocks can't express — then run `fill-timings.cjs` + `fit-fonts.cjs` + `make-composition.cjs` yourself.)_

### Step 3 — Theme mode (themed constitution)

**Read [themes/README.md](themes/README.md) FIRST** — paradigm/setpiece registries, linkages, hard rules, and the exact `theme.json` schema.

1. **Pick a theme DNA** by content register (each `themes/<name>.json` has `voice` + `when`). State your pick + why; the user decides.
2. **Author `<project>/theme.json`** — `dna`, `lines` (verbatim, transcript order; 1–5 words each — for `takeover` each line is one CARD), `minors` (emphasis words), `hero:{match}` (the climax word/phrase; leave it OUT of `lines` for embed setpieces, keep it IN for inline setpieces and panel+redact).
3. **Render**: `bash scripts/render-theme.sh <project>` — compiles (verbatim-completeness gate at compile time), renders both layers, composites, applies the plate reaction → `final_fx.mp4`. Use `preview-frames.cjs` between compile and render for Visual QA.

---

## Visual QA — preview BEFORE you render

`node scripts/preview-frames.cjs <project> [t…]` composites **faithful preview frames in ~2s each**
(caption layers screenshotted at seek-time + real video frame + matte occlusion + rail overlay = what
the final composite will look like at that moment). Default samples = each group/climax window.
A full render costs minutes — never use it to _discover_ layout problems.

Check the previews (`<project>/preview/sheet.png`) against this list — these are the failures the
geometric gates **cannot** catch:

1. **Washout** — light text over a bright region (window/sign/sky): unreadable → move the plane or change DNA/mode (bright scene → `ink`).
2. **Text-on-text** — captions over the scene's own text/graphics, or two caption groups colliding.
3. **Reading order** — on-screen vertical order must match spoken order; the hero must not sit below later words.
4. **Hero presence** — the climax should be BIG and visibly behind the subject (~30–55% occluded), not a floating label in a margin.
5. **Balance** — one coherent column/band, not scattered fragments; margins breathing; nothing clipped.

Then the **5 positive checks** in [references/reference-bar.md](references/reference-bar.md)
(poster test · timid test · one-glance hierarchy · scene handshake · dead-air audit) — the
failure list keeps a render from being broken; the positive list is what makes it _designed_.
Ship when both pass.

**Fresh-eyes review (recommended for anything user-facing):** you have confirmation bias about your
own layout. If you can spawn a subagent, give it ONLY the preview sheet + this checklist and ask for
PASS/FIX verdicts per frame ("review these caption previews against the 5-point checklist; answer
PASS or the specific fix per frame"). Apply fixes in plan.json / theme.json, recompile, re-preview —
each loop costs seconds. Render once, when the previews pass.

---

## DNA registries — where each engine's looks live

Every identity in [CATALOG.md](CATALOG.md) is backed by one **DNA file** — its complete
visual language (type, palette logic, motion grammar, hero orchestration), **parameterized
per scene** (accent sampled from the footage, contact shadow along the measured light,
depth-match blur, RMS-coupled hero amplitude). The 48 DNAs live in **two registries, one
per engine** — you never browse DNAs to route: pick the IDENTITY in CATALOG.md and its
engine + registry are derived by lookup.

- **Cinematic** → the 10 column-flow languages in **[dna/](dna/README.md)**: `cream` `ink`
  `editorial` `keynote` `documentary` `loud` `neon` `glitch` `chrome` `velocity`.
  `dna/README.md` holds the full table + the `bandLuma × register` decision rule; authoring:
  `cinematic.json` takes `"dna": "<name>"`.
- **Theme** → the 38 themed constitutions in **[themes/](themes/README.md)**: `anchor`
  `ordnance` `terminal` … (incl. the verbatim-rail `anchor`, which replaced the retired
  Standard mode); authoring: `theme.json` takes `"dna": "<name>"`.

The engine generates the **hero three-act** from the DNA (no authoring needed):
co-visible captions dim (setup) → per-letter entrance with amplitude ∝ spoken loudness
(impact) → breathe + glow until exit (afterglow).

(Legacy: `plan.template:"cinematic-cream"` maps to `dna:"cream"` automatically. The retired
54-template library lives at `~/Downloads/embedded-captions-archive/standard-templates-54/`;
`_motion.md` remains in-skill as the motion-verb reference catalog.)

---

## Aesthetic decision — tone × shot × platform (input to the catalog shortlist, NOT a second router)

Classify the clip on 3 axes and feed the result into CATALOG.md's shortlisting — this section never picks a mode/engine by itself:

**Tone** (what feel does the content have?)

- documentary | conversational | energetic | poetic | keynote | investigative | music-video

**Shot** (what's the framing?)

- close-up (head + shoulders) | mid-shot (torso+) | wide (full body+) | cut-montage (mixed shots)

**Platform** (where will it play?)

- 9:16 portrait (TikTok/IG/Shorts) | 16:9 landscape (YouTube/web) | 1:1 square | broadcast export

Cross-reference the **tone × shot × platform crosswalk** in [CATALOG.md](CATALOG.md) for direction language — it informs the shortlist; the catalog is the only routing surface.

## Composition craft (embed track) — read before embedding

The full **embed-track** playbook lives in **[references/composition-craft.md](references/composition-craft.md)**:
transcript role-annotation, phrase grouping, planes & clean-zone anchoring, zone coherence,
climax pop & readability, edge-breathing, the occlusion 3-step judgement, and
accumulation/persistence. It governs how a _promoted_ phrase sits INTO the scene — read it
before authoring any embed (Cinematic `plan.json` or a theme's `theme.json`). The default **rail**
track has its own, much simpler spec → **[references/rail.md](references/rail.md)**.

---

## Shared knowledge

| Doc                                                                      | What                                                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/rail.md](references/rail.md)                                 | **The rail track** — standard lower-third subtitle spec (the default; carries most text).                                                     |
| [references/composition-craft.md](references/composition-craft.md)       | **The embed-track playbook** — grouping, planes, climax pop, occlusion judgement, accumulation/persistence. Read before embedding.            |
| [dna/README.md](dna/README.md)                                           | **The DNA registry** — ten scene-parameterized visual languages; how to pick.                                                                 |
| [references/reference-bar.md](references/reference-bar.md)               | **The taste bar** — per-register world-class references + the 5 positive checks.                                                              |
| [references/aesthetic-principles.md](references/aesthetic-principles.md) | **The 18 rules.** Beat Veed AI on taste. Read first.                                                                                          |
| [references/anti-patterns.md](references/anti-patterns.md)               | Bugs already locked out (CoreML, letter-spacing reflow, etc.)                                                                                 |
| [references/layout-heuristics.md](references/layout-heuristics.md)       | Step 0 embed-viability gate (is a surface usable — 4 conditions); plane positioning, clean-zone selection, crown 3 conditions, pillarbox math |
| [references/typography-presets.md](references/typography-presets.md)     | Font-size × column-width matrix (starting points)                                                                                             |
| [references/caption-grouping.md](references/caption-grouping.md)         | Word → group rules (pauses, sentence boundaries)                                                                                              |
| [references/failure-modes.md](references/failure-modes.md)               | Long tail of dev gotchas                                                                                                                      |
| [references/bespoke-vs-presets.md](references/bespoke-vs-presets.md)     | Why presets fail sometimes; clone-and-tweak pattern                                                                                           |

**Read the aesthetic principles FIRST.** Everything else is implementation detail.

---

## Non-negotiables

**A gate catches these — but you usually CAN'T predict them before previewing, so PREVIEW and iterate (the first compile/render often won't be right):**

- **Caption hidden by the subject (occlusion).** Depends on the actual matte at that instant — NOT predictable from the JSON. The embed TARGET is ~30–55% occluded (big + visibly behind the speaker, not minimized); `check-occlusion.cjs --strict` ABORTS the render if the subject hides a caption word (>65%). On failure: move the hero to a clearer band / a different beat, or demote it. Catch it in `preview-frames.cjs`, never in a paid render.
- **Captions stay on-frame.** Off-frame bleed depends on rendered text metrics, not the authored JSON — Cinematic hard-gates it (`check-occlusion.cjs`), Theme warns (`check-overflow.cjs`). Preview; if text clips, move/shrink the plane (intentional bleed is the only exception — read the warning).
- **Cinematic word timing / group windows / overlap.** `check-timing.cjs --strict` enforces, on your `plan.json`: timings within **80ms** of `transcript.json`; `group.in ≤ first word.start` and `group.out ≥ last word.end` (else the word is silently delayed/clipped); no two groups overlapping in **both** time and vertical band. A failed compile names which — fix and recompile: caption text = transcript verbatim (intentional subs → `CREATIVE_SUBS`); **one transcript word per entry** (never pack `"FUTURE OF"` — the 2nd inherits the 1st's timestamp; keep two words on one line via CSS `white-space`, **not `<br>`**); resolve overlap by a separate band, handoff (`earlier.out ≤ later.in`), or `"allow_overlap": true`.
- _(The non-gated iterative checks — washout, text-on-text, reading order, hero presence, balance — live in **§ Visual QA**; the gates can't see those either. Preview and fix before you render.)_

**On you — no gate sees these (design judgement):**

- **Never grade/recolor the footage.** It ships untouched; captions are the only addition. No full-frame scanlines / duotone / darken / vignette over the a-roll — CRT/cyberpunk texture belongs _inside_ a caption element. (Theme's register-gated **PLATE** reaction — charge-dim / punch / shake on the composite — is the one sanctioned exception.)
- **Rail-first; embed is scarce + spaced.** Most text is the rail; embed only peaks — **≤1 per beat/thought, never two co-visible, ≥ a beat of air apart, at most one `apex`**. (Cinematic _warns_ when heroes are under a beat apart; in Theme it's on you.) Embedding every word is the default mistake. Full model → § Caption model.
- **Readable contrast — there is NO automatic WCAG lint.** Ensure it yourself: low-contrast scene/palette → add the glyph scrim or pick a higher-contrast identity. **Bright region (>180 luma) → `ink`** (built for bright surfaces) or the opaque-rail `anchor` — never recolour `cream` (its `screen` blend is locked and washes out).
- **Trust the matte only after sampling it.** `frames_fg/` is human segmentation (u2net): mic booms are usually excluded (captions render over them, behind the person), but large props near the subject can leak in (occluding captions) and held objects can drop out (captions pass in front). Sample 2–3 `frames_fg/` timestamps before placing the hero.
- **safe-zones is PROP-BLIND.** Zones/heroBands score subject-occlusion + luma only — a mic / screen / telescope sitting in a "clean" zone is invisible to them (and a leaked prop skews `heroAnchor.centerXPct`). Eyeball one frame of every band you use.
- **Each caption ≥ 0.5s on screen** — shorter is unreadable.

(Matting is CPU-only — ~2 fps @1080p ≈ 2–3 min per 10s clip, budget for it. CoreML is avoided: its mixed-precision partitioning corrupted face alpha — don't re-enable it. More dev gotchas → references/anti-patterns.md + references/failure-modes.md.)

---

## Dependencies

- **hyperframes**, built (`packages/cli/dist/cli.js`). Scripts auto-resolve the checkout: `HYPERFRAMES_ROOT` env → repo root if this skill ships _inside_ hyperframes → `~/Downloads/hyperframes`. Build with `bun install && bun run build`.
- **Node-first; no host Python required.** Theme's stroke setpieces run `node scripts/gen-stroke-path.cjs` at compile time (a Node port — no Python), and WhisperX runs inside `uvx`'s own isolated env (uv fetches its own Python), never the host's. Transcription PREFERS WhisperX via `uvx` (Astral's `uv` — NOT bundled, and a stock hyperframes install usually lacks it; if absent, `transcribe.cjs` **auto-installs uv** by default (official one-liner — single binary, no Python/npm; opt out with `EC_NO_UV_INSTALL=1`, or skip uv via `TRANSCRIBE_ENGINE=whisper`). Everything else runs on the toolchain hyperframes already ships: matting via the hyperframes CLI's **`remove-background`** (u2net_human_seg; weights auto-download once, ~168 MB, to `~/.cache/hyperframes/`), image/alpha math via **`sharp`**, layout/occlusion/overflow via **`puppeteer`**, plus **`ffmpeg`**. These auto-resolve from the hyperframes checkout; the only thing a stock install may lack is WhisperX's `uv` (see Transcription).
- **Transcription = WhisperX via `uvx`** (wav2vec2 word alignment — tighter than whisper.cpp's segment-interpolated timings, which the 80ms gates want). `uv` is the one prereq a stock hyperframes install lacks: `transcribe.cjs` auto-detects it and, **when missing, auto-installs uv by default** (official standalone installer → `~/.local/bin`; single binary, no Python/npm). Opt out with **`EC_NO_UV_INSTALL=1`** (then it STOPS and asks, rather than downgrading) or **`TRANSCRIBE_ENGINE=whisper`** (skip uv → looser whisper.cpp). Also reuses an existing word-level `transcript.json` if present.
- **Source video** — `matte.cjs` / `transcribe.cjs` auto-resolve `source.mp4` (or glob the clip / read `hyperframes.json`), so `hyperframes init --video X.mp4` needs no manual rename.
- **fps** — `matte.cjs` extracts at the source's native rate and records `matte.fps`; `render-and-composite.sh` uses that so the matte stays frame-aligned.
- Matting weights are NOT bundled: `matte.cjs` shells the hyperframes CLI's `remove-background`, which downloads u2net_human_seg (~168 MB, Apache-2.0) once to `~/.cache/hyperframes/background-removal/models/`. First prepare on a fresh machine needs network for that one download.
- **Matte engine — cloud by default when available:** matting uses the HeyGen CLI's `background-removal` (Bria — sharper edges + fewer furniture leaks than local u2net) **whenever the `heygen background-removal` command is installed AND a HeyGen key is set** (`$HEYGEN_API_KEY`, or `heygen auth login` / `hyperframes auth login`); otherwise the local hyperframes `remove-background`. `EC_MATTE=local` forces local; `EC_MATTE=cloud` forces a cloud attempt (surfacing why if it can't). Any cloud failure falls back to local. The command is codegen'd from OpenAPI PR #40076 (**not shipped yet**), so today it auto-uses local everywhere; cloud activates for key-configured users once it ships. (Heads-up: the API is free at launch, but per-second billing is planned — `EC_MATTE=local` opts out.)

If a hard dependency is missing, STOP and ask the user — don't silently skip steps.
