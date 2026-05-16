# HyperFrames Pipeline Quality — Session Handoff

**Branch:** `feat/pipeline-quality-v2`
**Session dates:** May 15–16 2026 (initial), May 16 2026 (v2 run + fixes)
**Primary workspace:** `/Users/ularkimsanov/Desktop/hyperframes-3/`
**Archive of old videos:** `/Users/ularkimsanov/Desktop/hyperframes-3-archive/videos/`

---

## v2 Run Post-Mortem + Fixes (May 16 2026)

After running all 7 websites through the v2 skill, agents reported their friction points. The results and all priority fixes are documented in `AGENT-FEEDBACK-V2.md`.

### What was fixed (commit `f8e733b9`)

**1. Snapshot tool — two wait-logic bugs fixed**

The old check waited for `[data-hyper-shader-loading]` to _not exist_ in the DOM. Two bugs:

- Cold cache: the overlay stays in the DOM as `display:none` after hiding — element-absence check never resolved, always timed out at 60s
- Warm cache: IndexedDB hydration runs without showing the overlay at all — check resolved instantly before hydration was done

Fix: primary signal is now `window.__hf.shaderTransitions[].ready` (set by HyperShader after both warm and cold cache paths complete). Overlay `display:none` is kept as fallback for older builds. Verified with huly-promo and a 3-scene test composition.

