# Bespoke design vs. presets — when to override, when to clone

The 5 preset styles (`intro / phrase / emph / dream / crown`) and the 3 templates (`wall-embed`, `corner-column-crown`, `portrait-header`) are **scaffolds**, not rules. The best renders we've shipped all override presets for specific groups because **typography is a per-scene decision**, not a general rule.

If you only use presets, your render will look generic. Typography is a per-scene decision: start from the identity's defaults, then **override per-group via `custom_css`** where a phrase earns its own treatment.

---

## When presets are wrong

You'll reach for presets like `"style": "emph"` when what the scene really needs is:

### "This cap is at position N and deserves its own treatment"

`memory-wall.html` uses `cap-1 / cap-2 / cap-3 / cap-4` — **position-indexed**, not role-indexed. Each one is a bespoke design for a specific phrase at a specific point in the arc:

- cap-1 (soft opener, 4 words): 78px italic 600 — feels like a whisper
- cap-2 (dreamy modifier, 3 words): 66px italic 500 + `padding-right: 44px` — hanging indent creates ragged right-edge stagger
- cap-3 (turn, 2 words): 72px upright 700 — the syntactic pivot, no italic
- cap-4 (climax, 4 words): 90px uppercase 900 — three lines cascade right-aligned

`phrase/emph/intro` can't express "this cap has a hanging indent" or "this cap is the syntactic pivot". When that matters, invent your own class names:

```json
{
  "template": "wall-embed",
  "custom_css": "
    .cap-1 { font-size: 78px; font-weight: 600; font-style: italic;
             letter-spacing: -0.01em; }
    .cap-2 { font-size: 66px; font-weight: 500; font-style: italic;
             padding-right: 44px; }
    .cap-3 { font-size: 72px; font-weight: 700; letter-spacing: -0.015em; }
    .cap-4 { font-size: 90px; font-weight: 900; letter-spacing: -0.03em;
             text-transform: uppercase; line-height: 1.0; }
  ",
  "groups": [
    { "id": "cg-0", "style": "1", "words": [...] },
    { "id": "cg-1", "style": "2", "words": [...] },
    ...
  ]
}
```

The `"style": "1"` field becomes `class="cap-1"` on the element — any string works, no validation.

### "The template's blend doesn't suit this backdrop" → pick a different template, do NOT override

**Cinematic mode does not override colour or blend.** A template's `mix-blend-mode` + fill are **locked DNA** — `make-composition.cjs` ignores `plan.cap_color` / `blend_mode` / `text_shadow` / `text_filter`. Selecting a template commits to its look; the only agent-authored things are layout (planes/positions) and per-group typography.

So use the caption-region luminance to **choose** a template that already fits — never to recolour one:

| Region luminance                  | What fits                                                                                     | Why                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| < 60 (dark / low-key)             | a cream + `screen` template (`cinematic-cream`, `memory-wall`, `champion`, `portrait-header`) | light text glows, picks up the scene                                                        |
| 60–180 (mid-tone)                 | a cream + `screen` template still reads (add a scrim if marginal)                             | text picks up texture                                                                       |
| > 180 (bright: window, pale wall) | **none of the cream/`screen` Cinematic templates — they wash out**                            | → use the **`anchor` theme** or **`ink`** (opaque surfaces built for bright scenes) instead |

If the scene is bright and the cream/`screen` look washes out, that's the signal to switch to the **`anchor` theme** or **`ink`** (opaque surfaces built for bright scenes), not to recolour a Cinematic template into something it isn't.

_(This table is the hand-authored / clone-and-tweak path. Canonical luma → blend/identity rule: [../dna/README.md](../identities/dna/README.md) `bandLuma × register` pick + [../SKILL.md](../SKILL.md) pre-flight #3.)_

### "Hanging indent / outdent / letter-width tweak"

These are per-group affordances you'll occasionally need. Express via `custom_css`:

```css
#cg-2 {
  padding-right: 44px;
} /* right-aligned: shrinks right edge, creating left outdent */
#cg-2 {
  padding-left: 44px;
} /* left-aligned: offset right start */
.cap-emph .w:first-child {
  font-size: 110%;
} /* oversize first word only */
```

The `#cg-N` selector always works because `make-composition.cjs` writes `<div id="cg-N" ...>` for every group.

### "Caps should accumulate (flex stack) instead of swap"

All three templates default to `position: absolute` on `.cap` inside their plane — caps stack at one spot and only the active one shows (single-caption swap). This is correct for `portrait-header` and `corner-column-crown`, where each caption replaces the last.

`memory-wall` uses **flex column accumulation** — captions pile up like a poem. The template doesn't default to this, so override via custom_css:

```css
.wall-plane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end; /* or flex-start for left-aligned */
  text-align: right;
  gap: 14px;
}
.wall-plane .cap {
  position: static; /* un-do template's absolute */
  top: auto;
  right: auto;
  max-width: 100%;
}
```

With this + staggered `in` / `out` times, cap-0 fades in at t=0.2, cap-1 at t=2.55 (below cap-0 in flex order), cap-2 at t=4.90 (replaces both as they fade out together at t=4.85) — this is how the memory-wall poem pages work.

### "Font size doesn't match the scene"

Template preset sizes are tuned for a specific column width + frame size. Don't fight them — override:

```json
"custom_css": ".cap-intro { font-size: 52px; } .cap-phrase { font-size: 60px; }"
```

Then check [typography-presets.md § Font-size scales with column width](typography-presets.md) for what to aim at given your plane's actual dimensions.

## Rendering history

`render-and-composite.sh` now snapshots `index.html` + `plan.json` into `<project>/history/` with a timestamp before every render. If the user says "the previous one was better", diff against the latest snapshot:

```bash
ls <project>/history/
diff <project>/history/index-20260422-203947.html <project>/index.html
```

This lets you recover a design you iterated away from, without re-reading the agent transcript.
