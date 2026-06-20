# Anti-Patterns

You default to these. Stop.

Each entry: the bad habit, what it produces, what to do instead. Written in the voice of someone who has watched an agent do this 10 times — because we have.

---

## Layout

### You default to center-aligned crown.

`.crown-plane { left: 0; right: 0; text-align: center }` is the template default, and you'll leave it on every video because it worked once. On a subject that sits right-of-center (Jobs in a 16:9 frame), the body eats the middle 60% of the word and "THE BEATLES" becomes "THE \_\_\_ S".

**Before using the default crown**, run the three conditions in [layout-heuristics.md § Crown placement](layout-heuristics.md):

1. Subject centered within 10% of frame center
2. Clean zones ≥ 15% on each side
3. Crown width > subject width + 400px

If any one fails, **move the crown to the larger clean zone** with a narrower container and smaller font. Don't keep centering a word that's about to be 60% occluded.

### You compute text leftmost as `plane_left + padding`.

That's correct for left-aligned. Wrong for the templates you're using, which are **right-aligned** on the main column and **center-aligned** on crowns. The real leftmost depends on the word width.

| Alignment | leftmost_x                                         |
| --------- | -------------------------------------------------- |
| Left      | `plane_left + padding_left`                        |
| Right     | `plane_right − padding_right − longest_line_width` |
| Center    | `plane_center − longest_line_width / 2`            |

Compute it against the **longest wrapped line**, not the whole phrase. "four very talented guys" wraps to 3 lines — the widest is "talented" (~8 chars), not 23.

### You treat `plane_left` as the text's leftmost edge.

It isn't. With `left: 180px` and a right-aligned 468px word, the text starts 104px **before** `plane_left` relative to the plane, but actually lands somewhere inside the plane box. The plane box just sets the coordinate space — the text positions inside it based on alignment. Check the compiled output, not the plane attribute.

### You center text on the frame when the subject is off-center.

Look at the subject's body center, not the frame center. Jobs sits at x=1100 in a 1920 frame. The **scene's** center of gravity is 1100, not 960. Center-aligning text to 960 is center-aligning to the empty left third, not to anything meaningful.

### You copy-paste position values from memory-wall to a new video.

`top: 40, right: 30, width: 720, rotateY: -13` worked for a 1280×720 frame with an acoustic foam wall on the right. It will not work on a 1920×1080 frame with a bookshelf backdrop. Run the 6-point checklist in [layout-heuristics.md § Step 0](layout-heuristics.md) for the new video before reusing any numbers.

---

## Typography

### You use template default font sizes regardless of column width.

Template defaults (66/78/92/140) are tuned for a ~560px column. When you bump the plane to 700px+ and don't touch the fonts, the captions feel underweight — small text swimming in negative space.

Use the [Font-size × column-width matrix](typography-presets.md). For a 700px column, that's 78/108/128/220 — a 30-40% bump across the board. Re-check pillarbox safety after bumping (bigger right-aligned text extends further left).

### You pick `intro` style for every first caption.

Intro = italic, smaller, contemplative. Fine for filler discourse markers ("You know,", "So,", "Well,"). **Not** for the first line when it's actually the thesis ("I've had this kind of upbringing"). Read the words semantically, not positionally.

### You skip emphasis entirely because "every caption looks clean."

A story without an emph or crown is typographically flat — viewers can't feel the crescendo. Reserve at least ONE emph per video for the line that lands. Skip it only for truly monotone content (policy statements, warnings).

### You give every group its own style.

Style is supposed to signal _hierarchy_. Using `intro`/`phrase`/`emph`/`dream`/`crown` all in one 15-second video means none of them signal anything. Pick 2-3 styles max for a short clip.

### You only use the 5 preset class names.

`intro / phrase / emph / dream / crown` are scaffolding, not a closed set. The canonical `memory-wall.html` uses `cap-1 / cap-2 / cap-3 / cap-4` — **position-indexed** with bespoke typography per position. That's how it achieves the 3-line right-aligned cascade on the climax. You can't express "this cap has a hanging indent at position 2" with `"style": "dream"`.

The `"style"` field in plan.json accepts **any string** — it becomes `class="cap-<string>"`. Define the class in `custom_css`:

```json
"custom_css": ".cap-1 { font-size: 78px; ... } .cap-2 { padding-right: 44px; }",
"groups": [{"id": "cg-0", "style": "1", ...}]
```

When the scene needs per-position bespoke typography, do this. Don't force-fit into `intro / phrase / emph`.

---

## Blending

### You default to `mix-blend-mode: overlay`.

Self-check: sample the caption region's luminance in a real frame, then pick:

- mid-tone surface (60-180) → `overlay`
- dark surface (<60) → `screen`
- bright surface (>180) → `normal` with opaque text

Why (overlay→black on dark, screen→white on bright) + the `SHARP`→`ARP` real-bug example and the named template defaults: [failure-modes.md § Blending](failure-modes.md).

