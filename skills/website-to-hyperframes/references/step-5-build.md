# Step 5: Build Compositions

**Captions rule — read before building anything:** Never create `compositions/captions.html` with an empty transcript (`const script = []`). If the VO/transcript step was skipped or failed, do not create a captions composition at all. An empty captions file silently does nothing and wastes a track slot. Only create it when `transcript.json` has real word timestamps.

**Captions stacking bug:** Every caption word group must start with `opacity: 0` (or `visibility: hidden`) and be positioned `position: absolute`. Never show more than one group at a time — GSAP controls visibility sequentially. If multiple groups are visible simultaneously it means either (a) the initial CSS state isn't hidden, or (b) a group's exit tween is missing before the next group's entrance fires. After building captions.html, take a snapshot at 3–4 timestamps mid-narration and verify only one word group is visible per frame.

**Before building, verify you have:**

- **STORYBOARD.md** — the beat-by-beat plan. Re-read it now if you don't remember every beat's concept, assets, and techniques.
- **DESIGN.md** — if you need to check a specific value (color, font, component style) you can't recall, look it up. Don't re-read the whole file.
- **`capture/extracted/asset-descriptions.md`** — when the storyboard assigns an asset to a beat, check the description to understand what it shows. Re-read this file if you can't recall the asset inventory.
- **transcript.json** — word-level timestamps that drive scene durations.

Load the `hyperframes` skill — it has the rules for data attributes, timeline contracts, deterministic rendering, and layout. Read it now if you haven't already this session.

**For capabilities.md and techniques.md:** read the Table of Contents to orient yourself, then go deep only on the sections your storyboard actually calls for. You don't need to re-read sections for animation engines, registry blocks, or techniques that none of your beats use.

---

## 1. Copy SFX to project

```bash
cp -r skills/website-to-hyperframes/assets/sfx/ <project-dir>/sfx/
# If skill is installed elsewhere:
find . -path "*/website-to-hyperframes/assets/sfx" -exec cp -r {} <project-dir>/sfx/ \;
```

## 2. Build the root index.html

Create `index.html` yourself. This is the orchestrator — it holds beat slots, narration audio, SFX, and shader transitions (if any).

**Critical CSS — every beat must overlap in the same frame:**

```css
.scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
```

**Beat structure:**

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="TOTAL"
  data-width="1920"
  data-height="1080"
>
  <div
    id="beat-1"
    class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"
    data-duration="5.5"
    data-track-index="1"
    data-width="1920"
    data-height="1080"
  ></div>

  <!-- more beats... -->

  <audio
    id="narration"
    src="narration.wav"
    data-start="0"
    data-duration="NARRATION_LENGTH"
    data-track-index="0"
    data-volume="1"
  ></audio>

  <!-- SFX on content moments, NOT on shader transitions -->
  <audio
    id="sfx-impact"
    src="sfx/impact-bass-1.mp3"
    data-start="0.3"
    data-duration="2.1"
    data-track-index="41"
    data-volume="0.35"
  ></audio>
</div>
```

SFX were assigned in the storyboard (Step 3) — implement exactly what STORYBOARD.md specifies. Each SFX entry has a file, trigger time, and volume. Wire each one as an `<audio>` element with the exact `data-start`, `data-duration`, and `data-volume` from the storyboard. Do not add, remove, or substitute SFX beyond what the storyboard says.

**Choose architecture based on pacing (from Step 3)**

| Pacing                        | Architecture                                                                                                                                                                         | Why                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Fast** (billboard-per-beat) | Single `index.html`, stacked `<div class="beat">` elements, GSAP opacity sequencing. NO sub-compositions, NO HyperShader. Hard cuts via `tl.set()`. See stacked-beats pattern below. | Sub-compositions add latency; hard cuts need instant swaps. One file = zero load delay. |
| **Moderate / Slow / Arc**     | Sub-compositions with `HyperShader.init()`. Each beat in `compositions/beat-N.html`. CSS crossfades or shader transitions between scenes.                                            | Transitions need HyperShader's compositing. Sub-agents build each beat independently.   |

If the storyboard says "fast" pacing: use the stacked-beats pattern below. Do not use HyperShader — it adds scene registration overhead that creates gaps between hard cuts. Every frame is content, no transition frames.

**Stacked-beats pattern (fast pacing):**

```html
<div
  data-composition-id="video"
  data-width="1920"
  data-height="1080"
  data-start="0"
  data-duration="TOTAL"
  style="position:relative;width:1920px;height:1080px;"