**2. Optional CSS crossfade (cherry-pick from PR #886)**

`TransitionConfig.shader` is now optional. Omitting it gives a smooth CSS opacity crossfade. CSS-only transitions skip WebGL program compilation and prewarming entirely. `HfTransitionMeta.shader` made optional in engine types to match.

Verified: `{ time: 3.0, duration: 0.6 }` (no shader field) renders correctly alongside a WebGL shader transition in the same composition. The "Unknown shader: undefined" error that blocked all 7 v2 agents is now fixed.

**3. SFX ownership moved to Step 3**

All creative SFX decisions (which file, what moment, what volume) now happen in the storyboard step (Step 3), not in Step 5. Step 5 implements exactly what the storyboard specifies. Agents were overusing SFX because they had creative latitude at build time; that's removed.

**4. Audio timing reconciliation gate (Step 4)**

New required check after mapping timestamps: compare real audio duration against storyboard planned total. If delta >15%, agent must rescale beat durations proportionally or trim script before proceeding to Step 5. CTA beat hard-capped at 2–3s hold.

**5. HTML-in-Canvas duplication removed from Step 3**

The `drawElementImage` API detail (build-time knowledge) was duplicated in the storyboard reference file. Kept the planning section ("name it in the storyboard, Step 5 builds it"), removed the implementation details.

### What's still open

- **PR #886** for the shader changes is now redundant on this branch (changes applied directly). The PR can be closed or updated to target main separately.
- **v3 runs**: All 7 websites need re-runs with the same prompts to verify fixes hold. New runs will go into fresh directories; update the eval arena after.
- **HeyGen TTS API shape mismatch**: `data.voices` vs direct list — still needs verification and step-4-vo.md update.
- **Font filename hashing**: captured `.woff2` files have no readable mapping to font family names. Needs a capture pipeline fix.
- **`ReferenceError: outputDir is not defined`** in capture CLI during AGENTS.md generation — CLI bug, not yet fixed.

---

---

## 1. What This Session Was

A deep audit and improvement pass on the `website-to-hyperframes` skill pipeline. The work covered:

1. Full audit of all 11 skill reference files (website-to-hyperframes) + 15 hyperframes core references
2. Multiple rounds of external rater feedback with specific fixes
3. Code fixes in the CLI capture pipeline (contactSheet.ts, agentPromptGenerator.ts, etc.)
4. A new feature in `@hyperframes/shader-transitions`: optional CSS crossfade mixing
5. Bundling of 24 text animation effects into the hyperframes skill
6. Visual style library and vocabulary rewrite to remove prescriptive mappings
7. Setting up an eval arena on HeyGenVerse with all baseline + v2 videos
8. Rendering baseline videos from ab-tests and fresh v2 runs

---

## 2. Git State

### Branch: `feat/pipeline-quality-v2`

All commits on this branch (newest first):

```
309a641c chore: gitignore review-package and scratch files; fix SKILL.md step-1 gate
a80f761c chore(skills): remove old pipeline files left over from prior commits
91c16cd0 chore(skills): remove deprecated step-2-design and step-3-script files
d895bdb9 feat(skills): website-to-hyperframes pipeline v2
e643d882 feat(skills): hyperframes core — remove prescriptive tables, fix tone, bundle text-effects
3cffd373 fix(cli): paginated contact sheets, fit-contain, SVG root scan, semantic colors
d4f18acb feat(skills): add SFX manifest, device models, and local CLI documentation
```

The branch is **fully committed and clean** (0 staged, 0 unstaged tracked changes).

### Separate PR branch: `feat/shader-optional-css-mix`

This branch was created from `main` and contains only the shader-transitions feature:

- `packages/shader-transitions/src/hyper-shader.ts` — `shader?` optional in TransitionConfig
- `packages/engine/src/types.ts` — `shader?` optional in HfTransitionMeta

**PR #886** is open: https://github.com/heygen-com/hyperframes/pull/886

**IMPORTANT:** The `feat/pipeline-quality-v2` branch does NOT contain the shader changes. They're isolated to the PR branch. The published `@hyperframes/shader-transitions` CDN does not have the optional shader feature yet.

### Main branch (`main`)

The `hyperframes-3-main` git worktree was created for testing and then removed. Main is untouched.

---

## 3. The Website-to-HyperFrames Skill — What Changed

### 3.1 File Structure (what's in the skill now)

```
skills/website-to-hyperframes/
├── SKILL.md                          ← main pipeline entry point (7 steps + creative tension principle)
├── assets/
│   └── sfx/                          ← 20 bundled sound effects + manifest.json
└── references/
    ├── step-0-capture.md             ← capture instructions (uses local CLI)
    ├── step-1-design.md              ← DESIGN.md generation (9 sections, no numerical targets)
    ├── step-2-brief.md               ← creative brief conversation with user
    ├── step-3-storyboard.md          ← storyboard + script (combined, with creative tension check)
    ├── step-4-vo.md                  ← TTS (HeyGen first, ElevenLabs second, Kokoro free)
    ├── step-5-build.md               ← build compositions (agent-agnostic sub-agents)
    ├── step-6-validate.md            ← validate + snapshot formula
    ├── capabilities.md               ← full HyperFrames capability inventory
    ├── html-in-canvas-patterns.md    ← HTML-in-Canvas code patterns (Three.js 0.181.2)
    └── visual-vocabulary.md          ← brand-first vocabulary (inverted, no user-word lookup table)
```

### 3.2 Old Files That Were Deleted (IMPORTANT — do NOT recreate)

These files existed in the branch before this session and were causing agents to follow the wrong pipeline:

```
step-1-capture.md     (replaced by step-0-capture.md)
step-4-storyboard.md  (replaced by step-3-storyboard.md)
step-5-vo.md          (replaced by step-4-vo.md)
step-6-build.md       (replaced by step-5-build.md)
step-7-validate.md    (replaced by step-6-validate.md)
step-2-design.md      (replaced by step-1-design.md)
step-3-script.md      (script is now part of step-3-storyboard.md)
composition-guide.md  (superseded)
scripts/generate-skeleton.mjs  (superseded)
```

These were the cause of "AI following wrong pipeline" bugs. They're gone. Don't bring them back.

### 3.3 Key Changes Per File

#### SKILL.md

- Added **Creative Tension Principle** section: agent must answer "What makes this video different from a generic [type] for any [industry] brand?" before writing beat 1
- Added **Step 5.5: Self-Critique** between build and validate
- Added vision capability note (skill requires PNG-viewing agent for validation)
- Fixed Video Types table: removed beat count column (was prescriptive)
- Fixed TTS order: HeyGen first (returns word timestamps), ElevenLabs second, Kokoro free
- Reconciled "take your time" vs "don't sit idle" framing

#### step-0-capture.md

- **Local CLI instruction**: `npx tsx packages/cli/src/cli.ts capture <URL> -o <dir>`
- Contact sheet filenames updated: now look for `contact-sheet-1.jpg`, `contact-sheet-2.jpg`, etc. (paginated)
- "View top 30 individual assets" instruction replaced with targeted read-on-demand only

#### step-1-design.md

- Added 30-second user review gate after writing DESIGN.md (before step 2)
- Removed numerical targets ("12-16 components, 10-15 colors minimum") — they drove padding
- Rewrote Iteration Guide section: kept ONE example (5 rules, Framer), added generic-vs-specific counter-example table showing why generic rules are useless

#### step-2-brief.md

- **Question 2**: Removed "Cinematic = dark backgrounds + glow" prescriptive style menu. Now asks across 6 axes as conversational questions (pace, mood, narration, specific requests)
- **Question 3**: Replaced hardcoded example directions (MacBook, pricing tiers, logo drawing) with `[bracket] generation instructions` that ground examples in actual captured assets. The bad examples are shown as counter-examples with reasons why they're only valid in specific contexts

#### step-3-storyboard.md

- Added creative tension check at the top: answer "what makes this video different" before writing
- Added mandatory **Text Animations** section per beat (must name animate-text effect ID)
- Added **Animation Sequence** section per beat (timestamped choreography)
- Added **Implementation References** per beat (exact files + sections + line ranges for sub-agents)
- Cut example beats from 10 to 2 (removed beats 2–9 to prevent pattern-matching to moodboard/capabilities-grid/phone-mockup layouts)
- Added `text-effects.md` to required reading list
- Removed `!!!` shouts throughout

#### step-4-vo.md

- TTS ranking: HeyGen first (auto word timestamps), ElevenLabs second, Kokoro free
- Added **background music guidance** for non-narrated videos: ask user for track or suggest sources (Artlist, Uppbeat, Freesound)
- Removed `## REQUIRED:` header

#### step-5-build.md

- Added **Captions rule** at top: never create `compositions/captions.html` with empty `const script = []`
- Added **after-build reconciliation check**: list every file in `compositions/`, verify each has a `data-composition-src` host div in `index.html`
- Changed sub-agent dispatch from "YOU MUST spawn a sub-agent" to agent-agnostic: "If your runtime supports parallel sub-agents, dispatch one per beat — 3-4x faster. If not, build sequentially with the same template."
- Sub-agent template now includes **inline brand values** section (paste colors + fonts from DESIGN.md, don't tell sub-agent to re-read the whole file)
- Sub-agent template now includes **targeted file reads** (specific sections + line ranges, not "read capabilities.md in full")
- Added local shader-transitions instruction: `cp packages/shader-transitions/dist/index.global.js <project-dir>/hyper-shader-local.js`

#### step-6-validate.md

- **Snapshot formula**: `max(beats × 3, ceil(duration_seconds / 2))` — not fixed "15 snapshots"
- **View contact sheet first**: look at `snapshots/contact-sheet.jpg` before individual frames
- Density check: "does the frame match the storyboard's density spec?" not "is the frame full?"
- Local CLI instruction: `npx tsx packages/cli/src/cli.ts snapshot <dir> --frames <N>`
- Fixed shout: "REQUIRED / Don't be lazy!" → "Fix issues as you find them [+ reason why]"

#### visual-vocabulary.md

- **Completely rewritten** using rater's version. Old "user says X → fill 6 dimensions" lookup table is GONE.
- New flow: 1) read DESIGN.md and captured site 2) derive baseline per axis 3) apply user words as MODIFIERS not replacements
- Each dimension now has "brand cues that suggest this value" column
- Added "what this word DOESN'T automatically do" for every user word
- Added worked example (wellness app + "high-energy for TikTok" conflict resolution)
- Added "Lazy Defaults to Question" section (cinematic → auto dark, technical → auto dark + terminal, etc.)

