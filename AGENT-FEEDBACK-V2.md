# Agent Feedback — Pipeline v2 Test Run

**Date:** May 16, 2026  
**Branch tested:** `feat/pipeline-quality-v2`  
**Sites tested:** huly.io, arc.net, mercury.com, daylight.computer, framer.com, raycast.com, workos.com

At the end of each session I asked the agent: _"Have you faced any issues, problems, confusions during this session? What were they? What did you do?"_

Below: what I learned from each answer.

---

## Recurring Issues (all or most agents)

These showed up in 5+ of 7 sessions. They are the highest-priority fixes.

### HyperShader CSS crossfade bug

**Every agent hit this.** The skill docs (beat-direction.md, transitions.md) say omitting the `shader` field gives a CSS crossfade. In practice, the local build threw `Unknown shader: "undefined"` for every transition without an explicit shader name. Workarounds varied:

- Some agents assigned explicit shaders (`flash-through-white`, `cross-warp-morph`) everywhere — defeating the purpose
- One agent (workos) removed HyperShader entirely — sacrificed the creative centerpiece and spent 3 iterations on manual GSAP scene management
- This is either a bug in the local build or a doc/implementation gap. Needs actual testing with a composition to verify which.

**Action needed:** Build a test composition with mixed shader + CSS crossfade transitions, preview it, check what errors appear, and either fix the local build or update every doc that mentions this pattern.

### Snapshot tool captures HyperShader loading screen

**Every agent hit this.** HyperShader pre-renders all shader transition frames before playback. The snapshot tool fires during this pre-render phase, capturing "Preparing scene transitions" / "Sampling outgoing scene motion" instead of actual composition content. Result: visual QA step is completely blind when using shader transitions.

> "The biggest gap: I delivered the video without ever seeing it." — arcnet agent

**Action needed:** Either (a) make the snapshot tool wait for HyperShader pre-rendering to complete before capturing, or (b) document a clear alternative visual verification workflow (e.g., Studio preview + Playwright screenshots) as the canonical Step 6 path when using shaders.

### Sub-agents use wrong asset paths

**5+ agents.** Despite explicit instructions in step-5-build.md and the sub-agent prompt template, most sub-agents wrote `../capture/assets/` (relative to the composition file) instead of `capture/assets/` (relative to project root). The framer agent had all 6 sub-agents get it wrong; mercury had 4 of 5.

**Action needed:** Either add a linter rule that catches `../capture/` in composition files, or restructure the prompt template so the correct path is impossible to confuse (e.g., include the full absolute path in the inline brand values section).

### Transcription CLI hangs

**4+ agents.** `npx hyperframes transcribe` hung indefinitely with no feedback across multiple providers (default Whisper, Groq, tiny.en). Common causes: model download in progress with no progress indicator, CPU saturation from parallel sessions, missing API keys for Groq/OpenAI.

- Framer agent had complete failure across all providers — wrote `transcript.json` manually with estimated word timestamps
- Raycast agent had CPU saturation (83%+ per job from parallel sessions)

**Action needed:** Improve transcription CLI with (a) visible progress/download indicator, (b) cleaner error messages when API keys are missing, (c) document `whisper` system PATH as direct fallback escalation step.

---

## Per-Agent Issues

### huly.io

1. **HeyGen TTS API shape mismatch** — The skill shows `data.voices` as the response shape, but the actual API returns `data` as a direct list of voice objects. Took 3 tries to parse the JSON. Needs verification of exact current API response format and update in step-4-vo.md.
2. **HyperShader CSS crossfade bug** _(see above)_
3. **Snapshot loading screen** _(see above)_
4. **CSS transform conflicts** — Sub-agent used CSS `transform: translate(-50%, -50%)` for centering alongside GSAP position tweens — classic conflict. Linter caught it; agent fixed by switching to absolute positioning with calculated offsets. The linter worked; the sub-agent shouldn't have made the mistake.
5. **CLI path resolution** — `npx tsx packages/cli/src/cli.ts snapshot videos/huly-promo` fails when run from inside the video dir. Must run from repo root. Minor but easy to trip on.

### arc.net

1. **HyperShader CSS crossfade bug** _(see above)_ — worked around with all-shader transitions (4 shaders instead of 1+3 crossfades)
2. **Snapshot loading screen** _(see above)_
3. **WCAG contrast false positive** — Validator samples background image pixels under a label, not the canvas color. Ratio got _worse_ as the agent darkened the color (3.03 → 1.59) because the background gradient got darker too. Agent gave up and used `--no-contrast`. Fix: mark decorative elements with `data-layout-ignore`, or place label over a solid-color zone.
4. **Kokoro no pauses between beats** — Generates 0.02s gaps between sentences. Storyboard timing assumed breathing room at beat boundaries. Audio flows through transitions mid-speech. Better approach: SSML-style breaks in script, or generate each sentence separately and stitch with silence.

### mercury.com

1. **Wrong asset paths** _(see above)_ — 4 of 5 sub-agents got it wrong
2. **Custom fonts not wired** — Agent used `system-ui` fallback instead of setting up `@font-face` with captured `.woff2` files. The brand fonts (Mercury typefaces) didn't load. Meaningful brand fidelity loss.
3. **Transcription hung** _(see above)_
4. **HyperShader CSS crossfade bug** _(see above)_
5. **Snapshot loading screen** _(see above)_

### daylight.computer