>
  <div class="beat" id="b01" style="opacity:1;">
    <!-- first beat visible by default -->
    <div class="mega">Opening statement</div>
  </div>
  <div class="beat" id="b02">
    <img src="capture/assets/hero-image.jpg" style="width:100%;height:100%;object-fit:cover" />
  </div>
  <!-- more beats... -->
</div>
```

```css
.beat {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  overflow: hidden;
}
```

```javascript
var beats = [
  { id: "b01", at: 0, dur: 1.8 },
  { id: "b02", at: 1.8, dur: 1.0 },
  // ...
];
beats.forEach(function (b) {
  var el = document.getElementById(b.id);
  if (b.id !== "b01") tl.set(el, { opacity: 1 }, b.at);
  gsap.set(el, { scale: 1.012 });
  tl.to(el, { scale: 1, duration: 0.25, ease: "power2.out" }, b.at);
  if (b !== beats[beats.length - 1]) tl.set(el, { opacity: 0 }, b.at + b.dur);
});
```

Each beat gets its own visual world — different background, different color, different energy. No two consecutive beats should look alike. Scale pulse (1.012→1.0) on every beat entry is subtle but felt.

If the storyboard says "slow" or "cinematic": build each beat as a sub-composition. Use long crossfades (0.8–1.2s `duration` with no `shader` key = CSS crossfade). Inside each beat, use continuous subtle motion — nothing is static:

- Ken Burns drift on screenshots: `tl.fromTo(img, {scale:1.05, x:20}, {scale:1, x:-20, duration: BEAT, ease:"none"})`
- Parallax text layers: `tl.fromTo(text, {y:30}, {y:-30, duration: BEAT, ease:"power1.inOut"})`
- 1–2s breathing room before text enters (don't animate everything at t=0)
- Soft easing: `expo.out` for entrances, `power1.inOut` for drifts

**Multi-scene index.html with HyperShader — for moderate/slow/arc pacing**

For videos with sub-composition beats and scene transitions, `index.html` MUST use `HyperShader.init()`. This is the entire scene orchestration layer. Do NOT try to use registry block sub-compositions (e.g. `compositions/domain-warp-dissolve.html`) for transitions — those are standalone showcase demos, not how HyperShader works in multi-scene compositions.

Copy the local shader build first:

```bash
cp packages/shader-transitions/dist/index.global.js <project-dir>/hyper-shader-local.js
```

Full working `index.html` pattern — every field matters:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="hyper-shader-local.js"></script>

<div id="root" data-composition-id="main" data-start="0" data-duration="TOTAL"
     data-width="1920" data-height="1080">

  <!-- Host divs: MUST have both id AND data-composition-id matching the same value.
       HyperShader.init() uses getElementById() — without id="beat-1" it fails with
       "scene ids not found in DOM". -->
  <div id="beat-1" class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"        <!-- transition INTO this beat starts here -->
    data-duration="4.5"   <!-- must match the GSAP BEAT constant in the composition -->
    data-track-index="1"
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;"><!-- background here OR in sub-comp CSS — both work -->
  </div>

  <div id="beat-2" class="scene"
    data-composition-id="beat-2-features"
    data-composition-src="compositions/beat-2-features.html"
    data-start="4.0"
    data-duration="5.5"
    data-track-index="2"  <!-- use sequential track indices (1,2,3...) to avoid linter errors -->
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;">
  </div>

  <!-- ... more beats ... -->

  <!-- ALWAYS add a dummy s-end scene as the LAST entry.
       HyperShader renders scenes[N-1] as black in some contexts.
       s-end is invisible — it just prevents your CTA from being last. -->
  <div id="s-end" class="scene"
    data-composition-id="s-end"
    data-start="TOTAL_MINUS_0.1"
    data-duration="0.1"
    data-track-index="N"
    data-width="1920" data-height="1080">
  </div>

</div>

<script>
  window.__timelines = window.__timelines || {};
  var tl = HyperShader.init({
    bgColor: "#000000",
    accentColor: "#YOUR_ACCENT",
    scenes: ["beat-1", "beat-2", "beat-3", ..., "s-end"],
    transitions: [
      { time: 4.0, shader: "sdf-iris", duration: 0.7 },    // WebGL shader
      { time: 9.5, duration: 0.5 },                         // CSS crossfade (no shader)
      // ... one transition per scene boundary ...
      { time: TOTAL_MINUS_0.1, duration: 0.1 }              // dummy → s-end
    ],
  });
  // Add ALL beat animations to the returned tl AFTER init()
  window.__timelines["main"] = tl;
</script>
```

