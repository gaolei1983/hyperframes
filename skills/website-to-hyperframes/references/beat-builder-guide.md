# Beat Builder Guide

**INPUT:** Dispatch context — top-level: `BEAT_NUMBER` / `PROJECT_DIR` / `BEAT_FILE` (target path the main agent assigned, usually `compositions/beat-N-<slug>.html`) / `Dispatch packet: /tmp/w2h-dispatch/b<N>.txt` (shared header + this beat's spec); per beat: `concept` / `mood` / `vo_cue` / `start_s` / `duration_s` / `techniques[]` / `assets[]` / `text_effects[]` / `brand_values_paste` / `prev_beat_handoff` / `next_beat_handoff` / `sfx[]` / `motion_floor`.
**OUTPUT:** `$PROJECT_DIR/$BEAT_FILE` (one file — the beat composition).
**TOOLS:** Skill `hyperframes` (load it; every rule matters) + `capabilities.md` (TOC scan, on-demand deep-dive) + `techniques.md`/`text-effects.md`/`transitions.md` (read only what `techniques[]` lists) · Read · Write · Edit · Bash (lint + grep self-check).
**DONE:** File written + `npx tsx packages/cli/src/cli.ts lint .` zero errors + all self-check grep assertions pass → concrete one-paragraph report (hex codes used, asset paths placed, headline `font-size`, last `tl.fromTo` timestamp). No "0 errors, looks good." reports — those are the chat reports that shipped prior videos with mismatched brand colors and missing logos.

You are building ONE beat of a multi-beat video composition, running in parallel fan-out with sibling beat workers. You CAN read STORYBOARD.md + DESIGN.md + sibling beat files when continuity demands it (motif callbacks, color carry-through, recurring elements) — w2h is a continuity-heavy genre. But default to the dispatch packet first; only widen reads when the packet doesn't carry the cross-beat context you need.

After writing, run the self-check grep block at the END of this guide. If any FAIL hits, fix before reporting. Step 6 validate uses the same harness; catching locally saves a round-trip.

## Pre-Write Cheat Sheet (scan before typing; saves 15-20% rework)

Four hidden pitfalls account for most rework in a single beat run — scan them before starting:

1. **Frame-0 black trap.** Any opacity tween starting at t=0 (`tl.fromTo(el, {opacity:0}, {opacity:1}, 0)`) renders black under seek. Put the visible state in INLINE `style="opacity:1"` and animate transforms only (scale/translate/rotate).
2. **Asset paths are root-relative** — `capture/assets/foo.svg` ✅ / `../capture/assets/foo.svg` ❌. The Studio preview rewrites base URLs; `../` paths 404 at render.
3. **GSAP `from()` + CSS `opacity:0` on the same element animates 0→0 forever.** Use `tl.fromTo()` with an explicit start state OR remove the CSS opacity:0.
4. **SVG filenames are content-hashed, not human-readable. Find the logo in asset-descriptions.md.** Captures emit `logo-<hash>.svg` for DOM-marked logos (inside `<header>`/`<nav>`/home-anchor/title-matching aria-label) and `svg-<hash>.svg` for everything else. The brand name is NOT in the filename. To find the real logo for your beat: grep `capture/extracted/asset-descriptions.md` for the brand name OR `ls capture/assets/ | grep logo-` to surface DOM-marked candidates. Composing a fake logo when a captured one exists ships off-brand. **Always open + verify brand-critical assets** (header logo, primary hero) before referencing — the cost of the wrong mark on the closer is high. Legacy captures (no hash suffix, UUID names, `sx-…`/`flex-N` class-name leaks) keep the old "verify everything" rule.
5. **`data-duration` on YOUR root `<div>` inside the `<template>` must equal the dispatch `estimatedDuration_s` to within 0.01s.** The assembler at the end of Step 5 cross-checks this and **exits 1 on mismatch** — your beat will never make it to the index.html. No more `data-duration` on host divs in `index.html` (that's the legacy cell-A pattern; the assembler owns the host div now). Also: do NOT include `<script src=".../gsap…">` or `<script src="hyper-shader-local.js">` in your `<template>` — the assembler emits both at root.
6. **GSAP transform aliases only — `x` / `y` / `scale` / `scaleX` / `scaleY` / `rotation` / `opacity`. Never tween `width` / `height` / `top` / `left`.** The renderer's seek path can't sub-pixel-position those, and they double-overwrite any CSS-baked transform. To center-shift, compute `x: dx, y: dy` from bbox delta and pair with `transform-origin: 50% 50%`.
7. **CSS `transform:` on an element + GSAP transform on the same element = mutual overwrite.** Pasted UI components often have `transform: rotate(var(--tilt))` baked in. The moment GSAP touches that element with `scale` / `rotation` / etc., GSAP overwrites the entire `style.transform` and the CSS tilt vanishes — the beat ships looking "straightened." Fix: if an element will be in a GSAP timeline, express its rotation/scale/translate in GSAP (`gsap.set(el, { rotation: -2, scale: 1 })`). CSS transform is fine on decorative leaves that never get animated.

## Step 1: Read and understand

**Required (every beat):**

1. **Load the `hyperframes` skill** — composition rules, data attributes, timeline contract, deterministic rendering. Read the whole skill.
2. **[capabilities.md](capabilities.md)** — full inventory of HyperFrames capabilities (24 sections). Read the Table of Contents first, then deep-dive sections your beat needs.
3. **The beat spec** the main agent gave you — concept, choreography, assets, brand values, timing.

**Read based on what your beat needs (pick relevant ones):**

| Resource                                                                              | What it covers                                                                                                                | Read when                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [techniques.md](../../hyperframes/references/techniques.md)                           | 20 visual techniques with code: SVG path drawing, Canvas 2D, CSS 3D, kinetic type, variable fonts, MotionPath, counters       | Beat uses any of these techniques                 |
| [text-effects.md](../../hyperframes/references/text-effects.md)                       | 24 named text animations: soft-blur-in, typewriter, kinetic-center-build, line-reveal, stagger, crossfade, shared-axis        | Beat has text animation                           |
| [html-in-canvas-patterns.md](../../hyperframes/references/html-in-canvas-patterns.md) | HTML-in-Canvas: iPhone/MacBook mockups, liquid glass, magnetic, portal, shatter, text cursor                                  | Beat uses device mockups or WebGL effects on HTML |
| [transitions.md](../../hyperframes/references/transitions.md)                         | Shader transition API, HyperShader.init() pattern, all 14 WebGL shaders                                                       | Beat has shader transitions                       |
| [transitions/](../../hyperframes/references/transitions/)                             | 14 CSS transition category files: push, scale, dissolve, blur, 3D flip, light leak, distortion, grid, mechanical, destruction | Beat uses CSS transitions                         |
| [css-patterns.md](../../hyperframes/references/css-patterns.md)                       | Text markers: highlight sweeps, hand-drawn circles, burst lines, scribble, sketchout                                          | Beat uses text emphasis/markers                   |
| [audio-reactive.md](../../hyperframes/references/audio-reactive.md)                   | Bass→scale, mid→shape, treble→glow mappings                                                                                   | Beat reacts to music/audio                        |
| [typography.md](../../hyperframes/references/typography.md)                           | Font hierarchy, variable fonts, responsive type scaling                                                                       | Beat has complex typography                       |
| [motion-principles.md](../../hyperframes/references/motion-principles.md)             | Velocity matching, easing philosophy, motion continuity                                                                       | Beat needs polished motion design                 |
| [dynamic-techniques.md](../../hyperframes/references/dynamic-techniques.md)           | Counter animations, data-driven visuals, dynamic content                                                                      | Beat has counters or data visualization           |
| [video-composition.md](../../hyperframes/references/video-composition.md)             | Frame composition, color presence, scale, density rules                                                                       | General composition quality                       |

**Other skills you can load if needed:**

- `/gsap` or `/gsap-core`, `/gsap-timeline`, `/gsap-plugins` — deeper GSAP reference
- `/animate-text` — curated text animation catalog with exact JSON specs
- `/hyperframes-registry` — if you need to install and wire registry blocks
- `/hyperframes-contrast` — audit color contrast (WCAG)
- `/lottie`, `/three`, `/waapi`, `/animejs`, `/css-animations` — if beat uses these engines

**Always open the captured assets folder before designing the beat:**

- `capture/assets/svgs/` — brand logos, icons, decorative marks. SVGs are infinitely scalable and stroke-animatable (path drawing, dash offset). A logo SVG drawing itself onto frame can carry an entire beat.
- `capture/assets/` — hero illustrations, screenshots, product art, gradients, photography, AND the SVGs that came from inline DOM extraction (header logo, wordmarks). These are first-class beat subjects, not background decoration. A breathing hero illustration with a single line of kinetic type is a complete shot.
- `capture/assets/videos/previews/` — every `<video>` on the source site got a preview PNG and a manifest entry. See the "Captured videos" rule below for how to fetch the actual mp4 when you need it.
- VIEW every image before placing text on it. Check safe zones, contrast, actual content, where the focal point sits.

**If your beat spec names a captured asset, USE it.** Don't substitute a CSS recreation. The user captured these from the real brand site precisely so the video carries the brand's actual visual identity.

### Logo discovery — search `asset-descriptions.md` BEFORE composing one

**This is a hard rule.** SVG filenames are content-hash slugs (`svg-54ea56cd.svg`, `svg-ec034b11.svg`) — the brand name is NOT in the filename. The real logo IS in the capture, just hash-named. So:

1. **First** open `capture/extracted/asset-descriptions.md` and `Grep`/`search` for the brand name (e.g. `HeyGen`, `huly`, `Stripe`). The descriptions identify wordmarks and logos by what they actually show — e.g. `svg-54ea56cd.svg — wordmark reading "HeyGen" next to a four-lobed diamond-shaped icon`. That's how you find which `svg-<hash>.svg` is the real logo.
2. **Second** open the matching SVG to verify and to see its colors / glyph paths.
3. **Then** reference it from the beat as `<img src="capture/assets/svg-XXXXXXXX.svg" ... />`.

**Composing a logo (CSS shapes, fake wordmark) when a captured one exists is a brand-fidelity violation** — it ships in the final video and reads as off-brand. It IS valid to RECOLOR or extract specific paths from a captured monochrome SVG to match the site's accent palette (the agent that ran heygen.com correctly extracted the diamond facets and recolored them with the aurora gradient). The line is: **start from the captured geometry**, never from scratch.

If `asset-descriptions.md` has no Gemini Vision descriptions (the heading says "no Gemini key set" or descriptions are just filename slugs), fall back to opening each candidate SVG in a previewer or via `sharp` to render it. Cost: a few extra reads. Worth it for brand fidelity.

### Captured videos — they're in the manifest, not on disk

The capture pipeline writes `capture/extracted/video-manifest.json` listing every `<video>` element on the source page (URL, dimensions, heading, caption, preview PNG). It does **not** download the actual mp4s — that would balloon the capture size on sites with many videos (some marketing pages have 15+ feature videos).

When a beat genuinely needs the hero video (e.g. heygen.com's "Orb" — a 3D-rendered animation that's hard to approximate in CSS), fetch just that one with the CLI:

```bash
# List what's in the manifest:
npx tsx packages/cli/src/cli.ts capture-video . --list

# Download by index (the hero is usually index 0):
npx tsx packages/cli/src/cli.ts capture-video . --index 0

# Or by exact URL (when you've already inspected video-manifest.json):
npx tsx packages/cli/src/cli.ts capture-video . --url https://cdn.example.com/hero.mp4
```

The file lands at `capture/assets/videos/<filename-from-manifest>` (matching the rest of the captured-assets layout). The command prints a ready-to-paste `<video>` snippet on success. Embed it in your beat composition with `data-start` / `data-duration` like any other clip — see the `/hyperframes` skill's video-composition reference for the contract.

**Don't bulk-download every video in the manifest** — most aren't relevant to your beat. Pick the ONE the beat actually needs, by looking at the manifest's `heading` and `caption` fields + the preview PNG at `capture/assets/videos/previews/video-N-preview.png`.

## Step 2: Build the composition

Save to the path the main agent specified (usually `compositions/beat-N-<slug>.html`). Copy-paste this starter and fill in the named placeholders. Every attribute, ID, and timeline key shown is load-bearing — the assembler (final action of Step 5) hard-fails if `data-duration` drifts from your dispatch packet's `estimatedDuration_s` by more than 0.01s.

There's also a file copy of this same starter at `skills/website-to-hyperframes/templates/_beat-skeleton.html` — `cp` it instead of paste-from-docs when starting a new beat to skip the copy/paste step and keep the landmine-defusing inline comments alongside your edits.

```html
<template id="beat-N-<slug>-template">
  <style>
    /* Scope every selector with a beat-prefix class (e.g. .bN-title) so styles
       can't leak into sibling beat compositions. */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* DO NOT set `background:` on .bN-root — sub-comp root background CSS does
       NOT paint at render time. Use a full-bleed child div (`.bN-bg`) instead.
       See landmine "Sub-comp root background doesn't paint" below. */
    .bN-root { width: 1920px; height: 1080px; position: relative; overflow: hidden; }
    .bN-bg   { position: absolute; inset: 0; background: #YOUR_BG; z-index: 0; }
    .bN-title { font-size: 96px; line-height: 1.05; font-weight: 700; color: #YOUR_FG; position: relative; z-index: 1; }
    /* …your beat-scoped styles… */
  </style>

  <!-- Root sub-comp div. data-duration MUST equal estimatedDuration_s from your dispatch packet within 0.01s. -->
  <div
    id="beat-N-<slug>"
    class="bN-root"
    data-composition-id="beat-N-<slug>"
    data-width="1920"
    data-height="1080"
    data-duration="5.5"
  >
    <!-- Full-bleed background div (NOT the root). Paints at render time
         where root `background:` does not. -->
    <div class="bN-bg"></div>
    <!-- Subject visible in DOM via inline style="opacity:1" — overrides any CSS opacity:0,
         lets your timeline animate transforms only (avoids the frame-0 black trap). -->
    <h1 class="bN-title" style="opacity:1" data-layout-role="primary">YOUR HEADLINE</h1>
    <!-- …your elements… -->
  </div>

  <script>
    (function () {
      var BEAT = 5.5; // MUST equal data-duration above, to the centisecond.
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      // Entrance — transform-only (no opacity tween at t=0).
      tl.fromTo(".bN-title", { scale: 0.92, y: 40 }, { scale: 1, y: 0, duration: 0.6, ease: "power4.out" }, 0);

      // Hold motion — camera dolly across the full beat (continuous motion rule).
      tl.fromTo(".bN-root", { scale: 1.0 }, { scale: 1.06, duration: BEAT, ease: "none" }, 0);

      // Register synchronously — the key MUST match data-composition-id above.
      window.__timelines["beat-N-<slug>"] = tl;
    })();
  </script>
</template>
<!-- DO NOT include <script src="…gsap…"> or <script src="hyper-shader-local.js"> inside this template.
     The assembler emits both at root; duplicating them double-loads GSAP and double-inits HyperShader. -->
```

**Three-way match check** — these three strings MUST all be identical:
1. Root `<div data-composition-id="…">` (this file)
2. Timeline registration `window.__timelines["…"]` (this file)
3. Dispatch packet's beat id / `BEAT_FILE` slug (main agent assigned)

If any drift between them, the renderer can't bind the timeline to the host and the beat ships black.

## Step 3: Lint

```bash
npx tsx packages/cli/src/cli.ts lint .
```

Fix ALL errors. Zero errors required.

## Step 4: Snapshot and verify

```bash
npx tsx packages/cli/src/cli.ts snapshot . --frames 3
```

This snapshots the FULL timeline. When you want frames from only YOUR beat's window (faster iteration, no scanning past sibling beats), once `index.html` exists run:

```bash
node skills/website-to-hyperframes/scripts/preview-beat.mjs --hyperframes . --beat compositions/beat-N-<slug>.html --frames 5
```

The script walks `compositions/` in the same sort order the assembler uses, computes your beat's cumulative start_s, and invokes `snapshot --at <t1>,<t2>,...` with frames evenly spaced inside `[start_s, start_s+duration_s)`. Same `snapshots/contact-sheet.jpg`, beat-local frames only. Re-run `scripts/assemble-index.mjs` first if you've changed durations since the last assemble.

**VIEW the contact sheet cell-by-cell** (`snapshots/contact-sheet.jpg`). Not a glance — look at EVERY frame your snapshot produced, in order. For each frame, write one short sentence naming what you see (subject, position, motion state, visible text). If you find yourself summarizing the contact sheet as a whole, stop and go back to frame-by-frame.

For each frame, the questions:

- Is content visible? (not black, blank, or loading)
- Is text readable, properly positioned, correct font/color?
- Are assets at the right size and position?
- Does the animation state match the beat spec at this timestamp?

**If anything is wrong:** fix, re-snapshot, re-check. You are done ONLY when every frame matches the spec.

## Step 5: Report back honestly

After lint passes, snapshots are taken, and you've fixed every issue you saw — report back to the main agent with concrete observations. Not "0 errors, looks good." That phrasing is what got prior videos shipped with mismatched brand colors, missing logos, and headlines too small to read.

**The main agent will OPEN your composition file and read it top-to-bottom** to cross-check against DESIGN.md and STORYBOARD.md — does the brand bg/accent hex actually appear in your CSS, are the captured assets the storyboard called for actually referenced, is the headline ≥80px, does the GSAP timeline cover the full beat duration. You cannot pass that check by claiming things you didn't do; the file is on disk, the truth is in the file.

So in your report, name the hex codes you used, the captured asset paths you placed, the headline `font-size`, and the GSAP timeline's last `tl.fromTo(...)` timestamp. Brief, concrete, true. If anything diverges from DESIGN.md or the storyboard, say so explicitly — the main agent can decide whether to accept the divergence or send you back to fix it. Surprises caught at this hand-off cost minutes; surprises caught at Step 6 cost iterations.

---

## Known landmines for sub-agents — read first

Sub-agent fan-outs hit a stable set of bugs that lint-clean compositions cannot catch. Read these before you touch the file. Each rule names a single failure mode and the one-line fix.

### 1. Write only to your assigned filename

Sub-agents share a project directory. A concurrency race in cell-A wiped `beat-4-pillars.html` mid-build and left an orphan `_beat5-standalone.html`. Each sub-agent writes to a unique, pre-allocated filename — `compositions/beat-N-<slug>.html` exactly as the orchestrator named it in your dispatch prompt. Never write to, rename, or delete a sibling sub-agent's file. The orchestrator owns the merge.

### 2. `s-end` and any "dummy" host div needs a real composition file

A bare `<div data-composition-id="s-end">` in root `index.html` with no `data-composition-src` and no template throws `FrameCapture: Sub-composition timelines not registered after 45000ms: s-end`. The renderer stalls 45 seconds per attempt waiting for a timeline that never registers.

Give every host div a real `compositions/<id>.html` with at minimum a template + `window.__timelines['<id>'] = gsap.timeline({ paused: true })` registration. If `s-end` is a 1-second black tail card, it still needs that file.

### 3. `<style>` inside the root div DOES render — don't second-guess this

Verified in cell-A raycast beat-6 (with a `system-ui` fallback). Sub-agents sometimes refuse to scope styles to the root, fearing they'll be stripped. They won't be. Inline `<style>` blocks inside the root composition div render correctly.

### 4. Re-read DESIGN.md and STORYBOARD.md before you start

You think you remember them from the orchestrator's prompt. You don't — not the exact hex values, not the specific brand font name, not the headline copy verbatim, not the beat duration. Re-read them now so your output matches.

### 5. Only one `data-layout-role="primary"` at any moment in the beat

Camera pan, zoom, or push does NOT count as a handoff between primary subjects. If your beat has two distinct primary moments (e.g. a headline and a CTA both with hero treatment), they cannot overlap in time — exit the previous primary first (`tl.to(prev, { opacity: 0, scale: 0.95 }, t)`), then enter the new one (`tl.fromTo(next, ...)` at `t + handoff_duration`). Supporting content (captions, decoration, depth layers) can stay continuous; only primaries need exclusive temporal slots. Without this, the perception gate fires `primary-collision` on overlapping bboxes >5%.

### 6. Don't include literal HTML opening tags inside HTML comments

The linter and check-compositions scan with regex; a `<template>` or `<style>` or `<script>` substring inside a comment is treated as a real tag and false-positives the gate. Escape as `&lt;template&gt;` or rewrite as prose — never paste a literal opening tag into a comment block.

```html
<!-- ❌ BAD: lint regex sees this as a stray <template> -->
<!-- example: <template id="foo"> wraps your beat -->

<!-- ✅ GOOD: escaped or paraphrased -->
<!-- example: &lt;template id="foo"&gt; wraps your beat -->
<!-- or: the template wrapper for your beat -->
```

### 7. No per-beat exit tweens for sub-comp beats

w2h does CSS crossfades between sub-comp beats at the orchestrator level (`assemble-index.mjs` wires them via `shader_transitions`). **Don't author per-beat exit animations** — hold the final frame steady, let the next beat's entrance carry the cut. Exit tweens inside a beat double-blend with the orchestrator's crossfade and produce the "scene dipping then re-entering" visual artifact. Exception: the closing beat (no `next_beat_handoff` in your dispatch packet) MAY fade out for the CTA-to-end transition.

### 8. Sub-comp root `background:` doesn't paint — use a full-bleed child div

The root `<div data-composition-id="...">` is the host element the assembler inserts into `index.html`. CSS like `.bN-root { background: #000; }` will NOT paint in the rendered video — the renderer composites against transparency at the host level. Studio preview paints the root background fine (which is what makes this insidious); only the MP4 render skips it.

```html
<!-- ❌ BAD: background on the root won't paint at render time -->
<div data-composition-id="beat-6-cta" style="background: #050507;">
  <h1>...</h1>
</div>

<!-- ✅ GOOD: full-bleed child paints the background -->
<div data-composition-id="beat-6-cta">
  <div style="position: absolute; inset: 0; background: #050507; z-index: 0;"></div>
  <h1 style="position: relative; z-index: 1;">...</h1>
</div>
```

Same rule for gradients, images, or any `background-*` property on the root. The Step 2 starter template above ([line](#step-2-build-the-composition)) already follows this pattern — `.bN-root` has no `background:`, and a separate `.bN-bg { position: absolute; inset: 0; background: ... }` div carries it. If you build from scratch instead of copying the template, mirror that structure. Mirrors step-5-build.md landmine #10 — same rule, different reader.

### 9. Alive, not active — no frozen readable text

Every readable element (label, wordmark, value, headline) on screen must have visible-at-video-scale motion carrying it from entrance to exit. The failure mode this rule names — observed in a recent huly opener — is: agent enters a label, then holds it for ~2s with an `opacity 0.85 → 1.0` "breath" thinking that keeps it alive. At 1920×1080 a 15% opacity oscillation is invisible; the label reads as completely frozen.

The fix is NOT "make it move more" (don't speed up entrances, don't add bouncing). The fix is to assign ONE continuous-motion pattern per readable element, calibrated to be _felt_ but not _watched_:

- **Drift** — translate ±4–8px on a 4–7s sine.inOut loop. Independent loops per element create natural parallax.
- **Camera dolly** — scale 1.0 → 1.04+ on the scene root over the beat duration. The whole frame breathes; individual elements can stay still relative to the frame.
- **Rotation wobble** — ±1.5–3° sine.inOut. Reads as physical presence.
- **Parallax** — foreground / midground / background layers drift at different speeds.

**One pattern per element. Don't stack.** Goal: the frame feels alive; the viewer can't point at "the motion" if asked.

This rule applies to elements that have ENTERED the scene. Stillness IS valid when it's the concept (the storyboard's Negative space hook: 1.2s of intentional empty followed by reveal — the stillness is doing the work). Stillness during a hold-to-let-the-viewer-read is NOT valid — that's the failure mode.

Check yourself: for every element that's on screen for more than 1 second, can you point at the GSAP tween carrying it (not its entrance — its on-screen lifetime)? If no, add one of the four patterns above.

---

## Layout annotations — opt-in markers for the perception gate

Step 6 runs `scripts/check-rendered-perception.mjs` (Puppeteer + GSAP `tl.seek(t, false)` at 3 probes/scene). It detects 8 perception failure classes that lint can't catch — text-clipping, depth-layer ghosts, primary-collision, cross-text-collision, primary-offscreen, content-cramped-container, low-contrast-foreground, font-too-small.

The gate reads optional authoring annotations to know what's a primary subject vs decoration, what's allowed to bleed off-canvas, and what to ignore. **Adding these to your beat is opt-in but recommended** — without them, primary-collision and primary-offscreen checks vacuously pass, and intentional bleed/zoom scenes false-fire text-clipping warnings.

### `data-layout-role="primary"` — mark the foreground

Put on each headline / title / CTA text span the beat is built around. Multiple primaries in the same act → primary-collision check fires if their bboxes overlap >5%. Without this attribute, Check 3a silently no-ops.

```html
<h1 class="b2-title" data-layout-role="primary">Stop context-switching.</h1>
<button class="b2-cta" data-layout-role="primary">Get started →</button>
```

### `data-layout-act="<name>"` — group primaries by temporal phase

When two primaries appear in the same time window (overlapping `tl.fromTo` durations), give them the same `data-layout-act` value so the collision check knows they share a frame. Per-beat default: omit unless your beat has temporally overlapping primaries (most don't — one phase per beat is the common case).

```html
<h1 data-layout-role="primary" data-layout-act="hero">SHIP FASTER</h1>
<p  data-layout-role="primary" data-layout-act="hero">Together with your team.</p>
```

### `data-layout-allow-overflow="true"` — let decoration bleed

On a scene-bleed wrapper that intentionally extends past 1920×1080 (camera zoom, slot-machine ticker, parallax sweep). Skips text-clipping (Check 1) and cramped-container (Check 6) for that subtree.

```html
<div class="b3-camera-zoom" data-layout-allow-overflow="true">
  <!-- camera dolly content; intentionally bleeds at zoom peak -->
</div>
```

### `data-layout-bleed="true"` — primary intentionally bleeds

On a primary text that you deliberately want clipped (e.g. an oversized hero word). Skips primary-offscreen (Check 4) for that element only.

```html
<h1 class="b1-belo" data-layout-role="primary" data-layout-bleed="true">BÉLO</h1>
```

### `aria-hidden="true"` — decoration the gate should skip

Standard ARIA, but the perception gate uses it as a hint to skip contrast/offscreen/cramped checks. Apply to decorative SVGs, mesh gradients, depth-shadow layers, glow orbs — anything that's purely visual texture.

```html
<svg class="b2-bg-mesh" aria-hidden="true">…</svg>
```

The gate also recognizes a decorative-class regex (`bg|background|drifter|glow|halo|chip|accent|tile|ghost|gradient|...`) — if your decorative element's class name matches that vocabulary, `aria-hidden` is redundant but harmless. When in doubt, add `aria-hidden`.

---

## Continuous motion — the most important rule

A beat is a SHOT in a film, not a webpage with entrance animations. Your GSAP timeline should have events spread across the ENTIRE beat duration — not just entrance tweens in the first 1-2 seconds followed by nothing. If an element is on screen, it should be doing something. After elements enter, add continuous hold motion: camera dolly, parallax layers moving at different speeds, secondary elements appearing mid-beat, real depth shifts.

## You are building a SHOT, not a webpage

The storyboard tells you the shot framing (close-up / medium / wide / etc.) and the camera move. Implement them. A beat is a moment, not a screenshot. The distinction is **what the camera is doing**, not whether the subject is a UI element or a logo — a tight push-in on a real product screenshot is a shot; a centered card on a parked camera is a webpage.

**Patterns that turn a shot back into a webpage:**

These are defaults to avoid, **not absolute prohibitions.** If the storyboard genuinely calls for "the kanban app interface" or "the browser chrome" as the subject of a specific beat (a product tour, a "this is how it works" demo, a stylized window mockup for the closer), then build it. The rule is: don't reach for these patterns by default when the storyboard didn't ask for them.

- ⚠ **macOS / browser window chrome reproduced in CSS** — traffic-light dots, URL bars, browser tabs. Fine when the storyboard makes the chrome the subject (e.g. "stylized macOS window framing the product UI" for a closer). NOT fine when it's a frame you added around a card "to make it look like an app."
- ⚠ **Full webpage layout** (sidebar + header + footer + main content area) — fine when the beat is genuinely a product tour shot. NOT fine when the beat was supposed to be about _the kanban moment_ and you defaulted to drawing the whole app around it.
- ❌ **Parked-camera composition** — centered card with 60–120px margins on all sides and no camera move. Almost always wrong. Either give it a real push-in / dolly / parallax, or reframe.
- ❌ **"Hold with breathing"** implemented as `y: ±1–2px`, `scale: 1.01`, or `opacity: 0.85 → 1.0` loops — invisible at 1920×1080+ scale. The opacity-breath variant is the most common: an agent enters a label, then schedules `tl.to(label, { opacity: 1 }, "+=2")` and assumes that "keeps it alive." It doesn't — at video scale a 15% opacity oscillation reads as static. If you want a readable element to feel alive across its on-screen lifetime, use one (not all) of: camera dolly (scale 1.0 → 1.04+ on the scene root), drift (translate ±4–8px on a 4–7s sine.inOut loop), rotation wobble (±1.5–3°), or parallax with another layer. See the **Alive, not active** rule in the storyboard ([step-3-storyboard.md](step-3-storyboard.md)) — that's where the orchestrator names which one carries each element.
- ❌ **Hover-state simulations** — videos have no hover. If the brand uses hover effects, show the BEFORE and AFTER as discrete frames in the timeline.
- ❌ **Counter pulses + dot pulses + tiny scale wobbles** as the only motion during the hold — these are "I ran out of ideas" filler.

The test: if the storyboard says _"this beat is the product tour, viewer sees the app interface"_, building a CSS dashboard with chrome is correct. If the storyboard says _"this beat is the kanban moment, single card sliding home"_, drawing the full app around it is wrong. Read the beat spec carefully.

**Patterns that ARE shots (do these freely):**

- ✅ **Captured SVG logo drawing itself stroke-by-stroke** (DrawSVG / path dashoffset) — a complete opener or stinger.
- ✅ **Captured hero illustration with camera dolly** — push-in from 1.0 → 1.08 over 4s, focal element holds frame.
- ✅ **Captured product screenshot with parallax layers** — separate the foreground UI from background panels and move them at different speeds, or use HTML-in-Canvas for an iPhone/MacBook mockup.
- ✅ **Captured asset as the bed, kinetic type as the punchline** — the brand's hero image holds the frame while a one-line message arrives, splits, reflows.
- ✅ **Composed-from-divs UI moment** when the beat is specifically about that UI's interaction (a card sliding into a column, a search result resolving) — this is the legit case for CSS-only composition.

**Required motion magnitudes** (anything smaller is invisible at video scale):

| Motion type     | Minimum magnitude                           |
| --------------- | ------------------------------------------- |
| Translate (y/x) | 30px (entrance) / 8px (drift during hold)   |
| Scale           | 0.05 change (1.0 → 1.05 or larger)          |
| Opacity         | full 0 → 1 or vice versa for reveals        |
| Rotate          | 4° minimum to read (Dutch angles, ticks)    |
| Camera dolly    | scale 1.0 → 1.06 minimum over beat duration |

**Required cinematography per beat** (the storyboard should give you these; if it doesn't, escalate):

- A **shot type** (close-up / medium / wide / over-the-shoulder / Dutch)
- A **camera move** (dolly in/out, push, parallax pan, orbit, rack focus)
- A **depth strategy** (what's foreground / midground / background)
- A **purpose** (what specific feeling or noticing the shot delivers)

If any are missing from the beat spec, the beat is under-defined. Don't fill the gap with "centered layout + breathing" — re-read the spec, and if it's genuinely missing, ask the main agent.

**Macro-camera scale headroom** (push past `scale: 1.05` on a focused subject):

Don't pick zoom-peak scale values by feel. After `await document.fonts.ready`, measure the target element's real bbox and compute the maximum safe scale so the subject still fits the canvas at the peak:

```js
const r = el.getBoundingClientRect();
const maxScale = 0.88 * 1920 / r.width;     // 88% canvas width — leaves visual margin
// Pair with a measured x/y offset to keep the subject centered in the frame:
const dx = (1920 / 2) - (r.left + r.width / 2);
const dy = (1080 / 2) - (r.top + r.height / 2);
tl.fromTo(el, { scale: 1, x: 0, y: 0 }, { scale: maxScale, x: dx, y: dy, duration: 1.2, ease: "power3.inOut" });
```

Round-number scales (1.5, 2.0) consistently clip large text at zoom peak. Asymmetric layouts amplify the error 3× — measure, don't hand-derive. For zooms that intentionally bleed past the canvas (e.g. ticker, parallax sweep), wrap them in `data-layout-allow-overflow="true"` so the perception gate pardons the bleed.

## Rules

- SCRIPT PLACEMENT: scripts inside `<template>`, never after `</template>`. Scripts outside see no DOM.
- GSAP FROM TRAP: never `gsap.from(el, {opacity:0})` with CSS `opacity:0`. It animates 0→0. Use `tl.fromTo()`.
- STYLE: avoid CSS `opacity:0` on GSAP-animated elements. Use GSAP fromTo for initial states.
- TRANSFORM PROPS: only `x` / `y` / `scale` / `scaleX` / `scaleY` / `rotation` / `opacity` in tweens. Never tween `width` / `height` / `top` / `left` — slow on seek, breaks CSS-baked transforms. Center-shift via `x: dx, y: dy` from bbox delta + `transform-origin: 50% 50%`.
- CSS+GSAP TRANSFORM: don't mix `transform: rotate/scale/translate(…)` in CSS with GSAP tweens on the same element — GSAP overwrites the entire `style.transform`, the CSS-baked tilt vanishes. If the element is GSAP-animated, express its tilt/scale in `gsap.set()`.
- EXITS: don't author per-beat exit tweens (orchestrator owns sub-comp crossfades via `shader_transitions`). Hold final frame steady. Exception: the closing beat with no `next_beat_handoff` may fade out.
- ONE PRIMARY: only one `data-layout-role="primary"` element at any moment. Hand off explicitly (exit prev → enter next), camera pan/zoom does not count as handoff.
- COMMENTS: no literal `<template>` / `<style>` / `<script>` opening tags inside HTML comments — linter regex false-positives. Escape as `&lt;…&gt;` or paraphrase.
- ASSET PATHS: project-root-relative. `capture/assets/file.png` ✅ `../capture/assets/file.png` ❌ (canonical rule: [step-5-build.md](./step-5-build.md) "ASSET PATHS" — single source of truth.)
- SVG VIA IMG: `<img src="capture/assets/logo-<hash>.svg">` can't inherit CSS color. Inline SVG or `filter: brightness(0) invert(1)`.
- CSS CENTERING: no `transform: translate(-50%, -50%)` with GSAP transforms. Use flexbox or `xPercent/yPercent`.
- QUERYSELECTOR: `document.getElementById("id")` with null guards. No method calls without null check.
- CHARACTER SPANS: `display:inline-block` on spaces collapses them. Use `&nbsp;` or per-word spans.
- COUNTERS: no `onUpdate` callbacks. Discrete `tl.set(el, {textContent: "42"}, 2.5)` at timestamps.
- TIMELINE: `window.__timelines["beat-N-<slug>"] = tl` synchronously. Key = literal `data-composition-id`, NOT a variable — `check-compositions.mjs` regex doesn't follow indirection.
- DETERMINISTIC: no `Math.random()`, `Date.now()`, `requestAnimationFrame`, `repeat:-1`.
- Always `tl.fromTo()` not `tl.from()` for entrances.
- Never stack two transform tweens on same element at same time.
- FONTS: brand fonts with `capture/assets/fonts/` path need `@font-face` in `<style>`.

## Easing — pick per intent

Do NOT default to `power2.out` on everything.

| Intent          | GSAP Ease             | Use for                              |
| --------------- | --------------------- | ------------------------------------ |
| Snap (iOS feel) | `power4.out`          | Hero text, UI elements               |
| Whip overshoot  | `back.out(1.7)`       | Numbers, badges, impact              |
| Soft land       | `expo.out`            | Per-word reveals, gentle entrances   |
| Mechanical      | `power1.out`          | Terminal text, code typing           |
| Bounce settle   | `elastic.out(1, 0.5)` | Counters, CTA buttons                |
| Dramatic        | `expo.inOut`          | Full-screen statements, hero reveals |
| Drift           | `"none"`              | Parallax, Ken Burns, camera drift    |

Staggered items: `power4.out` with `stagger: 0.08` to `0.15`.

---

## DONE-criterion: self-check grep block

After writing your beat file and before reporting back, RUN this Bash block exactly. **If any line prints `FAIL:`, fix it and re-run.** Only report DONE when the block prints zero `FAIL:` lines. Step 6 validate re-runs the same checks against every beat — catching them here saves a re-dispatch round-trip.

Replace `<BEAT_FILE>` with the path the main agent assigned (e.g. `compositions/beat-3-feature-tour.html`) and `<COMP_ID>` with the beat's `data-composition-id`:

```bash
F="$PROJECT_DIR/<BEAT_FILE>"
CID="<COMP_ID>"

# 0. File exists and is non-empty
[ -s "$F" ] || echo "FAIL: empty/missing $F"

# 1. Root contract — composition-id present (template wrapper for sub-comps, root attrs match)
grep -q "data-composition-id=\"$CID\"" "$F" || echo "FAIL: missing data-composition-id=\"$CID\""
grep -q "data-width=\"1920\"" "$F"            || echo "FAIL: missing data-width=\"1920\""
grep -q "data-height=\"1080\"" "$F"           || echo "FAIL: missing data-height=\"1080\""
grep -q 'data-duration="'  "$F"               || echo "FAIL: missing data-duration"

# 2. Timeline registration — window.__timelines["<comp-id>"] must be set synchronously
grep -qE "window\.__timelines\[[\"']${CID}[\"']\]\s*=" "$F" \
  || echo "FAIL: window.__timelines[\"$CID\"] not registered — host id / inner data-composition-id / timeline key must be a three-way match"

# 3. Frame-0 black trap — no opacity tween starting at t=0
grep -nE 'tl\.(from|fromTo|set)\([^)]*opacity\s*:\s*0[^)]*,\s*0\s*[,)]' "$F" \
  && echo "FAIL: opacity tween at t=0 → frame 0 renders black under seek. Use inline style=\"opacity:1\" + transform-only entrance."

# 4. Asset paths root-relative — no ../capture/
grep -nE '(src|href|url\()\s*=?\s*["\']?\.\./capture/' "$F" \
  && echo "FAIL: relative ../capture path → Studio preview rewrites base URL; will 404 at render. Use capture/assets/..."

# 5. Determinism contract — forbidden tokens
grep -nE 'Math\.random|Date\.now|requestAnimationFrame|repeat:\s*-1|Math\.ceil\([^)]*\)\s*-\s*1' "$F" \
  && echo "FAIL: deterministic-contract violation above. Math.random/Date.now/rAF/repeat:-1/Math.ceil(...)-1 all forbidden. Use literal integer repeat = floor(T/cycle)-1 computed at design time."

# 6. GSAP from() + CSS opacity:0 — 0→0 trap (only when both present)
if grep -qE 'tl\.from\([^)]*opacity\s*:\s*0' "$F" && grep -qE '\.[a-zA-Z][a-zA-Z0-9_-]*\s*\{[^}]*opacity\s*:\s*0' "$F"; then
  echo "FAIL: tl.from(opacity:0) + CSS opacity:0 → animates 0→0 forever. Use tl.fromTo() with explicit start state, or remove CSS opacity:0."
fi

# 7. Stale CDN tag — GSAP must be the pinned no-SRI URL (engine inlines it via URL-pattern match)
if grep -q '<script[^>]*gsap' "$F"; then
  grep -qE '<script src="https://cdn\.jsdelivr\.net/npm/gsap@3\.14\.2/dist/gsap\.min\.js"></script>' "$F" \
    || echo "FAIL: GSAP <script> tag must be exactly the pinned URL with NO SRI. integrity= or version drift breaks the compiler inline step."
fi

# 8. Headline floor — flag text-only beats with hero text < 80px (skip if beat is an image-hero per storyboard)
HEADLINE_PX=$(grep -oE 'font-size:\s*[0-9]+px' "$F" | grep -oE '[0-9]+' | sort -nr | head -1)
if [ -n "$HEADLINE_PX" ] && [ "$HEADLINE_PX" -lt 80 ]; then
  echo "WARN: largest font-size is ${HEADLINE_PX}px — hero text floor is 80px. Skip this warning if beat hero is an image, not text."
fi

# 9. Tween-property whitelist — width/height/top/left in a GSAP tween are slow + break CSS-baked transforms
grep -nE 'tl\.(to|from|fromTo|set)\([^)]*\{[^}]*(width|height|top|left)\s*:' "$F" \
  && echo "FAIL: tween targets width/height/top/left above. Use only x/y/scale/scaleX/scaleY/rotation/opacity. Center-shift via x/y from bbox delta + transform-origin: 50% 50%."

# 10. Literal HTML opening tags in comments — lint regex false-positives
grep -nE '<!--[^>]*<(template|style|script)[ />]' "$F" \
  && echo "FAIL: comment contains literal <template>/<style>/<script> — escape as &lt;...&gt; or rewrite as plain text."

# 11. Timeline registration uses literal data-composition-id, not a variable
grep -qE "window\.__timelines\[\s*[\"']${CID}[\"']\s*\]" "$F" \
  || echo "FAIL: timeline key must be the literal string \"$CID\" — check-compositions.mjs regex doesn't follow variable indirection like __timelines[KEY]."

# Structural evidence (must be ≥ 1 each)
grep -c "data-composition-id=\"$CID\"" "$F"    # host contract
grep -c "window.__timelines"            "$F"   # at least one timeline registration
```

Counter-line outputs (numbers) at the end are evidence the file has the right shape; FAIL/WARN lines are what to fix. If the block prints anything but counters, fix and re-run.

The main agent will re-run this same block against your file at the Step 5 reconciliation gate. Don't ship without running it locally.

After all beats land, the main agent runs `scripts/preflight-finalize.mjs` — a Bash orchestrator that re-runs lint + validate + inspect globally plus a real-frame perception probe (Puppeteer + GSAP seek at 3 probes/scene). It writes `finalize_brief.json` with per-violation `edit_old`/`edit_new` strings. If your beat fails the perception check (text-clipping, primary-collision, primary-offscreen, content-cramped-container, contrast < 2.5:1, font < 24px), expect a re-dispatch with the violation's old/new pair attached — apply it as-is, do not re-derive the geometry.