1. **HyperShader CSS crossfade bug** _(see above)_
2. **Snapshot loading screen** _(see above)_
3. **Wrong asset paths** _(see above)_
4. **Storyboard timing doesn't match real TTS output** — Planned 30s with 5 beats, TTS generated 18.6s. No feedback loop between step 3 (storyboard) and step 4 (VO) for actual audio duration. Had to merge beats and compress to 4 beats / 25s. Better approach: have step 4 report actual duration and either offer to revise storyboard or adjust beat timings.
5. **Hashed font filenames** — Captured font files have names like `3fdf84c9117473e8-s.p.woff` with no mapping to family name. Agents guess or fall back to Georgia/system-ui. Need the capture pipeline to preserve the CSS `font-family` → filename mapping.
6. **Capture CLI ReferenceError** — `ReferenceError: outputDir is not defined` during AGENTS.md/CLAUDE.md generation. Not blocking, but leaves the capture directory without its context files.

### framer.com

1. **Transcription complete failure** _(see above)_ — All providers failed; manual transcript with estimated timestamps; captions approximate
2. **All 6 sub-agents used wrong asset paths** _(see above)_ — 100% failure rate despite explicit prompt instruction
3. **"Inter Variable" not in font map** — HyperFrames font compiler only maps "Inter", not "Inter Variable". Compiler warnings on every beat. Fix: replace "Inter Variable" → "Inter" in sub-agent prompts.
4. **HyperShader CSS crossfade bug** _(see above)_ — switched all 4 CSS crossfades to subtle shaders
5. **Snapshot loading screen** _(see above)_

### raycast.com

1. **Transcription bottleneck** _(see above)_ — CPU saturation from parallel sessions
2. **HyperShader CSS crossfade bug** _(see above)_ — replaced 3 CSS crossfades with WebGL shaders (heavier than intended)
3. **Wrong asset paths** _(see above)_
4. **Snapshot loading screen** _(see above)_
5. **Null reference on template content** — `document.querySelector("#beat-5-proof #counter-slack")` fails because `#beat-5-proof` (a template sub-composition) isn't in the main DOM when the script runs. Agents need to use `document.getElementById()` with null guards, or defer queries until the composition is mounted.
6. **Capture CLI ReferenceError** _(same as daylight)_
7. **GeistMono / Menlo / Monaco not in font map** — Raycast's brand mono font (GeistMono) has no compiler mapping. Falls back to browser default mono. Minor visual fidelity loss.

### workos.com

1. **HyperShader CSS crossfade bug caused complete HyperShader removal** — Agent couldn't figure out the bug, ripped it out entirely, spent 3 iterations on manual GSAP scene visibility (opacity fromTo → autoAlpha set() → visibility:hidden). The domain-warp creative centerpiece was lost.
2. **Scene visibility after HyperShader removal** — Without HyperShader managing scene sequence, all 6 scene divs stacked with `position: absolute`. Hard-cut implementation still had rendering artifacts.
3. **Snapshot tool empty frames (different failure mode)** — Showed empty/dark frames instead of the precompilation overlay. GSAP `fromTo` entrance animations never fired during snapshot capture. Elements stayed at `opacity: 0`. This suggests snapshot tool doesn't drive sub-composition GSAP timelines properly — different from the precompilation overlay issue.
4. **Kokoro TTS mispronounces product names** — "One API" → "Wanna PI", "Vercel" → "versatile". Captions show incorrect words at those moments. Fix: pronunciation guide in step-4-vo.md or phonetic spellings in scripts for known tricky names.
5. **Captions overlapping** — Multiple word groups appeared simultaneously; highlighted word didn't match speech. Partly from transcript issues above.

---

## Priority Action Items

| Priority | Issue                                        | Status              | Action                                                                                         |
| -------- | -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| P0       | HyperShader CSS crossfade throws "undefined" | ✅ Fixed `f8e733b9` | Optional `shader?` field in TransitionConfig. Omit = CSS crossfade. Verified.                  |
| P0       | Snapshot tool blind when using shaders       | ✅ Fixed `f8e733b9` | `__hf.shaderTransitions[].ready` as primary wait signal. Two failure modes resolved. Verified. |
| P1       | SFX overuse / assigned at build time         | ✅ Fixed `f8e733b9` | SFX now assigned in step 3 with exact files. Step 5 implements only.                           |
| P1       | Storyboard timing ≠ real TTS duration        | ✅ Fixed `f8e733b9` | Timing reconciliation gate added to step-4-vo.md. CTA hold hard-capped.                        |
| P1       | Sub-agents use `../capture/` paths           | Open                | Add linter rule or restructure sub-agent prompt                                                |
| P1       | HeyGen TTS API shape mismatch                | Open                | Verify current API response (`data.voices` vs direct list), update step-4-vo.md                |
| P2       | Transcription CLI hangs silently             | Open                | Progress indicator + cleaner error messages + direct `whisper` fallback                        |
| P2       | Hashed font filenames unreadable             | Open                | Capture pipeline should preserve font-family → filename mapping                                |
| P2       | Kokoro mispronounces product names           | Open                | Pronunciation guide in step-4-vo.md                                                            |
| P2       | WCAG contrast false positive on gradient bg  | Open                | Document `data-layout-ignore` for decorative elements                                          |
| P3       | "Inter Variable" not in font map             | Open                | Map "Inter Variable" → "Inter" in font compiler                                                |
| P3       | Capture ReferenceError (outputDir)           | Open                | Fix CLI bug in AGENTS.md generation                                                            |
| P3       | Template content null reference              | Open                | Document `getElementById` + null guard pattern                                                 |

---

_Collected: May 16, 2026_