_Path note: this manual blend pick is the **hand-authored `custom_css`** path. The dna/theme **engine** locks blend per DNA (`make-composition.cjs` ignores `plan.blend_mode`) — there you use luminance to **pick a fitting identity**, never to recolour ([SKILL.md](../SKILL.md) pre-flight #3, [dna/README.md](../identities/dna/README.md))._

### You animate `letter-spacing` on the word entry.

Inline-block reflow → the `.cap` line box recomputes every frame → captions jump between rows. **Animate only opacity + transform** — for a breath effect use `scale`/`y`, never letter-spacing / `filter:blur` / font-size. Mechanics + the "Some → line 2" bug: [failure-modes.md § Animation](failure-modes.md).

---

## Animation

### You fade both the group container AND each word.

`container.opacity × word.opacity` is non-linear — captions "pop" in around the 40% mark. Set container `opacity: 1` at entrance via `tl.set`, then fade only the words. Why + the curve math: [failure-modes.md § Animation](failure-modes.md).

### You stack captions in a flex column.

Hidden caps (`visibility: hidden`) still reserve flex space → the entering cap lands at the column bottom in the gesture zone, clipped. Use `position: absolute` per `.cap` inside the plane. The `cg-4 → y=700` instance: [failure-modes.md § Layout](failure-modes.md). _(Deliberate flex accumulation — the memory-wall poem-stack — is the sanctioned exception: [bespoke-vs-presets.md § Caps should accumulate](bespoke-vs-presets.md).)_

### You start the timeline at t=0.

Caption at exactly t=0 feels like it was there before the video started. Offset 0.1-0.3s (hyperframes motion-principles.md agrees). Same for the very last caption — let it exit before the video fades.

---

## Scene admission

### You trust that "looks like one speaker" = "is one speaker throughout."

Self-check: you skipped the shot-cut probe and rendered captions across a hidden cut (Subject A's layout applied to Subject B / B-roll). Run the scene-admission gate before planning — shot-cut, letterbox/pillarbox, and baked-in-caption refuse rules, contact-sheet not spot-frames — in [SKILL.md § Decision gate / Pre-flight probes](../SKILL.md). Deeper why + the Jobs→Beatles cut-at-t=9s example: [failure-modes.md § Scene admission](failure-modes.md).

### You ship Whisper's transcript without checking timings against the beat.

Transcription is Whisper (via `transcribe.cjs`, no API key) — good word timings, but not infallible: a word can land with a near-zero duration or a timestamp a beat off. This skill is verbatim + on-beat, so `check-timing.cjs --strict` (80ms tolerance) is the gate, not a suggestion — fix drift in `plan.json` before rendering, and never pack two transcript words into one timed entry (the second inherits the first's timestamp and fires early).

---

## Matting

### You enable CoreML for the matting ONNX.

No — CoreML partitions the graph; the mixed-precision boundary leaks alpha≈30 inside the face → captions shine through. Pin `CPUExecutionProvider` only; `matte.cjs` already does. Detail: [failure-modes.md § Matting](failure-modes.md).

### You pick a matte model by "general vs human."

DECISION FLIPPED 2026-06-12 after a 5-model × 6-scene A/B with caption renders: the matte's job here is CAPTION LAYERING, not prop fidelity. `u2net_human_seg` (via hyperframes `remove-background`) usually excludes thin offset furniture (mic boom arms) from the matte — words stop being sliced by booms, which beat PP-MattingV2's prop-preserving behavior on real caption videos. It is NOT surgical: large salient objects near the subject (telescope rigs) can still leak in — always sample frames_fg/. Known cost: HELD products can drop out intermittently (captions pass in front) — route product-demo climaxes away from held objects. `isnet-general-use` lost outright (backlit-hair collapse). birefnet-portrait (MIT) beat everything semantically (keeps held items AND drops furniture) but is 928 MB / ~7 s-per-frame CPU — a future quality tier, not the default.

---

## Grouping

### You caption every word.

Self-check: am I transcribing instead of editing? The rail carries most text; embed is the scarce, earned peak — drop filler, never caption every word. Full model → [../SKILL.md § Caption model](../SKILL.md#caption-model--rail--embed); the merge/condense/skip mechanics → [caption-grouping.md](caption-grouping.md).

### You group by fixed word-count.

"3 words per caption, always" makes every caption look the same and fights the natural cadence of speech. Break on sentence boundaries, 250ms+ pauses, and semantic units instead. Caption sizes will naturally vary from 2 words to 5 — that's correct.

---

## The meta anti-pattern

### You read one reference doc and skip the rest.

You'll read this file alone and feel covered. These anti-patterns reference concepts defined in `layout-heuristics.md` (incl. its Step 0 embed-viability gate) and `typography-presets.md`. If you haven't read those, the fix advice here won't make sense.

**Order of reading for a new video**:

1. SKILL.md (decision gate + pipeline + pre-flight probes)
2. bespoke-vs-presets.md (per-group `custom_css` overrides)
3. layout-heuristics.md (Step 0 embed-viability gate — all 4 wall conditions; then positions, sides, crown, font scale, pillarbox formula)
4. typography-presets.md (font-size × column-width table, starting points)
5. caption-grouping.md (word → group)
6. **This file last** (to catch yourself before committing to plan.json)

If you're pressed for time, still read this one — it flags the failures you're about to make.