**Track index and the linter:** Use sequential track indices (`data-track-index="1"`, `"2"`, `"3"`...) for each beat — NOT all on track `"1"`. The linter flags overlapping clips on the same track as an error, and HyperShader compositions always have overlapping beats (the transition window). Using sequential indices silences the linter; HyperShader manages which scene is VISIBLE via opacity regardless of track index.

**Scene background colors:** setting `style="background: #3139FB"` on the host `<div id="beat-1">` in index.html is the simplest pattern — it's visible at a glance from the root file. Setting background inside the sub-composition's CSS also works. Either is fine; host div is preferred for clarity.

**Critical: beat host divs must have sequential `data-start` and matching `data-duration`.** Do NOT set `data-start="0"` on all beats — the render engine seeks each beat's GSAP timeline to `global_time - data_start`. At t=10s with `data-start=0`, a 5.5s timeline is seeked past its end and all content disappears.

`data-duration` must match the GSAP `BEAT` constant in the composition (the length of the sub-composition's internal timeline). If the two disagree, animations get cut off.

**Storyboard Beat Timing section** tells you both values — use them directly:

- `data-start` = "Transition in at:" value from the storyboard
- `data-duration` = "GSAP duration:" value from the storyboard

**Font handling:** Common fonts are auto-resolved by the renderer: use `"Inter"` (not `"Inter Variable"` — the compiler only maps the base name), `"Roboto"`, `"JetBrains Mono"`, `"Poppins"`. If a composition uses `"Inter Variable"` it will log compiler warnings and may fall back incorrectly — always use `"Inter"`. Only brand-specific fonts (GT Walsheim, Aeonik, etc.) need `@font-face`. Check `capture/assets/fonts/` — hashed filenames are Google Fonts subsets that auto-resolve; recognizable filenames (e.g. `BrandSans-Bold.woff2`) are brand fonts that need `@font-face` declarations.

**Brand font @font-face:** If the storyboard's BRAND VALUES lists a brand-specific font with a path in `capture/assets/fonts/`, add the `@font-face` block at the top of each composition that uses it — sub-agents won't do this unless you tell them explicitly. Paste the exact `@font-face` declaration in the sub-agent prompt's BRAND VALUES section. Without this, every composition falls back to `system-ui` and the brand typeface never loads.

**⚠ ASSET PATHS — most common sub-agent mistake (5+ agents per run):** All asset paths in compositions must be relative to the **PROJECT ROOT**, not to the composition file. `compositions/beat-N.html` lives one directory deep, but paths must be written as if from the root.

- ✅ `capture/assets/hero.png`
- ❌ `../capture/assets/hero.png`

The Studio preview server rewrites base URLs to the project root — `../` paths that seem to work locally will 404 in preview and in renders. Add this verbatim to every sub-agent prompt's RULES section.

## 3. Build each composition — USE SUB-AGENTS

**Before dispatching: copy the closest example scene into `compositions/` as the starting point for each beat.** The storyboard's technique-pick checklist (step-3) cited specific scene paths per beat. Do not write any beat from scratch — there is always a closer example in [`examples/`](../examples/). Copy `<example-scene>/index.html` to `compositions/beat-N-name.html`, then the sub-agent mutates it.

Quick mapping:
- "Show a kanban / project board" → start from `examples/04-composed-ui/scene-01-kanban-board/index.html`
- "Show chat / messaging" → start from `examples/04-composed-ui/scene-02-chat-with-typing/index.html`
- "Show terminal / CLI / command" → start from `examples/04-composed-ui/scene-03-terminal-typeon/index.html`
- "Show command palette / Cmd+K" → start from `examples/04-composed-ui/scene-04-command-palette/index.html`
- "Show stats / dashboard / numbers" → start from `examples/04-composed-ui/scene-05-dashboard-counters/index.html`
- "Show files / folder tree" → start from `examples/04-composed-ui/scene-06-file-tree-reveal/index.html`
- "Show code editor" → start from `examples/04-composed-ui/scene-07-code-editor-typing/index.html`
- "Show calendar / schedule" → start from `examples/04-composed-ui/scene-08-calendar-events/index.html`
- Hero text reveal → start from `examples/01-typography/scene-01-soft-blur-in/index.html` (or pick another text effect)
- Terminal-typed headline → start from `examples/01-typography/scene-02-typewriter-mechanical/index.html`

**The non-negotiable rule:** if a beat's primary visual is a UI element that exists in `examples/04-composed-ui/`, that beat is built by copying the matching scene. Not by screenshotting a captured asset.

**Before dispatching, also re-read DESIGN.md and STORYBOARD.md.** You wrote these files earlier in the session and you think you remember them. You don't — not the exact hex values, not the specific font families, not the button border-radius, not the Do's/Don'ts. Re-read them now so you can paste accurate brand rules and beat specs into each sub-agent prompt.

**If your runtime supports parallel sub-agents** (Claude Code, Cursor, most agent frameworks): dispatch one sub-agent per beat — 3 to 4× faster than building sequentially. For 3+ beats, always dispatch in parallel. For 1–2 beats, sequential is fine.

**If your runtime does not support parallel sub-agents** (some Codex setups, serial-only models): build sequentially using the same context-packing template below. The template gives each build pass the same context a sub-agent would get — paste prev/this/next beat + brand values — so output quality is the same, just slower.

In either case, use the template. Do not skip it and build from memory.

Each sub-agent reads [beat-builder-guide.md](beat-builder-guide.md) — it has everything: rules, easing, file references, validation commands, and the report-back protocol. **Do not try to paste all rules into the prompt yourself.** Instead, tell the sub-agent to read the guide file. You paste only the beat-specific context: the storyboard sections, brand values, and asset paths.

```
Build the composition for Beat N. Save to compositions/beat-N-name.html.

FIRST: Read skills/website-to-hyperframes/references/beat-builder-guide.md
It has your full workflow, all rules, easing vocabulary, file references,
and the report-back protocol. Follow its 5-step workflow exactly:
build → lint (`npx hyperframes lint .`) → snapshot (`npx tsx packages/cli/src/cli.ts snapshot . --frames 3`) → view contact sheet → fix issues → report back with specific frame descriptions.

═══ PREVIOUS BEAT (Beat N-1) ═══
[paste the FULL previous beat section from STORYBOARD.md]

═══ THIS BEAT (Beat N) ═══
[paste the FULL beat section from STORYBOARD.md — this IS the build spec]

═══ NEXT BEAT (Beat N+1) ═══
[paste the FULL next beat section from STORYBOARD.md]

═══ BRAND VALUES (from DESIGN.md) ═══
Colors:
  --bg:        #[hex]   primary background
  --fg:        #[hex]   primary text
  --accent:    #[hex]   CTA / highlights
  --surface:   #[hex]   card / panel backgrounds
  [add more if needed]

Fonts:
  Headlines: [font family], [weight]
  Body:      [font family], [weight]
  [brand font path if needed: capture/assets/fonts/Brand.woff2]

Key component styles:
  [paste relevant lines from DESIGN.md]

═══ CAPTURED ASSETS FOR THIS BEAT ═══
[Paste ACTUAL file paths + descriptions from asset-descriptions.md:

- capture/assets/hero-dashboard.png — full-bleed product dashboard, dark theme
- capture/assets/logo.svg — brand wordmark, white on transparent

Do NOT say "see asset-descriptions.md". Paste the paths here.]
```

The storyboard beat already contains everything — the concept, the visual choreography with exact timings, the CSS values, the SFX cues. The sub-agent's job is to translate that description into working HTML/CSS/GSAP, not to re-invent the creative direction. If you want, you can also paste any other relative and useful context to subagents if think it's good, why not.

### Per-composition process

For each beat:

**1. Read the storyboard beat.** The storyboard IS the build spec. It tells you what elements exist, how they enter, what they do during the beat, and how they exit. Follow it. If something in the storyboard isn't clear or seems impossible, research how to do it or ask — don't silently skip it.

**2. Build the static end-state first.** Position every element at its most visible moment. HTML+CSS only, no GSAP yet. The CSS position is the ground truth.

**3. Add the animation sequence.** Follow the storyboard's choreography — it specifies what happens and when. Use `tl.fromTo()` (not `tl.from()`) for entrances. Build the timeline in the order the storyboard describes.

**4. Add exit** (if CSS transition out). If shader transition — no exit animation needed.

**5. View the result.** After building, take a snapshot of this beat at different timestamps (where things are supposed to happen, animate, move and etc) and look at it from all angles, corners and positinos. Is the frame full and everything is exactly where it supposed to be? Are you sure??? Are elements readable? Does it match what the storyboard describes?

### Technical rules

- **No `repeat: -1`** — calculate exact repeats from beat duration
- **No `Math.random()`** — use a seeded PRNG
- **No bare `gsap.to()`** — all tweens on `tl`, never standalone
- **No full-screen dark linear gradients** — H.264 banding
- **Minimum fonts**: 80px+ headlines, 20px+ body
- **WCAG contrast on gradient backgrounds:** The contrast validator samples actual background pixels under the text element — if the background is a gradient image, darker parts of the image make the measured ratio _worse_ when you darken the text color, not better. Fix: either place text over a solid-color zone, or add `data-layout-ignore` attribute to decorative labels that don't need WCAG compliance. Don't blindly darken text color when the background isn't solid.

## 4. After all compositions are built — reconciliation check

Before moving to Step 6, run this sanity check:

```bash
# List every file in compositions/ and verify each one has a host div in index.html
ls compositions/
```

For every `.html` file in `compositions/`, confirm that `index.html` has a `data-composition-src="compositions/<filename>"` pointing to it. If any composition file is not referenced in `index.html`, add the missing host div now — an unreferenced composition is completely invisible at runtime.

**Captions stub rule:** Never create a `compositions/captions.html` with an empty transcript (`const script = [];`). If the VO/transcript step was skipped or failed, do not create the captions composition at all. An empty captions file that returns immediately is worse than no captions file — it silently does nothing and wastes a track slot.

Once all compositions are built and all `compositions/` files are wired into `index.html`, move to Step 6 (Validate & Deliver) for lint, validate, snapshots, and visual review.
