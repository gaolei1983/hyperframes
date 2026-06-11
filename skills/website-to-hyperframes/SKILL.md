---
name: website-to-hyperframes
description: |
  Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any kind of video content. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website, then produce a professional video from it — collaboratively with the user.

**Take your time on thinking and reviewing.** Quality matters more than speed. Read every reference file the steps point to. Look at every snapshot carefully. If a composition looks weak, revise it before moving on. A polished video is worth more than a rushed one delivered 5 minutes faster. That said: don't sit idle on stuck commands — escalate immediately if a process hangs (see Step 4 for escalation order).

**This is a collaborative workflow by default.** At key moments (marked 💬), you stop and ask the user what they want and refine based on their feedback.

**Autonomous mode exception:** If the user says "decide for me", "just build it", "surprise me", or gives any signal they don't want to be asked questions — skip ALL 💬 gates. Make all creative decisions yourself (video type, style, voice, storyboard), and present the finished result for feedback at the end. Do not ask four separate questions across four separate steps. Read the room once and commit.

**Sub-agent mode (default):** Step 5 dispatches one sub-agent per beat. Each sub-agent reads [beat-builder-guide.md](references/beat-builder-guide.md), builds, lints, and verifies its own beat before reporting back. The main agent assembles the final video and does a final check. Snapshots happen in Step 6 only — sub-agents do not run snapshot themselves. **All CLI invocations must use the local CLI form `npx tsx packages/cli/src/cli.ts <cmd>`** (see the CLI table below). The published `npx hyperframes` package may lag the worktree by weeks; the local CLI always reflects the current code.

**No sub-agents:** If the user says "no sub-agents", "build it yourself", or the runtime doesn't support parallel agents — the main agent builds all compositions sequentially using the same beat-builder-guide workflow. Same quality, just slower.

**This skill requires image-viewing capability** for the validate step (Step 6). If your agent cannot view PNG files, the snapshot review will be blind. Contact sheets (Step 0 and Step 6) are designed to minimize the number of images needed — but some visual verification is unavoidable.

**Compact user-facing output.** Every message to the user is short by default — single-paragraph answers, terse summaries at 💬 gates, tight bullet lists. No multi-section breakdowns, no preamble, no recap of what you just did. The full reasoning lives in the artifacts (DESIGN.md / STORYBOARD.md / SCRIPT.md / etc.); the chat message points at the artifact and asks the next question. Users don't read walls of text — and a wall of text right before a 💬 gate buries the question.

**🚫 NEVER render to verify.** `render` is a user-triggered final action, not a verification primitive. Across all 7 steps, every check has a non-MP4 path: `lint` / `validate` / `inspect` (static), `check-rendered-perception.mjs` (Puppeteer seek → JSON), `snapshot` (PNG + Gemini descriptions), `ffmpeg volumedetect` on source `narration.wav` / `sfx/*.wav`. Do NOT call `render` to spot-check a beat, measure audio, inspect a frame, or confirm a fix. Only invoke `render` when the user explicitly says "render it" / "export the mp4" / "make the final". Anything else is wasted minutes.

---

## The Creative Tension Principle

Before writing the first beat of any storyboard, answer this in one sentence:

> **"What makes this video different from a generic [video type] for any [industry] brand?"**

If you can't answer it, you haven't thought enough. A product demo for a fintech tool and a product demo for a design tool should not share the same visual DNA. The answer comes from this specific brand's captured assets, its visual language, and what the user said they want — not from a lookup table.

This principle applies at every creative decision point: picking a visual style, choosing transitions, writing beats, building compositions. Every choice should be traceable to something specific about this brand, not just to "this is what I do for cinematic videos."

Users say things like:

- "Capture https://... and make me a 25-second product launch video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from https://..."

---

## Step -1: What we're actually making (REQUIRED before Step 0)

You're not making _a video_. You're making something that **stops scrollers in the first 1.5 seconds** and feels alive in every single frame. Slow intros are for cinematic trailers; videos shipping anywhere social or feed-based need a hook that beats the 1.5-second scroll threshold. **Think about how to go viral.**

**This is a VIDEO, not a webpage rebuilt in divs.** Composing UI from divs/SVG/CSS (instead of pasting product screenshots) is the right _medium_ — but the wrong outcome is to build a webpage-style layout and animate it 2 pixels. Videos use cinematic grammar: framing, depth, camera movement, scale, atmosphere. A kanban in a video is not "a kanban centered at 80% scale with cards breathing 1px" — it's a SHOT: extreme close-up on a card sliding home, camera pulls back to reveal the full board, ambient particles + glow + depth give it weight. The composed divs are the subject; the cinematography is what makes it feel like film.