#### capabilities.md

- Fixed VFX block count: 7 → 8
- Added text-effects.md reference
- Removed false claim that `onUpdate` and `tl.call()` are banned by linter (they're not)

#### html-in-canvas-patterns.md

- Updated Three.js from `0.147.0` (legacy `examples/js/`) to `0.181.2/+esm` with `examples/jsm/`
- Fixed `Math.random()` in Shatter example → `mulberry32` seeded PRNG

---

## 4. The HyperFrames Core Skill — What Changed

### 4.1 File Structure

```
skills/hyperframes/
├── SKILL.md                      ← unchanged in this session
├── house-style.md                ← light/dark prescription removed
├── visual-styles.md              ← COMPLETE REWRITE (rater's version): YAML recipes gone
├── data-in-motion.md
├── patterns.md
├── palettes/                     ← 9 palette files (unchanged)
├── assets/
│   └── text-effects/
│       ├── effects/              ← 24 JSON files (exact GSAP specs per effect)
│       └── specs/                ← 24 JSON files (portable motion contracts)
└── references/
    ├── beat-direction.md         ← rhythm table removed, verb table restructured, mixing docs
    ├── dynamic-techniques.md     ← energy table restructured with explanatory principles
    ├── motion-principles.md      ← COMPLETE REWRITE (rater's version): no more shouts
    ├── prompt-expansion.md       ← design.md → DESIGN.md casing fixed
    ├── techniques.md             ← "When to Use What" table deleted; Lottie package fixed
    ├── text-effects.md           ← NEW: 24 bundled text animation effects catalog
    ├── transitions.md            ← Energy table → qualities; Mood table → motion qualities
    ├── typography.md             ← "Guardrails" → "Defaults to watch for" (rater's version)
    ├── video-composition.md      ← density contradiction fixed (3-layer rule vs 8-10 target)
    └── transitions/catalog.md + 13 CSS category files (unchanged)
```

### 4.2 visual-styles.md — Complete Rewrite

Previous version had 8 styles with full YAML token blocks (colors, typography, motion, transition names). Agents were pasting these wholesale.

New version (rater's draft):

- YAML blocks completely removed
- Styles renamed to their actual design traditions (Swiss/International Typographic, Late-Modernist Editorial, Punk/Post-Modern Print, American Maximalist, Computational/Generative, Humanist/Personal, Cultural/Vernacular, Cinematic/Title Sequence)
- Each entry has: "What it teaches", "Where it resonates", "Pitfalls when borrowing it", tags as hashtags
- No lookup table ("for SaaS use X") — replaced with deliberation process
- Added explicit "Not a style picker" and "Not a token source" sections

### 4.3 motion-principles.md — Complete Rewrite

Previous version opened every section with "You know these rules but you violate them. Stop." / "You do this constantly." / "You will try to use 14px. Don't."

New version (rater's draft):

- Tone completely changed: "Common defaults that produce monoculture"
- Speed table converted to calibration ranges prose with "not prescriptions" framing
- All Load-Bearing GSAP Rules preserved verbatim (these are critical and correct)

### 4.4 typography.md — Top Section Rewrite

- "Banned" → "Banned fonts" with added caveat: if the brand actually uses one of these fonts, use it
- "Guardrails / You know these rules but violate them" → "Defaults to watch for"
- "What You Don't Do Without Being Told" → "Principles"

### 4.5 beat-direction.md Changes

- **Rhythm pattern table removed**: was mapping "social ad = hook-PUNCH-hold-CTA" etc.
- Replaced with: questions that derive rhythm from brand + storyboard
- **Verb table restructured**: was "High energy → SLAMS, CRASHES" / "Low energy → FLOATS". Now grouped by physical character (Impact/weight, Directional, Reveals/builds, Organic/ambient, Mechanical) without energy labels
- **CSS transitions "Feel" column** renamed to "Motion character" with physical descriptions
- **Shader table "Best for" column** removed — only visual description + duration range remains
- **Shader+CSS mixing** documented: `shader?` optional in TransitionConfig, CSS crossfade when omitted
- Added "Let HyperShader create the timeline — don't pass `timeline:` option"

### 4.6 transitions.md Changes

- **Energy → Transition Character table**: removed named transitions, replaced with motion quality descriptions (Soft/organic, Directional/purposeful, Percussive/instant)
- **Mood → Transition Type table**: renamed to "Mood → Motion Quality", removed specific transition names, shows motion characteristics instead
- **Narrative Position table**: removed named transitions from Wind-down and Outro, kept intent/reasoning
- **Blur Intensity table**: converted to calibration ranges prose with "not prescriptions"
- **Mixing documented**: CSS crossfade + shader in same HyperShader composition (verified working)

### 4.7 techniques.md Changes

- **"When to Use What" table deleted** (was mapping "Technical → Character typing + terminal UI + WebGL shader art + device mockups" etc.)
- Replaced with: "choose techniques based on beat's concept, not video genre"
- Easing mood mapping: removed specific easing → content type prescriptions
- Lottie package name fixed: `@dotlottie/player-component` → `@lottiefiles/dotlottie-web`
- Added `text-effects.md` reference at top of Table of Contents

### 4.8 dynamic-techniques.md Changes

- Energy table restructured: explains WHY each dimension changes with energy (highlight amplitude, exit style, cycle variation), then shows table as calibration reference
- Added brand override note before table

### 4.9 video-composition.md Changes

- Fixed density contradiction: "Aim for 8-10 visual elements per scene" removed (contradicted "sparse beats are intentional")
- Replaced with: all three layers (background, midground, foreground) should be present, even in sparse beats. Count follows storyboard density spec.

### 4.10 text-effects.md + assets/text-effects/ — NEW

24 named text animation effects bundled directly into the hyperframes skill. No separate install needed.

Location: `skills/hyperframes/references/text-effects.md` (catalog)
Location: `skills/hyperframes/assets/text-effects/effects/<id>.json` (exact GSAP recipes)
Location: `skills/hyperframes/assets/text-effects/specs/<id>.json` (portable contracts)

Effects are organized by target type:

- **Per-character**: soft-blur-in, per-character-rise, typewriter, bottom-up-letters, top-down-letters, stagger-from-center, stagger-from-edges
- **Per-word**: per-word-crossfade, spring-scale-in, shared-axis-y, blur-out-up, kinetic-center-build, short-slide-right, short-slide-down, depth-parallax-words
- **Per-line**: mask-reveal-up, line-by-line-slide
- **Whole element**: micro-scale-fade, shimmer-sweep, fade-through, shared-axis-z, scale-down-fade, focus-blur-resolve, shared-axis-x

**How agents use them**: read the catalog, pick effect by ID, read `effects/<id>.json`, use `showcase.library_adapters.gsap` block for exact GSAP implementation.

**In storyboard**: every text element in every beat must name a specific effect ID, not say "fades in."

Source of these specs: `pixel-point/animate-text` skill (installed locally, assets copied into repo so no separate install needed).

---

## 5. CLI Code Changes

### 5.1 contactSheet.ts (NEW FILE)

`packages/cli/src/capture/contactSheet.ts`

Key changes from the old embedded code:

- `fit: "cover"` → `fit: "contain"` with dark background — assets no longer cropped to first image's aspect ratio
- **Paginated grids**: all three grid types now generate multiple pages if needed
  - Screenshots: 3 cols max, 9 per page (3×3)
  - Assets: 4 cols, 12 per page (4×3)
  - SVGs: 5 cols, 15 per page (5×3)
- Functions now return `string[]` (array of generated file paths) instead of `string | null`
- `createSvgContactSheet` accepts optional `assetsRootDir` param — scans BOTH `assets/svgs/` (inline SVGs) AND `assets/` root (external SVGs from `<img src="*.svg">`)

### 5.2 index.ts

- Passes both `assetsDir` and `svgsDir` to `createSvgContactSheet`
- SVG contact sheet output path: if `assets/svgs/` exists → `assets/svgs/contact-sheet.jpg`, else → `assets/contact-sheet-svgs.jpg`
- Updated progress messages to report page count

### 5.3 snapshot.ts

- Updated to handle `string[]` return from `createSnapshotContactSheet`
- Progress message shows page count

### 5.4 agentPromptGenerator.ts

- Added `inferColorRole()` function: classifies hex colors as bg-dark, bg-light, accent, surface-dark, surface-light, neutral based on luminance/saturation
- Brand Summary colors now show: `#533AFD (accent)` instead of bare hex
- CLAUDE.md table dynamically lists all contact sheet pages by scanning the directory (not hardcoded)

### 5.5 designStyleExtractor.ts (NEW FILE)

Extracted design style computation into its own file.

---

## 6. Shader Transitions Feature (PR #886)

### What Was Built

Made `shader` field optional in `TransitionConfig`. When omitted, HyperShader performs a smooth CSS opacity crossfade using the existing `applyFallbackTransition()` path.

```typescript
// Before: shader was required
transitions: [
  { time: 4.0, shader: "sdf-iris", duration: 0.7 },
  // no way to have a non-shader transition
];

// After: shader is optional
transitions: [
  { time: 4.0, shader: "sdf-iris", duration: 0.7 }, // WebGL shader
  { time: 8.5, duration: 0.8 }, // no shader → CSS crossfade
  { time: 13.0, shader: "domain-warp", duration: 0.6 }, // WebGL shader
];
```

### Files Changed

- `packages/shader-transitions/src/hyper-shader.ts`:
  - `TransitionConfig.shader?: ShaderName` (optional)
  - `CachedTransition.prog: WebGLProgram | null`
  - Skip program compilation for CSS-only transitions
  - CSS transitions: `dirty: false, ready: true, fallback: true`
  - `renderShader(state.prog!)` non-null assertion (safe — fallback returns before this point)
  - `HfTransitionMeta.shader?: string` (local interface)

- `packages/engine/src/types.ts`:
  - `HfTransitionMeta.shader?: string` (was required `string`)

### How to Use (Correct Pattern)

```javascript
// LET HyperShader create the timeline — do NOT pass timeline: option
var tl = HyperShader.init({
  bgColor: "#000",
  accentColor: "#6366f1",
  scenes: ["s1", "s2", "s3"],
  transitions: [
    { time: 3.5, shader: "sdf-iris", duration: 0.7 },
    { time: 7.5, duration: 0.8 }, // CSS crossfade
  ],
  previewCaptureFps: 15,
});
// Add ALL composition tweens to tl AFTER init()
tl.fromTo("#hero", { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.2);
window.__timelines["main"] = tl;
```

**Critical**: Do NOT pass `timeline: tl` to `HyperShader.init()`. This breaks the player scrubber. Let HyperShader create the timeline and register all tweens on the returned `tl`.

### Deployment Status

**NOT YET DEPLOYED.** The changes are in `packages/shader-transitions/dist/` locally but not published to npm/CDN. Until the PR merges and the package is published:

- Skill instructions say to copy the local dist: `cp packages/shader-transitions/dist/index.global.js <project-dir>/hyper-shader-local.js`
- Reference it as `<script src="hyper-shader-local.js"></script>` in compositions

The PR is open at: https://github.com/heygen-com/hyperframes/pull/886

---

## 7. What Was Deliberately Left Alone (and Why)

### audio-reactive.md

Clean. Good "content not medium" principle. No prescriptive issues.

### transcript-guide.md

Clean. Good quality gates and retry logic. Technical reference only.

### captions.md

Mostly clean. Script-to-Style Mapping table is slightly recipe-shaped but narrower surface — captions rarely override brand style.

### narration.md

Clean. "Vary the hook type — don't default to a stat every time" note is correct.

### prompt-expansion.md (hyperframes skill)

This is for the **standalone hyperframes skill** (not w2h pipeline). It's wired into hyperframes/SKILL.md Step 2. It's NOT in the w2h pipeline — the w2h skill has its own equivalent in step-3-storyboard.md. Fixed: `design.md` → `DESIGN.md` casing, rhythm template reference updated.

### css-patterns.md, transitions/catalog.md, audio-reactive.md

All clean. Code reference files only.

### typography.md (lower half)

Font discovery script, Selection Thinking, Similar-Font Pairing, Dark Backgrounds, OpenType Features — all excellent and unchanged.

---

## 8. The External Rater Feedback Summary

Three rounds of feedback from an external rater. Key findings and what was done:

### Round 1 (Initial audit)

- **Prescriptive mapping problem**: 6 lookup tables turning user words into recipes
- **Step 2 capabilities pitch**: 15 hardcoded bullets, not personalized
- **Step 5 sub-agent rule rigidity**: Assumed Claude Code sub-agents
- **Missing**: Step 1 user gate, TTS ranking wrong, background music gap, snapshots don't scale

**What got done**: All 5 of these were fixed.

### Round 2 (After first fixes)

- "Guardrail paragraphs above intact tables" don't work — tables still there
- visual-styles.md YAML blocks still present = still pasteable recipes
- visual-vocabulary.md lookup table still there
- beat-direction.md rhythm table still there
- transitions.md tables still there
- dynamic-techniques.md energy table still there

**What got done**: Rater provided draft rewrites of visual-styles.md and visual-vocabulary.md. Both adopted. Four other tables structurally changed.

### Round 3 (After second fixes)

- step-1-design.md Iteration Guide: two 10-12 rule examples = paste templates
- step-2-brief.md Q3: hardcoded example directions (MacBook, pricing tiers, logo drawing)
- transitions.md Energy table: same recipe shape as Blur Intensity table
- beat-direction.md Animation Choreography verb table: energy → verbs still prescriptive
- SKILL.md Video Types table: beat count in the table was prescriptive

**What got done**: All five fixed. Rater provided iteration guide fix and Q3 fix — both adopted.

### Final assessment from rater

"Six major prescriptive tables restructured. Two counter-example patterns landed. SKILL.md video types table got the most surgical fix (remove beat count column, add duration driver column). The skill's 'produce a video that's of this brand' claim is now structurally supported."

---

## 9. The Eval Arena

### URL

https://www.heygenverse.com/a/c927789b-7d96-4acb-b011-8b337e4cd5e3

### What It Is

HeyGenVerse app — pairwise video comparison arena. Pick any two video runs, compare side-by-side with synced playback. Click thumbnail to expand fullscreen. Rate 1-5 stars and leave notes per comparison (persisted in localStorage).

### All Videos in the Arena

| Website           | Run      | Label                   | HeyGenVerse URL      |
| ----------------- | -------- | ----------------------- | -------------------- |
| loom.com          | v1       | Main branch (old skill) | `/s/843f1dea.../raw` |
| loom.com          | v2       | Feat branch             | `/s/d0c0c40f.../raw` |
| framer.com        | baseline | Pre-skill reference     | `/s/f6d9e9cf.../raw` |
| framer.com        | v2       | Feat branch             | `/s/eb0c44ec.../raw` |
| raycast.com       | baseline | Pre-skill reference     | `/s/c8119335.../raw` |
| raycast.com       | v2       | Feat branch             | `/s/7c8c2880.../raw` |
| workos.com        | baseline | Pre-skill reference     | `/s/8e2a8176.../raw` |
| workos.com        | v2       | Feat branch             | `/s/e43d9f1e.../raw` |
| huly.io           | v1       | Main branch             | `/s/cc48c344.../raw` |
| huly.io           | v2       | Feat branch             | `/s/812479fe.../raw` |
| arc.net           | v1       | Main branch             | `/s/a18a9df4.../raw` |
| arc.net           | v2       | Feat branch             | `/s/e696390a.../raw` |
| mercury.com       | v1       | Main branch             | `/s/5af15cf2.../raw` |
| mercury.com       | v2       | Feat branch             | `/s/0e3b5ba9.../raw` |
| daylight.computer | v1       | Main branch             | `/s/e1ca187d.../raw` |
| daylight.computer | v2       | Feat branch             | `/s/a3f5b459.../raw` |

Pending (no v2 yet): fey.com

### Local Render Files

Baselines saved to: `/Users/ularkimsanov/Desktop/hyperframes-3/videos/baselines/`

- `arc-main.mp4`
- `mercury-main.mp4`
- `daylight-main.mp4`
- `huly-main.mp4`

V2 renders at: `/Users/ularkimsanov/Desktop/hyperframes-3/videos/<project>/renders/<name>-feat.mp4`

Old videos archived to: `/Users/ularkimsanov/Desktop/hyperframes-3-archive/videos/` (30 projects)

---

## 10. Key Technical Discoveries This Session

### 10.1 The Missing Beats Bug (Root Cause)

Most common reason beats don't show in final video: AI creates `compositions/beat-N.html` files but never wires them into `index.html` with `data-composition-src`. The fix is now in step-5-build.md: reconciliation check after all compositions are built — list every file in `compositions/`, verify each has a host div.

### 10.2 Contact Sheet Was Silently Failing

The `try/catch` around contact sheet generation was swallowing errors. New captures without Sharp installed silently produced no contact sheets. huly-launch and workos-demo captures had no contact sheets because they were captured before contact sheets were implemented.

### 10.3 SVG Contact Sheets Were Missing External SVGs

Two separate codepaths for SVGs:

- Inline SVGs (extracted from DOM) → `assets/svgs/`
- External SVGs (`<img src="logo.svg">`) → `assets/` root

`createSvgContactSheet` only scanned `assets/svgs/`. Sites like huly.io (all SVGs external) had zero coverage in any contact sheet. Fixed: now scans both locations and deduplicates by filename.

### 10.4 HyperShader Pattern

**The wrong pattern** (breaks player scrubber):

```javascript
const tl = gsap.timeline({ paused: true });
// add tweens to tl
HyperShader.init({ timeline: tl, ... });
window.__timelines["main"] = tl;
```

**The correct pattern**:

```javascript
const tl = HyperShader.init({ ... }); // no timeline: option
// add tweens to RETURNED tl
tl.fromTo(...);
window.__timelines["main"] = tl;
```

When you pass `timeline: tl`, HyperShader patches the existing timeline but `registerTimeline` skips registration (because `provided` is truthy). The player bridge's seek calls work, but the pre-warming during playback goes wrong and the scrubber breaks.

### 10.5 `flash-through-white` Overuse Problem

`capabilities.md` line said `flash-through-white` was "ideal as invisible bridge at duration: 0.01". This caused agents to use it as a workaround for the old "all-or-nothing" HyperShader constraint. Every composition started getting white flashes.

Fixes:

1. Removed "ideal as invisible bridge" from capabilities.md
2. The optional shader feature eliminates the need for this workaround entirely
3. `beat-direction.md` now says "use flash-through-white only when the brand/content specifically calls for white transitions"

### 10.6 The Loom Video Comparison (Main vs Feat)

Main branch (old skill) produced a better video. Key learnings:

- Old skill made fewer choices → fewer chances to go wrong
- New skill's "creative tension principle" pushed agent to be distinctive, and it landed on DARK theme for Loom (a white brand)
- New skill used raw `scroll-000.png` as a full-bleed background — with the cookie consent popup visible in the video
- The "better result" from main branch was partly because the AI used the HyperFrames MCP compose tool (cloud agent) when local rendering failed, not the skill itself

The honest conclusion: some of our changes helped, some added complexity that created new failure modes. The code fixes (contact sheets, HyperShader pattern) are solid. Some documentation changes may have added too much process.

### 10.7 The HyperFrames MCP

`mcp__claude_ai_Hyperframes_Dev_MCP__compose` — cloud tool available via MCP. When an agent uses this, it outsources video creation to a HeyGen cloud service that has its own pipeline. This is NOT the local `website-to-hyperframes` skill. If you see suspiciously good results in a session that used this tool, it's the cloud agent, not the skill.

To prevent this from contaminating evals: tell agents at the start "Do not use the HyperFrames MCP or any compose tools. Build everything locally using the website-to-hyperframes skill only."

### 10.8 Local CLI vs Published CLI

Published `npx hyperframes` = version 0.6.6. Does NOT include our capture pipeline changes.

For capture and snapshot:

```bash
npx tsx packages/cli/src/cli.ts capture <URL> -o <dir>
npx tsx packages/cli/src/cli.ts snapshot <dir> --frames <N>
```

For everything else (lint, validate, preview, render): `npx hyperframes` is fine.

This is documented in `CLAUDE.md` at repo root.

---

## 11. The Video Projects

### ab-tests Baselines (external, not in hyperframes-3 repo)

Location: `/Users/ularkimsanov/Desktop/ab-tests/`

Contains:

- `framer-baseline/` + `framer-after-v1` through `v9`
- `raycast-baseline/` + `raycast-after-v1` through `v9`
- `workos-baseline/` + `workos-after-v1` through `v9`
- `huly-after-v3` through `v9` (no clean baseline)
- `huly-baseline/` exists but was generated long after the others — NOT a valid baseline

Baseline renders (already uploaded to HeyGenVerse and in eval arena):

- `framer-baseline/renders/framer-baseline.mp4`
- `raycast-baseline/renders/raycast-baseline.mp4`
- `workos-baseline/renders/workos-baseline.mp4`

### Fresh V2 Runs (in hyperframes-3 repo)

All created using `feat/pipeline-quality-v2` skill. Located at `/Users/ularkimsanov/Desktop/hyperframes-3/videos/`:

| Project         | URL               | Render                            |
| --------------- | ----------------- | --------------------------------- |
| arc-launch      | arc.net           | renders/arc-feat.mp4 (4.9MB)      |
| daylight-launch | daylight.computer | renders/daylight-feat.mp4 (8.9MB) |
| framer-promo    | framer.com        | renders/framer-feat.mp4 (8.7MB)   |
| huly-promo      | huly.io           | renders/huly-feat.mp4 (4.3MB)     |
| mercury-launch  | mercury.com       | renders/mercury-feat.mp4 (7.4MB)  |
| raycast-demo    | raycast.com       | renders/raycast-feat.mp4 (5.3MB)  |
| workos-promo    | workos.com        | renders/workos-feat.mp4 (3.3MB)   |

**loom-promo** has both v1 (main branch) and v2 (feat branch).

### Old Videos Archived

30 old video projects moved to `/Users/ularkimsanov/Desktop/hyperframes-3-archive/videos/`. The `videos/` folder in the repo is now clean for fresh runs.

---

## 12. Pending Work / What's Still Open

### 12.1 Shader PR

PR #886 is open. Once merged and the package published to npm, the documentation about copying `hyper-shader-local.js` can be simplified. The capability is real and tested.

### 12.2 Eval Iteration

The eval arena has v1 vs v2 for 7 sites + baselines for 3 sites. Next steps:

1. Actually watch and compare the videos in the arena
2. Rate them (1-5 stars + notes)
3. Identify specific failures (wrong brand mood, wrong theme, cookie popups, etc.)
4. Decide what skill changes to make based on real evidence
5. Re-run the same prompts with changed skill
6. Compare v2 vs v3

### 12.3 The Fey Video

`fey-brand-launch` in videos/ exists. It was captured but the video had issues:

- Wrong theme: dark/cinematic for a light brand
- `timeline: tl` was passed to HyperShader (breaks scrubber)
- Transitions were fixed: replaced flash-through-white with cross-warp-morph + thermal-distortion
- It needs a fresh run from scratch in a new directory (fey-feat/) to get a clean v2 comparison

### 12.4 The Huly Fresh Run Issue

The huly-promo in `videos/` was created with the feat branch skill. But an earlier attempt in the session used the wrong directory (`videos/huly-promo/`) which had stale files from a previous run, causing the AI to skip steps. The current render might be from a session that read stale state.

Recommend: verify the huly-promo video in the arena is actually a proper fresh run before using it in evaluations.

### 12.5 The Promise of "Simpler = Better"

The Loom comparison showed the old skill (fewer instructions, fewer decision points) produced a more on-brand video. The new skill's complexity created new failure modes. This is worth sitting with before doing more documentation work:

- Code fixes (contact sheets, HyperShader pattern, SVG scanner) = clear wins
- Prescriptive table removal = probably helpful
- The creative tension principle and 6-axis brand derivation process = unclear if net positive
- Counter-examples in step-1 iteration guide and step-2 Q3 = probably helpful

Next iteration should be guided by actual eval results, not documentation instinct.

---

## 13. Environment + Dependencies

### Node/Bun

- Uses **bun**, not npm/pnpm. `bun install` to install deps.
- `bunx oxlint` and `bunx oxfmt` for linting/formatting
- Pre-commit hooks via `lefthook`

### .env file at repo root

```
GEMINI_API_KEY=AIzaSyAm0NydYFq7p1agEmaX6iR9jiITIf1FFg4
ELEVENLABS_API_KEY=sk_3c06e8e8cb24baca026eb27f51e512679d14c9f6ddde0722
HEYGEN_API_KEY=sk_V2_hgu_kAzy0fqZYEq_nKBw75uuPPqycWH2k27EHdgFRImCPamq
```

HeyGen API key also available from: `/Users/ularkimsanov/Desktop/experiment-framework/ai-twitch-streamer/.env`

### Published CLI

`npx hyperframes` = version 0.6.6 (published)

For local development: `npx tsx packages/cli/src/cli.ts <command>`

---

## 14. Key File Locations Quick Reference

| What                       | Where                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| Main skill entry           | `skills/website-to-hyperframes/SKILL.md`                              |
| All step files             | `skills/website-to-hyperframes/references/step-*.md`                  |
| Capabilities inventory     | `skills/website-to-hyperframes/references/capabilities.md`            |
| HTML-in-Canvas patterns    | `skills/website-to-hyperframes/references/html-in-canvas-patterns.md` |
| Visual vocabulary          | `skills/website-to-hyperframes/references/visual-vocabulary.md`       |
| Text effects catalog       | `skills/hyperframes/references/text-effects.md`                       |
| Text effects JSON specs    | `skills/hyperframes/assets/text-effects/effects/<id>.json`            |
| Visual styles (traditions) | `skills/hyperframes/visual-styles.md`                                 |
| Motion principles          | `skills/hyperframes/references/motion-principles.md`                  |
| Transitions reference      | `skills/hyperframes/references/transitions.md`                        |
| Beat direction             | `skills/hyperframes/references/beat-direction.md`                     |
| Typography                 | `skills/hyperframes/references/typography.md`                         |
| Local CLI source           | `packages/cli/src/cli.ts`                                             |
| Contact sheet code         | `packages/cli/src/capture/contactSheet.ts`                            |
| Shader transitions source  | `packages/shader-transitions/src/hyper-shader.ts`                     |
| Engine types               | `packages/engine/src/types.ts`                                        |
| Eval arena app             | https://www.heygenverse.com/a/c927789b-7d96-4acb-b011-8b337e4cd5e3    |
| Shader PR                  | https://github.com/heygen-com/hyperframes/pull/886                    |
| Old videos archive         | `/Users/ularkimsanov/Desktop/hyperframes-3-archive/videos/`           |
| V2 video renders           | `/Users/ularkimsanov/Desktop/hyperframes-3/videos/<project>/renders/` |
| Baseline renders           | `/Users/ularkimsanov/Desktop/hyperframes-3/videos/baselines/`         |
| AB tests baselines         | `/Users/ularkimsanov/Desktop/ab-tests/`                               |

---

## 15. Gotchas and Warnings

1. **Do not recreate deleted step files** (`step-1-capture.md`, `step-4-storyboard.md`, etc.). They caused dual-pipeline confusion.

2. **Always use a fresh directory** for new video runs. Never re-use a directory that has previous DESIGN.md, STORYBOARD.md, etc. The AI will find them and skip steps.

3. **The HyperFrames MCP is not the skill**. If an agent uses `mcp__claude_ai_Hyperframes_Dev_MCP__compose`, the result comes from a cloud system, not our pipeline. This contaminates evals.

4. **HyperShader: let it create the timeline**. Never pass `timeline: tl` to `HyperShader.init()`. Use the returned `tl`.

5. **flash-through-white is not a neutral transition**. At 0.15s it's a visible white flash. Use CSS crossfade (omit `shader`) when you need a soft cut.

6. **Local CLI for capture/snapshot**. The published `npx hyperframes` doesn't have our contact sheet fixes. Use `npx tsx packages/cli/src/cli.ts capture/snapshot`.

7. **SVG contact sheets**: sites that use only external SVGs (`<img src="logo.svg">`) had no contact sheet coverage before our fix. Now `createSvgContactSheet` scans both `assets/svgs/` and `assets/` root.

8. **The `worktrees` situation**: The `hyperframes-3-main` worktree was removed. There is no main branch checkout anywhere. If you need to test on main again: `git worktree add ../hyperframes-3-main main`. Remember to remove it when done.

9. **Skills are installed in `.agents/skills/` which is gitignored**. The `skills/` directory in the repo is the authoritative source. `.agents/skills/` is a symlink managed by `npx skills add`.

10. **Videos folder is intentionally empty**. All previous video projects were moved to `/Users/ularkimsanov/Desktop/hyperframes-3-archive/videos/`. The `videos/` folder in the repo now has only the fresh v2 runs from this session.

---

## 16. Session Participant Context

**Ular Kimsanov** (ular.kimsanov@heygen.com) — HeyGen, testing this as an external developer evaluating the pipeline quality.

**What Ular cares about most**:

- Videos that actually look like the brand being captured (not generic)
- Skill that doesn't produce the same template for every input
- Working pipeline (no broken renders, no missing beats)
- The eval process: systematic comparison of skill iterations

**Key insight from session**: The question of whether more process = better output is genuinely open. The Loom comparison showed old simple skill won on brand accuracy. The answer may be: fix the code bugs, reduce the prescriptive documentation, let the agent make brand-driven decisions rather than following a 6-step derivation process.

---

_Document generated: May 16, 2026_
_Branch: feat/pipeline-quality-v2_
_Last commit: 309a641c_
