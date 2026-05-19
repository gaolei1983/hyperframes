# Section 06 — Transitions (CSS)

CSS-only transitions between beats: push, scale, blur dissolve, 3D flip, light leak wipe, plain dissolve. The lighter-weight counterpart to shader transitions — same beat-to-beat punctuation, no WebGL required.

**When to study this section:** any multi-beat composition where CSS transitions are sufficient and the cost/complexity of shader transitions isn't warranted. Also the right choice for fast-pacing videos where transitions need to be ~0.2-0.4s.

---

## Scenes

| Scene | Duration | Techniques | Why study |
|-------|----------|------------|-----------|
| [`scene-01-css-transitions-grid/`](scene-01-css-transitions-grid/) | 5s | 2×3 grid of 6 mini panels, each running ONE CSS transition between Beat A and Beat B states: (1) **Push** — A slides out left, B slides in from right with `power3.inOut`; (2) **Scale** — A scales down + fades, B scales up + fades with `back.out(1.7)` overshoot; (3) **Blur Dissolve** — A fades out with increasing `filter: blur()`, B fades in with decreasing blur; (4) **3D Flip** — coin-flip via `preserve-3d` + `backface-visibility: hidden`; (5) **Light Leak Wipe** — bright gradient wipes across as A→B handoff happens behind; (6) **Dissolve** — classic opacity crossfade. Each transition staggered to fire at different timestamps so snapshot frames catch them mid-state. | Demonstrates that you don't always need shaders for beat transitions. Each cell is a complete A→B transition you can copy into a real beat. The 3D flip pattern especially is useful — `preserve-3d` + `perspective` + `backface-visibility: hidden` is a recipe many agents miss. |

---

## QC log

- scene-01: **PASS** — 6 frames; frame 1 all panels in A state, frame 2 panel 1 PUSH kicking off, frame 3 panels 1+2 in B, frame 4 panel 4 3D FLIP caught mid-rotation (the money shot with angled red B face skewed in 3D), frame 5 all panels in B, frame 6 final B held. 6 distinct easings across the 6 panels.