This framing shapes Step 3 (storyboard) and the beat dispatch in Step 5. The operational rules — exact anti-patterns to refuse (macOS chrome, ±1-2px breathing, page nav, settled beats) and the cinematic grammar (SHOT framing, camera motion, depth layers, light choreography, 30-100px magnitudes) — live in [references/beat-builder-guide.md](references/beat-builder-guide.md) where sub-agents read them at author time. Captured-asset usage details live in [references/step-0-capture.md](references/step-0-capture.md).

---

## Step 0: Capture & Understand the Brand

**Read:** [references/step-0-capture.md](references/step-0-capture.md)

Capture the site, then read the extracted data to understand the **brand and product** — what it does, who it's for, what voice it speaks in, what mood it lives in. The captured assets are a brand toolkit for later, not the building blocks the video is made from.

**Gate:** Site summary printed — strategy-first (what the product does, who it's for, brand voice) before the asset / color / font inventory.

---

## Step 1: Brand Identity

**Read:** [references/step-1-design.md](references/step-1-design.md)

Write DESIGN.md — a brand cheat sheet covering the visual identity: colors, typography, component styles, layout principles. Use `design-styles.json` for exact computed values. Target length is 250–350 lines per [step-1-design.md](references/step-1-design.md); the field-tested floor is ~200 lines below which output reverts to a generic dark-cinematic template.

**Gate:** `DESIGN.md` exists at ~250–350 lines with all 6 sections per `step-1-design.md`.

---

## Step 2: Strategy & Messaging 💬

**Read:** [references/step-2-brief.md](references/step-2-brief.md), [references/visual-vocabulary.md](references/visual-vocabulary.md), [references/capabilities.md](references/capabilities.md) (scan the Table of Contents — deep-dive sections only as needed)

Align with the user on **what the video must communicate** before talking visuals or assets. Parse the user's prompt — they probably already gave you the video type and style. Ask only what's missing: the ONE thing this video must say, the narrative arc, and the audience.

**Narration & on-screen text — ask once, here.** Among the brief questions, include this one:

> Narration & on-screen text — pick one:
> - **(a) Voiceover only** — a voice carries the video; no text overlay.
> - **(b) On-screen captions/text** — the video narration appears as text on screen (subtitles/lower-thirds/kinetic type that mirrors the voice or carries it on its own).
> - **(c) No narration text** — visuals + ambient/music carry it; nothing spoken or written.

The answer drives both Step 4 (whether `narration.wav` + `transcript.json` are generated) and the captions step inside Step 5 (whether `captions.mjs` runs to produce `compositions/captions.html`). No mid-flow gate later.

**Gate:** Video type, duration, format, the message + narrative arc, AND the narration/text choice from above are all locked.

---

## Step 3: Script + Storyboard 💬

**Read:** [references/step-3-storyboard.md](references/step-3-storyboard.md)

Write the script first — the narration is the spine the video carries, and the beats must serve what's being said. Open with the hook (no "Welcome to…"), follow the narrative arc locked in Step 2, write to ~2.5 words/sec for the target duration. Save as `SCRIPT.md`.

Then derive the storyboard from the script: split the script into beats, write a beat per sentence-cluster or per arc-moment, pick 2–4 techniques per beat that serve what the narration is saying at that timestamp, decide per beat what visual content carries it (captured asset / composed visual / both layered — see step-3 for the principle), then verify the Asset & Brand Floor at the end. Save as `STORYBOARD.md`.

Present a compact summary to the user: 1-line script gist + beat list (verb + visual + duration). Iterate until they approve.

**Gate:** `SCRIPT.md` + `STORYBOARD.md` exist AND the user has approved the plan.

---

## Step 4: VO + Timing 💬

**Read:** [references/step-4-vo.md](references/step-4-vo.md)

If Step 2 said no narration (option c) — skip to Step 5. Otherwise (a or b): ask the user which TTS provider (HeyGen / ElevenLabs / Kokoro) in one compact question, generate full narration directly (no audition pass), transcribe (or use HeyGen's word timestamps), map timestamps to beats, reconcile timing.

Captions/on-screen text was decided in Step 2 — do NOT re-ask here. If Step 2 picked option (b), `captions.mjs` will run automatically between Step 5 and Step 6 (see Step 5's "Captions are NOT your job" note).

Music is deferred — w2h doesn't currently generate it; if the user supplies a track they'll say so. Don't ask.

**Gate:** Either (a) no narration was requested and storyboard has manual beat timings, or (b) `narration.wav` + `transcript.json` exist and beat timings updated with real durations.

---

## Step 5: Build Compositions

**Read:** The `hyperframes` skill (load it — every rule matters)
**Read:** [references/step-5-build.md](references/step-5-build.md)

Build the **beat compositions** (`compositions/beat-N-<slug>.html`) following the architecture and pacing chosen in the storyboard (Step 3). Sub-agents run `npx tsx packages/cli/src/cli.ts lint .` on each beat before reporting back. The root `index.html` is NOT authored by workers — it's produced deterministically by `scripts/assemble-index.mjs` at the end of this step.

Sub-agents receive the dispatch packet (`/tmp/w2h-dispatch/b<N>.txt`) which contains DESIGN.md + STORYBOARD.md + SCRIPT.md + transcript.json. Workers read DESIGN.md for brand voice + component rules + iteration guide.

**Final action — assemble the root composition:**

```bash
node skills/website-to-hyperframes/scripts/w2h-prep.mjs --hyperframes <project-dir>
node skills/website-to-hyperframes/scripts/assemble-index.mjs --group-spec <project-dir>/group_spec.json --hyperframes <project-dir>
```

Track lanes are enforced by the assembler: scenes=0, narration=10, BGM=11, captions=12, SFX=20+i. If Step 2 picked on-screen captions, `captions.mjs group | html` also runs between worker beats and the assembler. HyperShader transitions are gated on `group_spec.shader_transitions` (orchestrator adds when storyboard calls for them).

**Gate:** All sub-agents reported back, every beat's self-check grep block printed zero `FAIL:` lines, `assemble-index.mjs` exited 0, and `index.html` exists at the project root. The top-to-bottom read of every beat happens in Step 6 (post-preflight) — one verification pass, not two.

---

## Step 6: Validate & Deliver

**Read:** [references/step-6-validate.md](references/step-6-validate.md)

Lint, validate, take snapshots scaled to video length (formula: `max(beats × 3, ceil(duration_seconds / 2))`), and review each one. Fix issues before delivering. Deliver the localhost Studio project URL.

**🚫 NEVER render to verify anything.** Render is a user-triggered final action, not a verification primitive. Do NOT render to spot-check a beat, measure audio, inspect a frame, or confirm a fix. Every check has a non-MP4 path: `lint` / `validate` / `inspect` (static); `check-rendered-perception.mjs` (Puppeteer + GSAP seek → JSON, no MP4); `snapshot` (seeked PNG frames + Gemini); `ffmpeg volumedetect` on source `narration.wav` + `sfx/*.wav`. Only invoke `render` when the user explicitly asks ("render it", "export the mp4", "make the final"). Anything else is wasted minutes.

**Preflight orchestrator:** `scripts/preflight-finalize.mjs` composes lint + validate + inspect + caption keep-out + rendered-perception into one Bash invocation with an exit-0/1/2 contract. Writes `finalize_brief.json` with each gate's pass/fail + edit-ready violation strings. **Exit 2 = BLOCKED:** at least one of lint/validate/inspect produced a hard error, OR `--require-perception` is set and puppeteer is missing. STOP — do not patch in finalize; fix the upstream beat file (or re-dispatch the worker), then re-run preflight. Override only with `--allow-gate-failure` if you want to chase gate errors during manual review.

**Pre-render perception gate:** part of the preflight above. `scripts/check-rendered-perception.mjs` loads each beat in headless Chrome at 1920×1080, seeks the GSAP timeline at 3 probes/scene, and emits `perception_report.json` with 8 visual-failure classes — many with edit-ready `edit_old`/`edit_new` strings. Always exits 0 (informational); the orchestrator decides whether to block based on `--require-perception`.

**Post-render gate:** the render output is verified deterministically by `scripts/verify-output.mjs render`, which checks file existence, size > 10KB (catches header-only renders), and duration drift < 0.5s vs `group_spec.total_duration_s` (emitted by `scripts/w2h-prep.mjs`). Exit 1 means do not proceed to publish.

**Deliver something you're proud of.** Before handing off, ask yourself: would I post this on social media with my name on it? If not, fix what's wrong.

**Gate:** `preflight-finalize.mjs` exits 0 (gates clean + caption keep-out + perception), `verify-output.mjs render` exits 0 (on render-on-demand), and the final response includes the active Studio project URL.

---

## Quick Reference

### Video Types

Typical constraints by video type — use as a starting point, not a formula. Beat count should follow from the content and the narration, not from a target range.

| Type                  | Typical duration | Duration driver    | Narration             |
| --------------------- | ---------------- | ------------------ | --------------------- |
| Social ad (IG/TikTok) | 10–15s           | Platform limit     | Optional              |
| Product demo          | 30–60s           | Script length      | Full narration        |
| Feature announcement  | 15–30s           | Feature complexity | Full narration        |
| Brand reel            | 20–45s           | Music track        | Optional, music focus |
| Launch teaser         | 10–20s           | Hook energy        | Minimal               |

Beat count is not in this table intentionally — it should come from the storyboard, not from "social ad = 3-4 beats." A social ad for a complex product might need 5 well-timed beats. A brand reel with one strong visual thesis might need 3.

### Format

- **Landscape**: 1920x1080 (default)
- **Portrait**: 1080x1920 (Instagram Stories, TikTok)
- **Square**: 1080x1080 (Instagram feed)

### User Interaction Points

| Step                         | What to ask                                                                                | Why                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Step 2 (Strategy)            | Message, narrative arc, audience, video type, style, format, narration & on-screen text    | The story is what every downstream choice flows from. Captions decision belongs here, not Step 4. |
| Step 3 (Script + Storyboard) | Script approval first, then beat-by-beat approval                                          | Script drives the beats. Iterating on the script is 30s; iterating on a built beat is 5min. |
| Step 4 (VO)                  | TTS provider choice, API key if needed                                                     | Voice quality makes or breaks the video. User may have provider preferences.           |

### CLI invocations & known footguns

**Always use the local CLI form: `npx tsx packages/cli/src/cli.ts <cmd>`.** This points at the current source — no build step, no version drift. The published `npx hyperframes` may be weeks behind the worktree and silently miss fixes (capture asset-naming, snapshot sub-comp loading, lint rules, perception gate, etc.).

| Command          | Invocation                                                       | Takes                | Notes                                                                                    |
| ---------------- | ---------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `capture <URL>`  | `npx tsx packages/cli/src/cli.ts capture <URL> -o <dir>`         | URL + `-o <dir>`     | Paginated contact sheets + SVG root scan + content-addressable filenames (latest fixes). |
| `snapshot <dir>` | `npx tsx packages/cli/src/cli.ts snapshot <dir> --frames <N>`    | DIRECTORY            | 3-col contact sheet + sub-comp load + Gemini vision descriptions.                        |
| `lint <dir>`     | `npx tsx packages/cli/src/cli.ts lint .`                         | DIRECTORY, not file  | Pass a DIRECTORY (`lint .`), not a file (`lint index.html`).                             |
| `validate <dir>` | `npx tsx packages/cli/src/cli.ts validate .`                     | DIRECTORY            | Headless render check. Surfaces render-time errors.                                      |
| `inspect <dir>`  | `npx tsx packages/cli/src/cli.ts inspect . --samples <N>`        | DIRECTORY            | Probe gate. `N = max(18, scenes × 2)`.                                                   |
| `preview`        | `npx tsx packages/cli/src/cli.ts preview`                        | (run in project dir) | Long-running server. Start before delivering.                                            |
| `render <dir>`   | `npx tsx packages/cli/src/cli.ts render --output <path> ...`     | DIRECTORY            | `--quality` accepts `draft`, `standard`, or `high`. `medium` is INVALID.                 |

**Footguns:**
- ❌ `npx hyperframes <anything>` — published package lags the worktree; never use it for this workflow.
- ❌ `hyperframes lint index.html` — takes a directory, not a file.
- ❌ `--quality medium` — not a valid value (use `draft | standard | high`).

### Reference Files

| File                                                                               | When to read                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [step-0-capture.md](references/step-0-capture.md)                                  | Step 0 — capture, understand the brand and product, write strategy-first site summary                                                          |
| [step-1-design.md](references/step-1-design.md)                                    | Step 1 — write DESIGN.md brand cheat sheet (6 sections, 250-350 lines)                                                                         |
| [step-2-brief.md](references/step-2-brief.md)                                      | Step 2 — align on message, narrative arc, audience with user                                                                                   |
| [capabilities.md](references/capabilities.md)                                      | Steps 2 & 5 — full inventory of what HyperFrames can do (24 sections). Scan the TOC during the brief, deep-dive specific sections during build |
| [visual-vocabulary.md](references/visual-vocabulary.md)                            | Step 2 & 3 — translate subjective terms to concrete techniques. Composable building blocks, not rigid presets                                  |
| [step-3-storyboard.md](references/step-3-storyboard.md)                            | Step 3 — storyboard + script (combined) with user review gate                                                                                  |
| [step-4-vo.md](references/step-4-vo.md)                                            | Step 4 — TTS provider choice, generation, timing                                                                                               |
| [step-5-build.md](references/step-5-build.md)                                      | Step 5 — build index.html + compositions                                                                                                       |
| [step-6-validate.md](references/step-6-validate.md)                                | Step 6 — lint, validate, snapshots (scaled to video length), preview                                                                           |
| [techniques.md](../hyperframes/references/techniques.md)                           | Steps 3 & 5 — 20 visual techniques with code patterns (adapt, don't copy-paste)                                                                |
| [html-in-canvas-patterns.md](../hyperframes/references/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects (lives in the hyperframes skill)                                                    |
