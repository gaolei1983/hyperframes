#!/usr/bin/env node
/*
 * make-theme.cjs — THEME mode compiler (third compiler, beside standard/cinematic).
 *
 * A theme DNA (themes/<name>.json) is a complete visual constitution composed
 * from two registries implemented HERE, once, for all DNAs:
 *
 *   BODY PARADIGMS  how the transcript surface lives
 *     rail      lower-third lines that replace each other (fg alpha)
 *     panel     console log accumulating in a docked glass panel (fg alpha)
 *     poem      lines accumulate in open space, stanza by stanza (fg alpha)
 *     takeover  every beat owns the full frame as a hard-cut card (bg)
 *
 *   HERO SETPIECES  the climax choreography
 *     detonation  sliced stencil stamp: shear-in, snap, squash, cool, furniture
 *     decode      slot-machine glyph reels lock left→right, CRT-off exit
 *     drawon      single-line-font stroke-order writing (sequential dash reveal)
 *     assembly    inline word assembles from inbound particles (poem apex)
 *     colorflip   inline accent-color crush card (takeover apex)
 *
 * plus LINKAGES (theme interactions: redact-until-hero, disperse-on-last-word,
 * corrupt-on-last-word) and a PLATE budget compiled to _postfx.sh.
 *
 * Inputs : <project>/theme.json  { dna, lines:[[w,...],...], hero:{match,text?},
 *           minors?:[...], width?, height?, fps? }
 *          <project>/transcript.json (verbatim, word timings)
 *          themes/<dna>.json
 * Outputs: index.html (bg: plate reaction + embedded setpiece)
 *          rail.html  (fg alpha: body paradigm + front fx)   [unless body.layer=bg]
 *          _postfx.sh (plate reaction: punch/shake after composite)
 *
 * Render: scripts/render-theme.sh <project>   (render-and-composite + postfx)
 *
 * Determinism contract: paused GSAP on window.__timelines["main"], seeded PRNG
 * only (mulberry32), set-chains / pure-f(t) keyframes, no Math.random/Date.now.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT = path.resolve(process.argv[2] || ".");
const SKILL = path.resolve(__dirname, "..");
const F = 1 / 24;

// ---------- load inputs ----------
const theme = JSON.parse(fs.readFileSync(path.join(PROJECT, "theme.json"), "utf8"));
const dna = JSON.parse(fs.readFileSync(path.join(SKILL, "identities", "themes", theme.dna + ".json"), "utf8"));
const transcript = JSON.parse(fs.readFileSync(path.join(PROJECT, "transcript.json"), "utf8"));
const W = theme.width || 1280,
  H = theme.height || 720;

// FPS: matte.fps is AUTHORITATIVE (written by matte.cjs at the source's native
// rate; the matte overlay + postfx zoompan must run at this rate or the output
// retimes). theme.fps only overrides when matte.fps is absent.
function readMatteFps() {
  try {
    const v = parseInt(
      fs.readFileSync(path.join(PROJECT, "matte.fps"), "utf8").replace(/\D/g, ""),
      10,
    );
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
const FPS = readMatteFps() || theme.fps || 24;

function probeDuration() {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        path.join(PROJECT, "source.mp4"),
      ],
      { encoding: "utf8" },
    );
    return parseFloat(out.trim());
  } catch {
    const n = fs.readdirSync(path.join(PROJECT, "frames_fg")).length;
    return n / FPS;
  }
}
const DUR = +(theme.duration || probeDuration()).toFixed(6);

// ---------- scene awareness (safe-zones.json): inherit the typography system ----------
// The existing modes' scene intelligence applies here too: hero placement comes
// from the measured occlusion bands + subject anchor, panel/poem dock on the
// clearer side, and hero font size is width-fit to the actual word. Explicit
// theme.json values > scene auto > DNA fallback.
function readJson2(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
const sz = readJson2(path.join(PROJECT, "safe-zones.json"));

// per-setpiece preferred band (topPct of the hero's TOP edge)
const SETPIECE_PREF_TOP = {
  detonation: 28,
  decode: 26,
  drawon: 18,
  cpslam: 27,
  coverword: 27,
  settle: 27,
  flapboard: 25,
  ledwipe: 52,
  vhsosd: 26,
  bossintro: 30,
  rubberstamp: 29,
  breakaway: 46,
  lasercage: 33,
  boltstrike: 24,
  holoboot: 28,
  biobloom: 33,
  silkribbon: 18,
  scopetrace: 25,
  papermat: 26,
  centerfold: 21,
  chalkwrite: 44,
  spraytag: 26,
  brushwrite: 19,
  plotterdraw: 18,
  inkbloom: 25,
  ransomnote: 31,
  breakout: 22,
  scanlock: 26,
  glassslab: 38,
  magnetapex: 16,
  starfield: 24,
  possess: 33,
  mirrormerge: 30,
  ironbrand: 28,
  doppler: 28,
};

function sceneHeroXY(setpiece, fontPx) {
  const exX = theme.hero && theme.hero.x,
    exY = theme.hero && theme.hero.y;
  let x = exX ?? null,
    y = exY ?? null;
  if (x == null && sz && sz.heroAnchor && sz.heroAnchor.centerXPct != null)
    x = (W * sz.heroAnchor.centerXPct) / 100;
  if (x == null) x = dna.hero.x ?? W / 2;
  if (y == null && sz && sz.heroBands && Array.isArray(sz.heroBands.profile)) {
    const pref = SETPIECE_PREF_TOP[setpiece] ?? 28;
    const ok = sz.heroBands.profile.filter((b) => b.occPct >= 18 && b.occPct <= 55);
    const pool = ok.length ? ok : sz.heroBands.profile;
    const best = pool.reduce((a, b) =>
      Math.abs(b.topPct - pref) < Math.abs(a.topPct - pref) ? b : a,
    );
    y = (H * best.topPct) / 100 + fontPx * 0.55; // band top → glyph center
  }
  if (y == null) y = dna.hero.y ?? H * 0.37;
  return { x: Math.round(x), y: Math.round(y) };
}

// width-fit: hero font size from the actual word (never overflow, never timid)
function fitHeroPx(text, basePx, emPerChar, maxFrac) {
  const est = (px) => text.length * emPerChar * px;
  let px = basePx;
  const maxW = W * (maxFrac || 0.92);
  if (est(px) > maxW) px = Math.floor(maxW / (text.length * emPerChar));
  // short words: allow growth toward the poster fill, capped — except in the
  // calm register, where the DNA base size IS the ceiling (quiet briefs got a
  // 188px hero from this growth in the cold-start E2E)
  else if (est(px) < W * 0.55 && dna.register !== "calm")
    px = Math.min(Math.floor(maxW / (text.length * emPerChar)), Math.round(basePx * 1.25));
  return Math.max(64, px);
}

// clearer side for docked furniture (panel / poem): away from the subject
const CLEARER = (sz && sz.subject && sz.subject.clearerSide) || "left";

// ---------- measured glyph metrics (assets/fonts/char-widths.json) ----------
// Per-char advance widths (em) + fontBoundingBox ascent/descent for every
// bundled family, measured once in headless Chrome over the SAME woff2 faces
// the renderer embeds. Lets a paradigm BAKE pixel-exact word geometry at
// compile time (beam aim, flare centers) so font-load timing in the render
// browser can never skew it (kerning ignored: ≤3px/word vs ground truth).
const CHARW = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SKILL, "assets/fonts/char-widths.json"), "utf8"));
  } catch {
    return null;
  }
})();
function famMetrics(fam) {
  return (CHARW && CHARW[fam]) || null;
}
function wordPx(text, fam, px, lsEm) {
  const m = famMetrics(fam);
  if (!m) console.error(`[make-theme] WARN no measured widths for "${fam}" -> 0.6em/char estimate`);
  const adv = m
    ? [...text].reduce((a, c) => a + (m.widths[c] ?? m.widths["0"] ?? 0.6), 0)
    : text.length * 0.6;
  return adv * px + (lsEm || 0) * px * text.length;
}

// ---------- word timing: sequential matcher (verbatim completeness) ----------
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const tWords = transcript.words.map((w) => ({
  text: w.text ?? w.word,
  start: w.start,
  end: w.end,
  used: false,
}));
let cursor = 0;
function takeWord(authored) {
  const target = norm(authored);
  for (let i = cursor; i < Math.min(cursor + 3, tWords.length); i++) {
    if (norm(tWords[i].text) === target) {
      if (tWords[i].used)
        throw new Error(
          `[make-theme] "${authored}" is already claimed by hero.match — embed setpieces own the hero word: leave it OUT of lines (rail↔climax hand-off)`,
        );
      tWords[i].used = true;
      cursor = i + 1;
      return tWords[i];
    }
  }
  throw new Error(
    `[make-theme] cannot match authored word "${authored}" near transcript position ${cursor} ("${(tWords[cursor] || {}).text}") — lines must follow transcript order verbatim`,
  );
}

// hero phrase: located independently in the transcript (it may sit between lines)
function findPhrase(phrase) {
  const parts = phrase.trim().split(/\s+/).map(norm);
  for (let i = 0; i <= tWords.length - parts.length; i++) {
    if (parts.every((p, k) => norm(tWords[i + k].text) === p)) {
      return {
        start: tWords[i].start,
        end: tWords[i + parts.length - 1].end,
        idx: i,
        len: parts.length,
      };
    }
  }
  throw new Error(`[make-theme] hero phrase "${phrase}" not found in transcript`);
}
const heroInline = !!dna.hero.inline;
// theme.hero is OPTIONAL: a heroless theme runs pure-body (the right authoring
// for quiet briefs — "quiet / every word must read" wants no setpiece at all).
const HEROLESS = !theme.hero;
if (HEROLESS) theme.hero = {};
const hero = theme.hero.match ? findPhrase(theme.hero.match) : null;
if (!hero && !HEROLESS)
  throw new Error(
    "[make-theme] theme.json requires hero:{match} (omit hero entirely for a quiet pure-body run)",
  );
const heroText = (theme.hero.text || theme.hero.match || "").toUpperCase();
const heroDisplay = theme.hero.text || theme.hero.match; // case preserved for drawon/assembly

// mark hero transcript words as consumed when the setpiece is EMBED (not inline):
// the rail/panel/poem must NOT contain them (rail↔climax hand-off), except panel
// with redact linkage (panel shows them redacted — author includes them).
const redactLinkage = (dna.linkages || []).includes("redact-until-hero");
if (!heroInline && !HEROLESS && !redactLinkage) {
  for (let k = 0; k < hero.len; k++) tWords[hero.idx + k].used = true;
}

// resolve lines: every entry gets word objects with timings + role flags
const minors = new Set((theme.minors || []).map(norm));
const LINES = (theme.lines || []).map((arr, li) => {
  const words = arr.map((a) => {
    const tw = takeWord(a);
    return {
      display: a,
      start: tw.start,
      end: tw.end,
      minor: minors.has(norm(a)),
      isHero:
        !!hero &&
        norm(a) === norm((theme.hero.match || "").split(/\s+/)[0]) &&
        tw.start >= hero.start - 0.01 &&
        tw.start <= hero.end + 0.01,
    };
  });
  return { id: li, words };
});
// completeness gate
const unused = tWords.filter((w) => !w.used);
if (unused.length)
  throw new Error(
    `[make-theme] transcript words not covered by lines/hero: ${unused.map((w) => w.text).join(" ")}`,
  );

// per-line windows
LINES.forEach((L, i) => {
  L.in = L.words[0].start - 0.02;
  L.out = i + 1 < LINES.length ? LINES[i + 1].words[0].start - 0.02 : DUR - 0.1;
});
const LASTWORD = LINES[LINES.length - 1].words[LINES[LINES.length - 1].words.length - 1];

// hero window: onset → bounded hold (maxHold; 0 = to clip end — neonsign's
// lit-sign design). Unbounded default holds turned short clips into wallpaper.
const heroIn = hero ? hero.start : -999;
const MAXHOLD = dna.hero.maxHold ?? 3.2;
const heroOut = hero
  ? Math.min(DUR - 0.06, theme.hero.out ?? (MAXHOLD > 0 ? heroIn + MAXHOLD : DUR - 0.1))
  : -999;

// ---------- hero geometry: scene-aware position + width-fit size (computed ONCE,
// shared by the setpiece and the front fx so flash/rings/sparks stay centered) ----
const HG = { x: dna.hero.x ?? W / 2, y: dna.hero.y ?? H * 0.37, fontPx: dna.hero.fontPx || 178 };
if (!heroInline && !HEROLESS) {
  if (dna.hero.setpiece === "detonation") {
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 178, 0.56, 0.92);
    Object.assign(HG, sceneHeroXY("detonation", HG.fontPx));
    HG.halfW = (heroText.length * 0.56 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "decode") {
    const units = [...heroText].reduce((a, c) => a + (c === " " ? 0.38 : 0.82), 0);
    HG.fontPx = Math.min(dna.hero.fontPx || 112, Math.floor((W * 0.94) / units));
    Object.assign(HG, sceneHeroXY("decode", HG.fontPx));
    HG.halfW = (units * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "drawon") {
    Object.assign(HG, sceneHeroXY("drawon", 130));
    HG.halfW = Math.min(dna.hero.params.targetWidth || 640, W - 200) / 2;
  } else if (dna.hero.setpiece === "cpslam") {
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 168, 0.56, 0.9);
    Object.assign(HG, sceneHeroXY("cpslam", HG.fontPx));
    HG.halfW = (heroText.length * 0.56 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "settle") {
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 150, 0.58, 0.9);
    Object.assign(HG, sceneHeroXY("settle", HG.fontPx));
    HG.halfW = (heroText.length * 0.58 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "starfield") {
    // STARFIELD: the hero word condenses in WITHIN constellation linework (demo:
    // Cormorant Garamond italic 150px "stars"). Width-fit from the measured
    // italic advance; gold stars + connecting hairlines span the word rect, so
    // the geometry must be metric-exact (the star anchors derive from halfW).
    const gsDisp = heroDisplay.toLowerCase();
    const em1 = wordPx(gsDisp, dna.fonts.hero, 1, 0.05) || gsDisp.length * 0.48;
    HG.fontPx = Math.min(dna.hero.fontPx || 150, Math.floor((W * 0.62) / em1));
    Object.assign(HG, sceneHeroXY("starfield", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.starDisp = gsDisp;
  } else if (dna.hero.setpiece === "mirrormerge") {
    // MIRRORMERGE: 4 rotated ghost copies of the hero word converge into one
    // sharp Bodoni word over a black-mirror floor, a grand reflection emerges
    // below (demo: Bodoni Moda 700 84px, letter-spacing 0.03em). The floor
    // hairline, light streak and reflection mask all derive from the word rect,
    // so the em width must be metric-exact (the rotated ghosts overshoot ×1.2).
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.03) || heroText.length * 0.56;
    HG.fontPx = Math.min(dna.hero.fontPx || 130, Math.floor((W * 0.9) / (em1 * 1.2)));
    Object.assign(HG, sceneHeroXY("mirrormerge", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
    HG.wordW = Math.round(em1 * HG.fontPx);
  } else if (dna.hero.setpiece === "flapboard") {
    // one flap tile per char; tile geometry derives from fontPx (demo ratio
    // 100px tile @ 138px Anton), width-fit shrinks both together
    const gap = dna.hero.params.gap || 7;
    const n = heroText.length;
    let fpx = dna.hero.fontPx || 138;
    let tw = Math.round(fpx * 0.725);
    const fitW = W * 0.94 - 40 - (n - 1) * gap;
    if (n * tw > fitW) {
      tw = Math.floor(fitW / n);
      fpx = Math.round(tw / 0.725);
    }
    HG.fontPx = fpx;
    Object.assign(HG, sceneHeroXY("flapboard", fpx));
    HG.tileW = tw;
    HG.tileH = Math.round(tw * 1.48);
    HG.halfW = (n * tw + (n - 1) * gap + 40) / 2;
  } else if (dna.hero.setpiece === "ledwipe") {
    // LED transit panel: the word lights inside a fixed departure-board panel
    // (demo 1080×232 @ 120px VT323 ≈ 0.50em/char incl tracking) — width-fit
    // shrinks the type, never the panel; panel height derives from the type
    const panelW = Math.min(dna.hero.params.panelW || 1080, W - 120);
    const units = heroText.length * 0.5;
    HG.fontPx = Math.min(dna.hero.fontPx || 120, Math.floor((panelW - 80) / units));
    Object.assign(HG, sceneHeroXY("ledwipe", HG.fontPx));
    HG.panelW = panelW;
    HG.panelH = 44 + Math.round(HG.fontPx * 1.42) + 18;
    HG.halfW = panelW / 2;
  } else if (dna.hero.setpiece === "vhsosd") {
    // camcorder OSD readout (demo: VT323 150px ≈ 0.47em/char incl 0.02em tracking)
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 150, 0.47, 0.92);
    Object.assign(HG, sceneHeroXY("vhsosd", HG.fontPx));
    HG.halfW = (heroText.length * 0.47 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "bossintro") {
    // 8-bit boss word (demo: Press Start 2P 84px ≈ 1.0em/char); the pixel-block
    // matrix derives from the word rect (cell 0.7×/0.5× fontPx, ~50px side pad)
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 84, 1.0, 0.92);
    Object.assign(HG, sceneHeroXY("bossintro", HG.fontPx));
    HG.halfW = (heroText.length * 1.0 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "rubberstamp") {
    // bordered rubber-stamp face (demo: Special Elite 120px REMARKABLE ≈
    // 0.60em/char + 0.015em tracking); the face adds padding + border that
    // scale with fontPx (80px + 12px at the demo size)
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 120, 0.615, 0.86);
    Object.assign(HG, sceneHeroXY("rubberstamp", HG.fontPx));
    HG.halfW = (heroText.length * 0.615 * HG.fontPx + (92 * HG.fontPx) / 120) / 2;
  } else if (dna.hero.setpiece === "lasercage") {
    // beam-cage word (demo: Audiowide 100px): exact em width from the measured
    // char table — the converging beams, cage lines and glow stack all derive
    // from the word rect, so the fit must not guess
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.02) || heroText.length * 0.8;
    HG.fontPx = Math.min(dna.hero.fontPx || 100, Math.floor((W * 0.9) / em1));
    Object.assign(HG, sceneHeroXY("lasercage", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "boltstrike") {
    // storm slam (demo: Anton 145px REMARKABLE): exact em width from the
    // measured char table — the bolt offsets, word scrim and ozone glow all
    // derive from the word rect (demo rect: 720×145 → halfW 360)
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.012) || heroText.length * 0.56;
    HG.fontPx = Math.min(dna.hero.fontPx || 145, Math.floor((W * 0.92) / em1));
    Object.assign(HG, sceneHeroXY("boltstrike", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "holoboot") {
    // volumetric projection word (demo: Orbitron 700 118px, letter-spacing 0):
    // exact em width from the measured char table — the projection cone, seed
    // beam, emitter dot and scrim all derive from the word rect
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0) || heroText.length * 0.8;
    HG.fontPx = Math.min(dna.hero.fontPx || 118, Math.floor((W * 0.9) / em1));
    Object.assign(HG, sceneHeroXY("holoboot", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "biobloom") {
    // abyss bloom word (demo: Fredoka 700 120px RECOVER, 0.01em tracking):
    // exact em width from the measured char table — the tendril anchors,
    // pocket scrim, pre-glow and spill all derive from the word rect
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.01) || heroText.length * 0.66;
    HG.fontPx = Math.min(dna.hero.fontPx || 120, Math.floor((W * 0.9) / em1));
    Object.assign(HG, sceneHeroXY("biobloom", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "silkribbon") {
    // silk ribbon draw-on (demo: HersheyScript "recover" w=880 on a 1010×280
    // canvas, ink center ≈ canvas center): the canvas, aurora-gradient span
    // and spill all derive from targetWidth; 115 ≈ the ribbon's ink height
    // (sky band top → ribbon center, same registration as the demo)
    Object.assign(HG, sceneHeroXY("silkribbon", 115));
    HG.ribbonW = Math.min(dna.hero.params.targetWidth || 880, W - 240);
    HG.halfW = (HG.ribbonW + 130) / 2;
  } else if (dna.hero.setpiece === "scopetrace") {
    // phosphor trace word (demo: HersheyScript "pixel size" ≈705px ink, ink
    // center ≈ baseline − 28): the surge column, flatline flash, spill and
    // write window all derive from targetWidth; 115 ≈ the trace's ink height
    Object.assign(HG, sceneHeroXY("scopetrace", 115));
    HG.traceW = Math.min(dna.hero.params.targetWidth || 720, W - 200);
    HG.halfW = (HG.traceW + 50) / 2;
  } else if (dna.hero.setpiece === "scanlock") {
    // monospaced scan readout (demo: Orbitron 700 "PIXEL SIZE" — 95px char cell,
    // 56px space cell @ 116px). Cells scale with fontPx (demo ratios 0.819/0.483),
    // width-fit shrinks the whole readout; the bracket frame + loupe ring + edge
    // lines all derive from the readout rect.
    const p = dna.hero.params || {};
    const chR = p.charEm ?? 0.819,
      spR = p.spaceEm ?? 0.483;
    const cells = [...heroText].reduce((a, c) => a + (c === " " ? spR : chR), 0);
    HG.fontPx = Math.min(dna.hero.fontPx || 116, Math.floor((W * 0.86) / cells));
    Object.assign(HG, sceneHeroXY("scanlock", HG.fontPx));
    HG.chW = Math.round(HG.fontPx * chR);
    HG.spW = Math.round(HG.fontPx * spR);
    HG.totalW = [...heroText].reduce((a, c) => a + (c === " " ? HG.spW : HG.chW), 0);
    HG.halfW = HG.totalW / 2;
  } else if (dna.hero.setpiece === "papermat") {
    // torn-paper letter chips glued on a kraft mat (demo: Anton 130px ink on
    // 118×170 chips, pitch tileW+14, mat N*pitch+80 wide × 240 tall): chip
    // geometry derives from fontPx (demo ratios), width-fit shrinks both
    const n = heroText.length;
    let fpx = dna.hero.fontPx || 130;
    let tw = Math.round(fpx * 0.91);
    const fitW = W * 0.94 - 80 - n * 14;
    if (n * tw > fitW) {
      tw = Math.floor(fitW / n);
      fpx = Math.round(tw / 0.91);
    }
    HG.fontPx = fpx;
    Object.assign(HG, sceneHeroXY("papermat", fpx));
    HG.tileW = tw;
    HG.tileH = Math.round(fpx * 1.31);
    HG.pitch = tw + 14;
    HG.matW = n * HG.pitch + 80;
    HG.matH = Math.round(fpx * 1.846);
    HG.halfW = HG.matW / 2;
  } else if (dna.hero.setpiece === "centerfold") {
    // pop-up book centerfold (demo: Baloo 2 800 120px STARS over a 12-point
    // paper starburst, outer R 220 ≈ 0.59×wordW, box 620×560 = 2R+180 × 2R+fontPx):
    // the bursts, blob shadow, struts and the confetti hinge all derive from
    // the word rect; width-fit shrinks the type, the burst follows the word
    // but is capped so the unfold stays inside the frame
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.02) || heroText.length * 0.62;
    HG.fontPx = Math.min(dna.hero.fontPx || 120, Math.floor((W * 0.5) / em1));
    Object.assign(HG, sceneHeroXY("centerfold", HG.fontPx));
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.burstR = Math.round(Math.min(Math.max(1.83 * HG.fontPx, 0.59 * HG.wordW), H * 0.42));
    HG.boxW = Math.max(2 * HG.burstR + 180, HG.wordW + 24);
    HG.boxH = 2 * HG.burstR + HG.fontPx;
    HG.halfW = HG.boxW / 2;
  } else if (dna.hero.setpiece === "chalkwrite") {
    // hand-written chalk word (demo: HersheyScript "remarkable" ≈860px ink,
    // ink 130 tall, ink CENTER on HG.y): the writing starts at the board's
    // LEFT margin — a hand writes from the left, never centered on the
    // subject — so x derives from the body strip, not the hero anchor; the
    // stroke path is parsed at compile time inside the setpiece and the
    // board rect / underlines / fg dust clap all register on the measured
    // ink box. 130 ≈ the chalk ink height (band top → ink center).
    const stripW9 = (dna.body.strip && dna.body.strip.w) || 1200;
    const SX9 = (dna.body.strip && dna.body.strip.x) ?? Math.round((W - stripW9) / 2);
    HG.chalkW = Math.min(dna.hero.params.targetWidth || 860, stripW9 - 28);
    HG.fontPx = 130;
    Object.assign(HG, sceneHeroXY("chalkwrite", 130));
    if ((theme.hero && theme.hero.x) == null) HG.x = SX9 + 12 + Math.round(HG.chalkW / 2);
    HG.halfW = Math.round(HG.chalkW / 2);
  } else if (dna.hero.setpiece === "spraytag") {
    // spray-painted tag (demo: HersheyScript "recover" w=1000 → ink ≈1010×120,
    // ink center (646,252)): the tag CENTERS on the hero anchor in the sky
    // band — crossing the subject silhouette is the point; the stroke path is
    // parsed at compile time inside the setpiece, which registers the
    // pen-finish point on HG for the fg paint splat (fx.paintsplat). 120 ≈ the
    // tag's ink height (band top → ink center); halfW adds the halo overspray.
    HG.sprayW = Math.min(dna.hero.params.targetWidth || 1000, W - 140);
    HG.fontPx = 120;
    Object.assign(HG, sceneHeroXY("spraytag", 120));
    HG.halfW = Math.round(HG.sprayW / 2) + 30;
  } else if (dna.hero.setpiece === "brushwrite") {
    // sumi-e gesture (demo: HersheyScript "remarkable" w=760 → ink ≈760×115,
    // ink center (863,202)): the gesture CENTERS on the hero anchor in the sky
    // band — crossing the subject silhouette is the point; the stroke path is
    // parsed at compile time inside the setpiece, which registers the
    // pen-START point on HG for the fg ink flecks (fx.brushflecks). 120 ≈ the
    // gesture's ink height (band top → ink center); halfW adds spatter margin.
    HG.brushW = Math.min(dna.hero.params.targetWidth || 760, W - 240);
    HG.fontPx = 120;
    Object.assign(HG, sceneHeroXY("brushwrite", 120));
    HG.halfW = Math.round(HG.brushW / 2) + 40;
  } else if (dna.hero.setpiece === "plotterdraw") {
    // technical-drawing plotter (demo: HersheyScript "remarkable" w=960 → ink
    // ≈960×145, ink center ≈ baseline−73): the word PLOTS in the upper sky
    // band, crossing the subject silhouette — same draw-on family as
    // chalkwrite/brushwrite, but a thin white pen line + square nib over a
    // cyanotype scrim + drafting grid. The stroke path is parsed at compile
    // time inside the setpiece, which registers the measured ink box so the
    // hatch-fill rect, registration crosses and the REV chip stamp all derive
    // from it. 130 ≈ the plot's ink height (sky-band top → ink center).
    HG.plotW = Math.min(dna.hero.params.targetWidth || 960, W - 200);
    HG.fontPx = 130;
    Object.assign(HG, sceneHeroXY("plotterdraw", 130));
    HG.halfW = Math.round(HG.plotW / 2) + 30;
  } else if (dna.hero.setpiece === "inkbloom") {
    // sumi drop in still water (demo: Shippori Mincho 700 132px "pixel size.",
    // 0.02em tracking, case preserved): exact em width from the measured char
    // table — the blob stack, ripple rings and wisp anchors all derive from
    // the word rect (kx/ky scale units inside the setpiece)
    const em1 = wordPx(heroDisplay, dna.fonts.hero, 1, 0.02) || heroDisplay.length * 0.5;
    HG.fontPx = Math.min(dna.hero.fontPx || 132, Math.floor((W * 0.9) / em1));
    Object.assign(HG, sceneHeroXY("inkbloom", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
  } else if (dna.hero.setpiece === "ransomnote") {
    // ransom-note letter chips (demo: 10 chips, 4 recipes/fonts cycled, base
    // 130px with seeded ±13% sizes): width-fit uses the measured advance of
    // each glyph IN ITS OWN recipe font + 0.20em chip padding + 6px margins,
    // so the crooked collage never overflows the frame
    const fams4 = [dna.fonts.body, dna.fonts.dark, dna.fonts.news, dna.fonts.accent];
    let k4 = 0;
    const em1 = [...heroText].reduce((a, c) => {
      if (c === " ") return a + 0.3;
      const fam = fams4[k4++ % 4];
      return a + (famMetrics(fam) ? wordPx(c, fam, 1, 0) : 0.62) + 0.2;
    }, 0);
    const n = heroText.length;
    HG.fontPx = Math.min(dna.hero.fontPx || 130, Math.floor((W * 0.92 - n * 6) / em1));
    Object.assign(HG, sceneHeroXY("ransomnote", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx + n * 6) / 2;
  } else if (dna.hero.setpiece === "breakaway") {
    // BREAKING banner (demo: Anton 110px REMARKABLE ≈ 0.55em/char + 0.02em
    // tracking) on a fixed lower-third red banner — NOT scene-derived: a chyron
    // banner is always pinned to the bottom, never floated behind the subject.
    // The banner geometry is fixed (full width); only the word type width-fits.
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.02) || heroText.length * 0.57;
    HG.fontPx = Math.min(dna.hero.fontPx || 110, Math.floor((W * 0.86) / em1));
    HG.halfW = (em1 * HG.fontPx) / 2;
    HG.x = W / 2;
    HG.bannerH = dna.hero.params.bannerH || 140;
    HG.bannerTop =
      H - (dna.body.barH || 68) - ((dna.body.ticker && dna.body.ticker.h) || 32) - HG.bannerH;
    HG.y = HG.bannerTop + Math.round(HG.bannerH * 0.7); // word baseline-ish inside banner
  } else if (dna.hero.setpiece === "coverword") {
    // metric-exact fit from the replica font's advance widths (logo case:
    // first letter upper, rest lower — the official mark's own arrangement)
    const CPM = JSON.parse(
      fs.readFileSync(path.join(SKILL, "assets/brand/cyberpunk-widths.json"), "utf8"),
    );
    const disp = heroText[0].toUpperCase() + heroText.slice(1).toLowerCase();
    const bad = [...disp].filter((c) => !(c in CPM.widths));
    if (bad.length)
      throw new Error(
        `[make-theme] coverword: no replica glyph for ${JSON.stringify(bad)} in "${heroText}" — pick a hero without digits/special chars or use hero.text`,
      );
    const em = [...disp].reduce((a, c) => a + CPM.widths[c], 0) + 0.01 * (disp.length - 1);
    // glyph ink is small inside the em box (x-height ~0.3em) -> size by INK:
    // dna fontPx = target ink height in px, not nominal font-size
    const inkTop = Math.max(...[...disp].map((c) => (CPM.bounds[c] || [0, 0, 0, 0.5])[3]));
    const inkBot = Math.min(...[...disp].map((c) => (CPM.bounds[c] || [0, -0.1, 0, 0])[1]));
    const inkH = inkTop - inkBot;
    HG.fontPx = Math.round(Math.min((dna.hero.fontPx || 150) / inkH, (W * 0.84) / em));
    Object.assign(HG, sceneHeroXY("coverword", Math.round(HG.fontPx * inkH)));
    HG.halfW = (em * HG.fontPx) / 2 + 0.9 * HG.fontPx;
    HG.coverEm = em;
    HG.coverDisp = disp;
    HG.coverInk = { inkTop, inkBot, inkH };
  } else if (dna.hero.setpiece === "breakout") {
    // market breakout (demo: Anton 140px REMARKABLE ≈ 0.55em/char + 0.01em
    // tracking): exact em width from the measured char table — the candle spike,
    // level lines, odometer and underglow all register on the word rect. The
    // word slams at the TOP of a green spike that rockets up the full frame, so
    // y is biased HIGH (the climax happens above the subject, the spike crosses
    // the silhouette on its way up).
    const em1 = wordPx(heroText, dna.fonts.hero, 1, 0.01) || heroText.length * 0.56;
    HG.fontPx = Math.min(dna.hero.fontPx || 140, Math.floor((W * 0.9) / em1));
    Object.assign(HG, sceneHeroXY("breakout", HG.fontPx));
    HG.halfW = (em1 * HG.fontPx) / 2;
    // bias the word block toward the clearer side: the breakout event lives in
    // the open sky, the subject keeps its side (demo: word left, subject right).
    // Only shift when x wasn't explicitly authored and the word is wide enough
    // that the subject-centered anchor would push the tail off-frame.
    if ((theme.hero && theme.hero.x) == null && HG.halfW > W * 0.26) {
      const margin = 40;
      HG.x =
        CLEARER === "right"
          ? Math.min(W - margin - HG.halfW, HG.x)
          : Math.max(margin + HG.halfW, Math.min(HG.x, W * 0.47));
      HG.x = Math.round(HG.x);
    }
  } else if (dna.hero.setpiece === "glassslab") {
    // frosted-glass slab (demo: Sora 800 90px "REMARKABLE" on a 790×196 slab,
    // 0.012em tracking, slab center behind the subject): the word width-fits,
    // the slab is the word rect + generous horizontal padding (demo slab
    // ≈ wordW + 230) and a fixed-ratio height (demo 196 ≈ 2.18×fontPx). The
    // flying shards, rim, edge lights, glint mask and crack SVG all derive
    // from the slab rect, so the fit must be measured, not guessed.
    const gsDisp =
      (dna.hero.params || {}).case === "preserve" ? heroDisplay : heroText.toUpperCase();
    const em1 =
      wordPx(gsDisp, dna.fonts.hero, 1, dna.hero.params.tracking ?? 0.012) || gsDisp.length * 0.62;
    HG.fontPx = Math.min(dna.hero.fontPx || 90, Math.floor((W * 0.62) / em1));
    Object.assign(HG, sceneHeroXY("glassslab", HG.fontPx));
    // the slab is a wide surface that wants to sit BEHIND the subject (20-50%
    // occlusion); the DNA anchor (subject-side) takes precedence over the
    // occlusion-band auto-pick when set, since a thin band reads centered
    if ((theme.hero && theme.hero.x) == null && dna.hero.x != null) HG.x = dna.hero.x;
    if ((theme.hero && theme.hero.y) == null && dna.hero.y != null) HG.y = dna.hero.y;
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.slabW = Math.min(HG.wordW + (dna.hero.params.padX ?? 155), W - 80);
    HG.slabH = Math.round(HG.fontPx * (dna.hero.params.heightRatio ?? 2.18));
    HG.halfW = HG.slabW / 2;
  } else if (dna.hero.setpiece === "masthead") {
    // magazine-cover masthead: the word sets ACROSS THE TOP of frame behind the
    // subject's head (classic cover occlusion). Width-fit to a wide masthead;
    // position is a fixed top band (Bodoni Moda ≈ 0.58em/char + 0.045em tracking).
    HG.fontPx = fitHeroPx(heroText, dna.hero.fontPx || 148, 0.62, 0.94);
    HG.x = dna.hero.x ?? W / 2;
    HG.y = dna.hero.y ?? 172; // center y of the masthead band
    HG.halfW = (heroText.length * 0.62 * HG.fontPx) / 2;
    HG.mastTop = true;
  } else if (dna.hero.setpiece === "magnetapex") {
    // letter-magnet word (demo: Anton 100px, chip 78×124, slot step 82 → the
    // chip rect + slot stride are fixed ratios of the type so width-fit shrinks
    // them together). Width-fit the whole magnet ROW to ≤94% of frame.
    const p = dna.hero.params || {};
    const disp = (p.case === "preserve" ? heroDisplay : heroText).toUpperCase();
    const n = disp.length;
    const stepEm = p.slotStepEm ?? 0.82;
    let fpx = dna.hero.fontPx || 100;
    const fitW = W * 0.94;
    if (n * stepEm * fpx > fitW) fpx = Math.floor(fitW / (n * stepEm));
    HG.fontPx = Math.max(48, fpx);
    Object.assign(HG, sceneHeroXY("magnetapex", HG.fontPx));
    HG.chipW = Math.round(HG.fontPx * (p.chipWEm ?? 0.78));
    HG.chipH = Math.round(HG.fontPx * (p.chipHEm ?? 1.24));
    HG.slotStep = Math.round(HG.fontPx * stepEm);
    HG.halfW = (n * HG.slotStep) / 2;
  } else if (dna.hero.setpiece === "possess") {
    // POSSESS: the apex word MANIFESTS behind the subject in Creepster (demo
    // 140px "REMARKABLE", 0.025em tracking). Width-fit from the measured advance
    // (the squash overshoots ×1.12, so keep the rest of frame margin). Sits
    // slightly left-of-center, partially occluded by the seated subject.
    const p = dna.hero.params || {};
    const gsDisp = heroText.toUpperCase();
    const trk = p.tracking ?? 0.025;
    const em1 = wordPx(gsDisp, dna.fonts.hero, 1, trk) || gsDisp.length * 0.55;
    HG.fontPx = Math.min(dna.hero.fontPx || 140, Math.floor((W * 0.86) / em1));
    Object.assign(HG, sceneHeroXY("possess", HG.fontPx));
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.halfW = HG.wordW / 2;
  } else if (dna.hero.setpiece === "doppler") {
    // DOPPLER: the apex word arrives as a speck at a vanishing point and
    // ACCELERATES across the frame into a full italic slab (demo: Teko italic
    // 600 150px "REMARKABLE", 0.02em tracking). Width-fit from the measured
    // advance — the transit overshoots ×1.16 on contact squash, and the heat
    // trail / headlight glow all register on the word rect, so the em must be
    // metric-exact (keep margin for the squash overshoot ×1.16).
    const p = dna.hero.params || {};
    const trk = p.tracking ?? 0.02;
    const em1 = wordPx(heroText, dna.fonts.hero, 1, trk) || heroText.length * 0.46;
    HG.fontPx = Math.min(dna.hero.fontPx || 150, Math.floor((W * 0.9) / (em1 * 1.16)));
    Object.assign(HG, sceneHeroXY("doppler", HG.fontPx));
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.halfW = HG.wordW / 2;
  } else if (dna.hero.setpiece === "ironbrand") {
    // IRONBRAND: the apex word slams behind the subject as a branding iron (demo:
    // Cinzel 700 124px "REMARKABLE", 0.03em tracking). Width-fit from the measured
    // advance — the slam crush overshoots ×3.1 then settles, and the scorch radial
    // / charred stroke outlines all derive from the word rect, so the em must be
    // metric-exact (keep margin for the squash overshoot ×1.10).
    const p = dna.hero.params || {};
    const trk = p.tracking ?? 0.03;
    const em1 = wordPx(heroText, dna.fonts.hero, 1, trk) || heroText.length * 0.62;
    HG.fontPx = Math.min(dna.hero.fontPx || 124, Math.floor((W * 0.88) / (em1 * 1.1)));
    Object.assign(HG, sceneHeroXY("ironbrand", HG.fontPx));
    HG.wordW = Math.round(em1 * HG.fontPx);
    HG.halfW = HG.wordW / 2;
  }
  // keep the word on frame (when wider than the frame, CENTER it — an inverted
  // Math.max/Math.min clamp would silently pin to the lower bound off-center)
  if (HG.halfW)
    HG.x =
      2 * HG.halfW + 24 > W ? W / 2 : Math.max(HG.halfW + 12, Math.min(W - HG.halfW - 12, HG.x));
  // breakaway pins its banner to the lower third by design — never re-clamp y up;
  // masthead pins to a fixed top band by design — never re-clamp y down
  if (dna.hero.setpiece !== "breakaway" && dna.hero.setpiece !== "masthead")
    HG.y = Math.max(HG.fontPx * 0.55 + 8, Math.min(H * 0.62, HG.y));
}

// ---------- shared emit helpers ----------
const MULBERRY = `function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}}`;

// bundled @font-face subset for this DNA's families — the renderer only
// auto-supplies its canonical fonts; anything else silently falls back unless
// the page ships a local @font-face (same determinism contract as Cinematic).
const FONT_FACES = (() => {
  let css = "";
  try {
    css = fs.readFileSync(path.join(SKILL, "assets/fonts/fonts.css"), "utf8");
  } catch {
    return null;
  }
  return css
    .split("@font-face")
    .slice(1)
    .map((b) => "@font-face" + b.slice(0, b.indexOf("}") + 1));
})();
// per-page: embed only families this page's markup actually references
function fontCssFor(pageParts) {
  if (!FONT_FACES) return "";
  const fams = [...new Set(Object.values(dna.fonts || {}))].filter((f) => !/^Hiragino/.test(f));
  const out = [];
  for (const fam of fams) {
    if (!pageParts.includes(fam)) continue;
    // quote-agnostic: fonts.css has shipped with both 'single' and "double"
    // quoted family names (formatters flip them); a literal match silently
    // skipped EVERY embed and warned on bundled fonts.
    const famRe = new RegExp(
      `font-family\\s*:\\s*['"]` + fam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `['"]`,
    );
    const hits = FONT_FACES.filter((b) => famRe.test(b));
    if (!hits.length)
      console.error(
        `[make-theme] WARN font "${fam}" not in bundled fonts.css -> renderer fallback risk`,
      );
    out.push(...hits);
  }
  return out.join("\n");
}
const GSAP = `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`;

function bgSkeleton(stageHtml, css, js) {
  const FONT_CSS = fontCssFor(stageHtml + css);
  return `<!doctype html>
<!-- generated by make-theme.cjs — theme DNA "${dna.name}" (bg layer) -->
<html lang="en">
<head>
<meta charset="utf-8">
${GSAP}
<style>
${FONT_CSS}
  html, body { margin:0; padding:0; width:${W}px; height:${H}px; overflow:hidden; background:#000; }
  #root { position:relative; width:${W}px; height:${H}px; }
  #a-roll { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:1; }
  #stage { position:absolute; inset:0; z-index:2; }
${css}
</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}"
       data-width="${W}" data-height="${H}">
    <video id="a-roll" src="source.mp4" muted playsinline
           data-duration="${DUR}" data-track-index="0"></video>
    <div id="stage">
${stageHtml}
    </div>
    <audio id="a-roll-audio" src="source.mp4" data-start="0" data-duration="${DUR}"
           data-track-index="3" data-volume="1"></audio>
  </div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  const F = ${F};
  ${MULBERRY}
${js}
  tl.seek(0);
  window.__timelines["main"] = tl;
</script>
</body>
</html>`;
}

function fgSkeleton(stageHtml, css, js) {
  const FONT_CSS = fontCssFor(stageHtml + css);
  return `<!doctype html>
<!-- generated by make-theme.cjs — theme DNA "${dna.name}" (fg alpha layer) -->
<html lang="en">
<head>
<meta charset="utf-8">
${GSAP}
<style>
${FONT_CSS}
  html, body { margin:0; padding:0; width:${W}px; height:${H}px; overflow:hidden; background:transparent; }
  #root { position:relative; width:${W}px; height:${H}px; }
  #stage { position:absolute; inset:0; }
${css}
</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}"
       data-width="${W}" data-height="${H}">
    <div id="stage">
${stageHtml}
    </div>
  </div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  const F = ${F};
  ${MULBERRY}
${js}
  tl.seek(0);
  window.__timelines["main"] = tl;
</script>
</body>
</html>`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const J = JSON.stringify;
// hex (#rgb / #rrggbb) → rgba() string at the given alpha; an optional warm
// multiplier (>1) pushes the channels toward white for a hotter highlight tint
// (lets a doppler-family DNA derive its headlight/wash tints from one accent).
function hexA(hex, alpha = 1, warm = 1) {
  let s = String(hex).replace(/^#/, "");
  if (s.length === 3)
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  let r = parseInt(s.slice(0, 2), 16),
    g = parseInt(s.slice(2, 4), 16),
    b = parseInt(s.slice(4, 6), 16);
  if (warm !== 1) {
    const mix = (v) => Math.round(Math.min(255, v + (255 - v) * (warm - 1)));
    r = mix(r);
    g = mix(g);
    b = mix(b);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

/* =====================================================================
 * BODY PARADIGMS — each returns { css, html, js } for the fg (or bg) file
 * ===================================================================== */

function paradigmRail() {
  const b = dna.body;
  const lineData = LINES.map((L) => ({
    id: "r" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const css = `
  .rail { position:absolute; left:${W / 2}px; top:${H - b.bottomPx}px; opacity:0; white-space:nowrap;
          font-family:'${dna.fonts.body}', sans-serif; font-size:${b.fontPx}px; line-height:1;
          letter-spacing:${b.letterSpacing || "0.02em"}; color:${dna.palette.body};
          ${b.textTransform ? "text-transform:" + b.textTransform + ";" : ""}
          text-shadow: ${b.glow || "0 3px 14px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5)"}; }
  .rail .w { display:inline-block; opacity:0; margin:0 0.14em; }
  .rail .w.minor { font-size:${Math.round(b.fontPx * (b.minorScale || 1.4))}px; }
  .rail .w.em { color:${dna.palette.em || dna.palette.accent}; font-weight:700; }
  ${
    b.rule
      ? `#rrule { position:absolute; left:${W / 2}px; top:${H - b.bottomPx + 38}px; width:0; height:2px;
          background:${b.rule.color}; opacity:0.5; transform:translateX(-50%);
          box-shadow: 0 0 12px ${dna.palette.accent}; }`
      : ""
  }`;
  const html =
    lineData.map((L) => `      <div class="rail" id="${L.id}"></div>`).join("\n") +
    (b.rule ? `\n      <div id="rrule"></div>` : "");
  const stamp = b.entrance === "stamp";
  const boot = b.entrance === "bootflick";
  const fade = b.entrance === "fade";
  const js = `
  // ---- body paradigm: RAIL (${b.entrance} in / ${b.exit} out) ----
  const HOT = ${J(dna.palette.hot || dna.palette.accent)}, BONE = ${J(dna.palette.body)};
  const RAIL = ${J(lineData)};
  const rrnd = mulberry32(2026);
  RAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt,,minor]) => {
      const s = document.createElement("span");
      s.className = "w" + (minor ? (${J(stamp)} || ${J(boot)} ? " minor" : " em") : "");
      s.textContent = txt; line.appendChild(s);
    });
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    tl.set(line, { opacity: 1 }, L.in);
    const XO = L.out - ${b.exit === "drop" ? "0.18" : "0.17"};   // exit start (single source)
    let lastB = -1;                                              // line-y bounce ownership guard
    L.words.forEach(([txt, st, minor], wi) => {
      const el = line.children[wi];
${
  boot
    ? `      // BOOTFLICK: corrupted-cyan boot 1-2f -> settles to UI color
      tl.set(el, { opacity: 0.6, color: "#00F0FF", x: 2 }, st);
      if (rrnd() < 0.45) { tl.set(el, { opacity: 0.15, x: -2 }, st + F); tl.set(el, { opacity: 1, color: BONE, x: 0 }, st + 2 * F); }
      else { tl.set(el, { opacity: 1, color: BONE, x: 0 }, st + F); }
      if (minor) {
        tl.fromTo(el, { scale: 1.18 }, { scale: 1, duration: 0.25, ease: "power2.out" }, st + F);
        tl.set(el, { textShadow: "2px 0 0 #00F0FF, -2px 0 0 #FF003C, 0 2px 10px rgba(0,0,0,0.75)" }, st + 2 * F);
      }`
    : fade
      ? `      // FADE: 2-frame fade-up — the word simply reads (anchor register)
      tl.fromTo(el, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, st);
      if (minor) tl.fromTo(el, { scale: 1.07 }, { scale: 1, duration: 0.3, ease: "power2.out" }, st);`
      : stamp
        ? `      // STAMP: 1f appear oversized+hot, crush, recoil, cool to bone
      tl.set(el, { opacity: 1, scale: minor ? 2.1 : 1.28, color: HOT, transformOrigin: "50% 80%" }, st);
      tl.to(el, { scale: 1, duration: 0.11, ease: "power3.in" }, st + 0.01);
      tl.set(el, { scaleX: 1.05, scaleY: 0.95 }, st + 0.12);
      tl.to(el, { scaleX: 1, scaleY: 1, duration: 0.22, ease: "elastic.out(1, 0.45)" }, st + 0.16);
      tl.to(el, { color: minor ? ${J(dna.palette.minorCool || "#F2CFA0")} : BONE, duration: minor ? 0.6 : 0.32, ease: "power1.in" }, st + 0.15);
      if (st + 0.02 >= lastB && st + 0.24 <= XO) {   // one bounce owner at a time; none during exit
        tl.set(line, { y: minor ? 4 : 2 }, st + 0.02);
        tl.to(line, { y: 0, duration: 0.18, ease: "power2.out" }, st + 0.06);
        lastB = st + 0.24;
      }`
        : `      // FLICK: tube lights with seeded double-flicks
      tl.set(el, { opacity: 0.35 }, st);
      if (rrnd() < 0.35) { tl.set(el, { opacity: 0.08 }, st + F); tl.set(el, { opacity: 1 }, st + 2 * F); }
      else { tl.set(el, { opacity: 1 }, st + F); }
      if (minor) tl.fromTo(el, { scale: ${dna.body.emScale || 1.18} }, { scale: 1, duration: 0.3, ease: "power2.out" }, st + F);`
}
    });
${
  b.exit === "drop"
    ? `    // DROP exit (completes before the next line stamps)
    tl.to(line, { y: 34, opacity: 0, duration: 0.16, ease: "power2.in" }, XO);
    tl.set(line, { display: "none" }, XO + 0.18);`
    : b.exit === "fade"
      ? `    // FADE exit (quiet settle-down)
    tl.to(line, { opacity: 0, y: 6, duration: 0.15, ease: "power1.in" }, XO);
    tl.set(line, { display: "none" }, XO + 0.17);`
      : `    // POWERCUT exit (completes before the next line)
    tl.set(line, { opacity: 0.5 }, XO); tl.set(line, { opacity: 0.12 }, XO + F);
    tl.set(line, { opacity: 0 }, XO + 3 * F); tl.set(line, { display: "none" }, XO + 4 * F);`
}
  });
${
  b.rule
    ? `  tl.fromTo("#rrule", { width: 0, opacity: 0 }, { width: ${b.rule.width}, opacity: 0.5, duration: 0.4, ease: "power2.out" }, 0.25);
  tl.to("#rrule", { opacity: 0, duration: 0.3 }, ${(DUR - 0.2).toFixed(2)});`
    : ""
}
${
  b.yield
    ? `  // rail yields while the apex lands (furniture never contests the hero).
  // Overlap guards: dim starts after the line is IN, never runs into the exit;
  // restore is emitted only with clear runway before the exit (else the line
  // simply exits dimmed — never two owners of one opacity).
  RAIL.forEach((L) => {
    if (L.in < ${heroIn.toFixed(3)} + 0.9 && L.out > ${heroIn.toFixed(3)} - 0.3) {
      const XO2 = L.out - ${b.exit === "drop" ? "0.18" : "0.17"};
      const dimT = Math.max(${(heroIn - (b.yield.pre || 0.2)).toFixed(3)}, L.in + 0.05);
      if (XO2 > dimT + 0.25) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.2 }, dimT);
        const resT = ${(heroIn + (b.yield.post || 0.9)).toFixed(3)};
        if (resT + 0.3 < XO2) tl.to("#" + L.id, { opacity: 1, duration: 0.25 }, resT);
      }
    }
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmPanel() {
  const b = dna.body;
  const lockT =
    heroIn + 0.3 + (dna.hero.params.lockStagger || 0.045) * (heroText.length - 1) + 0.083;
  const lineData = LINES.map((L) => ({
    id: "ln" + L.id,
    words: L.words.map((w) => [
      w.display,
      +w.start.toFixed(3),
      // redaction: words inside the hero phrase window get blocks until lock
      redactLinkage && w.start >= hero.start - 0.01 && w.start <= hero.end + 0.01
        ? +lockT.toFixed(3)
        : 0,
    ]),
  }));
  const lineH = Math.round(b.fontPx * 1.35);
  const maxVis = Math.max(3, Math.floor((H * 0.48 - 60) / lineH));
  const dockCss = CLEARER === "right" ? `right:${b.panel.left}px;` : `left:${b.panel.left}px;`;
  const css = `
  #panel { position:absolute; ${dockCss} bottom:${b.panel.bottom}px; width:${b.panel.width}px;
           padding:18px 22px 22px; background:${dna.palette.panelBg};
           border:1px solid ${dna.palette.accent}59; border-radius:4px; opacity:0;
           box-shadow: 0 0 24px rgba(0,0,0,0.35), inset 0 0 60px ${dna.palette.accent}0a; }
  #panel .hd { font-family:'${dna.fonts.tag}', monospace; font-size:22px; color:${dna.palette.prompt};
               letter-spacing:2px; border-bottom:1px solid ${dna.palette.accent}40;
               padding-bottom:8px; margin-bottom:10px; }
  .ln { font-family:'${dna.fonts.body}', monospace; font-size:${b.fontPx}px; line-height:1.35;
        color:${dna.palette.body}; text-shadow: 0 0 8px ${dna.palette.accent}59;
        white-space:nowrap; opacity:0; }
  .ln .pr { color:${dna.palette.prompt}; margin-right:8px; }
  .ln .w { display:inline-block; overflow:hidden; vertical-align:bottom; white-space:nowrap;
           margin-right:0.3em; }
  .ln .red { color:#7adcff; }
  .caret { display:inline-block; width:14px; height:26px; background:${dna.palette.body};
           vertical-align:baseline; opacity:0; margin-left:4px; }
  #logclip { max-height:${maxVis * lineH}px; overflow:hidden; }
  #logwrap { position:relative; }`;
  const html = `      <div id="panel">
        <div class="hd">${esc(theme.panelHeader || "OBS-01 // " + (b.panel.header || "LOG_"))}</div>
        <div id="logclip"><div id="logwrap">
${lineData.map((L) => `        <div class="ln" id="${L.id}"></div>`).join("\n")}
        </div></div>
      </div>`;
  const js = `
  // ---- body paradigm: PANEL (typed console log, accumulate) ----
  tl.fromTo("#panel", { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out" }, 0.05);
${
  b.yield
    ? `  tl.to("#panel", { opacity: ${b.yield.dim}, duration: 0.25, ease: "power1.in" }, ${(heroIn - 0.08).toFixed(3)});
  tl.to("#panel", { opacity: 1, duration: 0.3, ease: "power1.out" }, ${(lockT + 0.15).toFixed(3)});`
    : ""
}
  const LOG = ${J(lineData)};
  const MAXVIS = ${maxVis}, LINEH = ${lineH};
  LOG.forEach((L, li) => {
    if (li >= MAXVIS) {  // terminal scroll: older rows slide up out of the clip
      tl.to("#logwrap", { y: -(li - MAXVIS + 1) * LINEH, duration: 0.28, ease: "power2.out" },
            L.words[0][1] - 0.10);
    }
    const line = document.getElementById(L.id);
    const p = document.createElement("span"); p.className = "pr"; p.textContent = "$";
    line.appendChild(p);
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.03);
    L.words.forEach(([txt, st, redUntil]) => {
      const wrap = document.createElement("span"); wrap.className = "w";
      const inner = document.createElement("span");
      inner.textContent = redUntil ? "█".repeat(Math.max(3, txt.length - 1)) : txt;
      wrap.appendChild(inner); line.appendChild(wrap);
      tl.fromTo(wrap, { width: 0 }, { width: "auto", duration: 0.12,
                ease: "steps(" + Math.max(2, txt.length) + ")" }, st);
      if (redUntil) {
        const real = document.createElement("span");
        real.textContent = txt; real.style.display = "none"; real.className = "red";
        wrap.appendChild(real);
        tl.set(inner, { display: "none" }, redUntil);
        tl.set(real, { display: "inline" }, redUntil);
      }
    });
${
  b.caret
    ? `    const c = document.createElement("span"); c.className = "caret"; line.appendChild(c);
    const lastEnd = L.words[L.words.length - 1][1] + 0.25;
    for (let bk = 0; bk < 4; bk++) tl.set(c, { opacity: bk % 2 === 0 ? 1 : 0 }, lastEnd + bk * 0.22);
    tl.set(c, { opacity: 0 }, lastEnd + 0.9);`
    : ""
}
  });
${
  (dna.linkages || []).includes("corrupt-on-last-word")
    ? `  // the feed corrupts on the final word
  const NZ = ${(LASTWORD.start + 0.04).toFixed(3)};
  [[3,0],[-4,1],[3,2],[-2,3],[0,4]].forEach(([dx, k]) => {
    tl.set("#panel", { x: dx, filter: dx ? "hue-rotate(" + dx * 8 + "deg)" : "none" }, NZ + k * F);
  });
  tl.set("#panel", { x: 0, filter: "none" }, NZ + 5 * F);`
    : ""
}`;
  return { css, html, js };
}

function paradigmPoem() {
  const b = dna.body;
  const colLeft = CLEARER === "right" ? Math.round(W * 0.52) : b.left;
  const scrimSide = CLEARER === "right" ? "right" : "left";
  // stanza split: break after a line whose last word ends a sentence
  const stanzas = [[]];
  LINES.forEach((L) => {
    stanzas[stanzas.length - 1].push(L);
    const last = L.words[L.words.length - 1].display;
    if (/[.!?]$/.test(last) && L !== LINES[LINES.length - 1]) stanzas.push([]);
  });
  if (stanzas.some((s) => s.length > b.stanzaTops.length))
    console.warn(
      "[make-theme] poem stanza exceeds available slots — extra lines share the last slot",
    );
  const stanzaData = stanzas.map((s, si) =>
    s.map((L, li) => ({
      id: "s" + si + "l" + L.id,
      top: b.stanzaTops[Math.min(li, b.stanzaTops.length - 1)] + si * 16,
      words: L.words.map((w) => [
        w.display,
        +w.start.toFixed(3),
        w.isHero && heroInline ? "big" : w.minor ? "em" : "",
      ]),
    })),
  );
  const lastStanzaIdx = stanzaData.length - 1;
  const css = `
  ${
    b.scrim
      ? `#pscrim { position:absolute; inset:0; opacity:0;
            background: linear-gradient(${scrimSide === "left" ? "100deg" : "260deg"},
              rgba(4,8,16,${b.scrim.opacity}) 0%, rgba(4,8,16,${b.scrim.opacity * 0.6}) 38%, rgba(4,8,16,0) 62%); }`
      : ""
  }
  .pline { position:absolute; left:${colLeft}px; white-space:nowrap;
           font-family:'${dna.fonts.body}', serif; font-weight:600; font-size:${b.fontPx}px;
           line-height:1; color:${dna.palette.body};
           text-shadow: 0 0 14px rgba(255,244,214,0.5), 0 2px 12px rgba(0,0,0,0.6); }
  .pline .l { display:inline-block; opacity:0; }
  .pline .sp { display:inline-block; width:0.28em; }
  .pline .big { font-size:${Math.round(b.fontPx * (b.bigScale || 2))}px; font-style:italic; font-weight:700;
                text-shadow: 0 0 24px rgba(255,244,214,0.7), 0 2px 14px rgba(0,0,0,0.6); }
  .pline .em  { font-size:${Math.round(b.fontPx * (b.emScale || 1.38))}px; font-style:italic; font-weight:700; }
  .star { position:absolute; border-radius:50%; background:#fff7e0; opacity:0;
          box-shadow: 0 0 8px rgba(255,247,224,0.9); }`;
  const html =
    (b.scrim ? `      <div id="pscrim"></div>\n` : "") +
    stanzaData
      .flat()
      .map((L) => `      <div class="pline" id="${L.id}" style="top:${L.top}px"></div>`)
      .join("\n");
  const disperse = (dna.linkages || []).includes("disperse-on-last-word");
  const js = `
  // ---- body paradigm: POEM (condense, accumulate, ${disperse ? "disperse" : "hold"}) ----
  const prnd = mulberry32(${b.seed || 777});
  const stage = document.getElementById("stage");
${
  b.scrim
    ? `  tl.fromTo("#pscrim", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" }, 0.15);
  tl.to("#pscrim", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(LASTWORD.start + 0.15).toFixed(3)});`
    : ""
}
  const STANZAS = ${J(stanzaData)};
  const lastLetters = [];
  STANZAS.forEach((stanza, si) => {
    stanza.forEach((L) => {
      const line = document.getElementById(L.id);
      L.words.forEach(([txt, st, cls], wi) => {
        if (wi > 0) { const g = document.createElement("span"); g.className = "sp"; line.appendChild(g); }
        const letters = [];
        for (const ch of txt) {
          const l = document.createElement("span");
          l.className = "l" + (cls ? " " + cls : ""); l.textContent = ch;
          line.appendChild(l); letters.push(l);
        }
        const spread = cls === "big" ? ${dna.hero.params.spread || 150} : 46;
        letters.forEach((l, li) => {
          const sx = (prnd() - 0.5) * 2 * spread, sy = (prnd() - 0.5) * 2 * spread * 0.7;
          tl.fromTo(l, { x: sx, y: sy, opacity: 0, filter: "blur(6px)" },
            { x: 0, y: 0, opacity: 1, filter: "blur(0px)",
              duration: cls === "big" ? 0.7 : 0.5, ease: "power2.out" },
            st - 0.04 + li * (cls === "big" ? 0.03 : 0.016));
          if (si === ${lastStanzaIdx}) lastLetters.push(l);
        });
        if (cls === "big") {
          // SETPIECE assembly: star particles fly INTO the apex as it forms
          const lt = line.style.top ? parseFloat(line.style.top) : 110;
          for (let i = 0; i < ${dna.hero.params.particles || 22}; i++) {
            const p = document.createElement("div");
            p.className = "star"; stage.appendChild(p);
            const s = 2 + Math.round(prnd() * 3);
            const tx = ${colLeft} + 90 + prnd() * 240, ty = lt - 20 + prnd() * 70;
            const fx = tx + (prnd() - 0.5) * 560, fy = ty + (prnd() - 0.5) * 380;
            gsap.set(p, { width: s, height: s, left: fx, top: fy });
            tl.to(p, { keyframes: { x: [0, (tx - fx) * 0.6, tx - fx], y: [0, (ty - fy) * 0.6, ty - fy],
                                    opacity: [0, 0.95, 0] },
                       duration: 0.5 + prnd() * 0.2, ease: "power2.in" }, st - 0.05 + prnd() * 0.3);
          }
          tl.fromTo(letters, { textShadow: "0 0 30px rgba(255,244,214,0.9), 0 2px 12px rgba(0,0,0,0.5)" },
            { textShadow: "0 0 18px rgba(255,244,214,0.55), 0 2px 12px rgba(0,0,0,0.5)",
              duration: 0.8, ease: "power1.out" }, st + 0.55);
        }
      });
    });
    // earlier stanzas drift out before the next stanza begins
    if (si < STANZAS.length - 1) {
      const nextIn = STANZAS[si + 1][0].words[0][1];
      stanza.forEach((L, k) => {
        tl.to("#" + L.id + " .l", { y: -10, opacity: 0, filter: "blur(4px)",
          duration: 0.5, ease: "power1.in", stagger: 0.008 }, nextIn - 0.62 + k * 0.12);
        tl.set("#" + L.id, { display: "none" }, nextIn + 0.1);
      });
    }
  });
${
  disperse
    ? `  // SEMANTIC EXIT: the whole visible poem disperses on the final word.
  // Clamped so the scatter COMPLETES before the clip ends (stagger included).
  const NZ = ${Math.min(LASTWORD.start + 0.06, DUR - 0.58).toFixed(3)};
  const DDUR = ${Math.min(0.42, Math.max(0.24, DUR - Math.min(LASTWORD.start + 0.06, DUR - 0.58) - 0.14)).toFixed(2)};
  lastLetters.forEach((l) => {
    const dx = (prnd() - 0.5) * 260, dy = (prnd() - 0.5) * 200 - 40;
    tl.to(l, { x: dx, y: dy, opacity: 0, filter: "blur(7px)",
               duration: DDUR, ease: "power2.in" }, NZ + prnd() * 0.05);
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmTakeover() {
  const b = dna.body;
  // each LINE is a card; minors hot; hero = colorflip apex inline
  const cards = LINES.map((L, i) => {
    const txt = L.words
      .map((w) => w.display)
      .join(" ")
      .toUpperCase();
    const isHero = L.words.some((w) => w.isHero);
    const hot = isHero || L.words.some((w) => w.minor);
    const _contentish = txt.replace(/[^A-Z]/g, "").length;
    const px = isHero
      ? dna.hero.fontPx || 196
      : Math.min(
          b.sizes.minor,
          Math.round(Math.min(b.sizes.content, (W * 0.86) / (0.55 * Math.max(3, txt.length)))),
        );
    return {
      id: "c" + i,
      txt,
      in: +L.in.toFixed(3),
      out: +L.out.toFixed(3),
      px,
      hot: hot ? 1 : 0,
      hero: isHero ? 1 : 0,
      last: i === LINES.length - 1 ? 1 : 0,
    };
  });
  // a held card before a silence ≥0.5s creeps, then VOID until the next card
  for (let i = 0; i + 1 < cards.length; i++) {
    const gap = cards[i + 1].in - LINES[i].words[LINES[i].words.length - 1].end;
    if (gap > 0.5) {
      cards[i].creep = 1;
      cards[i].out = +(cards[i + 1].in - Math.min(0.6, gap * 0.45)).toFixed(3);
    }
  }
  const css = `
  #dim { position:absolute; inset:0; opacity:0; background:#05070c; }
  .card { position:absolute; opacity:0; white-space:nowrap;
          font-family:'${dna.fonts.body}', sans-serif; line-height:1; letter-spacing:0.015em;
          color:${dna.palette.body}; text-shadow: 0 4px 26px rgba(0,0,0,0.65); }
  .card.hot { color:${dna.palette.accent};
              text-shadow: 0 0 34px ${dna.palette.accent}73, 0 4px 26px rgba(0,0,0,0.65); }`;
  const html = `      <div id="dim"></div>`;
  const js = `
  // ---- body paradigm: TAKEOVER (hard-cut full-frame cards) + colorflip apex ----
  const stage = document.getElementById("stage");
  const ANCH = ${J(b.anchors)};
  tl.fromTo("#dim", { opacity: 0 }, { opacity: ${b.baseDim}, duration: 0.25, ease: "power2.in" }, 0.05);
  const CARDS = ${J(cards)};
  CARDS.forEach((c, ci) => {
    const el = document.createElement("div");
    el.className = "card" + (c.hot ? " hot" : "");
    el.textContent = c.txt; el.style.fontSize = c.px + "px";
    stage.appendChild(el);
    const [ax, ay] = ANCH[ci % ANCH.length];
    gsap.set(el, { left: ax, top: ay, xPercent: -50, yPercent: -50,
                   rotation: (ci % 2 === 0 ? 1 : -1) * (0.8 + (ci % 3) * 0.7) });
    if (c.hero) {
      // SETPIECE colorflip: crush-in, squash, settle; plate dim deepens
      tl.set("#dim", { opacity: ${dna.hero.params.dimKick} }, c.in);
      tl.to("#dim", { opacity: ${b.baseDim}, duration: 0.5, ease: "power2.out" }, c.in + 0.12);
      tl.set(el, { opacity: 1, scale: ${dna.hero.params.crushFrom}, filter: "blur(10px) brightness(2.6)" }, c.in - 0.04);
      tl.to(el, { scale: 1, filter: "blur(0px) brightness(1)", duration: 0.11, ease: "power4.in" }, c.in - 0.04);
      tl.set(el, { scaleX: 1.10, scaleY: 0.92 }, c.in + 0.07);
      tl.to(el, { scaleX: 1, scaleY: 1, duration: 0.45, ease: "elastic.out(1.05, 0.36)" }, c.in + 0.15);
      tl.to(el, { scale: 1.05, duration: Math.max(0.2, c.out - c.in - 0.3), ease: "power1.inOut" }, c.in + 0.25);
    } else if (c.hot) {
      tl.set(el, { opacity: 1, scale: ${b.hotSnap} }, c.in);
      tl.to(el, { scale: 1, duration: 0.22, ease: "back.out(1.8)" }, c.in + 0.02);
    } else {
      tl.set(el, { opacity: 1, scale: 0.94 }, c.in);
      tl.to(el, { scale: c.creep ? ${b.creepScale} : 1.0,
                  duration: Math.max(0.08, c.out - c.in - 0.02),
                  ease: c.creep ? "power1.in" : "power2.out" }, c.in + 0.01);
    }
    if (c.last && ${J(!!dna.hero.params.dissolveLast)}) {
      tl.to(el, { filter: "blur(9px)", opacity: 0, duration: 0.32, ease: "power2.in" }, c.out - 0.23);
      tl.set(el, { display: "none" }, c.out + 0.1);
    } else {
      tl.set(el, { opacity: 0, display: "none" }, c.out);
    }
  });
  tl.to("#dim", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${(DUR - 0.27).toFixed(2)});`;
  return { css, html, js };
}

/* =====================================================================
 * HERO SETPIECES (embedded, bg layer) — { css, html, js } for index.html
 * ===================================================================== */

function setpieceDetonation() {
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const bw = Math.min(p.barWidth, W - 100, HG.halfW * 2 + 140);
  const css = `
  #scrim { position:absolute; inset:0; opacity:0;
           background: radial-gradient(120% 105% at 50% 38%, rgba(0,0,0,0) 26%, rgba(0,0,0,0.8) 100%); }
  #dimP { position:absolute; inset:0; opacity:0; background:#000; }
  #det { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; }
  .band, #heat { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
          font-family:'${dna.fonts.hero}', sans-serif; font-size:${HG.fontPx}px; line-height:1;
          letter-spacing:0.012em; white-space:nowrap; color:${dna.palette.body};
          text-shadow: 0 3px 18px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.4); }
  ${p.slices.map((s, i) => `#b${i + 1} { clip-path: inset(${s[0]}% 0 ${s[1]}% 0); }`).join("\n  ")}
  #heat { top:6px; color:#ff7a28; filter:blur(24px); opacity:0; text-shadow:none; }
  .bar { position:absolute; left:50%; width:${bw}px; height:3px; margin-left:-${bw / 2}px;
         background:${dna.palette.body}; opacity:0.85; transform-origin:50% 50%; }
  #barT { top:-${Math.round(HG.fontPx * 0.7)}px; } #barB { top:${Math.round(HG.fontPx * 0.66)}px; }
  .tick { position:absolute; width:3px; height:14px; background:${dna.palette.hot}; top:-${Math.round(HG.fontPx * 0.7)}px; opacity:0; }
  #tickL { left:calc(50% - ${bw / 2}px); } #tickR { left:calc(50% + ${bw / 2 - 3}px); }
  #tagwrap { position:absolute; left:50%; transform:translateX(-50%); top:${Math.round(HG.fontPx * 0.7)}px;
             overflow:hidden; white-space:nowrap; }
  #tag { font-family:'${dna.fonts.tag}', monospace; font-size:21px; letter-spacing:0.34em;
         color:${dna.palette.hot}; white-space:nowrap; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }`;
  const html = `      <div id="scrim"></div><div id="dimP"></div>
      <div id="det">
        <div id="heat">${esc(heroText)}</div>
        ${p.slices.map((_, i) => `<div class="band" id="b${i + 1}">${esc(heroText)}</div>`).join("\n        ")}
        ${p.bars ? `<div class="bar" id="barT"></div><div class="bar" id="barB"></div>` : ""}
        ${p.ticks ? `<div class="tick" id="tickL"></div><div class="tick" id="tickR"></div>` : ""}
        ${p.tag ? `<div id="tagwrap"><div id="tag">${esc(p.tag)}&nbsp;//&nbsp;T+${heroIn.toFixed(2)}S</div></div>` : ""}
      </div>`;
  const bandIds = p.slices.map((_, i) => "#b" + (i + 1));
  const js = `
  // ---- setpiece: DETONATION (charge → sheared slices snap → cool → furniture) ----
  const I = ${I.toFixed(3)}, HOTC = ${J(dna.palette.hot)}, BONEC = ${J(dna.palette.body)};
  tl.fromTo("#scrim", { opacity: 0 }, { opacity: ${dna.plate.charge}, duration: 0.40, ease: "power2.in" }, I - 0.42);
  tl.set("#dimP", { opacity: ${dna.plate.dim} }, I);
  tl.to("#dimP",  { opacity: ${(dna.plate.dim * 0.47).toFixed(2)}, duration: 0.9, ease: "power2.out" }, I + 0.10);
  tl.to("#scrim", { opacity: 0.30, duration: 0.9, ease: "power2.out" }, I + 0.10);
  tl.to(["#scrim","#dimP"], { opacity: 0, duration: 0.45, ease: "power1.in" }, ${(heroOut - 0.25).toFixed(3)});
  tl.set("#det", { opacity: 1 }, I - 0.05);
  tl.fromTo("#det", { scale: 3.4 }, { scale: 1.0, duration: 0.10, ease: "power4.in" }, I - 0.05);
  const BANDS = ${J(bandIds)};
  const SHEAR = ${J(p.sliceShear)};
  BANDS.forEach((sel, i) => {
    tl.fromTo(sel, { x: SHEAR[i], filter: "blur(14px) brightness(3.4)" },
      { x: SHEAR[i] * 0.26, filter: "blur(0px) brightness(1.5)", duration: 0.10, ease: "power4.in" }, I - 0.05);
  });
  tl.set(BANDS, { x: 0, filter: "brightness(1.9)" }, I + 0.05);
  tl.set("#det", { scaleX: 1.12, scaleY: 0.90 }, I + 0.05);
  tl.to("#det",  { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1.05, 0.34)" }, I + 0.13);
  tl.to(BANDS, { filter: "brightness(1)", duration: 0.5, ease: "power2.out" }, I + 0.15);
  tl.set(BANDS, { color: HOTC }, I + 0.05);
  tl.to(BANDS, { color: BONEC, duration: 0.9, ease: "power1.in" }, I + 0.22);
${p.bars ? `  tl.fromTo(["#barT","#barB"], { scaleX: 0, opacity: 0.85 }, { scaleX: 1, duration: 0.34, ease: "expo.out" }, I + 0.16);` : ""}
${
  p.ticks
    ? `  tl.set(["#tickL","#tickR"], { opacity: 1 }, I + 0.42);
  tl.fromTo(["#tickL","#tickR"], { scaleY: 0 }, { scaleY: 1, duration: 0.14, ease: "back.out(2)" }, I + 0.42);`
    : ""
}
${p.tag ? `  tl.fromTo("#tagwrap", { width: 0 }, { width: 340, duration: 0.45, ease: "steps(16)" }, I + 0.5);` : ""}
  tl.fromTo("#heat", { opacity: 0 }, { opacity: 0.75, duration: 0.3 }, I + 0.06);
  tl.to("#heat", { keyframes: { opacity: [0.75, 0.5, 0.6, 0.4, 0.46, 0.30] }, duration: 1.4, ease: "none" }, I + 0.5);
  tl.to("#det", { scale: 1.035, duration: 1.2, ease: "power1.inOut" }, I + 0.75);
  // EXIT: the stamp shears apart
  BANDS.forEach((sel, i) => {
    tl.to(sel, { x: -SHEAR[i] * 1.5, opacity: 0, duration: 0.16, ease: "power2.in" }, ${(heroOut - 0.18).toFixed(3)} + i * 0.01);
  });
  tl.to(["#barT","#barB","#tickL","#tickR","#tagwrap","#heat"], { opacity: 0, duration: 0.13 }, ${(heroOut - 0.18).toFixed(3)});
  tl.set("#det", { display: "none" }, ${(heroOut + 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceDecode() {
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const lockStagger = p.lockStagger || 0.045;
  const E = theme.hero.exitAt ?? Math.min(heroOut, I + 1.75);
  const broom = Math.min(HG.x, W - HG.x) - HG.halfW; // room for brackets
  const useBrackets = !!p.brackets && broom > 22;
  const boff = Math.max(14, Math.min(40, Math.floor(broom - 8)));
  const css = `
  #dimP { position:absolute; inset:0; opacity:0; background:#021018; }
  #blk { position:absolute; left:${HG.x}px; top:${HG.y}px; transform:translate(-50%,-50%); opacity:0; }
  #word { display:flex; align-items:flex-start; justify-content:center;
          font-family:'${dna.fonts.hero}', sans-serif; font-weight:800; font-size:${HG.fontPx}px;
          line-height:${HG.fontPx}px; color:#eafaff;
          text-shadow: 0 0 14px ${dna.palette.accent}8c, 0 3px 16px rgba(0,0,0,0.6); }
  .reel { display:block; height:${HG.fontPx}px; width:0.82em; overflow:hidden; text-align:center; }
  .reel.sp { width:0.38em; }
  .col { display:block; } .col span { display:block; height:${HG.fontPx}px; }
  .br { position:absolute; width:26px; height:26px; opacity:0; }
  .br.tl { left:-${boff}px; top:-30px; border-left:3px solid ${dna.palette.accent}; border-top:3px solid ${dna.palette.accent}; }
  .br.tr { right:-${boff}px; top:-30px; border-right:3px solid ${dna.palette.accent}; border-top:3px solid ${dna.palette.accent}; }
  .br.bl { left:-${boff}px; bottom:-34px; border-left:3px solid ${dna.palette.accent}; border-bottom:3px solid ${dna.palette.accent}; }
  .br.brr{ right:-${boff}px; bottom:-34px; border-right:3px solid ${dna.palette.accent}; border-bottom:3px solid ${dna.palette.accent}; }`;
  const html = `      <div id="dimP"></div>
      <div id="blk">
        <div id="word"></div>
        ${useBrackets ? `<div class="br tl"></div><div class="br tr"></div><div class="br bl"></div><div class="br brr"></div>` : ""}
      </div>`;
  const js = `
  // ---- setpiece: DECODE (glyph reels lock left→right, CRT-off exit) ----
  const I = ${I.toFixed(3)}, TEXT = ${J(heroText)}, GLYPHS = ${J(p.glyphs)};
  const drnd = mulberry32(${p.seed || 99});
  tl.fromTo("#dimP", { opacity: 0 }, { opacity: ${dna.plate.dim}, duration: 0.3, ease: "power2.in" }, I - 0.25);
  tl.to("#dimP", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(E + 0.05).toFixed(3)});
  const word = document.getElementById("word");
  const reels = [];
  for (let i = 0; i < TEXT.length; i++) {
    const ch = TEXT[i];
    const reel = document.createElement("span");
    reel.className = "reel" + (ch === " " ? " sp" : "");
    const col = document.createElement("span"); col.className = "col";
    if (ch !== " ") {
      const n = 5 + Math.floor(drnd() * 4);
      for (let k = 0; k < n; k++) {
        const s = document.createElement("span");
        s.textContent = GLYPHS[Math.floor(drnd() * GLYPHS.length)]; col.appendChild(s);
      }
      const fin = document.createElement("span"); fin.textContent = ch; col.appendChild(fin);
      reel.dataset.steps = n;
    }
    reel.appendChild(col); word.appendChild(reel); reels.push({ el: reel, col, ch, i });
  }
  tl.set("#blk", { opacity: 1 }, I - 0.02);
  reels.forEach((r) => {
    if (r.ch === " ") return;
    const lock = I + 0.30 + ${lockStagger} * r.i;
    const steps = parseInt(r.el.dataset.steps, 10);
    tl.fromTo(r.col, { y: 0 }, { y: -${HG.fontPx} * steps, duration: lock - I, ease: "steps(" + steps + ")" }, I);
    tl.set(r.el, { color: "#bfe9ff",
      textShadow: "3px 0 10px ${dna.palette.accent}cc, -3px 0 10px ${dna.palette.magenta}cc" }, I);
    tl.set(r.el, { textShadow: "-3px 0 10px ${dna.palette.accent}cc, 3px 0 10px ${dna.palette.magenta}cc" }, I + 0.12 + 0.02 * r.i);
    tl.set(r.el, { color: "#ffffff", textShadow: "0 0 22px rgba(255,255,255,0.95)" }, lock);
    tl.set(r.el, { color: "#eafaff",
      textShadow: "0 0 14px ${dna.palette.accent}8c, 0 3px 16px rgba(0,0,0,0.6)" }, lock + 0.083);
  });
  const LOCKED = I + 0.30 + ${lockStagger} * (TEXT.length - 1) + 0.083;
  tl.set("#blk", { scale: 1.04 }, LOCKED - 0.083);
  tl.to("#blk", { scale: 1, duration: 0.3, ease: "elastic.out(1, 0.4)" }, LOCKED);
${
  useBrackets
    ? `  [".br.tl",".br.tr",".br.bl",".br.brr"].forEach((sel, k) => {
    tl.fromTo(sel, { opacity: 0, scale: 0.3 }, { opacity: 0.95, scale: 1, duration: 0.22, ease: "expo.out" }, I - 0.12 + k * 0.05);
  });`
    : ""
}
  // EXIT: CRT power-off
  tl.to("#blk", { filter: "brightness(2.6)", duration: 0.07, ease: "power2.in" }, ${E.toFixed(3)});
  tl.to("#blk", { scaleY: 0.012, duration: 0.13, ease: "power4.in" }, ${(E + 0.06).toFixed(3)});
  tl.set("#blk", { opacity: 0, display: "none" }, ${(E + 0.2).toFixed(3)});`;
  return { css, html, js };
}

function setpieceDrawon() {
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  // generate the stroke path at COMPILE time — any word, zero tuning
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = Math.min(p.targetWidth || 640, W - 200);
  const D = execFileSync(
    process.execPath,
    [gen, fontPath, heroDisplay.toLowerCase(), String(tw), "185", String(Math.round(380 - tw / 2))],
    { encoding: "utf8" },
  ).trim();
  const WIN = p.window || 0.78;
  const css = `
  #spill { position:absolute; left:${HG.x}px; top:${HG.y}px; width:820px; height:440px;
           margin-left:-410px; margin-top:-220px; border-radius:50%; opacity:0;
           background: radial-gradient(50% 50% at 50% 50%, ${dna.palette.accent}57 0%, ${dna.palette.accent}00 70%); }
  #sign { position:absolute; left:${HG.x}px; top:${HG.y}px; }
  #neonsvg { position:absolute; left:0; top:0; margin-left:-380px; margin-top:-150px;
             transform:rotate(${p.rotate || -3}deg); overflow:visible; }
  #coreG { filter: drop-shadow(0 0 5px #fff) drop-shadow(0 0 16px ${dna.palette.accent}); }
  #pen  { filter: drop-shadow(0 0 8px #fff) drop-shadow(0 0 22px ${dna.palette.accent}); }`;
  const html = `      <div id="spill"></div>
      <div id="sign">
        <svg id="neonsvg" width="760" height="300" viewBox="0 0 760 300">
          <defs><filter id="haloblur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10"/></filter></defs>
          <path id="tubeP" fill="none" stroke="rgba(255,235,245,0.16)" stroke-width="${p.tubeWidth + 1}"
                stroke-linecap="round" stroke-linejoin="round" opacity="0"/>
          <g id="haloG" filter="url(#haloblur)" opacity="0.9"></g>
          <g id="coreG"></g>
          <circle id="pen" r="6" fill="#fff" opacity="0"/>
        </svg>
      </div>`;
  const js = `
  // ---- setpiece: DRAWON (single-line font, SEQUENTIAL stroke reveal) ----
  // SVG dash restarts per subpath → one <path> per pen stroke, revealed in
  // writing order at constant pen speed; nib rides each stroke, hops at lifts.
  const I = ${I.toFixed(3)}, WIN = ${WIN}, DRAWN = I + WIN, ENDT = ${heroOut.toFixed(3)};
  const D = ${J(D)};
  document.getElementById("tubeP").setAttribute("d", D);
  const subs = D.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNS = "http://www.w3.org/2000/svg";
  function mk(parent, d, stroke, w) {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", stroke); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");  // hidden until its turn (kills round-cap dot)
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokes = subs.map((d) => ({ halo: mk("haloG", d, ${J(dna.palette.accent)}, ${p.haloWidth}),
                                     core: mk("coreG", d, "#fff", ${p.tubeWidth}) }));
  let total = 0;
  strokes.forEach((s) => { s.len = s.core.getTotalLength(); total += s.len; });
  tl.fromTo("#tubeP", { opacity: 0 }, { opacity: 1, duration: 0.35 }, I - 0.6);
  tl.fromTo("#spill", { opacity: 0 }, { opacity: ${p.spill || 0.38}, duration: WIN + 0.2, ease: "power1.in" }, I);
  const pen = document.getElementById("pen");
  let t = I;
  strokes.forEach((s) => {
    const d = WIN * s.len / total;
    gsap.set([s.core, s.halo], { strokeDasharray: s.len, strokeDashoffset: s.len });
    tl.set([s.core, s.halo], { opacity: 1 }, t);
    tl.fromTo([s.core, s.halo], { strokeDashoffset: s.len }, { strokeDashoffset: 0, duration: d, ease: "none" }, t);
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n); xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(pen, { x: xs[0], y: ys[0] }, t);
    tl.to(pen, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, t);
    t += d;
  });
  gsap.set(pen, { attr: { cx: 0, cy: 0 } });
  tl.set(pen, { opacity: 1 }, I - 0.01);
  tl.to(pen, { scale: 2.2, opacity: 0, duration: 0.12, ease: "power2.in", transformOrigin: "50% 50%" }, DRAWN);
${
  p.hum
    ? `  const humStart = DRAWN + 0.08, humDur = Math.max(0.2, ENDT - humStart);
  const NN = Math.max(6, Math.round(humDur / (2 * F)));
  const humVals = [];
  for (let k = 0; k <= NN; k++) {
    const tt = k / NN * humDur;
    humVals.push(0.78 + 0.06 * Math.sin(2 * Math.PI * 9 * tt) + 0.05 * Math.sin(2 * Math.PI * 13 * tt + 1.1));
  }
  tl.to("#haloG", { keyframes: { opacity: humVals }, duration: humDur, ease: "none" }, humStart);
  tl.set("#coreG", { opacity: 0.45 }, ENDT + (${p.buzzDipAt || -0.18}));
  tl.set("#coreG", { opacity: 1 }, ENDT + (${p.buzzDipAt || -0.18}) + F);`
    : ""
}`;
  return { css, html, js };
}

/* =====================================================================
 * FRONT FX (fg layer additions) — flash / rings / sparks / scanband
 * ===================================================================== */
function frontFx() {
  const fx = dna.fx || {};
  let css = "",
    html = "",
    js = "";
  const I = heroIn;
  if (fx.flash) {
    css += `
  #fxflash { position:absolute; inset:0; opacity:0;
           background: radial-gradient(95% 80% at 50% 37%, rgba(255,250,240,0.95) 0%, rgba(255,235,210,0.7) 38%, rgba(120,90,60,0) 100%); }`;
    html += `      <div id="fxflash"></div>\n`;
    js += `
  tl.set("#fxflash", { opacity: ${fx.flash} }, ${(I + 0.045).toFixed(3)});
  tl.to("#fxflash", { opacity: 0, duration: 0.17, ease: "expo.out" }, ${(I + 0.085).toFixed(3)});`;
  }
  if (fx.rings) {
    css += `
  .fxring { position:absolute; left:${HG.x}px; top:${HG.y}px; width:90px; height:32px;
          margin-left:-45px; margin-top:-16px; border-radius:50%; opacity:0; }
  #fxr1 { border:4px solid rgba(255,228,196,0.95); filter:blur(1.5px); }
  #fxr2 { border:3px solid rgba(255,150,70,0.8); filter:blur(3px); }`;
    html += `      <div class="fxring" id="fxr1"></div>\n      <div class="fxring" id="fxr2"></div>\n`;
    js += `
  tl.set("#fxr1", { opacity: 1, scale: 1 }, ${(I + 0.05).toFixed(3)});
  tl.to("#fxr1", { scale: 16, opacity: 0, duration: 0.58, ease: "expo.out" }, ${(I + 0.05).toFixed(3)});
  tl.to("#fxr1", { filter: "blur(7px)", duration: 0.58, ease: "power1.in" }, ${(I + 0.05).toFixed(3)});
  tl.set("#fxr2", { opacity: 0.55, scale: 1 }, ${(I + 0.13).toFixed(3)});
  tl.to("#fxr2", { scale: 11, opacity: 0, duration: 0.72, ease: "expo.out" }, ${(I + 0.13).toFixed(3)});`;
  }
  if (fx.sparks) {
    css += `
  .fxspark { position:absolute; left:${HG.x}px; top:${HG.y}px; border-radius:2px;
           background:#ffd9a8; opacity:0; }
  .fxember { position:absolute; border-radius:50%; background:#ff9544; filter:blur(1px); opacity:0; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 7});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.sparks}; i++) {
      const el = document.createElement("div"); el.className = "fxspark"; stg.appendChild(el);
      const ang = frnd() * Math.PI * 2, dist = 130 + frnd() * 330;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.55;
      const grav = 40 + frnd() * 90, s = 3 + Math.round(frnd() * 5), d = 0.6 + frnd() * 0.45;
      gsap.set(el, { width: s, height: s, x: 0, y: 0 });
      tl.set(el, { opacity: 1 }, ${(I + 0.05).toFixed(3)});
      tl.to(el, { keyframes: { x: [0, dx*0.55, dx*0.85, dx],
                               y: [0, dy*0.55 + grav*0.15, dy*0.85 + grav*0.55, dy + grav],
                               opacity: [1, 1, 0.65, 0] }, duration: d, ease: "power2.out" }, ${(I + 0.05).toFixed(3)});
    }
    for (let i = 0; i < ${fx.embers || 0}; i++) {
      const el = document.createElement("div"); el.className = "fxember"; stg.appendChild(el);
      const s = 3 + Math.round(frnd() * 3);
      gsap.set(el, { width: s, height: s, left: ${HG.x - 220} + frnd() * 440, top: ${HG.y + 32} + frnd() * 60 });
      const t0 = ${(I + 0.6).toFixed(3)} + frnd() * 0.9, dr = 1.0 + frnd() * 0.7;
      const yA = -40 - frnd() * 50, yB = -80 - frnd() * 60;
      const xA = (frnd() - 0.5) * 30, xB = (frnd() - 0.5) * 50;
      tl.to(el, { keyframes: { opacity: [0, 0.75, 0.4, 0.8, 0],
                               y: [0, yA*0.5, yA, (yA+yB)/2, yB],
                               x: [0, xA*0.5, xA, (xA+xB)/2, xB] }, duration: dr, ease: "power1.out" }, t0);
    }
  }`;
  }
  if (fx.crowdflash) {
    // two stadium camera-flash pops: lock start / lock end (flapboard rhythm)
    const [fa, fb] = fx.crowdflash;
    const lockEnd = I + ((dna.hero.params || {}).lockWindow || 0.34);
    css += `
  #fxcrowd { position:absolute; inset:0; opacity:0;
            background: radial-gradient(85% 70% at 50% 34%, rgba(255,250,238,0.85) 0%,
                        rgba(255,238,210,0.45) 45%, rgba(60,50,35,0) 100%); }`;
    html += `      <div id="fxcrowd"></div>\n`;
    js += `
  tl.set("#fxcrowd", { opacity: ${fa} }, ${I.toFixed(3)});
  tl.to("#fxcrowd", { opacity: 0, duration: 0.10, ease: "expo.out" }, ${(I + 0.042).toFixed(3)});
  tl.set("#fxcrowd", { opacity: ${fb} }, ${lockEnd.toFixed(3)});
  tl.to("#fxcrowd", { opacity: 0, duration: 0.12, ease: "expo.out" }, ${(lockEnd + 0.042).toFixed(3)});`;
  }
  if (fx.paflash) {
    // PA-system flash over the board glow at apex contact (ledwipe completes)
    const C2 = I + ((dna.hero.params || {}).wipeDur || 0.3);
    const pw = (HG.panelW || 900) - 180,
      ph = Math.round((HG.panelH || 232) * 1.9);
    css += `
  #fxpa { position:absolute; left:${Math.round(HG.x - pw / 2)}px; top:${Math.round(HG.y - ph / 2)}px;
          width:${pw}px; height:${ph}px; opacity:0;
          background: radial-gradient(closest-side, rgba(255,200,100,0.55), ${dna.palette.accent}00 70%); }`;
    html += `      <div id="fxpa"></div>\n`;
    js += `
  tl.set("#fxpa", { opacity: ${fx.paflash} }, ${C2.toFixed(3)});
  tl.to("#fxpa", { opacity: 0, duration: 0.22, ease: "expo.out" }, ${(C2 + 0.042).toFixed(3)});`;
  }
  if (fx.coinflash) {
    // 1-frame arcade impact flash at the boss-word strike (the coin blip at
    // max amplitude) — vertical center rides the hero band
    const FT = I + ((dna.hero.params || {}).flashDelay ?? 0.14);
    const cyP = Math.round((HG.y / H) * 100);
    css += `
  #fxcoin { position:absolute; inset:0; opacity:0; z-index:16;
            background: radial-gradient(58% 38% at 50% ${cyP}%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%); }`;
    html += `      <div id="fxcoin"></div>\n`;
    js += `
  tl.set("#fxcoin", { opacity: ${fx.coinflash} }, ${FT.toFixed(3)});
  tl.to("#fxcoin", { opacity: 0, duration: 0.12, ease: "expo.out" }, ${(FT + 0.042).toFixed(3)});`;
  }
  if (fx.inkflecks) {
    // red ink flecks spatter off the rubber-stamp contact (fg layer, ballistic
    // with gravity) — fires at C = heroIn + params.crush, the punch anchor
    const C4 = I + ((dna.hero.params || {}).crush ?? 0.074);
    css += `
  .fxfleck { position:absolute; left:${HG.x}px; top:${HG.y}px; border-radius:50%;
           background:${dna.palette.fleck || dna.palette.accent}; opacity:0; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 18});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.inkflecks}; i++) {
      const el = document.createElement("div"); el.className = "fxfleck"; stg.appendChild(el);
      const ang = frnd() * Math.PI * 2, dist = 70 + frnd() * 200;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.6;
      const grav = 30 + frnd() * 60, sz2 = 2 + Math.round(frnd() * 3), d = 0.32 + frnd() * 0.2;
      gsap.set(el, { width: sz2, height: sz2, x: 0, y: 0 });
      tl.set(el, { opacity: 1 }, ${C4.toFixed(3)});
      tl.to(el, { keyframes: { x: [0, dx * 0.6, dx],
                               y: [0, dy * 0.6 + grav * 0.2, dy + grav],
                               opacity: [1, 0.85, 0] },
                 duration: d, ease: "power2.out" }, ${(C4 + 0.01).toFixed(3)});
    }
  }`;
  }
  if (fx.laserflash) {
    // apex contact flash in FRONT of everything (the laser ignite pop, 4
    // frames) — sized from the hero rect, tinted with the accent
    const fw = Math.round(2 * (HG.halfW || 330) + 80),
      fh = Math.round((HG.fontPx || 100) * 4.8);
    css += `
  #fxlaser { position:absolute; left:${HG.x - Math.round(fw / 2)}px; top:${HG.y - Math.round(fh / 2)}px;
           width:${fw}px; height:${fh}px; opacity:0;
           background: radial-gradient(50% 50% at 50% 50%, rgba(235,255,244,0.9) 0%, ${dna.palette.accent}73 38%, rgba(0,0,0,0) 72%); }`;
    html += `      <div id="fxlaser"></div>\n`;
    js += `
  tl.set("#fxlaser", { opacity: ${fx.laserflash} }, ${(I + 0.03).toFixed(3)});
  tl.to("#fxlaser",  { opacity: 0, duration: 0.16, ease: "expo.out" }, ${(I + 0.075).toFixed(3)});`;
  }
  if (fx.strikeflash) {
    // full-frame lightning flash in FRONT of everything: leader blink 2 frames
    // before contact (bright / dim alternation), return stroke at contact + 1f,
    // expo-out decay — same flicker grammar as the bg bolt
    css += `
  #fxstrike { position:absolute; inset:0; opacity:0;
           background: radial-gradient(80% 65% at 50% 38%, rgba(245,250,255,0.9) 0%, rgba(205,228,252,0.5) 40%, rgba(110,140,180,0) 100%); }`;
    html += `      <div id="fxstrike"></div>\n`;
    js += `
  tl.set("#fxstrike", { opacity: ${(fx.strikeflash * 0.45).toFixed(3)} }, ${(I - 2 * F).toFixed(3)});
  tl.set("#fxstrike", { opacity: ${(fx.strikeflash * 0.18).toFixed(3)} }, ${(I - F).toFixed(3)});
  tl.set("#fxstrike", { opacity: ${fx.strikeflash} }, ${(I + 0.02).toFixed(3)});
  tl.to("#fxstrike",  { opacity: 0, duration: 0.16, ease: "expo.out" }, ${(I + 0.06).toFixed(3)});`;
  }
  if (fx.holoflash) {
    // cyan LOCK flash in front of everything when the projection boots to
    // full brightness — a radial centered on the hero (frame-fraction anchor)
    const hxP = ((HG.x / W) * 100).toFixed(1),
      hyP = ((HG.y / H) * 100).toFixed(1);
    css += `
  #fxholo { position:absolute; inset:0; opacity:0;
           background: radial-gradient(58% 44% at ${hxP}% ${hyP}%, ${dna.palette.accent}8c 0%, rgba(80,160,200,0.18) 45%, rgba(40,80,110,0) 72%); }`;
    html += `      <div id="fxholo"></div>\n`;
    js += `
  tl.set("#fxholo", { opacity: ${fx.holoflash} }, ${(I + 0.075).toFixed(3)});
  tl.to("#fxholo", { opacity: 0, duration: 0.22, ease: "expo.out" }, ${(I + 0.105).toFixed(3)});`;
  }
  if (fx.sporeburst) {
    // bioluminescent spores burst PAST the bloom at contact (fg, in front of
    // the subject) — seeded radial puffs from the hero center, slight sink
    const C6 = I + ((dna.hero.params || {}).crush ?? 0.11);
    css += `
  .fxspore { position:absolute; left:${HG.x}px; top:${HG.y}px; border-radius:50%;
           background:${dna.palette.spore || dna.palette.accent};
           box-shadow: 0 0 6px 1px ${dna.palette.accent}cc; opacity:0; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 12});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.sporeburst}; i++) {
      const el = document.createElement("div"); el.className = "fxspore"; stg.appendChild(el);
      const s = 2 + Math.round(frnd());
      gsap.set(el, { width: s, height: s });
      const ang = frnd() * Math.PI * 2, dist = 70 + frnd() * 110;
      const dx = Math.cos(ang) * dist * 1.25, dy = Math.sin(ang) * dist * 0.7;
      tl.to(el, { keyframes: { x: [0, dx * 0.6, dx], y: [0, dy * 0.6, dy + 10],
                               opacity: [0.7, 0.5, 0] },
                 duration: 0.45 + frnd() * 0.15, ease: "power2.out" }, ${(C6 + 0.01).toFixed(3)} + i * 0.012);
    }
  }`;
  }
  if (fx.silkmotes) {
    // gentle aurora light motes drifting up near the ribbon during its hold
    // (fg layer) — seeded along the ribbon span at the demo's spread fractions
    // (the gap around 0.4 keeps them off the subject's face)
    const halfW = HG.halfW || 440;
    css += `
  .fxmote { position:absolute; border-radius:50%; opacity:0; filter:blur(1.5px); }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 9});
    const stg9 = document.getElementById("stage");
    const PALM = [${J(dna.palette.rose)}, ${J(dna.palette.accent)}, ${J(dna.palette.violet)}];
    const FRX = [-0.88, -0.56, -0.27, 0.05, 0.72, 0.84];
    for (let i = 0; i < ${fx.silkmotes}; i++) {
      const m = document.createElement("div"); m.className = "fxmote"; stg9.appendChild(m);
      const s = 3 + Math.round(frnd() * 3);
      const c = PALM[i % 3];
      const mx = ${HG.x} + FRX[i % 6] * ${Math.round(halfW)} + (frnd() - 0.5) * 40;
      const my = ${HG.y} - 5 + frnd() * 110;
      gsap.set(m, { width: s, height: s, left: mx, top: my,
                    background: c, boxShadow: "0 0 6px " + c });
      const t0 = ${(I + 0.13).toFixed(3)} + i * 0.09 + frnd() * 0.08;
      tl.fromTo(m, { y: 10 },
        { keyframes: { opacity: [0, 0.45, 0], y: [10, -16, -44] },
          duration: 0.75, ease: "sine.out" }, Math.min(t0, ${(DUR - 0.79).toFixed(3)}));
    }
  }`;
  }
  if (fx.paperscraps) {
    // torn paper scraps puff PAST the subject at each apex chip contact (fg,
    // in front) — ballistic steps(4) arcs, one accent scrap per puff
    // (the papermat landing rhythm); centers baked from the chip geometry
    const N9 = heroText.length;
    const pitch9 = HG.pitch || 132,
      step9 = (dna.hero.params || {}).step ?? 0.09;
    const y9 = Math.round(HG.y + (HG.tileH || 170) / 2 - 9);
    const puffs = [];
    for (let i = 0; i < N9; i++)
      if (heroText[i] !== " ")
        puffs.push([
          Math.round(HG.x + (i - (N9 - 1) / 2) * pitch9),
          +(I + i * step9).toFixed(3),
          +((i - (N9 - 1) / 2) * 22).toFixed(1),
        ]);
    css += `
  .fxscrap { position:absolute; opacity:0; border-radius:1px; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 150372});
    const stg = document.getElementById("stage");
    const PUFFS = ${J(puffs)};
    PUFFS.forEach(([px, pc, drift]) => {
      for (let k = 0; k < ${fx.paperscraps}; k++) {
        const el = document.createElement("div"); el.className = "fxscrap"; stg.appendChild(el);
        const s = 7 + Math.round(frnd()*6);
        el.style.width = s+"px"; el.style.height = Math.max(4, s-3)+"px";
        el.style.background = (k === 1) ? ${J(dna.palette.accent)} : ${J(dna.palette.chip || "#f6edd8")};
        el.style.left = (px + (frnd()-0.5)*40)+"px";
        el.style.top  = (${y9} + (frnd()-0.5)*14)+"px";
        const dx  = (frnd()-0.5)*180 + drift;
        const dyU = -(35 + frnd()*55);
        const dyF = dyU + 80 + frnd()*55;
        const rot = (frnd()-0.5)*240;
        tl.set(el, { opacity: 1 }, pc);
        tl.to(el, { keyframes: { x: [0, dx*0.6, dx], y: [0, dyU, dyF],
                                 rotation: [0, rot*0.6, rot], opacity: [1, 1, 0] },
                    duration: 0.42, ease: "steps(4)" }, pc);
      }
    });
  }`;
  }
  if (fx.confetti) {
    // paper confetti flicks up PAST the subject when the apex word pops (fg,
    // in front) — seeded ballistic arcs with card tumble; launch line baked
    // from the centerfold hinge (90% of the burst box, where the paper folds)
    const u0 = (HG.burstR || 220) / 220;
    const boxH0 = HG.boxH || 560;
    const hingeY = Math.round(HG.y + 24 * u0 - boxH0 / 2 + 0.9 * boxH0);
    const CC = dna.palette.conf || [
      dna.palette.cream || "#f6ecd4",
      dna.palette.accent,
      dna.palette.body,
    ];
    css += `
  .fxconf { position:absolute; opacity:0; border-radius:1px; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 360372});
    const stg = document.getElementById("stage");
    const CCOL = ${J(CC)};
    for (let i = 0; i < ${fx.confetti}; i++) {
      const el = document.createElement("div"); el.className = "fxconf";
      el.style.background = CCOL[i % CCOL.length]; stg.appendChild(el);
      gsap.set(el, { width: 5 + Math.round(frnd() * 5), height: 4 + Math.round(frnd() * 4),
                     left: ${HG.x - 30} + frnd() * 70, top: ${hingeY - 2} + frnd() * 16 });
      const dx = (frnd() - 0.5) * 320, up = -90 - frnd() * 140, grav = 150 + frnd() * 120;
      const rot = (frnd() - 0.5) * 520, d = 0.55 + frnd() * 0.3, t0 = ${(I + 0.128).toFixed(3)} + frnd() * 0.08;
      tl.set(el, { opacity: 1 }, t0);
      tl.to(el, { keyframes: { x: [0, dx * 0.5, dx * 0.85, dx],
                               y: [0, up, up * 0.55 + grav * 0.35, up * 0.1 + grav],
                               rotation: [0, rot * 0.4, rot * 0.75, rot],
                               opacity: [1, 1, 0.8, 0] },
                  duration: d, ease: "power1.out" }, t0);
    }
  }`;
  }
  if (fx.chalkclap) {
    // hand-slap dust CLAP in FRONT of the subject the instant the chalk word
    // completes (the bg board shakes the same frame) — seeded radial specks +
    // a soft blurred puff, centered on the pen's final contact point (baked
    // by setpieceChalkwrite into HG.clapX/Y/T)
    const cx9 = Math.round(HG.clapX ?? HG.x + (HG.halfW || 80)),
      cy9 = Math.round(HG.clapY ?? HG.y),
      ct9 = +(HG.clapT ?? I + 0.5).toFixed(3);
    const DUST9 = dna.palette.dust || "#f7f5ea";
    css += `
  #fxclap { position:absolute; left:${cx9}px; top:${cy9}px; width:0; height:0; }
  #fxclap .cd { position:absolute; left:0; top:0; border-radius:50%; background:${DUST9}; opacity:0; }
  #fxpuff { position:absolute; left:-48px; top:-48px; width:96px; height:96px; border-radius:50%; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%, ${DUST9}80 0%, ${DUST9}00 70%);
            filter: blur(4px); }`;
    html += `      <div id="fxclap"><div id="fxpuff"></div></div>\n`;
    js += `
  { const frnd = mulberry32(${fx.seed || 13});
    const clap = document.getElementById("fxclap");
    for (let i = 0; i < ${fx.chalkclap}; i++) {
      const s = document.createElement("div"); s.className = "cd";
      const sz = 2.5 + frnd() * 3.2;
      s.style.width = sz + "px"; s.style.height = sz + "px";
      s.style.marginLeft = (-sz / 2) + "px"; s.style.marginTop = (-sz / 2) + "px";
      clap.appendChild(s);
      const a = (i / ${fx.chalkclap}) * 6.2832 + (frnd() - 0.5) * 0.5;
      const dist = 42 + frnd() * 55;
      tl.set(s, { opacity: 1 }, ${ct9});
      tl.to(s, { x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.8 + 26,
                 duration: 0.5 + frnd() * 0.15, ease: "power2.out" }, ${ct9});
      tl.to(s, { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(ct9 + 0.1).toFixed(3)});
    }
    tl.fromTo("#fxpuff", { opacity: 0.55, scale: 0.35 },
              { opacity: 0, scale: 1.8, duration: 0.5, ease: "power2.out" }, ${ct9});
  }`;
  }
  if (fx.paintsplat) {
    // paint SPLAT in FRONT of the subject the instant the spray tag completes
    // — a hot magenta ring + a soft paint-color ring + seeded droplets with
    // gravity, centered on the pen-finish point (baked by setpieceSpraytag
    // into HG.splatX/Y/T)
    const sx = Math.max(60, Math.min(W - 60, Math.round(HG.splatX ?? HG.x + (HG.halfW || 80))));
    const sy = Math.round(HG.splatY ?? HG.y);
    const st9 = +Math.min(HG.splatT ?? I + 0.5, DUR - 0.5).toFixed(3);
    const HOT9 = dna.palette.em2 || dna.palette.hot || "#ff2e88";
    const PAINT9 = dna.palette.accent || "#ffd23f";
    css += `
  .fxsplat { position:absolute; left:${sx}px; top:${sy}px; border-radius:50%; opacity:0; }
  #fxsp1 { width:40px; height:30px; border:5px solid ${HOT9}; margin-left:-20px; margin-top:-15px; }
  #fxsp2 { width:26px; height:20px; border:4px solid ${PAINT9}; margin-left:-13px; margin-top:-10px;
           filter: blur(1.5px); }
  .fxsdrop { position:absolute; left:${sx}px; top:${sy}px; background:${HOT9};
             border-radius:50%; opacity:0; }`;
    html += `      <div class="fxsplat" id="fxsp1"></div>\n      <div class="fxsplat" id="fxsp2"></div>\n`;
    js += `
  tl.set("#fxsp1", { opacity: 1, scale: 0.3 }, ${st9});
  tl.to("#fxsp1", { scale: 4.6, opacity: 0, duration: 0.42, ease: "expo.out" }, ${st9});
  tl.to("#fxsp1", { filter: "blur(4px)", duration: 0.42, ease: "power1.in" }, ${st9});
  tl.set("#fxsp2", { opacity: 0.8, scale: 0.4 }, ${(st9 + 0.04).toFixed(3)});
  tl.to("#fxsp2", { scale: 3.4, opacity: 0, duration: 0.5, ease: "expo.out" }, ${(st9 + 0.04).toFixed(3)});
  { const frnd = mulberry32(${fx.seed || 20260611});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.paintsplat}; i++) {
      const el = document.createElement("div");
      el.className = "fxsdrop"; stg.appendChild(el);
      const s = 3 + Math.round(frnd() * 4);
      gsap.set(el, { width: s, height: s });
      const ang = frnd() * Math.PI * 2, dist = 36 + frnd() * 64; // capped: stays inside the frame edge
      const dx = Math.cos(ang) * dist, dyv = Math.sin(ang) * dist * 0.7;
      const grav = 26 + frnd() * 40, d = 0.38 + frnd() * 0.25;
      tl.set(el, { opacity: 1, x: 0, y: 0 }, ${st9});
      tl.to(el, { keyframes: { x: [0, dx * 0.6, dx],
                               y: [0, dyv * 0.6 + grav * 0.2, dyv + grav],
                               opacity: [1, 0.85, 0] },
                  duration: d, ease: "power2.out" }, ${st9});
    }
  }`;
  }
  if (fx.brushflecks) {
    // ink flecks kicked PAST the subject at the brush's first contact (the
    // start-splat depth pass) — seeded upward ballistic arcs from the pen-START
    // point (baked by setpieceBrushwrite into HG.fleckX/Y/T)
    const bx = Math.max(40, Math.min(W - 40, Math.round(HG.fleckX ?? HG.x - (HG.halfW || 80))));
    const by = Math.round(HG.fleckY ?? HG.y);
    const bt = +Math.min(HG.fleckT ?? I + 0.01, DUR - 0.4).toFixed(3);
    css += `
  .fxbfleck { position:absolute; left:${bx}px; top:${by}px; border-radius:50%;
           background:${dna.palette.ink || "#1a130c"}; opacity:0; }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 20260611});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.brushflecks}; i++) {
      const el = document.createElement("div"); el.className = "fxbfleck"; stg.appendChild(el);
      const s = 3 + Math.round(frnd() * 3);
      gsap.set(el, { width: s, height: s });
      const a = -0.4 - frnd() * 2.4, dist = 46 + frnd() * 90;
      const dx = Math.cos(a) * dist, dyv = Math.sin(a) * dist;
      tl.set(el, { opacity: 1 }, ${bt});
      tl.to(el, { keyframes: { x: [0, dx * 0.6, dx], y: [0, dyv * 0.6, dyv + 26],
                               opacity: [1, 0.85, 0] },
                  duration: 0.36, ease: "power2.out" }, ${bt});
    }
  }`;
  }
  if (fx.scanband) {
    const lockT =
      heroIn + 0.3 + (dna.hero.params.lockStagger || 0.045) * (heroText.length - 1) + 0.083;
    css += `
  #fxband { position:absolute; left:0; top:-80px; width:100%; height:70px; opacity:0;
          background: linear-gradient(180deg, ${dna.palette.accent}00 0%, ${dna.palette.accent}66 50%, ${dna.palette.accent}00 100%); }
  #fxlock { position:absolute; inset:0; opacity:0;
               background: radial-gradient(80% 60% at 52% 35%, ${dna.palette.accent}99 0%, ${dna.palette.accent}00 70%); }`;
    html += `      <div id="fxband"></div>\n      <div id="fxlock"></div>\n`;
    js += `
  tl.set("#fxband", { opacity: 0.5 }, ${(I - 0.05).toFixed(3)});
  tl.fromTo("#fxband", { y: 0 }, { y: ${H + 160}, duration: 0.5, ease: "power1.in" }, ${(I - 0.05).toFixed(3)});
  tl.set("#fxband", { opacity: 0 }, ${(I + 0.46).toFixed(3)});
  tl.set("#fxlock", { opacity: ${fx.lockflash || 0.55} }, ${(lockT - 0.083).toFixed(3)});
  tl.to("#fxlock", { opacity: 0, duration: 0.2, ease: "expo.out" }, ${lockT.toFixed(3)});`;
  }
  if (fx.breakline) {
    // a single horizontal "broken resistance level" flashes across the frame at
    // the apex slam (sober 2-frame snap from a seam, then fade) — the level the
    // breakout candle just punched through. Rides at the hero's vertical band.
    const BT = Math.round(HG.y - (HG.fontPx || 140) * 0.78); // just above the word
    const seamPct = Math.round((HG.x / W) * 100);
    const C = dna.palette.flash || dna.palette.hot || dna.palette.accent || "#beffdc";
    css += `
  #fxbreak { position:absolute; left:0; top:${BT}px; width:${W}px; height:2px; opacity:0;
             background: linear-gradient(90deg, ${C}00 0%, ${C}f2 30%, ${C}f2 70%, ${C}00 100%);
             box-shadow: 0 0 14px ${C}cc; transform-origin:${seamPct}% 50%; }`;
    html += `      <div id="fxbreak"></div>\n`;
    js += `
  tl.set("#fxbreak", { opacity: ${fx.breakline} }, ${I.toFixed(3)});
  tl.fromTo("#fxbreak", { scaleX: 0.15 }, { scaleX: 1, duration: 0.12, ease: "expo.out" }, ${I.toFixed(3)});
  tl.to("#fxbreak", { opacity: 0, duration: 0.16, ease: "expo.out" }, ${(I + 0.084).toFixed(3)});`;
  }
  if (fx.sparkles) {
    // apex micro-chime: tiny twinkle CROSSES pop at the hero edges shortly after
    // the word lands (the glass catching one more highlight) — each a 2-bar
    // plus that scales up with a spin then collapses. Seeded positions ride the
    // hero rect (halfW), front of the subject. Count = fx.sparkles.
    const n = fx.sparkles;
    const half = HG.halfW || 360;
    const col = dna.palette.spark || "#eaf8ff";
    const glow = dna.palette.accent || "#96dcff";
    css += `
  .fxspk { position:absolute; width:26px; height:26px; opacity:0; }
  .fxspk .b1 { position:absolute; left:0; top:12px; width:26px; height:2px; background:${col}; border-radius:1px;
               box-shadow: 0 0 8px ${glow}, 0 0 2px rgba(255,255,255,0.9); }
  .fxspk .b2 { position:absolute; left:12px; top:0; width:2px; height:26px; background:${col}; border-radius:1px;
               box-shadow: 0 0 8px ${glow}, 0 0 2px rgba(255,255,255,0.9); }`;
    js += `
  { const frnd = mulberry32(${fx.seed || 20260612});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${n}; i++) {
      const el = document.createElement("div"); el.className = "fxspk";
      el.innerHTML = '<div class="b1"></div><div class="b2"></div>'; stg.appendChild(el);
      const side = i % 2 ? 1 : -1;
      const x = ${HG.x} + side * (${Math.round(half * 0.82)} + Math.round((frnd() - 0.5) * 80));
      const y = ${HG.y} + Math.round((frnd() - 0.5) * ${Math.round((HG.slabH || 196) * 0.5)});
      gsap.set(el, { left: x, top: y, xPercent: -50, yPercent: -50 });
      const t0 = ${(I + 0.59).toFixed(3)} + i * 0.18;
      tl.set(el, { opacity: 1, scale: 0.2, rotation: 18 }, t0);
      tl.to(el, { scale: 1, rotation: 0, duration: 0.16, ease: "expo.out" }, t0);
      tl.to(el, { scale: 0.1, opacity: 0, duration: 0.18, ease: "power2.in" }, t0 + 0.20);
    }
  }`;
  }
  if (fx.seance) {
    // SEANCE apex front fx (fg, in FRONT of the subject): a cold radial flash at
    // contact, two expanding MIST RINGS (cool bone + a haunt-red echo), and an
    // ASH exhale — particles drifting up-and-out from the manifestation point.
    // Anchored to the hero rect; fires at C = heroIn + crush (the punch contact).
    const C = +(I + ((dna.hero.params || {}).crush ?? 0.065)).toFixed(3);
    const cxP = +((HG.x / W) * 100).toFixed(1);
    const cyP = +(((HG.y - HG.fontPx * 0.04) / H) * 100).toFixed(1);
    const cool = dna.palette.cool || "96,170,196";
    const haunt = dna.palette.haunt || "150,40,40";
    css += `
  #fxcold { position:absolute; inset:0; opacity:0;
            background:radial-gradient(60% 50% at ${cxP}% ${cyP}%, rgba(180,215,205,0.85) 0%, rgba(150,190,180,0.35) 40%, rgba(100,140,130,0) 75%); }
  .fxsering { position:absolute; left:${HG.x}px; top:${HG.y}px; width:130px; height:46px;
              margin-left:-65px; margin-top:-23px; border-radius:50%; opacity:0; }
  #fxser1 { border:3px solid rgba(${cool},0.9); filter:blur(1.5px); }
  #fxser2 { border:2px solid rgba(${haunt},0.75); filter:blur(3px); }
  .fxash { position:absolute; left:${HG.x}px; top:${HG.y}px; border-radius:50%;
           background:#cfd8d2; filter:blur(0.8px); opacity:0; }`;
    html += `      <div id="fxcold"></div>\n      <div class="fxsering" id="fxser1"></div>\n      <div class="fxsering" id="fxser2"></div>\n`;
    js += `
  tl.set("#fxcold", { opacity: 0.45 }, ${C.toFixed(3)});
  tl.to("#fxcold", { opacity: 0, duration: 0.16, ease: "expo.out" }, ${(C + 0.042).toFixed(3)});
  tl.set("#fxser1", { opacity: 0.85, scale: 1 }, ${(C + 0.005).toFixed(3)});
  tl.to("#fxser1", { scale: 8.5, opacity: 0, duration: 0.55, ease: "expo.out" }, ${(C + 0.005).toFixed(3)});
  tl.to("#fxser1", { filter: "blur(6px)", duration: 0.55, ease: "power1.in" }, ${(C + 0.005).toFixed(3)});
  tl.set("#fxser2", { opacity: 0.5, scale: 1 }, ${(C + 0.09).toFixed(3)});
  tl.to("#fxser2", { scale: 6.5, opacity: 0, duration: 0.6, ease: "expo.out" }, ${(C + 0.09).toFixed(3)});
  { const frnd = mulberry32(${fx.seed || 1212});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.seance}; i++) {
      const p = document.createElement("div"); p.className = "fxash"; stg.appendChild(p);
      const s = 2 + Math.round(frnd() * 2);
      gsap.set(p, { width: s, height: s });
      const ang = -Math.PI / 2 + (frnd() - 0.5) * 1.6;
      const dist = 90 + frnd() * 220;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.8 - 30;
      const t0 = ${(C + 0.02).toFixed(3)} + frnd() * 0.06, d = 0.7 + frnd() * 0.5;
      tl.set(p, { opacity: 0.85 }, t0);
      tl.to(p, { keyframes: { x: [dx * 0.4, dx * 0.75, dx], y: [dy * 0.45, dy * 0.8, dy],
                              opacity: [0.7, 0.4, 0] }, duration: d, ease: "power1.out" }, t0 + 0.01);
    }
  }`;
  }
  if (fx.dopplerboom) {
    // SONIC-BOOM CONE at the doppler lock (fg, in FRONT of everything): a hot
    // flash, two SKEWED expanding rings (bone + accent echo), a fan of air-rip
    // speed streaks tearing off to the right, and a pulse racing down the track
    // line. Anchored to the hero rect; fires at C = heroIn + lock. Pairs with
    // the racingrail paradigm (the #linepulse element rides on its track).
    const C = +(I + ((dna.hero.params || {}).lock ?? 0.22)).toFixed(3);
    const HOT = (dna.hero.params || {}).hot || dna.palette.accent || "#ff6a2b";
    const trackLeft = (dna.body && dna.body.trackLeft) ?? 120;
    const trackW = (dna.body && dna.body.trackW) ?? W - 2 * trackLeft;
    const cxP = +((HG.x / W) * 100).toFixed(1),
      cyP = +((HG.y / H) * 100).toFixed(1);
    css += `
  #fxboomflash { position:absolute; inset:0; opacity:0;
           background: radial-gradient(70% 55% at ${cxP}% ${cyP}%, rgba(255,246,236,0.95) 0%, ${hexA(HOT, 0.6, 1.5)} 40%, rgba(120,70,40,0) 100%); }
  .fxbring { position:absolute; left:${HG.x}px; top:${HG.y}px; width:130px; height:48px;
          margin-left:-65px; margin-top:-24px; border-radius:50%; opacity:0; }
  #fxbr1 { border:4px solid rgba(255,236,214,0.95); filter:blur(1.5px); }
  #fxbr2 { border:3px solid ${hexA(HOT, 0.85)}; filter:blur(3px); }
  .fxstreak { position:absolute; height:3px; opacity:0; border-radius:2px;
            background: linear-gradient(90deg, rgba(255,236,214,0) 0%, rgba(255,236,214,0.95) 100%); }`;
    html += `      <div id="fxboomflash"></div>\n      <div class="fxbring" id="fxbr1"></div>\n      <div class="fxbring" id="fxbr2"></div>\n`;
    js += `
  tl.set("#fxboomflash", { opacity: 0.9 }, ${(C + 0.005).toFixed(3)});
  tl.to("#fxboomflash", { opacity: 0, duration: 0.16, ease: "expo.out" }, ${(C + 0.045).toFixed(3)});
  gsap.set(["#fxbr1", "#fxbr2"], { skewX: -18 });
  tl.set("#fxbr1", { opacity: 1, scale: 1 }, ${(C + 0.01).toFixed(3)});
  tl.to("#fxbr1", { scale: 15, opacity: 0, duration: 0.5, ease: "expo.out" }, ${(C + 0.01).toFixed(3)});
  tl.to("#fxbr1", { filter: "blur(6px)", duration: 0.5, ease: "power1.in" }, ${(C + 0.01).toFixed(3)});
  tl.set("#fxbr2", { opacity: 0.65, scale: 1 }, ${(C + 0.07).toFixed(3)});
  tl.to("#fxbr2", { scale: 11, opacity: 0, duration: 0.65, ease: "expo.out" }, ${(C + 0.07).toFixed(3)});
  { const frnd = mulberry32(${fx.seed || 20260611});
    const stg = document.getElementById("stage");
    for (let i = 0; i < ${fx.dopplerboom}; i++) {
      const el = document.createElement("div"); el.className = "fxstreak"; stg.appendChild(el);
      const y = ${Math.round(HG.y - (HG.fontPx || 150) * 0.5)} + frnd() * ${Math.round((HG.fontPx || 150) * 1.0)};
      const x0 = ${HG.x - 100} + frnd() * 180;
      const wpx = 40 + Math.round(frnd() * 55);
      const dx = 260 + frnd() * 380;
      const d = 0.28 + frnd() * 0.22;
      const t0 = ${(C + 0.01).toFixed(3)} + frnd() * 0.07;
      gsap.set(el, { width: wpx, left: x0, top: y });
      tl.set(el, { opacity: 0.5 + frnd() * 0.5 }, t0);
      tl.to(el, { x: dx, opacity: 0, duration: d, ease: "expo.out" }, t0);
    }
  }
  // pulse racing down the track line after the boom (rides the racingrail track)
  if (document.getElementById("linepulse")) {
    tl.set("#linepulse", { x: ${trackLeft + 10}, opacity: 0.9 }, ${(C + 0.05).toFixed(3)});
    tl.to("#linepulse", { x: ${trackLeft + trackW - 100}, opacity: 0, duration: 0.45, ease: "expo.out" }, ${(C + 0.05).toFixed(3)});
  }`;
  }
  return { css, html, js };
}

/* =====================================================================
 * ASSEMBLE + POSTFX
 * ===================================================================== */
function paradigmLastpage() {
  // THE LAST PAGE: a blurred "future manuscript" haunts the room all video;
  // at the apex one rack-focus reveals every faint line was the apex word.
  const b = dna.body,
    I = heroIn;
  const prnd = (() => {
    let a = b.seed || 4242;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  // field instances: seeded positions in the upper room, away from the subject column
  const subjX = sz && sz.heroAnchor ? (W * sz.heroAnchor.centerXPct) / 100 : W * 0.5;
  const inst = [];
  for (let i = 0; i < (b.fieldCount || 9); i++) {
    let x = 80 + prnd() * (W - 160),
      y = 60 + prnd() * (H * 0.55);
    if (Math.abs(x - subjX) < 170)
      x = x < subjX ? subjX - 180 - prnd() * 120 : subjX + 180 + prnd() * 120;
    inst.push({
      x: Math.round(Math.max(70, Math.min(W - 70, x))),
      y: Math.round(y),
      px: Math.round(34 + prnd() * 96),
      rot: +((prnd() - 0.5) * 8).toFixed(1),
      op: +(0.26 + prnd() * 0.2).toFixed(2),
    });
  }
  const main = inst.reduce((a, c) => (c.px > a.px ? c : a), inst[0]);
  const lineData = LINES.map((L) => ({
    id: "m" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3)]),
  }));
  const css = `
  .fld { position:absolute; white-space:nowrap; font-family:'${dna.fonts.body}', serif;
         font-weight:600; color:${dna.palette.body}; filter: blur(${b.fieldBlur || 9}px); }
  .ms  { position:absolute; left:${W / 2}px; top:${H - (b.bottomPx || 96)}px; opacity:0; white-space:nowrap;
         font-family:'${dna.fonts.body}', serif; font-size:${b.fontPx}px; line-height:1;
         color:${dna.palette.body}; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
  .ms .w { display:inline-block; opacity:0; margin:0 0.14em; overflow:hidden; vertical-align:bottom; white-space:nowrap; }`;
  const html =
    inst
      .map(
        (f, i) =>
          `      <div class="fld" id="f${i}" style="left:${f.x}px; top:${f.y}px; font-size:${f.px}px; opacity:${f.op}; transform:translate(-50%,-50%) rotate(${f.rot}deg)">${esc(heroDisplay)}</div>`,
      )
      .join("\n") +
    "\n" +
    lineData.map((L) => `      <div class="ms" id="${L.id}"></div>`).join("\n");
  const js = `
  // ---- THE LAST PAGE ----
  const I = ${I.toFixed(3)};
  const MS = ${J(lineData)};
  MS.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt]) => { const sp = document.createElement("span"); sp.className = "w"; sp.textContent = txt; line.appendChild(sp); });
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    tl.set(line, { opacity: 1 }, L.in);
    const XO = L.out - ${b.exit === "drop" ? "0.18" : "0.17"};   // exit start (single source)
    let lastB = -1;                                              // line-y bounce ownership guard
    L.words.forEach(([txt, st], wi) => {
      const el = line.children[wi];
      tl.set(el, { opacity: 1 }, st);
      tl.fromTo(el, { width: 0 }, { width: "auto", duration: Math.min(0.18, 0.03 * txt.length + 0.04),
        ease: "steps(" + Math.max(2, txt.length) + ")" }, st);
    });
    const xo = L.out - 0.18;
    tl.to(line, { opacity: 0, duration: 0.16, ease: "power2.in" }, xo);
    tl.set(line, { display: "none" }, xo + 0.18);
  });
  // the field breathes imperceptibly (alive, unreadable)
  ${inst.map((f, i) => `tl.to("#f${i}", { y: ${prnd() - 0.5 > 0 ? "+" : "-"}${(3 + prnd() * 5).toFixed(1)}, duration: ${(2.4 + prnd() * 2).toFixed(1)}, ease: "sine.inOut" }, 0);`).join("\n  ")}
  // APEX: rack focus — the future was only ever one sentence
  tl.to(".fld", { filter: "blur(0px)", duration: 0.38, ease: "power3.inOut" }, I - 0.1);
  ${inst
    .map((f, i) =>
      i === inst.indexOf(main)
        ? `tl.to("#f${i}", { opacity: 1, scale: 1.22, duration: 0.5, ease: "power2.out" }, I + 0.15);
  tl.to("#f${i}", { textShadow: "0 0 28px rgba(255,244,220,0.5)", duration: 0.5 }, I + 0.15);`
        : `tl.to("#f${i}", { opacity: ${(f.op * 0.85).toFixed(2)}, duration: 0.5 }, I + 0.3);`,
    )
    .join("\n  ")}
  // hold revealed ~1.2s, then the future blurs back except the main instance
  tl.to(".fld", { filter: "blur(${b.fieldBlur || 9}px)", duration: 0.6, ease: "power2.inOut" }, I + 1.5);
  tl.to("#f${inst.indexOf(main)}", { filter: "blur(0px)", duration: 0.01 }, I + 1.5);
  ${inst.map((f, i) => (i === inst.indexOf(main) ? "" : `tl.to("#f${i}", { opacity: 0, duration: 0.6 }, I + 1.6);`)).join("\n  ")}
  tl.to("#f${inst.indexOf(main)}", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${(heroOut - 0.3).toFixed(3)});`;
  return { css, html, js };
}

function paradigmFlaprail() {
  // FLAPRAIL: stadium-departures chyron bar; body words flip in on split-flap
  // tiles (2 seeded wrong-word flickers then the real word clacks on), exits
  // flip to blank cascading left→right. Furniture: bar tag + ROW flip counter
  // (+ optional odometer chip pinned to the first emphasis line).
  const b = dna.body;
  const barH = b.barH || 96;
  const stagger = 0.025,
    exDu = 0.075;
  const lineData = LINES.map((L) => ({
    id: "fl" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display.toUpperCase(), +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const chy = b.chyron || {};
  const ctrVals = lineData.map((_, i) => String(i + 1).padStart(2, "0"));
  // odometer chip docks above the bar while the FIRST emphasis line reads
  const chipL = b.chip ? LINES.find((L) => L.words.some((w) => w.minor)) : null;
  const chipParts = chipL ? String(b.chip.value).split(".") : [];
  const css = `
  #flwrap { position:absolute; inset:0; }
  #flbar { position:absolute; left:0; right:0; top:${H - barH}px; height:${barH}px;
           background: linear-gradient(180deg, rgba(26,29,35,0.93) 0%, rgba(15,17,21,0.96) 100%);
           border-top:3px solid ${dna.palette.accent};
           box-shadow: 0 -6px 26px rgba(0,0,0,0.45), inset 0 1px 0 ${dna.palette.accent}40; }
  #fltag { position:absolute; left:30px; top:30px; font-family:'${dna.fonts.tag}', sans-serif;
           font-weight:600; font-size:25px; letter-spacing:4px; color:${dna.palette.accent}; opacity:0.92; }
  #flctr { position:absolute; right:30px; top:22px; white-space:nowrap; }
  #flctr .clab { font-family:'${dna.fonts.tag}', sans-serif; font-weight:600; font-size:22px;
                 letter-spacing:3px; color:#8A8F98; vertical-align:18px; margin-right:8px; }
  #ctrbox { display:inline-block; width:54px; height:46px; perspective:260px; vertical-align:top; }
  #ctrflap { position:relative; display:block; width:100%; height:100%; transform-origin:50% 0%;
             backface-visibility:hidden; border-radius:3px;
             background: linear-gradient(180deg,#2E333B 0%,#262B32 48%,#1B1F25 52%,#242930 100%);
             box-shadow: inset 0 0 0 1px rgba(0,0,0,0.6), 0 2px 5px rgba(0,0,0,0.5); }
  #ctrflap .nv { position:absolute; inset:0; display:none; text-align:center;
                 font-family:'${dna.fonts.tag}', sans-serif; font-weight:600; font-size:36px;
                 line-height:50px; color:${dna.palette.accent}; }
  .flline { position:absolute; left:${W / 2}px; top:${H - Math.round(barH / 2) - 1}px; white-space:nowrap; }
  .ftile { display:inline-block; perspective:240px; opacity:0; margin-right:8px; vertical-align:middle; }
  .fflap { position:relative; display:inline-block; transform-origin:50% 0%; backface-visibility:hidden;
           font-family:'${dna.fonts.body}', sans-serif; font-weight:600; font-size:${b.fontPx}px; line-height:1;
           letter-spacing:${b.letterSpacing || "1px"}; color:${dna.palette.body}; padding:8px 13px 4px; border-radius:4px;
           background: linear-gradient(180deg,#31363F 0%,#272C33 47%,#1C2026 53%,#262B32 100%);
           box-shadow: inset 0 0 0 1px rgba(0,0,0,0.55), 0 3px 8px rgba(0,0,0,0.5),
                       inset 0 1px 0 rgba(255,255,255,0.07);
           text-shadow: 0 2px 4px rgba(0,0,0,0.45); }
  .ftile.em .fflap { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.55), inset 0 -3px 0 ${dna.palette.accent},
                     0 3px 8px rgba(0,0,0,0.5); }
  .fflap .rl { visibility:hidden; }
  .fflap .wv { position:absolute; left:0; right:0; top:8px; text-align:center; display:none;
               color:${dna.palette.grey || "#B9BEC7"}; }
${
  chipL
    ? `  #flchip { position:absolute; left:${b.chip.x}px; top:${b.chip.y}px; perspective:300px; opacity:0; }
  #chipflap { display:block; transform-origin:50% 0%; backface-visibility:hidden; white-space:nowrap;
              background: linear-gradient(180deg,#2B3038 0%,#22262D 50%,#1A1E24 100%);
              border-radius:4px; border:1px solid rgba(0,0,0,0.6); padding:5px 12px 3px;
              box-shadow: inset 0 0 0 1px ${dna.palette.accent}59, 0 3px 10px rgba(0,0,0,0.5); }
  #chipflap .clab { font-family:'${dna.fonts.tag}', sans-serif; font-weight:600; font-size:24px;
                    letter-spacing:2px; color:${dna.palette.accent}; margin-right:8px; vertical-align:4px; }
  .dcol { display:inline-block; height:36px; overflow:hidden; vertical-align:top; }
  .dcol span { display:block; height:36px; line-height:38px; font-family:'${dna.fonts.tag}', sans-serif;
               font-weight:600; font-size:34px; color:${dna.palette.body}; text-align:center; }
  .cfix { display:inline-block; height:36px; line-height:38px; font-family:'${dna.fonts.tag}', sans-serif;
          font-weight:600; font-size:34px; color:${dna.palette.body}; vertical-align:top; }
  #cunit { font-size:22px; color:#8A8F98; margin-left:3px; }
  #bdot { display:inline-block; width:9px; height:9px; border-radius:50%;
          background:${dna.palette.accent}; margin-left:9px; vertical-align:14px; opacity:0.15;
          box-shadow: 0 0 7px ${dna.palette.accent}cc; }`
    : ""
}`;
  const html = `      <div id="flwrap">
        <div id="flbar">
          <div id="fltag">${esc(chy.tag || "DEPARTURES")}</div>
          <div id="flctr"><span class="clab">${esc(chy.counter || "ROW")}</span><span id="ctrbox"><span id="ctrflap">${ctrVals
            .map((v, i) => `<span class="nv" id="n${i}">${v}</span>`)
            .join("")}</span></span></div>
        </div>
${lineData.map((L) => `        <div class="flline" id="${L.id}"></div>`).join("\n")}
${
  chipL
    ? `        <div id="flchip"><div id="chipflap"><span class="clab">${esc(b.chip.label)}</span>${chipParts
        .map((_, i) => `<span class="dcol" id="dc${i}"></span>`)
        .join(
          `<span class="cfix">.</span>`,
        )}<span class="cfix" id="cunit">${esc(b.chip.unit || "")}</span><span id="bdot"></span></div></div>`
    : ""
}
      </div>`;
  const js = `
  // ---- body paradigm: FLAPRAIL (split-flap word tiles on a chyron bar) ----
  const HOT = ${J(dna.palette.hot || dna.palette.accent)}, BONE = ${J(dna.palette.body)};
  const frnd2 = mulberry32(${b.seed || 808});
  const GLYPHS = ${J(dna.body.glyphs || "ABCDEFGHIKLMNOPRSTUVXYZ0123456789")};
  function wrongOf(txt) {
    let s = "";
    for (const c of txt) s += /[A-Z']/.test(c) ? GLYPHS[Math.floor(frnd2() * GLYPHS.length)] : c;
    return s;
  }
  // chyron bar rides up; nothing visible at t=0
  tl.fromTo("#flbar", { y: ${barH + 14} }, { y: 0, duration: 0.20, ease: "power3.out" }, 0.0);
  tl.set("#n0", { display: "block" }, 0.18);
  const FRAIL = ${J(lineData)};
  FRAIL.forEach((L, li) => {
    const line = document.getElementById(L.id);
    const tiles = [];
    L.words.forEach(([txt, , em]) => {
      const tile = document.createElement("span"); tile.className = "ftile" + (em ? " em" : "");
      const flap = document.createElement("span"); flap.className = "fflap";
      const rl = document.createElement("span"); rl.className = "rl"; rl.textContent = txt;
      const w1 = document.createElement("span"); w1.className = "wv"; w1.textContent = wrongOf(txt);
      const w2 = document.createElement("span"); w2.className = "wv"; w2.textContent = wrongOf(txt);
      flap.appendChild(rl); flap.appendChild(w1); flap.appendChild(w2);
      tile.appendChild(flap); line.appendChild(tile);
      tiles.push({ tile, flap, rl, w1, w2 });
    });
    gsap.set(line, { xPercent: -50, yPercent: -50 });
    L.words.forEach(([txt, st, em], wi) => {
      const { tile, flap, rl, w1, w2 } = tiles[wi];
      // flick 1 (wrong), flick 2 (wrong), flick 3 (real) — the flap motif
      tl.set(tile, { opacity: 1 }, st);
      tl.set(w1, { display: "block" }, st);
      tl.fromTo(flap, { rotationX: -88 }, { rotationX: 0, duration: 0.05, ease: "power1.in" }, st);
      tl.set(w1, { display: "none" }, st + 0.055);
      tl.set(w2, { display: "block" }, st + 0.055);
      tl.set(flap, { rotationX: -88 }, st + 0.055);
      tl.to(flap, { rotationX: 0, duration: 0.05, ease: "power1.in" }, st + 0.06);
      tl.set(w2, { display: "none" }, st + 0.115);
      tl.set(rl, { visibility: "visible" }, st + 0.115);
      tl.set(flap, { rotationX: -88, color: HOT }, st + 0.115);
      tl.to(flap, { rotationX: 0, duration: 0.065, ease: "power2.in" }, st + 0.12);
      // contact squash → elastic settle, paint cools (amber stays on emphasized tiles)
      tl.set(tile, { scaleX: 1.05, scaleY: 0.92 }, st + 0.185);
      tl.to(tile, { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1, 0.4)" }, st + 0.21);
      tl.to(flap, { color: em ? HOT : BONE, duration: 0.35, ease: "power1.in" }, st + 0.25);
    });
    // hold life: low breathe on the line
    const lastIn = L.words[L.words.length - 1][1] + 0.4;
    const span = (L.words.length - 1) * ${stagger} + ${exDu} + 0.02;
    const XO = L.out - span;
    if (XO - lastIn > 0.3)
      tl.to(line, { scale: 1.014, duration: XO - lastIn, ease: "sine.inOut" }, lastIn);
    // exit: flip to blank, cascading left→right (completes before the next line)
    L.words.forEach((w, wi) => {
      const t = XO + wi * ${stagger};
      tl.to(tiles[wi].flap, { rotationX: 90, duration: ${exDu}, ease: "power2.in" }, t);
      tl.set(tiles[wi].tile, { opacity: 0 }, t + ${exDu});
    });
    tl.set(line, { display: "none" }, L.out);
  });
  // row counter flips at each line change
  FRAIL.slice(1).forEach((L, k) => {
    const t = L.words[0][1];
    tl.set("#n" + k, { display: "none" }, t);
    tl.set("#n" + (k + 1), { display: "block" }, t);
    // immediateRender:false — the flap is visible from t=0; the from-state must
    // not leak into the opening hold (paused timeline + seek renders it)
    tl.fromTo("#ctrflap", { rotationX: -80 }, { rotationX: 0, duration: 0.07, ease: "power2.in", immediateRender: false }, t);
    tl.set("#ctrflap", { scaleY: 0.92 }, t + 0.07);
    tl.to("#ctrflap", { scaleY: 1, duration: 0.18, ease: "elastic.out(1, 0.45)" }, t + 0.09);
  });
${
  chipL
    ? `  // odometer chip (emphasis furniture): clacks on beside the emphasis line,
  // digits roll on true reels, status dot blinks through the hold (dead-air life)
  const CIN = ${(chipL.words[chipL.words.length - 1].start + 0.06).toFixed(3)};
  const COUT = ${(+chipL.out).toFixed(3)};
  ${J(chipParts)}.forEach((fin, ci) => {
    const col = document.getElementById("dc" + ci);
    const stack = document.createElement("div");
    const steps = 4 + ci;
    for (let k = 0; k < steps; k++) { const s = document.createElement("span");
      s.textContent = Math.floor(frnd2() * 10); stack.appendChild(s); }
    const f = document.createElement("span"); f.textContent = fin; stack.appendChild(f);
    col.appendChild(stack);
    tl.fromTo(stack, { y: 0 }, { y: -36 * steps, duration: 0.42 + ci * 0.13,
              ease: "steps(" + steps + ")" }, CIN + 0.08 + ci * 0.04);
  });
  tl.set("#flchip", { opacity: 1 }, CIN);
  tl.fromTo("#chipflap", { rotationX: -85 }, { rotationX: 0, duration: 0.09, ease: "power2.in" }, CIN);
  tl.set("#chipflap", { scaleX: 1.04, scaleY: 0.93 }, CIN + 0.09);
  tl.to("#chipflap", { scaleX: 1, scaleY: 1, duration: 0.24, ease: "elastic.out(1, 0.42)" }, CIN + 0.11);
  tl.set(".dcol span", { color: HOT }, CIN + 0.67);
  tl.to(".dcol span", { color: BONE, duration: 0.4 }, CIN + 0.87);
  for (let k = 0; k < 4; k++) {
    const t = CIN + 0.64 + k * 0.22;
    if (t + 0.11 < COUT - 0.05) { tl.set("#bdot", { opacity: 1 }, t); tl.set("#bdot", { opacity: 0.15 }, t + 0.11); }
  }
  tl.to("#chipflap", { rotationX: 88, duration: 0.09, ease: "power2.in" }, COUT);
  tl.set("#flchip", { display: "none" }, COUT + 0.10);`
    : ""
}
${
  b.yield
    ? `  // rail yields while the apex board locks
  tl.to("#flwrap", { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.in" }, ${(heroIn - (b.yield.pre || 0.07)).toFixed(3)});
  tl.to("#flwrap", { opacity: 1, duration: 0.22, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.47)).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function paradigmLedboard() {
  // LEDBOARD: docked transit departure-strip; body lines arrive by vertical
  // SCROLL-SNAP paging (steps(6)) inside the board window; each word lights via
  // a small L→R LED column wipe (low-amplitude apex motif) + 1-frame arrival
  // flicker; emphasis words get the LED-refresh double-blink. Furniture: green
  // platform tag, ticking clock seconds, status swap gag (⚠ DELAYED → ● ON TIME
  // shortly after the apex resolves), idle LED shimmer in dead air.
  const b = dna.body;
  const bd = b.board || {};
  const bw = bd.width || 1000,
    bh = bd.h || 116;
  const bleft = bd.left ?? Math.round((W - bw) / 2);
  const btop = H - (bd.bottom ?? 30) - bh;
  const hdrH = 30,
    winH = bh - hdrH - 2,
    lineH = winH - 2;
  const hd = b.header || {};
  const A = dna.palette.accent;
  const GRN = dna.palette.green || "#36e57a";
  const WRN = dna.palette.warn || "#ff9e3d";
  const lineData = LINES.map((L) => ({
    id: "t" + L.id,
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  // page-in ~0.2s before the first word lights (the paging IS the anticipation);
  // each line pages out exactly as the next pages in (snap swap), last one early
  // enough that the 0.20s page-out completes before the clip ends
  const pins = LINES.map((L, i) =>
    i === 0
      ? Math.max(0.02, +(L.words[0].start - 0.22).toFixed(3))
      : +(L.words[0].start - 0.22).toFixed(3),
  );
  lineData.forEach((L, i) => {
    L.pin = pins[i];
    L.pout = i + 1 < pins.length ? pins[i + 1] : +Math.min(LINES[i].out, DUR - 0.22).toFixed(3);
  });
  // idle LED shimmer: any dead air ≥1.2s between word lights gets refresh blips
  const starts = LINES.flatMap((L) => L.words.map((w) => w.start));
  const shimmers = [];
  for (let i = 0; i + 1 < starts.length; i++)
    if (starts[i + 1] - starts[i] > 1.2)
      for (let t = starts[i] + 0.43; t < starts[i + 1] - 0.55; t += 0.6)
        shimmers.push(+t.toFixed(3));
  // status gag: ⚠ DELAYED blinks while we wait, pages to ● ON TIME after the apex
  const swapT = +Math.min(heroIn + 0.69, DUR - 1.2).toFixed(3);
  const statBlinks = [swapT - 2.55, swapT - 1.75, swapT - 1.15]
    .filter((t) => t > 0.25)
    .map((t) => +t.toFixed(3));
  // clock seconds reel: one stacked digit per elapsed second
  const nDig = Math.floor(DUR - 0.02) + 1;
  const lateT = +(LASTWORD.start + 0.19).toFixed(3); // one late LED refresh on the final word
  const css = `
  #tboard { position:absolute; left:${bleft}px; top:${btop}px; width:${bw}px; height:${bh}px; border-radius:6px;
           background-color: rgba(8,8,11,0.90);
           background-image: radial-gradient(${A}0d 1px, rgba(0,0,0,0) 1.4px);
           background-size: 7px 7px;
           border:1px solid ${A}47; border-top:2px solid ${A}73;
           box-shadow: 0 10px 30px rgba(0,0,0,0.5), inset 0 0 40px ${A}0a; }
  #thdr { position:absolute; left:0; right:0; top:0; height:${hdrH}px;
          border-bottom:1px solid ${A}38;
          font-family:'${dna.fonts.tag}', monospace; font-size:20px; letter-spacing:0.12em; }
  #tplt { position:absolute; left:16px; top:4px; color:${GRN};
          text-shadow:0 0 8px ${GRN}80; }
  #tstatwin { position:absolute; right:128px; top:3px; width:170px; height:24px; overflow:hidden; }
  #tstatstack { position:absolute; left:0; top:0; width:100%; }
  .tstrow { display:block; height:24px; line-height:24px; text-align:right; }
  #tstrow1 { color:${WRN}; text-shadow:0 0 8px ${WRN}80; }
  #tstrow2 { color:${GRN}; text-shadow:0 0 8px ${GRN}80; }
  #tclock { position:absolute; right:14px; top:4px; color:${A}bf;
            text-shadow:0 0 6px ${A}59; }
  #tclock .cw { display:inline-block; width:11px; height:22px; overflow:hidden;
                vertical-align:bottom; }
  #tdigcol span { display:block; height:22px; line-height:22px; }
  #twin { position:absolute; left:0; right:0; top:${hdrH + 2}px; bottom:0; overflow:hidden; }
  .tline { position:absolute; left:22px; top:0; height:${lineH}px; line-height:${lineH}px;
           font-family:'${dna.fonts.body}', monospace; font-size:${b.fontPx}px; letter-spacing:${b.letterSpacing || "0.05em"};
           color:${dna.palette.body}; white-space:nowrap;
           text-shadow: 0 0 9px ${A}73, 0 0 1px ${dna.palette.hot}e6; }
  .tline .w { display:inline-block; margin-right:0.35em; }`;
  const html = `      <div id="tboard">
        <div id="thdr">
          <div id="tplt">${esc(hd.plt || "PLT 4")}</div>
          <div id="tstatwin"><div id="tstatstack">
            <span class="tstrow" id="tstrow1">${esc(hd.statusWait || "⚠ DELAYED")}</span>
            <span class="tstrow" id="tstrow2">${esc(hd.statusOk || "● ON TIME")}</span>
          </div></div>
          <div id="tclock">${esc(hd.clockPrefix || "19:42:0")}<span class="cw"><span id="tdigcol">${Array.from(
            { length: nDig },
            (_, k) => `<span>${k}</span>`,
          ).join("")}</span></span></div>
        </div>
        <div id="twin"></div>
      </div>`;
  const js = `
  // ---- body paradigm: LEDBOARD (scroll-snap paging + per-word LED column wipes) ----
  const twin = document.getElementById("twin");
  const TRAIL = ${J(lineData)};
  let lastW = null;
  TRAIL.forEach((L) => {
    const line = document.createElement("div"); line.className = "tline";
    twin.appendChild(line);
    gsap.set(line, { y: ${winH + 2} });                                // parked below the window
    tl.to(line, { y: 0,   duration: 0.22, ease: "steps(6)" }, L.pin);  // page in
    tl.to(line, { y: ${-(winH + 2)}, duration: 0.20, ease: "steps(6)" }, L.pout); // page out
    L.words.forEach(([txt, st, em]) => {
      const w = document.createElement("span"); w.className = "w";
      w.textContent = txt; line.appendChild(w); lastW = w;
      const steps = Math.max(3, txt.length);
      tl.fromTo(w, { clipPath: "inset(0% 100% 0% 0%)" },
                { clipPath: "inset(0% 0% 0% 0%)", duration: 0.12, ease: "steps(" + steps + ")" }, st);
      tl.set(w, { clipPath: "none" }, st + 0.17);            // free the glow
      tl.set(w, { opacity: 0.5 }, st + 0.13);                // 1-frame arrival flicker
      tl.set(w, { opacity: 1 },   st + 0.172);
      if (em && st + 0.56 < L.pout) {                        // LED refresh: blinks twice
        tl.set(w, { opacity: 0.22 }, st + 0.30);
        tl.set(w, { opacity: 1 },    st + 0.383);
        tl.set(w, { opacity: 0.22 }, st + 0.466);
        tl.set(w, { opacity: 1 },    st + 0.55);
      }
    });
  });
${
  lateT + 0.05 < DUR - 0.25
    ? `  // the final word gets one late LED refresh blink (kept inside the clip)
  tl.set(lastW, { opacity: 0.22 }, ${lateT.toFixed(3)});
  tl.set(lastW, { opacity: 1 },    ${(lateT + 0.042).toFixed(3)});`
    : ""
}

  // ===== furniture =====
  // status blinks while we wait, then the gag: pages to the OK row
  ${J(statBlinks)}.forEach((t) => {
    tl.set("#tstrow1", { opacity: 0.35 }, t);
    tl.set("#tstrow1", { opacity: 1 },    t + 0.042);
  });
  tl.to("#tstatstack", { y: -24, duration: 0.16, ease: "steps(4)" }, ${swapT.toFixed(3)});
  tl.set("#tstrow2", { opacity: 0.5 }, ${(swapT + 0.18).toFixed(3)});
  tl.set("#tstrow2", { opacity: 1 },   ${(swapT + 0.222).toFixed(3)});

  // clock seconds tick (stacked digit column, stepped shifts)
  for (let k = 1; k <= ${nDig - 1}; k++) tl.set("#tdigcol", { y: -22 * k }, k);

  // idle LED refresh shimmer in the dead air (board never freezes)
  ${J(shimmers)}.forEach((t) => {
    tl.set("#twin", { opacity: 0.88 }, t);
    tl.set("#twin", { opacity: 1 },    t + 0.042);
  });
${
  b.yield
    ? `
  // ===== hierarchy: board yields while the apex lands =====
  tl.to("#tboard", { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.in" }, ${(heroIn - (b.yield.pre || 0.2)).toFixed(3)});
  tl.to("#tboard", { opacity: 1,   duration: 0.25, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.9)).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function paradigmVhsrail() {
  // VHSRAIL: camcorder-playback lower third. Every body word carries a PERMANENT
  // 1px red+cyan misregistration fringe and arrives by tracking glitch (instant
  // on + 2-frame y-shake + 1-frame band-slice shift of the word's bottom half);
  // emphasis words get the PAUSE jitter (±1px y oscillation) + a white noise-band
  // flicker. Exits are REWIND streaks left with a flat-white echo copy + scrub
  // lines. Furniture: ▶ PLAY / ◀◀ REW top-left (REW gag in dead air and on the
  // final rewind), ● REC top-right during the apex window, green timestamp
  // bottom-right with a 1 Hz blinking colon, an idle tape-drift line in long
  // silences, and the apex-coupled artifacts: 1-frame full white tear band +
  // head-switching noise bar at REC FREEZE, scrub lines at the apex band on the
  // hero's rewind exit.
  const b = dna.body;
  const p = dna.hero.params || {};
  const X = theme.hero.exitAt ?? Math.min(heroOut, heroIn + (p.hold ?? 1.69)); // hero REWIND (shared with vhsosd)
  const railTop = H - (b.bottomPx || 108);
  const osd = b.osd || {};
  const ts = osd.ts || ["JUN.11 2026 PM 7", "42"];
  const A = dna.palette.accent,
    GRN = dna.palette.green || dna.palette.accent,
    RED = dna.palette.red || "#FF2E2E",
    CYN = dna.palette.cyan || "#3FE8E8";
  // line windows: `out` is the REWIND start — early into dead air (with the
  // PLAY→REW gag), before the clip end for the last line
  const lineData = LINES.map((L, i) => {
    const lastEnd = L.words[L.words.length - 1].end;
    const next = LINES[i + 1];
    let out = +(L.out - 0.05).toFixed(3),
      gag = 0;
    if (next && next.in - lastEnd > 0.7) {
      out = +(lastEnd + 0.53).toFixed(3);
      gag = 1;
    }
    if (!next) out = +(DUR - 0.14).toFixed(3);
    return {
      id: "v" + L.id,
      eid: "ve" + L.id,
      in: +L.in.toFixed(3),
      out,
      gag,
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    };
  });
  const lastOut = lineData[lineData.length - 1].out;
  const css = `
  /* ---- OSD furniture ---- */
  .osd { position:absolute; font-family:'${dna.fonts.tag}', monospace; font-size:28px; line-height:1;
         letter-spacing:2px; color:${A}; opacity:0;
         text-shadow: -1px 0 0 ${RED}59, 1px 0 0 ${CYN}59,
                      0 0 7px rgba(0,0,0,0.95), 0 2px 5px rgba(0,0,0,0.85); }
  #osdplay { left:36px; top:34px; }
  #pmode, #rmode { display:flex; align-items:center; gap:10px; }
  #rmode { display:none; }
  .tri { width:0; height:0; border-left:16px solid ${A};
         border-top:9px solid transparent; border-bottom:9px solid transparent;
         filter: drop-shadow(0 0 4px rgba(0,0,0,0.9)); }
  .rtri { width:0; height:0; border-right:14px solid ${A};
          border-top:8px solid transparent; border-bottom:8px solid transparent;
          filter: drop-shadow(0 0 4px rgba(0,0,0,0.9)); }
  #rmode .rtri + .rtri { margin-left:-6px; }
  #rec { right:36px; top:34px; display:flex; align-items:center; gap:10px; color:${dna.palette.body}; }
  #rdot { width:15px; height:15px; border-radius:50%; background:#ff3b30;
          box-shadow: 0 0 6px rgba(0,0,0,0.85), 0 0 10px rgba(255,59,48,0.55); }
  #osdts { right:36px; bottom:22px; color:${GRN};
           text-shadow: -1px 0 0 ${RED}4d, 1px 0 0 ${CYN}4d,
                        0 0 7px rgba(0,0,0,0.95), 0 2px 5px rgba(0,0,0,0.85); }

  /* ---- body rail ---- */
  .vln, .vlnE { position:absolute; left:${W / 2}px; top:${railTop}px; white-space:nowrap; opacity:0;
        font-family:'${dna.fonts.body}', monospace; font-size:${b.fontPx}px; line-height:1;
        letter-spacing:${b.letterSpacing || "0.04em"}; text-transform:uppercase;
        color:${dna.palette.body};
        text-shadow: -1px 0 0 ${RED}66, 1px 0 0 ${CYN}66,
                     0 2px 6px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.55); }
  .vlnE { color:#ffffff; text-shadow:none; }
  .vw { position:relative; display:inline-block; margin-right:0.3em; opacity:0; }
  .vwa { display:inline-block; clip-path: inset(0 0 56% 0); }
  .vwb { position:absolute; left:0; top:0; clip-path: inset(44% 0 0 0); }
  .vnz { position:absolute; left:-4px; right:-4px; top:30%; height:38%; opacity:0;
        background: repeating-linear-gradient(0deg, rgba(255,255,255,0.85) 0 2px, rgba(255,255,255,0) 2px 5px); }

  /* ---- tape artifacts ---- */
  #tear { position:absolute; left:0; top:${HG.y - 55}px; width:100%; height:110px; opacity:0;
          background: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, #ffffff 30%, #ffffff 70%, rgba(255,255,255,0.55) 100%); }
  #hsbar { position:absolute; left:0; bottom:0; width:100%; height:16px; opacity:0;
           background: repeating-linear-gradient(90deg,
             rgba(205,205,205,0.92) 0 7px, rgba(60,60,60,0.85) 7px 11px,
             rgba(165,165,165,0.9) 11px 19px, rgba(28,28,28,0.85) 19px 26px); }
  .scrub { position:absolute; left:0; width:100%; height:3px; opacity:0;
           background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.75) 8%,
             rgba(225,225,225,0.5) 38%, rgba(255,255,255,0.8) 62%, rgba(255,255,255,0) 100%); }
  #scrub1 { top:${railTop - 18}px; } #scrub2 { top:${railTop + 20}px; }
  #scrub3 { top:${HG.y - 28}px; } #scrub4 { top:${HG.y + 34}px; }
  #drift { position:absolute; left:0; top:${railTop + 48}px; width:100%; height:2px; opacity:0;
           background: rgba(255,255,255,0.45); }`;
  const html =
    `      <div class="osd" id="osdplay">
        <div id="pmode"><div class="tri"></div><span>PLAY</span></div>
        <div id="rmode"><div class="rtri"></div><div class="rtri"></div><span>REW</span></div>
      </div>
      <div class="osd" id="rec"><div id="rdot"></div><span>REC</span></div>
      <div class="osd" id="osdts">${esc(ts[0])}<span id="col">:</span>${esc(ts[1])}</div>
` +
    lineData
      .map(
        (L) => `      <div class="vln" id="${L.id}"></div><div class="vlnE" id="${L.eid}"></div>`,
      )
      .join("\n") +
    `
      <div id="drift"></div>
      <div class="scrub" id="scrub1"></div><div class="scrub" id="scrub2"></div>
      <div class="scrub" id="scrub3"></div><div class="scrub" id="scrub4"></div>
      <div id="tear"></div>
      <div id="hsbar"></div>`;
  // PLAY → REW gags: each dead-air rewind + the final rewind (no restore)
  const gags = lineData
    .filter((L) => L.gag)
    .map((L) => [+(L.out - 0.01).toFixed(3), +(L.out + 0.35).toFixed(3)]);
  gags.push([+(lastOut - 0.01).toFixed(3), null]);
  const js = `
  // ---- body paradigm: VHSRAIL (tracking-glitch words, REWIND exits, OSD furniture) ----
  const I = ${heroIn.toFixed(3)}, X = ${X.toFixed(3)};

  // ===== OSD furniture: present the whole clip, 1-frame power-on glitch =====
  tl.set(["#osdplay","#osdts"], { opacity: 1, x: 5 }, 0.02);
  tl.set(["#osdplay","#osdts"], { x: 0 }, 0.02 + F);
  // timestamp colon blinks at 1 Hz
  for (let k = 0; 0.50 + k < ${(DUR - 0.04).toFixed(2)}; k++) {
    tl.set("#col", { opacity: 0 }, 0.50 + k);
    if (1.00 + k < ${(DUR - 0.04).toFixed(2)}) tl.set("#col", { opacity: 1 }, 1.00 + k);
  }
  // PLAY -> REW gag on each dead-air rewind, and again at the final rewind
  ${J(gags)}.forEach(([a, b]) => {
    tl.set("#pmode", { display: "none" }, a);
    tl.set("#rmode", { display: "flex" }, a);
    if (b) { tl.set("#rmode", { display: "none" }, b); tl.set("#pmode", { display: "flex" }, b); }
  });

  // ===== body rail =====
  const VRAIL = ${J(lineData)};
  VRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    const echo = document.getElementById(L.eid);
    echo.textContent = L.words.map((w) => w[0]).join(" ");
    L.words.forEach(([txt]) => {
      const w = document.createElement("span"); w.className = "vw";
      const a = document.createElement("span"); a.className = "vwa"; a.textContent = txt;
      const b2 = document.createElement("span"); b2.className = "vwb"; b2.textContent = txt;
      const n = document.createElement("span"); n.className = "vnz";
      w.appendChild(a); w.appendChild(b2); w.appendChild(n); line.appendChild(w);
    });
    gsap.set([line, echo], { xPercent: -50, yPercent: -50 });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);

    L.words.forEach(([txt, st, em], wi) => {
      const w = line.children[wi];
      const b2 = w.children[1], n = w.children[2];
      // tracking glitch entrance: instant on, 2-frame y-shake, 1-frame band slice shift
      tl.set(w, { opacity: 1, y: 3 }, st);
      tl.set(b2, { x: 7 }, st);
      tl.set(w, { y: -3 }, st + F);
      tl.set(b2, { x: 0 }, st + F);
      tl.set(w, { y: 0 }, st + 2 * F);
      if (em) {
        // PAUSE jitter: y oscillation +-1px for 0.3s + white noise band flicker
        const e = st + 0.125;
        [-1, 1, -1, 1, 0].forEach((v, k) => tl.set(w, { y: v }, e + k * 0.05));
        [0.5, 0, 0.35, 0].forEach((o, k) => tl.set(n, { opacity: o }, e + k * 0.065));
      }
    });

    // REWIND exit: streak left + echo copy + 2 scrub lines
    const ed = L.out >= ${(DUR - 0.25).toFixed(2)} ? 0.12 : 0.16;
    tl.to(line, { x: -60, opacity: 0, duration: 0.12, ease: "power2.in" }, L.out);
    tl.set(echo, { opacity: 0.35 }, L.out + 0.01);
    tl.to(echo, { x: -110, opacity: 0, duration: ed, ease: "power2.in" }, L.out + 0.02);
    tl.set([line, echo], { display: "none" }, Math.min(L.out + 0.22, ${(DUR - 0.02).toFixed(2)}));
    [0.6, 0.25, 0.5, 0].forEach((o, k) => {
      tl.set(["#scrub1","#scrub2"], { opacity: o }, Math.min(L.out + k * F, ${(DUR - 0.02).toFixed(2)}));
    });
  });
${
  b.yield
    ? `
  // rail yields while the apex lands (dim clamped ≥ line-in; restore only with runway)
  VRAIL.forEach((L) => {
    if (L.in < I + 0.9 && L.out > I - 0.3) {
      const dimT = Math.max(I - ${(b.yield.pre || 0.2).toFixed(2)}, L.in + 0.05);
      if (L.out > dimT + 0.25) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.12, ease: "power1.in" }, dimT);
        const resT = I + ${(b.yield.post || 0.9).toFixed(2)};
        if (resT + 0.3 < L.out) tl.to("#" + L.id, { opacity: 1, duration: 0.25 }, resT);
      }
    }
  });`
    : ""
}

  // idle tape noise in dead air
  VRAIL.filter((L) => L.gag).forEach((L) => {
    tl.set("#drift", { opacity: 0.12 }, L.out + 0.2);
    tl.fromTo("#drift", { y: 0 }, { y: -55, duration: 0.5, ease: "none" }, L.out + 0.2);
    tl.set("#drift", { opacity: 0 }, L.out + 0.7);
  });

  // ===== REC FREEZE artifacts (apex-coupled, in FRONT of the subject) =====
  // 1-frame full white tear band
  tl.set("#tear", { opacity: 0.95 }, I);
  tl.set("#tear", { opacity: 0 }, I + F);
  // ● REC blinks top-right (1-frame glitch entrance)
  tl.set("#rec", { opacity: 1, x: 6 }, I + 0.04);
  tl.set("#rec", { x: 0 }, I + 0.04 + F);
  [[0.49, 0], [0.79, 1], [1.24, 0], [1.54, 1]].forEach(([dt, o]) => {
    if (I + dt < X - 0.05) tl.set("#rdot", { opacity: o }, I + dt);
  });
  tl.set("#rec", { opacity: 0 }, X);
  // head-switching noise bar: sets every frame for 10 frames
  const HSX = [0, 140, 60, 220, 30, 180, 90, 250, 10, 120];
  HSX.forEach((px, k) => {
    tl.set("#hsbar", { opacity: k % 2 ? 0.62 : 0.9, backgroundPositionX: px + "px" }, I + k * F);
  });
  tl.set("#hsbar", { opacity: 0 }, I + 10 * F);

  // apex REWIND exit: 2 scrub lines at the apex band
  [0.6, 0.25, 0.5, 0].forEach((o, k) => tl.set(["#scrub3","#scrub4"], { opacity: o }, X + k * F));
  // head-switch reprise on the final rewind
  [[0, 0.85, 40], [0.04, 0.6, 190], [0.08, 0.8, 90]].forEach(([dt, o, px]) => {
    tl.set("#hsbar", { opacity: o, backgroundPositionX: px + "px" }, ${lastOut.toFixed(3)} + dt);
  });
  tl.set("#hsbar", { opacity: 0 }, ${Math.min(lastOut + 0.12, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function paradigmHudrail() {
  // HUDRAIL: arcade-cabinet HUD. The whole frame plays through a CRT (scanline
  // + vignette overlays); body words coin-pop onto a docked HUD bar (2px accent
  // border, 1UP / CREDIT tags) with steps(2) pixel pops + a 1-frame white
  // coin-blip tick over the word; emphasis words run a 3-frame palette swap
  // (body -> accent -> magenta -> body). Lines exit by checkerboard dissolve
  // (words vanish in 2 alternating 2-frame passes). The 1UP tag blinks on the
  // classic attract cadence all clip; the HUD yields while the boss lands.
  const b = dna.body;
  const bar = b.bar || {};
  const barH = bar.h || 70,
    inset = bar.inset || 24,
    barBot = bar.bottom || 50;
  const barTop = H - barBot - barH;
  const tags = b.tags || {};
  const A = dna.palette.accent,
    MG = dna.palette.magenta || "#FF2E88";
  const lineData = LINES.map((L, i) => ({
    id: "h" + L.id,
    in: +L.in.toFixed(3),
    // checkerboard exit start: just before the next line's first pop
    xo: i + 1 < LINES.length ? +(L.out - 0.04).toFixed(3) : +Math.min(L.out, DUR - 0.11).toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const css = `
  #hud   { position:absolute; left:${inset}px; top:${barTop}px; width:${W - 2 * inset}px; height:${barH}px;
           opacity:0; background:rgba(3,8,18,0.84); border:2px solid ${A};
           box-shadow:0 0 16px ${A}59, inset 0 0 24px ${A}14; z-index:3; }
  .hln   { position:absolute; left:50%; top:50%; white-space:nowrap; opacity:0;
           font-family:'${dna.fonts.body}', monospace; font-size:${b.fontPx}px; line-height:1;
           ${b.textTransform ? "text-transform:" + b.textTransform + ";" : ""}
           color:${dna.palette.body}; text-shadow:0 3px 0 rgba(0,0,0,0.6); }
  .hw    { position:relative; display:inline-block; margin-right:0.45em; opacity:0; }
  .hw:last-child { margin-right:0; }
  .htick { position:absolute; inset:-3px; background:#ffffff; opacity:0; }
  #tagL  { position:absolute; left:18px; top:50%; transform:translateY(-50%);
           font-family:'${dna.fonts.tag}', monospace; font-size:15px; color:${dna.palette.yellow || A};
           text-shadow:0 2px 0 rgba(0,0,0,0.6); }
  #tagR  { position:absolute; right:18px; top:50%; transform:translateY(-50%);
           font-family:'${dna.fonts.tag}', monospace; font-size:12px; color:${dna.palette.credit || A};
           text-shadow:0 2px 0 rgba(0,0,0,0.6); }
  #crtvig  { position:absolute; inset:0; opacity:0; z-index:20; pointer-events:none;
           background:radial-gradient(120% 95% at 50% 46%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.34) 100%); }
  #crtscan { position:absolute; inset:0; opacity:0; z-index:21; pointer-events:none;
           background:repeating-linear-gradient(180deg, rgba(0,0,0,0.9) 0px, rgba(0,0,0,0.9) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 5px); }`;
  const html = `      <div id="hud">
        <div id="tagL">${esc(tags.left || "1UP")}</div>
        <div id="tagR">${esc(tags.right || "CREDIT 01")}</div>
${lineData.map((L) => `        <div class="hln" id="${L.id}"></div>`).join("\n")}
      </div>
      <div id="crtvig"></div>
      <div id="crtscan"></div>`;
  const js = `
  // ---- body paradigm: HUDRAIL (coin-pop words on an arcade HUD bar) ----
  // world overlays: scanlines + slight vignette
  tl.set("#crtscan", { opacity: ${b.scan ?? 0.06} }, 0.03);
  tl.set("#crtvig",  { opacity: 1 },    0.03);
  // HUD bar boots up
  tl.set("#hud", { opacity: 1 }, 0.05);
  tl.fromTo("#hud", { y: 14 }, { y: 0, duration: 0.12, ease: "steps(2)" }, 0.05);
  // 1UP blink, classic cadence (baked sets)
  for (let t = 0.28, k = 0; t < ${(DUR - 0.06).toFixed(2)}; t += 0.45, k++) {
    tl.set("#tagL", { opacity: k % 2 === 0 ? 0.3 : 1 }, t);
  }
  const HUD = ${J(lineData)};
  HUD.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt]) => {
      const w = document.createElement("span"); w.className = "hw"; w.textContent = txt;
      const tick = document.createElement("div"); tick.className = "htick";
      w.appendChild(tick); line.appendChild(w);
    });
    gsap.set(line, { xPercent: -50, yPercent: -50 });
    tl.set(line, { opacity: 1 }, L.in);
    L.words.forEach(([txt, st, em], wi) => {
      const el = line.children[wi], tick = el.lastChild;
      // coin pop: instant-on + steps(2) scale from the baseline + 1-frame blip
      tl.set(el, { opacity: 1 }, st);
      tl.fromTo(el, { scale: 0 }, { scale: 1, duration: 0.12, ease: "steps(2)",
                                    transformOrigin: "50% 100%" }, st);
      tl.set(tick, { opacity: 0.95 }, st);                // coin blip, exactly 1 frame
      tl.set(tick, { opacity: 0 }, st + 0.042);
      if (em) {  // 3-frame palette swap (body -> accent -> magenta -> body)
        tl.set(el, { color: ${J(A)} }, st + 0.13);
        tl.set(el, { color: ${J(MG)} }, st + 0.172);
        tl.set(el, { color: ${J(dna.palette.body)} }, st + 0.214);
      }
    });
    // checkerboard dissolve: words vanish in 2 alternating set passes
    L.words.forEach((w, wi) => {
      tl.set(line.children[wi], { opacity: 0 },
             wi % 2 === 0 ? L.xo : Math.min(L.xo + 0.083, ${(DUR - 0.03).toFixed(2)}));
    });
    tl.set(line, { opacity: 0, display: "none" }, Math.min(L.xo + 0.15, ${(DUR - 0.02).toFixed(2)}));
  });
${
  b.yield
    ? `  // HUD yields while the boss lands (restore only with runway)
  tl.to("#hud", { opacity: ${b.yield.dim}, duration: 0.15, ease: "power1.in" }, ${(heroIn - (b.yield.pre || 0.2)).toFixed(3)});
${
  heroIn + (b.yield.post || 0.9) + 0.3 < DUR - 0.1
    ? `  tl.to("#hud", { opacity: 1, duration: 0.25, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.9)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css, html, js };
}

function paradigmTickerrail() {
  // TICKERRAIL: a market-terminal feed docked at the bottom. Transcript words
  // PRINT into a dark glass band behind seeded ▲▼ tick prefixes — instant-on
  // then a steps(2) 2-frame up-tick pop (scale 1.16 + 9px lift, color flashes
  // HOT → INK): the apex surge motif at low amplitude. Emphasis words light a
  // green surge glow + a small price counter that rolls up beside them (the
  // odometer at body scale). A header (feed name / index / pct / vol) ticks
  // through seeded values, and a seeded mini candlestick chart drifts one
  // candle per ~0.5s on the right (one breakout candle pulses near the apex —
  // the chart echo of the climax). Lines exit by flipping RED, dropping 1
  // frame, and fading (the trade closes). The band yields while the apex lands.
  const b = dna.body;
  const P = dna.palette;
  const GRN = P.up || P.accent || "#1fd66b",
    RED = P.down || "#ff4d4d",
    INK = P.body || "#eafff4",
    HOT = P.hot || "#d9ffe9",
    DIM = P.dim || "#3f8f63";
  const bandH = b.bandH || 118;
  const inset = b.inset ?? 36;
  const tagFam = dna.fonts.tag || "VT323";
  const seed = b.seed || 4470611;
  const hdr = b.header || {};
  // price-counter targets ride on emphasis (minor) words, in transcript order
  const ctrs = (b.counters || []).slice();
  const lineData = LINES.map((L, i) => ({
    id: "tk" + L.id,
    out:
      i + 1 < LINES.length
        ? +(LINES[i + 1].words[0].start - 0.01).toFixed(3)
        : +Math.min(L.out, DUR - 0.1).toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  // header counter scripts (seeded around the apex surge)
  const idxV = hdr.idx || [];
  const pctV = hdr.pct || [];
  const volV = hdr.vol || [];
  const css = `
  #tkband { position:absolute; left:0; bottom:0; width:${W}px; height:${bandH}px; opacity:1;
            background: rgba(3,10,7,0.84); border-top:1px solid ${GRN}73;
            box-shadow: 0 -6px 30px rgba(0,0,0,0.45), inset 0 1px 0 ${GRN}1f; }
  #tkhdr { position:absolute; left:${inset}px; top:7px; font-family:'${tagFam}', monospace;
           font-size:20px; color:${DIM}; letter-spacing:2px; white-space:nowrap; }
  #tkidx { position:absolute; left:${inset + 304}px; top:7px; font-family:'${tagFam}', monospace;
           font-size:20px; color:${HOT}; letter-spacing:1px; }
  #tkpct { position:absolute; left:${inset + 484}px; top:7px; font-family:'${tagFam}', monospace;
           font-size:20px; color:${GRN}; letter-spacing:1px; }
  #tkvol { position:absolute; left:${inset + 624}px; top:7px; font-family:'${tagFam}', monospace;
           font-size:20px; color:${DIM}; letter-spacing:1px; }
  .tkrow { position:absolute; left:${inset}px; top:44px; opacity:0; white-space:nowrap;
           font-family:'${dna.fonts.body}', sans-serif; font-weight:600; font-size:${b.fontPx || 40}px;
           line-height:1.2; color:${INK}; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
  .tkrow .w { display:inline-block; opacity:0; margin-right:0.3em; }
  .tkrow .tk { display:inline-block; font-size:0.55em; vertical-align:0.32em; margin-right:0.18em; }
  .tkrow .tk.up { color:${GRN}; } .tkrow .tk.dn { color:${RED}; }
  .tkrow .pr { display:inline-block; opacity:0; font-family:'${tagFam}', monospace;
               font-size:0.65em; color:${GRN}; vertical-align:0.28em; margin-right:0.4em; letter-spacing:1px; }
  #tkchartwrap { position:absolute; left:${W - 328}px; top:16px; width:300px; height:86px;
                 overflow:hidden; border-left:1px solid ${GRN}40; }
  #tkstrip { position:absolute; left:0; top:0; width:600px; height:86px; }
  .tkcw { position:absolute; width:2px; background:${HOT}8c; }
  .tkcb { position:absolute; width:13px; }`;
  const html = `      <div id="tkband">
        <div id="tkhdr">${esc(hdr.left || "OBS-CAP · LIVE FEED_")}</div>
        <div id="tkidx">${esc(hdr.idx0 || "4,212.88")}</div>
        <div id="tkpct">&#9650; ${esc(hdr.pct0 || "0.42%")}</div>
        <div id="tkvol">${esc(hdr.vol0 || "VOL 88.4K")}</div>
${lineData.map((L) => `        <div class="tkrow" id="${L.id}"></div>`).join("\n")}
        <div id="tkchartwrap"><div id="tkstrip"></div></div>
      </div>`;
  const js = `
  // ---- body paradigm: TICKERRAIL (market-feed band, tick-pop word printing) ----
  const tkrnd = mulberry32(${seed});
  const GRN = ${J(GRN)}, RED = ${J(RED)}, INK = ${J(INK)}, HOT = ${J(HOT)};
  // band boots up from below
  tl.fromTo("#tkband", { y: ${bandH + 12} }, { y: 0, duration: 0.26, ease: "power3.out" }, 0.03);
  const TKL = ${J(lineData)};
  const TKCTR = ${J(ctrs)};
  let tkCi = 0;
  TKL.forEach((L) => {
    const line = document.getElementById(L.id);
    const els = [];
    L.words.forEach(([txt, st, em]) => {
      const ctr = em ? (TKCTR[tkCi++] ?? null) : null;
      const up = ctr ? true : tkrnd() < 0.62;
      const tk = document.createElement("span");
      tk.className = "tk " + (up ? "up" : "dn");
      tk.textContent = up ? "\\u25B2" : "\\u25BC";
      const w = document.createElement("span"); w.className = "w";
      w.appendChild(tk); w.appendChild(document.createTextNode(txt));
      line.appendChild(w);
      let pr = null;
      if (ctr) { pr = document.createElement("span"); pr.className = "pr"; pr.textContent = "+0.0%"; line.appendChild(pr); }
      els.push([w, tk, pr, st, ctr]);
    });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);
    els.forEach(([w, tk, pr, st, ctr]) => {
      // print-in = the surge at low amplitude: quantized 2-frame up-tick pop
      tl.set(w, { opacity: 1, y: 9, scale: 1.16, color: HOT, transformOrigin: "0% 80%" }, st);
      tl.to(w, { y: 0, scale: 1, duration: 0.084, ease: "steps(2)" }, st + 0.001);
      if (ctr) {
        tl.set(w, { color: ${J(P.emGlow || "#8dffc0")},
                    textShadow: "0 0 16px " + GRN + "d9, 0 2px 8px rgba(0,0,0,0.7)" }, st + 0.09);
        tl.set(pr, { opacity: 1, y: 4 }, st + 0.13);
        tl.to(pr, { y: 0, duration: 0.084, ease: "steps(2)" }, st + 0.131);
        const steps = 4, target = parseFloat(ctr);
        for (let k = 1; k <= steps; k++) {
          const v = (target * Math.pow(k / steps, 0.6)).toFixed(1);
          tl.set(pr, { textContent: "+" + v + "%" }, st + 0.13 + k * 0.055);
        }
      } else {
        tl.to(w, { color: INK, duration: 0.22, ease: "power1.in" }, st + 0.10);
      }
    });
    // EXIT: tick out red — color flips, 1-frame 4px drop, fade
    const kids = [];
    els.forEach(([w, tk, pr]) => { kids.push(w, tk); if (pr) kids.push(pr); });
    tl.set(kids, { color: RED, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }, L.out);
    tl.set(line, { y: 4 }, L.out + 0.042);
    tl.to(line, { opacity: 0, duration: 0.10, ease: "power1.in" }, L.out + 0.084);
    tl.set(line, { display: "none" }, Math.min(L.out + 0.25, ${(DUR - 0.02).toFixed(2)}));
  });

  // ===== MINI CANDLESTICK CHART (24 seeded candles, drifts 1 per ~0.5s) =====
  const tkstrip = document.getElementById("tkstrip");
  let tko = 46; const tkBreak = ${b.breakoutCandle ?? 18};
  const tkBodies = [];
  for (let i = 0; i < 24; i++) {
    let c;
    if (i === tkBreak) { tko = 62; c = 8; }
    else if (i > tkBreak) { c = 10 + tkrnd() * 14; tko = c + 4 + tkrnd() * 10; }
    else { c = Math.max(8, Math.min(74, tko + (tkrnd() - 0.5) * 30)); }
    const up = c < tko;
    const top = Math.min(tko, c), h = Math.max(4, Math.abs(tko - c));
    const wickT = Math.max(2, top - 2 - tkrnd() * 7);
    const wickB = Math.min(84, top + h + 2 + tkrnd() * 7);
    const wick = document.createElement("div"); wick.className = "tkcw";
    wick.style.left = (i * 25 + 11) + "px"; wick.style.top = wickT + "px"; wick.style.height = (wickB - wickT) + "px";
    tkstrip.appendChild(wick);
    const body = document.createElement("div"); body.className = "tkcb";
    body.style.left = (i * 25 + 5) + "px"; body.style.top = top + "px"; body.style.height = h + "px";
    body.style.background = up ? GRN : RED;
    if (i === tkBreak) body.style.boxShadow = "0 0 10px " + GRN + "e6";
    tkstrip.appendChild(body); tkBodies.push(body);
    if (i < tkBreak) tko = c;
  }
  tl.to("#tkstrip", { x: -300, duration: ${Math.min(6.0, DUR - 0.04).toFixed(2)}, ease: "steps(12)" }, 0);
  ${
    !HEROLESS
      ? `tl.set(tkBodies[tkBreak], { filter: "brightness(1.9)" }, ${Math.max(0, heroIn - 0.09).toFixed(3)});
  tl.to(tkBodies[tkBreak], { filter: "brightness(1)", duration: 0.5, ease: "power2.out" }, ${(heroIn + 0.24).toFixed(3)});`
      : ""
  }

  // ===== HEADER COUNTERS TICK =====
  const TKIDX = ${J(idxV)}; TKIDX.forEach(([t, v]) => tl.set("#tkidx", { textContent: v }, t));
  const TKPCT = ${J(pctV)}; TKPCT.forEach(([t, v]) => tl.set("#tkpct", { textContent: v }, t));
  const TKVOL = ${J(volV)}; TKVOL.forEach(([t, v]) => tl.set("#tkvol", { textContent: v }, t));
${
  b.yield && !heroInline && !HEROLESS
    ? `  // band yields while the apex lands (rule 3)
  tl.to("#tkband", { opacity: ${b.yield.dim ?? 0.55}, duration: 0.2, ease: "power1.in" }, ${(heroIn - (b.yield.pre ?? 0.06)).toFixed(3)});
${
  heroIn + (b.yield.post ?? 0.9) + 0.3 < DUR - 0.1
    ? `  tl.to("#tkband", { opacity: 1, duration: 0.3, ease: "power1.out" }, ${(heroIn + (b.yield.post ?? 0.9)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css, html, js };
}

function paradigmCarbonstrip() {
  // CARBONSTRIP: cold-war case-file transcript strip docked on the clearer
  // side (manila gradient, punch holes, faint red watermark, typed case
  // header). Carbon type HAMMERS in per word — per-char sets 30ms apart,
  // scale 1.35→1 in one frame (the stamp motif at low amplitude) — every
  // strike kicks the strip 1px (y-channel locked while the strip itself is
  // tweened); seeded ±1.2px baselines + seeded ribbon-ink weight. Emphasis
  // words get a red ink ellipse drawn around them. Lines live on up to
  // body.rows fixed slots; PAGES (broken at full rows, dead-air gaps > 0.7s,
  // and after the hero hand-off line — it is filed away while the stamp owns
  // the frame) exit by X-row over-strike (3 chunks per line, lines 0.16s
  // apart) then a carriage yank-down feed; the final page is pulled with the
  // whole strip at clip end. The strip top-shadow breathes during the
  // stamp's dead-still hold; the strip yields (body.yield) while it lands.
  const b = dna.body;
  const p = dna.hero.params || {};
  const C = heroIn + (p.crush ?? 0.074); // stamp contact (shared with rubberstamp)
  const SW = (b.strip && b.strip.w) || 764,
    SH = (b.strip && b.strip.h) || 132;
  const SX = (b.strip && b.strip.x) ?? (CLEARER === "left" ? 48 : W - 48 - SW);
  const ST = H - ((b.strip && b.strip.bottomPx) ?? 4) - SH;
  const ROWS = b.rows || [36, 82];
  const FY = +(DUR - 0.1).toFixed(3); // final carriage yank (the file is pulled)
  const HDR = b.header || "TRANSCRIPT OF RECORDING";
  const hdrW = Math.round(HDR.length * 11.4);
  const hdrSteps = Math.max(8, Math.round(HDR.length * 0.58));
  const rgb = (h) =>
    [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].map((x) => parseInt(x, 16)).join(",");
  const ACC = dna.palette.accent || "#b3271e";
  // ---- pages: up to ROWS.length lines per carriage feed ----
  const pages = [];
  let cur = [];
  LINES.forEach((L, i) => {
    cur.push(L);
    const next = LINES[i + 1];
    const heroLine = heroIn >= L.in - 0.01 && heroIn < L.out;
    const gap = next ? next.words[0].start - L.words[L.words.length - 1].end : 0;
    if (!next || cur.length === ROWS.length || heroLine || gap > 0.7) {
      pages.push(cur);
      cur = [];
    }
  });
  // ---- exit schedule: X-strike chunks (0.05s apart, lines 0.16s apart) →
  // yank → hide → carriage return. Roomy cadence in dead air, compressed
  // when the next page is close (both cadences are the demo's). The whole
  // exit always completes before the next page's first hammer strike.
  const YLOCK = [[0, 0.215]]; // strip-y tween windows: no kicks inside
  const pageData = pages.map((pg, pi) => {
    const lines = pg.map((L, k) => ({
      id: "d" + L.id,
      top: ROWS[k],
      n: L.words.reduce((a, w) => a + w.display.length, 0) + L.words.length - 1,
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    }));
    if (pi === pages.length - 1) {
      YLOCK.push([+(FY - 0.01).toFixed(3), +(DUR + 0.02).toFixed(3)]);
      return { lines, xs: null, yank: null, limit: FY };
    }
    const lastW = pg[pg.length - 1].words;
    const lastEnd = lastW[lastW.length - 1].end;
    const nextIn = +(pages[pi + 1][0].words[0].start - 0.02).toFixed(3);
    const n = pg.length;
    const roomySpan = 0.16 * (n - 1) + 0.55,
      tightSpan = 0.16 * (n - 1) + 0.3;
    let xt0 = lastEnd + 0.33,
      roomy = true;
    if (xt0 + roomySpan > nextIn) {
      xt0 = Math.max(lastEnd + 0.18, nextIn - roomySpan);
      if (xt0 + roomySpan > nextIn + 0.001) {
        roomy = false;
        xt0 = Math.max(lastEnd + 0.15, nextIn - tightSpan);
      }
    }
    xt0 = +xt0.toFixed(3);
    const lastChunkEnd = xt0 + 0.16 * (n - 1) + 0.1;
    const yankT = +(lastChunkEnd + (roomy ? 0.14 : 0.07)).toFixed(3);
    const yankDur = roomy ? 0.1 : 0.07;
    const hideT = +(yankT + (roomy ? 0.11 : 0.07)).toFixed(3);
    const returnT = +(yankT + (roomy ? 0.13 : 0.075)).toFixed(3);
    const returnDur = roomy ? 0.18 : 0.055;
    const fits = xt0 + (roomy ? roomySpan : tightSpan) <= nextIn + 0.02;
    YLOCK.push([+(yankT - 0.01).toFixed(3), +(returnT + returnDur).toFixed(3)]);
    return {
      lines,
      xs: fits ? xt0 : null,
      yank: [yankT, yankDur, hideT, returnT, returnDur],
      limit: hideT,
    };
  });
  // red-circle draw durations clamp inside the word's page life
  pageData.forEach((pg) =>
    pg.lines.forEach((ln) =>
      ln.words.forEach((wd) => {
        if (wd[2]) {
          const circT = wd[1] + wd[0].length * 0.03 + 0.02;
          wd.push(+Math.min(0.25, Math.max(0.14, pg.limit - circT - 0.02)).toFixed(3));
        }
      }),
    ),
  );
  const css = `
  #strip { position:absolute; left:${SX}px; top:${ST}px; width:${SW}px; height:${SH}px; opacity:0;
           background: linear-gradient(180deg, #e0cda6 0%, ${dna.palette.paper || "#d8c49a"} 42%, #ccb486 100%);
           border:1px solid rgba(106,86,48,0.9); border-radius:2px;
           box-shadow: inset 0 1px 0 rgba(255,250,235,0.5), inset 0 -14px 22px rgba(95,74,38,0.18); }
  #shade { position:absolute; left:2px; right:2px; top:-16px; height:16px; opacity:0.5;
           background: linear-gradient(180deg, rgba(15,10,4,0) 0%, rgba(15,10,4,0.38) 100%); }
  .hole { position:absolute; left:14px; width:13px; height:13px; border-radius:50%;
          background:rgba(58,45,24,0.34); box-shadow: inset 0 2px 2px rgba(30,22,10,0.5), 0 1px 0 rgba(255,248,230,0.45); }
  #wm { position:absolute; right:18px; top:40px; font-family:'${dna.fonts.tag}', serif;
        font-size:32px; letter-spacing:7px; color:rgba(${rgb(ACC)},0.13);
        transform:rotate(-6deg); white-space:nowrap; }
  #hdrwrap { position:absolute; left:52px; top:9px; overflow:hidden; white-space:nowrap; width:0; }
  #hdr { font-family:'${dna.fonts.tag}', serif; font-size:14px; letter-spacing:3px;
         color:${dna.palette.ink || "#8a6f3f"}; white-space:nowrap; }
  .ln { position:absolute; left:52px; font-family:'${dna.fonts.body}', serif; font-size:${b.fontPx}px;
        line-height:1; color:${dna.palette.body}; white-space:nowrap; }
  .ln .w { display:inline-block; position:relative; margin-right:0.5em; }
  .ln .c { display:inline-block; opacity:0; }
  .xrow { position:absolute; left:52px; font-family:'${dna.fonts.body}', serif; font-size:${b.fontPx}px;
          line-height:1; color:rgba(${rgb(ACC)},0.85); white-space:nowrap; }
  .xrow span { opacity:0; }
  .circ { position:absolute; left:-13px; top:-9px; width:calc(100% + 26px);
          height:calc(100% + 18px); overflow:visible; pointer-events:none; }
  .circ ellipse { fill:none; stroke:${ACC}; stroke-width:3.6; stroke-linecap:round; }`;
  const html = `      <div id="strip">
        <div id="shade"></div>
        <div class="hole" style="top:24px"></div>
        <div class="hole" style="top:${SH - 40}px"></div>
        <div id="wm">${esc(b.watermark || "CONFIDENTIAL")}</div>
        <div id="hdrwrap"><div id="hdr">${esc(HDR)}</div></div>
${pageData
  .flatMap((pg) => pg.lines)
  .map((ln) => `        <div class="ln" id="${ln.id}" style="top:${ln.top}px"></div>`)
  .join("\n")}
      </div>`;
  const shadeStart = +(C + 0.12).toFixed(3);
  const shadeDur = Math.min(1.5, FY - shadeStart - 0.05);
  const dimT = +(heroIn - ((b.yield && b.yield.pre) || 0.02)).toFixed(3);
  const resT = +(heroIn + ((b.yield && b.yield.post) || 0.41)).toFixed(3);
  const js = `
  // ---- body paradigm: CARBONSTRIP (typewriter hammer in / X-strike + carriage-feed out) ----
  const strip = document.getElementById("strip");
  const krnd = mulberry32(${b.seed || 180618});
  // y-channel windows where the strip is tweened — no kicks allowed inside
  const YLOCK = ${J(YLOCK)};
  function kick(t) {
    for (const [a, b] of YLOCK) if (t >= a && t <= b + 0.045) return;
    tl.set(strip, { y: 1 }, t);
    tl.set(strip, { y: 0 }, t + 0.042);
  }

  // ===== strip entrance: the carriage feeds the paper up =====
  tl.set(strip, { opacity: 1 }, 0.02);
  tl.fromTo(strip, { y: 130 }, { y: 0, duration: 0.19, ease: "power3.out" }, 0.02);
  tl.fromTo("#hdrwrap", { width: 0 }, { width: ${hdrW}, duration: 0.42, ease: "steps(${hdrSteps})" }, 0.10);

  // ===== body: typewriter hammer (per-char sets, 30ms apart) =====
  const PAGES = ${J(pageData)};
  const NS = "http://www.w3.org/2000/svg";
  const strikes = [], circles = [];
  PAGES.forEach((pg) => {
    pg.lines.forEach((ln) => {
      const line = document.getElementById(ln.id);
      ln.words.forEach(([txt, st, em, cd]) => {
        const w = document.createElement("span"); w.className = "w";
        [...txt].forEach((ch, i) => {
          const c = document.createElement("span"); c.className = "c"; c.textContent = ch;
          w.appendChild(c);
          strikes.push([c, st + i * 0.03]);
        });
        if (em) {
          const svg = document.createElementNS(NS, "svg");
          svg.setAttribute("class", "circ"); svg.setAttribute("viewBox", "0 0 120 64");
          svg.setAttribute("preserveAspectRatio", "none");
          const el = document.createElementNS(NS, "ellipse");
          el.setAttribute("cx", 60); el.setAttribute("cy", 32);
          el.setAttribute("rx", 55); el.setAttribute("ry", 25);
          el.setAttribute("transform", "rotate(-4 60 32)");
          svg.appendChild(el); w.appendChild(svg);
          circles.push([el, st + txt.length * 0.03 + 0.02, cd]);
        }
        line.appendChild(w);
      });
    });
  });
  strikes.forEach(([c, t]) => {
    const off = (krnd() - 0.5) * 2.4;                  // ±1.2px baseline wobble
    const ink = 0.84 + krnd() * 0.16;                  // uneven ribbon ink
    gsap.set(c, { y: off, transformOrigin: "50% 85%" });
    tl.set(c, { opacity: ink, scale: 1.35 }, t);       // hammer = the stamp motif, low amplitude
    tl.set(c, { scale: 1 }, t + 0.042);
    kick(t);                                           // every strike kicks the strip
  });
  // red ink circles draw around the emphasis words
  circles.forEach(([el, t, d]) => {
    const len = el.getTotalLength();
    gsap.set(el, { attr: { "stroke-dasharray": len, "stroke-dashoffset": len } });
    tl.to(el, { attr: { "stroke-dashoffset": 0 }, duration: d, ease: "power2.inOut" }, t);
  });

  // ===== exits: X-row over-strike (3 chunks per line) then carriage yank =====
  PAGES.forEach((pg) => {
    const hides = pg.lines.map((ln) => "#" + ln.id);
    if (pg.xs != null) pg.lines.forEach((ln, k) => {
      const row = document.createElement("div");
      row.className = "xrow"; row.style.top = (ln.top + 2) + "px";
      strip.appendChild(row); hides.push(row);
      const third = Math.max(1, Math.ceil(ln.n / 3));
      let left = ln.n;
      for (let j = 0; j < 3 && left > 0; j++) {
        const nC = Math.min(third, left); left -= nC;
        const s = document.createElement("span"); s.textContent = "X".repeat(nC);
        row.appendChild(s);
        const t = pg.xs + k * 0.16 + j * 0.05;
        tl.set(s, { opacity: 1 }, t);
        kick(t);
      }
    });
    if (pg.yank) {
      const [yt, yd, ht, rt, rd] = pg.yank;
      tl.to(strip, { y: 30, duration: yd, ease: "power3.in" }, yt);
      tl.set(hides, { opacity: 0 }, ht);
      tl.to(strip, { y: 0, duration: rd, ease: "power2.out" }, rt);
    }
  });
${
  b.yield
    ? `
  // ===== apex etiquette: the strip yields while the stamp lands =====
  tl.to(strip, { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.in" }, ${dimT});
${resT + 0.3 < FY ? `  tl.to(strip, { opacity: 1, duration: 0.25, ease: "power1.out" }, ${resT});` : ""}`
    : ""
}
${
  shadeDur > 0.4
    ? `
  // strip top-shadow breathes during the stamp's dead-still hold
  tl.to("#shade", { keyframes: { opacity: [0.5, 0.72, 0.54, 0.7, 0.55, 0.66, 0.5] },
                    duration: ${shadeDur.toFixed(2)}, ease: "none" }, ${shadeStart});`
    : ""
}

  // ===== ending: the file is pulled — strip yanks down and is gone =====
  tl.to(strip, { y: 34, duration: 0.09, ease: "power3.in" }, ${FY});
  tl.to(strip, { opacity: 0, duration: 0.06 }, ${(FY + 0.02).toFixed(3)});`;
  return { css, html, js };
}

function paradigmLaserrail() {
  // LASERRAIL: concert lower third — every word is IGNITED where two thin
  // laser beams (accent from the top-left, magenta from the top-right) sweep
  // to CONVERGE on its position 2 frames early; at convergence a flare pops
  // and the word snaps on in laser color (the apex motif at low amplitude:
  // crush → contact squash → elastic settle, brightness cool). Emphasis words
  // strobe once (1 frame off / back on) and their beams linger. Exits: a
  // sweeper beam crosses L→R and carries the words (streak x+44 + blur).
  // Word centers are BAKED at compile time from the measured char-width table
  // (assets/fonts/char-widths.json) so font-load timing can't skew beam aim
  // (calibrated vs the t37 demo's browser-measured table: ≤3px/word).
  const b = dna.body;
  const fam = dna.fonts.body;
  const m = famMetrics(fam) || { ascent: 0.8, descent: 0.2, widths: {} };
  const lsEm = parseFloat(b.letterSpacing) || 0;
  const gapEm = b.wordGapEm ?? 0.24;
  const railBot = H - b.bottomPx;
  const emPx = Math.round(b.fontPx * (b.minorScale || 1.325));
  const A = dna.palette.accent;
  const lineData = LINES.map((L, i) => {
    const words = L.words.map((w) => ({
      txt: b.textTransform === "uppercase" ? w.display.toUpperCase() : w.display,
      st: +w.start.toFixed(3),
      em: w.minor ? 1 : 0,
    }));
    // centered-line layout, baked in px (CSS model: inline-blocks on one
    // baseline, margin 0 <gapEm>em, tracking after every char incl the last)
    const pxs = words.map((w) => (w.em ? emPx : b.fontPx));
    const ws = words.map((w, k) => wordPx(w.txt, fam, pxs[k], lsEm));
    const total = ws.reduce((a, x, k) => a + x + 2 * gapEm * pxs[k], 0);
    const maxPx = Math.max(...pxs);
    const baseline = railBot - (maxPx * (1 - m.ascent + m.descent)) / 2;
    let cur = W / 2 - total / 2;
    const pos = words.map((w, k) => {
      const cx = cur + gapEm * pxs[k] + ws[k] / 2;
      cur += ws[k] + 2 * gapEm * pxs[k];
      return [
        Math.round(cx),
        Math.round(baseline - (pxs[k] * (m.ascent - m.descent)) / 2),
        Math.round(ws[k]),
      ];
    });
    // sweep starts so the carried words clear before the next line's beams own
    // the rail; last line keeps the demo's end-of-clip runway
    const sweepT =
      i + 1 < LINES.length
        ? +(L.out - 0.14).toFixed(3)
        : +Math.min(L.out - 0.14, DUR - 0.26).toFixed(3);
    return {
      id: "lr" + L.id,
      in: +L.in.toFixed(3),
      sweepT,
      words: words.map((w) => [w.txt, w.st, w.em]),
      pos,
    };
  });
  const css = `
  #lrfx { position:absolute; inset:0; }
  .lrline { position:absolute; left:${W / 2}px; top:${railBot}px; opacity:0; white-space:nowrap;
          font-family:'${fam}', sans-serif; font-size:${b.fontPx}px; line-height:1;
          letter-spacing:${b.letterSpacing || "0.02em"}; color:${dna.palette.body};
          ${b.textTransform ? "text-transform:" + b.textTransform + ";" : ""}
          text-shadow: 0 0 10px ${A}bf, 0 0 26px ${A}61, 0 2px 6px rgba(0,0,0,0.7); }
  .lrline .w { display:inline-block; opacity:0; margin:0 ${gapEm}em; }
  .lrline .w.em { font-size:${emPx}px;
          text-shadow: 0 0 14px ${A}e6, 0 0 34px ${A}80, 0 2px 6px rgba(0,0,0,0.7); }
  .lflare { position:absolute; width:54px; height:54px; border-radius:50%; opacity:0;
            background: radial-gradient(circle, rgba(220,255,235,0.95) 0%, ${A}80 40%, ${A}00 70%); }
  .lsweep { position:absolute; width:3px; height:88px; opacity:0;
           background: linear-gradient(180deg, ${A}00 0%, rgba(230,255,242,0.95) 45%, ${A}00 100%);
           filter: drop-shadow(0 0 6px ${A}); }`;
  const html =
    `      <svg id="lrfx" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <g id="gLR"></g>
      </svg>\n` + lineData.map((L) => `      <div class="lrline" id="${L.id}"></div>`).join("\n");
  const js = `
  // ---- body paradigm: LASERRAIL (per-word beam-converge ignition) ----
  const LACC = ${J(A)}, LMAG = ${J(dna.palette.magenta || "#ff4df0")};
  const NSL = "http://www.w3.org/2000/svg";
  const lrStage = document.getElementById("stage");
  const gLR = document.getElementById("gLR");
  function lrLine(x1, y1, x2, y2, col, w) {
    const l = document.createElementNS(NSL, "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke", col); l.setAttribute("stroke-width", w);
    l.setAttribute("stroke-linecap", "round");
    l.style.opacity = 0; gLR.appendChild(l); return l;
  }
  const LRAIL = ${J(lineData)};
  LRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt, , em]) => {
      const s = document.createElement("span");
      s.className = "w" + (em ? " em" : ""); s.textContent = txt;
      line.appendChild(s);
    });
    gsap.set(line, { xPercent: -50, yPercent: -100, transformOrigin: "50% 100%" });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.03);
    L.words.forEach(([txt, st, em], wi) => {
      const el = line.children[wi];
      const [wx, wy] = L.pos[wi];
      // beams yield inside the apex window (the hero owns the light)
      const yld = (st > ${(heroIn - 0.41).toFixed(3)} && st < ${(heroIn + 0.99).toFixed(3)})
        ? ${b.yield ? (b.yield.beamDim ?? 0.55) : 1} : 1;
      const t0 = st - 0.21, cv = st - 0.083;
      // two beams converge on the word 2 frames before its time
      [[-25, -15, LACC, wx - 170], [${W + 25}, -15, LMAG, wx + 170]].forEach(([ex, ey, col, sx]) => {
        const halo = lrLine(ex, ey, sx, wy - 30, col, 5);
        const core = lrLine(ex, ey, sx, wy - 30, col, 1.5);
        tl.set(halo, { opacity: 0.24 * yld }, t0);
        tl.set(core, { opacity: 0.92 * yld }, t0);
        tl.to([halo, core], { attr: { x2: wx, y2: wy }, duration: cv - t0, ease: "power2.out" }, t0);
        tl.to([halo, core], { opacity: 0, duration: em ? 0.45 : 0.2, ease: "power1.in" }, st + 0.03);
      });
      // convergence flare
      const f = document.createElement("div");
      f.className = "lflare"; lrStage.appendChild(f);
      f.style.left = (wx - 27) + "px"; f.style.top = (wy - 27) + "px";
      tl.set(f, { opacity: 0.85, scale: 0.5 }, cv);
      tl.to(f, { scale: 1.35, opacity: 0, duration: 0.13, ease: "power2.out" }, st - 0.01);
      // IGNITE (apex motif at low amplitude): on in 1 frame, crush, squash, settle
      tl.set(el, { opacity: 1, scale: 1.12, filter: "brightness(1.85)", transformOrigin: "50% 80%" }, st);
      tl.to(el,  { scale: 1, duration: 0.09, ease: "power3.in" }, st + 0.005);
      tl.set(el, { scaleX: 1.05, scaleY: 0.94 }, st + 0.1);
      tl.to(el,  { scaleX: 1, scaleY: 1, duration: 0.3, ease: "elastic.out(1, 0.42)" }, st + 0.14);
      tl.to(el,  { filter: "brightness(1)", duration: 0.22, ease: "power2.out" }, st + 0.07);
      if (em) { // single strobe: 1 frame off, back on
        tl.set(el, { opacity: 0 }, st + 0.18);
        tl.set(el, { opacity: 1 }, st + 0.222);
      }
    });
    // hold life: gentle breathe + laser shimmer while the line waits
    const lastSt = L.words[L.words.length - 1][1];
    const free = L.sweepT - lastSt - 0.35;
    if (free > 0.45) {
      const half = Math.min(0.55, free / 2);
      tl.to(line, { scale: 1.013, duration: half, ease: "sine.inOut" }, lastSt + 0.35);
      tl.to(line, { scale: 1.0,   duration: half, ease: "sine.inOut" }, lastSt + 0.35 + half);
    }
    if (free > 0.9) {
      tl.to(line, { keyframes: { filter: ["brightness(1)","brightness(1.07)","brightness(1)","brightness(1.05)","brightness(1)"] },
                    duration: 0.9, ease: "none" }, lastSt + 0.5);
    }
    // EXIT: sweeper beam crosses L→R, words streak away as it passes them
    const xs = L.pos.map((p) => p[0]);
    const x0 = Math.min(...xs) - 46, x1 = Math.max(...xs) + 46;
    const sw = document.createElement("div");
    sw.className = "lsweep"; lrStage.appendChild(sw);
    sw.style.left = x0 + "px"; sw.style.top = (L.pos[0][1] - 58) + "px";
    tl.set(sw, { opacity: 0.9 }, L.sweepT);
    tl.to(sw,  { x: x1 - x0, duration: 0.13, ease: "power1.in" }, L.sweepT);
    tl.to(sw,  { opacity: 0, duration: 0.05 }, L.sweepT + 0.13);
    L.words.forEach((w, wi) => {
      const el = line.children[wi];
      const frac = (L.pos[wi][0] - x0) / Math.max(1, x1 - x0);
      tl.to(el, { x: 44, opacity: 0, filter: "blur(5px)", duration: 0.11, ease: "power2.in" },
            L.sweepT + 0.11 * frac);
    });
    tl.set(line, { display: "none" }, Math.min(L.sweepT + 0.32, ${(DUR - 0.02).toFixed(3)}));
  });
${
  b.yield
    ? `  // rail yields while the apex lands (restore only with clear runway)
  LRAIL.forEach((L) => {
    if (L.in < ${heroIn.toFixed(3)} + 0.9 && L.sweepT > ${heroIn.toFixed(3)} - 0.3) {
      const dimT = Math.max(${(heroIn - (b.yield.pre || 0.04)).toFixed(3)}, L.in + 0.05);
      if (L.sweepT > dimT + 0.25) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.15 }, dimT);
        const resT = ${(heroIn + (b.yield.post || 0.9)).toFixed(3)};
        if (resT + 0.3 < L.sweepT) tl.to("#" + L.id, { opacity: 1, duration: 0.25 }, resT);
      }
    }
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmStormrail() {
  // STORMRAIL: rain-washed lower third. Ambient rain = seeded thin streaks
  // falling on repeating linear cycle tweens (pure f(t), one wind vector,
  // mid-fall at t0); a second streak set DOUBLES the rain for ~1s after the
  // strike. Body words arrive with the lightning-kiss motif at low amplitude
  // (2-frame lit-bright pop + micro settle); emphasis = sheet-lightning double
  // flash (the bg sky double-kisses at the same beats). Exits wash downward
  // with the rain (y+22, blur). The visible line dims while the bolt lands and
  // its text-shadow flips toward the strike for the flash frames.
  const b = dna.body;
  const r = b.rain || {};
  const A = dna.palette.accent;
  const railTop = H - (b.bottomPx || 98);
  const sgn = (dna.hero.params || {}).side === "right" ? -1 : 1;
  const lineData = LINES.map((L) => ({
    id: "st" + L.id,
    in: +L.in.toFixed(3),
    // wash start: just before the next line — but a line facing dead air
    // washes away early (the demo's r1 exits at lastWord + 1.08s)
    out: +Math.min(L.out - 0.05, L.words[L.words.length - 1].end + 1.08, DUR - 0.2).toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const css = `
  #stscrim { position:absolute; left:0; right:0; top:${H - 180}px; height:180px; opacity:0;
    background:linear-gradient(to bottom, rgba(6,10,18,0) 0%, rgba(6,10,18,0.45) 45%, rgba(6,10,18,0.62) 100%); }
  #rain  { position:absolute; inset:0; opacity:${r.opacity ?? 0.08}; }
  #rain2 { position:absolute; inset:0; opacity:0; }
  .drop { position:absolute; left:0; top:0; width:2px; border-radius:1px;
    background:linear-gradient(to bottom, rgba(200,222,244,0) 0%, rgba(214,232,250,0.95) 100%); }
  .stline { position:absolute; left:${W / 2}px; top:${railTop}px; opacity:0; white-space:nowrap;
    font-family:'${dna.fonts.body}', sans-serif; font-weight:700; font-size:${b.fontPx}px; line-height:1.15;
    letter-spacing:${b.letterSpacing || "0.015em"}; color:${dna.palette.body};
    text-shadow: 0 6px 16px rgba(2,8,18,0.85), 0 2px 4px rgba(2,8,18,0.7), 0 0 14px ${A}47; }
  .stline .w { display:inline-block; opacity:0; margin:0 0.16em; }`;
  const html =
    `      <div id="rain"></div>
      <div id="stscrim"></div>
` +
    lineData.map((L) => `      <div class="stline" id="${L.id}"></div>`).join("\n") +
    `
      <div id="rain2"></div>`;
  const js = `
  // ---- body paradigm: STORMRAIL (lightning-kiss words, rain-wash exits, ambient rain) ----
  const I = ${heroIn.toFixed(3)};
  // ambient rain: seeded streaks on repeating linear cycles (f(t), no random at render)
  function makeRain(container, n, seed, t0, t1) {
    const rnd = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div");
      el.className = "drop"; container.appendChild(el);
      const x0 = 20 + rnd() * ${W - 40}, d = 0.55 + rnd() * 0.55;
      const len = 46 + rnd() * 70, frac = rnd();
      const travel = ${H + 300}, dx = -160; // slanted fall, one wind vector
      gsap.set(el, { height: len, rotation: 9, x: x0, y: -160 });
      let t = t0;
      // partial first cycle so rain is mid-fall at t0
      tl.fromTo(el, { y: -160 + travel * frac, x: x0 + dx * frac },
                    { y: ${H + 140}, x: x0 + dx, duration: d * (1 - frac), ease: "none" }, t);
      t += d * (1 - frac);
      while (t < t1) {
        tl.fromTo(el, { y: -160, x: x0 },
                      { y: ${H + 140}, x: x0 + dx, duration: d, ease: "none" }, t);
        t += d;
      }
    }
  }
  makeRain(document.getElementById("rain"),  ${r.count ?? 18}, ${r.seed ?? 9021}, 0, ${(DUR - 0.02).toFixed(2)});
  makeRain(document.getElementById("rain2"), ${r.count ?? 18}, ${r.seed2 ?? 4477}, ${(heroIn - 0.11).toFixed(3)}, ${Math.min(heroIn + 1.24, DUR - 0.02).toFixed(3)});
  // rain doubles for ~1s after the strike
  tl.set("#rain2", { opacity: 0.11 }, I + 0.02);
  tl.to("#rain2",  { opacity: 0, duration: 0.30 }, ${Math.min(heroIn + 1.02, DUR - 0.34).toFixed(3)});

  // rail scrim (stable reading surface against the busy lower frame)
  tl.to("#stscrim", { opacity: 1, duration: 0.20 }, 0.05);
  tl.to("#stscrim", { opacity: 0, duration: 0.16 }, ${(DUR - 0.18).toFixed(3)});

  const SRAIL = ${J(lineData)};
  SRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt]) => {
      const s = document.createElement("span");
      s.className = "w"; s.textContent = txt; line.appendChild(s);
    });
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.025);
    L.words.forEach(([txt, st, em], wi) => {
      const el = line.children[wi];
      // entrance = the apex motif at low amplitude: lit-bright pop + micro settle
      tl.set(el, { opacity: 1, y: 4, scale: 1.06, filter: "brightness(2.2)",
                   transformOrigin: "50% 85%" }, st);
      tl.to(el, { y: 0, scale: 1, duration: 0.12, ease: "power2.out" }, st + F);
      tl.to(el, { filter: "brightness(1)", duration: 0.14, ease: "power1.out" }, st + F);
      if (em && st + 0.20 + 3 * F < ${(DUR - 0.04).toFixed(2)}) { // sheet lightning: 2-frame double flash
        const t0 = st + 0.20;
        tl.set(el, { filter: "brightness(1.9)" }, t0);
        tl.set(el, { filter: "brightness(1.0)" }, t0 + F);
        tl.set(el, { filter: "brightness(1.8)" }, t0 + 2 * F);
        tl.to(el,  { filter: "brightness(1)", duration: 0.12 }, t0 + 3 * F);
      }
    });
    // EXIT: wash downward with the rain
    tl.to(line, { y: 22, opacity: 0, filter: "blur(3px)", duration: 0.18, ease: "power1.in" }, L.out);
    tl.set(line, { display: "none" }, Math.min(L.out + 0.20, ${(DUR - 0.02).toFixed(2)}));
  });
${
  b.yield
    ? `  // rail yields while the bolt lands; the visible line's shadow flips toward
  // the strike for the flash frames (light from the bolt side)
  SRAIL.forEach((L) => {
    if (L.in < I + 0.9 && L.out > I - 0.3) {
      const dimT = Math.max(I - ${(b.yield.pre ?? 0.15).toFixed(2)}, L.in + 0.05);
      if (L.out > dimT + 0.25) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.12 }, dimT);
        const resT = I + ${(b.yield.post ?? 0.29).toFixed(2)};
        if (resT + 0.3 < L.out) tl.to("#" + L.id, { opacity: 1, duration: 0.10 }, resT);
      }
    }
    if (L.in <= I - 2 * F && L.out > I) {
      tl.set("#" + L.id, { textShadow: "${12 * sgn}px 4px 12px rgba(2,8,18,0.85), 0 0 14px ${A}73" }, I - 2 * F);
      tl.set("#" + L.id, { textShadow: "0 6px 16px rgba(2,8,18,0.85), 0 2px 4px rgba(2,8,18,0.7), 0 0 14px ${A}47" }, I + 0.09);
    }
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmHolorail() {
  // HOLORAIL: a volumetric projection PLATE (scanlined glass slab with corner
  // brackets + feed tag) is the stable reading surface; it boots like a
  // projector turning ON (scaleY snap + 1-frame flicker) and breathes a slow
  // luminance cycle. Body words boot with the apex motif at low amplitude:
  // instant opacity + RISING sweep reveal (clip wipe), a 1-frame interference
  // x-glitch, and a constant chromatic-fringe text-shadow. Emphasis words get
  // a 2-frame projection DROPOUT that restores brighter, then settles. Each
  // line drifts slowly in rotationY (it IS a projection) and exits with the
  // projector-cut: brightness pop → collapse to a horizontal slit → to a dot.
  const b = dna.body;
  const A = dna.palette.accent,
    MG = dna.palette.magenta || "#ff5fd6";
  const plateW = b.plateW || 980,
    plateH = b.plateH || 96;
  const plateY = H - (b.bottomPx || 108); // plate center
  const lineY = plateY + (b.lineDy ?? 9); // line center sits low in the plate
  const lineData = LINES.map((L, i) => ({
    id: "hl" + L.id,
    // projector-cut start: completes (0.15s) before the next line boots;
    // the last line keeps the demo's end-of-clip runway
    exit: +(i + 1 < LINES.length ? L.out - 0.15 : Math.min(L.out + 0.07, DUR - 0.18)).toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const shadowBase = `-1.5px 0 0 ${A}8c, 1.5px 0 0 ${MG}6b, 0 0 16px ${A}80, 0 2px 8px rgba(1,10,16,0.85)`;
  const shadowEm = `-1.5px 0 0 ${A}cc, 1.5px 0 0 ${MG}99, 0 0 26px ${dna.palette.glowEm || "#A0F2FF"}d9, 0 2px 8px rgba(1,10,16,0.85)`;
  const css = `
  #railwrap { position:absolute; inset:0; }
  #plate { position:absolute; left:${W / 2}px; top:${plateY}px; width:${plateW}px; height:${plateH}px; opacity:0;
           border-radius:3px;
           background: linear-gradient(180deg, rgba(4,22,33,0.46) 0%, rgba(6,30,44,0.55) 100%);
           border: 1px solid ${A}52;
           box-shadow: 0 0 26px rgba(60,170,210,0.20), inset 0 0 38px ${A}0f; }
  #pscan { position:absolute; inset:0; border-radius:3px;
           background: repeating-linear-gradient(180deg, ${A}00 0px, ${A}00 3px, ${A}12 3px, ${A}12 4px); }
  #ptag { position:absolute; left:14px; top:7px; font-family:'${dna.fonts.tag}', sans-serif;
          font-weight:400; font-size:11px; letter-spacing:0.32em; color:${A}99; }
  .crn { position:absolute; width:11px; height:11px; }
  .crn.a { left:-1px;  top:-1px;    border-left:2px solid ${A}cc; border-top:2px solid ${A}cc; }
  .crn.b { right:-1px; top:-1px;    border-right:2px solid ${A}cc; border-top:2px solid ${A}cc; }
  .crn.c { left:-1px;  bottom:-1px; border-left:2px solid ${A}cc; border-bottom:2px solid ${A}cc; }
  .crn.d { right:-1px; bottom:-1px; border-right:2px solid ${A}cc; border-bottom:2px solid ${A}cc; }
  .hln { position:absolute; left:${W / 2}px; top:${lineY}px; opacity:0; white-space:nowrap;
        font-family:'${dna.fonts.body}', sans-serif; font-weight:500; font-size:${b.fontPx}px;
        line-height:1.15; letter-spacing:${b.letterSpacing || "0.02em"}; }
  .hln .w { display:inline-block; opacity:0; margin-right:0.3em;
           color:${dna.palette.body}ed;
           text-shadow: ${shadowBase}; }`;
  const html =
    `      <div id="railwrap">
        <div id="plate">
          <div id="pscan"></div>
          <div id="ptag">${esc(theme.plateTag || b.tag || "VOLUMETRIC FEED // CH-07")}</div>
          <div class="crn a"></div><div class="crn b"></div>
          <div class="crn c"></div><div class="crn d"></div>
        </div>
` +
    lineData.map((L) => `        <div class="hln" id="${L.id}"></div>`).join("\n") +
    `
      </div>`;
  // plate breathe: finite yoyo cycles sized to the runway before the end cut
  const pCut = +(DUR - 0.14).toFixed(3);
  const breaths = Math.max(1, Math.floor((pCut - 0.5) / 0.8) - 1);
  const js = `
  // ---- body paradigm: HOLORAIL (projection plate, sweep-boot words, projector-cut exits) ----
  gsap.set("#plate", { xPercent: -50, yPercent: -50, transformOrigin: "50% 50%" });

  // plate boots like a projector turning ON (inverse of the projector-cut exit)
  tl.set("#plate", { opacity: 1 }, 0.10);
  tl.fromTo("#plate", { scaleY: 0.03 }, { scaleY: 1, duration: 0.13, ease: "expo.out" }, 0.10);
  tl.set("#plate", { opacity: 0.35 }, 0.155);
  tl.set("#plate", { opacity: 1 }, 0.195);
  tl.to("#plate", { opacity: 0.93, duration: 0.8, ease: "sine.inOut", yoyo: true, repeat: ${breaths} }, 0.5);

  const HRAIL = ${J(lineData)};
  const HSH_BASE = ${J(shadowBase)}, HSH_EM = ${J(shadowEm)};
  HRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt], wi) => {
      const s = document.createElement("span");
      s.className = "w"; s.textContent = txt;
      if (wi === L.words.length - 1) s.style.marginRight = "0";
      line.appendChild(s);
    });
    gsap.set(line, { xPercent: -50, yPercent: -50, transformPerspective: 700, transformOrigin: "50% 50%" });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.03);

    L.words.forEach(([txt, st, em], wi) => {
      const el = line.children[wi];
      // BOOT (low-amplitude apex motif): instant opacity + vertical sweep reveal
      tl.set(el, { opacity: 1, clipPath: "inset(-20% -10% 100% -10%)" }, st);
      tl.to(el, { clipPath: "inset(-20% -10% -30% -10%)", duration: 0.15, ease: "power2.out" }, st);
      tl.set(el, { clipPath: "none" }, st + 0.16);
      // 1-frame interference glitch
      tl.set(el, { x: 2 },  st + 0.05);
      tl.set(el, { x: -2 }, st + 0.09);
      tl.set(el, { x: 0 },  st + 0.13);
      // EMPHASIS: 2-frame projection dropout, restores brighter (delay shrinks
      // near the line's projector-cut so dropout+restore always complete)
      if (em) {
        const d = Math.min(${b.emphDelay ?? 0.34}, L.exit - st - 0.183);
        if (d >= 0.083) {
          tl.set(el, { opacity: 0.2 }, st + d);
          tl.set(el, { opacity: 1, color: ${J(dna.palette.em || "#f4feff")}, textShadow: HSH_EM }, st + d + 0.083);
          const sb = st + d + 0.51;
          if (sb < L.exit - 0.05)
            tl.to(el, { color: ${J((dna.palette.body || "#c7f1ff") + "ed")}, textShadow: HSH_BASE,
                        duration: Math.min(0.4, ${(DUR - 0.04).toFixed(2)} - sb), ease: "power1.in" }, sb);
        }
      }
    });

    // slow rotateY drift — it IS a projection
    const dS = L.words[0][1] + 0.08;
    const dD = Math.max(0.3, L.exit - dS - 0.04);
    tl.to(line, { keyframes: { rotationY: [-3.5, 3.5, -2.5] }, duration: dD, ease: "none" }, dS);

    // EXIT: projector cut — line collapses to a bright slit, then to a dot
    const ex = L.exit;
    tl.set(line, { filter: "brightness(2.2)" }, ex);
    tl.to(line, { scaleY: 0.045, duration: 0.07, ease: "power3.in" }, ex + 0.005);
    tl.to(line, { scaleX: 0.015, duration: 0.06, ease: "power3.in" }, ex + 0.08);
    tl.set(line, { opacity: 0, display: "none" }, ex + 0.15);
  });
${
  b.yield
    ? `  // the whole rail (plate included) yields while the apex lands
  tl.to("#railwrap", { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.in" }, ${(heroIn - (b.yield.pre ?? 0.18)).toFixed(3)});
  tl.to("#railwrap", { opacity: 1, duration: 0.22, ease: "power1.out" }, ${(heroIn + (b.yield.post ?? 0.37)).toFixed(3)});`
    : ""
}
  // end: the plate itself gets the projector cut
  tl.set("#plate", { filter: "brightness(2.2)" }, ${pCut});
  tl.to("#plate", { scaleY: 0.03, duration: 0.07, ease: "power3.in" }, ${(pCut + 0.005).toFixed(3)});
  tl.to("#plate", { scaleX: 0.012, duration: 0.05, ease: "power3.in" }, ${(pCut + 0.08).toFixed(3)});
  tl.set("#plate", { opacity: 0 }, ${Math.min(pCut + 0.12, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function paradigmPlanktonrail() {
  // PLANKTONRAIL: deep-sea lower third on TWO coexisting row slots — even
  // lines ride the upper row, odd lines the lower, so couplets share the
  // water like drifting strata. Words GLOW ON like jellyfish (the apex bloom
  // at low amplitude): 2-frame opacity + radial bloom from center (scale
  // 0.92→1, blur 5→0, brightness 0.45→1) while a cyan glow text-shadow grows
  // in; emphasis words pulse a slow DOUBLE-BEAT (jellyfish propulsion). Every
  // line floats on a gentle y drift and exits by SINKING (+15px, dimming).
  // Furniture: seeded plankton motes drift f(t) in the open water; the ones
  // seeded in a ring around the apex get ATTRACTED to the bloom and brighten
  // as it lands. The line feeding the apex dims while the bloom owns the
  // frame (no restore — it exits dimmed, by design); a line entering during
  // the hold arrives dimmed and restores once the bloom settles.
  const b = dna.body;
  const A = dna.palette.accent,
    VIO = dna.palette.violet || "#9d7bff";
  const rowB = H - (b.bottomPx || 70); // lower row center
  const rowA = rowB - (b.rowDy ?? 58); // upper row center
  const m = b.motes || {};
  const yld = b.yield || {};
  // active line = the one feeding the apex (last line that starts before it)
  const activeIdx = LINES.reduce((a, L, i) => (L.words[0].start < heroIn ? i : a), 0);
  const lineData = LINES.map((L, i) => {
    // two-row coexistence: a line clears when its ROW is next needed (line
    // i+2) or ~0.3s after its couplet finishes speaking (staggered pair
    // exits); a pre-apex leftover clears just before the bloom lands (the
    // feeding line stays and yields instead); the last line floats to the end
    const pairLast = LINES[Math.min(i - (i % 2) + 1, LINES.length - 1)];
    const pairEnd = pairLast.words[pairLast.words.length - 1].end;
    let out =
      i + 2 < LINES.length
        ? Math.min(LINES[i + 2].in - 0.15, pairEnd + 0.28 + (i % 2) * 0.12)
        : i + 1 < LINES.length
          ? LINES[i + 1].words[0].start - 0.05
          : null;
    if (i !== activeIdx && out != null && out > heroIn - 0.25 && L.in < heroIn) out = heroIn - 0.21;
    return {
      id: "pl" + L.id,
      top: i % 2 ? rowB : rowA,
      in: +L.in.toFixed(3),
      out: out == null ? null : +Math.min(out, DUR - 0.36).toFixed(3),
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    };
  });
  const shOn = `0 2px 10px rgba(1,10,20,0.85), 0 0 16px ${A}cc`;
  const shEm = `0 2px 10px rgba(1,10,20,0.85), 0 0 18px ${A}f2, 0 0 34px ${VIO}8c`;
  const css = `
  .mote { position:absolute; border-radius:50%; background:${dna.palette.mote || "#96f5e8"}f2;
          box-shadow: 0 0 7px 2px ${A}bf; opacity:0; }
  .pln { position:absolute; left:${W / 2}px; white-space:nowrap;
         font-family:'${dna.fonts.body}', sans-serif; font-weight:400; font-size:${b.fontPx}px;
         line-height:1.2; color:${dna.palette.body}; }
  .pln .w { display:inline-block; position:relative; margin-right:0.30em; opacity:0; }
  .pln .w:last-child { margin-right:0; }
  .pln .ink { display:inline-block;
         text-shadow: 0 2px 10px rgba(1,10,20,0.85), 0 0 0px ${A}00; }
  .pln .w.em .ink { color:${dna.palette.em || "#f4fffd"};
         text-shadow: 0 2px 10px rgba(1,10,20,0.85), 0 0 0px ${A}00, 0 0 0px ${VIO}00; }`;
  const html =
    `      <div id="mfield"></div>
` +
    lineData
      .map((L) => `      <div class="pln" id="${L.id}" style="top:${L.top}px"></div>`)
      .join("\n");
  const js = `
  // ---- body paradigm: PLANKTONRAIL (jellyfish glow-on, two-row float, sinking exits) ----
  const I = ${heroIn.toFixed(3)};
  const mrnd = mulberry32(${m.seed ?? 2929});
  const mf = document.getElementById("mfield");
  // plankton motes: seeded drift walks f(t); the first ${m.near ?? 5} seed a
  // ring around the bloom heart and get ATTRACTED to it as the apex lands
  const APX = ${HG.x}, APY = ${HG.y};
  for (let i = 0; i < ${m.count ?? 12}; i++) {
    const near = i < ${m.near ?? 5};
    const el = document.createElement("div");
    el.className = "mote"; mf.appendChild(el);
    let L, T;
    if (near) {
      const ang = (i / ${m.near ?? 5}) * Math.PI * 2 + 0.55 + mrnd() * 0.5;
      const r = (150 + mrnd() * 75) * ${(HG.fontPx / 120).toFixed(3)};
      L = APX + Math.cos(ang) * r * 1.35;
      T = APY + Math.sin(ang) * r * 0.85;
    } else {
      L = 60 + mrnd() * ${W - 120};
      T = 60 + mrnd() * ${H - 260};
    }
    L = Math.max(20, Math.min(${W - 25}, L)); T = Math.max(25, Math.min(${H - 175}, T));
    const s = 2 + Math.round(mrnd() * 2);
    gsap.set(el, { width: s, height: s, left: L, top: T });
    const tin = 0.04 + mrnd() * 0.35;
    tl.to(el, { opacity: 0.1, duration: 0.3, ease: "power1.out" }, tin);
    // slow seeded drift walk
    const a1 = (mrnd() - 0.5) * 36, a2 = a1 + (mrnd() - 0.5) * 36, a3 = a2 + (mrnd() - 0.5) * 30;
    const b1 = (mrnd() - 0.5) * 28, b2 = b1 + (mrnd() - 0.5) * 28, b3 = b2 + (mrnd() - 0.5) * 24;
    const dEnd = near ? I - 0.25 : ${(DUR - 0.34).toFixed(3)};
    tl.to(el, { keyframes: { x: [a1, a2, a3], y: [b1, b2, b3],
                             opacity: [0.13, 0.07, 0.11] },
               duration: dEnd - (tin + 0.32), ease: "sine.inOut" }, tin + 0.32);
    if (near) {
      // ATTRACTION: pulled toward the bloom, brightening
      const tx = (APX - L) * 0.72 + (mrnd() - 0.5) * 24;
      const ty = (APY - T) * 0.72 + (mrnd() - 0.5) * 18;
      tl.to(el, { x: tx, y: ty, opacity: 0.42, scale: 1.7,
                 duration: 0.75, ease: "power2.in" }, I - 0.19 + i * 0.045);
      tl.to(el, { keyframes: { x: [tx + 4, tx - 3, tx + 2], y: [ty - 4, ty + 3, ty - 2] },
                 duration: 0.32, ease: "sine.inOut" }, ${Math.min(heroIn + 0.59, DUR - 0.42).toFixed(3)});
      tl.to(el, { y: ty + 18, opacity: 0, duration: 0.18, ease: "power1.in" }, ${(DUR - 0.22).toFixed(3)});
    } else {
      tl.to(el, { y: "+=14", opacity: 0, duration: 0.16, ease: "power1.in" }, ${(DUR - 0.2).toFixed(3)});
    }
  }

  // ---- body lines: jellyfish glow-on, floating couplet rows, sinking exits ----
  const SH_ON = ${J(shOn)}, SH_EM = ${J(shEm)};
  const PRAIL = ${J(lineData)};
  PRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt, , em]) => {
      const w = document.createElement("span");
      w.className = "w" + (em ? " em" : "");
      const ink = document.createElement("span"); ink.className = "ink";
      ink.textContent = txt; w.appendChild(ink); line.appendChild(w);
    });
    gsap.set(line, { xPercent: -50, yPercent: -50 });

    // gentle float while held (everything in the abyss floats)
    const t0 = Math.max(0.02, L.words[0][1] - 0.02);
    const D = (L.out ?? ${(DUR - 0.06).toFixed(3)}) - t0 - 0.04;
    const yArr = D > 1.5 ? [-2, 2, -3, 1, 3, 0] : [-2, 1, -2, 0];
    tl.to(line, { keyframes: { y: yArr }, duration: D, ease: "sine.inOut" }, t0);

    L.words.forEach(([txt, st, em], wi) => {
      const w = line.children[wi], ink = w.children[0];
      // GLOW ON: radial bloom from word center (the apex bloom at low amplitude)
      tl.set(w, { opacity: 1 }, st - 0.01);
      tl.fromTo(ink, { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, st);
      tl.fromTo(ink, { scale: 0.92, filter: "blur(5px) brightness(0.45)" },
                { scale: 1, filter: "blur(0px) brightness(1)", duration: 0.4, ease: "sine.out" }, st);
      tl.to(ink, { textShadow: em ? SH_EM : SH_ON, duration: 0.4, ease: "sine.out" }, st);
      // EMPHASIS: slow double-beat pulse (jellyfish propulsion)
      if (em && st + 1.07 <= ${(DUR - 0.09).toFixed(3)}) {
        tl.to(ink, { keyframes: {
            filter: ["blur(0px) brightness(1.4)", "blur(0px) brightness(1.06)",
                     "blur(0px) brightness(1.5)", "blur(0px) brightness(1.12)",
                     "blur(0px) brightness(1)"],
            scale: [1.035, 1.01, 1.05, 1.015, 1] },
          duration: 0.55, ease: "sine.inOut" }, st + 0.52);
      }
    });

    // EXIT: light sinks — drift down +15 while dimming
    if (L.out != null) {
      tl.to(line, { y: 15, opacity: 0, duration: 0.3, ease: "power1.in" }, L.out);
      tl.set(line, { display: "none" }, Math.min(L.out + 0.32, ${(DUR - 0.02).toFixed(2)}));
    }
  });

  // rail yields to the apex landing: the feeding line dims (and exits dimmed
  // unless it has ≥0.9s of hold left); a line entering during the hold
  // arrives at ${yld.enter ?? 0.8} and restores once the bloom settles
  PRAIL.forEach((L, i) => {
    if (i === ${activeIdx} && (L.out ?? 99) > I - ${(yld.pre ?? 0.17).toFixed(2)} + 0.25) {
      tl.to("#" + L.id, { opacity: ${yld.dim ?? 0.55}, duration: 0.18, ease: "power1.out" }, I - ${(yld.pre ?? 0.17).toFixed(2)});
      if ((L.out ?? 99) > I + 1.2)
        tl.to("#" + L.id, { opacity: 1, duration: 0.25, ease: "power1.out" }, I + 0.9);
    }
    if (L.in > I && L.in < I + 0.9) {
      tl.set("#" + L.id, { opacity: ${yld.enter ?? 0.8} }, L.in);
      tl.to("#" + L.id, { opacity: 1, duration: 0.25, ease: "power1.out" },
            Math.min(Math.max(I + ${(yld.post ?? 0.63).toFixed(2)}, L.in + 0.1), ${(DUR - 0.28).toFixed(2)}));
    }
  });`;
  return { css, html, js };
}

function paradigmSheenrail() {
  // SHEENRAIL: iridescent silk lower third on TWO coexisting row slots — even
  // lines ride the upper row (H − bottomPx − rowDy), odd lines the lower
  // (H − bottomPx), so couplets read together like a woven pair. Words are
  // aurora-gradient ink (background-clip:text over a rose→teal→violet wash
  // whose backgroundPosition DRIFTS f(t) across the whole clip — the body's
  // hold life) above a blurred dark understroke; entrance = 2-frame opacity
  // + y8 settle (the ribbon's flow at low amplitude); emphasis = ONE bright
  // sheen sweep marching through the word + a brightness pulse. Exits
  // dissolve UPWARD (y−12, blur 3, staggered) and each line releases 3-4
  // drifting light streaks that float up from its row. A soft radial band
  // scrim sits under the rows (stable reading surface); the whole rail —
  // band included — yields while the ribbon writes. Line scheduling mirrors
  // planktonrail's two-row coexistence: a row clears when next needed (line
  // i+2) or shortly after its couplet finishes speaking (staggered pair
  // exits); the pre-apex leftover clears at heroIn−0.32 while the FEEDING
  // line stays (it dims with the railwrap yield); the last line holds.
  const b = dna.body;
  const PAL = [dna.palette.rose, dna.palette.accent, dna.palette.violet];
  const rowB = H - (b.bottomPx || 76); // lower row TOP edge
  const rowA = rowB - (b.rowDy ?? 58); // upper row TOP edge
  const band = b.band || {};
  const bandW = band.w ?? 860,
    bandH = band.h ?? 170;
  const bandCy = Math.round((rowA + rowB + b.fontPx * 1.1) / 2);
  const yld = b.yield || {};
  // active line = the one feeding the apex (last line that starts before it)
  const activeIdx = LINES.reduce((a, L, i) => (L.words[0].start < heroIn ? i : a), 0);
  const lineData = LINES.map((L, i) => {
    const pairLast = LINES[Math.min(i - (i % 2) + 1, LINES.length - 1)];
    const pairEnd = pairLast.words[pairLast.words.length - 1].end;
    let out =
      i + 2 < LINES.length
        ? Math.min(LINES[i + 2].in - 0.15, pairEnd + 0.23 + (i % 2) * 0.17)
        : i + 1 < LINES.length
          ? LINES[i + 1].words[0].start - 0.11
          : null;
    if (i !== activeIdx && out != null && out > heroIn - 0.25 && L.in < heroIn) out = heroIn - 0.32;
    return {
      id: "sk" + L.id,
      top: i % 2 ? rowB : rowA,
      out: out == null ? null : +Math.min(out, DUR - 0.4).toFixed(3),
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    };
  });
  const css = `
  #skwrap { position:absolute; inset:0; }
  #band { position:absolute; left:${W / 2}px; top:${bandCy}px; width:${bandW}px; height:${bandH}px;
          margin-left:-${bandW / 2}px; margin-top:-${bandH / 2}px; opacity:0;
          background: radial-gradient(50% 50% at 50% 50%, rgba(6,10,28,0.55) 0%, rgba(6,10,28,0.3) 55%, rgba(6,10,28,0) 78%); }
  .skl { position:absolute; left:${W / 2}px; white-space:nowrap;
         font-family:'${dna.fonts.body}', serif; font-weight:500; font-size:${b.fontPx}px;
         line-height:1.1; }
  .skl .w { position:relative; display:inline-block; margin-right:0.3em; opacity:0; }
  .skl .w:last-child { margin-right:0; }
  .skl .sh { position:absolute; left:0; top:3px; color:rgba(4,8,22,0.7);
         filter:blur(3px); z-index:0; }
  .skl .grad { position:relative; z-index:1;
         background-image: linear-gradient(100deg, ${PAL[0]} 0%, ${PAL[1]} 32%, ${PAL[2]} 64%, ${PAL[0]} 96%);
         background-size: 300% 100%;
         -webkit-background-clip: text; background-clip: text; color: transparent; }
  .skl .shine { position:absolute; left:0; top:0; z-index:2; opacity:0;
         background-image: linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 60%);
         background-size: 260% 100%;
         -webkit-background-clip: text; background-clip: text; color: transparent; }
  .streak { position:absolute; width:3px; border-radius:2px; opacity:0; filter:blur(2px); }`;
  const html =
    `      <div id="skwrap">
        <div id="band"></div>
` +
    lineData
      .map((L) => `        <div class="skl" id="${L.id}" style="top:${L.top}px"></div>`)
      .join("\n") +
    `
      </div>`;
  const js = `
  // ---- body paradigm: SHEENRAIL (flow-on entrance, sheen-sweep emphasis, dissolve-to-streaks exits) ----
  const I = ${heroIn.toFixed(3)};
  const srnd = mulberry32(${b.seed ?? 20260611});
  const stg = document.getElementById("stage");
  const PAL = ${J(PAL)};
  const SRAIL = ${J(lineData)};
  tl.to("#band", { opacity: 1, duration: 0.35, ease: "sine.out" }, 0.12);
  const allGrads = [];
  SRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    const wraps = [];
    L.words.forEach(([txt, st, em]) => {
      const w = document.createElement("span"); w.className = "w";
      const sh = document.createElement("span"); sh.className = "sh"; sh.textContent = txt;
      const g  = document.createElement("span"); g.className = "grad"; g.textContent = txt;
      const sn = document.createElement("span"); sn.className = "shine"; sn.textContent = txt;
      w.appendChild(sh); w.appendChild(g); w.appendChild(sn);
      line.appendChild(w); wraps.push(w); allGrads.push(g);
      // FLOW ON: 2-frame opacity + y8 settle (the ribbon's flow at low amplitude)
      tl.fromTo(w, { opacity: 0 }, { opacity: 1, duration: 2 * F, ease: "none" }, st);
      tl.fromTo(w, { y: 8 }, { y: 0, duration: 0.38, ease: "sine.out" }, st);
      // EMPHASIS: the sheen pulses bright once through the word
      if (em) {
        const pt = st + 0.16;
        tl.set(sn, { opacity: 1 }, pt);
        tl.fromTo(sn, { backgroundPosition: "-80% 50%" },
                  { backgroundPosition: "180% 50%", duration: 0.42, ease: "power2.inOut" }, pt);
        tl.to(sn, { opacity: 0, duration: 0.12, ease: "none" }, pt + 0.34);
        tl.to(g, { keyframes: { filter: ["brightness(1)", "brightness(1.55)", "brightness(1)"] },
                   duration: 0.42, ease: "none" }, pt);
      }
    });
    gsap.set(line, { xPercent: -50 });
    // EXIT: the line dissolves upward and releases drifting light streaks
    if (L.out != null) {
      tl.to(wraps, { opacity: 0, y: -12, filter: "blur(3px)",
                     duration: 0.32, ease: "power1.in", stagger: 0.035 }, L.out);
      tl.set(line, { display: "none" }, L.out + 0.6);
      const nS = ${b.streaks ?? 4};
      for (let i = 0; i < nS; i++) {
        const s = document.createElement("div"); s.className = "streak"; stg.appendChild(s);
        const c = PAL[i % 3];
        const x = ${W / 2} + (i - (nS - 1) / 2) * 95 + (srnd() - 0.5) * 50;
        const hh = 40 + Math.round(srnd() * 28);
        gsap.set(s, { left: x, top: L.top + 14, height: hh,
                      background: "linear-gradient(to top, rgba(255,255,255,0) 0%, " + c + " 50%, rgba(255,255,255,0) 100%)" });
        tl.fromTo(s, { y: 14 },
          { keyframes: { opacity: [0, 0.7, 0], y: [14, -28, -78] },
            duration: 0.62, ease: "power1.out" }, Math.min(L.out + 0.04 + i * 0.05, ${(DUR - 0.66).toFixed(3)}));
      }
    }
  });
  // continuous iridescent sheen drift f(t) — the body's hold life
  tl.fromTo(allGrads, { backgroundPosition: "0% 50%" },
            { backgroundPosition: "300% 50%", duration: ${(DUR - 0.04).toFixed(3)}, ease: "none" }, 0);
  // rail yields — band included — while the ribbon writes (apex owns the frame)
  tl.to("#skwrap", { opacity: ${yld.dim ?? 0.5}, duration: 0.2, ease: "sine.in" }, I - ${(yld.pre ?? 0.16).toFixed(2)});
  tl.to("#skwrap", { opacity: 1, duration: 0.3, ease: "sine.out" }, I + ${(yld.post ?? 0.62).toFixed(2)});`;
  return { css, html, js };
}

function paradigmScoperail() {
  // SCOPERAIL: oscilloscope lower third. A dark phosphor scope band (HUD
  // readouts, graticule) hosts an ALWAYS-ALIVE waveform — an SVG polyline
  // rebuilt from baked point-set states (seeded pseudo-RMS envelope: speech
  // grows it, silence flattens it, every word arrival kicks a local gaussian
  // burst for ~3 frames; the hero words kick WIDE bursts where the trace
  // surges off the scope to write). Body lines (phosphor mono) sit on the
  // band above the trace and wipe in L→R over reserved-width slots (the apex
  // pen-write at low amplitude) with a 2-frame just-traced flash; emphasis
  // words get a ticking frequency-readout chip; the trig LED blinks on every
  // word arrival. Lines collapse INTO the waveform on exit. At the FINAL word
  // the trace explodes to max-amp chaos, flatlines, collapses to a single dot
  // and `body.siglost` stamps — the scope dies with the clip.
  const b = dna.body;
  const A = dna.palette.accent,
    BRT = dna.palette.bright || "#d6ffe4",
    FLSH = dna.palette.flash || "#eafff2",
    EM = dna.palette.em || "#ffb347",
    HUD = dna.palette.hud || "#2f8f55";
  const bandH = b.bandH || 164;
  const bandTop = H - bandH;
  const waveH = b.waveH || 84;
  const NZ = +LASTWORD.start.toFixed(3); // the scope-death beat
  // line windows: exits collapse into the trace — early into dead air
  // (lastWordStart+0.67), else just before the next line needs the slot
  const lineData = LINES.map((L, i) => {
    const lastSt = L.words[L.words.length - 1].start;
    const next = LINES[i + 1];
    const out = next
      ? +Math.min(next.in - 0.05, lastSt + 0.67).toFixed(3)
      : +Math.min(NZ + 0.33, DUR - 0.2).toFixed(3);
    return {
      id: "sc" + L.id,
      in: +L.in.toFixed(3),
      out,
      words: L.words.map((w) => [
        w.display,
        +w.start.toFixed(3),
        w.minor ? 1 : 0,
        Math.abs(w.start - NZ) < 0.001 ? 1 : 0, // the death word settles hot
      ]),
    };
  });
  // waveform burst map BAKED from measured glyph metrics (slot centers) +
  // the hero kick positions (the trace surges wide where the apex writes)
  const GAPem = 0.32;
  const burst = []; // [t, x, big]
  LINES.forEach((L) => {
    const ws = L.words.map((w) => wordPx(w.display, dna.fonts.body, b.fontPx, 0));
    const totalW = ws.reduce((a, c) => a + c, 0) + GAPem * b.fontPx * (L.words.length - 1);
    let x = W / 2 - totalW / 2;
    L.words.forEach((w, i) => {
      burst.push([+w.start.toFixed(3), +(x + ws[i] / 2).toFixed(1), 0]);
      x += ws[i] + GAPem * b.fontPx;
    });
  });
  if (!heroInline)
    for (let k = 0; k < hero.len; k++) {
      const hx = HG.x + (hero.len === 1 ? 0 : (k / (hero.len - 1)) * 0.6 * (HG.halfW || 300));
      burst.push([+tWords[hero.idx + k].start.toFixed(3), +hx.toFixed(1), 1]);
    }
  const css = `
  #scband { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px; opacity:0;
            background: rgba(0,12,4,0.58); border-top:1px solid ${A}4d;
            box-shadow: 0 -8px 30px rgba(0,0,0,0.35); }
  .schud { position:absolute; top:6px; font-family:'${dna.fonts.tag}', monospace; font-size:20px;
           color:${HUD}; letter-spacing:2px; }
  #schudL { left:24px; }
  #schudR { right:24px; }
  #sctrig { display:inline-block; width:10px; height:10px; border-radius:50%;
            background:${EM}; box-shadow:0 0 6px ${EM}cc; margin-left:8px; opacity:0.45; }
  #scgrat { position:absolute; left:0; top:${b.waveTop || 80}px; width:${W}px; height:${waveH}px; opacity:0.6;
            background-image:
              repeating-linear-gradient(90deg, ${A}12 0 1px, transparent 1px 80px),
              linear-gradient(180deg, transparent ${Math.round(waveH / 2 - 1)}px, ${A}1a ${Math.round(waveH / 2 - 1)}px ${Math.round(waveH / 2 + 1)}px, transparent ${Math.round(waveH / 2 + 1)}px); }
  #scwavewrap { position:absolute; left:0; top:${b.waveTop || 80}px; width:${W}px; height:${waveH}px; }
  #scwave { filter: drop-shadow(0 0 5px ${A}bf); }
  .scln { position:absolute; left:0; top:${b.lineDy || 34}px; width:${W}px; text-align:center;
          font-family:'${dna.fonts.body}', monospace; font-size:${b.fontPx}px; line-height:${Math.round(b.fontPx * 1.1)}px;
          color:${A}; text-shadow:0 0 8px ${A}73;
          white-space:nowrap; opacity:0; }
  .scln .w { display:inline-block; vertical-align:bottom; white-space:nowrap;
             margin-right:${GAPem}em; position:relative; }
  .scln .sz { visibility:hidden; }
  .scln .clip { position:absolute; left:0; top:0; overflow:hidden; white-space:nowrap; width:0; }
  .scchip { position:absolute; left:50%; top:-26px; width:130px; margin-left:-65px;
            height:24px; font-family:'${dna.fonts.tag}', monospace; font-size:21px;
            color:${EM}; text-shadow:0 0 6px ${EM}99; opacity:0; }
  .scchip .cv { position:absolute; left:0; top:0; width:100%; text-align:center; opacity:0; }
  #scdot { position:absolute; left:${W / 2 - 6}px; top:${bandTop + (b.waveTop || 80) + Math.round(waveH / 2) - 4}px;
           width:9px; height:9px; border-radius:50%; background:${BRT}; opacity:0;
           box-shadow:0 0 8px ${A}, 0 0 22px ${A}e6; }
  #scsiglost { position:absolute; left:0; top:${bandTop + (b.waveTop || 80)}px; width:${W}px; text-align:center;
               font-family:'${dna.fonts.tag}', monospace; font-size:24px; letter-spacing:6px;
               color:${EM}; text-shadow:0 0 10px ${EM}b3; opacity:0; }`;
  const html =
    `      <div id="scband">
        <div class="schud" id="schudL">${esc(b.hudL || "SPECTRUM // CH1")}</div>
        <div class="schud" id="schudR">${esc(b.hudR || FPS + ".0 kS/s · TRIG")}<span id="sctrig"></span></div>
        <div id="scgrat"></div>
        <div id="scwavewrap">
          <svg width="${W}" height="${waveH}" viewBox="0 0 ${W} ${waveH}">
            <polyline id="scwave" fill="none" stroke="${A}" stroke-width="2.5"
                      stroke-linejoin="round" points=""/>
          </svg>
        </div>
` +
    lineData.map((L) => `        <div class="scln" id="${L.id}"></div>`).join("\n") +
    `
      </div>
      <div id="scsiglost">${esc(b.siglost || "— SIGNAL LOST —")}</div>
      <div id="scdot"></div>`;
  const js = `
  // ---- body paradigm: SCOPERAIL (trace-wipe words, waveform alive all clip) ----
  const rnd = mulberry32(${b.waveSeed || 7});
  const NZ = ${NZ.toFixed(3)}, ENDC = ${(DUR - 0.02).toFixed(3)};
  const BURST = ${J(burst)};            // [t, x, big] — word arrivals kick the trace
  const allT = BURST.map((q) => q[0]);
  const burstAt = {}; const bigAt = {};
  BURST.forEach(([t, x, big]) => { burstAt[t] = x; if (big) bigAt[t] = 1; });

  // ===== baked waveform states (pure f(t) + seeded jitter; ~2 states/word frame) =====
  const timesSet = [];
  let t0 = 0;
  while (t0 < NZ - 0.015) { timesSet.push(t0); t0 += 1 / 12; }
  allT.forEach((wt) => { [wt, wt + F, wt + 2 * F].forEach((x) => { if (x < NZ - 0.015) timesSet.push(x); }); });
  for (let te = NZ - 0.01; te <= Math.min(NZ + 0.311, ENDC); te += F) timesSet.push(te);
  timesSet.push(Math.min(NZ + 0.325, ENDC), Math.min(NZ + 0.35, ENDC));
  timesSet.sort((a, b2) => a - b2);
  const times = timesSet.filter((x, i) => i === 0 || x - timesSet[i - 1] > 0.02);
  const NPTS = ${Math.round(W / 20) + 1}, MIDY = ${Math.round(waveH / 2)};
  function speechEnv(t) {
    let e = 0;
    allT.forEach((wt) => {
      const g = Math.exp(-Math.pow((t - wt - 0.10) / 0.21, 2));
      if (g > e) e = g;
    });
    return e;
  }
  const wavePts = [];
  times.forEach((t) => {
    const boom = t > NZ - 0.007 && t < NZ + 0.308;
    const flat = t >= NZ + 0.32;
    const baseAmp = flat ? 0.5 : (boom ? 34 : 2.2 + 15 * speechEnv(t));
    const pts = [];
    for (let i = 0; i < NPTS; i++) {
      const x = i * 20;
      let amp = baseAmp;
      if (!boom && !flat) {
        allT.forEach((wt) => {
          if (t >= wt - 0.005 && t <= wt + 0.13) {
            const big = bigAt[wt];
            amp += (big ? 30 : 20) * Math.exp(-Math.pow((x - burstAt[wt]) / (big ? 240 : 95), 2));
          }
        });
      }
      const jit = (rnd() - 0.5) * 2;
      let y = amp * (0.52 * Math.sin(i * 0.55 + t * 16.2 + 0.7)
                   + 0.42 * Math.sin(i * 1.27 - t * 23.5 + 2.1)
                   + (boom ? 0.85 : 0.42) * jit);
      if (y > MIDY - 4) y = MIDY - 4; if (y < -(MIDY - 4)) y = -(MIDY - 4);
      pts.push(x + "," + (MIDY + y).toFixed(1));
    }
    wavePts.push([t, pts.join(" ")]);
  });
  const scwave = document.getElementById("scwave");
  scwave.setAttribute("points", wavePts[0][1]);
  wavePts.forEach(([t, str]) => { tl.set(scwave, { attr: { points: str } }, Math.min(t, ENDC)); });

  // ===== scope power-on =====
  tl.fromTo("#scband", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power1.out" }, 0.02);
  tl.fromTo("#scwavewrap", { scaleX: 0.04, transformOrigin: "50% 50%" },
            { scaleX: 1, duration: 0.22, ease: "power2.out" }, 0.04);
${
  b.yield && !heroInline
    ? `
  // rail yields while the apex trace writes (band carries lines + wave + HUD)
  tl.to("#scband", { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.in" }, ${Math.max(heroIn - (b.yield.pre || 0.13), 0.2).toFixed(3)});
  tl.to("#scband", { opacity: 1, duration: 0.25, ease: "power1.out" }, ${Math.min(heroIn + (b.yield.post || 0.97), DUR - 0.4).toFixed(3)});`
    : ""
}

  // ===== body lines: trace-wipe entrances over reserved-width slots =====
  const SRAIL = ${J(lineData)};
  function chipVals(r, idx) {
    if (idx % 2 === 0) {
      let v = 150 + Math.round(r() * 250); const a = [v];
      v += 300 + Math.round(r() * 200); a.push(v);
      v += 200 + Math.round(r() * 150); a.push(v);
      return a.map((x) => x + " Hz");
    }
    let v = 0.3 + Math.round(r() * 3) * 0.1; const a = [v];
    v += 0.4 + Math.round(r() * 2) * 0.1; a.push(v);
    v += 0.2 + Math.round(r() * 2) * 0.1; a.push(v);
    return a.map((x) => x.toFixed(1) + " kHz");
  }
  const crnd = mulberry32(${b.chipSeed || 11});
  let chipIdx = 0;
  SRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.03);
    L.words.forEach(([txt, wt, minor, death]) => {
      // reserved-width slot: sizer keeps the centered line static (no
      // re-center drift as words arrive); the clip wipes the word in over it.
      const wrap = document.createElement("span"); wrap.className = "w";
      const sizer = document.createElement("span"); sizer.className = "sz";
      sizer.textContent = txt;
      const clip = document.createElement("span"); clip.className = "clip";
      const inner = document.createElement("span");
      inner.textContent = txt;
      clip.appendChild(inner); wrap.appendChild(sizer); wrap.appendChild(clip);
      line.appendChild(wrap);
      // entrance = apex motif at low amplitude: the trace draws it L→R
      tl.fromTo(clip, { width: 0 }, { width: "auto", duration: 0.10, ease: "none" }, wt);
      // phosphor just-traced flash (full brightness instantly, settle in 2 frames)
      const settle = death
        ? { color: ${J(EM)}, textShadow: "0 0 9px ${EM}8c" }
        : { color: ${J(A)}, textShadow: "0 0 8px ${A}73" };
      tl.set(inner, { color: ${J(FLSH)}, textShadow: "0 0 16px ${BRT}f2" }, wt);
      tl.set(inner, settle, wt + 2 * F);
      // trigger LED blink on every word arrival
      tl.set("#sctrig", { opacity: 1, scale: 1.35 }, wt);
      tl.set("#sctrig", { opacity: 0.45, scale: 1 }, wt + 2 * F);
      // emphasis: ticking frequency readout (seeded, ascending)
      if (minor) {
        const chip = document.createElement("span"); chip.className = "scchip";
        const cvs = chipVals(crnd, chipIdx++).map((v) => {
          const s = document.createElement("span"); s.className = "cv"; s.textContent = v;
          chip.appendChild(s); return s;
        });
        wrap.appendChild(chip);
        tl.set(chip, { opacity: 1 }, wt + 0.12);
        cvs.forEach((s, i) => {
          tl.set(s, { opacity: 1 }, wt + 0.12 + i * 2 * F);
          if (i < cvs.length - 1) tl.set(s, { opacity: 0 }, wt + 0.12 + (i + 1) * 2 * F);
        });
      }
    });
    // exit: the line collapses INTO the waveform
    tl.to(line, { y: 30, opacity: 0, duration: 0.13, ease: "power2.in" }, L.out);
  });

  // ===== the death beat: explosion / band shake / flatline / dot / siglost =====
  [[3, 0], [-4, 1], [3, 2], [-2, 3], [0, 4]].forEach(([dx, k]) => {
    tl.set("#scband", { x: dx }, Math.min(NZ + k * 0.042, ENDC));
  });
  tl.set("#scband", { x: 0 }, Math.min(NZ + 0.21, ENDC));
  // trig LED panics, then dies
  [0, 1, 2, 3].forEach((k) => {
    tl.set("#sctrig", { opacity: k % 2 ? 0.2 : 1, background: ${J(dna.palette.panic || "#ff5f47")},
                        boxShadow: "0 0 8px ${(dna.palette.panic || "#ff5f47") + "e6"}" }, Math.min(NZ + k * 2 * F, ENDC));
  });
  tl.set("#sctrig", { opacity: 0.18 }, Math.min(NZ + 0.35, ENDC));
  // flatline → trace shrinks to a single dot
  tl.to("#scwavewrap", { scaleX: 0.015, duration: 0.055, ease: "power3.in",
                         transformOrigin: "50% 50%" }, Math.min(NZ + 0.365, ENDC - 0.06));
  tl.set("#scwavewrap", { opacity: 0 }, Math.min(NZ + 0.425, ENDC));
  tl.set("#scdot", { opacity: 1 }, Math.min(NZ + 0.39, ENDC));
  tl.set("#scdot", { opacity: 0.45 }, Math.min(NZ + 0.465, ENDC));
  tl.set("#scdot", { opacity: 1 }, Math.min(NZ + 0.49, ENDC));
  // SIGNAL LOST stamp (2-frame flicker in; clamped ≤ DUR−0.02)
  tl.set("#scsiglost", { opacity: 1 }, Math.min(NZ + 0.43, ENDC - 2 * F));
  tl.set("#scsiglost", { opacity: 0.35 }, Math.min(NZ + 0.43 + F, ENDC - F));
  tl.set("#scsiglost", { opacity: 1 }, Math.min(NZ + 0.43 + 2 * F, ENDC));`;
  return { css, html, js };
}

function paradigmBeamrail() {
  // BEAMRAIL: a radiograph scan band where a single SCAN BEAM is the engine of
  // every reveal. The body words live on a dark phosphor band (the stable
  // reading surface); a hot vertical beam sweeps L→R and each word is WIPED in
  // (clip-path inset) exactly as the beam crosses it — instant just-traced
  // brightness flash, settle in 2 frames. The beam path is baked from the
  // measured word x-edges + spoken times, so the reveal is pixel-synced. At the
  // apex the beam freezes (micro servo-jitter while locked), a lock flash fires,
  // and the band yields. Then the beam FLYS off right, RETURNS flipped (hot
  // flyback) and on the return pass it ERASES earlier lines R→L and re-prints
  // the later lines in its wake (R→L clip wipe). Emphasis words get a brighter
  // just-traced flash + a density tag chip. Status readouts narrate the scan
  // (SCANNING / TARGET LOCK / ANALYSIS / RESCAN / COMPLETE). Lower-third, fg.
  const b = dna.body;
  const A = dna.palette.accent || "#9fd8ff",
    BODY = dna.palette.body || "#cfe8ff",
    FLSH = dna.palette.flash || "#eaf7ff",
    HUD = dna.palette.hud || "#5e8fa3",
    EM = dna.palette.em || "#eaf7ff";
  const fam = dna.fonts.body;
  const fpx = b.fontPx || 42;
  const bandH = b.bandH || 180;
  const bandTop = H - bandH;
  const inset = b.inset ?? 18;
  const GAP = b.gapEm ?? 0.5; // inter-word gap (space col)
  // row baselines inside the band: first row near the top of the band, then
  // stacked by lineDy. Each LINE gets its own row.
  const rowDy = b.lineDy || 50;
  const row0 = b.row0 ?? 16; // px below band top for row 0's word-top
  // the apex onset is the pivot: lines whose first word is BEFORE it are the
  // L→R reveal phase; lines at/after it print in the RETURN beam's wake (R→L).
  const pivot = heroInline || HEROLESS ? DUR : heroIn;
  // bake per-word geometry (left-aligned rows, demo layout) + reveal/erase
  const lineData = LINES.map((L, li) => {
    const rowY = bandTop + row0 + li * rowDy;
    let x = inset + 132; // left margin (room for the HUD header tag)
    const phaseReturn = L.words[0].start >= pivot - 0.001;
    const words = L.words.map((w) => {
      const wpx = Math.round(wordPx(w.display, fam, fpx, 0.01));
      const o = {
        txt: w.display,
        x: Math.round(x),
        w: wpx,
        st: +w.start.toFixed(3),
        em: w.minor ? 1 : 0,
      };
      x += wpx + Math.round(GAP * fpx);
      return o;
    });
    return { id: "bm" + L.id, li, rowY, phaseReturn, rightEdge: Math.round(x), words };
  });
  // status narrative beats (auto from the scan: boot, lock at apex, analysis,
  // rescan at the pivot of phase 2, complete near last word)
  const lastWordT = +LASTWORD.start.toFixed(3);
  const firstRetT = lineData
    .filter((L) => L.phaseReturn)
    .flatMap((L) => L.words)
    .map((w) => w.st)
    .sort((a, b2) => a - b2)[0];
  const rescanT =
    firstRetT != null
      ? +Math.max(heroIn + 0.85, firstRetT - 0.13).toFixed(3)
      : +Math.min(heroOut, DUR - 0.3).toFixed(3);
  const STBEATS =
    heroInline || HEROLESS
      ? [
          ["SCANNING >>", 0.2],
          ["SCAN COMPLETE", +(lastWordT + 0.05).toFixed(3)],
        ]
      : [
          ["SCANNING >>", 0.2],
          ["TARGET LOCK", +heroIn.toFixed(3)],
          ["ANALYSIS..", +Math.min(heroIn + 0.72, rescanT - 0.1).toFixed(3)],
          ["<< RESCAN", rescanT],
          ["SCAN COMPLETE", +Math.min(lastWordT + 0.09, DUR - 0.15).toFixed(3)],
        ];
  const css = `
  #bmwrap { position:absolute; inset:0; opacity:0; }
  #bmband { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px;
            background:
              repeating-linear-gradient(90deg, ${A}0d 0 1px, ${A}00 1px 64px),
              rgba(8,12,20,0.62);
            border-top:1px solid ${A}61; box-shadow: 0 -10px 30px rgba(0,8,18,0.35) inset; }
  #bmhdr { position:absolute; left:${inset}px; top:${bandTop + 6}px; font-family:'${dna.fonts.tag}', monospace;
           font-size:20px; letter-spacing:2px; color:${HUD}; }
  .bmstatus { position:absolute; right:${inset}px; top:${bandTop + 6}px; font-family:'${dna.fonts.tag}', monospace;
              font-size:20px; letter-spacing:2px; color:${A}; display:none; }
  .bmstatus.hot { color:${EM}; }
  .bmw { position:absolute; font-family:'${fam}', monospace; font-size:${fpx}px; line-height:${fpx}px;
         color:${BODY}; text-shadow: 0 0 10px ${A}73, 0 2px 6px rgba(0,4,10,0.65); white-space:nowrap; }
  .bmw.fwd { clip-path: inset(-25% 101% -25% 0%); }     /* hidden on the RIGHT (revealed L→R) */
  .bmw.ret { clip-path: inset(-25% 0% -25% 101%); }     /* hidden on the LEFT  (revealed R→L) */
  .bmtag { position:absolute; font-family:'${dna.fonts.tag}', monospace; font-size:19px; letter-spacing:2px;
           color:${A}; background:rgba(8,14,24,0.72); border:1px solid ${A}59; padding:1px 7px 0; opacity:0; }
  #bmbeam { position:absolute; left:0; top:${bandTop}px; width:0; height:${bandH}px; opacity:0; }
  #bmbeam .core { position:absolute; left:-2px; top:0; width:4px; height:${bandH}px;
                  background: linear-gradient(180deg, ${FLSH}00 0%, ${FLSH}f2 7%, #ffffff 50%, ${FLSH}f2 93%, ${FLSH}00 100%);
                  box-shadow: 0 0 22px 4px ${A}8c; }
  #bmbeam .wake { position:absolute; left:-150px; top:0; width:150px; height:${bandH}px;
                  background: linear-gradient(90deg, ${A}00 0%, ${A}38 100%); }`;
  const html = `      <div id="bmwrap">
        <div id="bmband"></div>
        <div id="bmhdr">${esc(b.header || "RADIOGRAPH // SCAN")}</div>
${STBEATS.map((s, i) => `        <div class="bmstatus${i === 1 && !heroInline && !HEROLESS ? " hot" : ""}" id="bmst${i}">${esc(s[0])}</div>`).join("\n")}
      </div>
      <div id="bmbeam"><div class="wake"></div><div class="core"></div></div>`;
  // ---- bake the beam path (x over time) -------------------------------------
  // phase 1: L→R, anchored to each forward word's right edge at spoken time.
  const fwdWords = lineData.filter((L) => !L.phaseReturn).flatMap((L) => L.words);
  fwdWords.sort((a, b2) => a.st - b2.st);
  const A1 = [[0.12, -40]];
  fwdWords.forEach((w) => A1.push([w.st, w.x + w.w]));
  if (heroInline || HEROLESS)
    A1.push([
      +Math.min(DUR - 0.3, (fwdWords.length ? fwdWords[fwdWords.length - 1].st : 1) + 0.3).toFixed(
        3,
      ),
      W - 200,
    ]);
  const beamLockX = heroInline || HEROLESS ? null : Math.round(HG.x + (HG.halfW || 200));
  // phase 2: return beam scans R→L over the return words (reprint in its wake).
  // It must already be sweeping when the first return word prints, so it leads
  // that word (demo: beam returns 3.42, "It's" prints 3.545). Falls back to the
  // apex release if there are no return words.
  const retWords = lineData
    .filter((L) => L.phaseReturn)
    .flatMap((L) => L.words)
    .slice()
    .sort((a, b2) => a.st - b2.st);
  const retStart =
    heroInline || HEROLESS
      ? null
      : retWords.length
        ? +Math.max(heroIn + 0.9, retWords[0].st - 0.125).toFixed(3)
        : +Math.min(heroOut + 0.0, DUR - 0.4).toFixed(3);
  // beam holds the lock, then flies off right just before the return begins
  const beamOff = retStart != null ? +Math.max(heroIn + 0.85, retStart - 0.34).toFixed(3) : null;
  const css2 = css;
  const js = `
  // ---- body paradigm: BEAMRAIL (scan beam drives every reveal/erase) ----
  const BML = ${J(lineData)};
  const A = ${J(A)}, BODY = ${J(BODY)}, FLSH = ${J(FLSH)}, EM = ${J(EM)};
  const ENDC = ${(DUR - 0.02).toFixed(3)};
  // band powers up (nothing at t=0)
  tl.fromTo("#bmwrap", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out" }, 0.05);

  function mkWord(d, rowY, cls) {
    const s = document.createElement("span");
    s.className = "bmw " + cls; s.textContent = d.txt;
    s.style.left = d.x + "px"; s.style.top = rowY + "px"; s.style.width = d.w + "px";
    document.getElementById("bmwrap").appendChild(s); return s;
  }
  function flash(el, em, st) {
    tl.set(el, { filter: em ? "brightness(1.85)" : "brightness(1.6)" }, st);
    tl.set(el, { filter: em ? "brightness(1.85)" : "brightness(1.6)" }, st + ${F});
    tl.to(el, { filter: "brightness(1)", duration: em ? 0.25 : 0.18 }, st + (em ? 0.17 : 2 * ${F}));
  }
  BML.forEach((L) => {
    L.words.forEach((d) => {
      if (!L.phaseReturn) {
        // FORWARD reveal: L→R clip wipe at spoken time (beam-synced)
        const el = mkWord(d, L.rowY, "fwd");
        tl.to(el, { clipPath: "inset(-25% 0% -25% 0%)", duration: 0.10, ease: "none" }, d.st);
        flash(el, d.em, d.st);
      } else {
        // RETURN reveal: word prints only in the return beam's wake (R→L)
        const el = mkWord(d, L.rowY, "ret");
        tl.to(el, { clipPath: "inset(-25% 0% -25% 0%)", duration: 0.10, ease: "none" }, d.st);
        flash(el, d.em, d.st);
      }
    });
  });
${
  retStart != null
    ? `  // ERASE the forward lines on the return pass: each forward word wiped
  // R→L just before the return beam would reach its left edge (beam-synced)
  (function () {
    const fwd = [];
    BML.filter((L) => !L.phaseReturn).forEach((L) => L.words.forEach((d) => fwd.push(d)));
    const els = document.querySelectorAll(".bmw.fwd");
    fwd.forEach((d, i) => {
      const frac = (d.x + d.w) / ${W};
      const et = +(${retStart} + 0.10 + (1 - frac) * 0.85).toFixed(3);
      tl.to(els[i], { clipPath: "inset(-25% 101% -25% 0%)", duration: 0.18, ease: "none" }, Math.min(et, ENDC - 0.05));
    });
  })();`
    : ""
}

  // ===== THE BEAM — piecewise path; reveals are slaved to it =====
  const A1 = ${J(A1)};
  function sweep(sel, ARR) {
    tl.set(sel, { x: ARR[0][1] }, ARR[0][0]);
    for (let i = 1; i < ARR.length; i++)
      tl.to(sel, { x: ARR[i][1], duration: Math.max(0.02, ARR[i][0] - ARR[i-1][0]), ease: "none" }, ARR[i-1][0]);
  }
  tl.set("#bmbeam", { opacity: 1, transformOrigin: "0% 50%" }, 0.12);
  sweep("#bmbeam", A1);
${
  beamLockX != null
    ? `  // FREEZE on the apex — alive: micro servo vibration while locked
  const LX = ${beamLockX};
  [[${heroIn.toFixed(3)} + 0.08, LX], [${heroIn.toFixed(3)} + 0.20, LX + 2], [${heroIn.toFixed(3)} + 0.33, LX - 1.5], [${heroIn.toFixed(3)} + 0.47, LX + 1.2], [${heroIn.toFixed(3)} + 0.62, LX - 0.8], [${heroIn.toFixed(3)} + 0.78, LX]].forEach(([t, x]) => tl.set("#bmbeam", { x }, Math.min(t, ENDC)));
  // lock flash + yield, then beam zips off right
  tl.set("#bmbeam", { filter: "brightness(2.2)" }, ${heroIn.toFixed(3)});
  tl.set("#bmbeam", { filter: "brightness(1.2)" }, ${(heroIn + 0.083).toFixed(3)});
  tl.to("#bmbeam", { opacity: 0.55, duration: 0.2 }, ${(heroIn + 0.12).toFixed(3)});
  tl.set("#bmbeam", { opacity: 0.7 }, ${(beamOff ?? Math.min(heroOut - 0.35, DUR - 0.6)).toFixed(3)});
  tl.to("#bmbeam", { x: ${W + 30}, duration: 0.18, ease: "power3.in" }, ${(beamOff ?? Math.min(heroOut - 0.35, DUR - 0.6)).toFixed(3)});
  tl.set("#bmbeam", { opacity: 0 }, ${((beamOff ?? Math.min(heroOut - 0.17, DUR - 0.42)) + 0.18).toFixed(3)});`
    : ""
}
${
  retStart != null
    ? `  // RETURN: flipped wake, hot flyback then precision scan R→L
  const A2 = [[${retStart}, ${W + 10}], [${(retStart + 0.11).toFixed(3)}, ${Math.round(W * 0.5)}], [${Math.min(DUR - 0.1, retStart + 2.0).toFixed(3)}, ${inset + 40}]];
  tl.set("#bmbeam", { x: ${W + 10}, opacity: 1, scaleX: -1, filter: "brightness(1.5)" }, ${retStart});
  sweep("#bmbeam", A2);
  tl.to("#bmbeam", { filter: "brightness(1)", duration: 0.15 }, ${(retStart + 0.12).toFixed(3)});
  tl.to("#bmbeam", { opacity: 0, duration: 0.2 }, ${Math.min(DUR - 0.06, retStart + 2.0).toFixed(3)});`
    : ""
}

  // density tags ride emphasis words (seeded label per emphasis, demo [DENSE])
  (function () {
    const TAGTXT = ${J(b.tagText || "[DENSE]")};
    let made = 0;
    BML.forEach((L) => L.words.forEach((d) => {
      if (!d.em || made >= ${b.maxTags ?? 3}) return;
      made++;
      const t = document.createElement("div"); t.className = "bmtag"; t.textContent = TAGTXT;
      t.style.left = (d.x + d.w / 2 - 32) + "px"; t.style.top = (L.rowY - 28) + "px";
      document.getElementById("bmwrap").appendChild(t);
      tl.set(t, { opacity: 1, y: -5 }, d.st + 0.12);
      tl.to(t, { y: 0, duration: 0.2, ease: "expo.out" }, d.st + 0.13);
      tl.set(t, { opacity: 0.4 }, Math.min(d.st + 0.72, ENDC));
      tl.set(t, { opacity: 0 }, Math.min(d.st + 0.78, ENDC));
    }));
  })();

  // status readout narrative
  const ST = ${J(STBEATS)};
  ST.forEach((s, i) => {
    if (i > 0) tl.set("#bmst" + (i - 1), { display: "none" }, Math.min(s[1], ENDC));
    tl.set("#bmst" + i, { display: "block" }, Math.min(s[1], ENDC));
  });
${
  b.yield && !heroInline && !HEROLESS
    ? `  // band yields while the apex lands, restores after (hierarchy rule 3)
  tl.to("#bmwrap", { opacity: ${b.yield.dim ?? 0.55}, duration: 0.2 }, ${Math.max(heroIn - (b.yield.pre ?? 0.06), 0.3).toFixed(3)});
${
  heroIn + (b.yield.post ?? 0.9) + 0.3 < DUR - 0.1
    ? `  tl.to("#bmwrap", { opacity: 1, duration: 0.3 }, ${(heroIn + (b.yield.post ?? 0.9)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css: css2, html, js };
}

function paradigmPaperrail() {
  // PAPERRAIL: stop-motion craft table — a kraft strip (torn top edge, washi-
  // taped corners, handwritten tag) holds cream paper chips that are PLACED
  // one by one: opacity full in 0 frames, y −16 + scale 1.06→1 with steps(2),
  // seeded ±2.5° crooked = the papermat drop at low amplitude. The strip
  // jitters ±0.7px every 4 frames (handmade weave); chips hold a rotation-only
  // ~5fps wobble. Emphasis words get a washi-tape slap (chip pressed 1 frame);
  // the FINAL word is an accent chip (sign-off); the hero slot keeps a red
  // paper star (rail↔climax hand-off) that pulses as the apex chips land.
  // Exits: chips peeled off (rotation −8°, y −40, steps(3)), staggered.
  const b = dna.body;
  const stripW = (b.strip && b.strip.w) || 1140;
  const stripH = (b.strip && b.strip.h) || 88;
  const SX = (b.strip && b.strip.x) ?? Math.round((W - stripW) / 2);
  const ST = H - ((b.strip && b.strip.bottomPx) ?? 26) - stripH;
  const k = (b.fontPx || 38) / 38; // chip furniture scales with the type
  const r = (v) => Math.round(v * k);
  const tapeDelay = b.tapeDelay ?? 0.25;
  // hero hand-off slot: the line whose window holds the apex keeps a star chip
  const heroLi = heroInline ? -1 : LINES.findIndex((L) => heroIn >= L.in - 0.01 && heroIn < L.out);
  const lineData = LINES.map((L, li) => {
    const n = L.words.length + (li === heroLi ? 1 : 0);
    // peel (0.18s + stagger) always completes on frame; demo cadence L.out−0.04
    const xo = +(
      li === LINES.length - 1 ? Math.min(L.out - 0.04, DUR - 0.2 - (n - 1) * 0.03) : L.out - 0.04
    ).toFixed(3);
    const words = L.words.map((w, wi) => {
      const isLast = li === LINES.length - 1 && wi === L.words.length - 1;
      const kind = isLast ? 3 : w.minor ? 1 : 0; // 0 chip / 1 taped / 2 star / 3 accent
      let tapeT = 0;
      if (kind === 1) {
        const tt = +Math.min(w.start + tapeDelay, xo - 0.2).toFixed(3);
        if (tt >= w.start + 0.08) tapeT = tt;
      }
      return [w.display, +w.start.toFixed(3), kind, tapeT];
    });
    if (li === heroLi) {
      const at = L.words.filter((w) => w.start < heroIn).length;
      words.splice(at, 0, ["*", +heroIn.toFixed(3), 2, 0]);
    }
    return { id: "pl" + L.id, in: +L.in.toFixed(3), xo, words };
  });
  const css = `
  #pstrip { position:absolute; left:${SX}px; top:${ST}px; width:${stripW}px; height:${stripH}px; opacity:0; }
  #pstrip .paper { position:absolute; inset:0;
                   background: linear-gradient(180deg, #bd9e6f 0%, #b89968 45%, #a8854f 100%);
                   box-shadow: inset 0 -4px 0 rgba(90,66,30,0.55); }
  .pwt  { position:absolute; width:84px; height:24px; opacity:0.62; background: rgba(255,99,84,0.85); }
  .pwt i { position:absolute; inset:0; display:block;
           background: repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 6px, rgba(255,255,255,0) 6px 13px); }
  #pwtL { left:-16px; top:-11px; } #pwtR { right:-14px; top:-9px; }
  #ptag { position:absolute; right:30px; top:${stripH - 38}px; font-family:'${dna.fonts.tag}', cursive;
          font-size:24px; color:${dna.palette.tag || "#503d20"}; opacity:0.85; white-space:nowrap; }
  #plines { position:absolute; inset:0; }
  .pline { position:absolute; left:${W / 2}px; top:${ST + 14}px; white-space:nowrap; opacity:0; }
  .pchip { position:relative; display:inline-block; margin-right:${r(10)}px; padding:${r(5)}px ${r(14)}px ${r(7)}px;
           background:${dna.palette.chip || "#f6edd8"}; border:1px solid ${dna.palette.chipEdge || "#cdb98e"}; border-radius:3px;
           box-shadow: 0 3px 0 rgba(58,38,16,0.38);
           font-family:'${dna.fonts.body}', sans-serif; font-weight:600; font-size:${b.fontPx}px; line-height:1.15;
           color:${dna.palette.body}; opacity:0; }
  .pchip.red { background:${dna.palette.accent}; border-color:${dna.palette.accentEdge || "#c93527"}; color:#fff3e4; }
  .ptape { position:absolute; top:-10px; right:-15px; width:${r(58)}px; height:${r(18)}px; opacity:0;
           background: rgba(255,79,63,0.66); }
  .ptape i { position:absolute; inset:0; display:block;
             background: repeating-linear-gradient(90deg, rgba(255,255,255,0.25) 0 5px, rgba(255,255,255,0) 5px 11px); }
  .pstarw { position:relative; display:inline-block; width:${r(46)}px; height:${r(44)}px;
            margin-right:${r(10)}px; vertical-align:${-r(7)}px; opacity:0; }
  .pstar { position:absolute; inset:0; background:${dna.palette.accent};
           clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
           filter: drop-shadow(0 3px 0 rgba(58,38,16,0.38)); }`;
  const html = `      <div id="pstrip">
        <div class="paper"></div>
        <div class="pwt" id="pwtL"><i></i></div>
        <div class="pwt" id="pwtR"><i></i></div>
        <div id="ptag">${esc(b.tag || "cut & paste · 12 fps")}</div>
      </div>
      <div id="plines">
${lineData.map((L) => `        <div class="pline" id="${L.id}"></div>`).join("\n")}
      </div>`;
  const dimT = +Math.max(0.15, heroIn - ((b.yield && b.yield.pre) || 0.2)).toFixed(3);
  const resT = +(heroIn + ((b.yield && b.yield.post) || 0.9)).toFixed(3);
  const js = `
  // ---- body paradigm: PAPERRAIL (chips placed steps(2) / peel-off exit) ----
  const RAILP = ${J(lineData)};
  const rrnd = mulberry32(${b.seed || 150372});
  // torn top edge on the kraft strip (sides/bottom are the table cut)
  (function(){
    const pts = []; const SEG = 28;
    for (let i = 0; i <= SEG; i++)
      pts.push(((${stripW}/SEG)*i).toFixed(1) + "px " + Math.max(0, (rrnd()-0.5)*8 + 4).toFixed(1) + "px");
    pts.push("${stripW}px ${stripH}px", "0px ${stripH}px");
    document.querySelector("#pstrip .paper").style.clipPath = "polygon(" + pts.join(",") + ")";
  })();
  gsap.set("#pwtL", { rotation: -38 });
  gsap.set("#pwtR", { rotation: 33 });
  gsap.set("#ptag", { rotation: -2 });

  // ===== STRIP: placed on the table, then handmade jitter every 4 frames =====
  tl.set("#pstrip", { opacity: 1 }, 0.10);
  tl.fromTo("#pstrip", { y: ${stripH + 26} }, { y: 0, duration: 0.18, ease: "steps(3)" }, 0.10);
  for (let t = 0.45; t < ${(DUR - 0.06).toFixed(3)}; t += 1/6)
    tl.set("#pstrip", { x: (rrnd()-0.5)*1.4, y: (rrnd()-0.5)*1.4, rotation: (rrnd()-0.5)*0.36 }, t);
${
  b.yield && !heroInline
    ? `
  // rail yields while the apex chips land (furniture never contests the hero)
  tl.to(["#pstrip", "#plines"], { opacity: ${b.yield.dim}, duration: 0.10 }, ${dimT});
${resT + 0.3 < DUR ? `  tl.to(["#pstrip", "#plines"], { opacity: 1, duration: 0.22 }, ${resT});` : ""}`
    : ""
}

  // ===== BODY: paper chips placed one by one =====
  RAILP.forEach((L) => {
    const line = document.getElementById(L.id);
    gsap.set(line, { xPercent: -50 });
    tl.set(line, { opacity: 1 }, L.in);
    L.words.forEach(([txt, st, kind, tapeT], wi) => {
      let el;
      if (kind === 2) {                  // apex hand-off: red paper star in the slot
        el = document.createElement("span"); el.className = "pstarw";
        const s = document.createElement("span"); s.className = "pstar";
        el.appendChild(s); line.appendChild(el);
        // placement pulse when the apex word starts landing
        tl.set(s, { scale: 1.18 }, st + 0.09);
        tl.set(s, { scale: 1.06 }, st + 0.17);
        tl.set(s, { scale: 1 },    st + 0.25);
      } else {
        el = document.createElement("span");
        el.className = "pchip" + (kind === 3 ? " red" : "");
        el.textContent = txt;
        line.appendChild(el);
      }
      const r0 = (rrnd()-0.5)*5;         // seeded ±2.5° crooked placement
      gsap.set(el, { transformOrigin: "50% 80%" });
      // PLACED: the apex drop at low amplitude — opacity full in 0 frames
      tl.set(el, { opacity: 1, rotation: r0 }, st);
      tl.fromTo(el, { y: -16, scale: 1.06 }, { y: 0, scale: 1, duration: 0.12, ease: "steps(2)" }, st);
      // handmade hold wobble (rotation only, ~5fps)
      for (let t = st + 0.40; t < L.xo - 0.06; t += 0.21)
        tl.set(el, { rotation: r0 + (rrnd()-0.5)*1.0 }, t);
      // washi-tape slap pins the emphasis words
      if (kind === 1 && tapeT > 0) {
        const tape = document.createElement("span"); tape.className = "ptape";
        const ti = document.createElement("i"); tape.appendChild(ti);
        el.appendChild(tape);
        gsap.set(tape, { rotation: -36 });
        tl.set(tape, { opacity: 0.92 }, tapeT);
        tl.fromTo(tape, { scale: 1.7 }, { scale: 1, duration: 0.0833, ease: "steps(2)" }, tapeT);
        tl.set(el, { y: 2 }, tapeT);     // chip pressed by the slap
        tl.set(el, { y: 0 }, tapeT + 0.0833);
      }
      // EXIT: peeled off
      tl.to(el, { rotation: r0 - 8, y: -40, opacity: 0, duration: 0.18, ease: "steps(3)" },
            L.xo + wi*0.03);
    });
  });`;
  return { css, html, js };
}

function paradigmPopuprail() {
  // POPUPRAIL: pop-up book page — a cream page strip (center foldline) unfolds
  // up from the bottom edge (scaleY back.out, the stage is built); words POP
  // UP on a baseline hinge (rotationX 85→0, back.out = the centerfold motif at
  // low amplitude) on two reading rows that alternate per line. Emphasis words
  // land bigger with a contact squash the strip FEELS (1px dip), then flick-
  // wobble; blue paper struts lean in behind emphasis + the sign-off word; the
  // hero slot keeps a blue paper star (rail↔climax hand-off). Exits fold flat
  // in an L→R wave (the page closing); on the final word the whole page TILTS
  // (paper physics) and the strip itself folds shut on the last frame.
  const b = dna.body;
  const stripW = (b.strip && b.strip.w) || 1230;
  const stripH = (b.strip && b.strip.h) || 124;
  const rowY = { A: H - (b.rowA ?? 70), B: H - (b.rowB ?? 20) };
  const k = (b.fontPx || 42) / 42; // chip furniture scales with the type
  const r = (v) => Math.round(v * k);
  const emPx = b.emPx || Math.round((b.fontPx || 42) * 1.24);
  const maxHold = b.maxHold ?? 0.95;
  // hero hand-off slot: the line whose window holds the apex keeps a star chip
  const heroLi = heroInline ? -1 : LINES.findIndex((L) => heroIn >= L.in - 0.01 && heroIn < L.out);
  const lineData = LINES.map((L, li) => {
    const lastSt = L.words[L.words.length - 1].start;
    const n = L.words.length + (li === heroLi ? 1 : 0);
    // fold as the next line begins, or after maxHold in silence; the fold wave
    // + slot hide always complete by DUR−0.017 (demo cadence: L4 folds 5.76)
    const foldT = +Math.min(L.out, lastSt + maxHold, DUR - 0.147 - 0.045 * (n - 1)).toFixed(3);
    const words = L.words.map((w, wi) => {
      const isLast = li === LINES.length - 1 && wi === L.words.length - 1;
      const kind = isLast ? 2 : w.minor ? 1 : 0; // 0 plain | 1 emph | 2 emph-blue | 3 star
      let wobT = 0,
        wobD = 0,
        strutT = 0;
      if (kind === 1) {
        // paper-flick after landing, squeezed to fit before the fold
        const wt = +(w.start + 0.2).toFixed(3);
        const wd = +Math.min(0.5, foldT - wt - 0.04).toFixed(2);
        if (wd >= 0.15) {
          wobT = wt;
          wobD = wd;
        }
      }
      if (kind >= 1) {
        const st2 = +Math.min(w.start + (kind === 2 ? 0.15 : 0.26), foldT - 0.1).toFixed(3);
        if (st2 >= w.start + 0.08) strutT = st2;
      }
      return [w.display, +w.start.toFixed(3), kind, wobT, wobD, strutT];
    });
    if (li === heroLi) {
      const at = L.words.filter((w) => w.start < heroIn).length;
      words.splice(at, 0, ["*", +heroIn.toFixed(3), 3, 0, 0, 0]);
    }
    return { id: "pu" + L.id, row: li % 2 === 0 ? "A" : "B", foldT, words };
  });
  const css = `
  #pupage { position:absolute; inset:0; }
  #pustrip { position:absolute; left:${W / 2}px; top:${H}px; width:${stripW}px; height:${stripH}px;
             opacity:0; border-radius:4px 4px 0 0;
             background: linear-gradient(180deg, ${dna.palette.page || "#f7eed8"} 0%, ${dna.palette.page2 || "#f0e4c8"} 55%, ${dna.palette.page3 || "#e7d8b4"} 100%);
             border-top: 2px solid ${dna.palette.pageEdge || "rgba(122,96,54,0.55)"};
             box-shadow: 0 -12px 26px rgba(18,12,5,0.38), inset 0 14px 18px rgba(255,255,248,0.5); }
  #pufold { position:absolute; left:50%; top:0; bottom:0; width:3px; margin-left:-1px;
            background: linear-gradient(90deg, rgba(120,95,55,0) 0%, rgba(120,95,55,0.30) 50%, rgba(255,252,240,0.5) 100%); }
  .puline { position:absolute; left:${W / 2}px; white-space:nowrap; }
  .puslot { display:inline-block; position:relative; margin-right:0.34em; vertical-align:baseline; }
  .puw { display:inline-block; position:relative; z-index:1; opacity:0;
         font-family:'${dna.fonts.body}', sans-serif; font-weight:600; font-size:${b.fontPx}px;
         line-height:1.04; color:${dna.palette.body}; }
  .puw.em { font-size:${emPx}px; font-weight:800; }
  .puw.blue { color:${dna.palette.blue || dna.palette.accent}; }
  .puw.star { width:${r(30)}px; height:${r(30)}px; background:${dna.palette.accent}; vertical-align:${-r(2)}px;
              filter: drop-shadow(0 2px 2px rgba(60,40,15,0.35));
              clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
  .pustrut { position:absolute; right:-8px; bottom:0; width:${r(19)}px; height:${r(16)}px;
             background: linear-gradient(180deg,${dna.palette.strut1 || "#4f93c4"} 0%, ${dna.palette.strut2 || dna.palette.accent} 70%);
             clip-path: polygon(0 100%, 100% 100%, 100% 0); opacity:0; z-index:0; }`;
  const html = `      <div id="pupage">
        <div id="pustrip"><div id="pufold"></div></div>
${lineData.map((L) => `        <div class="puline" id="${L.id}"></div>`).join("\n")}
      </div>`;
  const js = `
  // ---- body paradigm: POPUPRAIL (baseline-hinge pop-ups / fold-flat exit) ----
  const RAILU = ${J(lineData)};
  const ROWY = ${J(rowY)};

  // ===== PAGE STRIP: unfolds up from the bottom edge (the stage is built) =====
  gsap.set("#pustrip", { xPercent: -50, yPercent: -100, transformOrigin: "50% 100%", scaleY: 0.02 });
  tl.set("#pustrip", { opacity: 1 }, 0.14);
  tl.to("#pustrip", { scaleY: 1, duration: 0.24, ease: "back.out(1.5)" }, 0.14);
  // hold life: the whole page breathes very gently
  tl.to("#pupage", { keyframes: { y: [0, -1.6, -0.4, -1.4, 0] },
                     duration: ${Math.min(5.3, DUR - 0.75).toFixed(2)}, ease: "sine.inOut" }, 0.40);

  // ===== BODY: words pop up on the baseline hinge =====
  RAILU.forEach((L) => {
    const line = document.getElementById(L.id);
    line.style.top = ROWY[L.row] + "px";
    const els = L.words.map(([txt, st, kind]) => {
      const slot = document.createElement("span"); slot.className = "puslot";
      let strut = null;
      if (kind === 1 || kind === 2) {
        strut = document.createElement("div"); strut.className = "pustrut";
        slot.appendChild(strut);
      }
      const w = document.createElement("span");
      w.className = "puw" + (kind === 1 ? " em" : kind === 2 ? " em blue" : kind === 3 ? " star" : "");
      if (kind !== 3) w.textContent = txt;
      slot.appendChild(w);
      line.appendChild(slot);
      return { w, strut, slot };
    });
    gsap.set(line, { xPercent: -50, yPercent: -100 });

    L.words.forEach(([txt, st, kind, wobT, wobD, strutT], wi) => {
      const { w, strut, slot } = els[wi];
      gsap.set(w, { transformPerspective: 650, transformOrigin: "50% 100%", rotationX: 85 });
      // POP UP — baseline hinge, paper overshoot; back-shadow grows as it rises
      tl.set(w, { opacity: 1, textShadow: "0 0px 0px rgba(70,50,25,0)" }, st);
      tl.to(w, { rotationX: 0, duration: 0.25, ease: "back.out(1.4)" }, st);
      tl.to(w, { textShadow: "0 3px 5px rgba(70,50,25,0.38)", duration: 0.25, ease: "power1.out" }, st);
      if (kind === 1 || kind === 2) {           // contact squash on the big words
        tl.set(w, { scaleX: 1.06, scaleY: 0.93 }, st + 0.12);
        tl.to(w, { scaleX: 1, scaleY: 1, duration: 0.30, ease: "elastic.out(1, 0.4)" }, st + 0.16);
        tl.set("#pustrip", { y: 1 }, st + 0.13);  // the page feels the landing
        tl.to("#pustrip", { y: 0, duration: 0.16, ease: "power2.out" }, st + 0.18);
      }
      if (wobT) tl.to(w, { keyframes: { rotationX: [0, -4, 2.8, -1.4, 0.5, 0] },
                          duration: wobD, ease: "sine.inOut" }, wobT);
      if (strut && strutT) {                    // visible paper strut leans in behind
        gsap.set(strut, { transformOrigin: "50% 100%", scaleY: 0 });
        tl.set(strut, { opacity: 1 }, strutT);
        tl.to(strut, { scaleY: 1, duration: 0.12, ease: "back.out(2)" }, strutT);
      }
      // EXIT — the page closes: words fold flat in an L→R wave
      const ft = L.foldT + wi * 0.045;
      tl.to(w, { rotationX: 88, duration: 0.12, ease: "power2.in" }, ft);
      tl.to(w, { textShadow: "0 0px 0px rgba(70,50,25,0)", duration: 0.12 }, ft);
      if (strut) tl.to(strut, { scaleY: 0, duration: 0.10, ease: "power2.in" }, ft);
      tl.set(slot, { opacity: 0 }, ft + 0.13);
    });
  });
${
  b.yield && !heroInline
    ? `
  // APEX OWNS ITS WINDOW — page yields while the centerfold lands, restores
  tl.to("#pupage", { opacity: ${b.yield.dim}, duration: 0.12, ease: "power1.out" }, ${(heroIn - (b.yield.pre || 0.03)).toFixed(3)});
  tl.to("#pupage", { opacity: 1, duration: 0.22, ease: "power1.in" }, ${(heroIn + (b.yield.post || 0.47)).toFixed(3)});`
    : ""
}
${
  b.tilt !== false
    ? `
  // paper-world physics: on the final word the whole page TILTS and slides
  tl.to("#pupage", { rotation: 2, x: 6, transformOrigin: "50% 100%",
                     duration: 0.26, ease: "back.out(2.2)" }, ${(LASTWORD.start + 0.02).toFixed(3)});`
    : ""
}
  // ending: after the last fold the strip itself closes (book shut)
  tl.to("#pustrip", { scaleY: 0.03, duration: 0.07, ease: "power3.in" }, ${(DUR - 0.082).toFixed(3)});
  tl.set("#pustrip", { opacity: 0 }, ${(DUR - 0.017).toFixed(3)});`;
  return { css, html, js };
}

function paradigmChalkrail() {
  // CHALKRAIL: night-lecture chalk band — a deep-green board strip (worn top
  // hairline, eraser smudges, handwritten header tag, two chalk sticks) docked
  // at the bottom edge holds reading rows that ACCUMULATE: lines fill the rows
  // top→bottom in phases of rows.length; when the next phase needs the rows an
  // ERASER SWIPE clears the board (a blurred light band sweeps across, the
  // words SMEAR out scaleX 1.3 + blur(8), faint ghost smudges stay — chalk
  // never fully erases). Words are chalk-written fast: 2-frame pop + scribble
  // clip-reveal steps(4) + 6 seeded dust specks puffing at the base + seeded
  // ±2° tilt = the chalkwrite verb at low amplitude. Emphasis = double
  // underline dashes drawn beneath; the FINAL transcript word lands in yellow
  // chalk (sign-off). Band yields during the apex landing, restores after.
  const b = dna.body;
  const stripW = (b.strip && b.strip.w) || 1200;
  const stripH = (b.strip && b.strip.h) || 148;
  const SX = (b.strip && b.strip.x) ?? Math.round((W - stripW) / 2);
  const ST = H - ((b.strip && b.strip.bottomPx) ?? 0) - stripH;
  const rows = b.rows || [26, 82];
  const R = rows.length;
  const kw = stripW / 1200,
    kh = stripH / 148; // furniture scales with the strip (demo 1200×148)
  const lineData = LINES.map((L, li) => ({
    id: "cl" + L.id,
    top: rows[li % R],
    words: L.words.map((w, wi) => [
      w.display,
      +w.start.toFixed(3),
      w.minor ? 1 : 0,
      li === LINES.length - 1 && wi === L.words.length - 1 ? 1 : 0, // yellow sign-off
    ]),
  }));
  // eraser passes: one per phase boundary — swipe after the previous phase's
  // last word ends, always landing clear of the next phase's first word
  const erases = [];
  for (let pi = R; pi < LINES.length; pi += R) {
    const prevEnd = Math.max(
      ...LINES.slice(pi - R, pi).map((L) => L.words[L.words.length - 1].end),
    );
    const nextIn = LINES[pi].in;
    const t = +Math.max(
      prevEnd + 0.05,
      Math.min(prevEnd + (b.eraseDelay ?? 0.23), nextIn - 0.9),
    ).toFixed(3);
    erases.push({ t, lines: lineData.slice(pi - R, pi).map((L) => L.id) });
  }
  const css = `
  #cband { position:absolute; left:${SX}px; top:${ST}px; width:${stripW}px; height:${stripH}px; opacity:0;
           background: linear-gradient(180deg, ${dna.palette.bandHi || "#23392d"} 0%, ${dna.palette.board || "#1d3328"} 45%, ${dna.palette.bandLo || "#16271f"} 100%);
           border-radius:8px 8px 0 0;
           box-shadow: inset 0 0 70px rgba(0,0,0,0.5), inset 0 14px 18px -12px rgba(0,0,0,0.6),
                       0 -3px 18px rgba(0,0,0,0.35); }
  #cband .hairline { position:absolute; top:0; left:0; right:0; height:1px;
                     background: rgba(240,245,235,0.14); }
  #cband .smg { position:absolute; border-radius:50%; }
  #csmg1 { left:${Math.round(520 * kw)}px; top:${Math.round(14 * kh)}px; width:${Math.round(300 * kw)}px; height:${Math.round(90 * kh)}px; transform:rotate(-4deg);
           background: radial-gradient(50% 50% at 50% 50%, rgba(220,230,220,0.07) 0%, rgba(220,230,220,0) 70%); }
  #csmg2 { left:${Math.round(880 * kw)}px; top:${Math.round(60 * kh)}px; width:${Math.round(260 * kw)}px; height:${Math.round(74 * kh)}px; transform:rotate(5deg);
           background: radial-gradient(50% 50% at 50% 50%, rgba(220,230,220,0.06) 0%, rgba(220,230,220,0) 70%); }
  #chdr { position:absolute; top:5px; left:28px; font-family:'${dna.fonts.tag || dna.fonts.body}', cursive;
          font-size:23px; letter-spacing:1.5px; color:rgba(238,244,236,0.5); opacity:0; }
  #cstickW { position:absolute; right:30px; bottom:12px; width:52px; height:9px; border-radius:4px;
             background: linear-gradient(180deg, #f4f1e4 0%, #d9d4c2 100%);
             transform: rotate(9deg); box-shadow: 0 2px 3px rgba(0,0,0,0.4); opacity:0; }
  #cstickY { position:absolute; right:96px; bottom:11px; width:27px; height:8px; border-radius:4px;
             background: linear-gradient(180deg, #efd680 0%, #d8ba55 100%);
             transform: rotate(-5deg); box-shadow: 0 2px 3px rgba(0,0,0,0.4); opacity:0; }
  .crow { position:absolute; left:30px; white-space:nowrap;
          font-family:'${dna.fonts.body}', cursive; font-size:${b.fontPx}px; line-height:1.0; color:${dna.palette.body};
          text-shadow: ${b.glow || "0 0 7px rgba(250,250,240,0.28), 0 1px 0 rgba(255,255,255,0.10)"}; }
  .crow .w { display:inline-block; position:relative; margin-right:0.35em; opacity:0; }
  .crow .w .txt { display:inline-block; }
  .crow .w.yel { color:${dna.palette.em || "#f3d96b"}; text-shadow: 0 0 8px ${(dna.palette.em || "#f3d96b") + "52"}, 0 1px 0 rgba(255,255,255,0.08); }
  .crow .w .d { position:absolute; bottom:2px; width:3px; height:3px; border-radius:50%;
                background:${dna.palette.dust || "#f1efe2"}; opacity:0; pointer-events:none; }
  .crow .w svg.ul { position:absolute; left:2%; bottom:-8px; width:96%; height:18px; overflow:visible; }
  .cghost { position:absolute; border-radius:50%; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%, rgba(240,244,238,0.10) 0%, rgba(240,244,238,0) 70%); }
  #cgh1 { left:${Math.round(110 * kw)}px; top:${Math.round(24 * kh)}px; width:${Math.round(430 * kw)}px; height:${Math.round(62 * kh)}px; }
  #cgh2 { left:${Math.round(80 * kw)}px; top:${Math.round(80 * kh)}px; width:${Math.round(360 * kw)}px; height:${Math.round(56 * kh)}px; }
  #ceraser { position:absolute; top:-8px; left:0; width:120px; height:${stripH + 16}px; opacity:0;
             background: linear-gradient(100deg, rgba(236,242,236,0) 0%, rgba(236,242,236,0.30) 45%, rgba(236,242,236,0) 100%);
             filter: blur(5px); }`;
  const html = `      <div id="cband">
        <div class="hairline"></div>
        <div class="smg" id="csmg1"></div>
        <div class="smg" id="csmg2"></div>
        <div id="chdr">${esc(b.tag || "NIGHT LECTURE · wk 07")}</div>
        <div class="cghost" id="cgh1"></div>
        <div class="cghost" id="cgh2"></div>
${lineData.map((L) => `        <div class="crow" id="${L.id}" style="top:${L.top}px"></div>`).join("\n")}
        <div id="cstickW"></div>
        <div id="cstickY"></div>
        <div id="ceraser"></div>
      </div>`;
  const js = `
  // ---- body paradigm: CHALKRAIL (chalk scribble pop / eraser-swipe phases) ----
  const RAILC = ${J(lineData)};
  const ERASES = ${J(erases)};
  const rrnd = mulberry32(${b.seed || 13});
  const SVGNS = "http://www.w3.org/2000/svg";

  // ===== band furniture =====
  tl.fromTo("#cband", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }, 0.03);
  tl.fromTo("#chdr",    { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.30);
  tl.fromTo("#cstickW", { opacity: 0 }, { opacity: 0.92, duration: 0.2 }, 0.36);
  tl.fromTo("#cstickY", { opacity: 0 }, { opacity: 0.92, duration: 0.2 }, 0.42);

  // ===== body words: chalk-dust pop (entrance = the apex motif, low amplitude) =====
  RAILC.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt, st, em, yel]) => {
      const w = document.createElement("span"); w.className = "w" + (yel ? " yel" : "");
      const inner = document.createElement("span"); inner.className = "txt"; inner.textContent = txt;
      w.appendChild(inner); line.appendChild(w);
      gsap.set(w, { rotation: (rrnd() * 4 - 2), transformOrigin: "50% 100%" });
      gsap.set(inner, { clipPath: "inset(-30% 102% -30% -2%)" });
      // 2-frame pop + fast scribble reveal + tiny drop-settle
      tl.fromTo(w, { opacity: 0 }, { opacity: 1, duration: 0.07, ease: "power1.in" }, st);
      tl.to(inner, { clipPath: "inset(-30% -2% -30% -2%)", duration: 0.12, ease: "steps(4)" }, st);
      tl.fromTo(w, { y: 4 }, { y: 0, duration: 0.2, ease: "power2.out" }, st);
      // 6 seeded dust specks puff at the word base
      for (let k = 0; k < 6; k++) {
        const d = document.createElement("span"); d.className = "d";
        d.style.left = (6 + rrnd() * 84) + "%";
        w.appendChild(d);
        tl.set(d, { opacity: 0.85 }, st + 0.02);
        tl.to(d, { y: 12 + rrnd() * 16, x: rrnd() * 16 - 8, opacity: 0,
                   duration: 0.36 + rrnd() * 0.15, ease: "power1.in" }, st + 0.02);
      }
      // emphasis: double underline dashes drawn beneath
      if (em) {
        const svg = document.createElementNS(SVGNS, "svg");
        svg.setAttribute("class", "ul"); svg.setAttribute("viewBox", "0 0 100 18");
        svg.setAttribute("preserveAspectRatio", "none");
        const col = yel ? ${J(dna.palette.em || "#f3d96b")} : ${J(dna.palette.body)};
        [["M 3 5 C 28 2, 66 8, 97 4", Math.min(st + 0.22, ${(DUR - 0.3).toFixed(3)}), 0.12],
         ["M 6 12 C 36 9, 62 15, 95 11", Math.min(st + 0.38, ${(DUR - 0.2).toFixed(3)}), 0.10]].forEach(([dd, tu, du]) => {
          const p = document.createElementNS(SVGNS, "path");
          p.setAttribute("d", dd); p.setAttribute("fill", "none");
          p.setAttribute("stroke", col); p.setAttribute("stroke-width", "3");
          p.setAttribute("stroke-linecap", "round");
          p.setAttribute("vector-effect", "non-scaling-stroke");
          p.setAttribute("opacity", "0");
          svg.appendChild(p);
          const len = p.getTotalLength();
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
          tl.set(p, { opacity: 0.9 }, tu);
          tl.to(p, { strokeDashoffset: 0, duration: du, ease: "power2.in" }, tu);
        });
        w.appendChild(svg);
      }
    });
  });

  // ===== ERASER SWIPE between phases: light band sweeps, old words smear out =====
  ERASES.forEach((E, ei) => {
    tl.set("#ceraser", { opacity: 1, x: -160 }, E.t);
    tl.to("#ceraser", { x: ${stripW + 60}, duration: 0.42, ease: "power1.inOut" }, E.t);
    tl.set("#ceraser", { opacity: 0 }, E.t + 0.44);
    E.lines.forEach((id, r) => {
      const kids = document.getElementById(id).children;
      for (let i = 0; i < kids.length; i++)
        tl.to(kids[i], { scaleX: 1.3, x: "+=24", opacity: 0, filter: "blur(8px)",
                         transformOrigin: "0% 80%", duration: 0.18, ease: "power2.in" },
              E.t + 0.03 + r * 0.01 + i * 0.06);
    });
    // faint smudges the eraser leaves behind (stay)
    if (ei === 0) {
      tl.fromTo("#cgh1", { opacity: 0 }, { opacity: 0.8, duration: 0.25 }, E.t + 0.17);
      tl.fromTo("#cgh2", { opacity: 0 }, { opacity: 0.8, duration: 0.25 }, E.t + 0.27);
    }
  });
${
  b.yield && !heroInline
    ? `
  // APEX OWNS ITS WINDOW — band yields while the chalk word writes, restores
  tl.to("#cband", { opacity: ${b.yield.dim}, duration: 0.14, ease: "power1.in"  }, ${(heroIn - (b.yield.pre || 0.07)).toFixed(3)});
${
  heroIn + (b.yield.post || 0.41) < DUR - 0.3
    ? `  tl.to("#cband", { opacity: 1,    duration: 0.22, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.41)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css, html, js };
}

function paradigmMarkerrail() {
  // MARKERRAIL: street handstyle rail — marker words FLICK onto a stable
  // bottom rail (opacity full in 1 frame + 1-frame squeak skew, seeded crooked
  // rotation settling back.out — the spray-write verb at low amplitude);
  // emphasis words take an alternating paint color (`palette.em`/`em2`) + a
  // spray-underline SWOOSH (dash-revealed squiggle) with 8 seeded overspray
  // dots; the FINAL transcript word lands BIG in `palette.em` with mini
  // apex-impact physics (crush → squash → elastic — it rides the plate punch).
  // Spent lines are ROLLER-BUFFED: a gray paint roller sweeps across, the
  // words vanish under it and the wet smear lingers before fading; the last
  // line is never buffed (the sign-off stays painted). Rail yields while the
  // apex tag writes.
  const b = dna.body;
  const EMS = [
    dna.palette.em || dna.palette.accent,
    dna.palette.em2 || dna.palette.em || dna.palette.accent,
  ];
  let emIdx = 0;
  const lineData = LINES.map((L, li) => ({
    id: "mr" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    last: li === LINES.length - 1 ? 1 : 0,
    words: L.words.map((w, wi) => {
      const signoff = li === LINES.length - 1 && wi === L.words.length - 1;
      return [
        w.display,
        +w.start.toFixed(3),
        signoff ? EMS[0] : w.minor ? EMS[emIdx++ % EMS.length] : 0,
        signoff ? 1 : 0,
      ];
    }),
  }));
  const css = `
  .mline { position:absolute; left:${W / 2}px; top:${H - b.bottomPx}px; opacity:0; white-space:nowrap;
           font-family:'${dna.fonts.body}', cursive; font-size:${b.fontPx}px; line-height:1.25;
           color:${dna.palette.body};
           text-shadow: ${b.glow || "0 3px 12px rgba(0,0,0,0.72), 0 1px 3px rgba(0,0,0,0.6)"}; }
  .mline .w { display:inline-block; opacity:0; margin-right:0.32em; position:relative; }
  .mline .w:last-child { margin-right:0; }
  .mroller { position:absolute; left:-14px; top:-8px; right:-14px; bottom:-8px; opacity:0;
             background: linear-gradient(180deg, ${dna.palette.rollerHi || "#8d8a86"} 0%, ${dna.palette.rollerLo || "#6f6c69"} 45%, ${dna.palette.roller || "#807d79"} 100%);
             border-radius:5px; }
  .muline { position:absolute; left:-8%; top:100%; width:116%; height:26px; margin-top:-8px;
            overflow:visible; }
  .modot { position:absolute; width:5px; height:5px; border-radius:50%; opacity:0; }`;
  const html = lineData.map((L) => `      <div class="mline" id="${L.id}"></div>`).join("\n");
  const js = `
  // ---- body paradigm: MARKERRAIL (marker flick in / roller buff out) ----
  const RAILM = ${J(lineData)};
  const DURM = ${(DUR - 0.02).toFixed(3)};
  const mrnd = mulberry32(${b.seed || 20260611});
  const SVGNSM = "http://www.w3.org/2000/svg";
  function mUnderline(span, color, t0) {
    // spray underline swoosh: dash-revealed squiggle + seeded overspray dots
    const svg = document.createElementNS(SVGNSM, "svg");
    svg.setAttribute("class", "muline");
    svg.setAttribute("viewBox", "0 0 120 26");
    svg.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS(SVGNSM, "path");
    path.setAttribute("d", "M 5 13 C 28 20, 52 6, 78 12 S 108 16, 115 10");
    path.setAttribute("fill", "none"); path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "8"); path.setAttribute("stroke-linecap", "round");
    path.setAttribute("opacity", "0");
    svg.appendChild(path); span.appendChild(svg);
    const len = path.getTotalLength();
    gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
    tl.set(path, { opacity: 0.95 }, t0);
    tl.to(path, { strokeDashoffset: 0, duration: 0.2, ease: "power2.out" }, t0);
    for (let i = 0; i < 8; i++) {
      const d = document.createElement("div");
      d.className = "modot"; d.style.background = color; span.appendChild(d);
      const s = 3 + Math.round(mrnd() * 3);
      gsap.set(d, { width: s, height: s, left: (4 + mrnd() * 92) + "%",
                    bottom: -(2 + mrnd() * 18) });
      const td = t0 + 0.03 + mrnd() * 0.15;
      tl.set(d, { opacity: 0.9, scale: 0.4 }, td);
      tl.to(d, { scale: 1.25, duration: 0.12, ease: "power2.out" }, td);
      tl.to(d, { opacity: 0, duration: 0.3, ease: "power1.in" }, td + 0.12);
    }
  }
  RAILM.forEach((L) => {
    const line = document.getElementById(L.id);
    const txt = document.createElement("div");
    txt.style.position = "relative"; line.appendChild(txt);
    const roller = document.createElement("div");
    roller.className = "mroller"; line.appendChild(roller);
    gsap.set(roller, { scaleX: 0, transformOrigin: "0% 50%" });
    L.words.forEach(([w]) => {
      const s = document.createElement("span");
      s.className = "w"; s.textContent = w; txt.appendChild(s);
    });
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);
    L.words.forEach(([w, st, em, big], wi) => {
      const el = txt.children[wi];
      const rot0 = (mrnd() - 0.5) * 12, rotF = (mrnd() - 0.5) * 4;
      // FLICK IN: opacity full in 1 frame, squeak skew for 1 frame, back.out settle
      tl.set(el, { opacity: 1, scale: big ? 1.5 : 1.18, rotation: rot0, skewX: 7,
                   color: em || ${J(dna.palette.body)}, transformOrigin: "50% 88%" }, st);
      tl.set(el, { skewX: 0 }, st + F);
      if (big) { // sign-off lands with the plate punch — mini apex-impact physics
        tl.to(el, { scale: 1, duration: 0.09, ease: "power3.in" }, st + F);
        tl.set(el, { scaleX: 1.1, scaleY: 0.9 }, st + F + 0.09);
        tl.to(el, { scaleX: 1, scaleY: 1, duration: 0.26, ease: "elastic.out(1, 0.4)" }, st + F + 0.09 + 2 * F);
        tl.to(el, { rotation: rotF, duration: 0.2, ease: "power2.out" }, st + F);
      } else {
        tl.to(el, { scale: 1, rotation: rotF, duration: 0.18, ease: "back.out(2.2)" }, st + F);
      }
      if (em && !big) mUnderline(el, em, Math.min(st + 0.22, ${(DUR - 0.5).toFixed(3)}));
    });
    if (!L.last) { // BUFF EXIT: gray roller sweeps the line, smear lingers
      const XO = L.out - 0.15;
      tl.set(roller, { opacity: 0.92 }, XO);
      tl.fromTo(roller, { scaleX: 0 }, { scaleX: 1, duration: 0.15, ease: "power2.in" }, XO);
      tl.set(txt, { opacity: 0 }, XO + 0.15);
      tl.to(roller, { opacity: 0.15, filter: "blur(2px)", duration: 0.22, ease: "power1.out" }, XO + 0.17);
      tl.to(roller, { opacity: 0, duration: 0.35 }, Math.min(XO + 0.55, DURM - 0.36));
      tl.set(line, { display: "none" }, Math.min(XO + 0.95, DURM));
    }
  });
${
  b.yield && !heroInline
    ? `  // APEX OWNS ITS WINDOW — the line visible at the tag's onset yields.
  // Restore only with runway before the buff (else the line exits dimmed).
  RAILM.forEach((L) => {
    if (L.in <= ${heroIn.toFixed(3)} && L.out > ${(heroIn - (b.yield.pre || 0.04)).toFixed(3)}) {
      const dimT = Math.max(${(heroIn - (b.yield.pre || 0.04)).toFixed(3)}, L.in + 0.05);
      const XO2 = L.out - 0.15;
      if (XO2 > dimT + 0.2 || L.last) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.16 }, dimT);
        const resT = ${(heroIn + (b.yield.post || 0.17)).toFixed(3)};
        if (L.last ? resT < DURM - 0.3 : resT + 0.15 < XO2)
          tl.to("#" + L.id, { opacity: 1, duration: 0.18 }, resT);
      }
    }
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmGlassrail() {
  // GLASSRAIL: frosted-glass lower third — each transcript word rides its own
  // rounded glass CHIP (a backdrop-filter blur pill with a hairline rim, top
  // inner highlight and a soft drop shadow) on a stable bottom rail; lines
  // replace each other. ENTRANCE = the apex motif at low amplitude: opacity in
  // 2 frames + a soft slide-up (y18, power3.out) + a one-shot light-catch sheet
  // (.fl) that flashes white across the chip and fades (the glass catching the
  // light). EMPHASIS words get ONE diagonal specular GLINT sweeping across the
  // chip (a skewed bright band, the same glint the slab gets). EXIT = the whole
  // line of chips slides DOWN and fades (glass dropping out of the light). Rail
  // yields while the apex slab lands. No flying words, no scatter — the chips
  // are a fixed reading surface; the only motion is the light moving across.
  const b = dna.body;
  const lineData = LINES.map((L) => ({
    id: "gr" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const rim = dna.palette.rim || "rgba(255,255,255,0.28)";
  const tint = dna.palette.tint || "rgba(150,195,230,0.10)";
  const css = `
  .gline { position:absolute; left:${W / 2}px; top:${H - b.bottomPx}px; white-space:nowrap; opacity:0; }
  .gchip { position:relative; display:inline-block; overflow:hidden; opacity:0;
           margin:0 5px; padding:7px 16px 10px; border-radius:${b.chipRadius || 10}px;
           background: linear-gradient(180deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.07) 55%, ${tint} 100%);
           border:1px solid ${rim};
           box-shadow: 0 6px 18px rgba(4,12,22,0.38), inset 0 1px 0 rgba(255,255,255,0.32);
           backdrop-filter: blur(${b.blur || 14}px);
           font-family:'${dna.fonts.body}', sans-serif; font-weight:${b.fontWeight || 500};
           font-size:${b.fontPx}px; line-height:1.1; letter-spacing:${b.letterSpacing || "0.01em"};
           color:${dna.palette.body}; text-shadow: ${b.glow || "0 1px 6px rgba(6,16,28,0.55)"}; }
  .gchip.em { color:${dna.palette.em || dna.palette.body}; font-weight:${(b.fontWeight || 500) + 100}; }
  .gchip .txt { position:relative; z-index:2; }
  .gchip .fl { position:absolute; inset:0; opacity:0; z-index:1;
               background: linear-gradient(180deg, rgba(255,255,255,0.50), rgba(220,240,255,0.14)); }
  .gchip .sweep { position:absolute; top:-12px; bottom:-12px; left:0; width:34px; opacity:0; z-index:3;
                  transform: skewX(-18deg);
                  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 46%, rgba(210,240,255,0.6) 54%, rgba(255,255,255,0) 100%); }`;
  const html = lineData.map((L) => `      <div class="gline" id="${L.id}"></div>`).join("\n");
  const js = `
  // ---- body paradigm: GLASSRAIL (light-catch slide-up in / slide-down out) ----
  const GRAIL = ${J(lineData)};
  const DURG = ${(DUR - 0.02).toFixed(3)};
  GRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt,,em]) => {
      const chip = document.createElement("span");
      chip.className = "gchip" + (em ? " em" : "");
      const fl = document.createElement("span"); fl.className = "fl";
      const sweep = document.createElement("span"); sweep.className = "sweep";
      const t = document.createElement("span"); t.className = "txt"; t.textContent = txt;
      chip.appendChild(fl); chip.appendChild(sweep); chip.appendChild(t);
      line.appendChild(chip);
    });
    gsap.set(line, { xPercent: -50, yPercent: -50 });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);
    L.words.forEach(([txt, st, em], wi) => {
      const chip = line.children[wi];
      const fl = chip.children[0], sweep = chip.children[1];
      // entrance: opacity in 2 frames, soft slide up, glass catches the light
      tl.fromTo(chip, { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, st);
      tl.fromTo(chip, { y: ${b.riseY || 18} }, { y: 0, duration: 0.22, ease: "power3.out" }, st);
      tl.fromTo(fl, { opacity: 0.55 }, { opacity: 0, duration: 0.16, ease: "power2.out" }, st + 0.02);
      if (em) { // ONE diagonal specular glint sweeps across the emphasized chip
        const sStart = st + 0.11, sDur = 0.36;
        tl.set(sweep, { opacity: 1, x: -50 }, sStart);
        tl.to(sweep, { x: 250, duration: sDur, ease: "power2.inOut" }, sStart);
        tl.set(sweep, { opacity: 0 }, sStart + sDur + 0.01);
      }
    });
    // exit: the line of glass chips slides down and fades
    const XO = L.out - 0.15;
    tl.to(line, { y: ${b.dropY || 26}, opacity: 0, duration: 0.15, ease: "power2.in" }, XO);
    tl.set(line, { display: "none" }, XO + 0.17);
  });
${
  b.yield && !heroInline && !HEROLESS
    ? `  // APEX OWNS ITS WINDOW — the line feeding the slab yields while it lands,
  // restored before its own exit (never two owners of one opacity channel).
  GRAIL.forEach((L) => {
    if (L.in <= ${(heroIn + 0.05).toFixed(3)} && L.out > ${(heroIn - (b.yield.pre || 0.04)).toFixed(3)}) {
      const dimT = Math.max(${(heroIn - (b.yield.pre || 0.04)).toFixed(3)}, L.in + 0.05);
      const XO2 = L.out - 0.15;
      if (XO2 > dimT + 0.2) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.16 }, dimT);
        const resT = ${(heroIn + (b.yield.post || 0.31)).toFixed(3)};
        if (resT + 0.15 < XO2) tl.to("#" + L.id, { opacity: 1, duration: 0.18 }, resT);
      }
    }
  });`
    : ""
}`;
  return { css, html, js };
}

function paradigmBrushrail() {
  // BRUSHRAIL: washi paper band — a deckle-edged paper band (two faintly
  // rotated under-sheets + a warm translucent main sheet) swipes in L→R behind
  // a traveling brush-head shadow (the ink gesture at low amplitude); body
  // words are brush-WIPED on (clip reveal 0.16s behind a per-word brush head)
  // on centered replace-lines with seeded ±1° tilt; emphasis words get a
  // double curved ink underline drawn beneath (fat wash + tight core); spent
  // lines are wiped OFF right-to-left like a wet cloth (the reveal in reverse,
  // an erase brush head riding the wipe); the band + the line under the
  // gesture yield while the apex lands, and the band exits with the last line
  // on one final R→L wipe.
  const b = dna.body;
  const stripW = (b.strip && b.strip.w) || 820;
  const stripH = (b.strip && b.strip.h) || 90;
  const SX = (b.strip && b.strip.x) ?? Math.round((W - stripW) / 2);
  const ST = H - ((b.strip && b.strip.bottomPx) ?? 61) - stripH;
  const CX = SX + Math.round(stripW / 2),
    CY = ST + Math.round(stripH / 2);
  const lineY = CY - 1;
  const maxHold = b.maxHold ?? 0.78;
  const lineData = LINES.map((L, li) => {
    const lastSt = L.words[L.words.length - 1].start;
    // erase: as the next line needs the surface, or after maxHold in silence;
    // the LAST line is wiped with the band just before the clip ends
    let eraseT, eraseEnd;
    if (li === LINES.length - 1) {
      eraseT = +(DUR - 0.142).toFixed(3);
      eraseEnd = +(DUR - 0.032).toFixed(3);
    } else {
      eraseT = +Math.max(lastSt + 0.18, Math.min(L.out - 0.136, lastSt + maxHold)).toFixed(3);
      eraseEnd = +Math.max(eraseT + 0.06, Math.min(L.out + 0.004, eraseT + 0.14)).toFixed(3);
    }
    return {
      id: "br" + L.id,
      eraseT,
      eraseEnd,
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    };
  });
  const lastE = lineData[lineData.length - 1].eraseT;
  const heroLi = heroInline ? -1 : LINES.findIndex((L) => heroIn >= L.in - 0.01 && heroIn < L.out);
  const INKB = dna.palette.body || "#221a12"; // brush-head shadow = the body ink
  const breD = Math.min(5.5, DUR - 0.55).toFixed(2);
  const breN = Math.max(16, Math.round(breD * 11.6));
  const css = `
  #band { position:absolute; left:${CX}px; top:${CY}px; width:${stripW}px; height:${stripH}px; }
  .bandu { position:absolute; inset:0; border-radius:8px;
           background: linear-gradient(180deg, ${dna.palette.paperHi || "#efe8d7"} 0%, ${dna.palette.paperLo || "#e7dfcb"} 100%); }
  #bandu1 { transform:rotate(-0.7deg) scale(1.012); opacity:0.42; }
  #bandu2 { transform:rotate(0.5deg) scaleX(0.99); opacity:0.42; }
  #bandmain { position:absolute; inset:0; border-radius:8px;
              background: linear-gradient(180deg, ${dna.palette.sheetHi || "#f5efe2"}ed 0%, ${dna.palette.sheetLo || "#ece4d2"}ed 100%);
              box-shadow: 0 5px 20px rgba(18,14,10,0.4), inset 0 0 26px rgba(120,98,70,0.18); }
  .bandbh { position:absolute; top:-8%; width:30px; height:116%; opacity:0;
            background: linear-gradient(90deg, ${dna.palette.bh || "#281e14"}00 0%, ${dna.palette.bh || "#281e14"}80 100%);
            filter: blur(7px); }
  .bline { position:absolute; left:${CX}px; top:${lineY}px; white-space:nowrap; opacity:0;
           font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 600}; font-size:${b.fontPx}px;
           line-height:1; color:${dna.palette.body};
           text-shadow: 0 1px 2px rgba(70,48,26,0.22); }
  .bline .cell { display:inline-block; position:relative; margin-right:0.3em; }
  .bline .wrap { display:inline-block; position:relative; }
  .bline .bh   { position:absolute; top:-14%; width:26px; height:128%; opacity:0.55;
                 background: linear-gradient(90deg, ${INKB}00 0%, ${INKB}8c 100%);
                 filter: blur(6px); }
  .bline svg.ul { position:absolute; left:-3%; bottom:-12px; width:106%; height:14px;
                  overflow:visible; }
  .bline .ebh  { position:absolute; top:-18%; width:34px; height:136%; opacity:0;
                 background: linear-gradient(270deg, ${INKB}00 0%, ${INKB}80 100%);
                 filter: blur(7px); }`;
  const html = `      <div id="band">
        <div class="bandu" id="bandu1"></div>
        <div class="bandu" id="bandu2"></div>
        <div id="bandmain"></div>
        <div class="bandbh" id="bandbh"></div>
      </div>
      <div id="blines">
${lineData.map((L) => `        <div class="bline" id="${L.id}"></div>`).join("\n")}
      </div>`;
  const js = `
  // ---- body paradigm: BRUSHRAIL (brush-wipe reveals / wet-cloth wipe exits) ----
  const RAILB = ${J(lineData)};
  const brnd = mulberry32(${b.seed || 20260611});
  const SVGNSB = "http://www.w3.org/2000/svg";
  const ULD1 = "M 5 8 C 30 11.5, 68 4, 95 7";
  const ULD2 = "M 2 9 C 32 12.5, 66 4.5, 98 7.5";

  // ===== BAND: swipes in L→R behind a brush head (the gesture, low amplitude) =====
  gsap.set("#band", { xPercent: -50, yPercent: -50, clipPath: "inset(0% 100% 0% 0%)" });
  tl.to("#band", { clipPath: "inset(0% 0% 0% 0%)", duration: 0.2, ease: "power2.out" }, 0.08);
  tl.fromTo("#bandbh", { left: -30, opacity: 0.6 },
            { left: "100%", opacity: 0.6, duration: 0.2, ease: "power2.out" }, 0.08);
  tl.set("#bandbh", { opacity: 0 }, 0.30);
  // paper under light: the deckle under-sheet breathes faintly (baked f(t))
  const bnB = ${breN}, bvB = [];
  for (let k = 0; k <= bnB; k++) bvB.push(0.40 + 0.05 * Math.sin(2 * Math.PI * 0.32 * (k / bnB * ${breD})));
  tl.to("#bandu1", { keyframes: { opacity: bvB }, duration: ${breD}, ease: "none" }, 0.3);

  // ===== BODY: words brush-wiped on, lines wiped off like a wet cloth =====
  RAILB.forEach((L) => {
    const line = document.getElementById(L.id);
    const rot = (brnd() - 0.5) * 2;                    // seeded ±1° tilt
    L.words.forEach(([txt,, em]) => {
      const cell = document.createElement("span"); cell.className = "cell";
      const wrap = document.createElement("span"); wrap.className = "wrap";
      const tx = document.createElement("span"); tx.textContent = txt;
      const bh = document.createElement("div"); bh.className = "bh";
      wrap.appendChild(tx); wrap.appendChild(bh); cell.appendChild(wrap);
      if (em) {                                        // double curved ink underline
        const svg = document.createElementNS(SVGNSB, "svg");
        svg.setAttribute("class", "ul"); svg.setAttribute("viewBox", "0 0 100 14");
        svg.setAttribute("preserveAspectRatio", "none");
        const mkp = (d, w, op) => {
          const p = document.createElementNS(SVGNSB, "path");
          p.setAttribute("d", d); p.setAttribute("fill", "none");
          p.setAttribute("stroke", ${J(dna.palette.ulInk || dna.palette.body)});
          p.setAttribute("stroke-width", w);
          p.setAttribute("stroke-opacity", op); p.setAttribute("stroke-linecap", "round");
          p.setAttribute("opacity", "0"); svg.appendChild(p); return p;
        };
        cell._ulFat = mkp(ULD1, 7, 0.3);
        cell._ulCore = mkp(ULD2, 2.6, 0.95);
        cell.appendChild(svg);
      }
      line.appendChild(cell);
    });
    const ebh = document.createElement("div"); ebh.className = "ebh";
    line.appendChild(ebh);
    gsap.set(line, { xPercent: -50, yPercent: -50, rotation: rot });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);

    L.words.forEach(([txt, st, em], wi) => {
      const cell = line.children[wi];
      const wrap = cell.firstChild, bh = wrap.children[1];
      gsap.set(wrap, { clipPath: "inset(-14% 100% -14% 0%)" });
      tl.to(wrap, { clipPath: "inset(-14% 0% -14% 0%)", duration: 0.16, ease: "power2.out" }, st);
      tl.fromTo(bh, { left: -26, opacity: 0.55 },
                { left: "100%", opacity: 0.55, duration: 0.16, ease: "power2.out" }, st);
      tl.set(bh, { opacity: 0 }, st + 0.17);
      if (em) {
        [[cell._ulFat, 0.12], [cell._ulCore, 0.15]].forEach(([p, dly]) => {
          const len = p.getTotalLength();
          const tu = Math.min(st + dly, ${(DUR - 0.3).toFixed(3)});
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
          tl.set(p, { opacity: 1 }, tu);
          tl.to(p, { strokeDashoffset: 0, duration: 0.22, ease: "power2.out" }, tu);
        });
      }
    });

    // EXIT: the reveal in reverse — a wet cloth wipes R→L, erase head riding
    gsap.set(line, { clipPath: "inset(-30% 0% -30% 0%)" });
    tl.to(line, { clipPath: "inset(-30% 100% -30% 0%)", duration: L.eraseEnd - L.eraseT,
                  ease: "power2.in" }, L.eraseT);
    tl.fromTo(ebh, { left: "100%", opacity: 0.5 },
              { left: -34, opacity: 0.5, duration: L.eraseEnd - L.eraseT, ease: "power2.in" }, L.eraseT);
    tl.set(ebh, { opacity: 0 }, L.eraseEnd + 0.01);
    tl.set(line, { opacity: 0 }, L.eraseEnd + 0.02);
  });
${
  b.yield && !heroInline
    ? `
  // APEX OWNS ITS WINDOW — band + the line under the gesture yield, band restores
  tl.to(${heroLi >= 0 ? `["#band", "#br${heroLi}"]` : `"#band"`}, { opacity: ${b.yield.dim}, duration: 0.16 }, ${(heroIn - (b.yield.pre || 0.16)).toFixed(3)});
${
  heroIn + (b.yield.post || 0.46) + 0.3 < DUR
    ? `  tl.to("#band", { opacity: 1, duration: 0.18 }, ${(heroIn + (b.yield.post || 0.46)).toFixed(3)});`
    : ""
}`
    : ""
}

  // ending: the band itself is wiped off with the last line (one final R→L wipe)
  tl.to("#band", { clipPath: "inset(0% 100% 0% 0%)", duration: 0.13, ease: "power2.in" }, ${lastE});
  tl.fromTo("#bandbh", { left: "100%", opacity: 0.6 },
            { left: -30, opacity: 0.6, duration: 0.13, ease: "power2.in" }, ${lastE});
  tl.set("#bandbh", { opacity: 0 }, ${Math.min(lastE + 0.14, DUR - 0.01).toFixed(3)});`;
  return { css, html, js };
}

function paradigmInkrail() {
  // INKRAIL: sumi ink on still water — up to three fixed reading ROWS at the
  // bottom center (rows cycle in pairs, the closing line takes the third row,
  // so the final thought ACCUMULATES instead of replacing) where Mincho-serif
  // ink words BLEED in over a paper-white halo glow (opacity snaps in 2
  // frames; blur 12→0 + scale 1.25→1 carry the bleed — the apex bloom at low
  // amplitude) while a duplicate blurred dark halo overshoots then tightens;
  // an ink-settling RULE (gradient hairline) draws beneath each line;
  // emphasis words shed a faint ink wisp curling off the word top; spent
  // lines RE-DISSOLVE (blur up + spread + fade + slight rise — ink dispersing
  // back into the water) as the line-after-next approaches (= the next
  // occupant of their row); the closing lines persist to clip end; the rows
  // visible under the bloom yield while the drop blooms.
  const b = dna.body;
  const rowGap = b.rowGap ?? 56;
  const bottomPx = b.bottomPx ?? 36; // center of the LAST reading row
  const n = LINES.length;
  const base = n >= 3 ? 0 : 3 - n; // few lines sink to the lower rows
  const lineData = LINES.map((L, li) => {
    const slot = li === n - 1 && n >= 3 ? 2 : base + (li % 2);
    let outT = null,
      outDur = 0;
    if (li + 2 < n) {
      // re-dissolve as the line-after-next approaches; never dissolve mid-read
      outDur = +Math.max(0.35, 0.5 - 0.05 * li).toFixed(2);
      outT = +Math.max(
        L.words[L.words.length - 1].start + 0.25,
        LINES[li + 2].words[0].start - outDur - 0.05,
      ).toFixed(3);
    }
    return {
      id: "ik" + L.id,
      in: +L.in.toFixed(3),
      y: H - bottomPx - (2 - slot) * rowGap,
      outT,
      outDur,
      words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
    };
  });
  const INK = dna.palette.body;
  const PAP = dna.palette.paper || "#fffaee",
    PAP2 = dna.palette.paper2 || "#fff8e8";
  const css = `
  .irow { position:absolute; left:${W / 2}px; opacity:0; white-space:nowrap;
          font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 400};
          font-size:${b.fontPx}px; line-height:1.25; letter-spacing:${b.letterSpacing || "0.055em"};
          color:${INK}; }
  .irow .w { display:inline-block; position:relative; margin-right:0.34em; }
  .irow .w:last-child { margin-right:0; }
  .irow .ink { position:relative; display:inline-block; opacity:0;
          text-shadow: 0 0 5px ${PAP}, 0 0 14px ${PAP}f2, 0 0 30px ${PAP2}d9, 0 1px 2px ${PAP}e6; }
  .irow .halo { position:absolute; left:0; top:0; opacity:0; color:${INK}; filter:blur(9px); }
  .irule { position:absolute; left:50%; bottom:-7px; width:86%; height:2px;
           margin-left:-43%; opacity:0; transform-origin:50% 50%;
           background: linear-gradient(90deg, ${INK}00 0%, ${INK}8c 18%, ${INK}8c 82%, ${INK}00 100%);
           box-shadow: 0 1px 7px ${PAP}8c; filter: blur(0.8px); }
  .iwisp { position:absolute; left:50%; top:-16px; width:22px; height:28px;
           margin-left:-11px; opacity:0; border:3px solid transparent;
           border-top-color:${INK}8c; border-radius:50%; filter:blur(2px); }`;
  const html = lineData
    .map((L) => `      <div class="irow" id="${L.id}" style="top:${L.y}px"></div>`)
    .join("\n");
  const js = `
  // ---- body paradigm: INKRAIL (ink bleed-in / re-dissolve exits) ----
  const RAILI = ${J(lineData)};
  const IKLATE = ${(DUR - 0.84).toFixed(3)}; // late words bleed faster (resolve before clip end)
  RAILI.forEach((L, li) => {
    const line = document.getElementById(L.id);
    const rule = document.createElement("div"); rule.className = "irule"; line.appendChild(rule);
    L.words.forEach(([txt]) => {
      const w = document.createElement("span"); w.className = "w";
      const halo = document.createElement("span"); halo.className = "halo"; halo.textContent = txt;
      const ink = document.createElement("span"); ink.className = "ink"; ink.textContent = txt;
      w.appendChild(halo); w.appendChild(ink); line.appendChild(w);
    });
    gsap.set(line, { xPercent: -50, yPercent: -50 });
    tl.set(line, { opacity: 1 }, L.in);
    L.words.forEach(([txt, st, em], wi) => {
      const w = line.children[wi + 1]; // children[0] is the rule
      const halo = w.children[0], ink = w.children[1];
      // BLEED IN: opacity snaps (2 frames); blur 12→0 + scale 1.25→1 carry the
      // bleed (late words bleed faster so they fully resolve before clip end)
      const late = st > IKLATE;
      tl.fromTo(ink, { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, st);
      tl.fromTo(ink, { filter: "blur(12px)", scale: 1.25 },
                { filter: "blur(0px)", scale: 1, duration: late ? 0.4 : 0.6, ease: "power2.out",
                  transformOrigin: "50% 60%" }, st);
      // the dark halo overshoots then tightens (the bloom motif, low amplitude)
      tl.fromTo(halo, { opacity: em ? 0.55 : 0.5, scale: 1.5 },
                { scale: 1.04, opacity: em ? 0.3 : 0.25, duration: late ? 0.5 : 0.7,
                  ease: "power2.out", transformOrigin: "50% 60%" }, st);
      // emphasis: a faint ink wisp curls off the word top (skipped near clip end)
      if (em && st + 1.55 <= ${(DUR - 0.03).toFixed(3)}) {
        const wsp = document.createElement("div"); wsp.className = "iwisp"; w.appendChild(wsp);
        const dir = li % 2 === 0 ? 1 : -1;
        tl.set(wsp, { opacity: 0.5, transformOrigin: "50% 50%" }, st + 0.55);
        tl.fromTo(wsp, { y: 0, x: 0, rotation: 12 * dir, scaleY: 1 },
                  { y: -38, x: 10 * dir, rotation: 92 * dir, scaleY: 1.55,
                    duration: 1.0, ease: "power1.out" }, st + 0.55);
        tl.to(wsp, { opacity: 0, duration: 0.42, ease: "power1.in" }, st + 1.12);
      }
    });
    // ink-settling rule beneath the line
    tl.set(rule, { opacity: 0.55 }, L.words[0][1] + 0.12);
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power2.out" },
              L.words[0][1] + 0.12);
    // EXIT: re-dissolve — blur up + spread + fade + slight rise, ink dispersing
    // (the closing lines persist — the final thought stays readable)
    if (L.outT !== null) {
      tl.to(line, { filter: "blur(9px)", scale: 1.13, opacity: 0, y: -8,
                    duration: L.outDur, ease: "power1.in", transformOrigin: "50% 50%" }, L.outT);
      tl.set(line, { display: "none" }, L.outT + L.outDur + 0.02);
    }
  });
${
  b.yield && !heroInline
    ? `
  // rows visible under the bloom yield while the drop blooms, restore after.
  // Overlap guards: dim only after the line is IN with runway before its exit;
  // restore only with clear runway (else the line exits dimmed — one owner).
  RAILI.forEach((L) => {
    const dimT = ${(heroIn + (b.yield.delay ?? 0.12)).toFixed(3)};
    if (L.in < dimT - 0.05 && (L.outT === null || L.outT > dimT + 0.35)) {
      tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.3, ease: "power1.out" }, dimT);
      const resT = ${(heroIn + (b.yield.post ?? 1.07)).toFixed(3)};
      if (L.outT === null || resT + 0.33 < L.outT)
        tl.to("#" + L.id, { opacity: 1, duration: 0.3, ease: "power1.out" }, resT);
    }
  });`
    : ""
}`;
  return { css, html, js };
}

// ---- ransom shared pieces: the cutout-chip recipes and the seeded paper-tear
// polygon are ONE paper stock used by both layers (ransomrail body chips in the
// fg, ransomnote letter chips in the bg) — emitted into each page separately
function ransomChipCss(ls) {
  const p = dna.palette;
  return `
  .ca { background:${p.paper || "#f5f1e4"}; color:${p.paperInk || "#17130d"}; font-family:'${dna.fonts.body}', sans-serif; letter-spacing:${ls}; }
  .cb { background:${p.dark || "#141414"}; color:${p.darkInk || "#f7f5ef"}; font-family:'${dna.fonts.dark}', sans-serif; font-weight:800; }
  .cc { background:${p.news || "#d8d3c5"}; color:${p.newsInk || "#262017"}; font-family:'${dna.fonts.news}', monospace; }
  .cd { background:${p.accent || "#ffd23f"}; color:${p.accentInk || "#1c160c"}; font-family:'${dna.fonts.accent}', cursive; }`;
}
// seeded 12-vertex tear polygon — j() call order matches the demo exactly so
// identical seeds reproduce the demo's torn edges
const RANSOM_TEAR = `function tearPoly(r){
    const j = () => +(r()*5).toFixed(1);
    const p = [[j(),j()],[33,j()],[66,j()],[100-j(),j()],[100-j(),33],[100-j(),66],
               [100-j(),100-j()],[66,100-j()],[33,100-j()],[j(),100-j()],[j(),66],[j(),33]];
    return "polygon(" + p.map(q => q[0] + "% " + q[1] + "%").join(",") + ")";
  }`;

function paradigmRansomrail() {
  // RANSOMRAIL: kidnapper's collage — every transcript word is a cutout chip
  // in one of 4 cycled recipes (paper/Anton, black/Inter-800, newsprint/
  // Special Elite, accent/Permanent Marker; emphasis words snap to the accent
  // chip) PASTED along the bottom rail line with seeded crookedness, seeded
  // ±px sizes and misaligned baselines — the paste is the apex slam motif at
  // low amplitude (1f appear at scale 1.12 → power3.in crush → 2-frame contact
  // squash → elastic settle). Emphasis = 1-frame RE-PASTE lift (shadow grows,
  // rotation flips sign for good); exits = chips RIPPED off one by one with
  // 1-frame paper-tear flashes under each; lines breathe through their hold;
  // the whole railwrap yields while the apex letters slam behind the subject.
  const b = dna.body;
  const last = LINES.length - 1;
  const lineData = LINES.map((L, li) => {
    const n = L.words.length;
    const stag = li === last ? 0.04 : 0.045;
    const ripDur = li === last ? 0.12 : 0.14;
    const lastSt = L.words[n - 1].start;
    // rip cadence (demo): chips tear off just before the next line pastes —
    // the rip tail overlaps the new line a beat (collage chaos, by design);
    // a line whose last word just spoke waits lastWord+0.14 first
    let ripStart =
      li === last
        ? Math.min(L.out - 0.04, DUR - 0.06 - ripDur - stag * (n - 1))
        : Math.max(lastSt + 0.14, LINES[li + 1].in - ripDur - stag * (n - 1) + 0.05);
    ripStart = +Math.min(ripStart, DUR - 0.06 - ripDur - stag * (n - 1)).toFixed(3);
    const words = L.words.map((w, wi) => {
      const st = +w.start.toFixed(3);
      const R = +Math.max(ripStart + stag * wi, st + 0.12).toFixed(3);
      // re-paste lift: needs its own window before the chip's rip
      let emphT = w.minor ? +Math.min(st + (b.emphDelay ?? 0.23), R - 0.27).toFixed(3) : 0;
      if (emphT && emphT < st + 0.08) emphT = 0;
      return [w.display, st, emphT, R, w.minor ? 1 : 0];
    });
    // hold life: gentle collage breathe on the whole line (demo cadence)
    const bs = +(L.words[0].start + 0.08).toFixed(3);
    const bd = +Math.min(1.8, ripStart - 0.03 - bs).toFixed(2);
    return { id: "rr" + L.id, in: +L.in.toFixed(3), ripDur, words, bs, bd: bd >= 0.3 ? bd : 0 };
  });
  const css = `
  #rrailwrap { position:absolute; inset:0; }
  .rline { position:absolute; left:${W / 2}px; top:${H - b.bottomPx}px; white-space:nowrap; }
  .rline .w  { display:inline-block; position:relative; margin:0 5px; }
  .rflash { position:absolute; inset:-4px; background:${dna.palette.flash || "#fffdf2"}; opacity:0; z-index:0; }
  .rmove { display:inline-block; position:relative; z-index:1; opacity:0;
           filter: drop-shadow(0 5px 0 rgba(8,6,4,0.5)); }
  .rchip { display:inline-block; line-height:1.05; padding:0.08em 0.16em 0.11em;
           text-transform:${b.textTransform || "uppercase"}; }
${ransomChipCss(b.letterSpacing || "0.02em")}`;
  const html = `      <div id="rrailwrap">
${lineData.map((L) => `        <div class="rline" id="${L.id}"></div>`).join("\n")}
      </div>`;
  const js = `
  // ---- body paradigm: RANSOMRAIL (chips pasted crooked / ripped off with tear flashes) ----
  const RAILR = ${J(lineData)};
  const crnd = mulberry32(${b.seed || 3940});
  ${RANSOM_TEAR}
  const HARDR = "drop-shadow(0 5px 0 rgba(8,6,4,0.5))";
  const LIFTR = "drop-shadow(0 14px 3px rgba(8,6,4,0.35))";
  const RECS = ["ca", "cb", "cc", "cd"];
  let recC = 0, recPrev = -1;          // recipe cycle: emphasis snaps to the accent chip,
  function nextRec(em) {               // never two identical chips in a row
    let rec = em ? 3 : recC % 4;
    if (rec === recPrev) { recC++; rec = recC % 4; }
    if (!em) recC++;
    recPrev = rec;
    return rec;
  }
  RAILR.forEach((L, li) => {
    const line = document.getElementById(L.id);
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    L.words.forEach(([txt, st, emphT, R, em], wi) => {
      const w = document.createElement("div"); w.className = "w";
      const fl = document.createElement("div"); fl.className = "rflash";
      fl.style.clipPath = tearPoly(crnd);
      const mv = document.createElement("div"); mv.className = "rmove";
      const chip = document.createElement("div"); chip.className = "rchip " + RECS[nextRec(em)];
      chip.style.fontSize = (${b.fontPx} - 2 + Math.round(crnd() * 3) + (em ? 3 : 0)) + "px";
      chip.style.clipPath = tearPoly(crnd);
      chip.textContent = txt;
      mv.appendChild(chip); w.appendChild(fl); w.appendChild(mv); line.appendChild(w);
      // seeded crookedness: rot sign alternates with line+word parity (demo),
      // baseline shove dy leans the other way
      const sgn = (li + wi) % 2 === 0 ? -1 : 1;
      const rot = sgn * (2 + crnd() * 2.5);
      const dy = -sgn * (1 + crnd() * 2);
      // PASTE = apex slam motif at low amplitude
      tl.set(mv, { opacity: 1, scale: 1.12, rotation: rot * 1.5, y: dy - 8 }, st);
      tl.to(mv,  { scale: 1, rotation: rot, y: dy, duration: 0.08, ease: "power3.in" }, st + 0.005);
      tl.set(mv, { scaleX: 1.05, scaleY: 0.95 }, st + 0.09);
      tl.to(mv,  { scaleX: 1, scaleY: 1, duration: 0.22, ease: "elastic.out(1, 0.4)" }, st + 0.173);
      // EMPHASIS = re-paste: 1-frame lift (shadow grows), rotation flips sign for good
      if (emphT) {
        tl.set(mv, { y: dy - 7, scale: 1.08, rotation: -rot, filter: LIFTR }, emphT);
        tl.to(mv,  { y: dy, scale: 1, duration: 0.09, ease: "power3.in" }, emphT + 0.083);
        tl.set(mv, { filter: HARDR }, emphT + 0.175);
        tl.set(mv, { scaleX: 1.04, scaleY: 0.96 }, emphT + 0.178);
        tl.to(mv,  { scaleX: 1, scaleY: 1, duration: 0.16, ease: "elastic.out(1, 0.4)" }, emphT + 0.262);
      }
      // EXIT = ripped off, paper-tear flash 1 frame under the chip
      tl.set(fl, { opacity: 0.85 }, R);
      tl.set(fl, { opacity: 0 }, R + 0.045);
      tl.to(mv,  { rotation: rot + (wi % 2 ? 16 : -17), y: dy - 30, opacity: 0,
                   duration: L.ripDur, ease: "power2.in" }, R);
    });
    if (L.bd) tl.to(line, { keyframes: { scale: [1, 1.015, 1.005, 1.016, 1] },
                            duration: L.bd, ease: "none" }, L.bs);
  });
${
  b.yield && !heroInline
    ? `  // rail yields while the apex letters slam behind the subject (container
  // opacity — never contests the per-chip channels)
  tl.to("#rrailwrap", { opacity: ${b.yield.dim}, duration: 0.12 }, ${Math.max(0.05, heroIn - (b.yield.pre ?? 0.02)).toFixed(3)});
${
  heroIn + (b.yield.post ?? 0.71) < DUR - 0.3
    ? `  tl.to("#rrailwrap", { opacity: 1, duration: 0.2 }, ${(heroIn + (b.yield.post ?? 0.71)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css, html, js };
}

function paradigmChyronrail() {
  // CHYRONRAIL: live-news lower-third package. Body words ride a navy chyron and
  // reveal by broadcast wipe (clip-path L→R + a 2px slam-kick = the apex motif at
  // low amplitude); emphasis words flash an accent highlight + pop; lines exit by
  // R→L wipe before the next reads. SIGNATURE furniture: a never-stopping ticker
  // (one long seeded head string, constant-speed linear tween that DOUBLES speed
  // at the takeover), a red bar tab, a pulsing LIVE bug + a ticking timestamp bug.
  // The takeover yield, the banner and the apex strobe live in the setpiece; here
  // the rail only DIMS while the apex lands (b.yield).
  const b = dna.body;
  const barH = b.barH || 68;
  const tkH = b.ticker && b.ticker.h ? b.ticker.h : 32;
  const tkTop = H - tkH; // ticker hugs the very bottom; chyron sits ON it
  const chyTop = tkTop - barH; // chyron stacks above the ticker
  const tabW = (b.tab && b.tab.w) || 172;
  const tk = b.ticker || {};
  const head =
    tk.head ||
    "ROOFTOP OBSERVATORY REPORTS CLEAREST SKIES OF THE SEASON +++ " +
      "CITY TELESCOPE ARRAY ENTERS FINAL CALIBRATION PHASE +++ SENSOR TEAM " +
      "CLAIMS RECORD SIGNAL RECOVERY FROM NOISE FLOOR +++ ENGINEERS SAY PIXEL " +
      "LIMITS NO LONGER THE CEILING +++ MORE AT THE TOP OF THE HOUR +++ ";
  const V1 = tk.v1 || 180,
    V2 = tk.v2 || 360; // px/s; takeover doubles it
  const SW = +heroIn.toFixed(3) > 0 ? +heroIn.toFixed(3) : DUR * 0.6; // speed-up at apex
  const END = +(DUR - 0.01).toFixed(3);
  const lineData = LINES.map((L) => ({
    id: "cy" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display.toUpperCase(), +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const hdr = b.header || {};
  const tsPrefix = hdr.clockPrefix || "19:41:5"; // last digit ticks 5→8
  const css = `
  #cyglow { position:absolute; left:0; top:${tkTop - 2}px; width:${W}px; height:2px;
            background:${dna.palette.hot || dna.palette.accent}; opacity:0; }
  #cyticker { position:absolute; left:0; top:${tkTop}px; width:${W}px; height:${tkH}px;
              background:rgba(6,14,26,0.93); overflow:hidden; }
  #cytick { position:absolute; left:0; top:0; white-space:nowrap;
            font-family:'${dna.fonts.tag}', monospace; font-size:${Math.round(tkH * 0.69)}px;
            line-height:${tkH}px; color:${dna.palette.tick || "#cfe0f2"}; letter-spacing:1px; }
  #cytlabel { position:absolute; left:0; top:0; width:112px; height:${tkH}px;
              background:${dna.palette.accent}; color:#fff; text-align:center;
              font-family:'${dna.fonts.body}', sans-serif; font-weight:700;
              font-size:17px; line-height:${tkH}px; letter-spacing:3px; }
  #cychy { position:absolute; left:0; top:${chyTop}px; width:${W}px; height:${barH}px;
           background:${dna.palette.bar || "rgba(17,35,63,0.94)"};
           box-shadow:0 4px 18px rgba(0,0,0,0.35); }
  #cytab { position:absolute; left:0; top:0; width:${tabW}px; height:${barH}px;
           background:${dna.palette.accent}; color:#fff; text-align:center;
           font-family:'${dna.fonts.body}', sans-serif; font-weight:700;
           font-size:28px; line-height:${barH}px; letter-spacing:2px; }
  .cyln { position:absolute; left:${tabW + 30}px; top:${Math.round((barH - b.fontPx) / 2 - 8)}px;
          white-space:nowrap; font-family:'${dna.fonts.body}', sans-serif; font-weight:700;
          font-size:${b.fontPx}px; line-height:${b.fontPx + 2}px; color:${dna.palette.body};
          letter-spacing:${b.letterSpacing || "0.01em"}; }
  .cyln .w { display:inline-block; margin-right:0.32em; clip-path: inset(0% 100% 0% 0%); }
  .cybug { position:absolute; top:34px; height:40px; border-radius:4px;
           background:rgba(8,16,30,0.62); opacity:0; }
  #cylive { left:36px; width:118px; }
  #cyldot { position:absolute; left:16px; top:14px; width:12px; height:12px;
            border-radius:50%; background:${dna.palette.hot || "#ff2e36"}; }
  #cyltxt { position:absolute; left:38px; top:0; line-height:40px; color:#fff;
            font-family:'${dna.fonts.body}', sans-serif; font-weight:700;
            font-size:21px; letter-spacing:3px; }
  #cyts { right:36px; width:158px; text-align:center; }
  .cytss { display:none; line-height:40px; color:${dna.palette.tick || "#cfe0f2"};
           font-family:'${dna.fonts.tag}', monospace; font-size:27px; letter-spacing:1px; }`;
  const html = `      <div id="cyglow"></div>
      <div id="cyticker"><div id="cytick"></div><div id="cytlabel">${esc(tk.label || "LATEST")}</div></div>
      <div id="cychy">
        <div id="cytab">${esc((b.tab && b.tab.text) || "NEWS")}</div>
${lineData.map((L) => `        <div class="cyln" id="${L.id}"></div>`).join("\n")}
      </div>
      <div class="cybug" id="cylive"><div id="cyldot"></div><div id="cyltxt">LIVE</div></div>
      <div class="cybug" id="cyts">
        <div class="cytss" style="display:block">${tsPrefix}5</div>
        <div class="cytss">${tsPrefix}6</div>
        <div class="cytss">${tsPrefix}7</div>
        <div class="cytss">${tsPrefix}8</div>
      </div>`;
  const js = `
  // ---- body paradigm: CHYRONRAIL (live-news chyron + never-stop ticker + bugs) ----
  const EM = ${J(dna.palette.em || dna.palette.hot || dna.palette.accent)};
  // SIGNATURE: the never-stopping ticker (one long string, constant speed, the
  // takeover doubles it)
  const HEAD = ${J(head)};
  document.getElementById("cytick").textContent = HEAD + HEAD;
  { const SW = ${SW.toFixed(3)}, V1 = ${V1}, V2 = ${V2}, END = ${END};
    const D1 = V1 * SW, D2 = D1 + V2 * (END - SW);
    tl.fromTo("#cytick", { x: 0 }, { x: -D1, duration: SW, ease: "none" }, 0);
    tl.to("#cytick", { x: -D2, duration: END - SW, ease: "none" }, SW); }
  // chyron + bugs boot (apex motif, low amplitude)
  gsap.set("#cychy", { transformOrigin: "50% 100%", scaleY: 0 });
  tl.to("#cychy", { scaleY: 1.03, duration: 0.10, ease: "power3.in" }, 0.05);
  tl.to("#cychy", { scaleY: 1, duration: 0.18, ease: "power2.out" }, 0.15);
  tl.set("#cylive", { opacity: 1, scale: 0.92, transformOrigin: "50% 50%" }, 0.10);
  tl.to("#cylive", { scale: 1, duration: 0.16, ease: "back.out(2)" }, 0.11);
  tl.set("#cyts", { opacity: 1, scale: 0.92, transformOrigin: "50% 50%" }, 0.16);
  tl.to("#cyts", { scale: 1, duration: 0.16, ease: "back.out(2)" }, 0.17);
  // red LIVE dot pulses every 0.5s for the whole clip (seek-safe set-chain)
  { const nP = Math.floor(${END} / 0.5);
    for (let k = 0; k <= nP; k++) tl.set("#cyldot", { opacity: k % 2 ? 0.25 : 1 }, k * 0.5); }
  // timestamp seconds tick (stacked spans, display toggles)
  const cytss = document.querySelectorAll(".cytss");
  [[1.0,0,1],[2.0,1,2],[3.0,2,3]].forEach(([t,a,b]) => {
    if (t < ${END}) { tl.set(cytss[a], { display: "none" }, t); tl.set(cytss[b], { display: "block" }, t); }
  });
  // ---- body: broadcast-wipe chyron lines ----
  const CRAIL = ${J(lineData)};
  CRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt]) => {
      const s = document.createElement("span"); s.className = "w"; s.textContent = txt;
      line.appendChild(s);
    });
    L.words.forEach(([txt, st, em], wi) => {
      const el = line.children[wi];
      tl.fromTo(el, { clipPath: "inset(0% 100% 0% 0%)" },
                    { clipPath: "inset(0% 0% 0% 0%)", duration: 0.12, ease: "power1.out" }, st);
      // mini slam-kick = the apex motif at low amplitude
      tl.set(line, { y: 2 }, st);
      tl.to(line, { y: 0, duration: 0.06, ease: "power2.out" }, st + 0.012);
      if (em) { // EMPHASIS: accent highlight + pop
        tl.set(el, { color: EM, scale: 1.14, transformOrigin: "50% 70%" }, st + 0.13);
        tl.to(el, { scale: 1, duration: 0.18, ease: "back.out(1.8)" }, st + 0.14);
      }
    });
    // hold life: a low breathe between the last word and the exit wipe
    const lastIn = L.words[L.words.length - 1][1] + 0.4;
    if (L.out - 0.12 - lastIn > 0.3)
      tl.to(line, { scale: 1.012, duration: L.out - 0.12 - lastIn, ease: "sine.inOut",
                    transformOrigin: "0% 50%" }, lastIn);
    // EXIT: line wipes out R→L, then hides
    tl.fromTo(line, { clipPath: "inset(0% 0% 0% 0%)" },
                    { clipPath: "inset(0% 100% 0% 0%)", duration: 0.10, ease: "power2.in" }, L.out);
    tl.set(line, { opacity: 0 }, L.out + 0.11);
  });
${
  b.yield && !heroInline
    ? `  // rail yields while the apex banner slams down
  tl.to("#cychy", { opacity: ${b.yield.dim}, duration: 0.10 }, ${(heroIn - (b.yield.pre ?? 0.06)).toFixed(3)});
  tl.to("#cyticker", { opacity: ${Math.min(1, (b.yield.dim || 0.55) + 0.1).toFixed(2)}, duration: 0.10 }, ${(heroIn - (b.yield.pre ?? 0.06)).toFixed(3)});
${
  heroIn + (b.yield.post ?? 0.46) < DUR - 0.2
    ? `  tl.to("#cychy", { opacity: 1, duration: 0.20 }, ${(heroIn + (b.yield.post ?? 0.46)).toFixed(3)});
  tl.to("#cyticker", { opacity: 1, duration: 0.20 }, ${(heroIn + (b.yield.post ?? 0.46)).toFixed(3)});`
    : ""
}`
    : ""
}`;
  return { css, html, js };
}

function paradigmColumnmag() {
  // COLUMN MAGAZINE: the transcript lives as a small magazine column docked in a
  // clear lower corner — folio numbers swap per line, top/bottom hairline rules,
  // a barcode bug, a radial paper-scrim behind the type. Words INK-SETTLE in
  // (opacity snaps in 2f, blur+y carry the motion — the masthead verb at body
  // amplitude); the emphasis word flips to italic with an underline grow.
  // Lines exit on a PAGE-TURN: a diagonal shadow sweeps and the old line slips
  // out under it. A soft page-light pass keeps the silence alive; the column
  // breathes; the whole block yields while the masthead lands.
  const b = dna.body;
  const P = dna.palette;
  const col = b.col || {};
  const colLeft = col.left ?? 48,
    colTop = col.top ?? 508,
    colW = col.width ?? 500;
  const dockRight = CLEARER === "right";
  const dockCss = dockRight ? `right:${colLeft}px;` : `left:${colLeft}px;`;
  const bcDockCss = dockRight ? `right:${colLeft}px;` : `left:${colLeft}px;`;
  const ink = P.ink || P.body;
  const ruleC = P.rule || "rgba(246,242,234,0.82)";
  const paper = P.paper || "#f6f2ea";
  const accent = P.accent || "#e25a50";
  const lineData = LINES.map((L) => ({
    id: "cm" + L.id,
    folio: L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    inT: +L.words[0].start.toFixed(3),
    last: L.id === LINES.length - 1,
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const folios = lineData
    .map(
      (L) =>
        `        <div class="folio" id="f${L.folio}">&mdash;&nbsp;&nbsp;${String(L.folio + 1).padStart(2, "0")}&nbsp;&nbsp;&mdash;</div>`,
    )
    .join("\n");
  const css = `
  #colwrap { position:absolute; ${dockCss} top:${colTop}px; width:${colW}px; height:120px; }
  #colbg { position:absolute; left:-70px; top:-46px; width:${colW + 160}px; height:230px; opacity:0;
           background: radial-gradient(58% 62% at 42% 50%, rgba(12,10,9,${col.scrim ?? 0.62}) 0%, rgba(12,10,9,0) 72%); }
  #col { position:absolute; inset:0; }
  #foliobox { position:absolute; left:0; top:0; width:100%; height:18px; text-align:center; }
  .folio { position:absolute; left:0; top:0; width:100%; opacity:0;
           font-family:'${dna.fonts.tag || "Space Grotesk"}', sans-serif; font-weight:700; font-size:12px;
           letter-spacing:5px; color:${accent};
           text-shadow: 0 1px 2px rgba(20,16,12,0.75), 0 0 8px rgba(0,0,0,0.4); }
  .cmrule { position:absolute; left:0; width:${colW - 30}px; height:1.5px; opacity:0;
            background:${ruleC}; box-shadow: 0 1px 2px rgba(20,16,12,0.45); }
  #ruleTop { top:28px; }
  #ruleBot { top:100px; }
  #cmlines { position:absolute; left:0; top:42px; width:${colW}px; height:50px; }
  .cmline { position:absolute; left:0; top:0; white-space:nowrap;
            font-family:'${dna.fonts.body}', serif; font-weight:${b.fontWeight || 700}; font-size:${b.fontPx}px;
            font-variant: small-caps; letter-spacing:${b.letterSpacing || "0.02em"}; line-height:${Math.round(b.fontPx * 1.4)}px;
            color:${P.body};
            text-shadow: 0 1px 2px rgba(20,16,12,0.6), 0 6px 18px rgba(0,0,0,0.4); }
  .cmw { display:inline-block; position:relative; margin-right:0.30em; opacity:0; }
  .cmul { position:absolute; left:0; right:0; bottom:2px; height:1.5px;
          background:${ruleC}; transform: scaleX(0);
          box-shadow: 0 1px 2px rgba(20,16,12,0.45); }
  #cmsweep { position:absolute; left:-80px; top:-50px; width:${colW + 180}px; height:240px; opacity:0;
             background: linear-gradient(105deg, rgba(10,8,7,0) 32%, rgba(10,8,7,0.5) 50%, rgba(10,8,7,0) 68%); }
  #cmshine { position:absolute; left:-80px; top:-50px; width:${colW + 180}px; height:240px; opacity:0;
             background: linear-gradient(105deg, rgba(255,250,240,0) 38%, rgba(255,250,240,0.7) 50%, rgba(255,250,240,0) 62%); }
  #barcode { position:absolute; ${bcDockCss} top:${colTop + 132}px; width:64px; height:36px; opacity:0;
             background:${paper}; border-radius:1px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  #barcode .bars { position:absolute; left:5px; top:4px; right:5px; height:21px;
                   background: repeating-linear-gradient(90deg,
                     ${ink} 0 2px, ${paper} 2px 4px, ${ink} 4px 5px, ${paper} 5px 9px,
                     ${ink} 9px 12px, ${paper} 12px 14px); }
  #barcode .num { position:absolute; left:0; right:0; bottom:2px; text-align:center;
                  font-family:'${dna.fonts.tag || "Space Grotesk"}', sans-serif; font-size:8px; letter-spacing:2px;
                  color:${ink}; }`;
  const html = `      <div id="colwrap">
        <div id="colbg"></div>
        <div id="col">
          <div id="foliobox">
${folios}
          </div>
          <div class="cmrule" id="ruleTop"></div>
          <div id="cmlines"></div>
          <div class="cmrule" id="ruleBot"></div>
        </div>
        <div id="cmshine"></div>
        <div id="cmsweep"></div>
      </div>
      <div id="barcode"><div class="bars"></div><div class="num">${esc(b.barcodeNum || "06 26")}</div></div>`;
  // silence-pass + breathe windows derived from line timing (fall in the gap
  // between the line whose .out opens the gap and the next line's onset)
  const gap = lineData
    .map((L, i) => (i + 1 < lineData.length ? lineData[i + 1].inT - L.out : 0))
    .reduce((a, g, i) => (g > a.g ? { g, t: lineData[i].out } : a), { g: 0, t: 0 });
  const shineT = gap.g > 0.6 ? +(gap.t + 0.2).toFixed(3) : -1;
  const breatheStart = +(lineData[0].in + 0.4).toFixed(3);
  const css2 = css;
  const yieldDim = (b.yield && b.yield.dim) || 0.55;
  const yieldPre = (b.yield && b.yield.pre) || 0.2;
  const yieldPost = (b.yield && b.yield.post) || 0.9;
  const js = `
  // ---- body paradigm: COLUMN MAGAZINE (ink-settle words / page-turn exits) ----
  const CM = ${J(lineData)};
  const RULEC = ${J(ruleC)};
  const cmBox = document.getElementById("cmlines");
  gsap.set("#ruleTop", { transformOrigin: "0% 50%" });
  gsap.set("#ruleBot", { transformOrigin: "0% 50%" });
  tl.fromTo("#colbg", { opacity: 0 }, { opacity: ${col.bgOpacity ?? 0.52}, duration: 0.45, ease: "power2.out" }, 0.12);
  tl.set("#ruleTop", { opacity: 1 }, 0.16);
  tl.fromTo("#ruleTop", { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0.16);
  tl.set("#ruleBot", { opacity: 1 }, 0.22);
  tl.fromTo("#ruleBot", { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0.22);
  tl.fromTo("#barcode", { opacity: 0, y: 6 }, { opacity: 0.85, y: 0, duration: 0.3, ease: "power2.out" }, 0.34);
  function cmFolioIn(idx, t) {
    tl.fromTo("#f" + idx, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }, t);
  }
  function cmFolioOut(idx, t) {
    tl.to("#f" + idx, { opacity: 0, duration: 0.12, ease: "power1.in" }, t);
  }
  cmFolioIn(CM[0].folio, ${(lineData[0].inT - 0.02).toFixed(3)});
  CM.forEach((L, li) => {
    const line = document.createElement("div");
    line.className = "cmline";
    cmBox.appendChild(line);
    L.words.forEach(([txt, t, em]) => {
      const w = document.createElement("span");
      w.className = "cmw";
      w.textContent = txt;
      const ul = document.createElement("div");
      ul.className = "cmul";
      w.appendChild(ul);
      line.appendChild(w);
      gsap.set(ul, { transformOrigin: "0% 50%" });
      // ink-settle: opacity snaps (2 frames), blur+y carry the motion
      tl.fromTo(w, { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, t);
      tl.fromTo(w, { y: 6, filter: "blur(2px)" },
                { y: 0, filter: "blur(0px)", duration: 0.32, ease: "power2.out" }, t);
      if (em) {
        tl.set(w, { fontStyle: "italic" }, t + 0.14);                // swash flip
        tl.to(ul, { scaleX: 1, duration: 0.26, ease: "power2.out" }, t + 0.14);
      }
    });
    if (li > 0) cmFolioIn(L.folio, L.inT - 0.02);
    if (!L.last) {
      // page-turn: diagonal shadow sweeps, old line slips out under it
      tl.set("#cmsweep", { opacity: 1, x: -540 }, L.out);
      tl.to("#cmsweep", { x: 540, duration: 0.32, ease: "power2.inOut" }, L.out);
      tl.set("#cmsweep", { opacity: 0 }, L.out + 0.33);
      tl.to(line, { x: -16, opacity: 0, filter: "blur(1.5px)", rotation: -0.6,
                    duration: 0.22, ease: "power2.in" }, L.out + 0.04);
      cmFolioOut(L.folio, L.out + 0.04);
    }
  });
${
  shineT > 0
    ? `  // silence beat: a soft page-light pass keeps it alive
  tl.set("#cmshine", { opacity: 0.12, x: -540 }, ${shineT});
  tl.to("#cmshine", { x: 540, duration: 0.72, ease: "sine.inOut" }, ${shineT});
  tl.set("#cmshine", { opacity: 0 }, ${(shineT + 0.73).toFixed(3)});
  tl.to("#ruleTop", { opacity: 0.68, duration: 0.55, ease: "sine.inOut" }, ${(shineT - 0.03).toFixed(3)});
  tl.to("#ruleTop", { opacity: 1.0,  duration: 0.55, ease: "sine.inOut" }, ${(shineT + 0.57).toFixed(3)});`
    : ""
}
  // hold life: the column breathes very slowly
  gsap.set("#col", { transformOrigin: "10% 50%" });
  tl.to("#col", { scale: 1.006, duration: 1.4, ease: "sine.inOut" }, ${breatheStart});
  tl.to("#col", { scale: 1.0,   duration: 1.4, ease: "sine.inOut" }, ${(breatheStart + 1.4).toFixed(3)});
  tl.to("#col", { scale: 1.006, duration: 1.4, ease: "sine.inOut" }, ${(breatheStart + 2.8).toFixed(3)});
  tl.to("#col", { scale: 1.0,   duration: 1.25, ease: "sine.inOut" }, ${(breatheStart + 4.2).toFixed(3)});
${
  hero && heroIn > 0 && heroIn + yieldPost < DUR - 0.2
    ? `  // apex yield: the column dims while the masthead lands, restores after
  tl.to("#colwrap", { opacity: ${yieldDim}, duration: 0.18, ease: "power2.in" }, ${(heroIn - yieldPre).toFixed(3)});
  tl.to("#colwrap", { opacity: 1.0,  duration: 0.30, ease: "power2.out" }, ${(heroIn + yieldPost).toFixed(3)});
  tl.to("#barcode", { opacity: 0.5,  duration: 0.18, ease: "power2.in" }, ${(heroIn - yieldPre).toFixed(3)});
  tl.to("#barcode", { opacity: 0.85, duration: 0.30, ease: "power2.out" }, ${(heroIn + yieldPost).toFixed(3)});`
    : ""
}`;
  return { css: css2, html, js };
}

function paradigmDraftrail() {
  // DRAFTRAIL: a technical-drawing lower-third. A faint drafting BAND (grid +
  // a bright top rule + a title block) docks across the bottom; transcript
  // lines live LEFT-ALIGNED on up to body.rows thin baseline RULES that draw
  // L->R before each line and retract after. Words WIPE IN along the line
  // (clipPath inset L->R, 0.18s) with a registration TICK at each word start —
  // the apex plotter motif at low amplitude. Lines alternate rows (so the
  // exiting line un-draws while the next draws on a fresh rule). Emphasis
  // words get a DIMENSION CALLOUT: a thin bracket + a tiny mono label drawn
  // above/below. Exits: words wipe back into the rule (reverse order) and the
  // callouts retract. The rail YIELDS while the apex plotter writes.
  const b = dna.body;
  const ROWTOPS = b.rows || [566, 624];
  const NR = ROWTOPS.length;
  const railLeft = b.left ?? 74;
  const railW = b.railW ?? 706;
  const BLUE = dna.palette.accent || "#9fc6ff";
  const BLUEDIM = dna.palette.ruleDim || BLUE;
  // assign each line to a row (round-robin) + resolve callouts from minors
  const lineData = LINES.map((L, i) => ({
    id: "dr" + L.id,
    row: i % NR,
    ruleId: "drRule" + (i % NR),
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => ({
      txt: w.display,
      st: +w.start.toFixed(3),
      minor: !!w.minor,
    })),
  }));
  // dimension labels cycle through body.dims (each emphasis word gets the next)
  const DIMS = b.dims || ["Ø 4.2″", "Ø 9 µm", "R 0.5", "12.4 mm"];
  const bandTop = b.bandTop ?? 560,
    bandH = H - bandTop;
  const css = `
  #drBand { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px; opacity:0;
            background:
              repeating-linear-gradient(0deg,  ${BLUE}16 0 1px, transparent 1px 36px),
              repeating-linear-gradient(90deg, ${BLUE}16 0 1px, transparent 1px 36px),
              linear-gradient(180deg, ${dna.palette.bandHi || "rgba(7,20,42,0.42)"} 0%,
                ${dna.palette.bandMid || "rgba(7,20,42,0.66)"} 30%, ${dna.palette.bandLo || "rgba(8,24,50,0.76)"} 100%); }
  #drBandrule { position:absolute; left:0; top:${bandTop - 1}px; width:${W}px; height:2px;
                background:${BLUE}; opacity:0.55; }
  #drTblock { position:absolute; left:${b.tblockX ?? W - 328}px; top:${bandTop + 28}px; width:288px; opacity:0.95;
              border:1px solid ${BLUE}73;
              font-family:'${dna.fonts.tag || "VT323"}', monospace; color:${BLUE}; letter-spacing:1px;
              background:${dna.palette.tblockBg || "rgba(8,24,50,0.35)"}; }
  #drTblock .tr { font-size:17px; line-height:1.45; padding:3px 10px 2px; white-space:nowrap; }
  #drTblock .tr + .tr { border-top:1px solid ${BLUE}4d; color:${dna.palette.tblockLo || "#7fa8d8"}; font-size:15px; }
  .drRow { position:absolute; left:${railLeft}px; width:${railW}px; height:56px; }
  .drRule { position:absolute; left:0; right:0; bottom:0; height:2px;
            background:${BLUEDIM}99; }
  .drWords { position:absolute; left:6px; bottom:4px; white-space:nowrap;
             font-family:'${dna.fonts.body}', sans-serif; font-weight:${b.fontWeight ?? 500}; font-size:${b.fontPx || 44}px;
             line-height:1; color:${dna.palette.body};
             text-shadow: ${b.glow || "0 2px 8px rgba(2,10,26,0.85), 0 0 14px " + BLUE + "40"}; }
  .drW { position:relative; display:inline-block; margin-right:0.30em; }
  .drWc { display:inline-block; }
  .drTick { position:absolute; left:-2px; bottom:-5px; width:2px; height:13px; background:${BLUE}; opacity:0; }
  .drCo { position:absolute; left:-2px; right:-2px; opacity:1; }
  .drCo .drBr { height:7px; border:1.5px solid ${BLUE}; opacity:0; }
  .drCo.up   { bottom:calc(100% + 4px); }
  .drCo.up .drBr   { border-bottom:none; }
  .drCo.down { top:calc(100% + 9px); }
  .drCo.down .drBr { border-top:none; }
  .drCo .drLab { position:absolute; left:0; right:0; text-align:center; opacity:0;
                 font-family:'${dna.fonts.tag || "VT323"}', monospace; font-size:18px; letter-spacing:1px;
                 color:${BLUE}; white-space:nowrap; text-shadow:0 1px 4px rgba(2,10,26,0.9); }
  .drCo.up .drLab   { bottom:calc(100% + 1px); }
  .drCo.down .drLab { top:calc(100% + 1px); }`;
  const rowsHtml = ROWTOPS.map(
    (top, r) =>
      `      <div class="drRow" id="drRow${r}" style="top:${top}px">
        <div class="drRule" id="drRule${r}"></div>
${lineData
  .filter((L) => L.row === r)
  .map((L) => `        <div class="drWords" id="${L.id}"></div>`)
  .join("\n")}
      </div>`,
  ).join("\n");
  const tblock = b.tblock || ["NIGHT SKY SURVEY — SHT 06", "DWG OBS-042 · SCALE 1:1 · REV A"];
  const html = `      <div id="drBand"></div>
      <div id="drBandrule"></div>
      <div id="drTblock">
${tblock.map((t) => `        <div class="tr">${esc(t)}</div>`).join("\n")}
      </div>
${rowsHtml}`;
  const js = `
  // ---- body paradigm: DRAFTRAIL (lines on baseline rules; words wipe in) ----
  const DR = ${J(lineData)};
  const DIMS = ${J(DIMS)};
  const DREND = ${(DUR - 0.1).toFixed(3)};

  // band + furniture enter (draw-on motif at low amplitude)
  gsap.set("#drBandrule", { scaleX: 0, transformOrigin: "0% 50%" });
  tl.to("#drBandrule", { scaleX: 1, duration: 0.35, ease: "power3.out" }, 0.04);
  tl.fromTo("#drBand", { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "power1.out" }, 0.08);
  gsap.set("#drTblock", { clipPath: "inset(0 100% 0 0)" });
  tl.to("#drTblock", { clipPath: "inset(0 0% 0 0)", duration: 0.28, ease: "power2.out" }, 0.30);

  // baseline rules: draw L->R before the first word on the row, retract after
  const drRuleUse = {};
  DR.forEach((L) => { (drRuleUse[L.ruleId] = drRuleUse[L.ruleId] || []).push([L.in, L.out]); });
  Object.entries(drRuleUse).forEach(([ruleId, uses]) => {
    gsap.set("#" + ruleId, { scaleX: 0, transformOrigin: "0% 50%" });
    uses.forEach(([rIn, rOut]) => {
      tl.to("#" + ruleId, { scaleX: 1, duration: 0.25, ease: "power3.out" }, rIn);
      tl.to("#" + ruleId, { scaleX: 0, duration: 0.10, ease: "power2.in" }, Math.min(rOut + 0.28, DREND + 0.02));
    });
  });

  let drDim = 0;
  DR.forEach((L) => {
    const g = document.getElementById(L.id);
    const els = L.words.map((w) => {
      const span = document.createElement("span"); span.className = "drW";
      const wc = document.createElement("span"); wc.className = "drWc"; wc.textContent = w.txt;
      const tick = document.createElement("span"); tick.className = "drTick";
      span.appendChild(wc); span.appendChild(tick); g.appendChild(span);
      let coEl = null, dir = null;
      if (w.minor) {
        dir = (drDim % 2 === 0) ? "up" : "down";
        coEl = document.createElement("span"); coEl.className = "drCo " + dir;
        const br = document.createElement("span"); br.className = "drBr"; br.style.display = "block";
        const lab = document.createElement("span"); lab.className = "drLab";
        lab.textContent = DIMS[drDim % DIMS.length];
        coEl.appendChild(br); coEl.appendChild(lab); span.appendChild(coEl);
        drDim++;
      }
      return { wc, tick, coEl };
    });

    // entrances: wipe along the line + tick at each word start
    L.words.forEach((w, i) => {
      const { wc, tick, coEl } = els[i];
      gsap.set(wc, { clipPath: "inset(-20% 100% -20% 0)" });
      tl.to(wc, { clipPath: "inset(-20% 0% -20% 0)", duration: 0.18, ease: "power2.out" }, w.st);
      tl.fromTo(tick, { scaleY: 0, opacity: 1 },
                { scaleY: 1, duration: 0.08, ease: "power2.out", transformOrigin: "50% 100%" }, w.st);
      tl.to(tick, { opacity: 0.45, duration: 0.2 }, w.st + 0.45);
      if (coEl) {
        const br = coEl.children[0], lab = coEl.children[1], at = w.st + 0.18;
        tl.set(br, { opacity: 0.95, scaleX: 0, transformOrigin: "0% 50%" }, at);
        tl.to(br, { scaleX: 1, duration: 0.15, ease: "power2.out" }, at);
        tl.fromTo(lab, { opacity: 0, y: coEl.className.indexOf("up") >= 0 ? 3 : -3 },
                  { opacity: 1, y: 0, duration: 0.14, ease: "power1.out" }, at + 0.06);
      }
    });

    // exit: line un-draws — words wipe back into the rule, reverse order
    const XO = L.out;
    els.slice().reverse().forEach(({ wc, tick, coEl }, k) => {
      const tt = Math.min(XO + k * 0.035, DREND);
      tl.to(wc, { clipPath: "inset(-20% 100% -20% 0)", duration: 0.12, ease: "power2.in" }, tt);
      tl.set(tick, { opacity: 0 }, tt + 0.10);
      if (coEl) {
        tl.to(coEl.children[1], { opacity: 0, duration: 0.08 }, tt);
        tl.to(coEl.children[0], { scaleX: 0, duration: 0.10, ease: "power2.in" }, tt + 0.02);
      }
    });
  });
${
  b.yield && hero && heroIn > 0
    ? `  // rail yields while the apex plotter writes (furniture never contests the hero)
  ["#drRow0","#drRow1","#drBandrule","#drTblock"].forEach((sel) => {
    if (!document.querySelector(sel)) return;
    tl.to(sel, { opacity: ${b.yield.dim ?? 0.55}, duration: 0.20, ease: "power1.in" }, ${(heroIn - (b.yield.pre ?? 0.05)).toFixed(3)});
    tl.to(sel, { opacity: 1, duration: 0.25, ease: "power1.out" }, ${(heroIn + (b.yield.post ?? 0.67)).toFixed(3)});
  });`
    : ""
}

  // ending: furniture retracts
  tl.to("#drTblock", { clipPath: "inset(0 0 0 100%)", duration: 0.14, ease: "power2.in" }, ${(DUR - 0.2).toFixed(3)});
  gsap.set("#drBandrule", { transformOrigin: "100% 50%" });
  tl.to("#drBandrule", { scaleX: 0, duration: 0.14, ease: "power2.in" }, ${(DUR - 0.16).toFixed(3)});
  tl.to("#drBand", { opacity: 0, duration: 0.14, ease: "power1.in" }, ${(DUR - 0.16).toFixed(3)});`;
  return { css, html, js };
}

function paradigmMagnetrail() {
  // MAGNETRAIL: a refrigerator-magnet lower-third. A translucent steel BAND (top
  // highlight + bottom shadow line) docks across the bottom, pinned at two
  // corners by glossy magnet DOTS; a faint specular SHEEN drifts across it all
  // clip (dead-air killer). Transcript words are cream rounded-rect CHIPS that
  // arrive with magnetic physics = the apex letter-magnet motif at low
  // amplitude: each chip flies a short inbound hop (26-42px, seeded direction),
  // DECELERATES, then SNAPS the last 6px hard (power4.in, 2 frames) into a
  // crooked landing (±2°) with a 1-frame squash — and SHOVES its left neighbor
  // 1.6px on contact (neighbor nudge). Emphasis words DOUBLE-BOUNCE and press
  // flat (rotation→0, shadow tightens); a red accent chip (the sign-off /
  // minor) lands so hard the BAND itself takes the hit. Lines stack onto up to
  // body.rows rows of the band (so a phrase reads as two rows at once). Hold
  // life: settled rows bob gently (magnet-strip breathing). Exits: chips lose
  // grip and slide DOWN with a slow rotation, staggered. The band YIELDS while
  // the apex letter-magnets assemble behind the subject.
  const b = dna.body;
  const ROWTOPS = b.rows || [574, 640]; // chip-row baselines inside the band
  const NR = ROWTOPS.length;
  const bandW = (b.band && b.band.w) || 760;
  const bandH = (b.band && b.band.h) || 148;
  const bandCx = (b.band && b.band.cx) || W / 2;
  const bandTop = (b.band && b.band.top) ?? ROWTOPS[0] - 14;
  const bandLeft = Math.round(bandCx - bandW / 2);
  const pin = b.pins || [
    [bandLeft, bandTop - 9, dna.palette.pinCool || "#8cc0e6", dna.palette.pinCoolLo || "#4d7fa8"],
    [
      bandLeft + bandW - 19,
      bandTop + bandH - 16,
      dna.palette.pinWarm || "#f0a06c",
      dna.palette.pinWarmLo || "#b65a2e",
    ],
  ];
  // each line owns a row (round-robin); the red accent chip = the LAST line's
  // last word (sign-off) unless the DNA flags minors as red
  const redLastWord = b.redLastWord !== false;
  const lineData = LINES.map((L, li) => {
    const isLastLine = li === LINES.length - 1;
    // exit: a replaced line (one with a later same-row line) loses grip. Exit
    // shortly after its last word reads when there is a silence gap before the
    // replacement (so the band clears during dead air instead of overlapping
    // the next line) — but never so late the slide-off runs into the next entry.
    let xo = null;
    if (li + NR < LINES.length) {
      const next = LINES[li + NR];
      const lastReadDone = L.words[L.words.length - 1].start + 0.6;
      xo = +Math.min(next.in - 0.04, Math.max(L.in + 0.5, lastReadDone)).toFixed(3);
    }
    return {
      id: "mg" + L.id,
      row: li % NR,
      in: +L.in.toFixed(3),
      xo,
      words: L.words.map((w, wi) => {
        const isLast = isLastLine && wi === L.words.length - 1;
        const flag = isLast && redLastWord ? 2 : w.minor ? 1 : 0; // 0 chip / 1 emphasis / 2 red
        return [w.display, +w.start.toFixed(3), flag];
      }),
    };
  });
  const css = `
  #mgwrap { position:absolute; inset:0; }
  #mgband { position:absolute; left:${bandLeft}px; top:${bandTop}px; width:${bandW}px; height:${bandH}px;
            border-radius:14px; opacity:0; overflow:hidden;
            background: linear-gradient(180deg, ${dna.palette.bandHi || "rgba(212,222,232,0.17)"} 0%,
                        ${dna.palette.bandLo || "rgba(168,180,194,0.11)"} 100%);
            border-top: 1px solid rgba(255,255,255,0.30);
            border-bottom: 1px solid rgba(0,0,0,0.25);
            box-shadow: 0 6px 18px rgba(0,0,0,0.30); }
  #mgsheen { position:absolute; top:0; left:0; width:${Math.round(bandW * 0.3)}px; height:${bandH}px;
             background: linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0) 100%); }
  .mgpin { position:absolute; width:19px; height:19px; border-radius:50%; opacity:0;
           box-shadow: 0 2px 4px rgba(0,0,0,0.45), inset 0 -2px 3px rgba(0,0,0,0.25); }
  .mgrow { position:absolute; left:${bandCx}px; white-space:nowrap; }
${ROWTOPS.map((t, i) => `  .mgrow.r${i} { top:${t}px; }`).join("\n")}
  .mgchip { display:inline-block; margin:0 4px; padding:7px 11px 9px; opacity:0;
            background: linear-gradient(180deg, ${dna.palette.chip || "#fbfaf6"} 0%, ${dna.palette.chipLo || "#efece3"} 100%);
            border:1px solid ${dna.palette.chipEdge || "rgba(104,110,122,0.55)"}; border-radius:7px;
            box-shadow: 0 3px 6px rgba(0,0,0,0.38);
            font-family:'${dna.fonts.body}', sans-serif; font-weight:${b.weight || 600}; font-size:${b.fontPx || 36}px;
            line-height:1.1; color:${dna.palette.body};
            ${b.textTransform ? "text-transform:" + b.textTransform + ";" : ""} }
  .mgchip.red { background: linear-gradient(180deg, ${dna.palette.accent || "#cf4434"} 0%, ${dna.palette.accentLo || "#b1372a"} 100%);
                border-color: ${dna.palette.accentEdge || "rgba(74,18,12,0.65)"}; color:${dna.palette.accentInk || "#fdf3ea"}; }`;
  const html = `      <div id="mgwrap">
        <div id="mgband"><div id="mgsheen"></div></div>
${pin.map((p, i) => `        <div class="mgpin" id="mgpin${i}" style="left:${Math.round(p[0])}px; top:${Math.round(p[1])}px; background: radial-gradient(circle at 35% 30%, ${p[2]}, ${p[3]});"></div>`).join("\n")}
${lineData.map((L) => `        <div class="mgrow r${L.row}" id="${L.id}"></div>`).join("\n")}
      </div>`;
  const dimT = +Math.max(0.15, heroIn - ((b.yield && b.yield.pre) || 0.08)).toFixed(3);
  const resT = +(heroIn + ((b.yield && b.yield.post) || 0.4)).toFixed(3);
  const sheenEnd = +(DUR - 0.4).toFixed(3);
  const js = `
  // ---- body paradigm: MAGNETRAIL (decelerate-then-snap chips on a fridge band) ----
  const RAILM = ${J(lineData)};
  const rrnd = mulberry32(${b.seed || 4423});

  // ===== band + pin furniture + endless specular sheen =====
  gsap.set("#mgband", { y: 14 });
  tl.to("#mgband", { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }, 0.02);
${pin.map((p, i) => `  tl.to("#mgpin${i}", { opacity: 0.92, duration: 0.18 }, ${(0.1 + i * 0.04).toFixed(2)});`).join("\n")}
  tl.fromTo("#mgsheen", { x: -${Math.round(bandW * 0.37)} }, { x: ${Math.round(bandW * 1.09)}, duration: ${(sheenEnd - 0.3).toFixed(2)}, ease: "none" }, 0.30);
${
  b.yield && !heroInline
    ? `
  // band YIELDS while the apex letter-magnets assemble behind the subject
  tl.to("#mgwrap", { opacity: ${b.yield.dim}, duration: 0.15 }, ${dimT});
${resT + 0.3 < DUR ? `  tl.to("#mgwrap", { opacity: 1, duration: 0.18 }, ${resT});` : ""}`
    : ""
}

  // ===== body chips: magnetic decelerate-then-snap physics =====
  RAILM.forEach((L) => {
    const row = document.getElementById(L.id);
    gsap.set(row, { xPercent: -50 });
    const els = [];
    L.words.forEach(([txt, , flag]) => {
      const c = document.createElement("span");
      c.className = "mgchip" + (flag === 2 ? " red" : "");
      c.textContent = txt; row.appendChild(c); els.push(c);
    });
    L.words.forEach(([txt, st, flag], wi) => {
      const c = els[wi];
      const ang = rrnd() * Math.PI * 2, mag = 26 + rrnd() * 16;
      const dx = Math.cos(ang) * mag, dy = Math.sin(ang) * mag * 0.8;
      const m = Math.hypot(dx, dy), nx = dx / m * 6, ny = dy / m * 6;  // 6px short
      const rf = (rrnd() - 0.5) * 14;                                  // flight tilt
      const rl = (rrnd() < 0.5 ? -1 : 1) * (0.8 + rrnd() * 1.2);       // crooked land ±2°
      c._rot = rl;
      tl.set(c, { x: dx, y: dy, rotation: rf, opacity: 1,
                  boxShadow: "0 9px 16px rgba(0,0,0,0.30)" }, st - 0.16);
      tl.to(c, { x: nx, y: ny, rotation: rl + (rf - rl) * 0.3, duration: 0.10, ease: "power2.out" }, st - 0.16);
      tl.to(c, { x: 0, y: 0, rotation: rl, duration: 0.05, ease: "power4.in" }, st - 0.05);  // SNAP last 6px
      tl.to(c, { boxShadow: "0 3px 6px rgba(0,0,0,0.38)", duration: 0.08 }, st - 0.05);
      const sq = flag === 2 ? 0.10 : 0.07;
      tl.set(c, { scaleX: 1 + sq, scaleY: 1 - sq }, st);               // 1-frame squash
      tl.to(c, { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1, 0.4)" }, st + 0.084);
      // neighbor nudge: the chip to the left gets shoved 1.6px and re-settles
      if (wi > 0) {
        tl.set(els[wi - 1], { x: -1.6 }, st + 0.02);
        tl.to(els[wi - 1], { x: 0, duration: 0.12, ease: "power1.out" }, st + 0.062);
      }
      // emphasis: double-bounce, pressed flat (rotation -> 0, shadow tightens)
      if (flag === 1) {
        tl.to(c, { keyframes: { y: [0, 2.6, 0, 1.6, 0],
                                scaleX: [1, 1.04, 1, 1.015, 1],
                                scaleY: [1, 0.95, 1, 0.985, 1] },
                   duration: 0.32, ease: "power1.inOut" }, st + 0.40);
        tl.to(c, { rotation: 0, duration: 0.22, ease: "power2.out" }, st + 0.40);
        tl.to(c, { boxShadow: "0 1px 3px rgba(0,0,0,0.45)", duration: 0.2 }, st + 0.42);
        c._rot = 0;
      }
      // red chip slam: the band itself takes the hit
      if (flag === 2) {
        tl.set("#mgband", { y: 2 }, st + 0.01);
        tl.to("#mgband", { y: 0, duration: 0.15, ease: "power1.out" }, st + 0.052);
      }
    });
    // exits: chips lose grip — slide down with slow rotation, staggered
    if (L.xo !== null) {
      els.forEach((c, ci) => {
        const r0 = c._rot;
        const d = (rrnd() < 0.5 ? -1 : 1) * (8 + rrnd() * 10);
        tl.to(c, { keyframes: { y: [0, 34, 124],
                                rotation: [r0, r0 + d * 0.45, r0 + d],
                                opacity: [1, 1, 0] },
                   duration: 0.55, ease: "power2.in" }, L.xo + ci * 0.055);
      });
      tl.set(row, { display: "none" }, L.xo + els.length * 0.055 + 0.6);
    }
  });

  // hold life: settled rows bob gently (magnet-strip breathing)
  RAILM.forEach((L) => {
    if (L.xo === null) {
      const lastIn = L.words[L.words.length - 1][1] + 0.5;
      if (lastIn < ${(DUR - 0.6).toFixed(2)})
        tl.to("#" + L.id, { y: 1.3, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: 1 }, lastIn);
    }
  });`;
  return { css, html, js };
}

function paradigmStarrail() {
  // STARRAIL: a left-anchored star-chart lower third. Each word arrives as the
  // apex motif at low amplitude — per-letter GOLD STAR POINTS pop in (seeded
  // jitter, back.out), a hairline underline draws L→R, then the glyphs fade up;
  // dots + hairline dim to ledger weight once read. An astronomy chart sits
  // behind (two faint draw-on declination arcs + graticule ticks + DEC/R.A.
  // labels) and YIELDS while the apex lands. The emphasis word gets a dotted
  // catalogue ellipse + a designation tag (e.g. α-CMa). The apex word is handed
  // off to the sky (a single marker star sits in its slot). Exit is asymmetric:
  // hairline retracts → dots wink → glyphs blur up last. At the final word every
  // chart line glitch-wavers two frames (clouds crossing the field).
  const b = dna.body;
  const A = dna.palette.accent || "#ffd98c",
    DOT = dna.palette.dot || A,
    EM = dna.palette.em || "#f6e2ae",
    INK = dna.palette.body || "#f2ead8",
    TAGC = dna.palette.tag || A;
  const leftPx = b.leftPx ?? 84;
  const fontPx = b.fontPx || 46;
  const emPx = Math.round(fontPx * (b.minorScale || 1.17));
  const lineGap = b.lineGap || 60;
  const bottomPx = b.bottomPx || 72;
  // stack concurrently-visible lines bottom-anchored in the lower third.
  // group lines whose [in,out] windows overlap (a stanza shows together).
  const groups = [];
  LINES.forEach((L) => {
    const g = groups.find((gr) => gr.some((m) => L.in < m.out - 0.05 && L.out > m.in + 0.05));
    if (g) g.push(L);
    else groups.push([L]);
  });
  const topOf = {};
  groups.forEach((g) => {
    const baseTop = H - bottomPx - (g.length - 1) * lineGap - fontPx;
    g.forEach((L, k) => {
      topOf[L.id] = Math.round(baseTop + k * lineGap);
    });
  });
  const NZ = +LASTWORD.start.toFixed(3);
  // is the apex word inside the body stream? (hand-off marker replaces it)
  const heroSlots = {};
  if (!heroInline && !HEROLESS && hero) {
    for (let k = 0; k < hero.len; k++) heroSlots[tWords[hero.idx + k].start.toFixed(3)] = 1;
  }
  // emphasis designation tag text (catalogue id) — DNA-driven, seeded fallback
  const emTag = b.emTag || "α-CMa";
  const lineData = LINES.map((L) => ({
    id: "sr" + L.id,
    top: topOf[L.id],
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [
      w.display,
      +w.start.toFixed(3),
      w.minor ? 1 : 0,
      heroSlots[w.start.toFixed(3)] ? 1 : 0, // hand-off marker slot
    ]),
  }));
  const chart = b.chart !== false;
  const css = `
  #srchart { position:absolute; left:0; top:0; }
  #srwrap { position:absolute; inset:0; }
  .srl { position:absolute; left:${leftPx}px; white-space:nowrap;
         font-family:'${dna.fonts.body}', serif; font-weight:600; font-size:${fontPx}px;
         line-height:1.15; color:${INK}; }
  .srl .w { display:inline-block; position:relative; margin-right:0.32em; }
  .srl .w.em { font-size:${emPx}px; font-style:italic; font-weight:700; color:${EM}; }
  .srl .L { display:inline-block; position:relative; }
  .srl .g { opacity:0; text-shadow:0 2px 10px rgba(0,0,0,0.72), 0 0 16px ${A}38; }
  .srl .em .g { text-shadow:0 2px 10px rgba(0,0,0,0.72), 0 0 18px ${A}66; }
  .srl .d { position:absolute; left:50%; top:0.50em; width:5px; height:5px; margin-left:-2.5px;
            border-radius:50%; background:${DOT}; opacity:0;
            box-shadow:0 0 6px 1px ${DOT}cc; }
  .srl .hl { position:absolute; left:1px; right:1px; top:0.56em; height:1px;
             background:${INK}cc; opacity:0.8; transform:scaleX(0); transform-origin:left center; }
  .srl .md { display:inline-block; width:9px; height:9px; border-radius:50%; background:${DOT};
             box-shadow:0 0 8px 2px ${DOT}b3; vertical-align:0.34em; opacity:0; }
  .srl .ell { position:absolute; left:-8%; top:-16%; width:116%; height:132%; overflow:visible; }
  .srl .tag { position:absolute; top:-30px; right:-10px; font-family:'${dna.fonts.tag}', monospace;
              font-size:20px; letter-spacing:1px; color:${TAGC}; text-shadow:0 1px 6px rgba(0,0,0,0.7); }
  .srl .tag span { opacity:0; }
  .srlbl { font-family:'${dna.fonts.tag}', monospace; font-size:13px; fill:${INK}4d; letter-spacing:2px; }`;
  const chartHtml = chart
    ? `      <svg id="srchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <path id="srarc1" d="M -30 96 Q 200 200 296 470" fill="none"
              stroke="${INK}21" stroke-width="1"/>
        <path id="srarc2" d="M -30 502 Q 640 446 ${W + 30} 502" fill="none"
              stroke="${INK}21" stroke-width="1"/>
        <g id="srticks" stroke="${INK}24" stroke-width="1" opacity="0"></g>
        <g id="srlbl" opacity="0">
          <text class="srlbl" x="170" y="244" transform="rotate(62 170 244)">${esc(b.lblA || "DEC +38°")}</text>
          <text class="srlbl" x="1020" y="490" transform="rotate(3 1020 490)">${esc(b.lblB || "R.A. 04h—09h")}</text>
        </g>
      </svg>`
    : "";
  const html = `${chartHtml}
      <div id="srwrap"></div>`;
  const js = `
  // ---- body paradigm: STARRAIL (star-point dots → hairline → glyphs) ----
  const rnd = mulberry32(${b.seed || 2727});
  const SVGNS = "http://www.w3.org/2000/svg";
  const srwrap = document.getElementById("srwrap");
  const NZ = ${NZ.toFixed(3)};
${
  chart
    ? `
  // chart furniture: arcs draw on, ticks + labels fade, yields during apex
  const srarcs = [document.getElementById("srarc1"), document.getElementById("srarc2")];
  const srticks = document.getElementById("srticks");
  srarcs.forEach((p, i) => {
    const L = p.getTotalLength();
    gsap.set(p, { strokeDasharray: L, strokeDashoffset: L });
    tl.to(p, { strokeDashoffset: 0, duration: 0.7, ease: "power1.inOut" }, 0.04 + i * 0.08);
    const n = 13;
    for (let k = 1; k < n; k++) {
      const t = k / n * L;
      const p1 = p.getPointAtLength(Math.max(0, t - 1)), p2 = p.getPointAtLength(Math.min(L, t + 1));
      const dx = p2.x - p1.x, dy = p2.y - p1.y, m = Math.hypot(dx, dy) || 1;
      const nx = -dy / m, ny = dx / m, pt = p.getPointAtLength(t);
      const s = (k % 3 === 0) ? 6 : 3.5;
      const ln = document.createElementNS(SVGNS, "line");
      ln.setAttribute("x1", pt.x - nx * s); ln.setAttribute("y1", pt.y - ny * s);
      ln.setAttribute("x2", pt.x + nx * s); ln.setAttribute("y2", pt.y + ny * s);
      srticks.appendChild(ln);
    }
  });
  tl.to("#srticks", { opacity: 1, duration: 0.3, ease: "power1.out" }, 0.38);
  tl.to("#srlbl",   { opacity: 1, duration: 0.35, ease: "power1.out" }, 0.52);
${
  !heroInline && !HEROLESS
    ? `  tl.to("#srchart", { opacity: 0.65, duration: 0.15, ease: "power1.out" }, ${Math.max(heroIn - (b.yield ? b.yield.pre || 0.2 : 0.2), 0.1).toFixed(3)});
  tl.to("#srchart", { opacity: 1,    duration: 0.30, ease: "power1.out" }, ${(heroIn + (b.yield ? b.yield.post || 1.2 : 1.2)).toFixed(3)});`
    : ""
}`
    : ""
}

  function buildWord(line, txt, st, isEm) {
    const w = document.createElement("span"); w.className = "w" + (isEm ? " em" : "");
    line.appendChild(w);
    const hl = document.createElement("div"); hl.className = "hl"; w.appendChild(hl);
    const gs = [], dots = [];
    for (const ch of txt) {
      const Lc = document.createElement("span"); Lc.className = "L";
      const g = document.createElement("span"); g.className = "g"; g.textContent = ch;
      Lc.appendChild(g);
      if (/[A-Za-z0-9]/.test(ch)) {
        const d = document.createElement("div"); d.className = "d"; Lc.appendChild(d);
        d.dataset.jx = ((rnd() - 0.5) * 4).toFixed(2); d.dataset.jy = ((rnd() - 0.5) * 9).toFixed(2);
        dots.push(d);
      }
      w.appendChild(Lc); gs.push(g);
    }
    const T0 = Math.max(0.02, st - 0.27);
    dots.forEach((d, i) => {
      gsap.set(d, { x: +d.dataset.jx, y: +d.dataset.jy });
      tl.fromTo(d, { opacity: 0 },   { opacity: 0.95, duration: 0.06, ease: "none" }, T0 + i * 0.022);
      tl.fromTo(d, { scale: 0.25 },  { scale: 1, duration: 0.26, ease: "back.out(2.6)" }, T0 + i * 0.022);
    });
    tl.fromTo(hl, { scaleX: 0 }, { scaleX: 1, duration: 0.15, ease: "power2.out" }, T0 + 0.12);
    tl.fromTo(gs, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.2, ease: "power1.out", stagger: 0.013 }, T0 + 0.27);
    const dimStart = T0 + 0.31;
    const dimDur = Math.max(0.08, Math.min(0.25, (NZ + 0.15) - dimStart));
    tl.to(dots, { opacity: 0.3,  duration: dimDur, ease: "power1.out" }, dimStart);
    tl.to(hl,   { opacity: 0.15, duration: dimDur, ease: "power1.out" }, dimStart);
    return { w, gs, dots, hl };
  }
  function buildMark(line, st) {
    const w = document.createElement("span"); w.className = "w"; line.appendChild(w);
    const md = document.createElement("span"); md.className = "md"; w.appendChild(md);
    tl.fromTo(md, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "none" }, st);
    tl.fromTo(md, { scale: 0.2 }, { scale: 1, duration: 0.3, ease: "back.out(3)" }, st);
    tl.to(md, { opacity: 0.75, duration: 0.4, ease: "sine.inOut" }, st + 0.6);
    return md;
  }
  function addEmphasis(w, annT) {
    const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("class", "ell");
    svg.setAttribute("viewBox", "0 0 100 60"); svg.setAttribute("preserveAspectRatio", "none");
    const defs = document.createElementNS(SVGNS, "defs");
    const cp = document.createElementNS(SVGNS, "clipPath"); cp.id = "srellclip";
    cp.setAttribute("clipPathUnits", "userSpaceOnUse");
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("x", -12); rect.setAttribute("y", -12);
    rect.setAttribute("width", 0); rect.setAttribute("height", 84);
    cp.appendChild(rect); defs.appendChild(cp); svg.appendChild(defs);
    const el = document.createElementNS(SVGNS, "ellipse");
    el.setAttribute("cx", 50); el.setAttribute("cy", 30);
    el.setAttribute("rx", 47); el.setAttribute("ry", 25);
    el.setAttribute("fill", "none"); el.setAttribute("stroke", ${J(A)});
    el.setAttribute("stroke-opacity", "0.75"); el.setAttribute("stroke-width", "1.3");
    el.setAttribute("vector-effect", "non-scaling-stroke");
    el.setAttribute("stroke-dasharray", "2.8 4.2");
    el.setAttribute("transform", "rotate(-3 50 30)");
    el.setAttribute("clip-path", "url(#srellclip)");
    svg.appendChild(el); w.appendChild(svg);
    tl.to(rect, { attr: { width: 124 }, duration: 0.32, ease: "power2.out" }, annT);
    const tag = document.createElement("div"); tag.className = "tag"; w.appendChild(tag);
    [...${J(emTag)}].forEach((ch, j) => {
      const s = document.createElement("span"); s.textContent = ch; tag.appendChild(s);
      tl.set(s, { opacity: 1 }, annT + 0.38 + j * 0.05);
    });
    gsap.set(w, { transformOrigin: "50% 60%" });
    tl.to(w, { scale: 1.02, duration: 0.4, ease: "sine.inOut", yoyo: true, repeat: 1 }, annT + 0.53);
  }

  const SRAIL = ${J(lineData)};
  const srLines = {};
  SRAIL.forEach((L) => {
    const div = document.createElement("div"); div.className = "srl"; div.id = L.id;
    div.style.top = L.top + "px"; srwrap.appendChild(div); srLines[L.id] = div;
    let firstEm = true;
    L.words.forEach(([txt, st, minor, isMark]) => {
      if (isMark) { buildMark(div, st); return; }   // apex word lives in the sky
      const r = buildWord(div, txt, st, minor);
      if (minor && firstEm) { addEmphasis(r.w, ${(heroIn > 0 ? Math.min(heroIn + 2.1, DUR - 1.4) : DUR - 1.4).toFixed(2)}); firstEm = false; }
    });
  });

  // rail dims while the apex lands, restores after
${
  !heroInline && !HEROLESS && b.yield
    ? `  tl.to("#srwrap", { opacity: ${b.yield.dim}, duration: 0.12, ease: "power1.out" }, ${Math.max(heroIn - (b.yield.pre || 0.2), 0.1).toFixed(3)});
  tl.to("#srwrap", { opacity: 1,    duration: 0.30, ease: "power1.out" }, ${(heroIn + (b.yield.post || 1.15)).toFixed(3)});`
    : ""
}

  // line exits: hairline retract → dots wink → glyphs blur up last (asymmetric)
  SRAIL.forEach((L) => {
    const line = srLines[L.id];
    const XO = L.out;
    tl.to(line.querySelectorAll(".hl"), { scaleX: 0, duration: 0.14, ease: "power2.in", stagger: 0.03 }, XO);
    tl.to(line.querySelectorAll(".d"),  { opacity: 0, duration: 0.06, ease: "power1.in", stagger: 0.02 }, XO + 0.06);
    tl.to(line.querySelectorAll(".md"), { opacity: 0, scale: 1.7, duration: 0.08, ease: "power1.in" }, XO + 0.04);
    tl.to(line.querySelectorAll(".g"),  { opacity: 0, y: -7, filter: "blur(3px)", duration: 0.22, ease: "power1.in", stagger: 0.008 }, XO + 0.14);
    tl.to(line.querySelectorAll(".tag"),{ opacity: 0, duration: 0.10, ease: "power1.in" }, XO);
    tl.set(line, { display: "none" }, XO + 0.5);
  });

  // final word: chart lines glitch-waver two frames (clouds cross the field)
${
  chart
    ? `  tl.set("#srchart", { x: 2,  opacity: 0.55 }, NZ);
  tl.set("#srchart", { x: -1, opacity: 0.8 },  NZ + F);
  tl.set("#srchart", { x: 0,  opacity: 1 },    NZ + 2 * F);
  srarcs.forEach((p) => { tl.to(p, { strokeDashoffset: p.getTotalLength(), duration: 0.25, ease: "power2.in" }, ${(DUR - 0.28).toFixed(3)}); });
  tl.to(["#srticks", "#srlbl"], { opacity: 0, duration: 0.2, ease: "power1.in" }, ${(DUR - 0.28).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function paradigmSeancerail() {
  // SEANCERAIL: a centered two-row lower-third where bone words SEEP IN — a
  // desaturated mist layer resolves to a Shippori Mincho glyph (blur 8→0, y 6→0)
  // with a seeded ±1-frame arrival jitter. Upward text-shadows everywhere (the
  // light-from-below wrongness signature). Per-line a random letter FLICKERS
  // (drops to 0.4 for 2 frames). Emphasis words exhale a GHOST duplicate drifting
  // up. Exit = exhaled UPWARD with a 1-frame flicker (blur 6 / y -25 / fade).
  // Furniture: a bone hairline that draws L→R + a small rotated diamond +
  // dust motes drifting up through the seance air (seeded). The apex word is
  // handed off to the embedded POSSESS event (its slot stays empty here); the
  // rail dims while that lands and restores after.
  const b = dna.body;
  const INK = dna.palette.body || "#e8e2d4";
  const MIST = dna.palette.mist || "#9fb0aa";
  const GHOST = dna.palette.ghost || "#d4dcd2";
  const HAUNT = dna.palette.haunt || "150,28,28";
  const fontPx = b.fontPx || 44;
  const bottomPx = b.bottomPx || 124;
  const rowGap = b.rowGap || 58;
  const seed = b.seed || 1212;
  const motes = b.motes ?? 12;
  // two-row lower third: group lines whose [in,out] windows overlap; first of a
  // group rides the TOP row, second drops to the lower row (demo: 596 / 654).
  const groups = [];
  LINES.forEach((L) => {
    const g = groups.find((gr) => gr.some((m) => L.in < m.out - 0.05 && L.out > m.in + 0.05));
    if (g) g.push(L);
    else groups.push([L]);
  });
  const topRow = H - bottomPx - rowGap;
  const botRow = H - bottomPx;
  const topOf = {};
  groups.forEach((g) => g.forEach((L, k) => (topOf[L.id] = k === 0 ? topRow : botRow)));
  // hero hand-off: which body word slots are the apex (replaced by POSSESS)
  const heroSlots = {};
  if (!heroInline && !HEROLESS && hero) {
    for (let k = 0; k < hero.len; k++) heroSlots[tWords[hero.idx + k].start.toFixed(3)] = 1;
  }
  const lineData = LINES.map((L) => ({
    id: "se" + L.id,
    top: topOf[L.id],
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words
      .filter((w) => !heroSlots[w.start.toFixed(3)]) // apex word lives behind the subject
      .map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  })).filter((L) => L.words.length);
  const hair = b.hairline !== false;
  const hairW = b.hairW || 560;
  const css = `
  .seln { position:absolute; left:${W / 2}px; white-space:nowrap;
          font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 600}; font-size:${fontPx}px;
          line-height:1.25; color:${INK}; opacity:0;
          text-shadow: 0 -4px 10px rgba(0,0,0,0.85), 0 -1px 2px rgba(0,0,0,0.7); }
  .seln .w { display:inline-block; position:relative; margin-right:0.30em; opacity:0; }
  .seln .w:last-child { margin-right:0; }
  .seln .ink { display:inline-block; }
  .seln .lt { display:inline-block; }
  .seln .mist { position:absolute; left:0; top:0; color:${MIST}; opacity:0; pointer-events:none; }
  .seln .ghost { position:absolute; left:0; top:0; color:${GHOST}; opacity:0; pointer-events:none; }
  .seln .w.em .ink { text-shadow: 0 -4px 10px rgba(0,0,0,0.85), 0 -1px 2px rgba(0,0,0,0.7),
                                  0 0 18px rgba(${HAUNT},0.35); }
  ${
    hair
      ? `#sehr { position:absolute; left:${W / 2}px; top:${topRow - 38}px; width:${hairW}px; height:1px;
        background:${INK}99; opacity:0; }
  #sehd { position:absolute; left:${W / 2}px; top:${topRow - 38}px; width:8px; height:8px;
        background:${INK}; opacity:0; }`
      : ""
  }`;
  const html =
    (hair ? `      <div id="sehr"></div><div id="sehd"></div>\n` : "") +
    `      <div id="sewrap"></div>`;
  const js = `
  // ---- body paradigm: SEANCERAIL (mist seeps in → bone glyph; exhale exit) ----
  const rnd = mulberry32(${seed});
  const sewrap = document.getElementById("sewrap");
  const SELINES = ${J(lineData)};
  const seL = {};
  SELINES.forEach((L) => {
    const line = document.createElement("div"); line.className = "seln"; line.id = L.id;
    line.style.top = L.top + "px"; sewrap.appendChild(line); seL[L.id] = line;
    gsap.set(line, { xPercent: -50, yPercent: -50 });
    const wordEls = L.words.map(([txt, st, em]) => {
      const w = document.createElement("span"); w.className = "w" + (em ? " em" : "");
      const ink = document.createElement("span"); ink.className = "ink";
      for (const ch of txt) {
        const l = document.createElement("span"); l.className = "lt"; l.textContent = ch; ink.appendChild(l);
      }
      const mist = document.createElement("span"); mist.className = "mist"; mist.textContent = txt;
      const ghost = document.createElement("span"); ghost.className = "ghost"; ghost.textContent = txt;
      w.appendChild(mist); w.appendChild(ink); w.appendChild(ghost);
      line.appendChild(w);
      return w;
    });
    tl.set(line, { opacity: 1 }, L.in);

    // SEEP-IN: blur 8→0 + desat mist resolving to bone, seeded ±1-frame jitter
    L.words.forEach(([txt, st, em], wi) => {
      const t = Math.max(0.05, st + (Math.floor(rnd() * 3) - 1) * F);
      const w = wordEls[wi], ink = w.children[1], mist = w.children[0], ghost = w.children[2];
      tl.set(w, { opacity: 1 }, t - 0.01);
      tl.fromTo(ink, { opacity: 0, filter: "blur(8px)", y: 6 },
                { opacity: 1, filter: "blur(0px)", y: 0, duration: 0.5, ease: "power2.out" }, t);
      tl.fromTo(mist, { opacity: 0, filter: "blur(9px)" },
                { opacity: 0.6, filter: "blur(6px)", duration: 0.16, ease: "power1.out" }, t);
      tl.to(mist, { opacity: 0, filter: "blur(2px)", duration: 0.38, ease: "power1.in" }, t + 0.18);
      if (em) {
        const gs = t + 0.55, gd = Math.min(0.8, ${(DUR - 0.04).toFixed(2)} - gs);
        if (gd > 0.2) {
          tl.set(ghost, { opacity: 0.5, y: 0, filter: "blur(2px)" }, gs);
          tl.to(ghost, { y: -12, opacity: 0, filter: "blur(4px)", duration: gd, ease: "power1.out" }, gs + 0.02);
        }
      }
    });

    // LETTER FLICKERS: a random letter drops to 0.4 for 2 frames, ~2 events/line
    const visEnd = L.out - 0.18;
    const nEv = L.words.length > 1 ? 2 : 1;
    for (let e = 0; e < nEv; e++) {
      const wi = Math.floor(rnd() * L.words.length);
      const wStart = L.words[wi][1] + 0.65;
      if (visEnd - wStart < 0.15) { rnd(); continue; }
      const lts = wordEls[wi].children[1].children;
      const li = Math.floor(rnd() * lts.length);
      const tf = wStart + rnd() * (visEnd - wStart);
      tl.set(lts[li], { opacity: 0.4 }, tf);
      tl.set(lts[li], { opacity: 1 }, tf + 2 * F);
    }

    // EXHALE EXIT: 1-frame flicker, then blur 6 / y -25 / fade upward
    const XO = L.out;
    tl.set(line, { opacity: 0.35 }, XO);
    tl.set(line, { opacity: 1 }, XO + F);
    tl.to(line, { y: -25, filter: "blur(6px)", duration: 0.4, ease: "power1.in" }, XO + 2 * F);
    tl.to(line, { opacity: 0, duration: 0.28, ease: "power1.in" }, XO + 2 * F);
    tl.set(line, { display: "none" }, XO + 0.55);
  });

  // rail dims while the apex lands, restores after (furniture never contests hero)
${
  !heroInline && !HEROLESS && b.yield
    ? `  tl.to("#sewrap", { opacity: ${b.yield.dim}, duration: 0.18, ease: "power1.out" }, ${Math.max(heroIn - (b.yield.pre || 0.2), 0.1).toFixed(3)});
  tl.to("#sewrap", { opacity: 1,    duration: 0.30, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.9)).toFixed(3)});`
    : ""
}
${
  hair
    ? `
  // ===== furniture: bone hairline + diamond =====
  gsap.set("#sehr", { xPercent: -50 });
  gsap.set("#sehd", { xPercent: -50, yPercent: -50, rotation: 45 });
  tl.set("#sehr", { opacity: 0.45 }, 0.20);
  tl.fromTo("#sehr", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, 0.20);
  tl.set("#sehd", { opacity: 0.7 }, 0.24);
  tl.fromTo("#sehd", { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.24);
  tl.to("#sehd", { keyframes: { opacity: [0.5, 0.7, 0.5, 0.68, 0.55] }, duration: ${(DUR - 1.4).toFixed(2)}, ease: "sine.inOut" }, 0.6);
  tl.to("#sehr", { opacity: 0.18, duration: 0.2 }, ${(heroIn - 0.2).toFixed(3)});
  tl.to("#sehr", { opacity: 0.45, duration: 0.3 }, ${(heroIn + (b.yield ? b.yield.post || 0.9 : 0.9)).toFixed(3)});`
    : ""
}

  // ===== dust motes drifting upward (seance air), seeded =====
  for (let i = 0; i < ${motes}; i++) {
    const m = document.createElement("div"); m.className = "semote"; sewrap.appendChild(m);
    const s = 2 + Math.round(rnd() * 1.5);
    gsap.set(m, { width: s, height: s, left: 80 + rnd() * ${W - 180}, top: ${Math.round(H * 0.56)} + rnd() * ${Math.round(H * 0.36)} });
    const t0 = 0.2 + rnd() * ${(DUR - 1.6).toFixed(2)};
    const dur = Math.min(2.2 + rnd() * 1.6, ${(DUR - 0.04).toFixed(2)} - t0);
    tl.fromTo(m, { opacity: 0, y: 0 },
      { keyframes: { opacity: [0.3, 0.42, 0.2, 0.36, 0], y: [-14, -28, -42, -56, -70] },
        duration: dur, ease: "none" }, t0);
  }`;
  const fgCss = `
  .semote { position:absolute; border-radius:50%; background:${INK}d9; filter:blur(0.6px); opacity:0; }`;
  return { css: css + fgCss, html, js };
}

function paradigmLeatherrail() {
  // LEATHERRAIL: a tooled-leather band docked in the lower third (grain + saddle
  // stitching). Each word SINGES IN — the apex iron-press at low amplitude: a
  // tiny crush, a 1-frame contact squash, an elastic settle, ember-hot color
  // that recedes into a charred edge (glow swap), and one faint smoke wisp
  // rising off the fresh burn. Emphasis words RE-GLOW as if pressed again
  // (color/shadow only — never contests the scale channel). The line exits as
  // a smoke-out (blur up + drift up + fade) and leaves a dark word-shaped CHAR
  // SMUDGE branded into the band until clip end (the signature). The apex word
  // is handed off to the embedded IRONBRAND event; the band dims while it lands.
  const b = dna.body;
  const HOT = dna.palette.hot || "#ffdfae";
  const SETTLED = dna.palette.body || "#e8c697";
  const EMBER = dna.palette.em || "#ffb066";
  const CHAR = dna.palette.char || "#150b05";
  const STITCH = dna.palette.stitch || "232,201,151";
  const fontPx = b.fontPx || 44;
  const bottomPx = b.bottomPx || 96;
  const seed = b.seed || 34034034;
  const baseY = H - bottomPx; // word baseline / reading center
  const bandH = b.bandH || 94;
  const bandTop = baseY - Math.round(bandH * 0.52);
  // hero hand-off: apex word slot(s) live behind the subject (IRONBRAND owns it)
  const heroSlots = {};
  if (!heroInline && !HEROLESS && hero) {
    for (let k = 0; k < hero.len; k++) heroSlots[tWords[hero.idx + k].start.toFixed(3)] = 1;
  }
  const lineData = LINES.map((L) => ({
    id: "lr" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words
      .filter((w) => !heroSlots[w.start.toFixed(3)])
      .map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  })).filter((L) => L.words.length);
  const GLOW_IN = "0 0 18px rgba(255,122,40,0.90), 0 0 2px rgba(20,8,2,0)";
  const GLOW_OUT = "0 0 2px rgba(255,122,40,0.22), 0 0 3px rgba(18,8,2,0.95)";
  const css = `
  #lrwrap { position:absolute; inset:0; }
  #lband { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px; opacity:0;
           background:
             radial-gradient(140% 110% at 50% -10%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.30) 100%),
             repeating-linear-gradient(97deg,  rgba(0,0,0,0.10) 0 2px, rgba(0,0,0,0) 2px 7px),
             repeating-linear-gradient(176deg, rgba(255,222,170,0.045) 0 1px, rgba(0,0,0,0) 1px 5px),
             linear-gradient(180deg, ${dna.palette.leatherHi || "#483320"} 0%, ${dna.palette.leather || "#3a2a1c"} 42%, ${dna.palette.leatherLo || "#2e2013"} 100%);
           box-shadow: 0 -3px 16px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,226,180,0.13),
                       inset 0 -1px 0 rgba(0,0,0,0.55); }
  .lstitch { position:absolute; left:18px; width:${W - 36}px; height:2px; opacity:0; border-radius:1px;
             background: repeating-linear-gradient(90deg, rgba(${STITCH},0.50) 0 8px, rgba(${STITCH},0) 8px 17px); }
  #lstitchT { top:${bandTop + 8}px; } #lstitchB { top:${bandTop + bandH - 10}px; }
  .lln { position:absolute; left:${W / 2}px; top:${baseY}px; opacity:0; white-space:nowrap;
         font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 700}; font-size:${fontPx}px;
         line-height:1; letter-spacing:${b.letterSpacing || "0.035em"}; color:${SETTLED}; }
  .lln .w { display:inline-block; position:relative; opacity:0; margin:0 0.19em; }
  .lwsp { position:absolute; left:50%; top:-14px; width:12px; height:24px; margin-left:-6px;
          border-radius:50%; opacity:0; filter:blur(3px);
          background: radial-gradient(50% 50% at 50% 50%, rgba(228,210,190,0.55) 0%, rgba(228,210,190,0) 75%); }
  .lghost { position:absolute; left:${W / 2}px; top:${baseY}px; opacity:0; white-space:nowrap;
            font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 700}; font-size:${fontPx}px;
            line-height:1; letter-spacing:${b.letterSpacing || "0.035em"}; color:${CHAR}; filter:blur(2.5px); }`;
  const html =
    `      <div id="lrwrap">
        <div id="lband"></div>
        <div class="lstitch" id="lstitchT"></div><div class="lstitch" id="lstitchB"></div>` +
    lineData
      .map(
        (L) =>
          `        <div class="lghost" id="g${L.id}"></div><div class="lln" id="${L.id}"></div>`,
      )
      .join("\n") +
    `\n      </div>`;
  const js = `
  // ---- body paradigm: LEATHERRAIL (singe-in press; char-smudge signature) ----
  const lrnd = mulberry32(${seed});
  const HOT = ${J(HOT)}, SETTLED = ${J(SETTLED)}, EMBER = ${J(EMBER)};
  const GLOW_IN = ${J(GLOW_IN)}, GLOW_OUT = ${J(GLOW_OUT)};
  const LRLINES = ${J(lineData)};
  LRLINES.forEach((L) => {
    const line = document.getElementById(L.id);
    const ghost = document.getElementById("g" + L.id);
    ghost.textContent = L.words.map((w) => w[0]).join(" ");
    gsap.set([line, ghost], { xPercent: -50, yPercent: -50 });
    tl.set(line, { opacity: 1 }, L.in);
    const XO = L.out - 0.17;                                   // single exit source

    L.words.forEach(([txt, st, em], wi) => {
      const el = document.createElement("span");
      el.className = "w"; el.textContent = txt; line.appendChild(el);
      const wsp = document.createElement("div");
      wsp.className = "lwsp"; el.appendChild(wsp);

      // SINGE IN — the iron press at low amplitude: crush, squash, elastic
      tl.set(el, { opacity: 1, scale: ${b.singeScale || 1.12}, color: HOT, textShadow: GLOW_IN,
                   transformOrigin: "50% 70%" }, st);
      tl.to(el, { scale: 1, duration: 0.09, ease: "power3.in" }, st + 0.005);
      tl.set(el, { scaleX: 1.06, scaleY: 0.94 }, st + 0.10);
      tl.to(el, { scaleX: 1, scaleY: 1, duration: 0.22, ease: "elastic.out(1, 0.45)" }, st + 0.14);
      // ember glow recedes inward, the charred edge grows in (shadow swap)
      tl.to(el, { color: SETTLED, textShadow: GLOW_OUT, duration: 0.34, ease: "power1.in" }, st + 0.12);
      // one tiny smoke wisp rises off the fresh burn (clamped to clip end)
      const sx = (lrnd() - 0.5) * 10, sx2 = (lrnd() - 0.5) * 14;
      const wdur = Math.min(0.7, ${(DUR - 0.04).toFixed(3)} - (st + 0.10));
      if (wdur > 0.1) {
        tl.to(wsp, { keyframes: { opacity: [0, 0.55, 0.30, 0],
                                  y: [0, -9, -19, -30],
                                  x: [0, sx, sx2, sx + sx2] },
                     duration: wdur, ease: "power1.out" }, st + 0.10);
      }

      // EMPHASIS — re-glow (color/shadow only; never contests the scale channel)
      if (em) {
        const pulse = st + ${b.emPulseDelay || 0.6};
        if (pulse + 0.42 < XO) {
          tl.to(el, { color: EMBER, textShadow: GLOW_IN, duration: 0.10, ease: "power2.in" }, pulse);
          tl.to(el, { color: SETTLED, textShadow: GLOW_OUT, duration: 0.30, ease: "power1.out" }, pulse + 0.12);
        }
      }
    });

    // EXIT — smoke-out: blur up + drift up + fade; char smudge brands the band
    const edur = XO > ${(DUR - 0.35).toFixed(3)} ? 0.14 : 0.20;
    tl.to(line, { y: "-=9", opacity: 0, filter: "blur(4px)", duration: edur, ease: "power1.in" }, XO);
    tl.set(line, { display: "none" }, Math.min(XO + edur + 0.02, ${(DUR - 0.02).toFixed(3)}));
    tl.set(ghost, { opacity: ${b.ghostOpacity || 0.2} }, XO + 0.10);
  });

  // ===== furniture: the leather band is laid down before the first press =====
  tl.fromTo("#lband", { opacity: 0 }, { opacity: 1, duration: 0.18, ease: "power2.out" }, 0.04);
  tl.fromTo(["#lstitchT","#lstitchB"], { opacity: 0 }, { opacity: 0.55, duration: 0.2 }, 0.10);
${
  !heroInline && !HEROLESS && b.yield
    ? `
  // rail yields while the brand lands (hierarchy rule)
  tl.to("#lrwrap", { opacity: ${b.yield.dim}, duration: 0.16, ease: "power1.in" }, ${Math.max(heroIn - (b.yield.pre || 0.2), 0.1).toFixed(3)});
  tl.to("#lrwrap", { opacity: 1, duration: 0.28, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.9)).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function paradigmMirrorrail() {
  // MIRRORRAIL: a black-mirror floor rail. Each line sits on a piano-black glass
  // band over a silver floor hairline; EVERY word RISES out of its own reflection
  // (word y 14→0, opacity full in 2 frames — emerging from still water). The
  // reflection of the line is the WHOLE row flipped (scaleY -1) under a gradient
  // fade mask. Emphasis: only the REFLECTION ripples (scaleY pulse + blur) — the
  // word itself never moves (body-stability law: the reading face is dead still).
  // Hold: each line's reflection wavers faintly. Exit: the line SINKS back into
  // the mirror (scaleY→0.18, the apex motif at low amplitude). A glint travels
  // the floor line during the speech silence (the mirror is alive). The apex word
  // is handed to the embedded MIRRORMERGE event; the rail dims while it lands.
  const b = dna.body;
  const INK = dna.palette.body || "#f0f4f9";
  const MIR = dna.palette.mirror || "#dce8f4";
  const HALO = dna.palette.halo || "120,160,210";
  const SILV = dna.palette.silver || "190,210,235";
  const SILVH = dna.palette.silverHi || "228,240,252";
  const fontPx = b.fontPx || 46;
  const bottomPx = b.bottomPx || 89;
  const mirOpacity = b.mirrorOpacity ?? 0.25;
  const baseY = H - bottomPx; // floor line / reading baseline
  const bandTop = baseY - 33;
  const bandH = H - bandTop;
  const railW = b.railWidth || 780;
  // hero hand-off: which body word slots are the apex (handed to MIRRORMERGE)
  const heroSlots = {};
  if (!heroInline && !HEROLESS && hero) {
    for (let k = 0; k < hero.len; k++) heroSlots[tWords[hero.idx + k].start.toFixed(3)] = 1;
  }
  const lineData = LINES.map((L) => ({
    id: "mr" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words
      .filter((w) => !heroSlots[w.start.toFixed(3)]) // apex word lives behind the subject
      .map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  })).filter((L) => L.words.length);
  const css = `
  #mband { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px; opacity:0;
           background:linear-gradient(180deg, rgba(3,7,15,0) 0%, rgba(3,7,15,0.46) 26%, rgba(5,9,19,0.66) 100%); }
  #mfline { position:absolute; left:${W / 2}px; top:${baseY - 1}px; width:${railW}px; height:1.5px; opacity:0;
            margin-left:-${Math.round(railW / 2)}px;
            background:linear-gradient(90deg, rgba(${SILV},0) 0%, rgba(${SILV},0.8) 20%, rgba(${SILVH},0.9) 50%, rgba(${SILV},0.8) 80%, rgba(${SILV},0) 100%); }
  #mglint { position:absolute; left:0; top:${baseY - 4}px; width:130px; height:6px; opacity:0;
            filter:blur(2px);
            background:linear-gradient(90deg, rgba(${SILVH},0) 0%, rgba(${SILVH},0.9) 50%, rgba(${SILVH},0) 100%); }
  .mline { position:absolute; left:${W / 2}px; top:${baseY + 1}px; white-space:nowrap;
           font-family:'${dna.fonts.body}', serif; font-weight:${b.weight || 400}; font-size:${fontPx}px;
           line-height:1; letter-spacing:${b.letterSpacing || "0.02em"}; color:${INK}; }
  .mrow  { white-space:nowrap; }
  .mfaces { position:relative; }
  .mfaces .w { text-shadow:0 2px 10px rgba(4,10,22,0.85), 0 0 18px rgba(${HALO},0.18); }
  .mfaces .w.em { color:${dna.palette.em || INK}; }
  .mmirs { position:absolute; left:0; top:${Math.round(fontPx * 0.72)}px; opacity:${mirOpacity}; color:${MIR};
           -webkit-mask-image:linear-gradient(180deg, rgba(0,0,0,0) 8%, rgba(0,0,0,0.95) 80%);
           mask-image:linear-gradient(180deg, rgba(0,0,0,0) 8%, rgba(0,0,0,0.95) 80%); }
  .mline .w { display:inline-block; opacity:0; margin-right:0.30em; }
  .mline .w:last-child { margin-right:0; }`;
  const html =
    `      <div id="mwrap">
        <div id="mband"></div>
        <div id="mfline"></div>
        <div id="mglint"></div>` +
    lineData.map((L) => `        <div class="mline" id="${L.id}"></div>`).join("\n") +
    `\n      </div>`;
  const glintIn = b.glintAt ?? 2.32;
  const glintDur = Math.min(0.95, Math.max(0.4, DUR - glintIn - 0.4));
  const js = `
  // ---- body paradigm: MIRRORRAIL (words rise out of their reflection; sink back in) ----
  const MRLINES = ${J(lineData)};
  const mirOp = ${mirOpacity};
  MRLINES.forEach((L) => {
    const line = document.getElementById(L.id);
    const faces = document.createElement("div"); faces.className = "mrow mfaces";
    const mirs  = document.createElement("div"); mirs.className  = "mrow mmirs";
    L.words.forEach(([txt,, em]) => {
      const a = document.createElement("span"); a.className = "w" + (em ? " em" : ""); a.textContent = txt;
      const b2 = document.createElement("span"); b2.className = "w"; b2.textContent = txt;
      faces.appendChild(a); mirs.appendChild(b2);
    });
    line.appendChild(faces); line.appendChild(mirs);
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    gsap.set(mirs, { scaleY: -1, transformOrigin: "50% 50%" });
    gsap.set(faces, { transformOrigin: "50% 100%" });
    tl.set(line, { opacity: 1 }, L.in);

    L.words.forEach(([txt, st, em], wi) => {
      const fw = faces.children[wi], mw = mirs.children[wi];
      // word + its reflection move apart from the floor line, opacity full in 2 frames
      tl.fromTo([fw, mw], { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, st);
      tl.fromTo(fw, { y: 14, filter: "blur(1.6px)" }, { y: 0, filter: "blur(0px)", duration: 0.30, ease: "power2.out" }, st);
      tl.fromTo(mw, { y: 14, filter: "blur(1.6px)" }, { y: 0, filter: "blur(0px)", duration: 0.30, ease: "power2.out" }, st);
      if (em) {
        // EMPHASIS: only the reflection ripples — the word stays perfectly still
        tl.to(mw, { keyframes: { scaleY: [1, 1.07, 0.985, 1],
                                 filter: ["blur(0px)","blur(1.8px)","blur(0.6px)","blur(0px)"] },
                    duration: 0.55, ease: "sine.inOut" }, st + 0.30);
      }
    });

    // hold life: the line's reflection wavers faintly (the face row never moves)
    const t0 = L.words[0][1] + 0.45, D = Math.max(0.4, L.out - 0.05 - t0);
    const N = Math.max(6, Math.round(D / (2 * F))), v = [];
    const sd = (L.id.charCodeAt(2) - 47) * 1.3;
    for (let k = 0; k <= N; k++) { const t = k / N * D; v.push(mirOp - 0.015 + 0.035 * Math.sin(6.283 * 0.55 * t + sd)); }
    tl.to(mirs, { keyframes: { opacity: v }, duration: D, ease: "none" }, t0);

    // EXIT: the line sinks into the mirror (apex motif, low amplitude)
    tl.to(faces, { y: 10,  scaleY: 0.18,  opacity: 0, duration: 0.13, ease: "power2.in" }, L.out);
    tl.to(mirs,  { y: -10, scaleY: -0.15, opacity: 0, duration: 0.13, ease: "power2.in" }, L.out);
    tl.set(line, { display: "none" }, L.out + 0.16);
  });

  // ===== furniture: black-glass band + silver floor hairline =====
  tl.fromTo("#mband",  { opacity: 0 }, { opacity: 1, duration: 0.40, ease: "power1.out" }, 0.08);
  tl.fromTo("#mfline", { opacity: 0, scaleX: 0 }, { opacity: 0.55, scaleX: 1, duration: 0.50, ease: "expo.out" }, 0.12);
  tl.to("#mband",  { opacity: 0.55, duration: 0.18, ease: "power1.in" }, ${(DUR - 0.16).toFixed(3)});
  tl.to("#mfline", { opacity: 0,    duration: 0.16, ease: "power1.in" }, ${(DUR - 0.14).toFixed(3)});

  // a glint travels the floor line during the silence (the mirror is alive)
  tl.fromTo("#mglint", { x: ${Math.round(W / 2 - railW / 2 + 60)} }, { x: ${Math.round(W / 2 + railW / 2 - 60)}, duration: ${glintDur.toFixed(2)}, ease: "power1.inOut" }, ${glintIn.toFixed(2)});
  tl.to("#mglint", { keyframes: { opacity: [0, 0.5, 0.42, 0] }, duration: ${glintDur.toFixed(2)}, ease: "none" }, ${glintIn.toFixed(2)});
${
  !heroInline && !HEROLESS && b.yield
    ? `
  // rail yields while the apex lands (hierarchy rule)
  tl.to("#mwrap", { opacity: ${b.yield.dim}, duration: 0.20, ease: "power1.out" }, ${Math.max(heroIn - (b.yield.pre || 0.2), 0.1).toFixed(3)});
  tl.to("#mwrap", { opacity: 1.0,           duration: 0.30, ease: "power1.out" }, ${(heroIn + (b.yield.post || 0.9)).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function paradigmRacingrail() {
  // RACINGRAIL: a night-circuit lower third. Words DRIFT IN along a low track
  // line with velocity streaks — the core slides x:-40→0 (0.14s expo.out, skew
  // settling) with two trailing accent echo copies that lag and burn off (the
  // doppler motif at low amplitude). Idle = ~1° forward-lean breathing until the
  // line exits. Emphasis words gear-shift SNAP (scale 1.2→1 back.out) and sweep
  // a small tachometer arc up into the redline. Furniture: a track line draws on
  // L→R with seeded ticks + leading chevrons. Exit: the line whips off RIGHT with
  // a motion smear (the apex's exit verb, at body scale). Yields while the apex
  // lands. All transcript words live ON the track line (body-stability law).
  const b = dna.body;
  const INK = dna.palette.body || "#f4f2ee",
    HOT = dna.palette.accent || dna.palette.hot || "#ff6a2b";
  const fontPx = b.fontPx || 50;
  const trackY = b.trackY ?? H - (b.bottomPx ?? 71);
  const trackLeft = b.trackLeft ?? 120;
  const trackW = b.trackW ?? W - 2 * trackLeft;
  const ticksX = b.ticksX || [220, 420, 620, 820, 1020];
  const lineData = LINES.map((L) => ({
    id: "rr" + L.id,
    in: +L.in.toFixed(3),
    out: +L.out.toFixed(3),
    words: L.words.map((w) => [w.display, +w.start.toFixed(3), w.minor ? 1 : 0]),
  }));
  const css = `
  #track { position:absolute; left:${trackLeft}px; top:${trackY}px; width:${trackW}px; height:2px; opacity:0;
           background: linear-gradient(90deg, ${hexA(INK, 0)} 0%, ${hexA(INK, 0.8)} 10%,
                       ${hexA(INK, 0.8)} 90%, ${hexA(INK, 0)} 100%); }
  .tick { position:absolute; top:${trackY - 3}px; width:2px; height:8px; background:${INK}; opacity:0; }
  .chev { position:absolute; top:${trackY - 7}px; width:16px; height:5px; background:${HOT}; opacity:0; }
  #linepulse { position:absolute; left:0px; top:${trackY - 2}px; width:110px; height:4px; opacity:0;
               background: linear-gradient(90deg, ${hexA(HOT, 0)} 0%, ${hexA(HOT, 0.95, 1.4)} 60%, rgba(255,236,214,1) 100%);
               filter: blur(0.5px); }
  .rrl { position:absolute; left:${W / 2}px; top:${trackY - 9}px; opacity:0; white-space:nowrap;
         font-family:'${dna.fonts.body}', sans-serif; font-style:italic; font-weight:${b.weight || 600};
         font-size:${fontPx}px; line-height:1; letter-spacing:${b.letterSpacing || "0.04em"}; color:${INK};
         text-shadow: ${b.glow || "0 2px 10px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.6)"}; }
  .rrl .w { display:inline-block; position:relative; opacity:0; margin-right:0.32em; }
  .rrl .w.em { color:${HOT};
         text-shadow: 0 0 14px ${hexA(HOT, 0.45)}, 0 2px 10px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.6); }
  .rrl .w .e { position:absolute; left:0; top:0; color:${HOT}; opacity:0; text-shadow:none; }
  .rrl .w .c { position:relative; display:inline-block; }
  .tach { position:absolute; left:50%; top:-48px; width:76px; height:48px;
          transform:translateX(-50%); opacity:0; }`;
  const html =
    `      <div id="track"></div>\n      <div id="linepulse"></div>\n` +
    lineData.map((L) => `      <div class="rrl" id="${L.id}"></div>`).join("\n");
  const js = `
  // ---- body paradigm: RACINGRAIL (velocity-streak drift-in on a track line) ----
  const rrnd = mulberry32(${b.seed || 2026});
  const HOT = ${J(HOT)};
  const stage = document.getElementById("stage");

  // furniture: track line draws on, ticks + leading chevrons
  gsap.set("#track", { transformOrigin: "0% 50%" });
  tl.set("#track", { opacity: 0.75 }, 0.10);
  tl.fromTo("#track", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, 0.10);
  ${J(ticksX)}.forEach((x, i) => {
    const el = document.createElement("div");
    el.className = "tick"; el.style.left = x + "px"; stage.appendChild(el);
    tl.set(el, { opacity: 0.28 }, 0.22 + i * 0.05);
  });
  for (let i = 0; i < 3; i++) {
    const el = document.createElement("div");
    el.className = "chev"; el.style.left = (${trackLeft + 12} + i * 22) + "px"; stage.appendChild(el);
    gsap.set(el, { skewX: -28 });
    tl.set(el, { opacity: 0.85 }, 0.18 + i * 0.05);
    tl.fromTo(el, { x: -16 }, { x: 0, duration: 0.18, ease: "expo.out" }, 0.18 + i * 0.05);
  }

  function addTach(w, st, fadeAt) {
    const div = document.createElement("div");
    div.className = "tach";
    div.innerHTML =
      '<svg viewBox="0 0 76 48" width="76" height="48">' +
      '<path class="tbg" d="M8 42 A 30 30 0 0 1 68 42" stroke="' + ${J(hexA(INK, 0.3))} + '" stroke-width="3" fill="none"/>' +
      '<path class="tfg" d="M8 42 A 30 30 0 0 1 68 42" stroke="' + HOT + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
      '</svg>';
    w.appendChild(div);
    const fg = div.querySelector(".tfg");
    const L = fg.getTotalLength();
    gsap.set(fg, { attr: { "stroke-dasharray": L, "stroke-dashoffset": L } });
    tl.set(div, { opacity: 1 }, st + 0.02);
    tl.to(fg, { attr: { "stroke-dashoffset": L * 0.14 }, duration: 0.2, ease: "expo.out" }, st + 0.04);
    tl.set(fg, { attr: { stroke: "#ffe2cf" } }, st + 0.24);   // needle kiss into the redline
    tl.set(fg, { attr: { stroke: HOT } }, st + 0.29);
    tl.to(div, { opacity: 0, duration: 0.22 }, fadeAt);
  }

  const RRAIL = ${J(lineData)};
  RRAIL.forEach((L) => {
    const line = document.getElementById(L.id);
    L.words.forEach(([txt,,emph]) => {
      const w = document.createElement("span");
      w.className = "w" + (emph ? " em" : "");
      w.innerHTML = '<span class="e e2"></span><span class="e e1"></span><span class="c"></span>';
      w.querySelector(".e2").textContent = txt;
      w.querySelector(".e1").textContent = txt;
      w.querySelector(".c").textContent = txt;
      line.appendChild(w);
    });
    gsap.set(line, { xPercent: -50, yPercent: -100 });
    tl.set(line, { opacity: 1 }, L.words[0][1] - 0.02);
    const XO = L.out - 0.17;

    L.words.forEach(([txt, st, emph], wi) => {
      const w = line.children[wi];
      const c = w.querySelector(".c"), e1 = w.querySelector(".e1"), e2 = w.querySelector(".e2");
      // velocity-streak entrance — the doppler motif at low amplitude
      tl.set(w, { opacity: 1 }, st);
      tl.fromTo(c, { x: -40, skewX: -8, filter: "blur(2px)" },
                { x: 0, skewX: 0, filter: "blur(0px)", duration: 0.14, ease: "expo.out" }, st);
      tl.fromTo(e1, { x: -58, skewX: -8, opacity: 0.15 },
                { x: -6, duration: 0.20, ease: "expo.out" }, st);
      tl.to(e1, { opacity: 0, duration: 0.12 }, st + 0.18);
      tl.fromTo(e2, { x: -76, skewX: -8, opacity: 0.08 },
                { x: -12, duration: 0.26, ease: "expo.out" }, st);
      tl.to(e2, { opacity: 0, duration: 0.12 }, st + 0.24);
      if (emph) {
        // gear-shift snap + tach sweep
        tl.fromTo(w, { scale: ${b.emScale || 1.2}, transformOrigin: "50% 85%" },
                  { scale: 1, duration: 0.26, ease: "back.out(2.2)" }, st + 0.02);
        addTach(w, st, Math.min(st + 0.66, XO - 0.02));
      }
    });

    // idle: ~1° forward-lean breathing until the line exits
    const leanStart = L.words[L.words.length - 1][1] + 0.32;
    const leanDur = XO - leanStart;
    if (leanDur > 0.3) {
      tl.to(line, { keyframes: { skewX: [0, -1.1, -0.3, -1.2, 0] },
                    duration: leanDur, ease: "none" }, leanStart);
    }

    // exit: whip off right with smear
    tl.to(line, { x: 120, scaleX: 1.4, opacity: 0, duration: 0.12, ease: "power2.in" }, XO);
    tl.to(line, { filter: "blur(6px)", duration: 0.12, ease: "power2.in" }, XO);
    tl.set(line, { display: "none" }, Math.min(XO + 0.14, ${(DUR - 0.02).toFixed(3)}));
  });

  // track line fades with the clip end
  tl.to("#track", { opacity: 0.3, duration: 0.3 }, ${(DUR - 0.34).toFixed(3)});
${
  b.yield && !heroInline && !HEROLESS
    ? `  // rail yields while the apex lands (hierarchy rule): dim only the line that
  // is IN during the apex window, never running into its exit.
  RRAIL.forEach((L) => {
    if (L.in < ${heroIn.toFixed(3)} + 0.9 && L.out > ${heroIn.toFixed(3)} - 0.3) {
      const XO2 = L.out - 0.17;
      const dimT = Math.max(${(heroIn - (b.yield.pre || 0.2)).toFixed(3)}, L.in + 0.05);
      if (XO2 > dimT + 0.25) {
        tl.to("#" + L.id, { opacity: ${b.yield.dim}, duration: 0.15 }, dimT);
        const resT = ${(heroIn + (b.yield.post || 0.9)).toFixed(3)};
        if (resT + 0.3 < XO2) tl.to("#" + L.id, { opacity: 1, duration: 0.25 }, resT);
      }
    }
  });`
    : ""
}`;
  return { css, html, js };
}

const PARADIGMS = {
  racingrail: paradigmRacingrail,
  seancerail: paradigmSeancerail,
  columnmag: paradigmColumnmag,
  rail: paradigmRail,
  chyronrail: paradigmChyronrail,
  panel: paradigmPanel,
  poem: paradigmPoem,
  takeover: paradigmTakeover,
  lastpage: paradigmLastpage,
  flaprail: paradigmFlaprail,
  ledboard: paradigmLedboard,
  vhsrail: paradigmVhsrail,
  hudrail: paradigmHudrail,
  carbonstrip: paradigmCarbonstrip,
  laserrail: paradigmLaserrail,
  stormrail: paradigmStormrail,
  holorail: paradigmHolorail,
  planktonrail: paradigmPlanktonrail,
  sheenrail: paradigmSheenrail,
  scoperail: paradigmScoperail,
  paperrail: paradigmPaperrail,
  popuprail: paradigmPopuprail,
  chalkrail: paradigmChalkrail,
  markerrail: paradigmMarkerrail,
  brushrail: paradigmBrushrail,
  inkrail: paradigmInkrail,
  ransomrail: paradigmRansomrail,
  tickerrail: paradigmTickerrail,
  draftrail: paradigmDraftrail,
  beamrail: paradigmBeamrail,
  glassrail: paradigmGlassrail,
  magnetrail: paradigmMagnetrail,
  starrail: paradigmStarrail,
  mirrorrail: paradigmMirrorrail,
  leatherrail: paradigmLeatherrail,
};

// NOTE: no shipping theme selects `cpslam` — kept as a documented, ready-to-use porting option.
function setpieceCpslam() {
  // CP-language EMBED climax: acid-yellow word slams in BEHIND the subject with
  // REAL notch cuts (SVG mask = true transparency over footage), a chromatic
  // split that settles to a PERMANENT registration error, seeded glitch ticks,
  // and a glitch-out exit. The frame stays footage — the word is set dressing.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const YEL = dna.palette.body || "#FCEE0A",
    CYN = "#00F0FF",
    RED = "#FF003C";
  const srnd = (() => {
    let a = p.seed || 2077;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const DISP = heroText.toUpperCase(),
    hpx = HG.fontPx;
  const halfW = HG.halfW || (DISP.length * 0.56 * hpx) / 2;
  const BW = Math.round(halfW * 2 + 140),
    BH = Math.round(hpx * 1.5);
  const CX = BW - 80 > W ? W / 2 : Math.max(BW / 2 - 40, Math.min(W - BW / 2 + 40, HG.x)),
    CY = HG.y;
  // seeded diagonal cuts through the letter band (precision is not the point —
  // the cuts read as stencil damage wherever they land)
  const nN = Math.max(2, Math.floor(DISP.length / 2.2));
  const used = [];
  while (used.length < nN) {
    const i = Math.floor(srnd() * DISP.length);
    if (!used.includes(i)) used.push(i);
  }
  const notches = used
    .map((i, k) => {
      const cx = BW / 2 - halfW + (i + 0.5) * 0.56 * hpx + (srnd() - 0.5) * 8;
      const cy = BH / 2 + (k % 2 ? 0.24 : -0.27) * hpx + (srnd() - 0.5) * 10;
      return `<rect x="${(cx - hpx * 0.12).toFixed(0)}" y="${(cy - hpx * 0.038).toFixed(0)}" width="${(hpx * 0.24).toFixed(0)}" height="${(hpx * 0.076).toFixed(0)}" fill="black" transform="rotate(-45 ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
    })
    .join("\n            ");
  const lay = (id, fill) =>
    `<g id="${id}"><rect x="0" y="0" width="${BW}" height="${BH}" fill="${fill}" mask="url(#cpm)"/></g>`;
  const css = `
  #cpband { position:absolute; left:0; top:-80px; width:100%; height:70px; opacity:0;
            background: linear-gradient(180deg, rgba(0,240,255,0) 0%, rgba(0,240,255,0.4) 50%, rgba(0,240,255,0) 100%); }
  #cps { position:absolute; left:${CX}px; top:${CY}px; width:0; height:0; opacity:0; }
  #cpsW { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
          filter: drop-shadow(0 4px 18px rgba(0,0,0,0.5)); }
  #cpkana { position:absolute; left:0; top:-${Math.round(hpx * 0.82)}px; transform:translate(-50%,-50%);
            font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif; font-weight:600;
            font-size:20px; letter-spacing:0.5em; text-indent:0.5em; color:${YEL}; opacity:0;
            white-space:nowrap; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }`;
  const html = `      <div id="cpband"></div>
      <div id="cps">
        <svg id="cpsW" width="${BW}" height="${BH}" viewBox="0 0 ${BW} ${BH}">
          <defs><mask id="cpm">
            <text x="${BW / 2}" y="${BH / 2}" text-anchor="middle" dominant-baseline="central"
                  font-family="'${dna.fonts.hero}', sans-serif" font-size="${hpx}"
                  letter-spacing="${(hpx * 0.04).toFixed(1)}" fill="white">${esc(DISP)}</text>
            ${notches}
          </mask></defs>
          ${lay("cpC", CYN)}
          ${lay("cpR", RED)}
          ${lay("cpY", YEL)}
        </svg>
        <div id="cpkana">${esc(p.kana || "CYBERPUNK")}</div>
      </div>`;
  // a climax is an EVENT: on long clips holding to clip-end turns it into
  // wallpaper. Default hold ~2.6s after the slam; hero.exitAt / params.hold override.
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.2, I + (p.hold ?? 2.6));
  const js = `
  // ---- setpiece: CPSLAM (band charge -> crush slam -> permanent registration -> glitch-out) ----
  const I = ${I.toFixed(3)};
  const crnd = mulberry32(${p.seed || 2077});
  tl.set("#cpband", { opacity: 1 }, I - 0.35);
  tl.fromTo("#cpband", { y: 0 }, { y: ${H + 160}, duration: 0.36, ease: "power1.in" }, I - 0.35);
  tl.set("#cpband", { opacity: 0 }, I + 0.01);
  // crush slam (weighted), chromatic layers split wide on impact
  tl.set("#cps", { opacity: 1 }, I - 0.04);
  tl.fromTo("#cpsW", { scale: 2.6, filter: "blur(9px) brightness(2.2) drop-shadow(0 4px 18px rgba(0,0,0,0.5))" },
    { scale: 1, filter: "blur(0px) brightness(1) drop-shadow(0 4px 18px rgba(0,0,0,0.5))", duration: 0.11, ease: "power4.in" }, I - 0.04);
  tl.set("#cpsW", { scaleX: 1.09, scaleY: 0.93 }, I + 0.08);
  tl.to("#cpsW", { scaleX: 1, scaleY: 1, duration: 0.46, ease: "elastic.out(1.05, 0.36)" }, I + 0.16);
  // SVG <g> children move via attr.transform ONLY (banned: gsap x/y component
  // props on SVG children — getBBox parse path). Frame-quantized step chain
  // replaces the 0.16s recoil tween (identical on screen at 24fps).
  const RG = (dx, dy, at) => { tl.set("#cpC", { attr: { transform: "translate(" + dx + " " + dy + ")" } }, at); tl.set("#cpR", { attr: { transform: "translate(" + (-dx) + " " + (-dy) + ")" } }, at); };
  RG(9, 0, I - 0.04);
  RG(6, 0, I + 0.02); RG(3, 0, I + 0.02 + F); RG(1, 0, I + 0.02 + 2 * F); RG(0, 0, I + 0.02 + 3 * F);
  // ...then the print settles WRONG: permanent registration error (the look)
  RG(2.5, -1, I + 0.3);
  tl.fromTo("#cpkana", { opacity: 0 }, { opacity: 0.92, duration: 0.18 }, I + 0.22);
  // living word: seeded glitch ticks (registration jolts / 1f slips)
  let gt = I + 0.62;
  while (gt < ${EX.toFixed(3)} - 0.25) {
    if (crnd() < 0.55) {
      RG(8, -1, gt); RG(2.5, -1, gt + F);
    } else {
      tl.set("#cps", { x: (crnd() - 0.5) * 10 }, gt);
      tl.set("#cps", { x: 0 }, gt + F);
    }
    gt += 0.45 + crnd() * 0.6;
  }
  tl.to("#cpsW", { scale: 1.035, duration: 1.1, ease: "power1.inOut" }, I + 0.72);
  // EXIT: glitch-out
  const E = ${EX.toFixed(3)};
  tl.set("#cpkana", { opacity: 0 }, E);
  RG(15, -1, E);
  tl.set("#cps", { x: -7 }, E + F);
  tl.set("#cps", { opacity: 0, display: "none" }, E + 2 * F);`;
  return { css, html, js };
}

function setpieceCoverword() {
  // CP2077 COVER-LETTERFORM slam, precision pass: the spoken apex word set in
  // the replica typeface of the official mark (assets/brand/CyberpunkReplica.ttf
  // — lowercase glyphs carry the logo's actual brush chops, blade terminals and
  // spikes), in logo case (First-upper). The setpiece adds only what the FONT
  // does not carry: the solid cyan duplicate offset down-left, the baseline
  // streak + cyan pixel debris, the circuit trace off the tail, and the
  // tear-in/living-print/tear-out choreography. No synthetic letter surgery.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const YEL = dna.palette.hot || "#FCEE0A",
    CYN = dna.palette.accent || "#52BEDC";
  const srnd = (() => {
    let a = p.seed || 77;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const CPM = JSON.parse(
    fs.readFileSync(path.join(SKILL, "assets/brand/cyberpunk-widths.json"), "utf8"),
  );
  const fontB64 = fs
    .readFileSync(path.join(SKILL, "assets/brand/CyberpunkReplica.ttf"))
    .toString("base64");
  const DISP = HG.coverDisp || heroText[0].toUpperCase() + heroText.slice(1).toLowerCase();
  const hpx = HG.fontPx;
  const em =
    HG.coverEm ||
    [...DISP].reduce((a, c) => a + (CPM.widths[c] || 0.7), 0) + 0.01 * (DISP.length - 1);
  const INK = HG.coverInk || { inkTop: 0.5, inkBot: -0.25, inkH: 0.75 };
  const IH = INK.inkH * hpx; // visual ink height (px)
  const Wd = em * hpx;
  const BW = Math.round(Wd + 2.4 * hpx),
    BH = Math.round(IH + 0.7 * hpx);
  // baseline placed so the measured ink box is vertically centered
  const baseY = Math.round(BH / 2 + ((INK.inkTop + INK.inkBot) / 2) * hpx);
  const feetY = Math.round(baseY - INK.inkBot * hpx); // lowest ink (px, y-down)
  const x0 = Math.round((BW - Wd) / 2),
    x1 = Math.round(x0 + Wd);
  const CX = BW - 120 > W ? W / 2 : Math.max(BW / 2 - 60, Math.min(W - BW / 2 + 60, HG.x)),
    CY = HG.y;
  const P = (pts, fill) =>
    `<polygon points="${pts.map((q) => q[0].toFixed(0) + "," + q[1].toFixed(0)).join(" ")}" fill="${fill}"/>`;
  // baseline streak: thin brush drag just under the glyph feet, pointed right
  // tip past the tail (the font's own C/K blades carry the rest of the energy)
  let extras = "";
  // streak band MERGES with the glyph feet (official: letters melt into it)
  const sT = feetY - 0.075 * IH,
    sB = feetY + 0.012 * IH;
  extras += P(
    [
      [x0 - 0.16 * hpx, sT + 2],
      [x1 + 0.1 * hpx, sT],
      [x1 + 0.55 * hpx, sB - 1],
      [x0 - 0.05 * hpx, sB],
    ],
    "white",
  );
  let cuts = "";
  for (let k = 0; k < 3; k++) {
    const gx = x0 + (0.1 + srnd() * 0.8) * Wd,
      gw = (0.05 + srnd() * 0.1) * hpx;
    cuts += P(
      [
        [gx, sT - 1],
        [gx + gw, sT - 1],
        [gx + gw, sB + 1],
        [gx, sB + 1],
      ],
      "black",
    );
  }
  // cyan pixel debris along the streak
  let debris = "";
  for (let k = 0; k < 8; k++) {
    const dx = x0 - 0.3 * hpx + srnd() * (Wd + 0.9 * hpx),
      dw = (0.06 + srnd() * 0.3) * hpx;
    const dy = sT - 2 + srnd() * (sB - sT + 4);
    debris += `<rect x="${dx.toFixed(0)}" y="${dy.toFixed(0)}" width="${dw.toFixed(0)}" height="${(1.5 + srnd() * 2.5).toFixed(1)}" fill="${CYN}" opacity="0.85"/>`;
  }
  // circuit trace off the tail (the official mark's cyan trace language)
  const tx = x1 + 0.25 * hpx,
    ty = feetY + 0.14 * IH;
  const trace = `<g id="cwT" opacity="0">
      <path d="M ${x0 + Wd * 0.45} ${ty} H ${tx} l ${0.14 * hpx} ${0.07 * hpx} h ${0.3 * hpx}" stroke="${CYN}" stroke-width="2" fill="none"/>
      <circle cx="${(tx + 0.05 * hpx).toFixed(0)}" cy="${ty.toFixed(0)}" r="3.5" fill="none" stroke="${CYN}" stroke-width="2"/>
      <circle cx="${(tx + 0.44 * hpx).toFixed(0)}" cy="${(ty + 0.07 * hpx).toFixed(0)}" r="3.5" fill="${CYN}"/>
    </g>`;
  const bnd = [
    [0, 0.42],
    [0.42, 0.6],
    [0.6, 1],
  ];
  const clipDefs = bnd
    .map(
      (b, i) =>
        `<clipPath id="cwb${i}"><rect x="-60" y="${(b[0] * BH).toFixed(0)}" width="${BW + 120}" height="${((b[1] - b[0]) * BH).toFixed(0)}"/></clipPath>`,
    )
    .join("");
  const layer = (fill) =>
    `<rect x="0" y="0" width="${BW}" height="${BH}" fill="${fill}" mask="url(#cwm)"/>`;
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.2, I + (p.hold ?? 2.6));
  const css = `
  @font-face { font-family:'CPReplica'; src: url(data:font/ttf;base64,${fontB64}) format('truetype'); font-display: block; }
  #cw { position:absolute; left:${CX}px; top:${CY}px; width:0; height:0; opacity:0; }
  #cwW { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
         filter: drop-shadow(0 5px 20px rgba(0,0,0,0.5)); }`;
  const html = `      <div id="cw">
        <svg id="cwW" width="${BW}" height="${BH}" viewBox="0 0 ${BW} ${BH}" style="overflow:visible">
          <defs>
            <mask id="cwm">
              <text x="${x0}" y="${baseY}" font-family="'CPReplica'" font-size="${hpx}"
                    letter-spacing="${(hpx * 0.01).toFixed(1)}" fill="white">${esc(DISP)}</text>
              ${extras}
              ${cuts}
            </mask>
            ${clipDefs}
          </defs>
          <g id="cwC" transform="translate(-7 8)">${layer(CYN)}</g>
          ${bnd.map((_, i) => `<g clip-path="url(#cwb${i})"><g id="cwY${i}">${layer(YEL)}</g></g>`).join("\n          ")}
          <g id="cwD">${debris}</g>
          ${trace}
        </svg>
      </div>`;
  const js = `
  // ---- setpiece: COVERWORD v2 (replica letterforms; tear-in -> living print -> tear-out) ----
  const I = ${I.toFixed(3)};
  const wrnd = mulberry32(${p.seed || 77});
  const TB = (sel, dx, dy, at) => tl.set(sel, { attr: { transform: "translate(" + dx + " " + (dy || 0) + ")" } }, at);
  // corrupted boot-flick of the whole lockup during the charge
  tl.set("#cw", { opacity: 0.35, filter: "saturate(0) brightness(1.6)" }, I - 0.30);
  tl.set("#cw", { opacity: 0 }, I - 0.30 + F);
  tl.set("#cw", { opacity: 0.5, filter: "saturate(0) brightness(2)" }, I - 0.13);
  tl.set("#cw", { opacity: 0 }, I - 0.13 + F);
  // SLAM: crush in with slice displacement, snap into register
  tl.set("#cw", { opacity: 1, filter: "none" }, I - 0.02);
  tl.fromTo("#cwW", { scale: 2.4 }, { scale: 1, duration: 0.10, ease: "power4.in" }, I - 0.02);
  TB("#cwY0", -34, 0, I - 0.02); TB("#cwY1", 26, 0, I - 0.02); TB("#cwY2", -18, 0, I - 0.02);
  TB("#cwC", -44, 8, I - 0.02);
  tl.set("#cwD", { opacity: 0 }, I - 0.02);
  TB("#cwY0", 0, 0, I + 0.10); TB("#cwY1", 0, 0, I + 0.10); TB("#cwY2", 0, 0, I + 0.10);
  TB("#cwC", -7, 8, I + 0.10);
  tl.set("#cwW", { scaleX: 1.08, scaleY: 0.94 }, I + 0.10);
  tl.to("#cwW", { scaleX: 1, scaleY: 1, duration: 0.45, ease: "elastic.out(1.05, 0.38)" }, I + 0.16);
  tl.set("#cwD", { opacity: 1 }, I + 0.12);
  tl.set("#cwT", { opacity: 0.9 }, I + 0.34);
  // living print: seeded slice slips + cyan jolts
  let gt = I + 0.55;
  while (gt < ${EX.toFixed(3)} - 0.25) {
    const r = wrnd();
    if (r < 0.4) { const b = Math.floor(wrnd() * 3); TB("#cwY" + b, (wrnd() - 0.5) * 22, 0, gt); TB("#cwY" + b, 0, 0, gt + F); }
    else if (r < 0.7) { TB("#cwC", -16, 8, gt); TB("#cwC", -7, 8, gt + F); }
    else { tl.set("#cw", { x: (wrnd() - 0.5) * 9 }, gt); tl.set("#cw", { x: 0 }, gt + F); }
    gt += 0.4 + wrnd() * 0.55;
  }
  tl.to("#cwW", { scale: 1.04, duration: 1.1, ease: "power1.inOut" }, I + 0.66);
  // EXIT: tear cascade -> gone
  const E = ${EX.toFixed(3)};
  TB("#cwY0", 52, 0, E); TB("#cwY1", -38, 0, E); TB("#cwY2", 30, 0, E);
  TB("#cwC", -30, 8, E);
  tl.set("#cwT", { opacity: 0 }, E);
  tl.set("#cw", { opacity: 0.45 }, E + F);
  tl.set("#cw", { opacity: 0, display: "none" }, E + 2 * F);`;
  return { css, html, js };
}
function setpieceSettle() {
  const I = heroIn;
  const E = theme.hero.exitAt ?? Math.min(heroOut, DUR - 0.12);
  const ruleW = Math.round(2 * HG.halfW * 0.62);
  const holdDur = Math.max(0.4, E - I - 0.85);
  const css = `
  ${dna.plate.dim ? `#dimP { position:absolute; inset:0; opacity:0; background:#06080c; }` : ""}
  #stl { position:absolute; left:${HG.x}px; top:${HG.y}px; transform:translate(-50%,-50%); }
  #stl-w { font-family:'${dna.fonts.hero}', sans-serif; font-weight:700; font-size:${HG.fontPx}px;
           line-height:1; letter-spacing:0.01em; white-space:nowrap; color:${dna.palette.body};
           text-shadow: 0 2px 18px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.35); opacity:0; }
  #stl-rule { position:absolute; left:50%; bottom:-20px; transform:translateX(-50%);
              width:0; height:3px; border-radius:2px; background:${dna.palette.accent};
              opacity:0.85; box-shadow: 0 1px 8px rgba(0,0,0,0.4); }`;
  const html = `      ${dna.plate.dim ? `<div id="dimP"></div>` : ""}
      <div id="stl"><div id="stl-w">${heroDisplay.toUpperCase()}</div><div id="stl-rule"></div></div>`;
  const js = `
  // ---- setpiece: SETTLE (quiet blur-settle + accent underline; restraint IS the style) ----
  const I = ${I.toFixed(3)};
${
  dna.plate.dim
    ? `  tl.fromTo("#dimP", { opacity: 0 }, { opacity: ${dna.plate.dim}, duration: 0.35, ease: "power2.in" }, I - 0.3);
  tl.to("#dimP", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(E + 0.02).toFixed(3)});`
    : ""
}
  // opacity lands in ~2 frames; the transform settles separately (no ghost ramp)
  tl.fromTo("#stl-w", { opacity: 0 }, { opacity: 1, duration: 0.09, ease: "power1.out" }, I);
  tl.fromTo("#stl-w", { y: 14, scale: 1.05, filter: "blur(9px)" },
            { y: 0, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "power3.out" }, I);
  tl.fromTo("#stl-rule", { width: 0 }, { width: ${ruleW}, duration: 0.35, ease: "expo.out" }, I + 0.28);
  // hold life: one slow visible loom
  tl.to("#stl", { scale: 1.018, duration: ${holdDur.toFixed(2)}, ease: "power1.inOut" }, I + 0.6);
  // exit: soften and lift (asymmetric to the landing)
  tl.to("#stl-rule", { width: 0, opacity: 0, duration: 0.2, ease: "power2.in" }, ${(E - 0.05).toFixed(3)});
  tl.to("#stl-w", { filter: "blur(5px)", duration: 0.22, ease: "power1.in" }, ${(E - 0.02).toFixed(3)});
  tl.to("#stl", { opacity: 0, y: -10, duration: 0.24, ease: "power2.in" }, ${E.toFixed(3)});
  tl.set("#stl", { display: "none" }, ${(E + 0.26).toFixed(3)});`;
  return { css, html, js };
}
function setpieceFlapboard() {
  // SPLIT-FLAP DEPARTURES BOARD: floodlights swing on, the housing clacks down
  // behind the subject, one giant flap tile per char flip-cycles seeded wrong
  // glyphs then locks the real char left→right with clack rhythm; rule wipes,
  // status ticker types on; one tile re-flutters during the hold; tiles flip
  // to blank and the housing flips away.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const N = heroText.length;
  const gap = p.gap || 7;
  const tileW = HG.tileW,
    tileH = HG.tileH,
    fpx = HG.fontPx;
  const lockWin = p.lockWindow || 0.34;
  const AIN = I - 0.15;
  const lockEnd = I + lockWin;
  const E = heroOut;
  const headH = 34;
  const boardH = 10 + headH + tileH + 18;
  const boardW = HG.halfW * 2;
  const ruleW = Math.round(boardW - 43);
  const ruleY = Math.round(HG.y + boardH / 2 + 37);
  const tagW = Math.round((p.tag || "").length * 19);
  const flutterIdx = Math.min(N - 1, Math.floor(N * 0.6));
  const exit0 = E - ((N - 1) * 0.03 + 0.09);
  const css = `
  #dimF   { position:absolute; inset:0; opacity:0; background:#06080c; }
  #scrimF { position:absolute; inset:0; opacity:0;
            background: linear-gradient(180deg, rgba(5,7,11,0.72) 0%, rgba(5,7,11,0.3) 42%,
                        rgba(5,7,11,0) 68%); }
  #glowF  { position:absolute; inset:0; opacity:0;
            background: radial-gradient(46% 38% at ${((HG.x / W) * 100).toFixed(1)}% ${((HG.y / H) * 100).toFixed(1)}%, rgba(255,196,110,0.5) 0%,
                        rgba(255,160,60,0.16) 55%, rgba(0,0,0,0) 78%); }
  #persp { position:absolute; inset:0; perspective:950px; }
  #board { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; transform-origin:50% 0%;
           background: linear-gradient(180deg,#171B21 0%,#101319 100%);
           border-radius:8px; border:1px solid #353C47; border-top:3px solid ${dna.palette.hot};
           padding:10px 20px 18px;
           box-shadow: 0 18px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06); }
  #bhead { display:flex; justify-content:space-between; align-items:baseline; gap:40px;
           font-family:'${dna.fonts.tag}', sans-serif; font-weight:600; font-size:24px;
           letter-spacing:4px; color:${dna.palette.hot}; opacity:0.9; padding:0 4px 8px; }
  #bhead .r { color:#8A8F98; letter-spacing:3px; }
  #slots { display:flex; gap:${gap}px; }
  .atile { position:relative; width:${tileW}px; height:${tileH}px; perspective:620px;
           border-radius:4px; background:#0A0D11;
           box-shadow: inset 0 0 0 1px #1F242B, inset 0 5px 12px rgba(0,0,0,0.75); }
  .aflap { position:absolute; inset:0; transform-origin:50% 0%; backface-visibility:hidden;
           border-radius:4px; text-align:center;
           background: linear-gradient(180deg,#343A43 0%,#272C34 48%,#1A1E25 52%,#242931 100%);
           box-shadow: inset 0 0 0 1px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
           font-family:'${dna.fonts.hero}', sans-serif; font-size:${fpx}px; line-height:${tileH + 2}px;
           color:${dna.palette.boardBone || dna.palette.body};
           text-shadow: 0 4px 14px rgba(0,0,0,0.55); }
  .aflap::after { content:""; position:absolute; left:0; right:0; top:50%; height:2px;
                  margin-top:-1px; background:rgba(0,0,0,0.5); }
  .ac { position:absolute; inset:0; }
  .ac.wv { display:none; color:#C3C8D0; }
  .ac.rl { visibility:hidden; }
  #ruleF { position:absolute; left:${HG.x}px; top:${ruleY}px; width:${ruleW}px; height:3px;
           margin-left:-${Math.round(ruleW / 2)}px; background:${dna.palette.hot}; opacity:0; transform-origin:50% 50%;
           box-shadow: 0 0 12px ${dna.palette.hot}99; }
  #tagwrapF { position:absolute; left:${HG.x}px; top:${ruleY + 14}px; transform:translateX(-50%);
              overflow:hidden; white-space:nowrap; width:0; }
  #tagF { font-family:'${dna.fonts.tag}', sans-serif; font-weight:600; font-size:27px; letter-spacing:7px;
          color:${dna.palette.hot}; white-space:nowrap; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }`;
  const html = `      <div id="dimF"></div><div id="scrimF"></div><div id="glowF"></div>
      <div id="persp">
        <div id="board">
          <div id="bhead"><span>${esc(p.headerLeft || "★ DEPARTURES")}</span><span class="r">${esc(p.headerRight || "")}</span></div>
          <div id="slots"></div>
        </div>
      </div>
      <div id="ruleF"></div>
      ${p.tag ? `<div id="tagwrapF"><div id="tagF">${esc(p.tag)}</div></div>` : ""}`;
  const js = `
  // ---- setpiece: FLAPBOARD (housing clack → flip-cycle → lock left→right → board life) ----
  const I = ${I.toFixed(3)}, AIN = ${AIN.toFixed(3)}, LOCK0 = I, LSTEP = ${(lockWin / Math.max(1, N - 1)).toFixed(5)};
  const WORDB = ${J(heroText)}, BGLYPHS = ${J(p.glyphs || "ABCDEFGHIKLMNOPRSTUVXYZ0123456789")};
  const HOTB = ${J(dna.palette.hot)}, BONEB = ${J(dna.palette.boardBone || dna.palette.body)};
  const brnd = mulberry32(${p.seed || 8088});
  // scene reaction: floodlights swing onto the board
  tl.fromTo("#dimF",   { opacity: 0 }, { opacity: ${dna.plate.dim}, duration: 0.16, ease: "power2.in" }, AIN - 0.08);
  tl.fromTo("#scrimF", { opacity: 0 }, { opacity: ${dna.plate.charge}, duration: 0.16, ease: "power2.in" }, AIN - 0.08);
  tl.to("#dimF",   { opacity: ${(dna.plate.dim * 0.59).toFixed(2)}, duration: 0.8, ease: "power2.out" }, ${(lockEnd - 0.23).toFixed(3)});
  tl.to("#scrimF", { opacity: ${(dna.plate.charge * 0.61).toFixed(2)}, duration: 0.8, ease: "power2.out" }, ${(lockEnd - 0.23).toFixed(3)});
  tl.to(["#dimF", "#scrimF"], { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(E - 0.39).toFixed(3)});
  // build the flap tiles (one per char; spaces are blank tiles)
  const slots = document.getElementById("slots");
  const btiles = [];
  for (let i = 0; i < WORDB.length; i++) {
    const atile = document.createElement("div"); atile.className = "atile";
    if (WORDB[i] === " ") {
      atile.style.width = Math.round(${tileW} * 0.45) + "px";
      slots.appendChild(atile); btiles.push(null); continue;
    }
    const flap = document.createElement("div"); flap.className = "aflap";
    const n = 3 + Math.floor(brnd() * 3); // 3-5 seeded wrong chars
    const wrongs = [];
    for (let k = 0; k < n; k++) {
      const s = document.createElement("div"); s.className = "ac wv";
      s.textContent = BGLYPHS[Math.floor(brnd() * BGLYPHS.length)];
      flap.appendChild(s); wrongs.push(s);
    }
    const rl = document.createElement("div"); rl.className = "ac rl"; rl.textContent = WORDB[i];
    flap.appendChild(rl);
    atile.appendChild(flap); slots.appendChild(atile);
    btiles.push({ atile, flap, rl, wrongs, n });
  }
  gsap.set("#board", { xPercent: -50, yPercent: -50 });
  // housing clacks down (the flap motif at housing scale)
  tl.set("#board", { opacity: 1 }, AIN);
  tl.fromTo("#board", { rotationX: -52 }, { rotationX: 0, duration: 0.13, ease: "power3.in" }, AIN);
  tl.set("#board", { scaleX: 1.012, scaleY: 0.965 }, AIN + 0.13);
  tl.to("#board", { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1, 0.42)" }, AIN + 0.16);
  // flip-cycle wrong chars, lock left→right with clack rhythm
  btiles.forEach((T, i) => {
    if (!T) return;
    const Li = LOCK0 + i * LSTEP;
    const Si = AIN + 0.035 + i * 0.008;
    const cyc = (Li - Si) / T.n;
    tl.set(T.wrongs[0], { display: "block" }, AIN);
    tl.fromTo(T.flap, { rotationX: -85 }, { rotationX: 0, duration: cyc * 0.8, ease: "power1.in" }, Si);
    for (let k = 1; k < T.n; k++) {
      const c = Si + k * cyc;
      tl.set(T.wrongs[k - 1], { display: "none" }, c);
      tl.set(T.wrongs[k], { display: "block" }, c);
      tl.fromTo(T.flap, { rotationX: -85 }, { rotationX: 0, duration: cyc * 0.8, ease: "power1.in" }, c);
    }
    // LOCK: real char drops in, hot flash, squash, elastic settle, cool to bone
    tl.set(T.wrongs[T.n - 1], { display: "none" }, Li);
    tl.set(T.rl, { visibility: "visible" }, Li);
    tl.set(T.flap, { color: HOTB, filter: "brightness(2.1)" }, Li);
    tl.fromTo(T.flap, { rotationX: -90 }, { rotationX: 0, duration: 0.075, ease: "power2.in" }, Li);
    tl.set(T.atile, { scaleX: 1.05, scaleY: 0.92 }, Li + 0.075);
    tl.to(T.atile, { scaleX: 1, scaleY: 1, duration: 0.3, ease: "elastic.out(1, 0.38)" }, Li + 0.1);
    tl.to(T.flap, { color: BONEB, filter: "brightness(1)", duration: 0.45, ease: "power2.out" }, Li + 0.15);
  });
  // clack rhythm: baked y-jitter on the housing across the lock window
  tl.to("#board", { keyframes: { y: [0, 2, 0, 1.4, 0, 2, 0, 1.2, 0, 1.8, 0] },
                    duration: ${(lockWin + 0.08).toFixed(2)}, ease: "none" }, LOCK0 - 0.01);
  // lock-complete: the big clack (plate punch lands here)
  tl.set("#board", { scaleX: 1.03, scaleY: 0.96 }, ${lockEnd.toFixed(3)});
  tl.to("#board", { scaleX: 1, scaleY: 1, duration: 0.42, ease: "elastic.out(1, 0.4)" }, ${(lockEnd + 0.03).toFixed(3)});
  tl.fromTo("#glowF", { opacity: 0 }, { opacity: 0.85, duration: 0.12, ease: "power2.out" }, ${lockEnd.toFixed(3)});
  tl.to("#glowF", { keyframes: { opacity: [0.85, 0.55, 0.7, 0.45, 0.6, 0.42, 0.5] },
                    duration: ${Math.max(0.4, E - 0.49 - (lockEnd + 0.15)).toFixed(2)}, ease: "none" }, ${(lockEnd + 0.15).toFixed(3)});
  tl.fromTo("#ruleF", { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 0.3, ease: "expo.out" }, ${(lockEnd + 0.05).toFixed(3)});
${p.tag ? `  tl.to("#tagwrapF", { width: ${tagW}, duration: 0.4, ease: "steps(16)" }, ${(lockEnd + 0.11).toFixed(3)});` : ""}
  // hold life: loom + one mechanical re-flutter tic — boards do this
  tl.to("#board", { scaleX: 1.022, scaleY: 1.022, duration: ${Math.max(0.4, Math.min(1.0, exit0 - lockEnd - 0.55)).toFixed(2)}, ease: "power1.inOut" }, ${(lockEnd + 0.5).toFixed(3)});
  const T6 = btiles[${flutterIdx}];
  if (T6 && ${(lockEnd + 1.0).toFixed(3)} < ${(exit0 - 0.2).toFixed(3)}) {
    const ft = ${(lockEnd + 0.9).toFixed(3)};
    tl.set(T6.rl, { visibility: "hidden" }, ft);
    tl.set(T6.wrongs[0], { display: "block" }, ft);
    tl.fromTo(T6.flap, { rotationX: -70 }, { rotationX: 0, duration: 0.055, ease: "power1.in" }, ft);
    tl.set(T6.wrongs[0], { display: "none" }, ft + 0.06);
    tl.set(T6.rl, { visibility: "visible" }, ft + 0.06);
    tl.fromTo(T6.flap, { rotationX: -80 }, { rotationX: 0, duration: 0.06, ease: "power2.in" }, ft + 0.06);
  }
  // exit: tiles flip to blank (0→90) cascading, housing flips away
  tl.to("#glowF", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${(E - 0.49).toFixed(3)});
  tl.to("#ruleF", { scaleX: 0, opacity: 0, duration: 0.12, ease: "power2.in" }, ${(E - 0.44).toFixed(3)});
${p.tag ? `  tl.to("#tagwrapF", { width: 0, duration: 0.16, ease: "steps(8)" }, ${(E - 0.44).toFixed(3)});` : ""}
  btiles.forEach((T, i) => {
    if (!T) return;
    tl.to(T.flap, { rotationX: 90, duration: 0.085, ease: "power2.in" }, ${exit0.toFixed(3)} + i * 0.03);
  });
  tl.to("#board", { rotationX: -45, opacity: 0, duration: 0.13, ease: "power2.in" }, ${(E - 0.04).toFixed(3)});
  tl.set("#board", { display: "none" }, ${Math.min(E + 0.08, DUR - 0.015).toFixed(3)});`;
  return { css, html, js };
}

function setpieceLedwipe() {
  // TRANSIT LED BOARD: cool scrim + dim charge the room, a departure-board
  // panel EXPANDS upward (stepped paging motif), then the word lights
  // column-by-column via a L→R illumination wipe (clipPath steps) inside a
  // chasing LED-marquee border; PA "ding" = two brightness pulses; hold life =
  // glow breathe + LED dropouts; exit pages the word up out of the panel and
  // the panel collapses back down.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const C = I + (p.wipeDur || 0.3); // wipe completes = contact
  const E = heroOut;
  const panelW = HG.panelW,
    panelH = HG.panelH,
    fpx = HG.fontPx;
  const px = Math.round(HG.x - panelW / 2),
    py = Math.round(HG.y - panelH / 2);
  const spillW = panelW - 180,
    spillH = Math.round(panelH * 1.9);
  const exScroll = +(E - 0.72).toFixed(3);
  const wipeSteps = Math.max(8, Math.round(heroText.length * 1.4));
  const A = dna.palette.accent,
    HOT = dna.palette.hot,
    GRN = dna.palette.green || "#36e57a";
  // marquee dot lattice scales with the panel; chase runs until the exit
  const nTop = Math.max(10, Math.round(panelW / 45));
  const nSide = Math.max(2, Math.round((panelH - 19) / 52) - 1);
  const kMax = Math.max(4, Math.floor((exScroll - (I - 0.01)) / 0.1));
  const css = `
  #scrimL { position:absolute; inset:0; opacity:0;
            background: radial-gradient(120% 105% at 50% 40%, rgba(2,6,14,0) 30%, rgba(2,6,14,0.85) 100%); }
  #dimL { position:absolute; inset:0; opacity:0; background:#020409; }
  #spillL { position:absolute; left:${Math.round(HG.x - spillW / 2)}px; top:${Math.round(HG.y - spillH / 2)}px;
            width:${spillW}px; height:${spillH}px; opacity:0;
            background: radial-gradient(closest-side, ${A}4d, ${A}00 72%); }
  #apxL { position:absolute; left:${px}px; top:${py}px; width:${panelW}px; height:${panelH}px; opacity:0; }
  #panelL { position:absolute; inset:0; border-radius:8px;
            background-color: rgba(8,8,11,0.93);
            background-image: radial-gradient(${A}0e 1px, rgba(0,0,0,0) 1.4px);
            background-size: 7px 7px;
            border:2px solid ${A}4d;
            box-shadow: 0 18px 50px rgba(0,0,0,0.55), inset 0 0 70px ${A}0d; }
  .ldot { position:absolute; width:7px; height:7px; border-radius:50%;
          background:${A}; opacity:0.18; box-shadow:0 0 6px ${A}8c; }
  #ptagL, #gtagL { position:absolute; top:16px; font-family:'${dna.fonts.tag}', monospace; font-size:22px;
                   letter-spacing:0.18em; opacity:0; white-space:nowrap; }
  #ptagL { left:28px; color:${A}9e; }
  #gtagL { right:28px; color:${GRN}; text-shadow:0 0 8px ${GRN}80; }
  #panwinL { position:absolute; left:24px; right:24px; top:44px; bottom:18px; overflow:hidden; }
  #scrollL { position:absolute; inset:0; }
  #ghostL, #awordL { position:absolute; left:50%; top:50%;
                     font-family:'${dna.fonts.hero}', monospace; font-size:${fpx}px; line-height:1;
                     letter-spacing:0.05em; white-space:nowrap; }
  #ghostL { color:${A}; opacity:0; }
  #awordL { color:${A}; opacity:0;
            text-shadow: 0 0 18px ${A}8c, 0 0 2px ${HOT}cc; }`;
  const html = `      <div id="scrimL"></div><div id="dimL"></div><div id="spillL"></div>
      <div id="apxL">
        <div id="panelL">
          <div id="ptagL">${esc(p.headerLeft || "NOW ARRIVING ▸ 19:42")}</div>
          <div id="gtagL">${esc(p.headerRight || "GATE A4")}</div>
          <div id="panwinL">
            <div id="scrollL">
              <div id="ghostL">${esc(heroText)}</div>
              <div id="awordL">${esc(heroText)}</div>
            </div>
          </div>
        </div>
      </div>`;
  const js = `
  // ---- setpiece: LEDWIPE (panel expands → L→R illumination wipe → PA ding → page-up exit) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)};
  gsap.set("#panelL", { transformOrigin: "50% 100%", scaleY: 0 });
  gsap.set(["#ghostL", "#awordL"], { xPercent: -50, yPercent: -50 });

  // ===== scene charge / release =====
  tl.fromTo("#scrimL", { opacity: 0 }, { opacity: ${dna.plate.charge}, duration: 0.30, ease: "power2.in" }, I - 0.31);
  tl.fromTo("#dimL",   { opacity: 0 }, { opacity: ${dna.plate.dim}, duration: 0.25, ease: "power2.in" }, I - 0.25);
  tl.fromTo("#spillL", { opacity: 0 }, { opacity: 0.45, duration: 0.40, ease: "power2.out" }, I + 0.05);
  tl.to("#spillL", { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(E - 0.54).toFixed(3)});
  tl.to(["#scrimL", "#dimL"], { opacity: 0, duration: 0.40, ease: "power1.in" }, ${(E - 0.44).toFixed(3)});

  // ===== board expands UPWARD (stepped paging motif, apex scale) =====
  tl.set("#apxL", { opacity: 1 }, I - 0.26);
  tl.to("#panelL", { scaleY: 1, duration: 0.20, ease: "steps(6)" }, I - 0.25);
  tl.set("#panelL", { borderColor: "${HOT}f2" }, I - 0.05);
  tl.set("#panelL", { borderColor: "${A}4d" }, I + 0.07);

  // power-on boot: unlit LED cells + header tags flicker alive
  tl.set("#ghostL", { opacity: 0.06 }, I - 0.045);
  tl.set("#ghostL", { opacity: 0.13 }, I - 0.003);
  tl.set(["#ptagL", "#gtagL"], { opacity: 0.4 }, I - 0.045);
  tl.set(["#ptagL", "#gtagL"], { opacity: 0.9 }, I - 0.003);

  // ===== APEX: L→R illumination wipe — LEDs light column by column =====
  tl.set("#awordL", { opacity: 1, color: "${HOT}" }, I);
  tl.fromTo("#awordL", { clipPath: "inset(0% 100% 0% 0%)" },
            { clipPath: "inset(0% 0% 0% 0%)", duration: ${(p.wipeDur || 0.3).toFixed(2)}, ease: "steps(${wipeSteps})" }, I);
  tl.set("#awordL", { clipPath: "none" }, C + 0.05);       // free the glow halo
  tl.to("#awordL", { color: "${A}", duration: 0.60, ease: "power1.in" }, C + 0.05); // hot → amber cool

  // contact: squash held 2 frames, elastic settle (board cell flexes)
  tl.set("#scrollL", { scaleX: 1.06, scaleY: 0.94 }, C);
  tl.to("#scrollL", { scaleX: 1, scaleY: 1, duration: 0.42, ease: "elastic.out(1, 0.4)" }, C + 0.083);

  // PA "ding" = two quick brightness pulses
  tl.set("#panwinL", { filter: "brightness(1.7)" },  C + 0.02);
  tl.set("#panwinL", { filter: "brightness(1)" },    C + 0.10);
  tl.set("#panwinL", { filter: "brightness(1.45)" }, C + 0.18);
  tl.set("#panwinL", { filter: "brightness(1)" },    C + 0.26);
${
  C + 0.99 < exScroll
    ? `
  // hold life: glow breathes + LED dropouts
  tl.to("#awordL", { textShadow: "0 0 30px ${A}d9, 0 0 4px ${HOT}f2",
                     duration: 0.45, ease: "sine.inOut" }, C + 0.54);
  tl.to("#awordL", { textShadow: "0 0 18px ${A}8c, 0 0 2px ${HOT}cc",
                     duration: 0.45, ease: "sine.inOut" }, C + 0.99);
  tl.set("#awordL", { opacity: 0.82 }, C + 0.61); tl.set("#awordL", { opacity: 1 }, C + 0.652);
  tl.set("#awordL", { opacity: 0.90 }, C + 1.04); tl.set("#awordL", { opacity: 1 }, C + 1.082);
  tl.set("#ptagL", { opacity: 0.45 }, C + 0.41); tl.set("#ptagL", { opacity: 0.9 }, C + 0.452);`
    : ""
}

  // ===== exit: word pages up out of the window, board collapses =====
  tl.to("#scrollL", { y: ${-(panelH - 62)}, duration: 0.22, ease: "steps(6)" }, ${exScroll.toFixed(3)});
  tl.set(["#ptagL", "#gtagL"], { opacity: 0 }, ${(exScroll + 0.2).toFixed(3)});
  tl.to("#panelL", { scaleY: 0, duration: 0.18, ease: "steps(6)" }, ${(exScroll + 0.24).toFixed(3)});
  tl.set("#apxL", { opacity: 0 }, ${(exScroll + 0.44).toFixed(3)});

  // ===== chasing LED marquee border (8-phase set chain) =====
  const panelL = document.getElementById("panelL");
  const PW = ${panelW}, PH = ${panelH}, groups = [[], [], [], [], [], [], [], []];
  const pts = [];
  for (let i = 0; i < ${nTop}; i++) pts.push([10 + i * (PW - 27) / ${nTop - 1}, 6]);        // top L→R
  for (let j = 0; j < ${nSide}; j++) pts.push([PW - 13, 6 + (j + 1) * (PH - 19) / ${nSide + 1}]); // right ↓
  for (let i = ${nTop - 1}; i >= 0; i--) pts.push([10 + i * (PW - 27) / ${nTop - 1}, PH - 13]);   // bottom R→L
  for (let j = ${nSide - 1}; j >= 0; j--) pts.push([6, 6 + (j + 1) * (PH - 19) / ${nSide + 1}]);  // left ↑
  pts.forEach(([x, y], i) => {
    const d = document.createElement("div");
    d.className = "ldot"; d.style.left = Math.round(x) + "px"; d.style.top = Math.round(y) + "px";
    d.style.opacity = "0"; panelL.appendChild(d);
    groups[i % 8].push(d);
  });
  groups.forEach((g) => tl.set(g, { opacity: 0.18 }, I - 0.02));
  for (let k = 0; k <= ${kMax}; k++) {
    const t = I - 0.01 + k * 0.1;
    for (let q = 0; q < 8; q++) {
      const lit = (((q - k) % 8) + 8) % 8 < 2;
      tl.set(groups[q], { opacity: lit ? 0.95 : 0.18 }, t);
    }
  }`;
  return { css, html, js };
}

function setpieceVhsosd() {
  // REC FREEZE: the word slams in as a huge camcorder OSD readout BEHIND the
  // subject. Permanent lens vignette = the camcorder look; a backlight-comp
  // scrim kills the bright sky behind the word. Arrival = tracking-sliced
  // crush (3 horizontal clip-path bands sheared + blurred, power4.in) that
  // SNAPS into register on the contact frame, squash → elastic settle; heavy
  // red/cyan misregistration cools from ±arrival px to ±settled px and keeps
  // BREATHING through the hold; tape-weave y jitter + slow loom; auto-iris
  // pump (white wash up, dark dip, settle). Exit = REWIND streak left with a
  // flat-white echo copy.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const C = I + (p.crush ?? 0.1); // contact: slices snap into register
  const X = theme.hero.exitAt ?? Math.min(heroOut, I + (p.hold ?? 1.69)); // REWIND
  const clips = p.bandClips || [
    [0, 64],
    [36, 30],
    [70, 0],
  ];
  const shear = p.bandShear || [-46, 40, -34];
  const mi = p.misregIn ?? 11, // arrival misregistration (px)
    m = p.misreg ?? 3; // settled misregistration (px)
  const RED = dna.palette.red || "#FF2E2E",
    CYN = dna.palette.cyan || "#3FE8E8";
  const yPct = ((HG.y / H) * 100).toFixed(0);
  const css = `
  #vig { position:absolute; inset:0; opacity:0;
         background: radial-gradient(115% 100% at 50% 46%, rgba(0,0,0,0) 52%, rgba(0,0,0,${p.vignette ?? 0.34}) 100%); }
  #vscrim { position:absolute; inset:0; opacity:0;
           background: radial-gradient(58% 44% at 50% ${yPct}%, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.34) 55%, rgba(0,0,0,0) 78%); }
  #iris  { position:absolute; inset:0; opacity:0; background:#ffffff; }
  #irisd { position:absolute; inset:0; opacity:0; background:#000000; }
  #osdw, #oecho { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; }
  .aw { position:absolute; left:0; top:0; white-space:nowrap;
        font-family:'${dna.fonts.hero}', monospace; font-size:${HG.fontPx}px; line-height:1;
        letter-spacing:0.02em; }
  #mr { color:${RED}; opacity:0.55; }
  #mc { color:${CYN}; opacity:0.55; }
  .wb2 { color:${dna.palette.body}; text-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.45); }
  ${clips.map((c, i) => `#vb${i + 1} { clip-path: inset(${c[0]}% 0 ${c[1]}% 0); }`).join("\n  ")}
  #oe { color:#ffffff; opacity:0.4; text-shadow:none; }`;
  const html = `      <div id="vig"></div>
      <div id="vscrim"></div>
      <div id="osdw">
        <div id="weave">
          <div class="aw" id="mr">${esc(heroText)}</div>
          <div class="aw" id="mc">${esc(heroText)}</div>
          ${clips.map((_, i) => `<div class="aw wb2" id="vb${i + 1}">${esc(heroText)}</div>`).join("\n          ")}
        </div>
      </div>
      <div id="oecho"><div class="aw" id="oe">${esc(heroText)}</div></div>
      <div id="iris"></div>
      <div id="irisd"></div>`;
  const bandIds = clips.map((_, i) => "#vb" + (i + 1));
  // hold life windows (clamped inside [contact, exit] so nothing fights the rewind)
  const weaveTs = [];
  const wv = p.weave || [-2, 1, -1, 2, -1, 1, -2, 0];
  for (let k = 0; k < wv.length; k++) {
    const t = C + 0.19 + k * 0.17;
    if (t < X - 0.05) weaveTs.push([+t.toFixed(3), wv[k]]);
  }
  const brDur = Math.min(1.3, X - (C + 0.21) - 0.05);
  const loomDur = Math.min(0.92, X - (C + 0.64) - 0.03);
  const js = `
  // ---- setpiece: VHSOSD (tracking-sliced OSD slam → misreg breathe → REWIND exit) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)}, X = ${X.toFixed(3)};
  gsap.set(${J(["#mr", "#mc", ...bandIds, "#oe"])}, { xPercent:-50, yPercent:-50 });
  gsap.set("#weave", { x: 0, y: 0 });

  // camcorder lens vignette — present the whole clip
  tl.set("#vig", { opacity: 1 }, 0.02);

  // backlight-compensation scrim behind the word (the sky is bright up there)
  tl.fromTo("#vscrim", { opacity: 0 }, { opacity: ${dna.plate.charge}, duration: 0.20, ease: "power2.in" }, I - 0.04);
  tl.to("#vscrim", { opacity: ${(dna.plate.charge * 0.69).toFixed(2)}, duration: 0.8, ease: "power2.out" }, C + 0.35);
  tl.to("#vscrim", { opacity: 0, duration: 0.30, ease: "power1.in" }, X);

  // ===== ARRIVAL: tracking-sliced crush, opacity 1 instantly =====
  tl.set("#osdw", { opacity: 1 }, I);
  tl.fromTo("#osdw", { scale: 2.9 }, { scale: 1, duration: C - I, ease: "power4.in" }, I);
  const SHEAR = ${J(shear)};
  ${J(bandIds)}.forEach((sel, i) => {
    tl.fromTo(sel, { x: SHEAR[i], filter: "blur(10px) brightness(2.6)" },
              { x: Math.round(SHEAR[i] * 0.3), filter: "blur(1px) brightness(1.7)", duration: C - I, ease: "power4.in" }, I);
  });
  tl.set("#mr", { x: -${mi} }, I);
  tl.set("#mc", { x: ${mi} }, I);

  // SNAP into register on the contact frame + squash, elastic settle
  tl.set(${J(bandIds)}, { x: 0, filter: "brightness(1.85)" }, C);
  tl.set("#mr", { x: -${m} }, C);
  tl.set("#mc", { x: ${m} }, C);
  tl.set("#osdw", { scaleX: 1.10, scaleY: 0.90 }, C);
  tl.to("#osdw", { scaleX: 1, scaleY: 1, duration: 0.50, ease: "elastic.out(1, 0.36)" }, C + 0.083);
  tl.to(${J(bandIds)}, { filter: "brightness(1)", duration: 0.45, ease: "power2.out" }, C + 0.10);

  // AUTO-IRIS PUMP: wash up, then a dark dip, once
  tl.to("#iris", { opacity: 0.20, duration: 0.12, ease: "sine.out" }, C + 0.04);
  tl.to("#iris", { opacity: 0, duration: 0.33, ease: "power1.in" }, C + 0.16);
  tl.to("#irisd", { opacity: ${dna.plate.dim}, duration: 0.28, ease: "sine.out" }, C + 0.55);
  tl.to("#irisd", { opacity: 0, duration: 0.40, ease: "sine.in" }, C + 0.85);
${
  brDur > 0.3
    ? `
  // ===== HOLD LIFE: misregistration breathes, tape weave, slow loom =====
  tl.to("#mr", { keyframes: { x: [-${m}, -${(m * 1.53).toFixed(1)}, -${(m * 1.07).toFixed(1)}, -${(m * 1.67).toFixed(1)}, -${(m * 1.17).toFixed(1)}] }, duration: ${brDur.toFixed(2)}, ease: "none" }, C + 0.21);
  tl.to("#mc", { keyframes: { x: [${m}, ${(m * 1.53).toFixed(1)}, ${(m * 1.07).toFixed(1)}, ${(m * 1.67).toFixed(1)}, ${(m * 1.17).toFixed(1)}] }, duration: ${brDur.toFixed(2)}, ease: "none" }, C + 0.21);
  ${J(weaveTs)}.forEach(([t, v]) => tl.set("#weave", { y: v }, t));`
    : ""
}
${
  loomDur > 0.3
    ? `  tl.to("#osdw", { keyframes: { scale: [1, 1.03, 1.015, 1.028] }, duration: ${loomDur.toFixed(2)}, ease: "none" }, C + 0.64);`
    : ""
}

  // ===== EXIT: REWIND — streak left with echo copy =====
  tl.to("#osdw", { x: -190, scaleX: 1.3, opacity: 0, duration: 0.13, ease: "power2.in" }, X);
  tl.set("#oecho", { opacity: 1 }, X);
  tl.fromTo("#oe", { x: 0, opacity: 0.4 }, { x: -95, opacity: 0, duration: 0.18, ease: "power2.in" }, X + 0.01);
  tl.set(["#osdw","#oecho"], { display: "none" }, X + 0.25);`;
  return { css, html, js };
}

function setpieceBossintro() {
  // BOSS INTRO (bg): the room darkens behind a CRT edge glow (cyan base wash,
  // pulses on the last emphasis before the boss and spills magenta on the
  // strobe + the final word), WARNING blinks 2x above the word rect, then
  // ~COLS×ROWS seeded pixel blocks fall steps(3) into a tight matrix grid
  // covering the word rect (1-frame white land tick each — the coin-blip motif
  // at block scale), and the word flashes ON (instant, oversized, quantized
  // crush → 2-frame squash → elastic settle) with chromatic ghost layers and a
  // 3-frame palette strobe. Hold: quantized breathe + CRT glow cycle + baked
  // block shimmer blinks. Exit: per-letter checkerboard dissolve; blocks drop
  // away quantized. FG furniture (rides rail.html via fg parts): letterbox
  // bars slam in with a 1-frame overshoot and a HI-SCORE odometer rolls
  // top-right through the hold.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const CY = dna.palette.accent,
    MG = dna.palette.magenta || "#FF2E88",
    YL = dna.palette.yellow || "#FFE600";
  const FLASH = I + (p.flashDelay ?? 0.14);
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.2, I + (p.hold ?? 1.24));
  const ROWS = p.rows || 4;
  const CWp = Math.round(HG.fontPx * 0.7),
    CHp = Math.round(HG.fontPx * 0.5);
  const COLS = Math.ceil((HG.halfW * 2 + 100) / CWp);
  const X0 = Math.round(HG.x - (COLS * CWp) / 2),
    Y0 = Math.round(HG.y - (ROWS * CHp) / 2);
  // scene-reaction pulses: the edge glow pre-echoes the boss on the last
  // emphasis word before the takeover; magenta answers on the final word
  const minorsBefore = LINES.flatMap((L) => L.words).filter((w) => w.minor && w.start < I - 0.3);
  const pulseT = minorsBefore.length ? minorsBefore[minorsBefore.length - 1].start : null;
  const endPulse =
    LASTWORD.start + 0.384 < DUR - 0.02 && LASTWORD.start > EX + 0.4 ? LASTWORD.start : null;
  const lb = p.letterbox || 44;
  const css = `
  #bdim  { position:absolute; inset:0; opacity:0;
           background:linear-gradient(180deg, rgba(2,3,12,0.66) 0%, rgba(2,3,12,0.40) 55%, rgba(2,3,12,0.30) 100%); }
  #edgeC { position:absolute; inset:0; opacity:0; box-shadow: inset 0 0 130px ${CY}4d; }
  #edgeM { position:absolute; inset:0; opacity:0; box-shadow: inset 0 0 130px ${MG}52; }
  #blocks{ position:absolute; inset:0; }
  .blk   { position:absolute; opacity:0; }
  #bossWord { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; }
  .bw    { position:absolute; left:0; top:0; white-space:nowrap;
           font-family:'${dna.fonts.hero}', monospace; font-size:${HG.fontPx}px; line-height:1; }
  #bwC   { color:${CY}; opacity:0; }
  #bwM   { color:${MG}; opacity:0; }
  #bwMain{ color:#ffffff;
           text-shadow:0 6px 0 rgba(0,0,0,0.6), 0 0 16px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.85); }
  #bwMain .bl { display:inline-block; }
  #warning { position:absolute; left:${HG.x}px; top:${Math.round(HG.y - HG.fontPx * 1.43)}px; opacity:0;
             font-family:'${dna.fonts.tag}', monospace; font-size:26px; letter-spacing:0.4em;
             color:${MG};
             text-shadow:0 0 14px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9), 0 4px 0 rgba(0,0,0,0.8); }`;
  const html = `      <div id="bdim"></div>
      <div id="edgeC"></div>
      <div id="edgeM"></div>
      <div id="blocks"></div>
      <div id="bossWord">
        <div class="bw" id="bwC">${esc(heroText)}</div>
        <div class="bw" id="bwM">${esc(heroText)}</div>
        <div class="bw" id="bwMain"></div>
      </div>
      <div id="warning">${esc(p.tag || "WARNING")}</div>`;
  const js = `
  // ---- setpiece: BOSSINTRO (dim + WARNING -> pixel-block assembly -> strobe flash) ----
  const I = ${I.toFixed(3)}, FLASH = ${FLASH.toFixed(3)}, OUT = ${EX.toFixed(3)};
  const CYc = ${J(CY)}, MGc = ${J(MG)}, YLc = ${J(YL)}, WHc = "#ffffff";
  const brnd = mulberry32(${p.seed || 13013});

  // ===== scene reaction: CRT edge glow lives behind the subject =====
  tl.set("#edgeC", { opacity: 0.28 }, 0.05);
${
  pulseT != null
    ? `  // pulse on the last emphasis before the boss
  tl.set("#edgeC", { opacity: 0.62 }, ${pulseT.toFixed(3)});
  tl.set("#edgeC", { opacity: 0.28 }, ${(pulseT + 0.084).toFixed(3)});`
    : ""
}
  // boss dim: room darkens for the boss intro (helps a bright sky too)
  tl.to("#bdim", { opacity: ${dna.plate.dim ?? 0.58}, duration: 0.12, ease: "power2.out" }, I - 0.15);
  tl.set("#edgeC", { opacity: 0.8 }, FLASH);
  tl.to("#edgeC", { opacity: 0.34, duration: 0.6, ease: "power2.out" }, FLASH + 0.08);
  tl.set("#edgeM", { opacity: 0.5 }, FLASH + 0.084);            // magenta strobe spill
  tl.to("#edgeM", { opacity: 0, duration: 0.25, ease: "power1.out" }, FLASH + 0.126);
  tl.to("#bdim", { opacity: 0, duration: 0.35, ease: "power1.inOut" }, OUT + 0.10);
${
  endPulse != null
    ? `  // magenta answers on the final word
  tl.set("#edgeM", { opacity: 0.55 }, ${endPulse.toFixed(3)});
  tl.to("#edgeM", { opacity: 0, duration: 0.3, ease: "power1.out" }, ${(endPulse + 0.084).toFixed(3)});`
    : ""
}

  // ===== WARNING blinks 2x above the word =====
  tl.set("#warning", { opacity: 1 }, I - 0.135);
  tl.set("#warning", { opacity: 0 }, I - 0.05);
  tl.set("#warning", { opacity: 1 }, I + 0.035);
  tl.set("#warning", { opacity: 0 }, I + 0.12);
  gsap.set("#warning", { xPercent: -50, yPercent: -50 });

  // ===== pixel-block boss assembly: blocks fall steps(3) into a tight grid =====
  const blocksEl = document.getElementById("blocks");
  const X0 = ${X0}, Y0 = ${Y0}, COLS = ${COLS}, ROWS = ${ROWS}, CW = ${CWp}, CH = ${CHp};
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const b = document.createElement("div");
      b.className = "blk"; blocksEl.appendChild(b);
      const s = 8 + Math.round(brnd() * 6);                       // 8–14px
      const jx = Math.round((brnd() - 0.5) * 6), jy = Math.round((brnd() - 0.5) * 6);
      const px = brnd();
      const col = px < 0.4 ? CYc : px < 0.78 ? MGc : px < 0.93 ? YLc : WHc;
      gsap.set(b, { width: s, height: s,
                    left: X0 + c * CW + (CW - s) / 2 + jx,
                    top:  Y0 + r * CH + (CH - s) / 2 + jy,
                    backgroundColor: col });
      const start = Math.min(I - 0.15 + c * 0.010 + brnd() * 0.04, FLASH - 0.10);
      let dur = 0.12 + brnd() * 0.06;
      if (start + dur > FLASH - 0.02) dur = FLASH - 0.02 - start;
      const fall = 240 + brnd() * 260;
      tl.set(b, { opacity: 0.9, y: -fall }, start);
      tl.to(b, { y: 0, duration: dur, ease: "steps(3)" }, start);
      // 1-frame white land tick (the coin-blip motif at block scale)
      const land = start + dur;
      tl.set(b, { backgroundColor: WHc }, land);
      tl.set(b, { backgroundColor: col, opacity: 0.85 }, land + 0.042);
      // hold shimmer: baked blink sets (no infinite repeats)
      const t1 = FLASH + 0.11 + brnd() * 0.45, t2 = FLASH + 0.61 + brnd() * 0.4;
      if (t1 + 0.083 < OUT) { tl.set(b, { opacity: 0.5 },  t1); tl.set(b, { opacity: 0.85 }, t1 + 0.083); }
      if (t2 + 0.083 < OUT) { tl.set(b, { opacity: 0.55 }, t2); tl.set(b, { opacity: 0.85 }, t2 + 0.083); }
      // exit: blocks drop off, quantized
      const tE = Math.min(OUT + brnd() * 0.15, ${(DUR - 0.32).toFixed(2)});
      tl.to(b, { y: 220 + brnd() * 140, opacity: 0, duration: 0.2 + brnd() * 0.1,
                 ease: "steps(3)" }, tE);
    }
  }

  // ===== the word flashes ON over the block grid =====
  const main = document.getElementById("bwMain");
  const letters = [];
  ${J(heroText)}.split("").forEach((ch) => {
    const s = document.createElement("span");
    s.className = "bl"; s.textContent = ch === " " ? "\\u00a0" : ch;
    main.appendChild(s); letters.push(s);
  });
  gsap.set("#bwC",   { xPercent: -50, yPercent: -50, x: -4 });
  gsap.set("#bwM",   { xPercent: -50, yPercent: -50, x: 4 });
  gsap.set("#bwMain",{ xPercent: -50, yPercent: -50 });
  gsap.set("#bossWord", { transformOrigin: "50% 50%" });

  // arrival: instant-on at full opacity, quantized crush, 2-frame squash, elastic settle
  tl.set("#bossWord", { opacity: 1, scale: 1.15 }, FLASH);
  tl.set(["#bwC", "#bwM"], { opacity: 0.85 }, FLASH);
  tl.to("#bossWord", { scale: 1, duration: 0.1, ease: "steps(3)" }, FLASH);
  tl.set("#bossWord", { scaleX: 1.07, scaleY: 0.92 }, FLASH + 0.1);
  tl.to("#bossWord", { scaleX: 1, scaleY: 1, duration: 0.3,
                       ease: "elastic.out(1, 0.38)" }, FLASH + 0.142);
  // 3-frame palette strobe (white -> cyan -> magenta -> white)
  tl.set(main, { color: CYc }, FLASH + 0.042);
  tl.set(main, { color: MGc }, FLASH + 0.084);
  tl.set(main, { color: WHc }, FLASH + 0.126);
  // hold life: quantized breathe + CRT glow cycle (emitted only with runway)
  if (FLASH + 0.61 < OUT) {
    tl.to("#bossWord", { scale: 1.016, duration: 0.4, ease: "sine.inOut",
                         repeat: 1, yoyo: true }, FLASH + 0.61);
  }
  const HALO = ", 0 6px 0 rgba(0,0,0,0.6), 0 0 16px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.85)";
  [[0.2, CYc], [0.5, MGc], [0.8, CYc]].forEach(([dt, gc]) => {
    if (FLASH + dt < OUT) tl.set(main, { textShadow: "0 0 22px " + gc + "d9" + HALO }, FLASH + dt);
  });

  // exit: checkerboard dissolve — letters vanish in 2 alternating set passes
  letters.forEach((s, i) => {
    tl.set(s, { opacity: 0 }, i % 2 === 0 ? OUT : OUT + 0.083);
  });
  tl.set(["#bwC", "#bwM"], { opacity: 0 }, OUT + 0.042);
  tl.set("#bossWord", { opacity: 0, display: "none" }, OUT + 0.17);`;
  // fg furniture: letterbox bars + HI-SCORE odometer ride the fg alpha layer
  // (in FRONT of the subject — the cabinet frames the player)
  const fgCss = `
  #lbTop { position:absolute; left:0; top:-${lb}px;    width:${W}px; height:${lb}px; background:#000; z-index:14; }
  #lbBot { position:absolute; left:0; bottom:-${lb}px; width:${W}px; height:${lb}px; background:#000; z-index:14; }
  #hi    { position:absolute; right:36px; top:${lb + 18}px; opacity:0; white-space:nowrap;
           font-family:'${dna.fonts.tag}', monospace; font-size:18px; z-index:15;
           text-shadow:0 3px 0 rgba(0,0,0,0.75), 0 0 10px rgba(0,0,0,0.6); }
  #hi .lab { color:${CY}; margin-right:0.5em; }
  #hi #hsv { color:${YL}; }`;
  const fgHtml = `      <div id="lbTop"></div>
      <div id="lbBot"></div>
      <div id="hi"><span class="lab">HI-SCORE</span><span id="hsv">0000000</span></div>`;
  const fgJs = `
  // ---- bossintro furniture (fg): letterbox slam + HI-SCORE odometer ----
  {
    const BI = ${I.toFixed(3)}, BF = ${FLASH.toFixed(3)}, BO = ${EX.toFixed(3)};
    const hrnd = mulberry32(${(p.seed || 13013) + 7});
    // letterbox bars slam in (quantized), 1-frame overshoot, retract after
    tl.to("#lbTop", { y: ${lb},  duration: 0.12, ease: "steps(3)" }, BI - 0.15);
    tl.to("#lbBot", { y: -${lb}, duration: 0.12, ease: "steps(3)" }, BI - 0.15);
    tl.set("#lbTop", { y: ${lb + 4} },  BI - 0.02); tl.set("#lbTop", { y: ${lb} },  BI + 0.022);
    tl.set("#lbBot", { y: -${lb + 4} }, BI - 0.02); tl.set("#lbBot", { y: -${lb} }, BI + 0.022);
    tl.to("#lbTop", { y: 0, duration: 0.15, ease: "steps(3)" }, BO + 0.13);
    tl.to("#lbBot", { y: 0, duration: 0.15, ease: "steps(3)" }, BO + 0.13);
    // HI-SCORE counter odometer-rolls during the hold
    const hsv = document.getElementById("hsv");
    tl.set("#hi", { opacity: 1 }, BF + 0.03);
    tl.fromTo("#hi", { scale: 0 }, { scale: 1, duration: 0.1, ease: "steps(2)",
                                     transformOrigin: "100% 50%" }, BF + 0.03);
    let score = 1370;
    for (let t = BF + 0.09; t < BO - 0.03; t += 0.066) {
      score += 4000 + Math.round(hrnd() * 5500);
      tl.set(hsv, { textContent: String(score).padStart(7, "0") }, t);
    }
    tl.set("#hi", { color: "#ffffff" }, BO + 0.08);              // 1-frame white tick out
    tl.set("#hi", { opacity: 0 }, BO + 0.122);
  }`;
  return { css, html, js, fgCss, fgHtml, fgJs };
}

function setpieceRubberstamp() {
  // RUBBER STAMP: the footage becomes an archival page at the apex — vignette
  // charge (plate.charge) + manila sepia wash + a dim kick (plate.dim) that
  // cools — then the verdict slams in BEHIND the subject as a bordered rubber
  // stamp at params.rotation: crush 2.2→1 power4.in, 2-frame contact squash,
  // double-strike ghost print, two thin-ink patches (clip-path circles in
  // paper color), wet-ink saturate/brightness settle, and a paper indent
  // shadow that blooms under the face. Stamps don't move: the hold is DEAD
  // STILL, sold by the breathing indent + a slow paper loom. Exit at
  // C + params.hold = mechanical 3-frame yank-down cut (the page is filed
  // away); the archive plate releases 0.25s before it.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const C = I + (p.crush ?? 0.074); // stamp contact (plate punch lands here via punchOffset)
  const X = theme.hero.exitAt ?? Math.min(heroOut - 0.06, C + (p.hold ?? 2.02));
  const ROT = p.rotation ?? -8;
  const RED = dna.palette.accent || "#b3271e";
  const s = HG.fontPx / 120; // demo face was cut at 120px — chrome scales with it
  const bw = Math.max(3, Math.round(6 * s)),
    rad = Math.round(14 * s);
  const padT = Math.round(20 * s),
    padX = Math.round(40 * s),
    padB = Math.round(14 * s);
  const paperW = Math.round(HG.halfW * 2 * 1.18),
    paperH = Math.round(HG.fontPx * 2.83);
  const indW = Math.round(HG.halfW * 2 * 1.06),
    indH = Math.round(HG.fontPx * 2.08);
  const patches = p.patches || [
    [27, 36, 0.72],
    [71, 68, 0.57],
  ];
  const loomDur = Math.min(1.7, DUR - (C + 0.35) - 0.03);
  const breDur = Math.min(1.6, DUR - (C + 0.45) - 0.03);
  const css = `
  #dsep { position:absolute; inset:0; opacity:0; background:${dna.palette.paper || "#d8c49a"}; }
  #dvig { position:absolute; inset:0; opacity:0;
          background: radial-gradient(115% 100% at 50% 40%, rgba(0,0,0,0) 30%, rgba(20,14,8,0.85) 100%); }
  #ddim { position:absolute; inset:0; opacity:0; background:#140d06; }
  #dapex { position:absolute; left:${HG.x}px; top:${HG.y}px; width:0; height:0; }
  #dpaper { position:absolute; width:${paperW}px; height:${paperH}px; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%, rgba(222,203,160,0.92) 0%, rgba(216,196,154,0.55) 52%, rgba(216,196,154,0) 78%); }
  #dindent { position:absolute; width:${indW}px; height:${indH}px; opacity:0; filter:blur(8px);
             background: radial-gradient(50% 50% at 50% 50%, rgba(26,16,9,0.62) 0%, rgba(26,16,9,0.30) 48%, rgba(26,16,9,0) 72%); }
  #dstamp { position:absolute; }
  #dsface { position:relative; display:inline-block; }
  .dface { font-family:'${dna.fonts.hero}', serif; font-size:${HG.fontPx}px; line-height:1;
           white-space:nowrap; letter-spacing:0.015em; color:${RED};
           border:${bw}px solid currentColor; border-radius:${rad}px;
           padding:${padT}px ${padX}px ${padB}px; }
  #dghost, #dp1, #dp2 { position:absolute; inset:0; }
  #dghost { opacity:0; }
  #dp1 .dface, #dp2 .dface { color:rgba(219,199,156,0.55); }
  #dp1 { clip-path: circle(${Math.round(patches[0][2] * HG.fontPx)}px at ${patches[0][0]}% ${patches[0][1]}%); }
  #dp2 { clip-path: circle(${Math.round(patches[1][2] * HG.fontPx)}px at ${patches[1][0]}% ${patches[1][1]}%); }`;
  const html = `      <div id="dsep"></div>
      <div id="dvig"></div>
      <div id="ddim"></div>
      <div id="dapex">
        <div id="dpaper"></div>
        <div id="dindent"></div>
        <div id="dstamp">
          <div id="dsface">
            <div id="dghost"><div class="dface">${esc(heroText)}</div></div>
            <div id="dmain" class="dface">${esc(heroText)}</div>
            <div id="dp1"><div class="dface">${esc(heroText)}</div></div>
            <div id="dp2"><div class="dface">${esc(heroText)}</div></div>
          </div>
        </div>
      </div>`;
  const js = `
  // ---- setpiece: RUBBERSTAMP (archive charge → stamp crush → dead-still hold → filed away) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)}, X = ${X.toFixed(3)};

  // static geometry
  gsap.set("#dpaper",  { xPercent:-50, yPercent:-50, rotation: ${p.paperRot ?? 2.4} });
  gsap.set("#dindent", { xPercent:-50, yPercent:-50, rotation: ${ROT} });
  gsap.set("#dstamp",  { xPercent:-50, yPercent:-50, rotation: ${ROT}, opacity: 0,
                         transformOrigin: "50% 50%" });
  gsap.set("#dghost",  { x: ${Math.round(5 * s) || 5}, y: -${Math.round(4 * s) || 4}, rotation: 1.3 });

  // ===== SCENE REACTION: the footage becomes an archive page =====
  tl.fromTo("#dvig", { opacity: 0 }, { opacity: ${dna.plate.charge}, duration: 0.18, ease: "power2.in" }, C - 0.18);
  tl.fromTo("#dsep", { opacity: 0 }, { opacity: ${p.sepia ?? 0.14}, duration: 0.28, ease: "power1.out" }, C - 0.12);
  tl.set("#ddim", { opacity: ${dna.plate.dim} }, C);
  tl.to("#ddim",  { opacity: ${(dna.plate.dim * 0.385).toFixed(2)}, duration: 0.5, ease: "power2.out" }, C + 0.05);
  tl.to("#dvig",  { opacity: ${(dna.plate.charge * 0.5).toFixed(2)}, duration: 0.8, ease: "power2.out" }, C + 0.12);
  tl.to(["#dvig","#dsep","#ddim"], { opacity: 0, duration: 0.4, ease: "power1.in" }, X - 0.25);

  // the page lights up an instant before contact (what the stamp lands ON)
  tl.fromTo("#dpaper", { opacity: 0, scale: 0.92 },
            { opacity: 0.6, scale: 1, duration: 0.10, ease: "expo.out" }, C - 0.05);
  tl.to("#dpaper", { keyframes: { scale: [1, 1.016, 1.005, 1.018, 1.008, 1.015] },
                     duration: ${loomDur.toFixed(2)}, ease: "none" }, C + 0.35);

  // ===== ARRIVAL: rubber stamp crush → contact squash → dead still =====
  tl.set("#dstamp", { opacity: 1, scale: 2.2 }, C - 0.115);
  tl.to("#dstamp",  { scale: 1, duration: 0.115, ease: "power4.in" }, C - 0.115);
  tl.set("#dstamp", { scaleX: 1.07, scaleY: 0.93 }, C);             // contact squash
  tl.to("#dstamp",  { scaleX: 1, scaleY: 1, duration: 0.09, ease: "power2.out" }, C + 0.083);
  // double-strike ghost prints on contact
  tl.set("#dghost", { opacity: 0.35 }, C);
  // wet ink settles
  tl.set("#dmain", { filter: "saturate(1.5) brightness(1.3)" }, C);
  tl.to("#dmain",  { filter: "saturate(1) brightness(1)", duration: 0.5, ease: "power2.out" }, C + 0.06);

  // paper indent shadow blooms under the stamp, then breathes (the hold-life;
  // the stamp itself stays DEAD STILL)
  tl.set("#dindent", { opacity: 0.5, scale: 0.7 }, C);
  tl.to("#dindent",  { scale: 1, opacity: 0.42, duration: 0.35, ease: "expo.out" }, C + 0.02);
  tl.to("#dindent",  { keyframes: { opacity: [0.42, 0.30, 0.40, 0.31, 0.38, 0.33] },
                       duration: ${breDur.toFixed(2)}, ease: "none" }, C + 0.45);

  // ===== EXIT: page filed away — mechanical 3-frame yank-down cut =====
  tl.set("#dapex", { y: 10 }, X);
  tl.set("#dapex", { y: 28, opacity: 0.5 }, X + F);
  tl.set("#dapex", { opacity: 0 }, X + 2 * F);`;
  return { css, html, js };
}

function setpieceBreakaway() {
  // BREAKAWAY: a live-news BREAKING takeover. BG (behind the subject): the studio
  // dims a touch + an accent alert wash pulses + a ghosted hero watermark drifts,
  // partially occluded by him. FG (in front, lower third, riding the chyron): a
  // red BREAKING banner SLAMS DOWN onto the chyron top (scaleY 0→1 power4.in →
  // elastic dig-in) while the hero word STAMPS (crush → 2-frame contact squash →
  // elastic settle), then a 3-flash red/white strobe inverts the banner; a corner
  // BREAKING clock flips in over the timestamp. Hold life: the word breathes, the
  // banner light pulses, the tag blinks slow. Exit: the banner collapses to a 2px
  // line that the ticker "absorbs" (a glow hit on the ticker rail).
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const C = I + (p.crush ?? 0.09); // word contact (plate punch lands here via punchOffset)
  const X = theme.hero.exitAt ?? Math.min(heroOut - 0.06, C + (p.hold ?? 1.95));
  const RED = dna.palette.accent || "#d2232a";
  const bannerTop = HG.bannerTop,
    bannerH = HG.bannerH;
  const breakClock = p.breakClock || "● 19:42:00";
  const wmTop = sz && sz.heroBands ? Math.round(H * 0.46) : Math.round(H * 0.46);
  const wmSize = p.wmSize || 190;
  const flashes = p.flashes || [0.13, 0.21, 0.29]; // offsets from C for the strobe
  // ---- BG: scene reaction + ghosted watermark (behind subject) ----
  const css = `
  #bkDim  { position:absolute; inset:0; background:#061018; opacity:0; }
  #bkWash { position:absolute; inset:0; background:${RED}; opacity:0; }
  #bkWm   { position:absolute; left:${Math.round(W * 0.485)}px; top:${wmTop}px; opacity:0; white-space:nowrap;
            font-family:'${dna.fonts.hero}', sans-serif; font-size:${wmSize}px; line-height:1;
            letter-spacing:0.04em; color:${RED}; }`;
  const html = `      <div id="bkDim"></div>
      <div id="bkWash"></div>
      <div id="bkWm">${esc(heroText)}</div>`;
  const js = `
  // ---- setpiece: BREAKAWAY (scene reaction + ghosted watermark, behind subject) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)}, X = ${X.toFixed(3)};
  tl.to("#bkDim", { opacity: ${(dna.plate.dim ?? 0.11).toFixed(3)}, duration: 0.12, ease: "power2.in" }, I - 0.06);
  tl.to("#bkDim", { opacity: 0, duration: 0.50, ease: "power1.in" }, X - 0.4);
  tl.to("#bkWash", { opacity: ${(p.wash ?? 0.08).toFixed(3)}, duration: 0.10, ease: "power2.in" }, I - 0.04);
  tl.set("#bkWash", { opacity: ${(p.washHit ?? 0.16).toFixed(3)} }, C);
  tl.to("#bkWash", { opacity: ${(p.wash ?? 0.08).toFixed(3)}, duration: 0.14, ease: "power1.out" }, C + 0.083);
  tl.to("#bkWash", { opacity: 0, duration: 0.28, ease: "power1.in" }, X - 0.04);
  // ghosted watermark backplate, partially occluded by the subject, slow drift
  gsap.set("#bkWm", { xPercent: -50, yPercent: -50, scale: 1.05 });
  tl.to("#bkWm", { opacity: ${(p.wmOpacity ?? 0.17).toFixed(3)}, duration: 0.12, ease: "power2.out" }, I + 0.08);
  tl.to("#bkWm", { scale: 1, duration: 0.55, ease: "power2.out" }, I + 0.08);
  tl.to("#bkWm", { x: -46, duration: ${Math.min(1.85, Math.max(0.6, X - I - 0.3)).toFixed(2)}, ease: "sine.inOut" }, I + 0.20);
  tl.to("#bkWm", { opacity: 0, duration: 0.22, ease: "power1.in" }, X - 0.12);`;
  // ---- FG: the BREAKING banner takeover (in front of the subject) ----
  const fgCss = `
  #bkBanner { position:absolute; left:0; top:${bannerTop}px; width:${W}px; height:${bannerH}px;
              background:${RED}; opacity:0; box-shadow:0 10px 30px rgba(0,0,0,0.40); }
  #bkBtag { position:absolute; left:28px; top:12px; color:#fff; opacity:0.92;
            font-family:'${dna.fonts.body}', sans-serif; font-weight:700;
            font-size:20px; letter-spacing:5px; }
  #bkWrap { position:absolute; left:${Math.round(W / 2)}px; top:${bannerTop + Math.round(bannerH * 0.56)}px; }
  #bkIn { display:block; white-space:nowrap; color:#fff;
          font-family:'${dna.fonts.hero}', sans-serif; font-size:${HG.fontPx}px; line-height:1;
          letter-spacing:0.02em; text-shadow:0 4px 14px rgba(40,0,0,0.35); }
  #bkClock { position:absolute; right:36px; top:34px; width:172px; height:40px; border-radius:4px;
             background:rgba(8,16,30,0.62); opacity:0; text-align:center; perspective:420px; }
  #bkClock .cv { line-height:40px; color:#fff; font-family:'${dna.fonts.tag}', monospace;
                 font-size:27px; letter-spacing:1px; }`;
  const fgHtml = `      <div id="bkBanner"><div id="bkBtag">${esc(p.tag || "BREAKING NEWS")}</div></div>
      <div id="bkWrap"><span id="bkIn">${esc(heroText)}</span></div>
      <div id="bkClock"><div class="cv">${esc(breakClock)}</div></div>`;
  const fgJs = `
  // ---- setpiece: BREAKAWAY banner (in front of the subject, on the chyron) ----
  { const I = ${I.toFixed(3)}, C = ${C.toFixed(3)}, X = ${X.toFixed(3)}, RED = ${J(RED)};
  // banner slams DOWN from above the chyron (scaleY 0→1) and digs in
  gsap.set("#bkBanner", { transformOrigin: "50% 0%", scaleY: 0 });
  gsap.set("#bkWrap", { xPercent: -50, yPercent: -50, opacity: 0 });
  tl.set("#bkBanner", { opacity: 1 }, I - 0.02);
  tl.to("#bkBanner", { scaleY: 1.05, duration: 0.10, ease: "power4.in" }, I - 0.02);
  tl.to("#bkBanner", { scaleY: 1, duration: 0.22, ease: "elastic.out(1, 0.45)" }, I + 0.09);
  // the word stamps: crush → 2-frame contact squash → elastic settle
  tl.set("#bkWrap", { opacity: 1, scale: 1.6, transformOrigin: "50% 60%" }, I);
  tl.to("#bkWrap", { scale: 1, duration: 0.09, ease: "power4.in" }, I);
  tl.set("#bkWrap", { scaleX: 1.07, scaleY: 0.93 }, C);
  tl.to("#bkWrap", { scaleX: 1, scaleY: 1, duration: 0.26, ease: "elastic.out(1, 0.4)" }, C + 0.083);
  // 3-flash strobe: red/white inversion sets
  ${J(flashes)}.forEach((off) => { const s = C + off;
    tl.set("#bkBanner", { backgroundColor: "#ffffff" }, s);
    tl.set(["#bkIn", "#bkBtag"], { color: RED }, s);
    tl.set("#bkBanner", { backgroundColor: RED }, s + 0.042);
    tl.set(["#bkIn", "#bkBtag"], { color: "#ffffff" }, s + 0.042);
  });
  // corner BREAKING clock flips in over the timestamp
  tl.set("#bkClock", { opacity: 1, rotationX: 90, backgroundColor: "rgba(210,35,42,0.92)" }, C - 0.05);
  tl.to("#bkClock", { rotationX: 0, duration: 0.07, ease: "power2.out" }, C - 0.04);
  tl.set("#bkClock", { opacity: 0 }, X - 0.1);
  // hold life: word breathes, banner light pulses, tag blinks slow
  tl.to("#bkIn", { scale: 1.018, duration: 0.45, yoyo: true, repeat: 2,
                   ease: "sine.inOut", transformOrigin: "50% 50%" }, C + 0.5);
  tl.fromTo("#bkBanner", { filter: "brightness(1)" },
                         { filter: "brightness(1.07)", duration: 0.6, yoyo: true,
                           repeat: 1, ease: "sine.inOut" }, C + 0.65);
  [[C+0.55,0.6],[C+0.95,0.92],[C+1.35,0.6],[C+1.70,0.92]].forEach(([t,o]) => {
    if (t < X - 0.05) tl.set("#bkBtag", { opacity: o }, t); });
  // EXIT: banner collapses to a 2px line the ticker absorbs
  tl.to("#bkWrap", { opacity: 0, duration: 0.08, ease: "power1.in" }, X);
  tl.set("#bkBanner", { transformOrigin: "50% 100%" }, X + 0.01);
  tl.to("#bkBanner", { scaleY: 0.02, duration: 0.13, ease: "power4.in" }, X + 0.02);
  tl.to("#bkBanner", { y: ${bannerH - 2}, duration: 0.16, ease: "power2.in" }, X + 0.18);
  tl.set("#bkBanner", { opacity: 0 }, X + 0.33);
  tl.set("#cyglow", { opacity: 0.9 }, X + 0.31);   // the ticker takes the hit
  tl.set("#cyglow", { opacity: 0 }, X + 0.345); }`;
  return { css, html, js, fgCss, fgHtml, fgJs };
}

function setpieceLasercage() {
  // LASER CAGE: concert blackout — the plate dims and haze cones breathe in
  // the top corners; a 6-beam laser array (alternating accent/magenta,
  // emitters along the top edge) snaps on and SWEEPS to converge on the word
  // center, a hot core pops at convergence, and the word IGNITES behind the
  // subject with an additive glow stack (wide blur + magenta fringe + tight
  // blur + core): crush → contact squash → elastic settle + 2 controlled
  // strobe pops. A criss-cross beam CAGE draws itself around the word rect
  // and flickers; during the hold the array FANS OUT slowly behind the word
  // (the iconic concert fan) while the word looms. Exit: the beams sweep away
  // L→R carrying the letters (streak + blur) and the room lifts back up.
  const I = heroIn;
  const X0 = +(heroOut - 0.38).toFixed(3); // beams-carry-the-letters exit
  const A = dna.palette.accent,
    MG = dna.palette.magenta || "#ff4df0";
  const CORE = dna.palette.core || "#eefff5",
    SOFT = dna.palette.glowSoft || "#c9ffe2";
  const fpx = HG.fontPx,
    halfW = Math.round(HG.halfW),
    cx = HG.x,
    cy = HG.y;
  // emitters along the top edge, initial aim points, fan-out floor targets
  // (demo geometry expressed as frame fractions)
  const EMX = [-0.023, 0.141, 0.352, 0.648, 0.859, 1.023].map((f) => Math.round(W * f));
  const EMY = [-20, -45, -55, -55, -45, -20];
  const STX = [0.164, 0.828, 0.313, 0.688, 0.406, 0.594].map((f) => Math.round(W * f));
  const FANX = [0.094, 0.258, 0.426, 0.574, 0.742, 0.906].map((f) => Math.round(W * f));
  const FANY = [0.75, 0.9, 0.97, 0.97, 0.9, 0.75].map((f) => Math.round(H * f));
  // beam-grid cage around the word rect (extents derive from halfW + fontPx)
  const CAGE = [
    [cx - (halfW + 90), cy + 0.76 * fpx, cx + (halfW + 90), cy - 0.68 * fpx, A, 0.5],
    [cx - (halfW + 90), cy - 0.68 * fpx, cx + (halfW + 90), cy + 0.76 * fpx, MG, 0.42],
    [cx - (halfW - 80), cy + 1.0 * fpx, cx + (halfW - 80), cy - 0.92 * fpx, A, 0.5],
    [cx - (halfW - 80), cy - 0.92 * fpx, cx + (halfW - 80), cy + 1.0 * fpx, MG, 0.42],
    [cx - (halfW + 40), cy - 0.74 * fpx, cx + (halfW + 40), cy - 0.74 * fpx, A, 0.45],
    [cx - (halfW + 40), cy + 0.82 * fpx, cx + (halfW + 40), cy + 0.82 * fpx, MG, 0.4],
  ].map((c) => c.map((v) => (typeof v === "number" ? Math.round(v) : v)));
  const spillW = 2 * halfW + 240,
    spillH = Math.round(fpx * 5.2);
  const hazeW = Math.round(W * 0.656),
    hazeH = H + 60;
  const blurBig = Math.round(0.22 * fpx),
    blurTight = Math.max(3, Math.round(0.07 * fpx)),
    fringeOff = Math.max(2, Math.round(0.03 * fpx));
  // hold-life choreography only with runway before the exit
  const strobeTs = [I + 0.5, I + 1.08].filter((t) => t < X0 - 0.25);
  const fanDur = +Math.max(0.4, Math.min(1.0, X0 - (I + 0.62 + 5 * 0.04) - 0.05)).toFixed(2);
  const flickDur = +Math.max(0.4, Math.min(1.2, X0 - 0.05 - (I + 0.6))).toFixed(2);
  const lstag = +Math.min(
    0.025,
    Math.max(0.008, (DUR - 0.25 - (X0 + 0.02)) / Math.max(1, heroText.length - 1)),
  ).toFixed(4);
  const css = `
  #dimC { position:absolute; inset:0; background:#000; opacity:0; }
  #hazeLc { position:absolute; left:-150px; top:-130px; width:${hazeW}px; height:${hazeH}px; opacity:0;
           background: radial-gradient(58% 95% at 12% 4%, ${A}80 0%, ${A}00 68%);
           filter: blur(10px); }
  #hazeRc { position:absolute; right:-150px; top:-130px; width:${hazeW}px; height:${hazeH}px; opacity:0;
           background: radial-gradient(58% 95% at 88% 4%, ${MG}6b 0%, ${MG}00 68%);
           filter: blur(10px); }
  #spillC { position:absolute; left:${cx}px; top:${cy}px; width:${spillW}px; height:${spillH}px; opacity:0;
           background: radial-gradient(50% 50% at 50% 50%, ${A}8c 0%, ${A}00 70%);
           mix-blend-mode:screen; }
  #lasersC { position:absolute; inset:0; }
  #hotC { position:absolute; left:${cx}px; top:${cy}px; width:130px; height:130px; opacity:0;
         background: radial-gradient(circle, rgba(235,255,244,0.95) 0%, ${A}99 42%, ${A}00 72%);
         filter: blur(4px); mix-blend-mode:screen; }
  #apexC { position:absolute; left:${cx}px; top:${cy}px; opacity:0; white-space:nowrap;
          font-family:'${dna.fonts.hero}', sans-serif; font-size:${fpx}px; line-height:1; letter-spacing:0.02em; }
  .clayer { position:absolute; left:0; top:0; }
  #cglow  { color:${A}; filter:blur(${blurBig}px); opacity:0; mix-blend-mode:screen; }
  #cglow2 { color:${SOFT}; filter:blur(${blurTight}px); opacity:0; mix-blend-mode:screen; }
  #cfringe{ color:${MG}; left:${fringeOff}px; top:${fringeOff}px; opacity:0; }
  #cword  { position:relative; color:${CORE};
            text-shadow: 0 0 16px ${A}d9, 0 0 44px ${A}80, 0 2px 8px rgba(0,0,0,0.55); }
  #cword .L { display:inline-block; }`;
  const html = `      <div id="dimC"></div>
      <div id="hazeLc"></div><div id="hazeRc"></div>
      <div id="spillC"></div>
      <svg id="lasersC" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <g id="gB"></g><g id="gC"></g>
      </svg>
      <div id="hotC"></div>
      <div id="apexC">
        <div class="clayer" id="cglow">${esc(heroText)}</div>
        <div class="clayer" id="cfringe">${esc(heroText)}</div>
        <div class="clayer" id="cglow2">${esc(heroText)}</div>
        <div id="cword"></div>
      </div>`;
  const js = `
  // ---- setpiece: LASERCAGE (6-beam converge → ignite → cage → fan-out → carried exit) ----
  const I = ${I.toFixed(3)}, X0 = ${X0.toFixed(3)};
  const CACC = ${J(A)}, CMAG = ${J(MG)};
  const NSC = "http://www.w3.org/2000/svg";
  gsap.set("#apexC", { xPercent: -50, yPercent: -50, transformOrigin: "50% 50%" });
  gsap.set(["#spillC", "#hotC"], { xPercent: -50, yPercent: -50 });

  // apex word as letters (for the carried-away exit)
  const cw = document.getElementById("cword");
  const cletters = [];
  for (const ch of ${J(heroText)}) {
    const s = document.createElement("span");
    s.className = "L"; s.textContent = ch === " " ? "\\u00a0" : ch;
    cw.appendChild(s); cletters.push(s);
  }

  // ---- 6-beam array (emitters along the top edge, alternating accent/magenta)
  const gB = document.getElementById("gB"), gC = document.getElementById("gC");
  const EM = ${J(EMX.map((x, i) => [x, EMY[i]]))};
  const STARTX = ${J(STX)};
  const FAN = ${J(FANX.map((x, i) => [x, FANY[i]]))};
  function mkLnC(parent, x1, y1, x2, y2, col, w) {
    const l = document.createElementNS(NSC, "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke", col); l.setAttribute("stroke-width", w);
    l.setAttribute("stroke-linecap", "round");
    l.style.opacity = 0; parent.appendChild(l); return l;
  }
  const cbeams = [];
  for (let i = 0; i < 6; i++) {
    const col = i % 2 ? CMAG : CACC;
    const halo = mkLnC(gB, EM[i][0], EM[i][1], STARTX[i], ${cy + 4}, col, 6);
    const core = mkLnC(gB, EM[i][0], EM[i][1], STARTX[i], ${cy + 4}, col, 1.6);
    core.style.filter = "drop-shadow(0 0 6px " + col + ")";
    cbeams.push([halo, core]);
  }

  // ---- beam-grid cage around the word rect
  const ccage = ${J(CAGE)}.map(([x1, y1, x2, y2, col, op]) => {
    const el = mkLnC(gC, x1, y1, x2, y2, col, 1.2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    el.setAttribute("stroke-dasharray", len);
    el.setAttribute("stroke-dashoffset", len);
    return { el, len, op };
  });

  // ===== WORLD: concert blackout + haze cones
  tl.fromTo("#dimC", { opacity: 0 }, { opacity: ${dna.plate.dim}, duration: 0.35, ease: "power1.out" }, 0.03);
  tl.to(["#hazeLc","#hazeRc"], { opacity: 0.08, duration: 0.5, ease: "power1.out" }, 0.15);

  // ===== CHARGE: room deepens, 6 beams snap on and sweep to center
  tl.to("#dimC", { opacity: ${dna.plate.charge}, duration: 0.26, ease: "power2.in" }, I - 0.31);
  tl.to(["#hazeLc","#hazeRc"], { opacity: 0.10, duration: 0.28 }, I - 0.29);
  cbeams.forEach((els, i) => {
    const t0 = I - 0.26 + i * 0.022;
    tl.set(els[0], { opacity: 0.26 }, t0);
    tl.set(els[1], { opacity: 0.95 }, t0);
    tl.to(els, { attr: { x2: ${cx}, y2: ${cy} }, duration: 0.16, ease: "power2.inOut" }, t0);
  });
  tl.fromTo("#hotC", { opacity: 0, scale: 0.4 },
            { opacity: 0.6, scale: 1, duration: 0.1, ease: "power2.in" }, I - 0.11);
  tl.to("#hotC", { scale: 2.8, opacity: 0, duration: 0.2, ease: "expo.out" }, I);

  // ===== IGNITE: crush in → contact squash → elastic settle; additive glow stack
  tl.set("#apexC", { opacity: 1, scale: 1.16 }, I - 0.02);
  tl.to("#apexC",  { scale: 1, duration: 0.09, ease: "power4.in" }, I - 0.018);
  tl.set("#apexC", { scaleX: 1.09, scaleY: 0.92 }, I + 0.08);
  tl.to("#apexC",  { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.38)" }, I + 0.165);
  tl.set("#cglow",  { opacity: 0.95 }, I);
  tl.set("#cglow2", { opacity: 0.60 }, I);
  tl.set("#cfringe",{ opacity: 0.30 }, I);
  tl.set("#cword",  { filter: "brightness(1.9)" }, I);
  tl.to("#cword",   { filter: "brightness(1)", duration: 0.3, ease: "power2.out" }, I + 0.08);
  tl.to("#cglow",   { opacity: 0.55, duration: 0.45, ease: "power2.out" }, I + 0.15);
  tl.to("#cglow2",  { opacity: 0.38, duration: 0.45, ease: "power2.out" }, I + 0.15);
  tl.set("#dimC", { opacity: ${(dna.plate.charge - 0.06).toFixed(2)} }, I + 0.05);
  tl.to("#dimC",  { opacity: ${(dna.plate.charge - 0.1).toFixed(2)}, duration: 0.8, ease: "power1.out" }, I + 0.2);
  tl.set("#spillC", { opacity: 0.22 }, I + 0.02);
  tl.to("#spillC",  { opacity: 0.12, duration: 0.2, ease: "power2.out" }, I + 0.25);

  // ===== CAGE draws around the word
  ccage.forEach((c, i) => {
    const t = I + 0.08 + i * 0.03;
    tl.set(c.el, { opacity: c.op }, t);
    tl.to(c.el, { attr: { "stroke-dashoffset": 0 }, duration: 0.18, ease: "power2.out" }, t);
  });
  tl.to(ccage.map((c) => c.el),
        { keyframes: { opacity: [0.48, 0.36, 0.44, 0.34, 0.42, 0.38] }, duration: ${flickDur}, ease: "none" },
        I + 0.6);

  // ===== controlled strobe pops (with the ignite flash: events spread > 1s)
  ${J(strobeTs.map((t) => +t.toFixed(3)))}.forEach((t) => {
    tl.set("#apexC", { filter: "brightness(2.05)" }, t);
    tl.set("#apexC", { filter: "brightness(1)" }, t + 0.05);
    tl.set("#spillC", { opacity: 0.27 }, t);
    tl.to("#spillC",  { opacity: 0.12, duration: 0.3, ease: "power2.out" }, t + 0.05);
  });

  // ===== FAN OUT: the iconic fan opens behind the word during the hold
  cbeams.forEach((els, i) => {
    const t = I + 0.62 + i * 0.04;
    tl.to(els, { attr: { x2: FAN[i][0], y2: FAN[i][1] }, duration: ${fanDur}, ease: "power1.inOut" }, t);
    tl.to(els[0], { opacity: 0.18, duration: 0.4 }, t);
    tl.to(els[1], { opacity: 0.50, duration: 0.4 }, t);
  });
  tl.to(["#hazeLc","#hazeRc"], { opacity: 0.16, duration: 0.6, ease: "power1.inOut" }, I + 0.35);

  // ===== HOLD LIFE: loom breathe + glow flicker
  tl.to("#apexC", { scale: 1.03, duration: 0.6, ease: "sine.inOut" }, I + 0.8);
  tl.to("#apexC", { scale: 1.0,  duration: 0.6, ease: "sine.inOut" }, I + 1.4);
  tl.to("#cglow", { keyframes: { opacity: [0.55, 0.42, 0.52, 0.40, 0.48, 0.45] },
                    duration: ${Math.min(1.15, Math.max(0.4, X0 - 0.06 - (I + 0.62))).toFixed(2)}, ease: "none" }, I + 0.62);

  // ===== EXIT: beams sweep away L→R carrying the letters
  ccage.forEach((c, i) => {
    tl.to(c.el, { attr: { "stroke-dashoffset": c.len }, duration: 0.16, ease: "power2.in" }, X0 + i * 0.02);
    tl.set(c.el, { opacity: 0 }, X0 + i * 0.02 + 0.17);
  });
  cletters.forEach((l, i) => {
    tl.to(l, { x: 44, opacity: 0, filter: "blur(6px)", duration: 0.16, ease: "power2.in" },
          X0 + 0.02 + i * ${lstag});
  });
  tl.to(["#cglow","#cglow2","#cfringe"], { x: 60, opacity: 0, duration: 0.22, ease: "power2.in" }, X0 + 0.06);
  cbeams.forEach((els, i) => {
    tl.to(els, { attr: { x2: "+=${Math.round(W * 0.742)}" }, duration: 0.28, ease: "power2.in" }, X0 + 0.02 + i * 0.03);
    tl.to(els, { opacity: 0, duration: 0.22 }, X0 + 0.04 + i * 0.03);
  });
  tl.to("#spillC", { opacity: 0, duration: 0.25 }, X0 - 0.01);
  tl.to("#dimC",   { opacity: 0.12, duration: 0.4, ease: "power1.in" }, X0 + 0.06);
  tl.to(["#hazeLc","#hazeRc"], { opacity: 0.03, duration: 0.4 }, X0 + 0.06);
  tl.set("#apexC", { display: "none" }, ${(DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceBoltstrike() {
  // THUNDER apex: the storm is the editor. A slate storm mood sits on the room
  // from t=0 and the sky "kisses" (1-frame brighten) on every body word —
  // double-kiss on emphasis words, re-flashes during the hold. Before the
  // strike the room charge-dims under a radial word scrim; a hand-authored
  // branched bolt (haze/glow/core stack) flashes 2 frames BEFORE the word
  // (leader → return stroke at contact) with a sky flash, then the word slams
  // in lit HARD (brightness 2.5 → 1) with its text-shadow flipped toward the
  // bolt for the flash frames; an ozone under-glow blooms and breathes through
  // the hold (loom + 2-frame lit blips on the sheet re-flashes); exit washes
  // downward with the rain.
  const p = dna.hero.params || {},
    I = heroIn;
  const A = dna.palette.accent, // ozone / bolt haze
    GL = dna.palette.glow || "#cfe8ff", // bolt glow
    CORE = dna.palette.core || "#ffffff", // bolt core
    HC = dna.palette.hero || dna.palette.body;
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.2, I + (p.hold ?? 2.05));
  const hpx = HG.fontPx,
    halfW = HG.halfW || heroText.length * 0.28 * hpx;
  // word scrim sized from the word rect (demo 1100×330 around a 720×145 word)
  const scW = Math.round(2 * halfW + 380),
    scH = Math.round(hpx * 2.28);
  // hand-authored branched bolt (5-seg zigzag + 2 branches) measured off the
  // demo cut — offsets from the word center in halfW (x) / fontPx (y) units;
  // the leader always enters from above the frame
  const sgn = p.side === "right" ? -1 : 1;
  const kx = ((halfW || 360) / 360) * sgn,
    ky = hpx / 145;
  const pts = (arr, top) =>
    arr
      .map(([dx, dy], k) => {
        const x = HG.x + dx * kx;
        let y = HG.y + dy * ky;
        if (top && k === 0) y = Math.min(y, -25);
        return `${Math.round(x)},${Math.round(y)}`;
      })
      .join(" ");
  const MAINP = pts(
    [
      [-45, -282],
      [-107, -134],
      [-23, -56],
      [-113, 66],
      [-17, 150],
      [-85, 268],
    ],
    true,
  );
  const BAP = pts([
    [-107, -134],
    [-183, -56],
    [-157, 10],
  ]);
  const BBP = pts([
    [-113, 66],
    [-187, 140],
    [-163, 200],
  ]);
  const wS = (w) => (w * ky).toFixed(1);
  const boltSvg = (color, w, wb) =>
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<polyline points="${MAINP}" fill="none" stroke="${color}" stroke-width="${wS(w)}" stroke-linejoin="miter" stroke-linecap="round"/>` +
    `<polyline points="${BAP}" fill="none" stroke="${color}" stroke-width="${wS(wb)}" stroke-linecap="round"/>` +
    `<polyline points="${BBP}" fill="none" stroke="${color}" stroke-width="${wS(wb)}" stroke-linecap="round"/>` +
    `</svg>`;
  // the sky kisses on every BODY word (the hero word is consumed by the slam)
  const kissData = LINES.flatMap((L) =>
    L.words.map((w) => [+w.start.toFixed(3), w.minor ? 1 : 0]),
  ).filter(([t]) => t < DUR - 0.1);
  const css = `
  #mood { position:absolute; inset:0; background:rgba(38,62,96,${p.mood ?? 0.1}); }
  #dimP { position:absolute; inset:0; opacity:0; background:#0a1422; }
  #kiss { position:absolute; inset:0; opacity:0;
          background:linear-gradient(to bottom, rgba(222,236,255,0.95) 0%, rgba(222,236,255,0.40) 38%, rgba(222,236,255,0) 72%); }
  #wordscrim { position:absolute; left:${HG.x}px; top:${HG.y}px; width:${scW}px; height:${scH}px;
          margin-left:-${Math.round(scW / 2)}px; margin-top:-${Math.round(scH / 2)}px; opacity:0; border-radius:50%;
          background:radial-gradient(50% 50% at 50% 50%, rgba(5,10,20,0.85) 0%, rgba(5,10,20,0.45) 55%, rgba(5,10,20,0) 100%); }
  #apex { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; }
  .aw { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
        font-family:'${dna.fonts.hero}', sans-serif; font-size:${hpx}px; line-height:1;
        letter-spacing:0.012em; white-space:nowrap; }
  #ozone { color:${A}; filter:blur(${Math.max(10, Math.round(26 * ky))}px); opacity:0; top:${Math.round(8 * ky)}px; }
  #aword { color:${HC};
           text-shadow: 0 8px 26px rgba(3,8,18,0.85), 0 2px 6px rgba(3,8,18,0.7), 0 0 18px ${A}59; }
  #bolt { position:absolute; inset:0; opacity:0; }
  .boltlayer { position:absolute; inset:0; }
  .boltlayer svg { position:absolute; inset:0; width:${W}px; height:${H}px; }
  #boltHaze { filter:blur(16px); opacity:0.55; }
  #boltGlow { filter:blur(5px); opacity:0.9; }
  #skyflash { position:absolute; inset:0; opacity:0;
          background:radial-gradient(120% 90% at 42% 22%, rgba(240,248,255,0.95) 0%, rgba(200,222,250,0.55) 45%, rgba(120,150,190,0) 100%); }`;
  const html = `      <div id="mood"></div>
      <div id="dimP"></div>
      <div id="kiss"></div>
      <div id="wordscrim"></div>
      <div id="apex">
        <div class="aw" id="ozone">${esc(heroText)}</div>
        <div class="aw" id="aword">${esc(heroText)}</div>
      </div>
      <div id="bolt">
        <div class="boltlayer" id="boltHaze">${boltSvg(A, 22, 13)}</div>
        <div class="boltlayer" id="boltGlow">${boltSvg(GL, 9, 5)}</div>
        <div class="boltlayer" id="boltCore">${boltSvg(CORE, 3.5, 2.2)}</div>
      </div>
      <div id="skyflash"></div>`;
  // breathe/loom clamp inside [contact, exit] for any clip length
  const breDur = Math.max(0.6, Math.min(1.5, EX - 0.23 - (I + 0.3)));
  const loomDur = Math.max(0.4, EX - 0.04 - (I + 0.74));
  const js = `
  // ---- setpiece: BOLTSTRIKE (storm charge → branched-bolt leader → word slams in lit) ----
  const I = ${I.toFixed(3)}, EXB = ${EX.toFixed(3)};

  // distant lightning KISS: 1-frame sky brighten on every body word
  const KISS = ${J(kissData)};
  KISS.forEach(([t, em]) => {
    tl.set("#kiss", { opacity: 0.06 }, t);
    tl.set("#kiss", { opacity: 0 }, t + F);
    if (em && t + 0.20 + 3 * F < ${(DUR - 0.04).toFixed(2)}) {
      // emphasis words get the sheet-lightning double kiss (matches the rail double flash)
      const t0 = t + 0.20;
      tl.set("#kiss", { opacity: 0.07 }, t0);
      tl.set("#kiss", { opacity: 0 },    t0 + F);
      tl.set("#kiss", { opacity: 0.06 }, t0 + 2 * F);
      tl.set("#kiss", { opacity: 0 },    t0 + 3 * F);
    }
  });
  // sheet re-flashes during the apex hold
  [I + 0.84, I + 1.44].forEach((t) => {
    if (t < EXB - 0.2) { tl.set("#kiss", { opacity: 0.08 }, t); tl.set("#kiss", { opacity: 0 }, t + F); }
  });

  // CHARGE: the storm gathers before the strike (ends before the bolt frames)
  tl.fromTo("#dimP", { opacity: 0 }, { opacity: ${dna.plate.charge || 0.3}, duration: 0.30, ease: "power2.in" }, I - 0.39);
  tl.fromTo("#wordscrim", { opacity: 0 }, { opacity: 0.42, duration: 0.30, ease: "power2.in" }, I - 0.39);

  // THE STRIKE: bolt flashes 2 frames before the word, return stroke at contact
  tl.set("#bolt", { opacity: 1 },    I - 2 * F);
  tl.set("#bolt", { opacity: 0.35 }, I - F);
  tl.set("#bolt", { opacity: 1 },    I);
  tl.to("#bolt",  { opacity: 0, duration: 0.07, ease: "power2.in" }, I + 0.045);

  tl.set("#skyflash", { opacity: 0.26 }, I - 2 * F);
  tl.set("#skyflash", { opacity: 0.10 }, I - F);
  tl.set("#skyflash", { opacity: 0.30 }, I + 0.02);
  tl.to("#skyflash",  { opacity: 0, duration: 0.22, ease: "expo.out" }, I + 0.06);

  // dim released by the flash, settles to a storm hold, lifts at the end
  tl.set("#dimP", { opacity: 0.08 }, I - 2 * F);
  tl.to("#dimP",  { opacity: ${dna.plate.dim || 0.22}, duration: 0.25, ease: "power2.out" }, I + 0.10);
  tl.to("#dimP",  { opacity: 0, duration: 0.40, ease: "power1.in" }, EXB - 0.14);
  tl.set("#wordscrim", { opacity: 0.32 }, I - 2 * F);
  tl.to("#wordscrim",  { opacity: 0.36, duration: 0.30 }, I + 0.10);
  tl.to("#wordscrim",  { opacity: 0, duration: 0.30 }, EXB - 0.04);

  // APEX WORD: slam transit → contact squash (2 frames) → elastic settle
  tl.set("#apex", { opacity: 1 }, I - 2 * F);
  tl.fromTo("#apex", { scale: 3.1 }, { scale: 1, duration: 0.105, ease: "power4.in" }, I - 2 * F);
  tl.fromTo("#aword", { filter: "blur(14px) brightness(3.2)" },
            { filter: "blur(0px) brightness(2.5)", duration: 0.105, ease: "power4.in" }, I - 2 * F);
  tl.set("#apex", { scaleX: 1.10, scaleY: 0.90 }, I + 0.025);
  tl.to("#apex",  { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1.05, 0.34)" }, I + 0.025 + 2 * F);
  // lit HARD for 2 frames, then cools
  tl.to("#aword", { filter: "blur(0px) brightness(1)", duration: 0.45, ease: "power2.out" }, I + 0.025 + 2 * F);

  // SIGNATURE: shadow flips toward the bolt (light from the strike side) for the flash frames
  tl.set("#aword", { textShadow: "${16 * sgn}px 6px 18px rgba(2,6,14,0.9), ${4 * sgn}px 2px 6px rgba(2,6,14,0.75), 0 0 26px ${A}b3" }, I - 2 * F);
  tl.set("#aword", { textShadow: "0 8px 26px rgba(3,8,18,0.85), 0 2px 6px rgba(3,8,18,0.7), 0 0 18px ${A}59" }, I + 0.09);

  // ozone under-glow blooms with the hit, breathes during hold
  tl.set("#ozone", { opacity: 0.85 }, I + 0.02);
  tl.to("#ozone", { keyframes: { opacity: [0.85, 0.5, 0.65, 0.42, 0.55, 0.38] },
                    duration: ${breDur.toFixed(2)}, ease: "none" }, I + 0.30);
  tl.to("#ozone", { opacity: 0.32, duration: 0.18 }, EXB - 0.22);

  // hold life: loom + 2-frame lit blips on the sheet re-flashes
  tl.to("#apex", { scale: 1.035, duration: ${loomDur.toFixed(2)}, ease: "power1.inOut" }, I + 0.74);
  [[I + 0.84, 1.45], [I + 1.44, 1.35]].forEach(([t, b2]) => {
    if (t < EXB - 0.2) {
      tl.set("#aword", { filter: "brightness(" + b2 + ")" }, t);
      tl.set("#aword", { filter: "brightness(1)" }, t + F);
    }
  });

  // EXIT: washes downward with the rain
  tl.to("#apex", { y: 38, opacity: 0, filter: "blur(6px)", duration: 0.22, ease: "power2.in" }, EXB);
  tl.set("#apex", { display: "none" }, ${Math.min(EX + 0.26, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceHoloboot() {
  // HOLOGRAM apex: full volumetric boot behind the subject. A desk emitter dot
  // pops, the projection cone SNAPS wide (scaleX expo), a seed beam fires up
  // from the emitter, and the word boots with a RISING clip sweep (opacity is
  // instant — the reveal is a wipe) into a 7-layer projection stack (dark
  // backing shadow / wide glow / magenta+cyan chromatic fringes / core /
  // scanline mask / climbing interference bands). Contact = over-bright flash
  // + squash held 2 frames + elastic settle + 1-frame x interference jumps;
  // fringes blow wide then settle to a constant registration offset. Hold
  // life: bands climb, rotationY oscillates, glow/cone breathe, emitter dot
  // pulses, slow loom; a hand "passes through" the projection (skew + blur +
  // fringe blowout, pure projection logic). Exit: the projector cut — the
  // word collapses to a horizontal line, then to the base dot. A second,
  // smaller emitter cone rises from the desk under the holorail plate all
  // video (the body rail is cast from the SAME projector grammar).
  const p = dna.hero.params || {},
    I = heroIn;
  const A = dna.palette.accent,
    MG = dna.palette.magenta || "#ff5fd6";
  const GLOW = dna.palette.glow || "#3eccf2",
    CORE = dna.palette.core || "#eafbff";
  const fpx = HG.fontPx,
    halfW = Math.round(HG.halfW || heroText.length * 0.4 * fpx),
    cx = HG.x,
    cy = HG.y;
  const k = fpx / 118; // demo scale unit (Orbitron 700 @ 118px)
  // apex rig geometry derives from the word rect
  const coneW = Math.min(2 * halfW + 80, W - 40);
  const coneTop = Math.round(cy - 0.55 * fpx);
  const emitY = Math.min(H - 30, Math.round(cy + 2.4 * fpx));
  const coneH = emitY - coneTop;
  const beamTop = coneTop + 40,
    beamH = emitY - beamTop;
  const cxP = ((cx / W) * 100).toFixed(1),
    cyP = ((cy / H) * 100).toFixed(1);
  // body-zone projector under the holorail plate (cone behind the subject)
  const plateBot = Math.round(H - (dna.body.bottomPx || 108) + (dna.body.plateH || 96) / 2);
  const bcW = p.coneW || 800,
    bcTop = plateBot - 4,
    bcH = H - bcTop - 4;
  // interference-band pitch scales with the type
  const bandH = Math.max(20, Math.round(fpx * 0.39));
  const bp = (f) => Math.round(bandH * f);
  // projector-cut exit + hold-life windows (all runway-clamped)
  const cutT = +Math.min(heroOut - 0.22, DUR - 0.3).toFixed(3);
  const C = I + 0.07; // contact
  const holdD = +Math.max(0.6, Math.min(1.72, cutT - 0.05 - (I + 0.24))).toFixed(2);
  const holdD2 = +Math.max(0.5, holdD - 0.1).toFixed(2);
  const reactD = +Math.max(0.3, Math.min(0.9, cutT - 0.3 - (I + 0.24))).toFixed(2);
  const loomD = +Math.min(0.62, Math.max(0.2, cutT - 0.3 - (I + 0.74))).toFixed(2);
  // the hand-pass needs the loom done (scale channel) and clear exit runway
  const passT = +Math.max(I + (p.passAt ?? 1.29), I + 1.25).toFixed(3);
  const doPass = passT + 0.65 < cutT - 0.05;
  const css = `
  #dimH { position:absolute; inset:0; opacity:0; background:#02101a; }
  #scrimH { position:absolute; inset:0; opacity:0;
           background: radial-gradient(58% 46% at ${cxP}% ${cyP}%, rgba(2,9,15,0.88) 0%, rgba(2,9,15,0.55) 48%, rgba(2,9,15,0) 78%); }
  #bcone { position:absolute; left:${Math.round(W / 2 - bcW / 2)}px; top:${bcTop}px; width:${bcW}px; height:${bcH}px; opacity:0;
           clip-path: polygon(0% 0%, 100% 0%, 51.6% 100%, 48.4% 100%);
           background: linear-gradient(to top, ${A}4d 0%, ${A}1a 55%, ${A}05 100%); }
  #bdot { position:absolute; left:${Math.round(W / 2 - 4.5)}px; top:${H - 10}px; width:9px; height:9px; border-radius:50%;
          background:${dna.palette.dot || "#bff0ff"}; opacity:0;
          box-shadow: 0 0 10px ${A}e6, 0 0 24px ${A}8c; }
  #apxcone { position:absolute; left:${Math.round(cx - coneW / 2)}px; top:${coneTop}px; width:${coneW}px; height:${coneH}px; opacity:0;
             clip-path: polygon(0% 0%, 100% 0%, 53% 100%, 47% 100%);
             background: linear-gradient(to top, ${A}57 0%, ${A}1f 50%, ${A}05 100%); }
  #apxbeam { position:absolute; left:${Math.round(cx - 2.5)}px; top:${beamTop}px; width:5px; height:${beamH}px; opacity:0;
             background: linear-gradient(to top, ${CORE}f2, ${CORE}1f);
             filter: blur(0.6px); }
  #apxdot { position:absolute; left:${Math.round(cx - 6.5)}px; top:${emitY - 6}px; width:13px; height:13px; border-radius:50%;
            background:${dna.palette.dotHot || "#dff8ff"}; opacity:0;
            box-shadow: 0 0 12px ${A}f2, 0 0 34px ${A}99; }
  #apx { position:absolute; left:${cx}px; top:${cy}px; opacity:0; }
  #apxclip { position:relative; }
  .aw { font-family:'${dna.fonts.hero}', sans-serif; font-weight:700; font-size:${fpx}px; line-height:1;
        letter-spacing:0; white-space:nowrap; }
  #adark { position:absolute; left:0; top:${Math.max(2, Math.round(3 * k))}px; color:rgba(1,12,20,0.92);
           filter:blur(${Math.max(4, Math.round(7 * k))}px); transform:scale(1.03); }
  #aglow { position:absolute; left:0; top:0; color:${GLOW}f2;
           filter:blur(${Math.max(8, Math.round(16 * k))}px); transform:scale(1.05); opacity:0.55; }
  #cmag  { position:absolute; left:0; top:0; color:${MG}8c; }
  #ccyn  { position:absolute; left:0; top:0; color:${A}99; }
  #acore { position:relative; color:${CORE};
           text-shadow: 0 0 22px ${A}73, 0 3px 14px rgba(1,10,16,0.55); }
  #ascan { position:absolute; left:0; top:0; color:transparent;
           -webkit-background-clip:text; background-clip:text;
           background-image: repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2.5px, rgba(2,12,18,0.62) 2.5px, rgba(2,12,18,0.62) 4px); }
  #abands { position:absolute; left:0; top:0; color:transparent; opacity:0;
            -webkit-background-clip:text; background-clip:text;
            background-image: repeating-linear-gradient(180deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0) ${bp(0.717)}px, ${dna.palette.band || "#d8faff"}f2 ${bp(0.783)}px, ${dna.palette.band || "#d8faff"}f2 ${bp(0.87)}px, rgba(255,255,255,0) ${bp(0.935)}px, rgba(255,255,255,0) ${bandH}px);
            background-size: 100% ${bandH}px; }`;
  const html = `      <div id="dimH"></div>
      <div id="scrimH"></div>
      <div id="bcone"></div>
      <div id="bdot"></div>
      <div id="apxcone"></div>
      <div id="apxbeam"></div>
      <div id="apxdot"></div>
      <div id="apx">
        <div id="apxclip">
          <div class="aw" id="adark">${esc(heroText)}</div>
          <div class="aw" id="aglow">${esc(heroText)}</div>
          <div class="aw" id="cmag">${esc(heroText)}</div>
          <div class="aw" id="ccyn">${esc(heroText)}</div>
          <div class="aw" id="acore">${esc(heroText)}</div>
          <div class="aw" id="ascan">${esc(heroText)}</div>
          <div class="aw" id="abands">${esc(heroText)}</div>
        </div>
      </div>`;
  // body-projector flicker cycles, baked to the clip length
  const coneFlicks = [];
  for (let t = 0.6; t + 2.2 <= DUR - 0.25; t += 2.3) coneFlicks.push(+t.toFixed(2));
  const dotPulses = [];
  let dt = 0.5;
  for (; dt + 2.0 <= DUR - 0.3; dt += 2.15) dotPulses.push(+dt.toFixed(2));
  const dotTail = dt + 1.0 <= DUR - 0.24 ? +dt.toFixed(2) : null;
  const js = `
  // ---- setpiece: HOLOBOOT (emitter pop → cone snap → seed beam → rising-sweep word boot) ----
  const I = ${I.toFixed(3)}, CUT = ${cutT.toFixed(3)};
  gsap.set("#apx", { xPercent: -50, yPercent: -50, transformPerspective: 900, transformOrigin: "50% 50%" });
  gsap.set("#apxcone", { transformOrigin: "50% 100%" });
  gsap.set("#apxbeam", { transformOrigin: "50% 100%" });
  gsap.set("#bcone",   { transformOrigin: "50% 100%" });
  gsap.set("#apxclip", { clipPath: "inset(100% 0% 0% 0%)" });

  // ===== body-zone projector boots with the rail (cone behind the subject)
  tl.set("#bdot", { opacity: 1 }, 0.06);
  tl.fromTo("#bdot", { scale: 0.2 }, { scale: 1, duration: 0.12, ease: "back.out(2)" }, 0.06);
  tl.set("#bcone", { opacity: 0.9 }, 0.08);
  tl.fromTo("#bcone", { scaleY: 0.05 }, { scaleY: 1, duration: 0.14, ease: "expo.out" }, 0.08);
  tl.set("#bcone", { opacity: 0.5 }, 0.22);
  tl.set("#bcone", { opacity: 0.9 }, 0.26);
  ${J(coneFlicks)}.forEach((t, i) => {
    tl.to("#bcone", { keyframes: { opacity: i % 2 ? [0.86, 0.72, 0.84, 0.7, 0.84] : [0.9, 0.74, 0.86, 0.72, 0.86] },
                      duration: 2.2, ease: "none" }, t);
  });
  ${J(dotPulses)}.forEach((t) => {
    tl.to("#bdot", { keyframes: { scale: [1, 1.3, 1, 1.25, 1] }, duration: 2.0, ease: "none" }, t);
  });
  ${dotTail != null ? `tl.to("#bdot", { keyframes: { scale: [1, 1.25, 1] }, duration: 1.0, ease: "none" }, ${dotTail});` : ""}
  // projector cut at the very end
  tl.to("#bcone", { opacity: 0, duration: 0.18, ease: "power1.in" }, ${(DUR - 0.2).toFixed(3)});
  tl.set("#bdot", { scale: 1.6 }, ${(DUR - 0.12).toFixed(3)});
  tl.set("#bdot", { opacity: 0 }, ${(DUR - 0.05).toFixed(3)});

  // ===== scene reaction: the room dims while the volumetric apex burns
  tl.fromTo("#scrimH", { opacity: 0 }, { opacity: ${dna.plate.scrim ?? 0.58}, duration: 0.34, ease: "power2.in" }, I - 0.21);
  tl.set("#dimH", { opacity: ${dna.plate.charge ?? 0.28} }, I - 0.05);
  tl.to("#dimH",   { opacity: ${dna.plate.dim ?? 0.18}, duration: ${reactD}, ease: "power2.out" }, I + 0.24);
  tl.to("#scrimH", { opacity: ${((dna.plate.scrim ?? 0.58) * 0.79).toFixed(2)}, duration: ${reactD}, ease: "power2.out" }, I + 0.24);
  tl.to(["#dimH","#scrimH"], { opacity: 0, duration: 0.4, ease: "power1.in" }, CUT - 0.12);

  // ===== APEX: full volumetric boot
  // 1. emitter dot pops, cone SNAPS wide
  tl.set("#apxdot", { opacity: 1 }, I - 0.135);
  tl.fromTo("#apxdot", { scale: 0.2 }, { scale: 1, duration: 0.12, ease: "back.out(2.4)" }, I - 0.135);
  tl.set("#apxcone", { opacity: 1 }, I - 0.125);
  tl.fromTo("#apxcone", { scaleX: 0.07 }, { scaleX: 1, duration: 0.11, ease: "expo.out" }, I - 0.125);
  tl.set("#apxcone", { opacity: 0.55 }, I - 0.01);
  tl.set("#apxcone", { opacity: 0.95 }, I + 0.035);
  // 2. seed beam fires up from the emitter
  tl.set("#apxbeam", { opacity: 1 }, I - 0.095);
  tl.fromTo("#apxbeam", { scaleY: 0 }, { scaleY: 1, duration: 0.085, ease: "power3.in" }, I - 0.095);
  tl.to("#apxbeam", { opacity: 0, duration: 0.3, ease: "power1.in" }, I + 0.11);
  // 3. the word boots with a RISING sweep (opacity instant, reveal is a wipe)
  tl.set("#apx", { opacity: 1 }, I - 0.055);
  tl.to("#apxclip", { clipPath: "inset(0% 0% 0% 0%)", duration: 0.125, ease: "power2.in" }, I - 0.055);
  tl.set("#apxclip", { clipPath: "none" }, I + 0.08); // free the glow bloom after the sweep
  // 4. contact: over-bright flash + squash held 2 frames + elastic settle
  tl.set("#apxclip", { filter: "brightness(2.3)" }, ${C.toFixed(3)});
  tl.to("#apxclip",  { filter: "brightness(1)", duration: 0.36, ease: "power2.out" }, ${(C + 0.05).toFixed(3)});
  tl.set("#apx", { scaleX: 1.07, scaleY: 0.91 }, ${C.toFixed(3)});
  tl.to("#apx",  { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.38)" }, ${(C + 0.084).toFixed(3)});
  // interference glitch on arrival (1-frame x jumps)
  tl.set("#apxclip", { x: 3 },  ${(C + 0.02).toFixed(3)});
  tl.set("#apxclip", { x: -3 }, ${(C + 0.062).toFixed(3)});
  tl.set("#apxclip", { x: 0 },  ${(C + 0.104).toFixed(3)});
  // chromatic fringes blow wide then settle to the constant offset
  tl.fromTo("#cmag", { x: -8 }, { x: -2, duration: 0.4, ease: "power2.out" }, ${C.toFixed(3)});
  tl.fromTo("#ccyn", { x: 8 },  { x: 2,  duration: 0.4, ease: "power2.out" }, ${C.toFixed(3)});

  // ===== hold life: interference bands climb, rotateY oscillates, glow breathes, loom
  tl.set("#abands", { opacity: 0.55, backgroundPosition: "0px 0px" }, I + 0.24);
  tl.to("#abands", { backgroundPosition: "0px -${6 * bandH}px", duration: ${holdD}, ease: "none" }, I + 0.24);
  tl.to("#apx", { keyframes: { rotationY: [0, 6, -7, 5, 0] }, duration: ${holdD}, ease: "none" }, I + 0.24);
  tl.to("#aglow", { keyframes: { opacity: [0.55, 0.4, 0.52, 0.38, 0.5] }, duration: ${holdD2}, ease: "none" }, I + 0.29);
  tl.to("#apxcone", { keyframes: { opacity: [0.95, 0.78, 0.9, 0.76, 0.88] }, duration: ${holdD2}, ease: "none" }, I + 0.29);
  tl.to("#apxdot", { keyframes: { scale: [1, 1.4, 1, 1.35, 1, 1.3, 1] }, duration: ${holdD2}, ease: "none" }, I + 0.29);
  ${loomD >= 0.2 ? `tl.to("#apx", { scale: 1.028, duration: ${loomD}, ease: "sine.inOut" }, I + 0.74);` : ""}
${
  doPass
    ? `
  // ===== a hand "passes through" the projection: pure projection logic
  const P = ${passT.toFixed(3)};
  tl.set("#apx", { skewX: 6 }, P);
  tl.set("#apxclip", { filter: "blur(2.5px) brightness(1.35)" }, P);
  tl.set("#cmag", { x: -7 }, P);
  tl.set("#ccyn", { x: 7 },  P);
  tl.set("#apx", { skewX: -4 }, P + 0.042);
  tl.set("#apxclip", { filter: "blur(1px)" }, P + 0.083);
  tl.set("#apx", { skewX: 0 }, P + 0.125);
  tl.set("#apxclip", { filter: "none" }, P + 0.125);
  tl.to("#cmag", { x: -2, duration: 0.18, ease: "power2.out" }, P + 0.05);
  tl.to("#ccyn", { x: 2,  duration: 0.18, ease: "power2.out" }, P + 0.05);
  tl.set("#apx", { scaleY: 0.97 }, P + 0.13);
  tl.to("#apx", { scaleY: 1, duration: 0.3, ease: "elastic.out(1, 0.4)" }, P + 0.172);`
    : ""
}

  // ===== EXIT: projector cut — collapse to a horizontal line, then to the base dot
  tl.set("#apxclip", { filter: "brightness(2.4)" }, CUT - 0.02);
  tl.to("#apx", { scaleY: 0.018, duration: 0.09, ease: "power3.in" }, CUT);
  tl.to("#apx", { scaleX: 0.015, duration: 0.075, ease: "power3.in" }, CUT + 0.10);
  tl.set("#apx", { opacity: 0 }, CUT + 0.18);
  tl.to("#apxcone", { opacity: 0, duration: 0.16, ease: "power1.in" }, CUT + 0.02);
  tl.set("#apxdot", { scale: 2.2 }, CUT + 0.12);
  tl.to("#apxdot", { opacity: 0, duration: 0.09, ease: "power2.in" }, CUT + 0.18);`;
  return { css, html, js };
}

function setpieceBiobloom() {
  // BIOLUME apex: a bioluminescent BLOOM behind the subject. The abyss grade
  // (params.mood) + a breathing vignette sit on the room from t=0 — the world
  // IS underwater before anything speaks. A creature pre-glow gathers with a
  // double-beat anticipation and crushes to a point; a dark pocket scrim
  // (plate.scrim) opens behind the word zone; the word CONDENSES in (scale
  // 2.35 crush power4.in 0.11s, blur 15→2, brightness 2.6→1.7) → 2-frame
  // contact squash → elastic settle while cyan light SPILLS onto the scene;
  // 6 luminous tendrils (blurred SVG strokes, cyan/violet alternating) draw
  // outward from the word rect, staggered; through the hold the glow breathes
  // 8–14%, two counter-drifting caustic gradients shimmer over the text zone
  // and the bloom drifts slowly with the current (params.drift). Exit: the
  // light SINKS — every glowing thing drifts down while dimming. Tendril
  // geometry is hand-authored from the demo and baked at compile time as
  // offsets from the word center (halfW/x × fontPx/120 units, frame-clamped).
  const p = dna.hero.params || {},
    I = heroIn;
  const A = dna.palette.accent,
    VIO = dna.palette.violet || "#9d7bff",
    ICE = dna.palette.ice || "#8fe8ff",
    CORE = dna.palette.core || "#f2fffd";
  const fpx = HG.fontPx,
    halfW = Math.round(HG.halfW || heroText.length * 0.33 * fpx),
    cx = HG.x,
    cy = HG.y;
  const ky = fpx / 120; // demo scale unit (Fredoka 700 @ 120px)
  const demoHalf = (wordPx("RECOVER", dna.fonts.hero, 120, 0.01) || 562) / 2;
  const kx = halfW / demoHalf;
  const TX = (x) => Math.round(Math.max(16, Math.min(W - 16, cx + (x - 560) * kx)));
  const TY = (y) => Math.round(Math.max(16, Math.min(H - 16, cy + (y - 300) * ky)));
  // 6 tendril cubics: anchors on the word rect edge, filaments reaching out
  const TENDRILS = [
    [
      [340, 268],
      [255, 230],
      [195, 185],
      [135, 110],
    ],
    [
      [525, 244],
      [500, 185],
      [560, 140],
      [520, 70],
    ],
    [
      [725, 262],
      [795, 222],
      [850, 180],
      [915, 112],
    ],
    [
      [365, 332],
      [280, 372],
      [215, 425],
      [150, 492],
    ],
    [
      [580, 352],
      [605, 415],
      [545, 465],
      [585, 530],
    ],
    [
      [715, 335],
      [790, 380],
      [855, 425],
      [920, 475],
    ],
  ].map((pts) => {
    const q = pts.map(([x, y]) => TX(x) + " " + TY(y));
    return `M ${q[0]} C ${q[1]}, ${q[2]}, ${q[3]}`;
  });
  const TCOL = [A, VIO, ICE, A, VIO, A];
  const C = +(I + (p.crush ?? 0.11)).toFixed(3); // contact
  const SINK = +Math.min(heroOut - 0.2, DUR - 0.3).toFixed(3);
  // tendril stagger auto-clamps so the last filament completes before the sink
  const stag = +Math.max(0.02, Math.min(0.05, (SINK - 0.46 - (C + 0.02)) / 5)).toFixed(3);
  const breatheD = +Math.min(0.72, Math.max(0.3, DUR - 0.06 - (C + 0.12))).toFixed(2);
  const flickD = +Math.min(0.7, SINK - 0.02 - (C + 0.34)).toFixed(2);
  const shimD = +Math.min(0.5, Math.max(0.2, SINK + 0.03 - (C + 0.21))).toFixed(2);
  const driftD = +Math.min(0.64, Math.max(0.2, SINK - (I + 0.21))).toFixed(2);
  const wordFlickT = I + 0.59 + 0.32 <= SINK + 0.05 ? +(I + 0.59).toFixed(3) : null;
  // geometry derived from the word rect
  const pkW = Math.round(2 * halfW + 280),
    pkH = Math.round(2.5 * fpx);
  const pgW = Math.round(1.083 * fpx),
    pgH = Math.round(0.717 * fpx);
  const cxP = ((cx / W) * 100).toFixed(1),
    cyP = ((cy / H) * 100).toFixed(1);
  const css = `
  #abyss { position:absolute; inset:0; opacity:${p.mood ?? 0.92};
           background:linear-gradient(180deg, rgba(3,11,26,0.52) 0%, rgba(3,11,26,0.30) 30%,
                       rgba(4,9,20,0.10) 52%, rgba(2,7,16,0.18) 78%, rgba(1,5,12,0.34) 100%); }
  #vig { position:absolute; inset:0; opacity:0.75;
         background:radial-gradient(120% 110% at 50% 46%, rgba(0,0,0,0) 36%,
                     rgba(2,8,20,0.45) 66%, rgba(1,4,12,0.95) 100%); }
  #pocket { position:absolute; left:${cx - Math.round(pkW / 2)}px; top:${cy - Math.round(pkH / 2)}px;
            width:${pkW}px; height:${pkH}px; opacity:0;
            background:radial-gradient(50% 50% at 50% 50%, rgba(1,8,18,0.72) 0%,
                        rgba(1,8,18,0.40) 55%, rgba(1,8,18,0) 78%); }
  #spill { position:absolute; inset:0; opacity:0;
           background:radial-gradient(58% 46% at ${cxP}% ${cyP}%, ${A}80 0%,
                       ${A}2b 42%, ${A}00 74%); }
  .cau { position:absolute; left:${Math.round(W * 0.0625)}px; top:${Math.round(H * 0.069)}px;
         width:${Math.round(W * 0.781)}px; height:${Math.round(H * 0.75)}px; opacity:0; }
  #cauA { background:radial-gradient(46% 42% at 42% 46%, ${ICE}d9 0%, ${ICE}00 68%); }
  #cauB { background:radial-gradient(44% 46% at 58% 52%, ${VIO}bf 0%, ${VIO}00 66%); }
  #preglow { position:absolute; left:${cx}px; top:${cy}px; width:${pgW}px; height:${pgH}px;
             margin-left:-${Math.round(pgW / 2)}px; margin-top:-${Math.round(pgH / 2)}px;
             border-radius:50%; opacity:0;
             background:radial-gradient(50% 50% at 50% 50%, rgba(170,255,242,0.95) 0%,
                         ${A}80 45%, ${A}00 75%);
             filter:blur(${Math.max(6, Math.round(10 * ky))}px); }
  #tndwrap { position:absolute; inset:0; }
  #tnd { position:absolute; inset:0; width:${W}px; height:${H}px; }
  #gGlow { filter:blur(5px); }
  #gCore { filter:blur(1.1px); }
  #tnd path { fill:none; stroke-linecap:round; opacity:0; }
  #apex { position:absolute; left:${cx}px; top:${cy}px; opacity:0; }
  .aw { position:absolute; left:0; top:0; white-space:nowrap;
        font-family:'${dna.fonts.hero}', sans-serif; font-weight:700; font-size:${fpx}px;
        line-height:1; letter-spacing:0.01em; }
  #aglow { color:${A}; filter:blur(${Math.max(10, Math.round(18 * ky))}px); opacity:0; }
  #aword { color:${CORE};
           text-shadow: 0 0 ${Math.round(18 * ky)}px ${A}f2, 0 0 ${Math.round(46 * ky)}px ${A}8c,
                        0 0 ${Math.round(100 * ky)}px ${VIO}80, 0 4px ${Math.round(22 * ky)}px rgba(1,8,16,0.7); }`;
  const html = `      <div id="abyss"></div>
      <div id="vig"></div>
      <div id="pocket"></div>
      <div id="spill"></div>
      <div class="cau" id="cauA"></div>
      <div class="cau" id="cauB"></div>
      <div id="preglow"></div>
      <div id="tndwrap">
        <svg id="tnd" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
          <g id="gGlow"></g>
          <g id="gCore"></g>
        </svg>
      </div>
      <div id="apex">
        <div class="aw" id="aglow">${esc(heroText)}</div>
        <div class="aw" id="aword">${esc(heroText)}</div>
      </div>`;
  const js = `
  // ---- setpiece: BIOBLOOM (pre-glow gathers → word condenses → tendrils draw → light sinks) ----
  const BI = ${I.toFixed(3)}, BC = ${C.toFixed(3)}, SINK = ${SINK.toFixed(3)};
  gsap.set(["#aglow", "#aword"], { xPercent: -50, yPercent: -50 });
  gsap.set("#apex", { transformOrigin: "0px 0px" });
  gsap.set("#preglow", { scale: 0.6 });

  // ===== the abyss breathes (whole clip) =====
  tl.to("#vig", { keyframes: { opacity: [0.8, 0.72, 0.83, 0.74, 0.81, 0.76] },
                  duration: ${(DUR - 0.09).toFixed(2)}, ease: "sine.inOut" }, 0.03);

  // ===== light tendrils (SVG, drawn outward from the word rect) =====
  const TND = ${J(TENDRILS)};
  const TCOL = ${J(TCOL)};
  const NS = "http://www.w3.org/2000/svg";
  const gGlow = document.getElementById("gGlow");
  const gCore = document.getElementById("gCore");
  const tpaths = [];
  TND.forEach((d, i) => {
    const mk = (g, w) => {
      const pp = document.createElementNS(NS, "path");
      pp.setAttribute("d", d); pp.setAttribute("stroke", TCOL[i]);
      pp.setAttribute("stroke-width", w); g.appendChild(pp);
      const L = pp.getTotalLength();
      gsap.set(pp, { strokeDasharray: L, strokeDashoffset: L });
      return pp;
    };
    tpaths.push([mk(gGlow, ${Math.max(6, Math.round(9 * ky))}), mk(gCore, ${Math.max(2, Math.round(3 * ky))})]);
  });

  // ===== anticipation: a creature approaches — double-beat pre-glow =====
  tl.to("#preglow", { keyframes: { opacity: [0.34, 0.14, 0.46, 0.34],
                                   scale:   [0.9, 0.72, 1.08, 0.95] },
                      duration: 0.19, ease: "sine.inOut" }, ${Math.max(0.05, I - 0.31).toFixed(3)});
  tl.to("#preglow", { scale: 0.32, opacity: 0.95, duration: 0.1, ease: "power4.in" }, ${Math.max(0.17, I - 0.115).toFixed(3)});
  tl.set("#preglow", { opacity: 0 }, BI);
  tl.to("#pocket", { opacity: ${dna.plate.scrim ?? 0.55}, duration: 0.22, ease: "power2.out" }, BI - 0.03);

  // ===== bloom arrival: crush -> contact squash (2f) -> elastic settle =====
  tl.set("#apex", { opacity: 1 }, BI);
  tl.fromTo("#apex", { scale: 2.35 }, { scale: 1.0, duration: ${(C - I).toFixed(3)}, ease: "power4.in" }, BI);
  tl.fromTo("#aword", { filter: "blur(15px) brightness(2.6)" },
            { filter: "blur(2px) brightness(1.7)", duration: ${(C - I).toFixed(3)}, ease: "power4.in" }, BI);
  tl.set("#apex", { scaleX: 1.09, scaleY: 0.93 }, BC);
  tl.set("#aword", { filter: "blur(0px) brightness(1.85)" }, BC);
  tl.set("#aglow", { opacity: 0.9 }, BC);
  tl.set("#spill", { opacity: 0.55 }, BC);
  tl.to("#apex", { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.42)" }, BC + 0.085);
  tl.to("#aword", { filter: "blur(0px) brightness(1.45)", duration: 0.34, ease: "power2.out" }, BC + 0.1);
  tl.to("#spill", { opacity: 0.2, duration: 0.12, ease: "expo.out" }, BC + 0.07);

  // ===== tendrils draw outward, staggered =====
  tpaths.forEach(([pg, pc], i) => {
    const t0 = BC + 0.02 + i * ${stag};
    tl.set(pg, { opacity: 0.5 }, t0);
    tl.set(pc, { opacity: 0.95 }, t0);
    tl.to([pg, pc], { strokeDashoffset: 0, duration: 0.42, ease: "power2.out" }, t0);
  });
${
  flickD >= 0.25
    ? `  tl.to("#gGlow", { keyframes: { opacity: [0.78, 1, 0.72, 1, 0.82] },
                    duration: ${flickD}, ease: "sine.inOut" }, BC + 0.34);`
    : ""
}

  // ===== hold: glow breathes strongly (8-14%), caustics counter-drift =====
  tl.to("#aglow", { keyframes: { scale: [1.1, 1.04, 1.13, 1.07],
                                 opacity: [0.78, 0.9, 0.7, 0.85] },
                    duration: ${breatheD}, ease: "sine.inOut" }, BC + 0.12);
${
  wordFlickT != null
    ? `  tl.to("#aword", { keyframes: { filter: ["blur(0px) brightness(1.6)", "blur(0px) brightness(1.4)",
                                          "blur(0px) brightness(1.62)", "blur(0px) brightness(1.5)"] },
                    duration: 0.32, ease: "sine.inOut" }, ${wordFlickT.toFixed(3)});`
    : ""
}
  tl.to("#cauA", { opacity: 0.06, duration: 0.3, ease: "power1.out" }, BC + 0.02);
  tl.to("#cauB", { opacity: 0.06, duration: 0.3, ease: "power1.out" }, BC + 0.07);
  tl.fromTo("#cauA", { x: -45 }, { x: 85, duration: ${Math.min(0.95, DUR - 0.06 - (C + 0.02)).toFixed(2)}, ease: "none" }, BC + 0.02);
  tl.fromTo("#cauB", { x: 55 }, { x: -75, duration: ${Math.min(0.95, DUR - 0.06 - (C + 0.02)).toFixed(2)}, ease: "none" }, BC + 0.02);
  tl.to("#spill", { keyframes: { opacity: [0.13, 0.19, 0.15] },
                    duration: ${shimD}, ease: "sine.inOut" }, BC + 0.21);
  // deep-sea current: the bloom drifts slowly, revealing letters from behind
  // the subject (x channel otherwise unused on #apex)
  tl.to("#apex", { x: ${p.drift ?? -30}, duration: ${driftD}, ease: "sine.out" }, BI + 0.21);

  // ===== exit: the light SINKS back into the deep =====
  tl.to("#tndwrap", { y: 14, opacity: 0, duration: 0.2, ease: "power2.in" }, SINK);
  tl.to(["#cauA", "#cauB"], { opacity: 0, duration: 0.18, ease: "power1.in" }, SINK + 0.04);
  tl.to(["#pocket", "#spill"], { opacity: 0, duration: 0.22, ease: "power1.in" }, SINK + 0.04);
  tl.to("#apex", { y: 26, opacity: 0, duration: 0.2, ease: "power2.in" }, SINK + 0.06);
  tl.to("#aword", { filter: "blur(6px) brightness(1.2)", duration: 0.2, ease: "power1.in" }, SINK + 0.06);
  tl.set("#apex", { display: "none" }, ${Math.min(SINK + 0.28, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceSilkribbon() {
  // ---- setpiece: SILKRIBBON (aurora silk written into the night sky) ----
  // The hero word is WRITTEN behind the subject as a silk ribbon: sequential
  // Hershey-stroke reveal (one <path> per pen stroke, constant pen speed) in
  // a blurred halo + tight core, BOTH stroked by ONE userSpaceOnUse aurora
  // linearGradient (rose→teal→violet, reflect spread). SIGNATURE: the
  // gradient's x1/x2 translate f(t) from I−0.07 to the end so the aurora
  // colors FLOW THROUGH the drawn ribbon during the hold. A soft light mote
  // (blurred halo + core dot) rides the pen, hops at lifts, and blooms out
  // at the final stroke. Scene reaction: two huge aurora blobs drift the sky
  // f(t) from t=0 (~params.wash) and DEEPEN as the ribbon writes; a top
  // scrim (plate.scrim) charges in at I−0.34 (sky washout guard); a light
  // spill tints the sky once the ribbon completes, flickering gently; the
  // halo breathes through the hold. Gentle — no shake, no contact squash:
  // the apex verb is the writing itself.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  // stroke path baked at COMPILE time — any word, zero tuning (drawon pattern)
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.ribbonW || Math.min(p.targetWidth || 880, W - 240);
  const svgW = tw + 130,
    svgH = 280;
  const D = execFileSync(
    process.execPath,
    [
      gen,
      fontPath,
      heroDisplay.toLowerCase(),
      String(tw),
      "200",
      String(Math.round((svgW - tw) / 2)),
    ],
    { encoding: "utf8" },
  ).trim();
  const ENDT = +(DUR - 0.04).toFixed(3);
  // writing window: keep the demo's 0.68s unless the hero lands too late to
  // finish + hold before the end of the clip
  const WIN = Math.min(p.window || 0.68, Math.max(0.36, ENDT - 0.42 - I));
  const ROSE = dna.palette.rose,
    TEAL = dna.palette.accent,
    VIO = dna.palette.violet,
    DEEP = dna.palette.deep || "#070C24";
  const scrim = (dna.plate || {}).scrim ?? 0.72;
  // aurora gradient span rides the ribbon ink (demo: 560 over 880, shift 1.5×span)
  const gx1 = Math.round((svgW - tw) / 2),
    span = Math.round(tw * 0.6364);
  const spillW = tw + 60,
    spillH = Math.round((tw + 60) * 0.51);
  const css = `
  .aur { position:absolute; border-radius:50%; opacity:0; will-change:transform; }
  #aurA { left:${Math.round(-0.141 * W)}px; top:${Math.round(-0.278 * H)}px; width:${Math.round(0.859 * W)}px; height:${Math.round(0.778 * H)}px;
          background: radial-gradient(50% 50% at 50% 50%, ${TEAL}d9 0%, ${TEAL}00 70%); }
  #aurB { left:${Math.round(0.406 * W)}px; top:${Math.round(-0.361 * H)}px; width:${Math.round(0.922 * W)}px; height:${Math.round(0.833 * H)}px;
          background: radial-gradient(50% 50% at 50% 50%, ${ROSE}cc 0%, ${ROSE}00 70%); }
  #apexScrim { position:absolute; left:0; top:0; width:${W}px; height:${Math.round(0.653 * H)}px; opacity:0;
               background: linear-gradient(to bottom, ${DEEP}${Math.round(scrim * 255)
                 .toString(16)
                 .padStart(2, "0")} 0%, ${DEEP}${Math.round(scrim * 0.694 * 255)
                 .toString(16)
                 .padStart(2, "0")} 55%, ${DEEP}00 100%); }
  #spill { position:absolute; left:${HG.x}px; top:${HG.y}px; width:${spillW}px; height:${spillH}px;
           margin-left:-${Math.round(spillW / 2)}px; margin-top:-${Math.round(spillH / 2)}px; opacity:0;
           background: radial-gradient(50% 50% at 50% 50%, ${TEAL}80 0%, ${VIO}47 45%, ${ROSE}00 75%); }
  #silk { position:absolute; left:${HG.x}px; top:${HG.y}px; margin-left:-${Math.round(svgW / 2)}px;
          margin-top:-${Math.round(svgH / 2)}px; overflow:visible; }
  #coreG { filter: drop-shadow(0 0 6px rgba(255,255,255,0.55)); }`;
  const html = `      <div class="aur" id="aurA"></div>
      <div class="aur" id="aurB"></div>
      <div id="apexScrim"></div>
      <div id="spill"></div>
      <svg id="silk" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
        <defs>
          <linearGradient id="agrad" gradientUnits="userSpaceOnUse"
                          x1="${gx1}" y1="0" x2="${gx1 + span}" y2="0" spreadMethod="reflect">
            <stop offset="0"   stop-color="${ROSE}"/>
            <stop offset="0.5" stop-color="${TEAL}"/>
            <stop offset="1"   stop-color="${VIO}"/>
          </linearGradient>
          <filter id="haloblur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="7"/>
          </filter>
        </defs>
        <g id="haloG" filter="url(#haloblur)" opacity="0.85"></g>
        <g id="coreG"></g>
        <circle id="nib" r="7" fill="#fff" opacity="0" filter="url(#haloblur)"/>
        <circle id="nibCore" r="3.5" fill="#fff" opacity="0"/>
      </svg>`;
  const js = `
  // ---- setpiece: SILKRIBBON (sequential silk-stroke reveal, flowing aurora gradient) ----
  const I9 = ${I.toFixed(3)}, WIN = ${WIN.toFixed(3)}, DRAWN = I9 + WIN, ENDT = ${ENDT};
  const D = ${J(D)};

  // aurora wash: 2 huge soft blobs drifting f(t) (baked keyframes, ease none)
  tl.to("#aurA", { opacity: ${p.wash ?? 0.12}, duration: 0.5, ease: "sine.out" }, 0.05);
  tl.to("#aurB", { opacity: ${p.wash ?? 0.12}, duration: 0.5, ease: "sine.out" }, 0.15);
  tl.to("#aurA", { keyframes: { x: [0, 34, 58, 44, 16, -8, 0], y: [0, 10, 22, 30, 22, 8, 0] },
                   duration: ENDT, ease: "none" }, 0);
  tl.to("#aurB", { keyframes: { x: [0, -28, -52, -60, -38, -12, 0], y: [0, 14, 8, -6, -16, -8, 0] },
                   duration: ENDT, ease: "none" }, 0);
  // sky reaction: the aurora deepens while the ribbon writes
  tl.to("#aurA", { opacity: ${p.deepen ?? 0.2}, duration: 0.5, ease: "sine.inOut" }, I9 - 0.1);
  tl.to("#aurB", { opacity: ${p.deepen ?? 0.2}, duration: 0.5, ease: "sine.inOut" }, I9 - 0.05);

  // apex scrim charges in before the ribbon (sky washout guard)
  tl.to("#apexScrim", { opacity: 1, duration: 0.38, ease: "sine.inOut" }, I9 - 0.34);

  // silk ribbon: sequential stroke draw-on, halo + core share the gradient
  const subs = D.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNS = "http://www.w3.org/2000/svg";
  function mk(parent, d, w) {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", "url(#agrad)"); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");  // hidden until its turn (kills round-cap dot)
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokes = subs.map((d) => ({ halo: mk("haloG", d, ${p.haloWidth ?? 18}),
                                     core: mk("coreG", d, ${p.coreWidth ?? 6}) }));
  let total = 0;
  strokes.forEach((s) => { s.len = s.core.getTotalLength(); total += s.len; });
  let t9 = I9;
  strokes.forEach((s) => {
    const d = WIN * s.len / total;
    gsap.set([s.core, s.halo], { strokeDasharray: s.len, strokeDashoffset: s.len });
    tl.set([s.core, s.halo], { opacity: 1 }, t9);
    tl.fromTo([s.core, s.halo], { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, t9);
    // nib (a soft light mote) rides each stroke, hops at pen lifts
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(["#nib", "#nibCore"], { x: xs[0], y: ys[0] }, t9);
    tl.to("#nib", { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, t9);
    tl.to("#nibCore", { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, t9);
    t9 += d;
  });
  gsap.set(["#nib", "#nibCore"], { attr: { cx: 0, cy: 0 } });
  tl.set("#nib", { opacity: 0.85 }, I9 - 0.01);
  tl.set("#nibCore", { opacity: 1 }, I9 - 0.01);
  tl.to("#nib", { scale: 2.4, opacity: 0, duration: 0.22, ease: "sine.in",
                  transformOrigin: "50% 50%" }, DRAWN);
  tl.to("#nibCore", { scale: 2.4, opacity: 0, duration: 0.16, ease: "sine.in",
                      transformOrigin: "50% 50%" }, DRAWN);

  // SIGNATURE: the gradient FLOWS through the drawn ribbon — translate the
  // userSpaceOnUse gradient (x1/x2 together); reflect spread makes the aurora
  // colors march continuously along the silk during the hold
  tl.fromTo("#agrad", { attr: { x1: ${gx1}, x2: ${gx1 + span} } },
            { attr: { x1: ${gx1 - Math.round(1.5 * span)}, x2: ${gx1 + span - Math.round(1.5 * span)} },
              duration: ENDT - (I9 - 0.07), ease: "none" }, I9 - 0.07);

  // light spill tints the sky as the ribbon completes
  tl.to("#spill", { opacity: ${p.spill ?? 0.3}, duration: 0.7, ease: "sine.out" }, I9 + 0.1);
  if (ENDT - (I9 + 0.8) > 0.15) {
    const SP = ${p.spill ?? 0.3};
    tl.to("#spill", { keyframes: { opacity: [SP, SP - 0.05, SP + 0.01, SP - 0.04, SP] },
                      duration: ENDT - (I9 + 0.8), ease: "none" }, I9 + 0.8);
  }
  // hold life: the halo breathes gently (aurora shimmer)
  if (ENDT - DRAWN > 0.1)
    tl.to("#haloG", { keyframes: { opacity: [0.85, 0.7, 0.9, 0.72, 0.86] },
                      duration: ENDT - DRAWN, ease: "none" }, DRAWN);`;
  return { css, html, js };
}

function setpieceScopetrace() {
  // ---- setpiece: SCOPETRACE (the trace leaps off the scope and WRITES the word) ----
  // A surge column jumps from the scope band up to the pen-start point, then
  // the waveform WRITES the hero word in a thin phosphor stroke (sequential
  // Hershey stroke reveal — core only, no halo: it is a trace, not a tube).
  // The phosphor FILL flicker-arrives 2 frames + a 5-step blink AFTER the
  // write completes (scope persistence), hums + breathes 1.6% through the
  // hold, then the word COLLAPSES to a flatline (scaleY crush + horizontal
  // flash) clearing before the next spoken word. Scene reaction: phosphor
  // scrim + green spill behind the subject; a 1-frame green pulse answers the
  // final transcript word (the scope-death beat the paradigm owns up front).
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.traceW;
  // strip punctuation for the pen (the demo wrote "pixel size", period dropped)
  const traceText = heroDisplay.toLowerCase().replace(/[^\p{L}\p{N} ']/gu, "");
  const svgW = tw + 140,
    svgH = 320,
    BY = 215, // local baseline; ink center ≈ BY − 28 (demo registration)
    CY = BY - 28;
  const D = execFileSync(
    process.execPath,
    [gen, fontPath, traceText, String(tw), String(BY), String(70)],
    { encoding: "utf8" },
  ).trim();
  // surge column lands at the pen-start point (first M of the path)
  const m0 = D.match(/M ([\d.]+) ([\d.]+)/);
  const surgeX = Math.round(HG.x - svgW / 2 + (m0 ? +m0[1] : 70));
  const WIN = p.window || 0.6;
  const FLICK = +(I + WIN + (p.flickGap ?? 0.12)).toFixed(3);
  // exit: collapse to flatline CLEAR of the next spoken word (the demo's
  // 3.33 before "It's" 3.545); falls back to the hero window end
  const nextT = tWords
    .filter((w) => w.start > hero.end + 0.01)
    .map((w) => w.start)
    .sort((a, b) => a - b)[0];
  let EXIT = nextT != null ? nextT - (p.clearGap ?? 0.215) : heroOut - 0.2;
  EXIT = +Math.max(FLICK + 0.45, Math.min(EXIT, heroOut)).toFixed(3);
  const A = dna.palette.accent,
    BRT = dna.palette.bright || "#d6ffe4";
  const scrim = dna.plate.scrim ?? 0.62;
  const ox = ((HG.x / W) * 100).toFixed(1),
    oy = ((HG.y / H) * 100).toFixed(1);
  const spillW = tw + 260,
    spillH = Math.round((tw + 260) * 0.47);
  const css = `
  #scdim { position:absolute; inset:0; opacity:0;
           background: radial-gradient(90% 75% at ${ox}% ${oy}%, rgba(1,14,7,${scrim}) 0%, rgba(1,10,5,${(scrim * 0.55).toFixed(2)}) 60%, rgba(1,8,4,${(scrim * 0.19).toFixed(2)}) 100%); }
  #scspill { position:absolute; left:${HG.x}px; top:${HG.y}px; width:${spillW}px; height:${spillH}px;
             margin-left:-${Math.round(spillW / 2)}px; margin-top:-${Math.round(spillH / 2)}px; border-radius:50%; opacity:0;
             background: radial-gradient(50% 50% at 50% 50%, ${A}33 0%, ${A}00 70%); }
  #scsurge { position:absolute; left:${surgeX}px; top:0; width:3px; height:${H}px; opacity:0;
             background: linear-gradient(180deg, ${A}00 0%, ${BRT}f2 45%, ${A}80 100%);
             box-shadow: 0 0 12px ${A}cc; }
  #scblk { position:absolute; inset:0; }
  #scsvg { position:absolute; left:${HG.x}px; top:${HG.y}px; margin-left:-${Math.round(svgW / 2)}px;
           margin-top:-${CY}px; overflow:visible; }
  #schaloG { filter: blur(7px); opacity:0.85; }
  #sccoreG { filter: drop-shadow(0 0 4px ${BRT}e6) drop-shadow(0 0 14px ${A}); }
  #scpen { filter: drop-shadow(0 0 7px #fff) drop-shadow(0 0 20px ${A}); }
  #scflat { position:absolute; left:${Math.round(HG.x - (tw + 36) / 2)}px; top:${HG.y - 2}px;
            width:${tw + 36}px; height:4px; opacity:0;
            background:${BRT}; box-shadow: 0 0 18px ${A}, 0 0 42px ${A}b3; }
  #scpulse { position:absolute; inset:0; opacity:0;
             background: radial-gradient(70% 60% at 50% 60%, ${A}38 0%, rgba(0,0,0,0) 70%); }`;
  const html = `      <div id="scdim"></div>
      <div id="scspill"></div>
      <div id="scsurge"></div>
      <div id="scblk">
        <svg id="scsvg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
          <g id="schaloG"></g>
          <g id="sccoreG"></g>
          <circle id="scpen" r="5" fill="#fff" opacity="0"/>
        </svg>
      </div>
      <div id="scflat"></div>
      <div id="scpulse"></div>`;
  const js = `
  // ---- setpiece: SCOPETRACE (surge → pen write → fill flicker → hum → flatline) ----
  const I = ${I.toFixed(3)}, WIN = ${WIN}, DRAWN = I + WIN, FLICK = ${FLICK.toFixed(3)}, EXIT = ${EXIT.toFixed(3)};
  const D = ${J(D)};

  // scene reaction: phosphor scrim + spill while the trace owns the room
  tl.fromTo("#scdim", { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power2.in" }, I - 0.18);
  tl.to("#scdim", { opacity: 0, duration: 0.30, ease: "power1.in" }, EXIT + 0.05);
  tl.fromTo("#scspill", { opacity: 0 }, { opacity: ${p.spill ?? 0.55}, duration: WIN, ease: "power1.in" }, I);
  tl.to("#scspill", { opacity: 0, duration: 0.18, ease: "power2.in" }, EXIT);

  // surge: the trace leaps up from the scope band to the pen-start point
  tl.fromTo("#scsurge", { opacity: 0, scaleY: 0, transformOrigin: "50% 100%" },
            { opacity: 1, scaleY: 1, duration: 0.10, ease: "power3.in" }, I - 0.12);
  tl.set("#scsurge", { opacity: 0 }, I + 0.04);

  // sequential stroke draw-on (one <path> per pen lift; core writes, halo waits)
  const subs = D.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNS = "http://www.w3.org/2000/svg";
  function mkP(parent, d, stroke, w) {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", stroke); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokes = subs.map((d) => ({
    halo: mkP("schaloG", d, ${J(A)}, ${p.haloWidth || 14}),
    core: mkP("sccoreG", d, ${J(BRT)}, ${p.coreWidth || 4}),
  }));
  let total = 0;
  strokes.forEach((s) => { s.len = s.core.getTotalLength(); total += s.len; });
  const scpen = document.getElementById("scpen");
  let t = I;
  strokes.forEach((s) => {
    const d = WIN * s.len / total;
    gsap.set([s.core, s.halo], { strokeDasharray: s.len, strokeDashoffset: s.len });
    gsap.set(s.halo, { opacity: 0 });           // halo arrives at FLICK, not during write
    tl.set(s.core, { opacity: 1 }, t);
    tl.fromTo(s.core, { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, t);
    tl.fromTo(s.halo, { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, t);
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(scpen, { x: xs[0], y: ys[0] }, t);
    tl.to(scpen, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, t);
    t += d;
  });
  gsap.set(scpen, { attr: { cx: 0, cy: 0 } });
  tl.set(scpen, { opacity: 1 }, I - 0.01);
  tl.to(scpen, { scale: 2.4, opacity: 0, duration: 0.12, ease: "power2.in",
                 transformOrigin: "50% 50%" }, DRAWN);

  // fill flicker-on (halo = phosphor "fill"; full within 2 frames)
  tl.set("#schaloG", { opacity: 0 }, 0);
  const haloPaths = strokes.map(s => s.halo);
  tl.set(haloPaths, { opacity: 1 }, FLICK - 2 * F);      // pre-arm strokes
  [[1, 0], [0.25, 1], [1, 2], [0.55, 3], [1, 4]].forEach(([o, k]) => {
    tl.set("#schaloG", { opacity: o }, FLICK + k * F);
  });
  tl.set("#sccoreG", { opacity: 0.55 }, FLICK + F);
  tl.set("#sccoreG", { opacity: 1 }, FLICK + 2 * F);

  // hold life: glow hum + 1.6% breathe (breathe ends exactly at the collapse)
  const humStart = FLICK + 5 * F, humDur = Math.max(0.2, EXIT - humStart);
  const NH = Math.max(6, Math.round(humDur / (2 * F)));
  const humVals = [];
  for (let k = 0; k <= NH; k++) {
    const tt = k / NH * humDur;
    humVals.push(0.80 + 0.10 * Math.sin(2 * Math.PI * 7 * tt) + 0.06 * Math.sin(2 * Math.PI * 11.3 * tt + 0.9));
  }
  tl.to("#schaloG", { keyframes: { opacity: humVals }, duration: humDur, ease: "none" }, humStart);
  tl.fromTo("#scblk", { scale: 1, transformOrigin: "${ox}% ${oy}%" },
            { scale: 1.016, duration: humDur, ease: "sine.inOut" }, humStart);

  // exit: trace collapses back to a flatline (the scope takes the word back)
  tl.to("#scblk", { scaleY: 0.02, duration: 0.14, ease: "power3.in",
                    transformOrigin: "${ox}% ${oy}%" }, EXIT);
  tl.set("#scblk", { opacity: 0 }, EXIT + 0.15);
  tl.set("#scflat", { opacity: 1 }, EXIT + 0.13);
  tl.to("#scflat", { opacity: 0, scaleX: 0.1, duration: 0.16, ease: "power2.in",
                     transformOrigin: "50% 50%" }, EXIT + 0.15);

  // second beat: 1-frame phosphor pulse behind the subject on the death word
  tl.set("#scpulse", { opacity: 1 }, ${Math.min(LASTWORD.start, DUR - 0.15).toFixed(3)});
  tl.set("#scpulse", { opacity: 0.4 }, ${Math.min(LASTWORD.start + F, DUR - 0.1).toFixed(3)});
  tl.set("#scpulse", { opacity: 0 }, ${Math.min(LASTWORD.start + 2 * F, DUR - 0.05).toFixed(3)});`;
  return { css, html, js };
}

function setpieceScanlock() {
  // SCANLOCK: a full-body scan freeze BEHIND the subject. The hero readout SNAPS
  // on at the lock (2-frame law) → power3 crush → contact squash → elastic
  // settle (the apex impact physics). A bracket target-frame draws around it
  // (corners pop expo.out, top/bottom edge lines wipe wide), an x-ray exposure
  // pulse fires, and on the FINAL hero word the readout INVERTS to negative
  // (dark fill, bright rim — no text-stroke on the live word: a duplicate-rim
  // technique would be ideal, but the demo's negative reads via fill swap +
  // rim glow). A loupe ring then passes L→R over the letters, each pulsing as
  // it is examined, while a MATCH readout types beside the frame and the locked
  // word breathes + servo-jitters. The return scan WIPES the freeze-frame R→L
  // (clip inset) and the brackets retract. Scene reaction (dim + exposure flash)
  // is owned here in the bg. Geometry from HG (scanlock branch).
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const A = dna.palette.accent || "#9fd8ff",
    WORD = dna.palette.heroWord || dna.palette.bright || "#f2faff",
    NEG = dna.palette.negFill || "#071521",
    RIM = dna.palette.rim || A;
  const fpx = HG.fontPx,
    chW = HG.chW,
    spW = HG.spW,
    totalW = HG.totalW;
  const CX = HG.x,
    CY = HG.y;
  const L0 = CX - totalW / 2; // left edge of the readout
  // exit: scan-out wipe clears before the next spoken word (else hero window end)
  const nextT = tWords
    .filter((w) => w.start > hero.end + 0.01)
    .map((w) => w.start)
    .sort((a, b) => a - b)[0];
  let EXIT = nextT != null ? nextT - (p.clearGap ?? 0.215) : heroOut - 0.2;
  EXIT = +Math.max(I + 1.6, Math.min(EXIT, heroOut)).toFixed(3);
  // the negative-invert beat: when the LAST hero word is spoken (the demo flips
  // on "size." — the final word of the apex phrase)
  const lastHeroT = +tWords[hero.idx + hero.len - 1].start.toFixed(3);
  const INV = +Math.max(I + 0.3, Math.min(lastHeroT, EXIT - 0.4)).toFixed(3);
  const scrim = (dna.plate || {}).scrim ?? 0.3;
  const ox = ((CX / W) * 100).toFixed(1),
    oy = ((CY / H) * 100).toFixed(1);
  // build per-char cells (fixed-width like the demo) + letter centers for loupe
  const cells = [];
  let cx = 0;
  const letters = [];
  for (const c of heroText) {
    const wcell = c === " " ? spW : chW;
    cells.push({ c, w: wcell, sp: c === " " });
    if (c !== " ") letters.push(+(L0 + cx + wcell / 2).toFixed(1));
    cx += wcell;
  }
  const ringR = Math.round(fpx * 0.83);
  const matchTxt = p.readout || "MATCH 99.2%";
  const css = `
  #sldim { position:absolute; inset:0; opacity:0; background:${dna.palette.dim || "#03101e"}; }
  #slxflash { position:absolute; inset:0; opacity:0;
              background: radial-gradient(85% 70% at ${ox}% ${oy}%, ${A}e6 0%, ${A}66 45%, rgba(20,50,80,0) 100%); }
  #slblk { position:absolute; left:${CX}px; top:${CY}px; opacity:0; }
  #slword { display:flex; align-items:center; justify-content:center;
            font-family:'${dna.fonts.hero}', sans-serif; font-weight:${p.weight || 700};
            font-size:${fpx}px; line-height:${fpx}px; color:${WORD};
            text-shadow: 0 0 18px ${A}b3, 0 0 50px ${A}59, 0 4px 16px rgba(0,8,16,0.75); }
  #slword .ch { display:inline-block; width:${chW}px; text-align:center; }
  #slword .sp { width:${spW}px; }
  .slbr { position:absolute; width:${Math.round(fpx * 0.26)}px; height:${Math.round(fpx * 0.26)}px; opacity:0; }
  .slbr.tl { left:-${Math.round(fpx * 0.33)}px; top:-${Math.round(fpx * 0.26)}px;  border-left:3px solid ${A}; border-top:3px solid ${A}; }
  .slbr.tr { right:-${Math.round(fpx * 0.33)}px; top:-${Math.round(fpx * 0.26)}px; border-right:3px solid ${A}; border-top:3px solid ${A}; }
  .slbr.bl { left:-${Math.round(fpx * 0.33)}px; bottom:-${Math.round(fpx * 0.28)}px; border-left:3px solid ${A}; border-bottom:3px solid ${A}; }
  .slbr.brr{ right:-${Math.round(fpx * 0.33)}px; bottom:-${Math.round(fpx * 0.28)}px; border-right:3px solid ${A}; border-bottom:3px solid ${A}; }
  .sledge { position:absolute; left:-8px; right:-8px; height:2px; background:${A}8c; opacity:0; }
  .sledge.top { top:-${Math.round(fpx * 0.26)}px; transform-origin:0% 50%; }
  .sledge.bot { bottom:-${Math.round(fpx * 0.28)}px; transform-origin:100% 50%; }
  #slring { position:absolute; left:0px; top:${Math.round(CY - ringR)}px; width:${ringR * 2}px; height:${ringR * 2}px; border-radius:50%;
            border:2px solid ${A}e6; opacity:0;
            box-shadow: 0 0 16px ${A}99, inset 0 0 22px ${A}40;
            background: radial-gradient(circle, ${A}1a 0%, ${A}00 70%); }
  #slreadout { position:absolute; left:${Math.round(L0 + totalW * 0.0)}px; top:${Math.round(CY + fpx * 0.8)}px; opacity:0;
               font-family:'${dna.fonts.tag}', sans-serif; font-weight:400; font-size:24px; letter-spacing:4px;
               color:${A}; background:rgba(4,12,20,0.5); padding:6px 14px;
               border-left:3px solid ${A}cc; text-shadow: 0 0 10px ${A}80; }
  #slreadout .rc { display:none; }
  #slreadout .caret { display:inline-block; width:13px; height:22px; background:${A};
                      vertical-align:baseline; margin-left:5px; opacity:0; }`;
  const html = `      <div id="sldim"></div>
      <div id="slblk">
        <div id="slword"></div>
        <div class="slbr tl"></div><div class="slbr tr"></div>
        <div class="slbr bl"></div><div class="slbr brr"></div>
        <div class="sledge top"></div><div class="sledge bot"></div>
      </div>
      <div id="slring"></div>
      <div id="slreadout"><span class="caret"></span></div>
      <div id="slxflash"></div>`;
  const js = `
  // ---- setpiece: SCANLOCK (snap → bracket → invert → loupe → match → scan-out) ----
  const I = ${I.toFixed(3)}, INV = ${INV.toFixed(3)}, EXIT = ${EXIT.toFixed(3)};
  const CELLS = ${J(cells)};
  const LETT = ${J(letters)};
  const word = document.getElementById("slword");
  const chars = [];
  CELLS.forEach((cl) => {
    const s = document.createElement("span");
    s.className = "ch" + (cl.sp ? " sp" : ""); s.textContent = cl.c;
    word.appendChild(s);
    if (!cl.sp) chars.push(s);
  });
  gsap.set("#slblk", { xPercent: -50, yPercent: -50 });

  // scene reaction: room dims as the scanner charges, exposure pulse at the lock
  tl.fromTo("#sldim", { opacity: 0 }, { opacity: ${scrim}, duration: 0.16, ease: "power2.in" }, ${Math.max(I - 0.16, 0.1).toFixed(3)});
  tl.to("#sldim", { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(EXIT - 0.0).toFixed(3)});
  tl.set("#slxflash", { opacity: 0.55 }, ${I.toFixed(3)});
  tl.to("#slxflash", { opacity: 0, duration: 0.18, ease: "expo.out" }, ${(I + 0.033).toFixed(3)});

  // arrival: snap on (2-frame law) → crush → contact squash → elastic settle
  tl.set("#slblk", { opacity: 1, scale: 1.26, transformOrigin: "50% 60%" }, I);
  tl.to("#slblk", { scale: 1, duration: 0.11, ease: "power3.in" }, I + 0.005);
  tl.set("#slblk", { scaleX: 1.07, scaleY: 0.93 }, I + 0.123);
  tl.to("#slblk", { scaleX: 1, scaleY: 1, duration: 0.34, ease: "elastic.out(1, 0.42)" }, I + 0.206);

  // bracket frame draws around the locked target
  [".slbr.tl", ".slbr.tr", ".slbr.bl", ".slbr.brr"].forEach((sel, k) => {
    tl.fromTo(sel, { opacity: 0, scale: 0.4 },
                   { opacity: 0.9, scale: 1, duration: 0.18, ease: "expo.out" }, I + 0.143 + k * 0.05);
  });
  tl.fromTo(".sledge.top", { opacity: 0.55, scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "power2.out" }, I + 0.223);
  tl.fromTo(".sledge.bot", { opacity: 0.55, scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "power2.out" }, I + 0.283);

  // THE INVERT — on the last hero word the readout flips to negative
  tl.set("#slword", { filter: "brightness(2.3)" }, INV - 0.042);
  tl.set("#slword", { color: ${J(NEG)}, textShadow: "0 0 26px ${RIM}d9, 0 0 60px ${RIM}66, 0 2px 10px rgba(0,8,16,0.7)", filter: "none" }, INV);

  // hold life: the negative breathes + servo tracking jitter
  tl.to("#slword", { scale: 1.016, duration: 0.25, ease: "sine.inOut" }, I + 0.82);
  tl.to("#slword", { scale: 1,     duration: 0.25, ease: "sine.inOut" }, I + 1.07);
  tl.to("#slword", { scale: 1.016, duration: 0.25, ease: "sine.inOut" }, I + 1.32);
  tl.to("#slword", { scale: 1,     duration: 0.25, ease: "sine.inOut" }, I + 1.57);
  tl.set("#slblk", { x: 1.2 }, I + 1.2);  tl.set("#slblk", { x: 0 }, I + 1.24);
  tl.set("#slblk", { x: -1 },  I + 1.48); tl.set("#slblk", { x: 0 }, I + 1.52);

  // loupe ring passes over the letters; each pulses as it is examined
  const RTRAVEL = ${(EXIT - (I + 0.5) > 1.4 ? 1.0 : 0.85).toFixed(2)};
  // ring is stage-absolute (left:0); translate x = letter center − ringR
  const RX0 = ${((letters.length ? letters[0] - 0.5 * chW : L0) - ringR).toFixed(1)};
  const RX1 = ${((letters.length ? letters[letters.length - 1] + 0.5 * chW : L0 + totalW) - ringR).toFixed(1)};
  tl.fromTo("#slring", { opacity: 0, scale: 0.6 }, { opacity: 0.95, scale: 1, duration: 0.12, ease: "expo.out" }, I + 0.5);
  tl.fromTo("#slring", { x: RX0 }, { x: RX1, duration: RTRAVEL, ease: "none" }, I + 0.52);
  LETT.forEach((lx, i) => {
    const frac = LETT.length > 1 ? i / (LETT.length - 1) : 0;
    const t = I + 0.52 + frac * RTRAVEL;
    const el = chars[i];
    tl.to(el, { scale: 1.22, duration: 0.09, ease: "power2.out" }, t - 0.04);
    tl.to(el, { scale: 1,    duration: 0.14, ease: "power2.in" },  t + 0.05);
    tl.set(el, { filter: "brightness(1.8)" }, t - 0.04);
    tl.to(el,  { filter: "brightness(1)", duration: 0.18 }, t + 0.04);
  });
  tl.to("#slring", { scale: 0.7, opacity: 0, duration: 0.12, ease: "power2.in" }, I + 0.54 + RTRAVEL);

  // MATCH readout types beside the frame
  const RT = ${J(matchTxt)};
  const readout = document.getElementById("slreadout");
  const caret = readout.querySelector(".caret");
  [...RT].forEach((c, i) => {
    const s = document.createElement("span"); s.className = "rc";
    s.textContent = c === " " ? "\\u00a0" : c;
    readout.insertBefore(s, caret);
    tl.set(s, { display: "inline" }, I + 0.87 + i * 0.033);
  });
  tl.fromTo("#slreadout", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.15, ease: "power2.out" }, I + 0.84);
  for (let bk = 0; bk < 5; bk++) tl.set(caret, { opacity: bk % 2 === 0 ? 1 : 0 }, I + 0.89 + bk * 0.11);
  tl.set(caret, { opacity: 0 }, EXIT - 0.1);

  // ===== SCAN-OUT — the return wavefront wipes the freeze-frame R→L =====
  tl.fromTo("#slword", { clipPath: "inset(-30% 0% -30% 0%)" },
                       { clipPath: "inset(-30% 102% -30% 0%)", duration: 0.20, ease: "none" }, EXIT);
  tl.to(".sledge.top", { scaleX: 0, opacity: 0, duration: 0.10 }, EXIT + 0.03);
  tl.to(".sledge.bot", { scaleX: 0, opacity: 0, duration: 0.10 }, EXIT + 0.03);
  [".slbr.tr", ".slbr.brr", ".slbr.tl", ".slbr.bl"].forEach((sel, k) => {
    tl.to(sel, { scale: 0.6, opacity: 0, duration: 0.12, ease: "power2.in" }, EXIT + 0.05 + k * 0.03);
  });
  tl.set("#slreadout", { opacity: 0.45 }, EXIT + 0.05);
  tl.set("#slreadout", { opacity: 0 },    EXIT + 0.13);
  tl.set("#slblk", { opacity: 0 }, Math.min(EXIT + 0.27, ${(DUR - 0.03).toFixed(3)}));`;
  return { css, html, js };
}

function setpiecePapermat() {
  // STOP-MOTION PAPERCUT EMBED: a torn-edge kraft mat drops onto the scene
  // (steps(2) slap), then one torn cream chip per char DROPS with steps(3)
  // gravity + 1-frame overshoot, lands crooked (seeded ±3° ±4px), settles in
  // three 12fps poses and holds an 8fps wobble (baked set chain) until the
  // FINAL word bumps the table and the chips SCATTER off down-right
  // (disperse-on-last-word). Scene reaction: warm vignette charges with the
  // landing. All geometry derives from HG (papermat branch).
  const p = dna.hero.params || {},
    I = heroIn;
  const N = heroText.length;
  const STEP = p.step ?? 0.09;
  const tileW = HG.tileW,
    tileH = HG.tileH,
    fpx = HG.fontPx,
    pitch = HG.pitch,
    matW = HG.matW,
    matH = HG.matH;
  const matT = +Math.max(0.02, I - 0.212).toFixed(3);
  // scatter trigger: the final word bumps the table (hero.exitAt overrides);
  // the whole exit (chips 0.30 + mat sweep 0.26 at +0.21) lands inside DUR
  const scatT = +Math.min(
    Math.max(
      I + (N - 1) * STEP + 0.5,
      Math.min(
        theme.hero.exitAt ?? LASTWORD.start + 0.02,
        DUR - 0.48,
        DUR - 0.32 - (N - 1) * 0.045,
      ),
    ),
    DUR - 0.48,
  ).toFixed(3);
  const VIG = p.vig ?? 0.3;
  const dropM = -(HG.y + matH / 2 + 50); // mat fully offscreen above
  const dropL = -(HG.y + tileH / 2 + 100); // chips fully offscreen above
  // tableau breathe windows (camera push feel), clamped before the scatter
  const T1 = +(I + 0.83).toFixed(3);
  const D1 = +Math.min(2.2, scatT - 0.3 - T1).toFixed(2);
  const T2 = +(T1 + Math.max(0, D1)).toFixed(3);
  const D2 = +Math.min(1.9, scatT - 0.15 - T2).toFixed(2);
  const vigSettleT = +Math.min(matT + 0.79, scatT - 0.85).toFixed(3);
  const css = `
  #vigP { position:absolute; inset:0; opacity:0;
          background: radial-gradient(120% 105% at ${((HG.x / W) * 100).toFixed(0)}% ${((HG.y / H) * 100).toFixed(0)}%, rgba(0,0,0,0) 38%, rgba(26,16,5,0.85) 100%); }
  #apx  { position:absolute; left:${HG.x}px; top:${HG.y}px; width:0; height:0; }
  #mat  { position:absolute; left:${-Math.round(matW / 2)}px; top:${-Math.round(matH / 2)}px; width:${matW}px; height:${matH}px; }
  #mat .pap  { position:absolute; inset:0; background:linear-gradient(178deg,#bd9d6c 0%,#b08f5d 55%,#a17f4c 100%); }
  #mat .pap2 { position:absolute; inset:7px; background:rgba(140,110,62,0.35); }
  #matshad { position:absolute; left:${-Math.round(matW / 2) + 2}px; top:${Math.round(matH / 2) - 18}px; width:${matW + 6}px; height:30px; opacity:0;
             background: radial-gradient(50% 50% at 50% 50%, rgba(25,15,5,0.55) 0%, rgba(25,15,5,0) 72%);
             filter: blur(5px); }
  .lshad { position:absolute; width:${Math.round(tileW * 1.08)}px; height:24px; opacity:0;
           background: radial-gradient(50% 50% at 50% 50%, rgba(28,17,6,0.6) 0%, rgba(28,17,6,0) 70%);
           filter: blur(4px); }
  .lchip { position:absolute; width:${tileW}px; height:${tileH}px; }
  .lchip .pap  { position:absolute; inset:0; background:${dna.palette.paper || "#f8f0dd"}; }
  .lchip .pap2 { position:absolute; inset:5px; background:${dna.palette.paper2 || "#efe3c6"}; }
  .lchip .gl { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
               font-family:'${dna.fonts.hero}', sans-serif; font-size:${fpx}px; line-height:1; color:${dna.palette.ink || "#2b241b"}; }`;
  const html = `      <div id="vigP"></div>
      <div id="apx">
        <div id="matshad"></div>
        <div id="mat"><div class="pap"></div><div class="pap2"></div></div>
      </div>`;
  const js = `
  // ---- setpiece: PAPERMAT (mat slap → stepped-gravity chip drops → 8fps wobble → table-bump scatter) ----
  const I = ${I.toFixed(3)}, STEP = ${STEP}, SCAT = ${scatT};
  const prnd = mulberry32(${p.seed || 151515});
  const apx = document.getElementById("apx");
  // seeded torn-paper polygon (px coords on a w×h box)
  function torn(w, h, jag, sx, sy, rr){
    const pts = [], j = () => Math.min(jag, Math.max(0, jag*0.5 + (rr()-0.5)*jag));
    for (let i=0; i<=sx; i++) pts.push([(w/sx)*i, j()]);
    for (let i=1; i<=sy; i++) pts.push([w - j(), (h/sy)*i]);
    for (let i=sx-1; i>=0; i--) pts.push([(w/sx)*i, h - j()]);
    for (let i=sy-1; i>=1; i--) pts.push([j(), (h/sy)*i]);
    return "polygon(" + pts.map(q => q[0].toFixed(1)+"px "+q[1].toFixed(1)+"px").join(",") + ")";
  }
  document.querySelector("#mat .pap").style.clipPath  = torn(${matW}, ${matH}, 12, 12, 4, prnd);
  document.querySelector("#mat .pap2").style.clipPath = torn(${matW - 14}, ${matH - 14}, 10, 12, 4, prnd);

  // ===== MAT: the animator slaps the backdrop down first =====
  gsap.set("#mat", { transformOrigin: "50% 100%" });
  tl.fromTo("#mat", { y: ${dropM}, rotation: -5 },
            { y: 6, rotation: -1.2, duration: 0.14, ease: "steps(2)" }, ${matT});
  tl.set("#mat", { scaleY: 0.97, scaleX: 1.02 }, ${(matT + 0.14).toFixed(3)});
  tl.set("#mat", { y: 0, scaleY: 1, scaleX: 1 }, ${(matT + 0.223).toFixed(3)});
  tl.set("#matshad", { opacity: 0.32 }, ${(matT + 0.14).toFixed(3)});
  for (let t = ${(matT + 0.54).toFixed(3)}; t < ${(scatT - 0.08).toFixed(3)}; t += 0.25)
    tl.set("#mat", { x: (prnd()-0.5)*1.6, y: (prnd()-0.5)*1.6, rotation: -1.2 + (prnd()-0.5)*0.7 }, t);
  // mat leaves last, swept off down-right
  tl.to("#mat", { x: 430, y: ${H - 40}, rotation: 13, duration: 0.26, ease: "steps(3)" }, ${(scatT + 0.21).toFixed(3)});
  tl.set("#matshad", { opacity: 0 }, ${(scatT + 0.25).toFixed(3)});

  // ===== SCENE REACTION: warm vignette charges with the landing =====
  tl.fromTo("#vigP", { opacity: 0 }, { opacity: ${VIG}, duration: 0.24, ease: "power2.in" }, ${matT});
  tl.to("#vigP", { opacity: ${(VIG * 0.4).toFixed(2)}, duration: 0.7, ease: "power2.out" }, ${vigSettleT});
  tl.to("#vigP", { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(scatT - 0.11).toFixed(3)});

  // ===== LETTERS: torn chips drop with stepped gravity =====
  const GLYPHS = ${J([...heroText])};
  GLYPHS.forEach((ch, i) => {
    if (ch === " ") return;
    const cx = (i - ${((N - 1) / 2).toFixed(1)}) * ${pitch} + (prnd()-0.5)*8;  // seeded ±4px misalignment
    const jy = (prnd()-0.5)*8;
    const r0 = (prnd()-0.5)*6;             // seeded ±3° crooked landing
    const C  = I + i * STEP;

    const shad = document.createElement("div");
    shad.className = "lshad";
    shad.style.left = (cx - ${Math.round((tileW * 1.08) / 2)}) + "px";
    shad.style.top  = (${Math.round(tileH / 2) + 3} + jy*0.3) + "px";
    apx.appendChild(shad);

    const chip = document.createElement("div");
    chip.className = "lchip";
    chip.style.left = (cx - ${Math.round(tileW / 2)}) + "px";
    chip.style.top  = (${-Math.round(tileH / 2)} + jy) + "px";
    const pap  = document.createElement("div"); pap.className  = "pap";
    const pap2 = document.createElement("div"); pap2.className = "pap2";
    const gl   = document.createElement("div"); gl.className   = "gl"; gl.textContent = ch;
    pap.style.clipPath  = torn(${tileW}, ${tileH}, 8, 6, 7, prnd);
    pap2.style.clipPath = torn(${tileW - 10}, ${tileH - 10}, 6, 6, 7, prnd);
    chip.appendChild(pap); chip.appendChild(pap2); chip.appendChild(gl);
    apx.appendChild(chip);
    gsap.set(chip, { transformOrigin: "50% 100%" });

    // anticipation shadow blob appears on the landing spot 3 frames early
    tl.set(shad, { opacity: 0.16, scaleX: 1.35 }, C - 0.125);
    // DROP: two airborne poses then contact — steps(3) gravity, 1-frame overshoot
    tl.fromTo(chip, { y: ${dropL}, rotation: r0 - 8 },
              { y: 8, rotation: r0, duration: 0.21, ease: "steps(3)" }, C - 0.21);
    tl.set(chip, { scaleX: 1.07, scaleY: 0.90 }, C);                  // contact squash
    tl.set(shad, { opacity: 0.50, scaleX: 1 }, C);                    // shadow grows on land
    tl.set(chip, { y: -4, scaleY: 1.05, scaleX: 0.97 }, C + 0.0833);  // 12fps settle pose 1
    tl.set(chip, { y: 2,  scaleY: 0.98, scaleX: 1.01 }, C + 0.1667);  // pose 2
    tl.set(chip, { y: 0,  scaleY: 1,    scaleX: 1    }, C + 0.25);    // rest
    tl.to(shad, { opacity: 0.34, duration: 0.3, ease: "power1.out" }, C + 0.30);

    // HOLD: 8fps wobble — baked sets every 3 frames (the stop-motion heartbeat)
    for (let t = C + 0.50; t < SCAT - 0.13; t += 0.125)
      tl.set(chip, { rotation: r0 + (prnd()-0.5)*1.4, x: (prnd()-0.5)*1.4, y: (prnd()-0.5)*1.4 }, t);

    // SCATTER on the final word — chips slide off-table down-right, steps(4)
    const S = SCAT + i*0.045;
    tl.to(chip, { x: 250 + prnd()*200, y: ${H - 110} + prnd()*110, rotation: r0 + 28 + prnd()*24,
                  duration: 0.30, ease: "steps(4)" }, S);
    tl.set(shad, { opacity: 0 }, S + 0.06);
  });
${
  D1 >= 0.4
    ? `
  // hold loom: the whole tableau breathes very slowly (camera push feel)
  tl.to("#apx", { scale: 1.016, duration: ${D1}, ease: "sine.inOut" }, ${T1});
${D2 >= 0.3 ? `  tl.to("#apx", { scale: 1.004, duration: ${D2}, ease: "sine.inOut" }, ${T2});` : ""}`
    : ""
}
  // table bump, 1 frame before the scatter begins
  tl.set("#apx", { y: 4 }, ${(scatT - 0.041).toFixed(3)});
  tl.set("#apx", { y: 0 }, ${(scatT + 0.001).toFixed(3)});`;
  return { css, html, js };
}

function setpieceCenterfold() {
  // POP-UP BOOK CENTERFOLD: blue + cream 12-point paper starbursts unfold on a
  // baseline hinge (scaleY 0.03→1 back.out, staggered), then the hero word
  // pops up in hinged clip-path segments (rotationX 85→0, the body motif at
  // full amplitude), kraft struts lean in, backdrop + word wobble-settle
  // TOGETHER (one wrapper owns rotationX), breathe through the hold, and the
  // whole centerfold folds flat at heroOut (the book closing). A dusk scrim
  // charges behind it (bright-sky insurance). Geometry derives from HG.
  const p = dna.hero.params || {},
    I = heroIn;
  const segs = p.segs || 3,
    stag = p.segStagger ?? 0.07;
  const u = HG.burstR / 220; // prop scale (demo burst R 220)
  const boxW = HG.boxW,
    boxH = HG.boxH;
  const cx = Math.round(boxW / 2),
    cy = Math.round(boxH / 2);
  const lineH = Math.round(HG.fontPx * 1.1667);
  const wordTop = Math.round(cy - 24 * u - lineH / 2); // word center 24u above box center
  const R1 = HG.burstR,
    r1 = Math.round(0.673 * R1),
    R2 = Math.round(0.9 * R1),
    r2 = Math.round(0.555 * R1);
  const strokeW = Math.max(2, Math.round(3 * u));
  // exit start: fold flat before the next sentence (demo 3.28 = heroOut−0.33),
  // never before the pop + wobble have read, always complete by DUR−0.08
  const XO = +Math.max(I + (segs - 1) * stag + 0.45, Math.min(heroOut - 0.33, DUR - 0.39)).toFixed(
    3,
  );
  const scrimT = +Math.max(0.02, I - 0.272).toFixed(3);
  const blueT = +Math.max(0.04, I - 0.272).toFixed(3);
  const wobT = +(I + 0.428).toFixed(3);
  const wobD = +Math.min(0.7, XO - 0.05 - (I + 0.428)).toFixed(2);
  const brT = +(I + 1.178).toFixed(3);
  const brD = +Math.min(1.7, XO - 0.15 - (I + 1.178)).toFixed(2);
  const segClips = Array.from({ length: segs }, (_, i) => {
    const lp = ((i * 100) / segs).toFixed(1),
      rp = (((segs - 1 - i) * 100) / segs).toFixed(1);
    return `  #cfsg${i} { clip-path: inset(0 ${rp}% 0 ${lp}%); }`;
  }).join("\n");
  const css = `
  #cfscrim { position:absolute; inset:0; opacity:0;
             background: radial-gradient(46% 54% at ${((HG.x / W) * 100).toFixed(0)}% ${(((HG.y + 24 * u) / H) * 100).toFixed(0)}%,
               rgba(16,24,42,0.62) 0%, rgba(16,24,42,0.34) 55%, rgba(16,24,42,0) 100%); }
  #cf { position:absolute; left:${HG.x}px; top:${Math.round(HG.y + 24 * u)}px; width:${boxW}px; height:${boxH}px; }
  #cfWob { position:absolute; inset:0; }
  .cfburst { position:absolute; inset:0; opacity:0; }
  #cfShadow { position:absolute; left:50%; top:${Math.round(cy + 172 * u)}px; width:${Math.round(380 * u)}px; height:${Math.round(30 * u)}px;
              margin-left:${-Math.round(190 * u)}px; opacity:0; filter:blur(6px); border-radius:50%;
              background: radial-gradient(closest-side, rgba(22,14,5,0.55), rgba(22,14,5,0)); }
  .cfstrut { position:absolute; width:${Math.round(36 * u)}px; height:${Math.round(30 * u)}px; opacity:0;
             background: linear-gradient(135deg,${dna.palette.kraft1 || "#a98f5e"} 0%, ${dna.palette.kraft2 || "#cdbb92"} 45%, ${dna.palette.kraft3 || "#e6d6af"} 100%);
             filter: drop-shadow(0 2px 2px rgba(40,26,10,0.35));
             clip-path: polygon(0 100%, 100% 100%, 100% 0); }
  #cfs1 { left:${Math.round(cx - 134 * u)}px; top:${Math.round(cy + 28 * u)}px; }
  #cfs2 { left:${Math.round(cx + 98 * u)}px; top:${Math.round(cy + 28 * u)}px; transform:scaleX(-1); }
  #cfword { position:absolute; left:0; right:0; top:${wordTop}px; height:${lineH}px; }
  .cfseg { position:absolute; inset:0; opacity:0; text-align:center;
           font-family:'${dna.fonts.hero}', sans-serif; font-weight:800; font-size:${HG.fontPx}px;
           line-height:${lineH}px; letter-spacing:0.02em; color:${dna.palette.ink || dna.palette.body};
           text-shadow: 0 3px 10px rgba(56,38,14,0.32); }
${segClips}`;
  const html = `      <div id="cfscrim"></div>
      <div id="cf">
        <div id="cfWob">
          <svg class="cfburst" id="cfbBlue" width="${boxW}" height="${boxH}" viewBox="0 0 ${boxW} ${boxH}">
            <polygon id="cfpB" fill="${dna.palette.accent}" stroke="${dna.palette.accentEdge || "#3f7fae"}" stroke-width="${strokeW}"/>
          </svg>
          <svg class="cfburst" id="cfbCream" width="${boxW}" height="${boxH}" viewBox="0 0 ${boxW} ${boxH}">
            <polygon id="cfpC" fill="${dna.palette.cream || "#f6ecd4"}" stroke="${dna.palette.creamEdge || "#8a6f45"}" stroke-width="${strokeW}"/>
          </svg>
          <div id="cfShadow"></div>
          <div class="cfstrut" id="cfs1"></div>
          <div class="cfstrut" id="cfs2"></div>
          <div id="cfword">
${Array.from({ length: segs }, (_, i) => `            <div class="cfseg" id="cfsg${i}"><span>${esc(heroText)}</span></div>`).join("\n")}
          </div>
        </div>
      </div>`;
  const js = `
  // ---- setpiece: CENTERFOLD (starburst unfold → hinged segment pop → wobble-settle → fold flat) ----
  const I = ${I.toFixed(3)}, XO = ${XO};
  // deterministic starburst geometry (paper sun)
  function starPts(cx, cy, n, R, r, rot) {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const a = rot + Math.PI * i / n, rad = (i % 2 === 0) ? R : r;
      p.push((cx + Math.cos(a) * rad).toFixed(1) + "," + (cy + Math.sin(a) * rad).toFixed(1));
    }
    return p.join(" ");
  }
  document.getElementById("cfpB").setAttribute("points", starPts(${cx}, ${cy}, 12, ${R1}, ${r1}, -Math.PI/2 + 0.13));
  document.getElementById("cfpC").setAttribute("points", starPts(${cx}, ${cy}, 12, ${R2}, ${r2}, -Math.PI/2));

  gsap.set("#cf", { xPercent: -50, yPercent: -50 });
  gsap.set("#cfWob", { transformPerspective: 900, transformOrigin: "50% 82%" });
  gsap.set(".cfburst", { transformOrigin: "50% 90%", scaleY: 0.03 });
  gsap.set(".cfseg", { transformPerspective: 800, transformOrigin: "50% 100%", rotationX: 85 });
  gsap.set(".cfstrut", { transformOrigin: "50% 100%", scaleY: 0 });
  gsap.set("#cfShadow", { scaleX: 0.3 });

  // scrim charges before the unfold (bright sky insurance)
  tl.to("#cfscrim", { opacity: ${p.scrim ?? 0.42}, duration: 0.28, ease: "power2.out" }, ${scrimT});

  // backdrop unfolds FIRST — baseline hinge, paper overshoot
  tl.set("#cfbBlue", { opacity: 1 }, ${blueT});
  tl.to("#cfbBlue", { scaleY: 1, duration: 0.26, ease: "back.out(1.6)" }, ${blueT});
  tl.set("#cfbCream", { opacity: 1 }, ${(+blueT + 0.06).toFixed(3)});
  tl.to("#cfbCream", { scaleY: 1, duration: 0.26, ease: "back.out(1.6)" }, ${(+blueT + 0.06).toFixed(3)});
  tl.to("#cfShadow", { opacity: 0.45, scaleX: 1, duration: 0.30, ease: "power2.out" }, ${(+blueT + 0.03).toFixed(3)});

  // the word pops up in hinged segments (left→right), staggered
  for (let i = 0; i < ${segs}; i++) {
    const t0 = I + i * ${stag}, el = "#cfsg" + i;
    tl.set(el, { opacity: 1 }, t0);                                  // 1 within 2 frames
    tl.to(el, { rotationX: 0, duration: 0.26, ease: "back.out(1.4)" }, t0);
  }

  // visible paper struts lean in behind the word
  tl.set(".cfstrut", { opacity: 1 }, ${(I + 0.328).toFixed(3)});
  tl.to("#cfs1", { scaleY: 1, duration: 0.12, ease: "back.out(2)" }, ${(I + 0.328).toFixed(3)});
  tl.to("#cfs2", { scaleY: 1, duration: 0.12, ease: "back.out(2)" }, ${(I + 0.378).toFixed(3)});
${
  wobD >= 0.2
    ? `
  // backdrop + word wobble-settle TOGETHER (one wrapper owns it)
  tl.to("#cfWob", { keyframes: { rotationX: [0, -3.6, 2.4, -1.3, 0.6, 0] },
                    duration: ${wobD}, ease: "sine.inOut" }, ${wobT});`
    : ""
}
${
  brD >= 0.5
    ? `
  // hold life: slow paper breathing through the silence
  tl.to("#cfWob", { keyframes: { rotationX: [0, 1.5, -1.1, 1.3, 0] },
                    duration: ${brD}, ease: "sine.inOut" }, ${brT});
  tl.to("#cfShadow", { keyframes: { scaleX: [1, 1.05, 0.98, 1.04, 1] },
                       duration: ${brD}, ease: "sine.inOut" }, ${brT});`
    : ""
}

  // EXIT — the centerfold folds flat (book closing)
  for (let i = 0; i < ${segs}; i++) {
    const ft = XO + i * 0.05, el = "#cfsg" + i;
    tl.to(el, { rotationX: 88, duration: 0.14, ease: "power2.in" }, ft);
    tl.set(el, { opacity: 0 }, ft + 0.15);
  }
  tl.to(".cfstrut", { scaleY: 0, duration: 0.10, ease: "power2.in" }, XO + 0.02);
  tl.to("#cfbCream", { scaleY: 0.03, duration: 0.13, ease: "power2.in" }, XO + 0.12);
  tl.set("#cfbCream", { opacity: 0 }, XO + 0.26);
  tl.to("#cfbBlue", { scaleY: 0.03, duration: 0.12, ease: "power2.in" }, XO + 0.18);
  tl.set("#cfbBlue", { opacity: 0 }, XO + 0.31);
  tl.to("#cfShadow", { opacity: 0, scaleX: 0.3, duration: 0.16, ease: "power1.in" }, XO + 0.14);
  tl.to("#cfscrim", { opacity: 0, duration: 0.28, ease: "power1.in" }, XO + 0.02);`;
  return { css, html, js };
}

function setpieceChalkwrite() {
  // ---- setpiece: CHALKWRITE (the board grows and a hand WRITES the word) ----
  // The lower chalk band grows into a FULL deep-green board behind the subject
  // 0.3s before the apex (scaleY power3.out from the bottom edge, the room
  // dims with it); the hero word is HAND-WRITTEN in chalk — sequential Hershey
  // stroke reveal (drawon pattern), dry/rough via seeded ±1px jitter baked
  // onto every pen point, a blurred halo under a tight core, a chalk-stick
  // nib riding the pen — while dust specks fall from the nib. On completion a
  // hand-slap CLAP shakes the board 1 frame (the dust burst lives in the
  // rail, in FRONT of the subject: fx.chalkclap), then TWO violent
  // accelerating underlines slash beneath (nib rides them, dust kicks at the
  // ends), the chalk flicks away, and the halo breathes through the hold with
  // two slow motes drifting off the letters.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.chalkW;
  const x0 = Math.round(HG.x - tw / 2);
  let D = execFileSync(
    process.execPath,
    [gen, fontPath, heroDisplay.toLowerCase(), String(tw), "450", String(x0)],
    { encoding: "utf8" },
  ).trim();
  // register the measured ink box on HG (ink CENTER lands on HG.y), then the
  // board rect, underlines and the fg clap all derive from the same box
  const pts = [...D.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const ys0 = pts.map((q) => q[1]);
  const dy = +(HG.y - (Math.min(...ys0) + Math.max(...ys0)) / 2).toFixed(1);
  D = D.replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (m, c, x, y) => `${c} ${x} ${(+y + dy).toFixed(1)}`);
  const inkTop = Math.min(...ys0) + dy,
    inkBot = Math.max(...ys0) + dy,
    inkH = inkBot - inkTop;
  const inkL = Math.min(...pts.map((q) => q[0])),
    inkR = Math.max(...pts.map((q) => q[0]));
  // board: full strip width, grows from the bottom edge up past the ink
  // (demo: ink top 320, board top 248 → gap 0.554 × ink height 130)
  const stripW = (dna.body.strip && dna.body.strip.w) || 1200;
  const SX = (dna.body.strip && dna.body.strip.x) ?? Math.round((W - stripW) / 2);
  const boardTop = Math.max(40, Math.round(inkTop - (p.boardGap ?? 0.554) * Math.max(inkH, 90)));
  const boardH = H - boardTop;
  const kw = stripW / 1200,
    kb = boardH / 472; // board furniture scales with the demo rect (1200×472)
  const ENDT = +(DUR - 0.04).toFixed(3);
  // writing window: keep the demo's 0.78s unless the hero lands too late to
  // finish + underline + hold before the end of the clip
  const WIN = Math.min(p.window || 0.78, Math.max(0.4, ENDT - 0.95 - I));
  const DRAWN = +(I + WIN).toFixed(3);
  // hand-off to the fg dust clap: the pen's final contact point, at write end
  HG.clapX = Math.round(pts[pts.length - 1][0]);
  HG.clapY = Math.round(pts[pts.length - 1][1] + dy);
  HG.clapT = DRAWN;
  const CHALK = dna.palette.chalk || dna.palette.accent || "#fbf9ef";
  const DUST = dna.palette.dust || "#f6f4e9";
  const css = `
  #cwDim { position:absolute; inset:0; background:${p.dimColor || "rgba(4,14,9,0.95)"}; opacity:0; }
  #cwVig { position:absolute; inset:0; opacity:0;
           background: radial-gradient(75% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(2,10,6,0.55) 100%); }
  #cwUnit { position:absolute; inset:0; }
  #cwBoard { position:absolute; left:${SX}px; top:${boardTop}px; width:${stripW}px; height:${boardH}px;
             background: linear-gradient(180deg, ${dna.palette.boardHi || "#22392c"} 0%, ${dna.palette.board || "#1d3328"} 40%, ${dna.palette.boardLo || "#182b22"} 100%);
             border-radius:6px 6px 0 0;
             box-shadow: inset 0 0 90px rgba(0,0,0,0.55), 0 6px 24px rgba(0,0,0,0.45); }
  #cwRim { position:absolute; top:0; left:0; right:0; height:7px; opacity:0.85;
           border-radius:6px 6px 0 0;
           background: linear-gradient(180deg, ${dna.palette.rim || "#8a6a48"} 0%, ${dna.palette.rimLo || "#5f452c"} 100%); }
  #cwBoard .bsm { position:absolute; border-radius:50%; }
  #cwBsm1 { left:${Math.round(120 * kw)}px; top:${Math.round(90 * kb)}px; width:${Math.round(430 * kw)}px; height:${Math.round(150 * kb)}px; transform:rotate(-5deg);
            background: radial-gradient(50% 50% at 50% 50%, rgba(214,226,214,0.08) 0%, rgba(214,226,214,0) 70%); }
  #cwBsm2 { left:${Math.round(660 * kw)}px; top:${Math.round(230 * kb)}px; width:${Math.round(380 * kw)}px; height:${Math.round(130 * kb)}px; transform:rotate(4deg);
            background: radial-gradient(50% 50% at 50% 50%, rgba(214,226,214,0.07) 0%, rgba(214,226,214,0) 70%); }
  #cwSvg { position:absolute; left:0; top:0; overflow:visible; }
  #cwHaloG { opacity:${p.halo ?? 0.18}; }
  #cwCoreG { opacity:0.92; }`;
  const html = `      <div id="cwDim"></div>
      <div id="cwVig"></div>
      <div id="cwUnit">
        <div id="cwBoard">
          <div id="cwRim"></div>
          <div class="bsm" id="cwBsm1"></div>
          <div class="bsm" id="cwBsm2"></div>
        </div>
        <svg id="cwSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <defs>
            <filter id="chalkblur" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.2"/>
            </filter>
          </defs>
          <g id="cwHaloG" filter="url(#chalkblur)"></g>
          <g id="cwCoreG"></g>
          <g id="cwDustG"></g>
          <rect id="cwNib" x="-9" y="-3" width="18" height="6" rx="2.5" fill="#fffef6" opacity="0"/>
        </svg>
      </div>`;
  const js = `
  // ---- setpiece: CHALKWRITE (board grows; the hero word is hand-written in chalk) ----
  const I8 = ${I.toFixed(3)}, WIN8 = ${WIN.toFixed(3)}, DRAWN = ${DRAWN}, ENDT = ${ENDT};
  const D8 = ${J(D)};
  const crnd = mulberry32(${p.seed ?? 7});

  // scene reaction: vignette early; the room dims as the board grows
  tl.fromTo("#cwVig", { opacity: 0 }, { opacity: ${p.vig ?? 0.35}, duration: 0.35, ease: "power1.out" }, 0.10);
  tl.fromTo("#cwDim", { opacity: 0 }, { opacity: ${p.dim ?? 0.22}, duration: 0.30, ease: "power1.in" }, ${(I - 0.3).toFixed(3)});

  // the board grows taller 0.3s before the writing
  gsap.set("#cwBoard", { scaleY: 0, transformOrigin: "50% 100%" });
  tl.to("#cwBoard", { scaleY: 1, duration: 0.30, ease: "power3.out" }, ${(I - 0.3).toFixed(3)});

  // chalk strokes: dry/rough = baked ±1px y jitter on every pen point
  const jrnd = mulberry32(${p.jitterSeed ?? 21});
  const jD = D8.replace(/([ML]) ([-\\d.]+) ([-\\d.]+)/g,
    (m, c, x, y) => c + " " + x + " " + (parseFloat(y) + (jrnd()*2 - 1)).toFixed(1));
  const subs = jD.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNS8 = "http://www.w3.org/2000/svg";
  function mk(parent, d, stroke, w) {
    const el = document.createElementNS(SVGNS8, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", stroke); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokes = subs.map((d) => ({
    halo: mk("cwHaloG", d, "#ffffff", ${p.haloWidth ?? 14}),
    core: mk("cwCoreG", d, ${J(CHALK)}, ${p.coreWidth ?? 7}),
  }));
  let total = 0;
  strokes.forEach((s) => { s.len = s.core.getTotalLength(); total += s.len; });
  const nib = document.getElementById("cwNib");
  gsap.set(nib, { rotation: -36, transformOrigin: "50% 50%" });
  let acc = 0;
  const cum = [];                                      // cumulative starts per stroke
  strokes.forEach((s) => { cum.push(acc); acc += s.len; });
  strokes.forEach((s, si) => {
    const d = WIN8 * s.len / total, st = I8 + WIN8 * cum[si] / total;
    gsap.set([s.core, s.halo], { strokeDasharray: s.len, strokeDashoffset: s.len });
    tl.set([s.core, s.halo], { opacity: 1 }, st);
    tl.fromTo([s.core, s.halo], { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, st);
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(nib, { x: xs[0], y: ys[0] }, st);
    tl.to(nib, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, st);
  });
  tl.set(nib, { opacity: 1 }, I8 - 0.01);

  // ${p.dustN ?? 8} dust specks fall from the nib along the path
  function speck(parent, x, y, r, fill) {
    const c = document.createElementNS(SVGNS8, "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", r);
    c.setAttribute("fill", fill); c.setAttribute("opacity", "0");
    document.getElementById(parent).appendChild(c);
    return c;
  }
  for (let k = 0; k < ${p.dustN ?? 8}; k++) {
    const f = (k + 0.6) / ${p.dustN ?? 8}, target = f * total;
    let si = 0; while (si < strokes.length - 1 && cum[si + 1] <= target) si++;
    const pt = strokes[si].core.getPointAtLength(target - cum[si]);
    const c = speck("cwDustG", pt.x, pt.y + 4, 1.6 + crnd() * 1.4, ${J(DUST)});
    const ts = I8 + f * WIN8;
    tl.set(c, { opacity: 0.9 }, ts);
    tl.to(c, { y: 26 + crnd() * 20, x: crnd() * 14 - 7, duration: 0.5, ease: "power1.in" }, ts);
    tl.to(c, { opacity: 0, duration: 0.42, ease: "power1.in" }, ts + 0.08);
  }

  // hand-slap CLAP: 1-frame board shake (dust burst lives in the rail, in front)
  tl.set("#cwUnit", { y: 3  }, DRAWN);
  tl.set("#cwUnit", { y: -2 }, DRAWN + F);
  tl.set("#cwUnit", { y: 1  }, DRAWN + 2*F);
  tl.set("#cwUnit", { y: 0  }, DRAWN + 3*F);

  // two violent underlines (fast accelerating slashes), seeded waviness
  const UL = [
    { x1: ${Math.round(inkL + 14)}, x2: ${Math.round(inkR - 4)},  y: ${Math.round(inkBot + 30)}, n: 4, t: DRAWN + 0.09, dur: 0.10 },
    { x1: ${Math.round(inkL + 58)}, x2: ${Math.round(inkR - 44)}, y: ${Math.round(inkBot + 50)}, n: 3, t: DRAWN + 0.23, dur: 0.09 },
  ];
  UL.forEach((u) => {
    if (u.t + u.dur > ENDT - 0.1) return;
    let ud = "M " + u.x1 + " " + (u.y + (crnd()*9 - 4.5)).toFixed(1);
    for (let k = 1; k <= u.n; k++)
      ud += " L " + (u.x1 + (u.x2 - u.x1) * k / u.n).toFixed(1) + " " + (u.y + (crnd()*9 - 4.5)).toFixed(1);
    const halo = mk("cwHaloG", ud, "#ffffff", ${p.haloWidth ?? 14});
    const core = mk("cwCoreG", ud, ${J(CHALK)}, ${(p.coreWidth ?? 7) + 1});
    const len = core.getTotalLength();
    gsap.set([core, halo], { strokeDasharray: len, strokeDashoffset: len });
    tl.set([core, halo], { opacity: 1 }, u.t);
    tl.fromTo([core, halo], { strokeDashoffset: len },
              { strokeDashoffset: 0, duration: u.dur, ease: "power3.in" }, u.t);
    // nib rides the slash
    const n = 8, xs = [], ys = [];
    for (let k = 0; k <= n; k++) { const pt = core.getPointAtLength(len * k / n); xs.push(pt.x); ys.push(pt.y); }
    tl.set(nib, { x: xs[0], y: ys[0] }, u.t);
    tl.to(nib, { keyframes: { x: xs, y: ys }, duration: u.dur, ease: "none" }, u.t);
    // dust kicked up where the slash ends
    for (let k = 0; k < 3; k++) {
      const c = speck("cwDustG", xs[n] - 4 + crnd() * 8, ys[n], 1.4 + crnd(), ${J(DUST)});
      tl.set(c, { opacity: 0.85 }, u.t + u.dur);
      tl.to(c, { y: 16 + crnd() * 14, x: crnd() * 18 - 6, opacity: 0, duration: 0.38, ease: "power1.in" }, u.t + u.dur);
    }
  });
  // chalk flicks away after the second underline
  tl.to(nib, { x: "+=30", y: "+=22", scale: 2, opacity: 0, duration: 0.14, ease: "power2.in" },
        Math.min(DRAWN + 0.35, ENDT - 0.15));

  // hold life: halo breathe (baked f(t), deterministic)
  const humStart = Math.min(DRAWN + 0.46, ENDT - 0.3), humDur = ENDT - humStart;
  const N8 = Math.max(6, Math.round(humDur / (2 * F)));
  const humVals = [];
  for (let k = 0; k <= N8; k++) {
    const tt = k / N8 * humDur;
    humVals.push(${p.halo ?? 0.18} + 0.05 * Math.sin(2 * Math.PI * 1.6 * tt) + 0.02 * Math.sin(2 * Math.PI * 3.7 * tt + 0.8));
  }
  tl.to("#cwHaloG", { keyframes: { opacity: humVals }, duration: humDur, ease: "none" }, humStart);
  // two slow motes drifting off the letters during the hold
  [[humStart + 0.10, ${Math.round(inkL + 0.43 * (inkR - inkL))}], [humStart + 0.50, ${Math.round(inkL + 0.71 * (inkR - inkL))}]].forEach(([ts, mx]) => {
    if (ts + 0.5 > ENDT) return;
    const c = speck("cwDustG", mx + crnd() * 30, ${Math.round((inkTop + inkBot) / 2 + 42)}, 1.5 + crnd(), ${J(DUST)});
    tl.set(c, { opacity: 0.6 }, ts);
    tl.to(c, { y: 30, x: crnd() * 10 - 5, opacity: 0, duration: 0.5, ease: "power1.in" }, ts);
  });`;
  return { css, html, js };
}

function setpieceSpraytag() {
  // ---- setpiece: SPRAYTAG (a writer steps up and TAGS the hero word) ----
  // The dusk wall dims + a radial scrim charges as the writer steps up; the
  // can RATTLES at the start point (seeded set-chain nib jitter), then the
  // hero word is spray-written stroke by stroke — sequential Hershey dash
  // reveal (drawon pattern) — as a TRIPLE stack per stroke: fat dark
  // under-stroke (sky-contrast armor) + blurred overspray halo + wet paint
  // core, the glowing nib riding each stroke. Seeded overspray dots pop near
  // the nib as it passes; the nib throws off at the finish (the magenta splat
  // lives in the rail, in FRONT of the subject: fx.paintsplat). Through the
  // hold, seeded DRIPS grow from painted low points (signature) and the halo
  // hums while the whole tag slowly looms.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.sprayW;
  const x0 = Math.round(HG.x - tw / 2);
  let D = execFileSync(
    process.execPath,
    [gen, fontPath, heroDisplay.toLowerCase(), String(tw), "450", String(x0)],
    { encoding: "utf8" },
  ).trim();
  // register the measured ink box on HG (ink CENTER lands on HG.y); the loom
  // origin and the fg paint splat derive from the same box
  const pts = [...D.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const ys0 = pts.map((q) => q[1]);
  const dy = +(HG.y - (Math.min(...ys0) + Math.max(...ys0)) / 2).toFixed(1);
  D = D.replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (m, c, x, y) => `${c} ${x} ${(+y + dy).toFixed(1)}`);
  const ENDT = +(DUR - 0.04).toFixed(3);
  // writing window: keep the demo's 0.58s unless the hero lands too late to
  // finish + splat + drip before the end of the clip
  const WIN = Math.min(p.window || 0.58, Math.max(0.35, ENDT - 0.55 - I));
  const DRAWN = +(I + WIN).toFixed(3);
  // hand-off to the fg paint splat: the pen-finish point, at write end
  HG.splatX = Math.round(pts[pts.length - 1][0]);
  HG.splatY = Math.round(pts[pts.length - 1][1] + dy);
  HG.splatT = DRAWN;
  const PAINT = dna.palette.accent || "#ffd23f";
  const UNDER = dna.palette.under || "#241008";
  const NIB = dna.palette.nib || "#fff6d9";
  const css = `
  #stDim   { position:absolute; inset:0; opacity:0; background:${p.dimColor || "#0a0608"}; }
  #stScrim { position:absolute; inset:0; opacity:0;
             background: radial-gradient(92% 78% at 50% 36%, rgba(0,0,0,0) 28%, rgba(10,4,12,0.78) 100%); }
  #stWrap { position:absolute; inset:0; }
  #stSvg  { position:absolute; left:0; top:0; overflow:visible; }
  #stCoreG { filter: drop-shadow(0 3px 7px rgba(0,0,0,0.55)); }
  #stNib { filter: blur(0.8px) drop-shadow(0 0 9px ${PAINT}e6); }
  .stdrip { position:absolute; height:0; opacity:0;
            background: linear-gradient(180deg, ${PAINT} 0%, ${dna.palette.dripMid || "#eab928"} 78%, ${dna.palette.dripLo || "#d8a51d"} 100%);
            border-radius: 0 0 4px 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.35); }`;
  const html = `      <div id="stDim"></div><div id="stScrim"></div>
      <div id="stWrap">
        <svg id="stSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <defs>
            <filter id="sprayblur" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="7"/>
            </filter>
          </defs>
          <g id="stUnderG" opacity="0.9"></g>
          <g id="stHaloG" filter="url(#sprayblur)" opacity="${p.haloOpacity ?? 0.5}"></g>
          <g id="stCoreG"></g>
          <g id="stOsprayG"></g>
          <circle id="stNib" r="9" fill="${NIB}" opacity="0"/>
        </svg>
      </div>`;
  const js = `
  // ---- setpiece: SPRAYTAG (rattle → sequential spray write → drips + hum) ----
  const Ig = ${I.toFixed(3)}, WINg = ${WIN.toFixed(3)}, DRAWNg = ${DRAWN}, ENDTg = ${ENDT};
  const Dg = ${J(D)};
  const grnd = mulberry32(${p.seed ?? 140987});

  // scene reaction: the wall darkens as the writer steps up (charge)
  tl.fromTo("#stDim",   { opacity: 0 }, { opacity: ${p.dim ?? 0.22}, duration: 0.40, ease: "power2.in" }, ${(I - 0.42).toFixed(3)});
  tl.fromTo("#stScrim", { opacity: 0 }, { opacity: ${p.scrim ?? 0.62}, duration: 0.40, ease: "power2.in" }, ${(I - 0.42).toFixed(3)});

  // per-stroke TRIPLE stack (split at pen lifts) — sequential dash reveal
  const subsG = Dg.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNSG = "http://www.w3.org/2000/svg";
  function mkG(parent, d, stroke, w) {
    const el = document.createElementNS(SVGNSG, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", stroke); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokesG = subsG.map((d) => ({
    under: mkG("stUnderG", d, ${J(UNDER)}, ${p.underWidth ?? 21}),  // dark edge — sky-contrast armor
    halo:  mkG("stHaloG",  d, ${J(PAINT)}, ${p.haloWidth ?? 36}),   // fat soft overspray spread
    core:  mkG("stCoreG",  d, ${J(PAINT)}, ${p.coreWidth ?? 13}),   // wet paint core
  }));
  let totalG = 0;
  strokesG.forEach((s) => { s.len = s.core.getTotalLength(); totalG += s.len; });

  // helper: point at a global arc-length along the whole word
  function pointAtTotal(L) {
    let acc = 0;
    for (const s of strokesG) {
      if (L <= acc + s.len) return s.core.getPointAtLength(L - acc);
      acc += s.len;
    }
    return strokesG[strokesG.length - 1].core.getPointAtLength(strokesG[strokesG.length - 1].len);
  }

  // ANTICIPATION: the can RATTLES at the start point before painting
  const nibG = document.getElementById("stNib");
  gsap.set(nibG, { attr: { cx: 0, cy: 0 } });
  const p0g = pointAtTotal(0);
  tl.set(nibG, { opacity: 1, x: p0g.x, y: p0g.y }, Ig - 0.30);
  for (let k = 0; k < 6; k++) {                      // set-chain rattle (sanctioned jitter)
    tl.set(nibG, { x: p0g.x + (grnd() - 0.5) * 10, y: p0g.y + (grnd() - 0.5) * 7 }, Ig - 0.28 + k * 2 * F);
  }
  tl.set(nibG, { x: p0g.x, y: p0g.y }, Ig - 0.02);

  // SEQUENTIAL spray write: constant pen speed, nib rides each stroke
  let tg = Ig;
  strokesG.forEach((s) => {
    const d = WINg * s.len / totalG;
    gsap.set([s.under, s.halo, s.core], { strokeDasharray: s.len, strokeDashoffset: s.len });
    tl.set([s.under, s.halo, s.core], { opacity: 1 }, tg);
    tl.fromTo([s.under, s.halo, s.core], { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, tg);
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(nibG, { x: xs[0], y: ys[0] }, tg);
    tl.to(nibG, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, tg);
    tg += d;
  });
  // nib throw-off at the finish (the splat ring itself lives on the rail layer)
  tl.to(nibG, { scale: 2.6, opacity: 0, duration: 0.12, ease: "power2.in",
                transformOrigin: "50% 50%" }, DRAWNg);

  // OVERSPRAY: seeded dots popping near the nib as it passes
  for (let i = 0; i < ${p.osprayN ?? 6}; i++) {
    const c = document.createElementNS(SVGNSG, "circle");
    c.setAttribute("r", (2 + grnd() * 2.4).toFixed(1));
    c.setAttribute("fill", ${J(PAINT)}); c.setAttribute("opacity", "0");
    document.getElementById("stOsprayG").appendChild(c);
    const f = 0.08 + 0.84 * grnd();
    const ti = Ig + WINg * f;
    const pt = pointAtTotal(totalG * f);
    const ox = (grnd() < 0.5 ? -1 : 1) * (9 + grnd() * 18);
    const oy = (grnd() < 0.5 ? -1 : 1) * (7 + grnd() * 14);
    tl.set(c, { opacity: 0.85 }, ti);
    tl.fromTo(c, { attr: { cx: pt.x + ox, cy: pt.y + oy } },
              { attr: { cx: pt.x + ox * 1.9, cy: pt.y + oy * 1.9 },
                duration: 0.30, ease: "power2.out" }, ti);
    tl.to(c, { opacity: 0, duration: 0.26, ease: "power1.in" }, ti + 0.05);
  }

  // DRIPS (signature): seeded drips grow from painted low points and KEEP
  // growing through the hold
  const samplesG = [];
  { let acc = 0;
    strokesG.forEach((s) => {
      const n = Math.max(6, Math.round(s.len / 10));
      for (let k = 0; k <= n; k++) {
        const L = s.len * k / n;
        const pt = s.core.getPointAtLength(L);
        samplesG.push({ x: pt.x, y: pt.y, L: acc + L });
      }
      acc += s.len;
    });
  }
  const maxYg = Math.max(...samplesG.map(q => q.y));
  const lowsG = samplesG.filter(q => q.y > maxYg - 8).sort((a, b) => a.x - b.x);
  const pickedG = [];
  for (let tries = 0; tries < 60 && pickedG.length < ${p.drips ?? 3}; tries++) {
    const cand = lowsG[Math.floor(grnd() * lowsG.length)];
    if (cand && pickedG.every(q => Math.abs(q.x - cand.x) > 110)) pickedG.push(cand);
  }
  const stageG = document.getElementById("stage");
  pickedG.forEach((q) => {
    const el = document.createElement("div");
    el.className = "stdrip"; stageG.appendChild(el);
    const w = 6 + Math.round(grnd() * 3);
    gsap.set(el, { left: q.x - w / 2, top: q.y - 4, width: w });
    const paintT = Ig + WINg * (q.L / totalG);
    const start = Math.min(paintT + 0.22 + grnd() * 0.22, ENDTg - 0.3);
    const dur = Math.min(1.25, ENDTg - start);
    const hh = (36 + grnd() * 36) * Math.max(0.55, dur / 1.25);
    tl.set(el, { opacity: 1 }, start);
    tl.to(el, { height: hh, duration: dur, ease: "power1.in" }, start);
  });

  // HOLD LIFE: halo hum (baked f(t), deterministic) + slow loom on the whole tag
  const humStartG = DRAWNg + 0.06, humDurG = Math.max(0.2, ENDTg - DRAWNg - 0.06);
  const NG = Math.max(6, Math.round(humDurG / (2 * F)));
  const humValsG = [];
  for (let k = 0; k <= NG; k++) {
    const tt = k / NG * humDurG;
    humValsG.push(${p.haloOpacity ?? 0.5} + 0.07 * Math.sin(2 * Math.PI * 7 * tt) + 0.05 * Math.sin(2 * Math.PI * 11 * tt + 0.9));
  }
  tl.to("#stHaloG", { keyframes: { opacity: humValsG }, duration: humDurG, ease: "none" }, humStartG);
  gsap.set("#stWrap", { transformOrigin: "${HG.x}px ${HG.y}px" });
  tl.to("#stWrap", { scale: 1.014, duration: 0.5, ease: "power1.inOut" }, DRAWNg + 0.08);`;
  return { css, html, js };
}

function setpieceBrushwrite() {
  // ---- setpiece: BRUSHWRITE (sumi-e — ONE violent calligraphic gesture) ----
  // A warm paper wash charges behind the word; the brush SLAPS down at the
  // first pen point (start-splat: irregular ink blob + seeded satellites —
  // the fg fleck pass rides fx.brushflecks), then the hero word is written in
  // ONE sequential gesture — Hershey dash reveal at constant pen speed — as a
  // FOUR-layer stack per stroke (blurred bleed under fat/mid/core widths =
  // pressure-tapered wet brush), the round ink nib riding the pen and
  // flicking off at the finish. Spatter droplets eject perpendicular at the
  // sharpest-curvature points of the gesture. Through the hold the ink
  // BLEEDS into the paper (the blurred under-layer swells visible) and the
  // whole work breathes; then the vermilion SEAL chop stamps beside the ink
  // (power4 crush → 2-frame squash → elastic settle, red flecks kicked) —
  // the plate punch lands on the chop contact.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.brushW;
  const x0 = Math.round(HG.x - tw / 2);
  let D = execFileSync(
    process.execPath,
    [gen, fontPath, heroDisplay.toLowerCase(), String(tw), "450", String(x0)],
    { encoding: "utf8" },
  ).trim();
  // register the measured ink box on HG (ink CENTER lands on HG.y); the wash,
  // breathe origin, seal chop and the fg flecks all derive from the same box
  const pts = [...D.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const ys0 = pts.map((q) => q[1]);
  const dy = +(HG.y - (Math.min(...ys0) + Math.max(...ys0)) / 2).toFixed(1);
  D = D.replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (m, c, x, y) => `${c} ${x} ${(+y + dy).toFixed(1)}`);
  const inkBot = Math.max(...ys0) + dy;
  const inkR = Math.max(...pts.map((q) => q[0]));
  const ENDT = +(DUR - 0.04).toFixed(3);
  // writing window: keep the demo's 0.45s unless the gesture lands too late to
  // finish + seal + bleed before the end of the clip
  const WIN = Math.min(p.window || 0.45, Math.max(0.3, ENDT - 0.9 - I));
  const DRAWN = +(I + WIN).toFixed(3);
  // hand-off to the fg ink flecks: the brush's FIRST contact point, at slap-down
  HG.fleckX = Math.round(pts[0][0]);
  HG.fleckY = Math.round(pts[0][1] + dy);
  HG.fleckT = +(I + 0.01).toFixed(3);
  // seal chop: below-right of the ink (demo offsets), kept on frame
  const SEALC = +(DRAWN + (p.sealDelay ?? 0.04)).toFixed(3);
  const sealS = p.sealSize ?? 64;
  const sealX = Math.min(W - 48, Math.max(60, Math.round(inkR + (p.sealDx ?? -103))));
  const sealY = Math.min(H - 80, Math.round(inkBot + (p.sealDy ?? 72)));
  const INK = dna.palette.ink || "#19120b";
  const WASH = dna.palette.wash || "#f6f0e2";
  const WASH2 = dna.palette.wash2 || "#f4edde";
  const washW = tw + 380,
    washH = p.washH ?? 420;
  const bleedT = +(DRAWN + 0.1).toFixed(3);
  const bleedDur = +Math.max(0.4, Math.min(1.7, ENDT - DRAWN - 0.1)).toFixed(2);
  const breT = +Math.min(SEALC, ENDT - 0.4).toFixed(3);
  const breDur = +Math.max(0.3, Math.min(1.78, ENDT - breT)).toFixed(2);
  const breN = Math.max(8, Math.round(breDur / (2 * F)));
  const css = `
  #bwWash { position:absolute; left:${HG.x}px; top:${HG.y}px; width:${washW}px; height:${washH}px;
            margin-left:-${Math.round(washW / 2)}px; margin-top:-${Math.round(washH / 2)}px; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%,
              ${WASH}d9 0%, ${WASH2}73 52%, ${WASH2}00 75%); }
  #bwSvg { position:absolute; left:0; top:0; overflow:visible; }
  #bwSeal { position:absolute; left:${sealX}px; top:${sealY}px; width:${sealS}px; height:${sealS}px; opacity:0;
            border-radius:6px;
            background: radial-gradient(70% 70% at 42% 38%, ${dna.palette.seal || "#d24a32"} 0%, ${dna.palette.sealMid || "#c03422"} 62%, ${dna.palette.sealLo || "#a92a1a"} 100%);
            box-shadow: 0 3px 10px rgba(20,10,6,0.45), inset 0 0 9px rgba(255,140,110,0.35); }
  #bwSeal span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                 font-family:'${dna.fonts.seal || dna.fonts.body}', serif; font-weight:700;
                 font-size:${Math.round(sealS * 0.656)}px; color:${dna.palette.sealText || "#f7efe2"}; }
  .bwfleck { position:absolute; border-radius:50%; background:${dna.palette.sealMid || "#c03422"}; opacity:0; }`;
  const html = `      <div id="bwWash"></div>
      <svg id="bwSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs>
          <filter id="bwbleedblur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6"/>
          </filter>
        </defs>
        <g id="bwInkAll">
          <g id="bwBleedG" filter="url(#bwbleedblur)" opacity="0"></g>
          <g id="bwFatG"></g>
          <g id="bwMidG"></g>
          <g id="bwCoreG"></g>
        </g>
        <g id="bwSplatG" opacity="0"></g>
        <g id="bwSpatG"></g>
        <circle id="bwNib" r="7.5" fill="${dna.palette.nib || "#1a130c"}" opacity="0"/>
      </svg>
      <div id="bwSeal"><span>${esc(p.sealGlyph || (heroDisplay.trim()[0] || "*").toUpperCase())}</span></div>`;
  const js = `
  // ---- setpiece: BRUSHWRITE (slap-down → one gesture → bleed + seal chop) ----
  const Ib = ${I.toFixed(3)}, WINb = ${WIN.toFixed(3)}, DRAWNb = ${DRAWN}, ENDTb = ${ENDT};
  const Db = ${J(D)};
  const wrnd = mulberry32(${p.seed ?? 380611});

  // scene reaction: the paper wash charges in just before the gesture
  tl.fromTo("#bwWash", { opacity: 0 }, { opacity: ${p.wash ?? 0.34}, duration: 0.22, ease: "power2.in" }, ${(I - 0.18).toFixed(3)});
${
  I + 1.3 < ENDT
    ? `  tl.to("#bwWash", { opacity: ${p.washSettle ?? 0.27}, duration: ${Math.min(1.2, ENDT - I - 1.0).toFixed(2)}, ease: "power1.out" }, ${(I + 1.0).toFixed(3)});`
    : ""
}

  // strokes split at pen lifts; FOUR stacked widths = pressure-tapered wet brush
  const subsB = Db.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  const SVGNSB2 = "http://www.w3.org/2000/svg";
  function mkB(parent, d, w, op) {
    const el = document.createElementNS(SVGNSB2, "path");
    el.setAttribute("d", d); el.setAttribute("fill", "none");
    el.setAttribute("stroke", ${J(INK)}); el.setAttribute("stroke-width", w);
    el.setAttribute("stroke-opacity", op);
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("opacity", "0");
    document.getElementById(parent).appendChild(el);
    return el;
  }
  const strokesB = subsB.map((d) => ({
    bleed: mkB("bwBleedG", d, ${p.bleedWidth ?? 16}, 1),
    fat:   mkB("bwFatG",   d, ${p.fatWidth ?? 18}, 0.25),
    mid:   mkB("bwMidG",   d, ${p.midWidth ?? 10}, 0.6),
    core:  mkB("bwCoreG",  d, ${p.coreWidth ?? 5}, 1),
  }));
  let totalB = 0;
  strokesB.forEach((s) => { s.len = s.core.getTotalLength(); totalB += s.len; });

  // start-splat: irregular ink blob at the first pen point (the brush SLAPS down)
  const SXB = ${Math.round(pts[0][0])}, SYB = ${Math.round(pts[0][1] + dy)};
  (function buildSplat() {
    const g = document.getElementById("bwSplatG");
    const main = document.createElementNS(SVGNSB2, "ellipse");
    main.setAttribute("cx", SXB - 4); main.setAttribute("cy", SYB + 2);
    main.setAttribute("rx", 24); main.setAttribute("ry", 15);
    main.setAttribute("transform", "rotate(-24 " + (SXB - 4) + " " + (SYB + 2) + ")");
    main.setAttribute("fill", ${J(INK)}); main.setAttribute("fill-opacity", "0.9");
    g.appendChild(main);
    for (let i = 0; i < 5; i++) {
      const c = document.createElementNS(SVGNSB2, "circle");
      const a = wrnd() * Math.PI * 2, dist = 16 + wrnd() * 26;
      c.setAttribute("cx", SXB - 4 + Math.cos(a) * dist);
      c.setAttribute("cy", SYB + 2 + Math.sin(a) * dist * 0.7);
      c.setAttribute("r", (1.8 + wrnd() * 3.4).toFixed(1));
      c.setAttribute("fill", ${J(INK)}); c.setAttribute("fill-opacity", "0.85");
      g.appendChild(c);
    }
  })();
  tl.set("#bwSplatG", { opacity: 1 }, Ib);
  tl.fromTo("#bwSplatG", { scale: 0.35, svgOrigin: "${Math.round(pts[0][0])} ${Math.round(pts[0][1] + dy)}" },
            { scale: 1, duration: 0.12, ease: "power3.out" }, Ib);

  // ONE sequential gesture: constant pen speed, the round ink nib riding
  const nibB = document.getElementById("bwNib");
  let tb = Ib, accB = 0;
  const curvB = [];   // spatter candidates: {x,y,ang,dA,te}
  strokesB.forEach((s) => {
    const d = WINb * s.len / totalB;
    const layers = [s.bleed, s.fat, s.mid, s.core];
    layers.forEach(pp => gsap.set(pp, { strokeDasharray: s.len, strokeDashoffset: s.len }));
    tl.set(layers, { opacity: 1 }, tb);
    tl.fromTo(layers, { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, tb);
    const n = Math.max(6, Math.round(s.len / 12)), xs = [], ys = [];
    let prevAng = null;
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
      if (k > 0) {
        const ang = Math.atan2(ys[k] - ys[k-1], xs[k] - xs[k-1]);
        if (prevAng !== null) {
          let dA = Math.abs(ang - prevAng); if (dA > Math.PI) dA = 2 * Math.PI - dA;
          if (dA > 0.55)
            curvB.push({ x: xs[k-1], y: ys[k-1], ang: prevAng, dA,
                         te: Ib + WINb * (accB + s.len * (k-1) / n) / totalB });
        }
        prevAng = ang;
      }
    }
    tl.set(nibB, { x: xs[0], y: ys[0] }, tb);
    tl.to(nibB, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, tb);
    tb += d; accB += s.len;
  });
  gsap.set(nibB, { attr: { cx: 0, cy: 0 } });
  tl.set(nibB, { opacity: 1 }, Ib - 0.01);
  // the brush lifts off with a flick at the end of the gesture
  tl.to(nibB, { x: "+=42", y: "-=30", scale: 1.9, opacity: 0, duration: 0.1,
                ease: "power2.in", transformOrigin: "50% 50%" }, DRAWNb);

  // spatter droplets ejected at the sharpest-curvature points of the gesture
  curvB.sort((a, b) => b.dA - a.dA);
  const pickedB = [];
  for (const c of curvB) {
    if (pickedB.length >= ${p.spatterN ?? 6}) break;
    if (pickedB.every(q => Math.abs(q.te - c.te) > 0.045)) pickedB.push(c);
  }
  const spatB = document.getElementById("bwSpatG");
  pickedB.forEach((c) => {
    if (c.te + 0.33 > ENDTb) return;
    const el = document.createElementNS(SVGNSB2, "circle");
    el.setAttribute("cx", c.x); el.setAttribute("cy", c.y);
    el.setAttribute("r", (2.2 + wrnd() * 2.2).toFixed(1));
    el.setAttribute("fill", ${J(INK)}); el.setAttribute("opacity", "0");
    spatB.appendChild(el);
    const side = wrnd() > 0.5 ? 1 : -1;
    const ea = c.ang + side * Math.PI / 2;
    const dist = 34 + wrnd() * 60;
    const dx = Math.cos(ea) * dist, dyv = Math.sin(ea) * dist - 18;
    tl.set(el, { opacity: 1 }, c.te);
    tl.to(el, { keyframes: { x: [0, dx * 0.6, dx], y: [0, dyv * 0.6, dyv + 22],
                             opacity: [1, 0.9, 0] },
                duration: 0.32, ease: "power2.out" }, c.te);
  });

  // HOLD: the ink BLEEDS into the paper (blurred under-layer swells) + breathe
  tl.to("#bwBleedG", { opacity: ${p.bleed ?? 0.38}, duration: ${bleedDur}, ease: "sine.inOut" }, ${bleedT});
  const bNb = ${breN}, bValsB = [];
  for (let k = 0; k <= bNb; k++) {
    const tt = k / bNb * ${breDur};
    bValsB.push(1 + 0.006 * Math.sin(2 * Math.PI * ${p.breatheHz ?? 0.55} * tt));
  }
  tl.to("#bwInkAll", { keyframes: { scale: bValsB }, duration: ${breDur}, ease: "none",
                       svgOrigin: "${HG.x} ${HG.y}" }, ${breT});
${
  SEALC + 0.38 <= ENDT
    ? `
  // vermilion SEAL chop stamps the work — the plate punch lands on the contact
  gsap.set("#bwSeal", { xPercent: -50, yPercent: -50, rotation: -6, transformOrigin: "50% 50%" });
  tl.set("#bwSeal", { opacity: 1, scale: 1.7 }, ${(SEALC - 0.1).toFixed(3)});
  tl.to("#bwSeal", { scale: 1, duration: 0.09, ease: "power4.in" }, ${(SEALC - 0.095).toFixed(3)});
  tl.set("#bwSeal", { scaleX: 1.07, scaleY: 0.93 }, ${SEALC});
  tl.to("#bwSeal", { scaleX: 1, scaleY: 1, duration: 0.28, ease: "elastic.out(1, 0.4)" }, ${(SEALC + 0.08).toFixed(3)});
  { const stg = document.getElementById("stage");
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("div"); el.className = "bwfleck";
      stg.appendChild(el);
      const s = 2 + Math.round(wrnd() * 2);
      gsap.set(el, { width: s, height: s, left: ${sealX}, top: ${sealY} });
      const a = wrnd() * Math.PI * 2, dist = 32 + wrnd() * 38;
      tl.set(el, { opacity: 0.9 }, ${(SEALC + 0.01).toFixed(3)});
      tl.to(el, { x: Math.cos(a) * dist, y: Math.sin(a) * dist + 12, opacity: 0,
                  duration: 0.3, ease: "power2.out" }, ${(SEALC + 0.01).toFixed(3)});
    }
  }`
    : ""
}`;
  return { css, html, js };
}

function setpiecePlotterdraw() {
  // ---- setpiece: PLOTTERDRAW (technical-drawing plotter writes the word) ----
  // A cyanotype scrim drops over the upper frame + a drafting grid charges
  // (scene reaction behind the subject); registration crosses snap into the
  // sheet corners and a faint dashed construction guide previews the full
  // path. Then a thin white PEN plots the hero word in ONE sequential
  // gesture — Hershey dash reveal at constant pen speed, a square nib hopping
  // at pen lifts — over a tight glow core. On completion a 45-degree HATCH
  // fill sweeps L->R through the glyph area (a masked rect: the strokes are
  // copied fat into an SVG mask, so the hatch only shows inside the word),
  // and a "REV A // APPROVED" chip STAMPS at the word's bottom-left corner
  // (crush -> 2-frame squash -> elastic settle, with a stamp flash). Through
  // the hold the whole drawing breathes and the hatch shimmers; exit: the
  // hatch retracts, the pen UN-DRAWS in reverse order (fast), the chip lifts
  // away and the scrim + grid clear. Same draw-on family as chalkwrite /
  // brushwrite (shared gen-stroke-path + measured-ink-box registration); the
  // hatch rect, mask copies, registration crosses, guide and chip all derive
  // from the measured ink box.
  const h = dna.hero,
    p = h.params,
    I = heroIn;
  const fontPath = path.join(SKILL, "assets/strokefonts", dna.fonts.strokeFont);
  const gen = path.join(SKILL, "scripts/gen-stroke-path.cjs");
  const tw = HG.plotW;
  const x0 = Math.round(HG.x - tw / 2);
  let D = execFileSync(
    process.execPath,
    [gen, fontPath, heroDisplay.toLowerCase(), String(tw), "450", String(x0)],
    { encoding: "utf8" },
  ).trim();
  // register the measured ink box on HG (ink CENTER lands on HG.y); the hatch
  // rect, mask, registration crosses, guide and chip all derive from it
  const pts = [...D.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const ys0 = pts.map((q) => q[1]);
  const dy = +(HG.y - (Math.min(...ys0) + Math.max(...ys0)) / 2).toFixed(1);
  D = D.replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (m, c, x, y) => `${c} ${x} ${(+y + dy).toFixed(1)}`);
  const inkTop = Math.min(...ys0) + dy,
    inkBot = Math.max(...ys0) + dy;
  const inkL = Math.min(...pts.map((q) => q[0])),
    inkR = Math.max(...pts.map((q) => q[0]));
  const ENDT = +(DUR - 0.04).toFixed(3);
  // writing window: keep the demo's 0.55s unless the plot lands too late to
  // finish + hatch + chip + hold before the end of the clip
  const WIN = Math.min(p.window || 0.55, Math.max(0.34, ENDT - 1.0 - I));
  const DRAWN = +(I + WIN).toFixed(3);
  // sheet box (registration corners) around the ink, clamped to frame
  const padX = p.sheetPadX ?? 40,
    padTop = p.sheetPadTop ?? 12,
    padBot = p.sheetPadBot ?? 24;
  const shL = Math.max(20, Math.round(inkL - padX)),
    shR = Math.min(W - 20, Math.round(inkR + padX));
  const shT = Math.max(20, Math.round(inkTop - padTop)),
    shB = Math.min(H - 20, Math.round(inkBot + padBot));
  // hatch rect spans the ink box; mask box pads it generously
  const hatchX = Math.round(inkL - 12),
    hatchY = Math.round(inkTop - 6),
    hatchH = Math.round(inkBot - inkTop + 18),
    hatchW = Math.round(inkR - inkL + 30);
  const maskX = Math.round(inkL - 30),
    maskY = Math.round(inkTop - 14),
    maskW = Math.round(inkR - inkL + 60),
    maskH = Math.round(inkBot - inkTop + 34);
  // chip lands at the word's bottom-left corner
  const chipX = Math.round(inkL + (p.chipDx ?? 8)),
    chipY = Math.round(inkBot + (p.chipDy ?? 18));
  const CHT = +(DRAWN + (p.chipDelay ?? 0.48)).toFixed(3);
  const LINE = dna.palette.line || "#ffffff";
  const BLUE = dna.palette.blueline || dna.palette.accent || "#9fc6ff";
  const breT = +Math.min(DRAWN + 0.44, ENDT - 0.4).toFixed(3);
  const breDur = +Math.max(0.3, Math.min(0.86, ENDT - breT)).toFixed(2);
  const breN = Math.max(8, Math.round(breDur / (2 * F)));
  const css = `
  #pdScrim { position:absolute; inset:0; opacity:0;
             background: linear-gradient(180deg, ${dna.palette.scrimTop || "rgba(8,24,52,0.60)"} 0%,
               ${dna.palette.scrimMid || "rgba(10,30,60,0.42)"} 42%, rgba(10,30,60,0.14) 72%, rgba(10,30,60,0) 100%); }
  #pdGrid { position:absolute; left:0; top:0; width:${W}px; height:${Math.round(H * 0.53)}px; opacity:0;
            background:
              repeating-linear-gradient(0deg,  ${BLUE}1a 0 1px, transparent 1px 46px),
              repeating-linear-gradient(90deg, ${BLUE}1a 0 1px, transparent 1px 46px);
            -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 70%, transparent 100%);
                    mask-image: linear-gradient(180deg, #000 0%, #000 70%, transparent 100%); }
  #pdWrap { position:absolute; inset:0; }
  #pdPlot { position:absolute; left:0; top:0; overflow:visible; }
  #pdCoreG { filter: drop-shadow(0 0 5px ${BLUE}f2) drop-shadow(0 2px 9px rgba(0,0,0,0.5)); }
  #pdNib { filter: drop-shadow(0 0 7px rgba(255,255,255,0.95)) drop-shadow(0 0 14px ${BLUE}cc); }
  #pdFlash { position:absolute; left:${chipX}px; top:${chipY + 30}px; width:480px; height:200px;
             margin-left:-240px; margin-top:-100px; border-radius:50%; opacity:0;
             background: radial-gradient(50% 50% at 50% 50%, ${dna.palette.flash || "rgba(190,220,255,0.55)"} 0%, rgba(190,220,255,0) 70%); }
  #pdChip { position:absolute; left:${chipX}px; top:${chipY}px; opacity:0; white-space:pre;
            font-family:'${dna.fonts.tag || "VT323"}', monospace; font-size:${p.chipSize ?? 24}px; letter-spacing:2px;
            color:${dna.palette.chipText || "#cfe6ff"}; padding:3px 12px 4px;
            border:2px solid ${BLUE}; background:${dna.palette.chipBg || "rgba(8,24,52,0.62)"};
            box-shadow: 0 0 14px ${BLUE}59, inset 0 0 10px ${BLUE}1f; }`;
  const html = `      <div id="pdScrim"></div>
      <div id="pdGrid"></div>
      <div id="pdFlash"></div>
      <div id="pdWrap">
        <svg id="pdPlot" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <defs>
            <pattern id="pdHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect x="0" y="0" width="3.4" height="9" fill="${BLUE}"/>
            </pattern>
            <mask id="pdGlyphmask" maskUnits="userSpaceOnUse" x="${maskX}" y="${maskY}" width="${maskW}" height="${maskH}">
              <g id="pdMaskG"></g>
            </mask>
          </defs>
          <path id="pdGuide" fill="none" stroke="${BLUE}33" stroke-width="1" stroke-dasharray="6 5" opacity="0"/>
          <g id="pdReg" stroke="${BLUE}" stroke-width="2" opacity="0.9"></g>
          <g id="pdHatchG" mask="url(#pdGlyphmask)" opacity="0.8">
            <rect id="pdHatchrect" x="${hatchX}" y="${hatchY}" width="0" height="${hatchH}" fill="url(#pdHatch)"/>
          </g>
          <g id="pdCoreG"></g>
          <rect id="pdNib" x="-4.5" y="-4.5" width="9" height="9" fill="${LINE}" opacity="0"/>
        </svg>
      </div>
      <div id="pdChip">${esc(p.chip || "REV A  //  APPROVED")}</div>`;
  const js = `
  // ---- setpiece: PLOTTERDRAW (cyanotype scrim + grid; pen plots the word) ----
  const Ip = ${I.toFixed(3)}, WINp = ${WIN.toFixed(3)}, DRAWNp = ${DRAWN}, ENDTp = ${ENDT};
  const Dp = ${J(D)};

  // scene reaction: cyanotype scrim + drafting grid charge before the plot
  tl.fromTo("#pdScrim", { opacity: 0 }, { opacity: 1, duration: 0.40, ease: "power2.in" }, ${(I - 0.41).toFixed(3)});
  tl.fromTo("#pdGrid", { opacity: 0 }, { opacity: ${p.grid ?? 0.85}, duration: 0.45, ease: "power1.in" }, ${(I - 0.37).toFixed(3)});
  tl.to("#pdScrim", { opacity: 0, duration: 0.30, ease: "power1.in" }, ${Math.min(ENDT - 0.3, DRAWN + 1.44).toFixed(3)});
  tl.to("#pdGrid", { opacity: 0, duration: 0.26, ease: "power1.in" }, ${Math.min(ENDT - 0.3, DRAWN + 1.44).toFixed(3)});

  // registration crosses snap into the sheet corners
  const SVGNSp = "http://www.w3.org/2000/svg";
  const pdReg = document.getElementById("pdReg");
  const pdCorners = [[${shL}, ${shT}], [${shR}, ${shT}], [${shL}, ${shB}], [${shR}, ${shB}]];
  const pdCrosses = pdCorners.map(([cx, cy]) => {
    const pe = document.createElementNS(SVGNSp, "path");
    pe.setAttribute("d", "M " + (cx - 10) + " " + cy + " L " + (cx + 10) + " " + cy +
                         " M " + cx + " " + (cy - 10) + " L " + cx + " " + (cy + 10));
    pe.setAttribute("opacity", "0"); pdReg.appendChild(pe); return pe;
  });
  pdCrosses.forEach((pe, k) => {
    const tt = ${(I - 0.23).toFixed(3)} + k * 0.05;
    tl.set(pe, { opacity: 0.9, transformOrigin: "50% 50%" }, tt);
    tl.fromTo(pe, { scale: 0.4 }, { scale: 1, duration: 0.14, ease: "expo.out" }, tt);
    tl.set(pe, { opacity: 0 }, ${Math.min(ENDT - 0.16, DRAWN + 1.58).toFixed(3)} + k * 0.03);
  });

  // construction guide: faint dashed full path, present before the pen
  document.getElementById("pdGuide").setAttribute("d", Dp);
  tl.fromTo("#pdGuide", { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power1.in" }, ${(I - 0.19).toFixed(3)});
  tl.to("#pdGuide", { opacity: 0, duration: 0.30, ease: "power1.out" }, ${(DRAWN + 0.05).toFixed(3)});

  // sequential plotter strokes (split at pen lifts) + glyph mask copies
  const subsp = Dp.split(/(?=M )/).map(s => s.trim()).filter(Boolean);
  function mkp(parentId, d, stroke, w, cap) {
    const pe = document.createElementNS(SVGNSp, "path");
    pe.setAttribute("d", d); pe.setAttribute("fill", "none");
    pe.setAttribute("stroke", stroke); pe.setAttribute("stroke-width", w);
    pe.setAttribute("stroke-linecap", cap); pe.setAttribute("stroke-linejoin", "round");
    pe.setAttribute("opacity", "0");
    document.getElementById(parentId).appendChild(pe);
    return pe;
  }
  const strokesp = subsp.map((d) => ({
    core: mkp("pdCoreG", d, ${J(LINE)}, ${p.coreWidth ?? 3}, "square"),
    maskP: mkp("pdMaskG", d, "#ffffff", ${p.maskWidth ?? 17}, "round"),
  }));
  strokesp.forEach((s) => { s.maskP.setAttribute("opacity", "1"); });   // mask copies always on
  let totalp = 0;
  strokesp.forEach((s) => { s.len = s.core.getTotalLength(); totalp += s.len; });

  // write: constant pen speed, square nib hops at pen lifts
  const nibp = document.getElementById("pdNib");
  let tp = Ip;
  strokesp.forEach((s) => {
    const d = WINp * s.len / totalp;
    gsap.set(s.core, { strokeDasharray: s.len, strokeDashoffset: s.len });
    tl.set(s.core, { opacity: 1 }, tp);
    tl.fromTo(s.core, { strokeDashoffset: s.len },
              { strokeDashoffset: 0, duration: d, ease: "none" }, tp);
    const n = Math.max(4, Math.round(s.len / 14)), xs = [], ys = [];
    for (let k = 0; k <= n; k++) {
      const pt = s.core.getPointAtLength(s.len * k / n);
      xs.push(pt.x); ys.push(pt.y);
    }
    tl.set(nibp, { x: xs[0], y: ys[0] }, tp);
    tl.to(nibp, { keyframes: { x: xs, y: ys }, duration: d, ease: "none" }, tp);
    tp += d;
  });
  tl.set(nibp, { opacity: 1 }, Ip - 0.01);
  tl.to(nibp, { scale: 2.0, opacity: 0, duration: 0.10, ease: "power2.in",
                transformOrigin: "50% 50%" }, DRAWNp);

  // 45-degree HATCH fill sweeps L->R through the glyph area (masked rect)
  tl.to("#pdHatchrect", { attr: { width: ${hatchW} }, duration: 0.36, ease: "power2.inOut" }, ${(DRAWN + 0.04).toFixed(3)});

  // hold life: breathe on the drawing, shimmer on the hatch (baked sine)
  const pB0 = ${breT}, pB1 = ${(breT + +breDur).toFixed(3)}, pNB = ${breN}, psc = [], phop = [];
  for (let k = 0; k <= pNB; k++) {
    const tt = (k / pNB) * (pB1 - pB0);
    psc.push(1 + 0.013 * Math.sin(2 * Math.PI * 1.1 * tt));
    phop.push(0.78 + 0.07 * Math.sin(2 * Math.PI * 2.3 * tt + 0.8));
  }
  tl.to("#pdWrap", { keyframes: { scale: psc }, duration: pB1 - pB0, ease: "none",
                     transformOrigin: "50% 24%" }, pB0);
  tl.to("#pdHatchG", { keyframes: { opacity: phop }, duration: pB1 - pB0, ease: "none" }, pB0);
${
  CHT + 0.4 <= ENDT
    ? `
  // "${esc(p.chip || "REV A // APPROVED")}" chip stamps at the word's bottom-left corner
  const CHp = ${CHT};
  tl.set("#pdChip", { opacity: 1, scale: 1.7, rotation: -5, transformOrigin: "50% 50%" }, CHp);
  tl.to("#pdChip", { scale: 1, duration: 0.10, ease: "power3.in" }, CHp);
  tl.set("#pdChip", { scaleX: 1.07, scaleY: 0.93 }, CHp + 0.10);
  tl.to("#pdChip", { scaleX: 1, scaleY: 1, duration: 0.35, ease: "elastic.out(1, 0.4)" }, CHp + 0.10 + 2 * F);
  tl.set("#pdFlash", { opacity: 0.55 }, CHp + 0.08);
  tl.to("#pdFlash", { opacity: 0, duration: 0.18, ease: "expo.out" }, CHp + 0.08 + F);
  tl.to("#pdChip", { keyframes: { scale: [1, 1.018, 1, 1.014, 1] }, duration: 0.4, ease: "none" }, ${Math.min(CHT + 0.52, ENDT - 0.32).toFixed(3)});`
    : ""
}

  // exit: hatch retracts, pen un-draws (reverse order, fast), chip lifts
  const pUX = ${Math.min(ENDT - 0.42, DRAWN + 1.32).toFixed(3)};
  tl.to("#pdHatchrect", { attr: { width: 0 }, duration: 0.16, ease: "power2.in" }, pUX);
  const UNWp = 0.26; let up = pUX + 0.06;
  [...strokesp].reverse().forEach((s) => {
    const d = UNWp * s.len / totalp;
    tl.to(s.core, { strokeDashoffset: s.len, duration: d, ease: "none" }, up);
    tl.set(s.core, { opacity: 0 }, up + d);
    up += d;
  });
  tl.to("#pdChip", { y: -16, rotation: -8, opacity: 0, duration: 0.12, ease: "power2.in" }, ${Math.min(ENDT - 0.3, DRAWN + 1.44).toFixed(3)});`;
  return { css, html, js };
}

function setpieceInkbloom() {
  // INKWATER apex: a sumi ink drop falls into still water BEHIND the subject.
  // Scene reaction: paper-white radial washes behind the two text zones — the
  // body rows get a PERSISTENT paper backing from t≈0.15 (the closing lines
  // keep their ground) and the apex zone charges just before the drop — plus
  // a gentle vignette that STILLS the world while the ink blooms. The drop
  // appears above the word point, swells, falls (power2.in, scaleY stretch),
  // squashes on contact (2 frames) and merges into the bloom: 3 stacked
  // blurred irregular ellipses scaling at different rates with counter-
  // rotations + 2 thin concentric ripple rings expanding on the water
  // surface; the hero words RESOLVE out of the blob (opacity snaps, blur
  // 16→0 + scale 1.12→1 carries the bleed) — the first at contact, the
  // following at their own spoken times; through the hold the glyph edges
  // BREATHE (baked blur keyframes), the whole group looms 1.018 and faint
  // ink wisps curl off the word top; exit: RE-DISSOLVE (blur up + spread +
  // fade — the ink disperses back into the water), timed to clear before the
  // next body line needs the reader. Blob / ring / wisp geometry is the
  // demo's, scaled from the measured word rect (kx = halfW/demoHalf,
  // ky = fontPx/132); the rail wash registers on the body row geometry.
  const p = dna.hero.params || {},
    D = heroIn;
  const INK = dna.palette.ink || dna.palette.body;
  const PAP = dna.palette.paper || "#fffaee",
    PAP2 = dna.palette.paper2 || "#fff8e8";
  const WASH = dna.palette.wash || "#fff9ee",
    WAPX = dna.palette.washApex || "#fffaf0";
  const fpx = HG.fontPx,
    halfW = Math.round(HG.halfW || heroDisplay.length * 0.25 * fpx),
    cx = HG.x,
    cy = HG.y;
  const ky = fpx / 132; // demo scale unit (Shippori Mincho 700 @ 132px)
  const demoHalf = (wordPx("pixel size.", dna.fonts.hero, 132, 0.02) || 650) / 2;
  const kx = halfW / demoHalf;
  const SX = (v) => Math.round(v * kx),
    SY = (v) => Math.round(v * ky);
  const C = +(D + (p.fall ?? 0.15)).toFixed(3); // contact with the water surface
  // hero words resolve on their own spoken times (the first at contact)
  const heroWords = heroDisplay.trim().split(/\s+/);
  const RES = heroWords.map((wtx, k) => {
    const tw = tWords[Math.min(hero.idx + k, hero.idx + hero.len - 1)];
    return +Math.max(C + 0.02, k === 0 ? 0 : tw.start).toFixed(3);
  });
  // the bloom re-dissolves before the next body line needs the reader
  const nextL = LINES.find((L) => L.words[0].start > hero.end + 0.05);
  const XOUT = +Math.max(
    C + 0.55,
    Math.min(
      D + (p.maxHold ?? 1.75),
      nextL ? nextL.words[0].start - (p.clearGap ?? 0.24) : DUR - 0.6,
      DUR - 0.6,
    ),
  ).toFixed(3);
  const loomT = +(D + 0.373).toFixed(3),
    loomD = +Math.min(1.3, XOUT - (D + 0.373) - 0.03).toFixed(2);
  const vigOutT = +(XOUT - 0.15).toFixed(3),
    vigOutD = +Math.min(0.6, DUR - 0.05 - (XOUT - 0.15)).toFixed(2);
  // rail wash centers on the body reading rows (middle row)
  const railY = H - ((dna.body && dna.body.bottomPx) ?? 36) - ((dna.body && dna.body.rowGap) ?? 56);
  const wrW = p.washRailW ?? 1180,
    wrH = p.washRailH ?? 300;
  const waW = 2 * halfW + 370,
    waH = p.washApexH ?? 430;
  const blr = (v) => Math.max(8, SY(v));
  const css = `
  #ikvig { position:absolute; inset:0; opacity:0;
           background: radial-gradient(115% 100% at 50% 40%, rgba(0,0,0,0) 42%, rgba(8,6,4,0.55) 100%); }
  #ikwashRail { position:absolute; left:${W / 2}px; top:${railY}px; width:${wrW}px; height:${wrH}px;
                margin-left:-${Math.round(wrW / 2)}px; margin-top:-${Math.round(wrH / 2)}px; opacity:0;
                background: radial-gradient(50% 50% at 50% 50%, ${WASH}7a 0%, ${WASH}3d 48%, ${WASH}00 75%); }
  #ikwashApex { position:absolute; left:${cx}px; top:${cy}px; width:${waW}px; height:${waH}px;
                margin-left:-${Math.round(waW / 2)}px; margin-top:-${Math.round(waH / 2)}px; opacity:0;
                background: radial-gradient(50% 50% at 50% 50%, ${WAPX}4d 0%, ${WAPX}21 50%, ${WAPX}00 76%); }
  #inkG { position:absolute; left:${cx}px; top:${cy}px; opacity:0; }
  #ikdrop { position:absolute; left:${-SY(9)}px; top:${-SY(228)}px; width:${SY(18)}px; height:${SY(18)}px;
            border-radius: 46% 54% 50% 50% / 38% 40% 62% 60%;
            background:${INK}; opacity:0; box-shadow: 0 0 6px ${INK}73; }
  .ikblob { position:absolute; opacity:0; background:${INK}; }
  #ikb1 { left:${SX(-115)}px; top:${SY(-64)}px; width:${SX(230)}px; height:${SY(128)}px;
          border-radius: 47% 53% 44% 56% / 58% 42% 60% 40%; filter: blur(${blr(16)}px); }
  #ikb2 { left:${SX(-205)}px; top:${SY(-44)}px; width:${SX(190)}px; height:${SY(108)}px;
          border-radius: 56% 44% 58% 42% / 44% 60% 40% 56%; filter: blur(${blr(20)}px); }
  #ikb3 { left:${SX(-13)}px; top:${SY(-66)}px; width:${SX(206)}px; height:${SY(96)}px;
          border-radius: 42% 58% 50% 50% / 62% 38% 56% 44%; filter: blur(${blr(24)}px); }
  .ikring { position:absolute; left:${SX(-80)}px; top:${SY(-8)}px; width:${SX(160)}px; height:${SY(44)}px;
            border-radius:50%; opacity:0; }
  #ikr1 { border:2px solid ${INK}cc; filter: blur(1.2px); }
  #ikr2 { border:2px solid ${INK}8c; filter: blur(2.2px); }
  #ikword { position:absolute; left:0; top:0; white-space:nowrap;
            transform: translate(-50%,-50%);
            font-family:'${dna.fonts.hero}', serif; font-weight:700;
            font-size:${fpx}px; line-height:1; letter-spacing:0.02em; color:${INK}; }
  #ikword .ikw { display:inline-block; opacity:0; margin-right:0.30em;
                 text-shadow: 0 0 14px ${PAP}f2, 0 0 36px ${PAP2}b3, 0 2px 4px ${PAP}99; }
  #ikword .ikw:last-child { margin-right:0; }
  .ikwisp { position:absolute; width:${SY(30)}px; height:${SY(38)}px; opacity:0;
            border:4px solid transparent; border-top-color:${INK}80;
            border-radius:50%; filter: blur(2.5px); }
  #ikwisp1 { left:${SX(-210)}px; top:${SY(-118)}px; }
  #ikwisp2 { left:${SX(118)}px; top:${SY(-122)}px; }`;
  const html = `      <div id="ikvig"></div>
      <div id="ikwashRail"></div>
      <div id="ikwashApex"></div>
      <div id="inkG">
        <div class="ikblob" id="ikb2"></div>
        <div class="ikblob" id="ikb3"></div>
        <div class="ikblob" id="ikb1"></div>
        <div class="ikring" id="ikr1"></div>
        <div class="ikring" id="ikr2"></div>
        <div id="ikword">${heroWords.map((t, k) => `<span class="ikw" id="ikw${k}">${esc(t)}</span>`).join("")}</div>
        <div class="ikwisp" id="ikwisp1"></div>
        <div class="ikwisp" id="ikwisp2"></div>
        <div id="ikdrop"></div>
      </div>`;
  const js = `
  // ---- setpiece: INKBLOOM (drop falls → ink blooms → words resolve → re-dissolve) ----
  // paper washes (the scene offers paper to the ink); the rail wash PERSISTS
  tl.fromTo("#ikwashRail", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, 0.15);
  tl.fromTo("#ikwashApex", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${Math.max(0.02, D - 0.077).toFixed(3)});
  tl.to("#ikwashApex", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${XOUT});

  // the world stills while the ink blooms
  tl.to("#ikvig", { opacity: ${p.vig ?? 0.34}, duration: 0.45, ease: "power2.out" }, ${C});
  tl.to("#ikvig", { opacity: 0, duration: ${vigOutD}, ease: "power1.in" }, ${vigOutT});

  // ===== drop: appears, swells, falls, squashes on contact, merges into the blob =====
  tl.set("#inkG", { opacity: 1 }, ${(D - 0.08).toFixed(3)});
  tl.set("#ikdrop", { opacity: 1, transformOrigin: "50% 50%" }, ${(D - 0.08).toFixed(3)});
  tl.fromTo("#ikdrop", { scale: 0.55 }, { scale: 1, duration: 0.08, ease: "power2.out" }, ${(D - 0.08).toFixed(3)});
  tl.to("#ikdrop", { y: ${SY(219)}, duration: ${(C - D).toFixed(3)}, ease: "power2.in" }, ${D.toFixed(3)});
  tl.to("#ikdrop", { scaleY: 1.45, scaleX: 0.8, duration: ${(C - D).toFixed(3)}, ease: "power2.in" }, ${D.toFixed(3)});
  tl.set("#ikdrop", { scaleX: 1.7, scaleY: 0.35 }, ${C});                 // contact squash, 2 frames
  tl.to("#ikdrop", { opacity: 0, duration: 0.07 }, ${(C + 0.083).toFixed(3)});

  // ===== bloom: 3 stacked blurred ellipses, different rates; opacity snaps then decays =====
  const IKB = [["#ikb1", 0.82, 0.50, 3.0, -4,  5, 0,    1.15, 0.18, 1.05],
               ["#ikb2", 0.62, 0.42, 2.4,  7, -7, 0.04, 1.35, 0.22, 1.15],
               ["#ikb3", 0.50, 0.55, 3.8, -9,  8, 0.08, 1.50, 0.30, 1.20]];
  IKB.forEach(([sel, op, s0, s1, r0, r1, dt, gd, ft, fd]) => {
    tl.set(sel, { opacity: op, transformOrigin: "50% 50%" }, ${C} + dt);
    tl.fromTo(sel, { scale: s0, rotation: r0 },
              { scale: s1, rotation: r1, duration: gd, ease: "expo.out" }, ${C} + dt);
    tl.to(sel, { opacity: 0, duration: fd, ease: "power1.in" }, ${C} + ft);
  });

  // ripple rings on the water surface
  tl.set("#ikr1", { opacity: 0.7, transformOrigin: "50% 50%" }, ${(C + 0.02).toFixed(3)});
  tl.fromTo("#ikr1", { scale: 1 }, { scale: 7.2, duration: 1.45, ease: "expo.out" }, ${(C + 0.02).toFixed(3)});
  tl.to("#ikr1", { opacity: 0, duration: 1.25, ease: "power1.in" }, ${(C + 0.22).toFixed(3)});
  tl.set("#ikr2", { opacity: 0.5, transformOrigin: "50% 50%" }, ${(C + 0.16).toFixed(3)});
  tl.fromTo("#ikr2", { scale: 1 }, { scale: 9.6, duration: 1.7, ease: "power2.out" }, ${(C + 0.16).toFixed(3)});
  tl.to("#ikr2", { opacity: 0, duration: 1.4, ease: "power1.in" }, ${(C + 0.4).toFixed(3)});

  // ===== the words resolve out of the blob (opacity snaps, BLUR carries the bleed) =====
  const IKRES = ${J(RES)};
  IKRES.forEach((rt, k) => {
    const el = document.getElementById("ikw" + k);
    const rd = Math.min(0.8, Math.max(0.3, ${XOUT} - rt - 0.25));
    tl.set(el, { opacity: 1, transformOrigin: "50% 60%" }, rt);
    tl.fromTo(el, { scale: 1.12, filter: "blur(16px)" },
              { scale: 1, filter: "blur(0px)", duration: rd, ease: "power2.out" }, rt);
    // hold life: glyph edges breathe (blur 0 → ~0.8 → 0, slow)
    const bt = rt + Math.max(0.82, rd + 0.02), bd = k % 2 ? 0.5 : 0.66;
    if (bt + bd <= ${XOUT} + 0.02) {
      tl.to(el, { keyframes: { filter: ["blur(0px)","blur(0.8px)","blur(0.15px)","blur(0.7px)","blur(0px)"] },
                  duration: bd, ease: "none" }, bt);
    }
  });
${
  loomD >= 0.2
    ? `  // gentle loom on the group through the hold
  tl.to("#inkG", { scale: 1.018, duration: ${loomD}, ease: "power1.inOut", transformOrigin: "50% 50%" }, ${loomT});`
    : ""
}

  // faint ink wisps curl off the word top during the hold
${
  C + 0.573 + 0.6 <= XOUT
    ? `  tl.set("#ikwisp1", { opacity: 0.45, transformOrigin: "50% 50%" }, ${(C + 0.573).toFixed(3)});
  tl.fromTo("#ikwisp1", { y: 0, x: 0, rotation: 14, scaleY: 1 },
            { y: -44, x: 12, rotation: 96, scaleY: 1.6, duration: 0.95, ease: "power1.out" }, ${(C + 0.573).toFixed(3)});
  tl.to("#ikwisp1", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(C + 1.123).toFixed(3)});`
    : ""
}
${
  C + 0.753 + 0.6 <= XOUT
    ? `  tl.set("#ikwisp2", { opacity: 0.4, transformOrigin: "50% 50%" }, ${(C + 0.753).toFixed(3)});
  tl.fromTo("#ikwisp2", { y: 0, x: 0, rotation: -18, scaleY: 1 },
            { y: -40, x: -14, rotation: -98, scaleY: 1.5, duration: 0.9, ease: "power1.out" }, ${(C + 0.753).toFixed(3)});
  tl.to("#ikwisp2", { opacity: 0, duration: 0.38, ease: "power1.in" }, ${(C + 1.273).toFixed(3)});`
    : ""
}

  // exit: re-dissolve — blur up + spread + fade, ink dispersing
  tl.to("#inkG", { scale: 1.15, filter: "blur(11px)", opacity: 0,
                   duration: 0.52, ease: "power1.in" }, ${XOUT});
  tl.set("#inkG", { display: "none" }, ${Math.min(XOUT + 0.6, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceRansomnote() {
  // ---- setpiece: RANSOMNOTE (letter-by-letter cutout slam → collective jolt → ripped off) ----
  // The hero word slams in BEHIND the subject as a ransom note: one cutout
  // chip per letter (4 recipes cycled, seeded ±13% sizes / alternating-sign
  // rotations / misaligned baselines), each slamming in oversized with a
  // flight shadow that POPS tight on contact (power3.in crush → 2-frame
  // squash → elastic settle) at S_i = I + 0.01 + step·i. When the LAST letter
  // lands the whole word takes a collective 1-frame JOLT + a scene pulse
  // (the plate punch anchors here — punchOffset is recomputed from the real
  // letter count so the punch always lands on the jolt). Hold = slow loom
  // keyframes (the crooked grid never straightens). Exit = letters RIPPED
  // off one by one, a 1-frame paper-tear flash under each. Scene reaction =
  // a collage scrim darkens the bright sky for the apex window.
  const p = dna.hero.params || {},
    I = heroIn;
  const STEP = p.step ?? 0.06,
    CRUSH = p.crush ?? 0.09,
    RSTAG = p.ripStag ?? 0.045;
  const BASE = HG.fontPx;
  const kf = BASE / 130; // chip chrome scales with the demo's 130px cut
  const N = [...heroText].filter((c) => c !== " ").length;
  const JOLT = +(I + 0.01 + STEP * (N - 1) + CRUSH).toFixed(3);
  // rip schedule: letters tear off while the closing line speaks (demo:
  // lastWord − 0.19), clamped so the last rip completes on frame and the
  // note holds ≥0.45s after the jolt
  let ripT = Math.min(
    theme.hero.exitAt ?? LASTWORD.start - (p.ripLead ?? 0.19),
    DUR - 0.22 - RSTAG * (N - 1),
  );
  ripT = +Math.max(Math.min(ripT, DUR - 0.22 - RSTAG * (N - 1)), JOLT + 0.45).toFixed(3);
  // the plate punch lands on the collective jolt, whatever the word length
  if (dna.plate && dna.plate.punch) dna.plate.punchOffset = +(JOLT - I).toFixed(3);
  const scrimT = +Math.max(0.02, I - 0.07).toFixed(3);
  const loomT = +(JOLT + 0.1).toFixed(3);
  const loomD = +Math.min(0.95, ripT - 0.08 - loomT).toFixed(2);
  const css = `
  #rscrim { position:absolute; inset:0; opacity:0;
            background: linear-gradient(180deg, rgba(12,8,5,0.66) 0%, rgba(12,8,5,0.48) 38%,
                        rgba(12,8,5,0.22) 62%, rgba(12,8,5,0.05) 100%); }
  #rpulse { position:absolute; inset:0; opacity:0; background:rgba(10,6,3,0.75); }
  #rnote  { position:absolute; left:${HG.x}px; top:${HG.y}px; white-space:nowrap; }
  .aw  { display:inline-block; position:relative; margin:0 3px; }
  .asp { display:inline-block; width:${Math.round(BASE * 0.3)}px; }
  .aflash { position:absolute; inset:-5px; background:${dna.palette.flash || "#fffdf2"}; opacity:0; z-index:0; }
  .awm { display:inline-block; position:relative; z-index:1; opacity:0;
         filter: drop-shadow(0 ${Math.max(4, Math.round(7 * kf))}px 0 rgba(8,6,4,0.55)); }
  .achip { display:inline-block; line-height:1.04; padding:0.05em 0.10em 0.09em; }
${ransomChipCss("0.01em")}`;
  const html = `      <div id="rscrim"></div>
      <div id="rpulse"></div>
      <div id="rnote"></div>`;
  const js = `
  // ---- setpiece: RANSOMNOTE (letter chips slam → collective jolt → ripped off) ----
  const I = ${I.toFixed(3)}, STEP = ${STEP}, CRUSH = ${CRUSH}, RIPT = ${ripT};
  const arnd = mulberry32(${p.seed || 3939});
  ${RANSOM_TEAR}
  const HARDA   = "drop-shadow(0 ${Math.max(4, Math.round(7 * kf))}px 0 rgba(8,6,4,0.55))";
  const FLIGHTA = "drop-shadow(0 ${Math.max(10, Math.round(24 * kf))}px 5px rgba(8,6,4,0.30))";
  const group = document.getElementById("rnote");
  gsap.set(group, { xPercent: -50, yPercent: -50 });

  // scene reacts: collage scrim darkens the bright sky for the apex window
  tl.to("#rscrim", { opacity: ${p.scrim ?? 0.44}, duration: 0.12, ease: "power2.out" }, ${scrimT});

  // ===== letter-by-letter ransom slam: S_k = I + 0.01 + STEP*k, contact = S_k + CRUSH
  const RECSA = ["ca", "cb", "cc", "cd"];
  let k = 0;
  ${J([...heroText])}.forEach((ch) => {
    if (ch === " ") {
      const sp = document.createElement("div"); sp.className = "asp";
      group.appendChild(sp);
      return;
    }
    const aw = document.createElement("div"); aw.className = "aw";
    const fl = document.createElement("div"); fl.className = "aflash";
    fl.style.clipPath = tearPoly(arnd);
    const mv = document.createElement("div"); mv.className = "awm";
    const chip = document.createElement("div"); chip.className = "achip " + RECSA[k % 4];
    chip.style.fontSize = Math.round(${BASE} * (0.85 + arnd() * 0.27)) + "px";
    chip.style.clipPath = tearPoly(arnd);
    chip.textContent = ch;
    mv.appendChild(chip); aw.appendChild(fl); aw.appendChild(mv); group.appendChild(aw);
    // seeded crooked grid (demo grammar): rot sign alternates per letter,
    // baseline shove dy leans the other way, the rip throws with the rot sign
    const sgn = k % 2 ? 1 : -1;
    const rot = sgn * (2 + arnd() * 3);
    const dy = -sgn * (2 + arnd() * 4);
    const rr = sgn * (15 + arnd() * 7);
    const S = I + 0.01 + STEP * k, C = S + CRUSH;
    tl.set(mv, { opacity: 1, scale: 1.5, rotation: rot * 1.8, y: dy - 20, filter: FLIGHTA }, S);
    tl.to(mv,  { scale: 1, rotation: rot, y: dy, duration: 0.085, ease: "power3.in" }, S + 0.005);
    tl.set(mv, { filter: HARDA }, C);                             // shadow pop: snaps tight on contact
    tl.set(mv, { scaleX: 1.07, scaleY: 0.93 }, C + 0.004);        // contact squash, held 2 frames
    tl.to(mv,  { scaleX: 1, scaleY: 1, duration: 0.3, ease: "elastic.out(1, 0.4)" }, C + 0.087);
    // ===== exit: RIPPED off one by one, tear flash 1 frame under each
    const R = RIPT + ${RSTAG} * k;
    tl.set(fl, { opacity: 0.85 }, R);
    tl.set(fl, { opacity: 0 }, R + 0.045);
    tl.to(mv, { rotation: rot + rr, y: dy - 34, opacity: 0,
                duration: 0.16, ease: "power2.in" }, R);
    k++;
  });

  // collective 1-frame jolt when the last letter lands + scene pulse
  tl.set("#rnote", { y: 6 }, ${JOLT});
  tl.to("#rnote",  { y: 0, duration: 0.14, ease: "power3.out" }, ${(JOLT + 0.042).toFixed(3)});
  tl.set("#rpulse", { opacity: ${p.pulse ?? 0.2} }, ${JOLT});
  tl.to("#rpulse",  { opacity: 0, duration: 0.13, ease: "power1.out" }, ${(JOLT + 0.042).toFixed(3)});
${
  loomD >= 0.35
    ? `
  // hold life: the pasted word looms (the crooked grid never straightens)
  tl.to("#rnote", { keyframes: { scale: [1, 1.02, 1.006, 1.018, 1] },
                    duration: ${loomD}, ease: "none" }, ${(JOLT + 0.1).toFixed(3)});`
    : ""
}
  tl.to("#rscrim", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${(ripT + 0.06).toFixed(3)});`;
  return { css, html, js };
}

function setpieceBreakout() {
  // MARKET BREAKOUT apex: the trade IS the editor. A top-weighted sky scrim
  // charges in (the bright sky can't wash the spike out), three resistance
  // level lines arm faintly, then THE BREAKOUT — a green candle spike (core +
  // blurred glow + a hot tip dot) rockets up the full frame height in 0.25s
  // (expo.out) behind the subject; each level flashes bright as the tip punches
  // through it (bottom → top). The apex word rides the spike top: crush transit
  // → contact squash → elastic settle, flash-white cooling to market green,
  // with a blurred underglow that breathes through the hold. A +N% odometer
  // rolls up beside the word (back.out pop, then the value climbs in set-steps).
  // EXIT: the trade flips RED — word + odometer + spike crash DOWN (the tick-out
  // motif at apex amplitude).
  const p = dna.hero.params || {},
    I = heroIn;
  const P = dna.palette;
  const GRN = P.up || P.accent || "#1fd66b",
    RED = P.down || "#ff4d4d",
    INK = P.hero || P.body || "#eafff3",
    GLOW = P.glow || "#8dffc0",
    TAGC = P.tag || "#7be8a8";
  const SLAM = I + (p.slam ?? 0.14); // word contact (postfx punch anchor offset)
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.1, I + (p.hold ?? 1.84));
  const hpx = HG.fontPx,
    halfW = HG.halfW || heroText.length * 0.28 * hpx;
  // spike geometry: top at the word, runs DOWN toward the body band
  const spikeTop = Math.max(60, Math.round(HG.y - hpx * 0.6));
  const spikeH = Math.max(360, Math.round(H - 110 - spikeTop));
  const spikeX = Math.round(HG.x - halfW - 30); // just left of the word block
  // three resistance levels spread between the spike top and ~mid frame
  const lvlY = [
    spikeTop + Math.round(spikeH * 0.23),
    spikeTop + Math.round(spikeH * 0.48),
    spikeTop + Math.round(spikeH * 0.74),
  ];
  const lvlTags = p.levels || ["R3 · 4,580", "R2 · 4,440", "R1 · 4,300"];
  // odometer rolls beside the word on the clearer side of the word rect
  const ctrX = Math.round(HG.x + halfW + 28);
  const ctrY = spikeTop + 26;
  const ROLL = p.roll || [
    "+18%",
    "+86%",
    "+159%",
    "+226%",
    "+285%",
    "+334%",
    "+374%",
    "+405%",
    "+427%",
    "+440%",
    "+447%",
  ];
  const lvlCss = lvlY.map((y, i) => `  #bkl${i} { top:${y}px; }`).join("\n");
  const css = `
  #bkdim { position:absolute; inset:0; opacity:0;
           background: linear-gradient(180deg, rgba(1,12,7,0.88) 0%, rgba(1,12,7,0.62) 34%,
                       rgba(1,12,7,0.28) 62%, rgba(1,12,7,0.05) 100%); }
  .bklvl { position:absolute; left:54px; width:${W - 108}px; height:2px; opacity:0;
           background: linear-gradient(90deg, ${GRN}00 0%, ${GRN}e6 12%, ${GRN}e6 88%, ${GRN}00 100%); }
  .bklvl .tag { position:absolute; right:8px; top:-22px; font-family:'${dna.fonts.tag || "VT323"}', monospace;
                font-size:20px; color:${TAGC}; letter-spacing:1px; }
${lvlCss}
  #bkglow { position:absolute; left:${spikeX - 11}px; top:${spikeTop}px; width:30px; height:${spikeH}px;
            background: linear-gradient(180deg, ${GRN}f2, ${GRN}59);
            filter: blur(11px); opacity:0; transform-origin:50% 100%; }
  #bkspike { position:absolute; left:${spikeX}px; top:${spikeTop}px; width:7px; height:${spikeH}px;
             background: linear-gradient(180deg, #d8ffe9 0%, ${GLOW} 22%, ${GRN} 100%);
             box-shadow: 0 0 10px ${GRN}e6; opacity:0; transform-origin:50% 100%; }
  #bktip { position:absolute; left:${spikeX + 3}px; top:${spikeTop}px; width:16px; height:16px; margin:-8px;
           border-radius:50%; background:#eafff3; opacity:0; box-shadow: 0 0 26px 10px ${GLOW}d9; }
  #bkdet { position:absolute; left:${HG.x}px; top:${HG.y}px; opacity:0; }
  #bkunder { position:absolute; left:0; top:6px; transform:translate(-50%,-50%);
             font-family:'${dna.fonts.hero}', sans-serif; font-size:${hpx}px; line-height:1;
             letter-spacing:0.01em; white-space:nowrap; color:${GRN}; filter: blur(26px); opacity:0; }
  #bkword { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
            font-family:'${dna.fonts.hero}', sans-serif; font-size:${hpx}px; line-height:1;
            letter-spacing:0.01em; white-space:nowrap; color:${INK};
            text-shadow: 0 0 18px ${GRN}8c, 0 4px 18px rgba(0,0,0,0.65); }
  #bkctr { position:absolute; left:${ctrX}px; top:${ctrY}px; opacity:0;
           font-family:'${dna.fonts.body}', sans-serif; font-weight:700; font-size:${Math.round(hpx * 0.39)}px;
           line-height:1; color:${GRN}; letter-spacing:0.01em; white-space:nowrap;
           text-shadow: 0 0 14px ${GRN}80, 0 3px 12px rgba(0,0,0,0.7); }
  #bkctrlab { position:absolute; left:${ctrX + 14}px; top:${ctrY + 56}px; opacity:0;
              font-family:'${dna.fonts.tag || "VT323"}', monospace; font-size:22px; color:${TAGC}; letter-spacing:2px; }`;
  const html = `      <div id="bkdim"></div>
${lvlY.map((y, i) => `      <div class="bklvl" id="bkl${i}"><div class="tag">${esc(lvlTags[i] || "")}</div></div>`).join("\n")}
      <div id="bkglow"></div>
      <div id="bkspike"></div>
      <div id="bktip"></div>
      <div id="bkdet">
        <div id="bkunder">${esc(heroText)}</div>
        <div id="bkword">${esc(heroText)}</div>
      </div>
      <div id="bkctr">+0%</div>
      <div id="bkctrlab">${esc(p.ctrLabel || "SIGNAL GAIN")}</div>`;
  // breathe/loom windows clamped to the hold for any clip length
  const breDur = Math.max(0.6, Math.min(1.5, EX - 0.2 - (SLAM + 0.4)));
  const loomA = SLAM + 0.7,
    loomB = loomA + 0.5;
  const js = `
  // ---- setpiece: BREAKOUT (sky charge → candle spike rockets up → word slams at top → red crash) ----
  const I = ${I.toFixed(3)}, SLAM = ${SLAM.toFixed(3)}, OUT = ${EX.toFixed(3)};

  // CHARGE: sky scrim in, levels arm
  tl.fromTo("#bkdim", { opacity: 0 }, { opacity: ${dna.plate.charge ?? 0.52}, duration: 0.18, ease: "power2.in" }, I - 0.16);
  tl.to("#bkdim", { opacity: ${dna.plate.dim ?? 0.34}, duration: 0.9, ease: "power2.out" }, SLAM + 0.3);
  tl.to("#bkdim", { opacity: 0, duration: 0.32, ease: "power1.in" }, OUT + 0.05);
  tl.set(".bklvl", { opacity: 0.12 }, I - 0.05);
  tl.set(".bklvl .tag", { opacity: 0.85 }, I - 0.05);

  // THE BREAKOUT: candle spikes up full frame height
  tl.set(["#bkspike", "#bkglow"], { opacity: 1 }, I);
  tl.fromTo("#bkspike", { scaleY: 0 }, { scaleY: 1, duration: 0.25, ease: "expo.out" }, I);
  tl.fromTo("#bkglow", { scaleY: 0 }, { scaleY: 1, duration: 0.27, ease: "expo.out" }, I + 0.01);
  tl.set("#bktip", { opacity: 1 }, I + 0.14);
  tl.to("#bktip", { opacity: 0.45, duration: 0.4, ease: "power2.out" }, I + 0.24);
  tl.to("#bkglow", { keyframes: { opacity: [1, 0.7, 0.88, 0.66, 0.8, 0.6] }, duration: 1.5, ease: "none" }, I + 0.3);
  tl.to("#bktip", { keyframes: { opacity: [0.45, 0.7, 0.4, 0.62, 0.35, 0.5] }, duration: 1.5, ease: "none" }, I + 0.7);

  // level lines flash as the tip punches through (bottom → top)
  [["#bkl2", I + 0.03], ["#bkl1", I + 0.07], ["#bkl0", I + 0.12]].forEach(([sel, t]) => {
    tl.set(sel, { opacity: 1, filter: "brightness(1.9)" }, t);
    tl.to(sel, { opacity: 0.2, filter: "brightness(1)", duration: 0.3, ease: "power2.out" }, t + 0.084);
  });

  // WORD RIDES THE SPIKE: crush in, squash, elastic settle
  tl.set("#bkdet", { opacity: 1, scale: 2.7 }, SLAM - 0.10);
  tl.fromTo("#bkword", { filter: "blur(13px) brightness(3)" },
            { filter: "blur(0px) brightness(1.7)", duration: 0.10, ease: "power4.in" }, SLAM - 0.10);
  tl.to("#bkdet", { scale: 1, duration: 0.10, ease: "power4.in" }, SLAM - 0.10);
  tl.set("#bkdet", { scaleX: 1.10, scaleY: 0.88 }, SLAM);
  tl.set("#bkword", { color: "#ffffff" }, SLAM);
  tl.to("#bkdet", { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.38)" }, SLAM + 0.083);
  tl.to("#bkword", { filter: "brightness(1)", duration: 0.45, ease: "power2.out" }, SLAM + 0.05);
  tl.to("#bkword", { color: ${J(GLOW)}, duration: 0.8, ease: "power1.in" }, SLAM + 0.25);
  tl.fromTo("#bkunder", { opacity: 0 }, { opacity: 0.85, duration: 0.2 }, SLAM);
  tl.to("#bkunder", { keyframes: { opacity: [0.85, 0.55, 0.68, 0.48, 0.56, 0.4] }, duration: ${breDur.toFixed(2)}, ease: "none" }, SLAM + 0.4);
  // hold breathe (loom)
  tl.to("#bkdet", { scale: 1.028, duration: 0.5, ease: "power1.inOut" }, ${loomA.toFixed(3)});
  tl.to("#bkdet", { scale: 1.0, duration: 0.45, ease: "power1.inOut" }, ${loomB.toFixed(3)});

  // ODOMETER: +N% rolls up beside the word
  tl.set("#bkctr", { opacity: 1, scale: 1.3, transformOrigin: "0% 50%" }, SLAM + 0.10);
  tl.to("#bkctr", { scale: 1, duration: 0.2, ease: "back.out(2)" }, SLAM + 0.14);
  tl.set("#bkctrlab", { opacity: 0.9 }, SLAM + 0.22);
  const ROLL = ${J(ROLL)};
  ROLL.forEach((v, k) => { tl.set("#bkctr", { textContent: v }, SLAM + 0.12 + k * 0.055); });
  tl.set("#bkctr", { color: "#b9ffd6", textShadow: "0 0 22px ${GLOW}e6, 0 3px 12px rgba(0,0,0,0.7)" }, SLAM + 0.67);
  tl.set("#bkctr", { color: ${J(GRN)}, textShadow: "0 0 14px ${GRN}80, 0 3px 12px rgba(0,0,0,0.7)" }, SLAM + 0.80);

  // EXIT: the trade flips red and crashes (tick-out, apex amplitude)
  tl.set(["#bkword", "#bkctr"], { color: ${J(RED)} }, OUT);
  tl.set("#bkunder", { color: ${J(RED)}, opacity: 0.3 }, OUT);
  tl.set("#bkspike", { background: "linear-gradient(180deg, #ffb3b3 0%, ${RED} 100%)", boxShadow: "0 0 10px ${RED}cc" }, OUT);
  tl.set("#bkglow", { background: "linear-gradient(180deg, ${RED}e6, ${RED}4d)" }, OUT);
  tl.set(["#bkdet", "#bkctr", "#bkctrlab"], { y: 5 }, OUT + 0.042);
  tl.to(["#bkdet", "#bkctr", "#bkctrlab"], { y: 52, opacity: 0, duration: 0.14, ease: "power3.in" }, OUT + 0.09);
  tl.to(["#bkspike", "#bkglow"], { scaleY: 0, duration: 0.18, ease: "power3.in" }, OUT + 0.10);
  tl.set("#bktip", { opacity: 0 }, OUT + 0.05);
  tl.to(".bklvl", { opacity: 0, duration: 0.12 }, OUT + 0.08);
  tl.set(["#bkdet", "#bkctr", "#bkspike", "#bkglow"], { display: "none" }, ${Math.min(EX + 0.35, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceGlassslab() {
  // ---- setpiece: GLASSSLAB (frosted glass assembles behind the subject) ----
  // The hero word lands on a real frosted-glass slab built BEHIND the subject:
  // N vertical glass SHARDS (each a backdrop-filter blur wedge, clip-path cut)
  // fly IN from offset+rotation on a power3.in transit (0.11s) and SNAP into
  // register edge-to-edge, each flashing a white light-catch sheet (.fl) on
  // contact. When the last shard lands the assembled slab takes a contact
  // SQUASH (scaleX up / scaleY down, elastic settle) and the hairline RIM snaps
  // on; the apex word then fades on across 2 frames (the one sanctioned opacity
  // entrance). ONE clean diagonal GLINT sweeps the slab. HOLD: the slab tilts
  // rotateY ±tilt° while the left/right edge lights catch in counter-phase and
  // a slow loom breathe keeps it alive. SCENE REACTION (behind subject): a dusk
  // dim + a top sky scrim (washout guard) charge in before impact, a cool light
  // spill blooms and flickers, all releasing after the hold. EXIT: 3 hairline
  // CRACKS flash, then every shard DROPS with gravity + rotation and the word
  // falls away. Gentle physics: no shake — the apex verb is the assembly + the
  // light moving across the glass.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const N = p.shards ?? 7;
  const sw = HG.slabW,
    sh = HG.slabH;
  const left = Math.round(HG.x - sw / 2),
    top = Math.round(HG.y - sh / 2);
  const radius = p.radius ?? 12;
  const P = dna.palette;
  const accent = P.accent || "#78c8ff"; // cool spill / edge light
  const deep = P.deep || "#05101c"; // scrim / dim base
  const glassHi = P.glassHi || "rgba(255,255,255,0.13)";
  const glassMid = P.glassMid || "rgba(185,215,238,0.08)";
  const glassLo = P.glassLo || "rgba(14,36,58,0.28)";
  const rgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return "120,200,255";
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  };
  const accRgb = rgb(accent),
    deepRgb = rgb(deep);
  // shard clip-paths: N near-vertical wedges spanning the slab edge-to-edge,
  // each slightly sheared so the seams read as cracked glass (seeded skew).
  // compile-time PRNG (the emitted MULBERRY is page-side only): the geometry is
  // BAKED here so the render browser can never reorder it.
  const srnd = ((a) => () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  })(p.seed ?? 20260612);
  const clips = [];
  for (let i = 0; i < N; i++) {
    const x0 = (i / N) * 100,
      x1 = ((i + 1) / N) * 100;
    const sk = (srnd() - 0.5) * 6; // top-vs-bottom horizontal shear (%)
    clips.push(
      `polygon(${(x0 - 1).toFixed(1)}% -2%, ${(x1 + 0.5).toFixed(1)}% -2%, ${(x1 - sk).toFixed(1)}% 102%, ${(x0 - 2 - sk).toFixed(1)}% 102%)`,
    );
  }
  // fly-in offsets (alternating up/down, spreading out from center) + landing
  // shear-drop rotations, all seeded so any shard count tiles cleanly
  const FLY = [],
    DROP = [];
  for (let i = 0; i < N; i++) {
    const side = i - (N - 1) / 2;
    FLY.push({
      x: Math.round(side * 30 + (srnd() - 0.5) * 70),
      y: (i % 2 ? 1 : -1) * (60 + Math.round(srnd() * 110)),
      r: Math.round((srnd() - 0.5) * 26),
    });
    DROP.push({
      y: 360 + (i % 3) * 90,
      r: Math.round((srnd() - 0.5) * 40),
    });
  }
  const ENDT = +(DUR - 0.04).toFixed(3);
  const HOLD = +Math.min(p.hold ?? 1.45, Math.max(0.4, ENDT - 0.55 - (I + 0.24))).toFixed(3);
  const tilt = p.tilt ?? 1.5;
  // crack polylines (slab viewBox sw×sh): a central vertical fork + two
  // branches, scaled from the demo's 790×196 proportions
  const kx = sw / 790,
    ky = sh / 196;
  const cl = (pts) => pts.map(([x, y]) => `${Math.round(x * kx)},${Math.round(y * ky)}`).join(" ");
  const crackPts = [
    cl([
      [386, -4],
      [401, 37],
      [388, 84],
      [405, 126],
      [395, 200],
    ]),
    cl([
      [395, 94],
      [318, 116],
      [207, 137],
      [97, 165],
    ]),
    cl([
      [399, 88],
      [504, 73],
      [627, 53],
      [747, 29],
    ]),
  ];
  const css = `
  #gsDim { position:absolute; inset:0; opacity:0; background:${deep}; }
  #gsSky { position:absolute; inset:0; opacity:0;
           background: linear-gradient(180deg, rgba(${deepRgb},0.55) 0%, rgba(${deepRgb},0.30) 36%, rgba(${deepRgb},0) 62%); }
  #gsSpill { position:absolute; inset:0; opacity:0;
             background: radial-gradient(58% 38% at ${Math.round((HG.x / W) * 100)}% ${Math.round((HG.y / H) * 100)}%, rgba(${accRgb},0.17) 0%, rgba(${accRgb},0) 70%); }
  #gsSlab { position:absolute; left:${left + sw / 2}px; top:${top + sh / 2}px; width:${sw}px; height:${sh}px; }
  .gsShard { position:absolute; inset:0; opacity:0;
             backdrop-filter: blur(${p.blur ?? 14}px) saturate(1.15) brightness(1.02);
             background: linear-gradient(168deg, ${glassHi} 0%, ${glassMid} 45%, ${glassLo} 100%); }
  .gsShard .fl { position:absolute; inset:0; opacity:0;
                 background: linear-gradient(180deg, rgba(255,255,255,0.55), rgba(220,240,255,0.18)); }
${clips.map((c, i) => `  #gss${i} { clip-path: ${c}; }`).join("\n")}
  #gsRim { position:absolute; inset:0; opacity:0; border-radius:${radius}px;
           border:1px solid rgba(255,255,255,0.48);
           box-shadow: 0 0 0 1px rgba(${accRgb},0.20), 0 14px 44px rgba(${deepRgb},0.40),
                       inset 0 1px 0 rgba(255,255,255,0.35); }
  #gsEdgeL, #gsEdgeR { position:absolute; top:6px; bottom:6px; width:3px; opacity:0; border-radius:2px; }
  #gsEdgeL { left:2px;  background: linear-gradient(180deg, rgba(${accRgb},0), rgba(${accRgb},0.85), rgba(${accRgb},0)); }
  #gsEdgeR { right:2px; background: linear-gradient(180deg, rgba(${accRgb},0), rgba(${accRgb},0.85), rgba(${accRgb},0)); }
  #gsGlintMask { position:absolute; inset:0; overflow:hidden; border-radius:${radius}px; }
  #gsGlint { position:absolute; left:0; top:-80px; width:90px; height:${sh + 164}px; opacity:0;
             transform: rotate(20deg);
             background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.50) 46%, rgba(210,240,255,0.65) 52%, rgba(255,255,255,0) 100%); }
  #gsWord { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
            padding-bottom:6px; opacity:0;
            font-family:'${dna.fonts.hero}', sans-serif; font-weight:${p.weight ?? 800}; font-size:${HG.fontPx}px;
            letter-spacing:${p.tracking ?? 0.012}em; color:${P.body || "#f4fbff"}; white-space:nowrap;
            text-shadow: 0 4px 26px rgba(${deepRgb},0.7), 0 1px 2px rgba(${deepRgb},0.5), 0 0 1px rgba(255,255,255,0.7); }
  #gsCracks { position:absolute; inset:0; opacity:0;
              filter: drop-shadow(0 0 3px rgba(${accRgb},0.7)); }
  #gsCracks polyline { fill:none; stroke:rgba(240,252,255,0.92); stroke-width:1.6; }`;
  const html = `      <div id="gsDim"></div>
      <div id="gsSky"></div>
      <div id="gsSpill"></div>
      <div id="gsSlab">
${Array.from({ length: N }, (_, i) => `        <div class="gsShard" id="gss${i}"><div class="fl"></div></div>`).join("\n")}
        <div id="gsRim"></div>
        <div id="gsEdgeL"></div><div id="gsEdgeR"></div>
        <div id="gsGlintMask"><div id="gsGlint"></div></div>
        <div id="gsWord">${esc(p.case === "preserve" ? heroDisplay : heroText.toUpperCase())}</div>
        <svg id="gsCracks" viewBox="0 0 ${sw} ${sh}" width="${sw}" height="${sh}">
${crackPts.map((pts) => `          <polyline points="${pts}"/>`).join("\n")}
        </svg>
      </div>`;
  const js = `
  // ---- setpiece: GLASSSLAB (frosted shards assemble, word fades on, tilt-hold, shatter exit) ----
  const I9 = ${I.toFixed(3)}, HOLD = ${HOLD}, ENDT = ${ENDT};
  gsap.set("#gsSlab", { xPercent: -50, yPercent: -50, transformPerspective: 700 });

  // SCENE REACTION (behind subject): charge dim + sky scrim, spill blooms, release
  tl.fromTo("#gsDim", { opacity: 0 }, { opacity: 0.26, duration: 0.22, ease: "power2.in" }, I9 - 0.21);
  tl.fromTo("#gsSky", { opacity: 0 }, { opacity: 1.0, duration: 0.25, ease: "power2.in" }, I9 - 0.23);
  tl.fromTo("#gsSpill", { opacity: 0 }, { opacity: 0.5, duration: 0.30, ease: "power2.out" }, I9 - 0.11);
  tl.to("#gsDim", { opacity: 0.12, duration: 0.6, ease: "power2.out" }, I9 + 0.94);
  if (ENDT - (I9 + 0.29) > 0.3)
    tl.to("#gsSpill", { keyframes: { opacity: [0.5, 0.38, 0.46, 0.34, 0.42] },
                        duration: Math.min(1.5, ENDT - (I9 + 0.29)), ease: "none" }, I9 + 0.29);
  tl.to(["#gsDim","#gsSky","#gsSpill"], { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(I + HOLD + 0.44).toFixed(3)});

  // SHARD ASSEMBLY: transit power3.in, land light-catch flash
  const FLY = ${J(FLY)};
  FLY.forEach((f, i) => {
    const s = "#gss" + i, A = I9 - 0.135 + i * 0.025;
    tl.set(s, { opacity: 1, x: f.x, y: f.y, rotation: f.r }, A);
    tl.to(s, { x: 0, y: 0, rotation: 0, duration: 0.11, ease: "power3.in" }, A);
    tl.set(s + " .fl", { opacity: 0.85 }, A + 0.11);
    tl.to(s + " .fl", { opacity: 0, duration: 0.14, ease: "power2.out" }, A + 0.13);
  });
  // contact squash on the assembled slab (last shard lands)
  const LAND = I9 - 0.135 + (FLY.length - 1) * 0.025 + 0.125;
  tl.set("#gsSlab", { scaleX: 1.035, scaleY: 0.93 }, LAND);
  tl.to("#gsSlab", { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.38)" }, LAND + 0.085);
  tl.fromTo("#gsRim", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power1.out" }, LAND + 0.025);
  // word fades ON the slab — 2 frames (the one sanctioned opacity entrance)
  tl.fromTo("#gsWord", { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, LAND + 0.045);

  // ONE clean diagonal GLINT
  const GT = I9 + 0.47;
  tl.set("#gsGlint", { opacity: 1, x: -180 }, GT);
  tl.to("#gsGlint", { x: ${sw + 290}, duration: 0.40, ease: "power2.inOut" }, GT);
  tl.set("#gsGlint", { opacity: 0 }, GT + 0.42);

  // HOLD: slab tilts rotateY ±${tilt}°, edge lights catch in counter-phase
  const TS = I9 + 0.24;
  tl.to("#gsSlab", { keyframes: { rotationY: [0, -${tilt}, ${(tilt * 0.93).toFixed(2)}, -${(tilt * 0.8).toFixed(2)}, ${(tilt * 0.6).toFixed(2)}, 0] }, duration: HOLD, ease: "none" }, TS);
  tl.fromTo("#gsEdgeL", { opacity: 0 },
            { keyframes: { opacity: [0.15, 0.7, 0.1, 0.55, 0.2, 0.3] }, duration: HOLD, ease: "none" }, TS);
  tl.fromTo("#gsEdgeR", { opacity: 0 },
            { keyframes: { opacity: [0.55, 0.1, 0.6, 0.12, 0.5, 0.3] }, duration: HOLD, ease: "none" }, TS);
  tl.to("#gsRim", { keyframes: { opacity: [1, 0.82, 1, 0.85, 1, 0.94] }, duration: HOLD, ease: "none" }, TS);
  // slow loom breathe (hold life)
  tl.to("#gsSlab", { scale: 1.016, duration: 0.45, ease: "sine.inOut" }, TS + 0.5);
  tl.to("#gsSlab", { scale: 1.0, duration: 0.45, ease: "sine.inOut" }, TS + 0.97);

  // EXIT: cracks flash, then shards drop with gravity + rotation
  const XT = ${(I + HOLD + 0.28).toFixed(3)};
  tl.set("#gsCracks", { opacity: 1 }, XT - 0.06);
  tl.set("#gsCracks", { opacity: 0.45 }, XT - 0.025);
  tl.set("#gsCracks", { opacity: 1 }, XT + 0.01);
  tl.to("#gsCracks", { opacity: 0, duration: 0.10 }, XT + 0.06);
  const DROP = ${J(DROP)};
  DROP.forEach((d, i) => {
    const s = "#gss" + i, T = XT + i * 0.038;
    tl.to(s, { y: d.y, rotation: d.r, duration: 0.34, ease: "power1.in" }, T);
    tl.to(s, { opacity: 0, duration: 0.17, ease: "power2.in" }, T + 0.10);
  });
  tl.to("#gsWord", { y: 330, rotation: -4, duration: 0.40, ease: "power1.in" }, XT + 0.04);
  tl.to("#gsWord", { opacity: 0, duration: 0.16, ease: "power2.in" }, XT + 0.10);
  tl.to(["#gsRim","#gsEdgeL","#gsEdgeR"], { opacity: 0, duration: 0.12, ease: "power1.in" }, XT + 0.02);
  tl.set("#gsSlab", { display: "none" }, Math.min(XT + 0.5, ENDT));`;
  return { css, html, js };
}

function setpieceStarfield() {
  // STARFIELD EMBED climax: night falls on the bright sky (dusk gradient + a dark
  // radial pocket + a reading-rail scrim), then GOLD STARS twinkle in at the
  // letter anchors of the hero word, HAIRLINES connect them in sequence, the
  // word itself condenses in WITHIN the linework (blur + letter-spacing collapse),
  // the lines relax to ledger weight and waver, and a designation (e.g.
  // STELLA·LIMITIS) types beneath. All BEHIND the subject (partial occlusion
  // wanted). Exit is asymmetric: lines retract, stars wink one by one, the glyphs
  // fade LAST. Scene reaction lives here (bg layer), not in the plate.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn,
    E = theme.hero.exitAt ?? Math.min(heroOut, DUR - 0.12);
  const GOLD = dna.palette.accent || "#ffd98c",
    CORE = dna.palette.starCore || "#fff8e2",
    WCORE = dna.palette.body || "#f5edda",
    TAGC = dna.palette.tag || GOLD;
  const disp = HG.starDisp || heroDisplay.toLowerCase();
  const hpx = HG.fontPx;
  const halfW = HG.halfW || (disp.length * 0.48 * hpx) / 2;
  const CX = HG.x,
    CY = HG.y;
  const wordTop = Math.round(CY - hpx * 0.5); // baseline-ish top of the word block
  // seeded star anchors spread across the word rect, biased ABOVE the glyphs so
  // they read as a constellation crowning the word (a couple are bright spikes).
  const srnd = (() => {
    let a = p.seed || 4242;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const nStars = p.stars || 5;
  const x0 = CX - halfW,
    span = halfW * 2;
  const STARS = [];
  for (let i = 0; i < nStars; i++) {
    const fx = nStars === 1 ? 0.5 : i / (nStars - 1);
    const sx = Math.round(x0 + fx * span + (srnd() - 0.5) * 30);
    const sy = Math.round(wordTop - 56 + srnd() * 96); // crowning band above/through the word
    const r = 5 + Math.round(srnd() * 3);
    const spike = i % 2 === 1; // alternate bright spikes
    STARS.push({ x: sx, y: sy, r, spike });
  }
  const desig = (p.desig || "STELLA·LIMITIS").toUpperCase();
  const css = `
  #sfdusk { position:absolute; inset:0; opacity:0;
            background:linear-gradient(180deg, rgba(7,11,26,0.66) 0%, rgba(7,11,26,0.38) 36%, rgba(7,11,26,0) 60%); }
  #sfhalo { position:absolute; left:${CX}px; top:${CY + 10}px; width:1060px; height:480px;
            margin-left:-530px; margin-top:-240px; border-radius:50%; opacity:0;
            background:radial-gradient(50% 50% at 50% 50%, rgba(6,9,22,0.68) 0%, rgba(6,9,22,0.34) 46%, rgba(6,9,22,0) 72%); }
  #sfrailscrim { position:absolute; inset:0; opacity:0;
            background:linear-gradient(0deg, rgba(5,8,18,0.60) 0%, rgba(5,8,18,0.36) 17%, rgba(5,8,18,0) 38%); }
  #sfSvg { position:absolute; left:0; top:0; }
  .sfst  { position:absolute; opacity:0; }
  .sfstc { border-radius:50%; background:${CORE};
           box-shadow:0 0 10px 2px ${GOLD}f2, 0 0 32px 9px ${GOLD}61; }
  .sfspk { position:absolute; background:linear-gradient(90deg, ${GOLD}00 0%, ${GOLD}d9 50%, ${GOLD}00 100%); opacity:0; }
  #sfword { position:absolute; left:${CX}px; top:${wordTop}px; white-space:nowrap;
            font-family:'${dna.fonts.hero}', serif; font-style:italic; font-weight:700;
            font-size:${hpx}px; line-height:1; }
  #sfwglow { position:absolute; inset:0; color:${GOLD}; filter:blur(10px); opacity:0; }
  #sfwcore { position:relative; color:${WCORE}; opacity:0;
             text-shadow:0 3px 24px rgba(8,12,26,0.85), 0 0 30px ${GOLD}59; }
  #sfdesig { position:absolute; left:${Math.round(CX - halfW - 30)}px; top:${wordTop + Math.round(hpx * 0.53)}px;
             font-family:'${dna.fonts.tag}', monospace; font-size:21px; letter-spacing:3px; color:${TAGC}; }
  #sfdesig span { opacity:0; }`;
  const html = `      <div id="sfdusk"></div>
      <div id="sfhalo"></div>
      <div id="sfrailscrim"></div>
      <svg id="sfSvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <g id="sfLines" stroke="${WCORE}d9" stroke-width="1.3" stroke-linecap="round"></g>
      </svg>
      <div id="sfStars"></div>
      <div id="sfword"><div id="sfwInner"><div id="sfwglow">${esc(disp)}</div><div id="sfwcore">${esc(disp)}</div></div></div>
      <div id="sfdesig"></div>`;
  const js = `
  // ---- setpiece: STARFIELD (stars at letter anchors → connect → word condenses) ----
  const srnd = mulberry32(${p.seed || 4242});
  const SVGNS = "http://www.w3.org/2000/svg";
  const I = ${I.toFixed(3)}, E = ${E.toFixed(3)};
  const NZ_SF = ${Math.min(+LASTWORD.start.toFixed(3), E - 0.42).toFixed(3)};
  const STARS = ${J(STARS.map((s) => ({ x: s.x, y: s.y, r: s.r, spike: s.spike })))};

  // scene reaction: night falls on the bright sky
  tl.fromTo("#sfrailscrim", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, Math.max(0.1, I - 0.96));
  tl.fromTo("#sfdusk",      { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" }, Math.max(0.1, I - 0.80));
  tl.fromTo("#sfhalo",      { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, Math.max(0.1, I - 0.76));
  tl.to("#sfdusk",      { opacity: 0.4,  duration: 0.22, ease: "power1.in" }, ${(E - 0.24).toFixed(3)});
  tl.to("#sfhalo",      { opacity: 0.45, duration: 0.22, ease: "power1.in" }, ${(E - 0.24).toFixed(3)});
  tl.to("#sfrailscrim", { opacity: 0.3,  duration: 0.16, ease: "power1.in" }, ${(E - 0.18).toFixed(3)});

  // stars twinkle in at the letter anchors
  const sfStars = document.getElementById("sfStars");
  STARS.forEach((s, i) => {
    const wrap = document.createElement("div"); wrap.className = "sfst"; sfStars.appendChild(wrap);
    const core = document.createElement("div"); core.className = "sfstc";
    core.style.width = s.r * 2 + "px"; core.style.height = s.r * 2 + "px"; wrap.appendChild(core);
    gsap.set(wrap, { left: s.x, top: s.y, xPercent: -50, yPercent: -50 });
    if (s.spike) {
      const hh = document.createElement("div"); hh.className = "sfspk";
      hh.style.width = "92px"; hh.style.height = "1px"; wrap.appendChild(hh);
      const vv = document.createElement("div"); vv.className = "sfspk";
      vv.style.width = "1px"; vv.style.height = "64px";
      vv.style.background = "linear-gradient(180deg, ${GOLD}00 0%, ${GOLD}d9 50%, ${GOLD}00 100%)";
      wrap.appendChild(vv);
      [hh, vv].forEach((el) => gsap.set(el, { left: "50%", top: "50%", xPercent: -50, yPercent: -50 }));
      tl.fromTo([hh, vv], { opacity: 0 }, { opacity: 0.55, duration: 0.083, ease: "none" }, I + 0.06);
      tl.fromTo(hh, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "power2.out" }, I + 0.06);
      tl.fromTo(vv, { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power2.out" }, I + 0.06);
    }
    const entry = Math.max(0.1, I - 0.76) + i * 0.07;
    tl.fromTo(wrap, { opacity: 0 },  { opacity: 1, duration: 0.06, ease: "none" }, entry);
    tl.fromTo(wrap, { scale: 0.2 },  { scale: 1, duration: 0.3, ease: "back.out(2.8)" }, entry);
    // baked twinkle (hold life) — ends before the wink-out
    const tw0 = entry + 0.55, D = Math.max(0.5, (E - 0.34) - tw0);
    const N = Math.max(8, Math.round(D / (2 * F))), vals = [];
    const f1 = 1.1 + srnd() * 1.3, ph1 = srnd() * 6.283, f2 = 2.3 + srnd() * 1.7, ph2 = srnd() * 6.283;
    for (let k = 0; k <= N; k++) {
      const t = k / N * D;
      vals.push(Math.min(1, 0.87 + 0.10 * Math.sin(6.283 * f1 * t + ph1) + 0.06 * Math.sin(6.283 * f2 * t + ph2)));
    }
    tl.to(wrap, { keyframes: { opacity: vals }, duration: D, ease: "none" }, tw0);
    // wink out one by one
    const Wt = ${(E - 0.28).toFixed(3)} + i * 0.05;
    tl.to(wrap, { opacity: 0, duration: 0.07, ease: "power1.in" }, Wt);
    tl.to(wrap, { scale: 1.7, duration: 0.09, ease: "power2.in" }, Wt - 0.01);
  });

  // hairlines connect in sequence
  const sfLg = document.getElementById("sfLines");
  const sfSegs = [];
  for (let k = 0; k < STARS.length - 1; k++) {
    const a = STARS[k], b2 = STARS[k + 1];
    const ln = document.createElementNS(SVGNS, "line");
    ln.setAttribute("x1", a.x); ln.setAttribute("y1", a.y);
    ln.setAttribute("x2", b2.x); ln.setAttribute("y2", b2.y);
    ln.setAttribute("pathLength", "100");
    ln.setAttribute("stroke-dasharray", "100");
    ln.setAttribute("stroke-dashoffset", "100");
    sfLg.appendChild(ln); sfSegs.push(ln);
    tl.to(ln, { attr: { "stroke-dashoffset": 0 }, duration: 0.125, ease: "none" }, Math.max(0.1, I - 0.40) + k * 0.125);
  }
  tl.to("#sfLines", { opacity: 0.3, duration: 0.5, ease: "power1.out" }, I + 0.54);
  const sfWv = [], sfWN = Math.max(8, Math.round((${(E - 0.5).toFixed(3)} - (I + 1.24)) / (2 * F)));
  if (sfWN > 4) {
    for (let k = 0; k <= sfWN; k++) { const t = k / sfWN * (${(E - 0.5).toFixed(3)} - (I + 1.24)); sfWv.push(0.30 + 0.035 * Math.sin(6.283 * 0.55 * t) + 0.02 * Math.sin(6.283 * 1.7 * t + 2.1)); }
    tl.to("#sfLines", { keyframes: { opacity: sfWv }, duration: ${(E - 0.5).toFixed(3)} - (I + 1.24), ease: "none" }, I + 1.24);
  }
  tl.set("#sfLines", { x: 2,  opacity: 0.55 }, NZ_SF);
  tl.set("#sfLines", { x: -1, opacity: 0.38 }, NZ_SF + F);
  tl.set("#sfLines", { x: 0,  opacity: 0.30 }, NZ_SF + 2 * F);
  sfSegs.forEach((ln, k) => {
    tl.to(ln, { attr: { "stroke-dashoffset": 100 }, duration: 0.16, ease: "power2.in" }, ${(E - 0.42).toFixed(3)} + (sfSegs.length - 1 - k) * 0.045);
  });

  // the word condenses in WITHIN the linework
  gsap.set("#sfword", { xPercent: -50, yPercent: 0, transformOrigin: "50% 50%" });
  tl.fromTo("#sfwInner", { filter: "blur(8px)", letterSpacing: "0.10em" },
            { filter: "blur(0px)", letterSpacing: "0.05em", duration: 0.5, ease: "power2.out" }, I);
  tl.fromTo("#sfwcore", { opacity: 0 }, { opacity: 1,   duration: 0.30, ease: "power1.inOut" }, I + 0.02);
  tl.fromTo("#sfwglow", { opacity: 0 }, { opacity: 0.5, duration: 0.35, ease: "power1.inOut" }, I + 0.02);
  // hold life: breathe
  tl.to("#sfword", { scale: 1.016, duration: 1.28, ease: "sine.inOut", yoyo: true, repeat: 2 }, I + 0.64);
  tl.to("#sfwglow", { opacity: 0.75, duration: 1.28, ease: "sine.inOut", yoyo: true, repeat: 2 }, I + 0.64);
  // exit: glyphs fade LAST
  tl.to("#sfword", { y: -8, duration: 0.2, ease: "power1.in" }, ${(E - 0.02).toFixed(3)});
  tl.to(["#sfwcore", "#sfwglow"], { opacity: 0, duration: 0.2, ease: "power1.in" }, ${(E - 0.02).toFixed(3)});
  tl.to("#sfwInner", { filter: "blur(6px)", duration: 0.2, ease: "power1.in" }, ${(E - 0.02).toFixed(3)});

  // designation types beneath
  const sfDesig = document.getElementById("sfdesig");
  [...${J(desig)}].forEach((ch, j) => {
    const s = document.createElement("span"); s.textContent = ch; sfDesig.appendChild(s);
    tl.set(s, { opacity: 0.9 }, I + 0.52 + j * 0.04);
  });
  tl.set("#sfdesig", { opacity: 0.45 }, ${(E - 0.3).toFixed(3)});
  tl.set("#sfdesig", { opacity: 0 },    ${(E - 0.3).toFixed(3)} + F);`;
  return { css, html, js };
}

function setpieceMasthead() {
  // ---- setpiece: MASTHEAD (the live magazine-cover takeover) ----
  // The hero word sets as a serif masthead ACROSS THE TOP of frame behind the
  // subject's head (classic cover occlusion). The room becomes paper: a top
  // scrim + a luminous band ease in with a lipstick-red accent bar at the frame
  // edge; the masthead INK-SETTLES up (opacity snaps in 2f, blur+y carry the
  // rise — the theme verb at full amplitude); a kicker, a hairline rule and an
  // issue date stagger in around it. Then the cover breathes (print never
  // freezes). It holds as set dressing — no tear-out (a cover is permanent).
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const P = dna.palette;
  const ink = P.ink || P.body || "#1c1a18";
  const paperRGB = p.paperRGB || "244,238,228";
  const accent = P.accent || "#c8473f";
  const accent2 = p.accentHold || accent;
  const fpx = HG.fontPx;
  const mastY = HG.y;
  const mastX = HG.x;
  const kicker = (p.kicker || theme.kicker || "THE FEATURE ISSUE").toUpperCase();
  const date = (p.date || theme.issueDate || "ISSUE 01").toUpperCase();
  const scrimMax = p.scrim ?? 0.7;
  const ruleW = Math.min(p.ruleWidth || 1080, W - 200);
  const ruleLeft = Math.round((W - ruleW) / 2);
  const dateX = Math.min(W - 100, ruleLeft + ruleW);
  const bandTop = Math.round(mastY - fpx * 0.62);
  const bandH = Math.round(fpx * 1.3);
  // hold to clip end (a printed cover stays); optional explicit fade exit
  const E = theme.hero.exitAt ?? null;
  const breatheT1 = +(I + 0.16).toFixed(3);
  const css = `
  #mscrim { position:absolute; left:0; top:0; width:${W}px; height:${Math.round(H * 0.51)}px; opacity:0;
            background: linear-gradient(180deg, rgba(${paperRGB},0.92) 0%,
                        rgba(${paperRGB},0.40) 55%, rgba(${paperRGB},0) 100%); }
  #mband { position:absolute; left:0; top:${bandTop}px; width:${W}px; height:${bandH}px; opacity:0;
           background: linear-gradient(180deg, rgba(${paperRGB},0) 0%,
                       rgba(${paperRGB},0.78) 24%, rgba(${paperRGB},0.78) 76%,
                       rgba(${paperRGB},0) 100%); }
  #mredbar { position:absolute; left:0; top:0; width:${p.barWidth || 8}px; height:${H}px;
             background:${accent2}; opacity:0; }
  #mkicker { position:absolute; left:${mastX}px; top:${Math.max(18, bandTop - 28)}px; white-space:nowrap;
             font-family:'${dna.fonts.tag || "Space Grotesk"}', sans-serif; font-weight:400; font-size:22px;
             letter-spacing:7px; color:${ink}; opacity:0;
             text-shadow: 0 0 14px rgba(255,250,240,0.35); }
  #mrule { position:absolute; left:${ruleLeft}px; top:${Math.max(40, bandTop - 4)}px; width:${ruleW}px; height:2px;
           background: ${P.rule || "rgba(28,26,24,0.85)"}; opacity:0; }
  #mdate { position:absolute; left:${dateX}px; top:${Math.max(50, bandTop + 6)}px; white-space:nowrap;
           font-family:'${dna.fonts.tag || "Space Grotesk"}', sans-serif; font-weight:400; font-size:15px;
           letter-spacing:3px; color:${ink}; opacity:0;
           text-shadow: 0 0 10px rgba(255,250,240,0.3); }
  #masthead { position:absolute; left:${mastX}px; top:${mastY}px; white-space:nowrap;
              font-family:'${dna.fonts.hero}', serif; font-weight:${p.heroWeight || 700}; font-size:${fpx}px;
              line-height:1; letter-spacing:0.045em; color:${ink}; opacity:0;
              text-shadow: 0 0 26px rgba(255,250,240,0.30), 0 1px 0 rgba(255,255,255,0.10); }`;
  const html = `      <div id="mscrim"></div>
      <div id="mband"></div>
      <div id="mredbar"></div>
      <div id="mkicker">${esc(kicker)}</div>
      <div id="mrule"></div>
      <div id="mdate">${esc(date)}</div>
      <div id="masthead">${esc(heroDisplay.toUpperCase())}</div>`;
  const js = `
  // ---- setpiece: MASTHEAD (cover takeover behind the subject) ----
  const T = ${I.toFixed(3)};
  gsap.set("#mkicker",  { xPercent: -50 });
  gsap.set("#masthead", { xPercent: -50, yPercent: -50 });
  gsap.set("#mdate",    { xPercent: -100 });
  gsap.set("#mrule",    { transformOrigin: "0% 50%" });
  gsap.set("#mredbar",  { transformOrigin: "50% 0%", scaleY: 0 });
  // charge: the room becomes paper (scrim + red bar lead the masthead)
  tl.fromTo("#mscrim", { opacity: 0 }, { opacity: ${scrimMax}, duration: 0.30, ease: "power2.inOut" }, T - 0.21);
  tl.fromTo("#mband",  { opacity: 0 }, { opacity: 1.0, duration: 0.34, ease: "power2.inOut" }, T - 0.12);
  tl.set("#mredbar", { opacity: 1 }, T - 0.16);
  tl.to("#mredbar", { scaleY: 1, duration: 0.50, ease: "power3.out" }, T - 0.16);
  // masthead: ink-settle rise (opacity snaps in 2f; blur+y carry the motion)
  tl.fromTo("#masthead", { opacity: 0 }, { opacity: 1, duration: 0.07, ease: "none" }, T);
  tl.fromTo("#masthead", { y: 22, filter: "blur(7px)" },
            { y: 0, filter: "blur(0px)", duration: 0.55, ease: "power3.out" }, T);
  // kicker / rule / date stagger in around it
  tl.fromTo("#mkicker", { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, T - 0.07);
  tl.fromTo("#mkicker", { y: 6, filter: "blur(2px)" },
            { y: 0, filter: "blur(0px)", duration: 0.30, ease: "power2.out" }, T - 0.07);
  tl.set("#mrule", { opacity: 1 }, T - 0.03);
  tl.fromTo("#mrule", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, T - 0.03);
  tl.fromTo("#mdate", { opacity: 0 }, { opacity: 1, duration: 0.083, ease: "none" }, T + 0.09);
  tl.fromTo("#mdate", { y: 5, filter: "blur(2px)" },
            { y: 0, filter: "blur(0px)", duration: 0.28, ease: "power2.out" }, T + 0.09);
  // hold life: the cover breathes (print never freezes)
  tl.to("#masthead", { scale: 1.013, duration: 1.10, ease: "sine.inOut" }, ${breatheT1});
  tl.to("#masthead", { scale: 1.0,   duration: 1.05, ease: "sine.inOut" }, ${(breatheT1 + 1.1).toFixed(3)});
  tl.to("#masthead", { scale: 1.010, duration: 0.95, ease: "sine.inOut" }, ${(breatheT1 + 2.15).toFixed(3)});
${
  breatheT1 + 0.69 < DUR - 0.4
    ? `  tl.to("#mredbar", { opacity: 0.82, duration: 0.90, ease: "sine.inOut" }, ${(I + 0.69).toFixed(3)});
  tl.to("#mredbar", { opacity: 1.0,  duration: 0.70, ease: "sine.inOut" }, ${Math.min(I + 1.59, DUR - 0.3).toFixed(3)});
  tl.to("#mscrim",  { opacity: ${(scrimMax * 0.88).toFixed(2)}, duration: 1.00, ease: "sine.inOut" }, ${(I + 0.84).toFixed(3)});
  tl.to("#mscrim",  { opacity: ${scrimMax}, duration: 0.45, ease: "sine.inOut" }, ${Math.min(I + 1.84, DUR - 0.2).toFixed(3)});`
    : ""
}
${
  E != null
    ? `  // optional fade exit (a cover normally stays; only when explicitly authored)
  tl.to(["#masthead","#mkicker","#mdate","#mrule"], { opacity: 0, y: -8, duration: 0.3, ease: "power2.in" }, ${(+E).toFixed(3)});
  tl.to(["#mscrim","#mband","#mredbar"], { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(+E).toFixed(3)});`
    : ""
}`;
  return { css, html, js };
}

function setpieceMagnetapex() {
  // MAGNETAPEX: the spoken apex word assembles BEHIND the subject as a row of
  // individual letter-MAGNETS (one cream rounded-rect chip per letter, Anton).
  // The room reacts first — a cool fridge-shadow scrim + an anchored halo dim
  // the bright sky. Then every letter flies in from a seeded FRAME EDGE,
  // decelerates near its slot, and SNAPS the last 12px hard (power4.in) with a
  // 1-frame squash each, in a L->R clack cadence. The crooked word (±2°) then
  // STRAIGHTENS as one rigid unit on the postfx punch, takes a collective jolt,
  // and holds with a slow magnetic breathe. A sympathetic 1px nudge fires when
  // the body's red accent chip slams onto the rail. Exit: the dim lifts and the
  // word releases (a clip is an EVENT, not wallpaper).
  const p = dna.hero.params || {};
  const I = heroIn;
  const DISP = (p.case === "preserve" ? heroDisplay : heroText).toUpperCase();
  const N = DISP.length;
  const cw = HG.chipW,
    ch = HG.chipH,
    sw = HG.slotStep;
  const X0 = Math.round(HG.x - (N * sw - (sw - cw)) / 2); // left edge of slot 0
  const TOP = Math.round(HG.y - ch / 2);
  const fpx = HG.fontPx;
  const stagger = p.clackStagger ?? 0.026;
  const flight = p.flight ?? 0.23;
  const lockEnd = I + (N - 1) * stagger; // last letter locks here
  const straightenT = +(lockEnd + (p.straightenDelay ?? 0.054)).toFixed(3);
  const EX = theme.hero.exitAt ?? Math.min(heroOut - 0.2, I + (p.hold ?? 1.8));
  // red-chip sympathetic nudge: fire at the last body word (the sign-off slam)
  const redT = +(LASTWORD.start + 0.02).toFixed(3);
  const css = `
  #mxscrim { position:absolute; inset:0; opacity:0;
             background: linear-gradient(180deg, ${dna.palette.scrimHi || "rgba(9,14,24,0.58)"} 0%,
                         ${dna.palette.scrimMid || "rgba(9,14,24,0.48)"} 36%,
                         ${dna.palette.scrimLo || "rgba(9,14,24,0.20)"} 60%, rgba(9,14,24,0) 80%); }
  #mxhalo { position:absolute; left:${HG.x}px; top:${HG.y}px; width:1000px; height:330px;
            margin-left:-500px; margin-top:-165px; border-radius:50%; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%, ${dna.palette.haloHi || "rgba(5,9,16,0.50)"} 0%,
                        ${dna.palette.haloLo || "rgba(5,9,16,0.26)"} 55%, rgba(5,9,16,0) 78%); }
  #mxgrp { position:absolute; inset:0; }
  .mxchip { position:absolute; width:${cw}px; height:${ch}px; opacity:0;
            background: linear-gradient(180deg, ${dna.palette.chip || "#fbfaf6"} 0%, ${dna.palette.chipLo || "#eeebe2"} 100%);
            border:1px solid ${dna.palette.chipEdge || "rgba(100,106,118,0.6)"}; border-radius:8px;
            box-shadow: 0 5px 12px rgba(0,0,0,0.40);
            font-family:'${dna.fonts.hero}', sans-serif; font-size:${fpx}px; line-height:${Math.round(ch * 1.02)}px;
            text-align:center; color:${dna.palette.heroInk || dna.palette.body}; }`;
  const html = `      <div id="mxscrim"></div>
      <div id="mxhalo"></div>
      <div id="mxgrp"></div>`;
  const js = `
  // ---- setpiece: MAGNETAPEX (letter-magnets fly from edges -> SNAP -> straighten) ----
  const I = ${I.toFixed(3)}, EXM = ${EX.toFixed(3)};
  const mxrnd = mulberry32(${p.seed || 230611});
  const WORD = ${J(DISP)}, N = ${N}, SW = ${sw}, CW = ${cw}, CH = ${ch}, TOP = ${TOP}, X0 = ${X0};
  const grp = document.getElementById("mxgrp");
  gsap.set(grp, { transformOrigin: "${HG.x}px ${HG.y}px" });
  const chips = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElement("div");
    c.className = "mxchip"; c.textContent = WORD[i];
    c.style.left = (X0 + i * SW) + "px"; c.style.top = TOP + "px";
    grp.appendChild(c); chips.push(c);
  }

  // scene reaction: fridge-shadow dim over the bright sky
  tl.to("#mxscrim", { opacity: 1, duration: 0.26, ease: "power2.out" }, I - 0.23);
  tl.to("#mxhalo",  { opacity: 1, duration: 0.30, ease: "power2.out" }, I - 0.21);
  tl.to("#mxscrim", { opacity: 0.82, duration: 0.6, ease: "power1.inOut" }, I + 0.81);

  // letter snap-assembly: fly from edges -> decelerate -> SNAP last 12px
  chips.forEach((c, i) => {
    const snap = I + i * ${stagger};                 // L->R clack cadence
    const fs = snap - ${flight};                      // flight start
    const slotX = X0 + i * SW + CW / 2, slotY = TOP + CH / 2;
    const e = Math.floor(mxrnd() * 4);                // seeded edge
    let sx, sy;
    if (e === 0)      { sy = -(TOP + CH + 60 + mxrnd() * 120); sx = (mxrnd() - 0.5) * 340; }
    else if (e === 1) { sy = (${H} - TOP) + 60 + mxrnd() * 120; sx = (mxrnd() - 0.5) * 340; }
    else if (e === 2) { sx = -(slotX + 80 + mxrnd() * 140);    sy = (mxrnd() - 0.5) * 260; }
    else              { sx = (${W} - slotX) + 80 + mxrnd() * 140; sy = (mxrnd() - 0.5) * 260; }
    const m = Math.hypot(sx, sy), nx = sx / m * 12, ny = sy / m * 12;  // 12px short
    const rf = (mxrnd() - 0.5) * 36;                                   // flight tilt
    const rl = (mxrnd() < 0.5 ? -1 : 1) * (1.2 + mxrnd() * 1.3);       // crooked land ±2.5°
    const rnear = rl + (rf - rl) * 0.25;

    tl.set(c, { x: sx, y: sy, rotation: rf, opacity: 1,
                boxShadow: "0 16px 30px rgba(0,0,0,0.35)" }, fs);
    tl.to(c, { x: nx, y: ny, rotation: rnear, duration: 0.16, ease: "power2.out" }, fs);
    tl.to(c, { x: 0, y: 0, rotation: rl, duration: 0.05, ease: "power4.in" }, snap - 0.05);
    tl.to(c, { boxShadow: "0 3px 8px rgba(0,0,0,0.45)", duration: 0.08 }, snap - 0.05);
    tl.set(c, { scaleX: 1.12, scaleY: 0.88 }, snap);                   // 1-frame squash
    tl.to(c, { scaleX: 1, scaleY: 1, duration: 0.32, ease: "elastic.out(1, 0.4)" }, snap + 0.084);
  });

  // collective jolt when the last letter locks (rides the postfx punch)
  const LOCK = ${+lockEnd.toFixed(3)};
  tl.set(grp, { y: 3 }, LOCK);
  tl.to(grp, { y: 0, duration: 0.2, ease: "power2.out" }, LOCK + 0.02);
  // the assembled word straightens as one rigid unit
  tl.to(chips, { rotation: 0, duration: 0.4, ease: "power3.inOut" }, ${straightenT});

  // hold life: collective magnetic breathe (1.6%)
  tl.to(grp, { scale: 1.016, duration: 0.38, ease: "sine.inOut", yoyo: true, repeat: 3 }, ${+(straightenT + 0.47).toFixed(3)});

  // sympathetic nudge when the red accent chip slams onto the rail
${
  redT > straightenT + 0.2 && redT < EX - 0.1
    ? `  tl.set(grp, { y: 1.4 }, ${redT});
  tl.to(grp, { y: 0, duration: 0.16, ease: "power1.out" }, ${+(redT + 0.045).toFixed(3)});`
    : ""
}

  // EXIT: the dim lifts and the word releases (a clip is an EVENT)
  tl.to("#mxscrim", { opacity: 0, duration: 0.34, ease: "power1.in" }, EXM);
  tl.to("#mxhalo",  { opacity: 0, duration: 0.34, ease: "power1.in" }, EXM);
  tl.to(grp, { y: 26, opacity: 0, duration: 0.3, ease: "power2.in" }, EXM + 0.02);
  tl.set(grp, { display: "none" }, ${Math.min(EX + 0.36, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpiecePossess() {
  // POSSESS: the room is WRONG for the whole clip — a desaturated teal grade +
  // a ~22% dim + a breathing vignette f(t). At the apex the lights DIP HARD
  // (stutter, then snap to 0.55) and the spoken word MANIFESTS in Creepster
  // BEHIND the subject: crush (scale 2.6→1, power4.in) → contact squash → elastic
  // settle. The shadow casts UPWARD (light-from-below wrongness) and a legacy
  // possess shudder runs 1s (steps(1) set-chain x/skewX with a dual red/cyan
  // textShadow). Hold = a slow loom + a cold underlight breathing + two micro
  // shudder bursts. Exit = exhaled UPWARD with a 1-frame flicker. The body rail
  // lives in the fg layer; this is the cinematic event embedded behind the seance.
  const p = dna.hero.params || {};
  const I = heroIn;
  const C = +(I + (p.crush ?? 0.065)).toFixed(3); // contact frame (postfx punch)
  const DISP = heroText.toUpperCase();
  const fpx = HG.fontPx;
  const trk = p.tracking ?? 0.025;
  const INK = dna.palette.heroInk || dna.palette.body || "#e8e2d4";
  const TEAL = dna.palette.grade || "rgba(28,46,46,0.30)";
  const MIST = dna.palette.mist || "#9fb0aa";
  const UND = dna.palette.under || "rgba(120,150,140,0.55)";
  const RED = dna.palette.haunt || "150,28,28";
  const CYN = dna.palette.cool || "96,170,196";
  const dimBase = p.dim ?? 0.22;
  const dimSnap = p.dimSnap ?? 0.55;
  // upward-cast shadow strings (light wrongness signature)
  const SH_A = `-7px 0 2px rgba(${RED},0.85), 7px 0 2px rgba(${CYN},0.7), 0 -12px 24px rgba(0,0,0,0.7)`;
  const SH_B = `7px 0 2px rgba(${RED},0.85), -7px 0 2px rgba(${CYN},0.7), 0 -12px 24px rgba(0,0,0,0.7)`;
  const SH_F = `0 -4px 2px rgba(122,31,31,0.45), 0 -14px 28px rgba(0,0,0,0.75), 0 0 30px rgba(124,189,176,0.18)`;
  const EX = +(theme.hero.exitAt ?? Math.min(heroOut + (p.hold ?? 1.9), DUR - 0.42)).toFixed(3);
  const css = `
  #teal { position:absolute; inset:0; opacity:0; mix-blend-mode:multiply;
          background:${TEAL}; }
  #dim  { position:absolute; inset:0; opacity:0; background:#04060a; }
  #vig  { position:absolute; inset:0; opacity:0; pointer-events:none;
          background: radial-gradient(120% 95% at 50% 42%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.8) 100%); }
  #under { position:absolute; left:${HG.x}px; top:${Math.round(HG.y + fpx * 0.55)}px; width:${Math.round(HG.wordW * 1.5)}px; height:${Math.round(fpx * 1.2)}px;
           margin-left:-${Math.round(HG.wordW * 0.75)}px; opacity:0; pointer-events:none;
           background: radial-gradient(60% 70% at 50% 100%, ${UND} 0%, rgba(120,150,140,0) 72%); }
  #poss { position:absolute; left:${HG.x}px; top:${HG.y}px; }
  #poss .pp { position:absolute; left:0; top:0; white-space:nowrap;
          font-family:'${dna.fonts.hero}', cursive; font-size:${fpx}px; line-height:1;
          letter-spacing:${trk}em; }
  #pshadow { color:#000; filter:blur(9px); opacity:0.85; }
  #pword   { color:${INK}; }
  #pmist { position:absolute; left:${HG.x}px; top:${Math.round(HG.y - 2)}px; white-space:nowrap;
           font-family:'${dna.fonts.hero}', cursive; font-size:${Math.round(fpx * 1.07)}px; line-height:1;
           letter-spacing:${(trk + 0.005).toFixed(3)}em; color:${MIST}; filter:blur(26px); opacity:0; }`;
  const html = `      <div id="teal"></div>
      <div id="dim"></div>
      <div id="vig"></div>
      <div id="under"></div>
      <div id="pmist">${esc(DISP)}</div>
      <div id="poss">
        <div class="pp" id="pshadow">${esc(DISP)}</div>
        <div class="pp" id="pword">${esc(DISP)}</div>
      </div>`;
  const js = `
  // ---- setpiece: POSSESS (the room is wrong; the word manifests behind) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)}, EXP = ${EX.toFixed(3)};
  const SH_A = ${J(SH_A)}, SH_B = ${J(SH_B)}, SH_F = ${J(SH_F)};
  gsap.set(["#pword", "#pshadow"], { xPercent: -50, yPercent: -50 });
  gsap.set("#pshadow", { y: -12, scaleY: 1.06 });   // shadow cast UPWARD — light wrongness
  gsap.set("#pmist", { xPercent: -50, yPercent: -50 });
  gsap.set("#poss", { transformOrigin: "0px 0px" });

  // ===== the room is wrong: teal grade + ${Math.round(dimBase * 100)}% dim + breathing vignette =====
  tl.set("#teal", { opacity: 1 }, 0);
  tl.set("#dim", { opacity: ${dimBase} }, 0);
  tl.set("#vig", { opacity: 0.38 }, 0);
  tl.to("#vig", { keyframes: { opacity: [0.5, 0.4, 0.54, 0.42, 0.56, 0.46] },
                  duration: ${(DUR - 0.04).toFixed(2)}, ease: "sine.inOut" }, 0.01);

  // ===== anticipation: mist gathers, lights stutter =====
  tl.fromTo("#pmist", { opacity: 0, scale: 0.92 },
            { opacity: 0.26, scale: 1.1, duration: 0.29, ease: "power1.in" }, ${(I - 0.31).toFixed(3)});
  tl.set("#pmist", { opacity: 0 }, ${(I - 0.01).toFixed(3)});
  tl.set("#dim", { opacity: ${(dimBase + 0.18).toFixed(2)} }, ${(I - 0.16).toFixed(3)});
  tl.set("#dim", { opacity: ${dimBase} }, ${(I - 0.118).toFixed(3)});
  tl.set("#dim", { opacity: ${(dimBase + 0.23).toFixed(2)} }, ${(I - 0.07).toFixed(3)});
  tl.set("#dim", { opacity: ${(dimBase + 0.08).toFixed(2)} }, ${(I - 0.04).toFixed(3)});
  tl.set("#dim", { opacity: ${dimSnap} }, ${(I - 0.015).toFixed(3)});   // POSSESSION — lights dip hard

  // ===== manifestation: crush -> contact squash -> elastic settle =====
  tl.set("#poss", { opacity: 1 }, ${(I - 0.04).toFixed(3)});
  tl.fromTo("#poss", { scale: 2.6 }, { scale: 1.0, duration: 0.105, ease: "power4.in" }, ${(I - 0.04).toFixed(3)});
  tl.fromTo("#pword", { filter: "blur(16px) brightness(2.2)" },
            { filter: "blur(1px) brightness(1.4)", duration: 0.105, ease: "power4.in" }, ${(I - 0.04).toFixed(3)});
  tl.set("#poss", { scaleX: 1.12, scaleY: 0.90 }, C);
  tl.set("#pword", { filter: "blur(0px) brightness(1.6)", textShadow: SH_B }, C);
  tl.to("#poss", { scaleX: 1, scaleY: 1, duration: 0.5, ease: "elastic.out(1, 0.38)" }, C + 0.085);
  tl.to("#pword", { filter: "blur(0px) brightness(1)", duration: 0.6, ease: "power2.out" }, C + 0.12);

  // ===== legacy possess shudder: steps(1) set-chain, 1.0s =====
  const PX  = [0, -5, 6, -4, 5, -2, 0];
  const PSK = [0,  9, -10, 7, -5, 3, 0];
  for (let k = 0; k < 7; k++) {
    tl.set("#pword", { x: PX[k], skewX: PSK[k], textShadow: (k % 2 ? SH_A : SH_B) },
           ${(C + 0.005).toFixed(3)} + k * (1.0 / 6));
  }
  tl.set("#pword", { x: 0, skewX: 0, textShadow: SH_F }, ${(C + 1.025).toFixed(3)});

  // ===== hold: loom + cold underlight breathing + micro shudder bursts =====
  tl.set("#under", { opacity: 0.32 }, C + 0.02);
  tl.to("#under", { keyframes: { opacity: [0.2, 0.28, 0.16, 0.24, 0.12] },
                    duration: 1.4, ease: "sine.inOut" }, ${(C + 0.325).toFixed(3)});
  tl.to("#poss", { keyframes: { scale: [1.018, 1.005, 1.032, 1.012] },
                   duration: 1.05, ease: "sine.inOut" }, ${(C + 0.645).toFixed(3)});
  tl.to("#dim", { opacity: ${(dimBase + 0.02).toFixed(2)}, duration: 1.2, ease: "power1.out" }, ${(C + 0.775).toFixed(3)});
${
  EX - C > 1.5
    ? `  tl.set("#pword", { x: 3,  skewX: -4, textShadow: SH_A }, ${(C + 1.205).toFixed(3)});
  tl.set("#pword", { x: 0,  skewX: 0,  textShadow: SH_F }, ${(C + 1.288).toFixed(3)});
  tl.set("#pword", { x: -3, skewX: 3,  textShadow: SH_B }, ${(C + 1.565).toFixed(3)});
  tl.set("#pword", { x: 0,  skewX: 0,  textShadow: SH_F }, ${(C + 1.648).toFixed(3)});`
    : ""
}
  tl.to("#under", { opacity: 0, duration: 0.35, ease: "power1.in" }, ${(EX - 0.084).toFixed(3)});

  // ===== exit: exhaled upward, 1-frame flicker first =====
  tl.set("#poss", { opacity: 0.35 }, ${EX.toFixed(3)});
  tl.set("#poss", { opacity: 1 }, ${(EX + F).toFixed(3)});
  tl.to("#poss", { y: -60, opacity: 0, duration: 0.36, ease: "power2.in" }, ${(EX + 2 * F).toFixed(3)});
  tl.to("#pword", { filter: "blur(10px)", duration: 0.36, ease: "power1.in" }, ${(EX + 2 * F).toFixed(3)});
  tl.set("#poss", { display: "none" }, ${Math.min(EX + 0.4, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceMirrormerge() {
  // MIRRORMERGE: a kaleidoscope-merge climax over a black-mirror floor (BEHIND
  // the subject). 4 rotated low-opacity ghost copies of the hero word converge
  // rotation→0 while fading up, then SNAP into one sharp Bodoni word (2-frame
  // law, micro squash, elastic settle). A grand reflection emerges below
  // (scaleY -1, gradient mask), a cold under-glow blooms and breathes, a
  // vertical light streak crosses on the merge, and a silver floor hairline
  // draws under the word. HOLD: the WORD is perfectly still — only the
  // reflection shimmers (baked skew/blur/opacity f(t)). EXIT: the word sinks
  // INTO its reflection — both travel to the floor line and compress to a sliver.
  // Scene reaction (dusk falls, a dark pocket forms behind the apex, bottom
  // scrim calms the desk) is owned here so the room reacts behind the subject.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const DISP = heroText;
  const fpx = HG.fontPx;
  const halfW = HG.halfW || (DISP.length * 0.56 * fpx) / 2;
  const CX = HG.x,
    CY = HG.y;
  const GLOW = dna.palette.glow || "#86b4e4";
  const WORD = dna.palette.body || "#f3f7fc";
  const MIR = dna.palette.mirror || "#eaf2fa";
  const GHOST = dna.palette.ghost || "#bdd7f1";
  const HALO = dna.palette.halo || "140,180,230";
  const SILV = dna.palette.silver || "195,215,240";
  const SILVH = dna.palette.silverHi || "225,238,252";
  const STRK = dna.palette.streak || "225,238,255";
  const ROTS = p.ghostRot || [-24, -8, 8, 24];
  const OPS = p.ghostOp || [0.13, 0.21, 0.21, 0.13];
  const dimP = dna.plate && dna.plate.dim ? dna.plate.dim : 0;
  // geometry derived from the word rect: floor line sits ~0.27em below the
  // glyph center (so the reflected copy's glyph tops nearly kiss the baseline)
  const lineY = Math.round(CY + fpx * 0.27);
  const lineW = Math.round(Math.min(W * 0.62, halfW * 2 + 120));
  const streakH = Math.round(fpx * 1.9);
  const streakTop = Math.round(CY - streakH * 0.42);
  const streakSpan = Math.round(halfW + 80);
  const css = `
  /* ---- scene reaction ---- */
  #mmdusk { position:absolute; inset:0; opacity:0;
            background:linear-gradient(180deg, rgba(7,13,28,0.62) 0%, rgba(7,13,28,0.34) 34%, rgba(7,13,28,0) 58%); }
  #mmpocket { position:absolute; left:${CX}px; top:${Math.round(CY + 10)}px; width:1120px; height:480px;
              margin-left:-560px; margin-top:-240px; border-radius:50%; opacity:0;
              background:radial-gradient(50% 50% at 50% 50%, rgba(4,8,18,0.74) 0%, rgba(4,8,18,0.38) 48%, rgba(4,8,18,0) 72%); }
  #mmscrim { position:absolute; inset:0; opacity:0;
             background:linear-gradient(0deg, rgba(3,6,12,0.55) 0%, rgba(3,6,12,0.30) 15%, rgba(3,6,12,0) 38%); }
  /* ---- apex setpiece ---- */
  #mmapex { position:absolute; left:${CX}px; top:${CY}px; }
  .mmac { position:absolute; left:0; top:0; white-space:nowrap;
          font-family:'${dna.fonts.hero}', serif; font-weight:${p.weight || 700}; font-size:${fpx}px;
          line-height:1; letter-spacing:${p.tracking != null ? p.tracking + "em" : "0.03em"}; }
  .mmghost { color:${GHOST}; opacity:0; }
  #mmglow { color:${GLOW}; filter:blur(16px); opacity:0; }
  #mmword { color:${WORD}; opacity:0;
            text-shadow:0 3px 18px rgba(5,11,24,0.80), 0 0 34px rgba(${HALO},0.30); }
  #mmmir  { color:${MIR}; opacity:0;
            -webkit-mask-image:linear-gradient(180deg, rgba(0,0,0,0) 6%, rgba(0,0,0,0.95) 70%);
            mask-image:linear-gradient(180deg, rgba(0,0,0,0) 6%, rgba(0,0,0,0.95) 70%); }
  #mmline { position:absolute; left:${CX}px; top:${lineY}px; width:${lineW}px; height:1.5px;
            margin-left:-${Math.round(lineW / 2)}px; opacity:0;
            background:linear-gradient(90deg, rgba(${SILV},0) 0%, rgba(${SILV},0.85) 22%, rgba(${SILVH},0.95) 50%, rgba(${SILV},0.85) 78%, rgba(${SILV},0) 100%); }
  #mmstreak { position:absolute; left:${CX}px; top:${streakTop}px; height:${streakH}px; width:0; }
  .mmsbar { position:absolute; top:0; height:${streakH}px; opacity:0;
            background:linear-gradient(180deg, rgba(${STRK},0) 0%, rgba(${STRK},0.95) 45%, rgba(${STRK},0.95) 60%, rgba(${STRK},0) 100%); }
  #mmsb1 { width:4px;  margin-left:-2px;  filter:blur(1px); }
  #mmsb2 { width:26px; margin-left:-13px; filter:blur(9px); }`;
  const ghosts = ROTS.map(
    (r, i) => `        <div class="mmac mmghost" id="mmg${i}">${esc(DISP)}</div>`,
  ).join("\n");
  const html = `      <div id="mmdusk"></div>
      <div id="mmpocket"></div>
      <div id="mmscrim"></div>
      <div id="mmline"></div>
      <div id="mmapex">
${ghosts}
        <div class="mmac" id="mmglow">${esc(DISP)}</div>
        <div class="mmac" id="mmword">${esc(DISP)}</div>
        <div class="mmac" id="mmmir">${esc(DISP)}</div>
      </div>
      <div id="mmstreak"><div class="mmsbar" id="mmsb1"></div><div class="mmsbar" id="mmsb2"></div></div>`;
  const M = I + (p.mergeDelay ?? 0.45); // the MERGE instant
  const A = M - 0.45; // ghosts begin converging
  const E = theme.hero.exitAt ?? Math.min(heroOut - 0.04, M + (p.hold ?? 1.69));
  const glowEnd = Math.min(DUR - 0.5, E - 0.12);
  const ghostJs = ROTS.map(
    (
      r,
      i,
    ) => `  tl.fromTo("#mmg${i}", { opacity: 0 }, { opacity: ${OPS[i]}, duration: 0.20, ease: "power1.out" }, A);
  tl.fromTo("#mmg${i}", { rotation: ${r} }, { rotation: 0, duration: 0.45, ease: "expo.out" }, A);
  tl.fromTo("#mmg${i}", { filter: "blur(7px)" }, { filter: "blur(2px)", duration: 0.45, ease: "expo.out" }, A);
  tl.set("#mmg${i}", { opacity: 0 }, M);`,
  ).join("\n");
  const js = `
  // ---- setpiece: MIRRORMERGE (ghosts converge -> snap -> reflection -> sink) ----
  const I = ${I.toFixed(3)}, A = ${A.toFixed(3)}, M = ${M.toFixed(3)}, E = ${E.toFixed(3)};
  // ===== scene reaction =====
${dimP ? `  tl.fromTo("#mmscrim", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power1.out" }, 0.10);\n` : ""}  tl.fromTo("#mmdusk",   { opacity: 0 }, { opacity: 1, duration: 0.40, ease: "power1.out" }, ${(M - 0.51).toFixed(3)});
  tl.fromTo("#mmpocket", { opacity: 0 }, { opacity: 1, duration: 0.40, ease: "power1.out" }, ${(M - 0.47).toFixed(3)});
  tl.to(["#mmdusk","#mmpocket"], { opacity: 0, duration: 0.28, ease: "power1.in" }, ${(E + 0.1).toFixed(3)});
${dimP ? `  tl.to("#mmscrim", { opacity: 0.35, duration: 0.18, ease: "power1.in" }, ${(E + 0.24).toFixed(3)});\n` : ""}
  // ===== APEX: kaleidoscope merge =====
  gsap.set(["#mmg0","#mmg1","#mmg2","#mmg3","#mmglow","#mmword"], { xPercent: -50, yPercent: -50 });
  gsap.set("#mmmir", { xPercent: -50, y: 0, scaleY: -1, transformOrigin: "50% 50%" });
  gsap.set("#mmword", { transformOrigin: "50% 78%" });

  // ghosts: 4 rotated low-opacity copies converge rotation->0 while fading up
${ghostJs}

  // MERGE: one sharp word snaps to full opacity (2-frame law), micro squash, settle
  tl.set("#mmword", { opacity: 1, filter: "brightness(2.0)" }, M);
  tl.set("#mmword", { scaleX: 1.035, scaleY: 0.95 }, M);
  tl.to("#mmword",  { filter: "brightness(1)", duration: 0.34, ease: "power2.out" }, M + 0.02);
  tl.to("#mmword",  { scaleX: 1, scaleY: 1, duration: 0.50, ease: "elastic.out(1, 0.42)" }, M + 0.083);

  // cold under-glow blooms with the merge, then breathes (the word itself stays still)
  tl.fromTo("#mmglow", { opacity: 0 }, { opacity: 0.42, duration: 0.12, ease: "none" }, M);
  (() => {
    const t0 = M + 0.34, D = ${glowEnd.toFixed(3)} - t0, N = Math.max(8, Math.round(D / (2 * F))), v = [];
    for (let k = 0; k <= N; k++) { const t = k / N * D; v.push(0.36 + 0.08 * Math.sin(6.283 * 0.42 * t + 0.6)); }
    tl.to("#mmglow", { keyframes: { opacity: v }, duration: D, ease: "none" }, t0);
  })();

  // grand reflection emerges from the floor line
  tl.fromTo("#mmmir", { opacity: 0, y: -14 }, { opacity: 0.34, y: 0, duration: 0.30, ease: "power2.out" }, M + 0.04);

  // vertical light streak crosses on merge
  tl.set(["#mmsb1","#mmsb2"], { x: -${streakSpan} }, M);
  tl.to(["#mmsb1","#mmsb2"], { x: ${streakSpan}, duration: 0.50, ease: "power2.inOut" }, M);
  tl.to(["#mmsb1","#mmsb2"], { keyframes: { opacity: [0, 0.9, 0.7, 0] }, duration: 0.50, ease: "none" }, M);

  // silver floor hairline draws under the word
  tl.fromTo("#mmline", { scaleX: 0, opacity: 0.55 }, { scaleX: 1, duration: 0.40, ease: "expo.out" }, M + 0.05);

  // HOLD: only the reflection lives — slow skew/blur/opacity shimmer f(t)
  (() => {
    const t0 = M + 0.42, D = ${glowEnd.toFixed(3)} - t0;
    if (D < 0.2) return;
    const N = Math.max(10, Math.round(D / (2 * F))), sk = [], bl = [], op = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N * D;
      sk.push(1.7 * Math.sin(6.283 * 0.46 * t + 1.2) + 0.6 * Math.sin(6.283 * 1.13 * t));
      bl.push("blur(" + (2.4 + 1.4 * Math.sin(6.283 * 0.61 * t + 2.8)).toFixed(2) + "px)");
      op.push(0.32 + 0.05 * Math.sin(6.283 * 0.52 * t + 4.1));
    }
    tl.to("#mmmir", { keyframes: { skewX: sk, filter: bl, opacity: op }, duration: D, ease: "none" }, t0);
  })();

  // EXIT: word sinks INTO its reflection — both meet at the floor line and compress
  tl.to("#mmword", { y: 20,  scaleY: 0.05,  duration: 0.30, ease: "power3.in" }, E);
  tl.to("#mmmir",  { y: -10, scaleY: -0.05, duration: 0.30, ease: "power3.in" }, E);
  tl.to("#mmword", { opacity: 0, duration: 0.07, ease: "none" }, E + 0.25);
  tl.to("#mmmir",  { opacity: 0, duration: 0.07, ease: "none" }, E + 0.25);
  tl.to("#mmglow", { opacity: 0, duration: 0.20, ease: "power1.in" }, E);
  tl.to("#mmline", { scaleX: 0, opacity: 0, duration: 0.22, ease: "power2.in" }, E + 0.10);
  tl.set("#mmapex", { display: "none" }, ${Math.min(E + 0.4, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

function setpieceIronbrand() {
  // IRONBRAND: the apex word SLAMS DOWN behind the subject as a white-hot iron
  // stamp (scale crush 3.1→1 in 0.10s, contact squash held 2 frames, elastic
  // settle), then immediately CHARS — white → ember orange → deep char brown
  // over ~0.9s while two stacked charred stroke outlines grow in. A heat
  // under-glow blooms and decays into furnace breathing; a scorch radial darkens
  // the scene around the brand and REMAINS until clip end (the signature). The
  // room charges/dims as the iron approaches; warm ember light spills on contact.
  // Two seeded letters re-glow during the hold. Exit: smoke-out — the word lifts
  // away as smoke, a faint word-shaped char SMUDGE stays branded in the world.
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const C = I + (p.crush ?? 0.07); // contact frame (postfx punch anchors here)
  const WHITE = p.white || "#fff6e8",
    EMBER = p.ember || "#ff8a30",
    CHAR = p.char || "#2b1a10";
  const cx = HG.x,
    cy = HG.y,
    hpx = HG.fontPx;
  const trk = p.tracking ?? 0.03;
  const scorchW = Math.round(HG.halfW * 2 + 256);
  const scorchH = Math.round(hpx * 2.74);
  const css = `
  #scrim { position:absolute; inset:0; opacity:0;
           background: radial-gradient(120% 105% at ${((cx / W) * 100).toFixed(0)}% 40%, rgba(10,4,1,0) 24%, rgba(10,4,1,0.82) 100%); }
  #dimP { position:absolute; inset:0; opacity:0; background:#0a0502; }
  #spill { position:absolute; inset:0; opacity:0;
           background: radial-gradient(60% 48% at ${((cx / W) * 100).toFixed(0)}% ${((cy / H) * 100).toFixed(0)}%, rgba(255,140,50,0.42) 0%, rgba(255,110,40,0.14) 45%, rgba(60,25,5,0) 75%); }
  #scorch { position:absolute; left:${cx}px; top:${cy + 2}px; width:${scorchW}px; height:${scorchH}px; opacity:0;
            margin-left:-${Math.round(scorchW / 2)}px; margin-top:-${Math.round(scorchH / 2)}px;
            background: radial-gradient(50% 50% at 50% 50%, rgba(8,3,1,0.66) 0%, rgba(12,5,2,0.42) 46%, rgba(12,5,2,0) 72%); }
  #det { position:absolute; left:${cx}px; top:${cy}px; opacity:0; }
  #wgroup { position:absolute; left:0; top:0; }
  .ibw { position:absolute; left:0; top:0; transform:translate(-50%,-50%);
         font-family:'${dna.fonts.hero}', serif; font-weight:${p.weight || 700}; font-size:${hpx}px; line-height:1;
         letter-spacing:${trk}em; white-space:nowrap; }
  #heat { color:#ff7a28; filter:blur(26px); opacity:0; }
  #apexword { color:${WHITE};
              text-shadow: 0 0 30px rgba(255,170,80,0.95), 0 0 60px rgba(255,120,40,0.55), 0 2px 6px rgba(0,0,0,0.45); }
  #stroke1 { color:transparent; -webkit-text-stroke:1px #190c05; opacity:0; }
  #stroke2 { color:transparent; -webkit-text-stroke:2px #150a04; opacity:0; }
  #apexchar { position:absolute; left:${cx}px; top:${cy}px; transform:translate(-50%,-50%);
              font-family:'${dna.fonts.hero}', serif; font-weight:${p.weight || 700}; font-size:${hpx}px; line-height:1;
              letter-spacing:${trk}em; white-space:nowrap; color:#170c05; filter:blur(3px); opacity:0; }
  .ibw span { display:inline-block; }`;
  const html = `      <div id="scrim"></div><div id="dimP"></div><div id="spill"></div>
      <div id="scorch"></div>
      <div id="apexchar">${esc(heroText)}</div>
      <div id="det">
        <div id="wgroup">
          <div class="ibw" id="heat">${esc(heroText)}</div>
          <div class="ibw" id="apexword"></div>
          <div class="ibw" id="stroke1">${esc(heroText)}</div>
          <div class="ibw" id="stroke2">${esc(heroText)}</div>
        </div>
      </div>`;
  // two seeded letters re-glow during the hold (ember edge flicker)
  const ibr = (() => {
    let a = p.seed || 34034;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const idxs = [];
  while (idxs.length < 2) {
    const i = Math.floor(ibr() * heroText.length);
    if (heroText[i] !== " " && !idxs.includes(i)) idxs.push(i);
  }
  const reglow = idxs.map((i, k) => [i, +(C + 1.0 + k * 0.34).toFixed(3)]);
  const SC = +(heroOut - 0.18).toFixed(3); // smoke-out exit start
  const js = `
  // ---- setpiece: IRONBRAND (white-hot slam → char → scorch stays → smoke-out) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)};
  const WHITE = ${J(WHITE)}, EMBER = ${J(EMBER)}, CHAR = ${J(CHAR)};
  // per-letter spans (so two seeded letters can re-glow during the hold)
  const wordEl = document.getElementById("apexword");
  ${J(heroText)}.split("").forEach((ch) => {
    const s = document.createElement("span"); s.textContent = ch; wordEl.appendChild(s);
  });
  const letters = wordEl.children;

  // ===== CHARGE: the room darkens as the iron approaches =====
  tl.fromTo("#scrim", { opacity: 0 }, { opacity: ${dna.plate.charge ?? 0.55}, duration: 0.42, ease: "power2.in" }, I - 0.46);
  tl.set("#dimP", { opacity: ${dna.plate.dim ?? 0.34} }, C);
  tl.to("#dimP",  { opacity: ${((dna.plate.dim ?? 0.34) * 0.53).toFixed(3)}, duration: 0.9, ease: "power2.out" }, C + 0.10);
  tl.to("#scrim", { opacity: ${((dna.plate.charge ?? 0.55) * 0.62).toFixed(3)}, duration: 0.9, ease: "power2.out" }, C + 0.10);
  tl.to(["#scrim","#dimP"], { opacity: 0, duration: 0.45, ease: "power1.in" }, ${(DUR - 0.49).toFixed(3)});

  // ===== THE BRAND: white-hot slam =====
  tl.set("#det", { opacity: 1 }, I - 0.03);
  tl.fromTo("#det", { scale: ${p.slamScale || 3.1} }, { scale: 1.0, duration: 0.10, ease: "power4.in" }, I - 0.03);
  tl.fromTo("#wgroup", { filter: "blur(13px)" }, { filter: "blur(0px)", duration: 0.10, ease: "power4.in" }, I - 0.03);
  // contact squash (held 2 frames) -> elastic settle
  tl.set("#det", { scaleX: 1.10, scaleY: 0.91 }, C);
  tl.to("#det",  { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1, 0.38)" }, C + 0.085);

  // ===== CHARRING: white -> ember -> deep char over ~0.9s =====
  tl.set("#apexword", { color: WHITE }, I - 0.03);
  tl.to("#apexword", { color: EMBER, duration: 0.30, ease: "power1.in" }, C + 0.08);
  tl.to("#apexword", { color: CHAR,  duration: 0.52, ease: "power1.in" }, C + 0.40);
  tl.to("#apexword", {
    textShadow: "0 0 11px rgba(255,130,45,0.50), 0 0 26px rgba(255,120,40,0.22), 0 2px 10px rgba(0,0,0,0.6)",
    duration: 0.9, ease: "power1.in" }, C + 0.06);
  // charred outline grows in (1px then 2px layer)
  tl.to("#stroke1", { opacity: 1, duration: 0.35, ease: "power1.in" }, C + 0.18);
  tl.to("#stroke2", { opacity: 1, duration: 0.45, ease: "power1.in" }, C + 0.45);

  // heat under-glow: blooms with the press, decays into furnace breathing
  tl.set("#heat", { opacity: 0.9 }, C);
  tl.to("#heat", { keyframes: { opacity: [0.9, 0.62, 0.72, 0.50, 0.58, 0.42, 0.48, 0.40, 0.46, 0.38] },
                   duration: 1.7, ease: "none" }, C + 0.12);

  // warm light spill — the dusk scene catches the iron's glow for a beat
  tl.set("#spill", { opacity: 0.45 }, C);
  tl.to("#spill",  { opacity: 0, duration: 1.05, ease: "power2.out" }, C + 0.10);

  // scorch radial grows on contact and REMAINS until clip end (signature)
  tl.set("#scorch", { opacity: 0.6, scale: 0.35 }, C - 0.01);
  tl.to("#scorch",  { scale: 1.05, opacity: 0.62, duration: 0.38, ease: "expo.out" }, C);

  // hold loom (visible life, starts after the elastic settle releases scale)
  tl.to("#det", { scale: 1.032, duration: 1.1, ease: "power1.inOut" }, ${(C + 0.72).toFixed(3)});

  // two seeded letters re-glow briefly (ember edge flicker)
  ${J(reglow)}.forEach(([idx, t]) => {
    const L = letters[idx]; if (!L) return;
    tl.set(L, { color: CHAR }, t - 0.01);
    tl.to(L, { color: "#ff9a3c", textShadow: "0 0 16px rgba(255,140,50,0.85)", duration: 0.10, ease: "power2.in" }, t);
    tl.to(L, { color: CHAR, textShadow: "0 0 0px rgba(255,140,50,0)", duration: 0.34, ease: "power1.out" }, t + 0.12);
  });

  // ===== EXIT: smoke-out — the word lifts away as smoke, char mark remains =====
  tl.to("#wgroup", { y: -16, filter: "blur(5px)", duration: 0.30, ease: "power1.in" }, ${SC.toFixed(3)});
  tl.to(["#apexword","#stroke1","#stroke2","#heat"], { opacity: 0, duration: 0.28, ease: "power1.in" }, ${(SC + 0.02).toFixed(3)});
  tl.set("#apexchar", { opacity: 0.14 }, ${(SC + 0.06).toFixed(3)});  // word-shaped smudge stays
  tl.set("#det", { display: "none" }, ${Math.min(SC + 0.35, DUR - 0.02).toFixed(3)});
  // scorch stays to the last frame — the world keeps the burn`;
  return { css, html, js };
}

function setpieceDoppler() {
  // DOPPLER: the apex word arrives like a night-circuit car at speed. It starts
  // as a speck at a left-of-frame vanishing point and ACCELERATES (power4.in)
  // into a full italic slab across the frame in ~0.22s, locks with a contact
  // squash (held 2 frames) → elastic settle. Paint arrives white-hot and cools
  // to bone; a heat-ripple trail (3 blurred accent copies, y oscillating)
  // shimmers behind it during the hold. The room reacts: asphalt dims as the
  // thing approaches, a headlight glow grows at the vanishing point, an accent
  // light wash + tunnel vignette snap on at lock. Exit: whip off right with a
  // motion smear (the body's exit verb at apex amplitude).
  const h = dna.hero,
    p = h.params || {},
    I = heroIn;
  const C = +(I + (p.lock ?? 0.22)).toFixed(3); // contact / lock (postfx punch anchor)
  const HOT = p.hot || "#ff6a2b",
    WARM = p.warm || "#ffd9c4",
    BONE = p.bone || dna.palette.body || "#f6f3ee";
  const cx = HG.x,
    cy = HG.y,
    hpx = HG.fontPx;
  const trk = p.tracking ?? 0.02;
  // vanishing point: left of the word, in the band — the speck launches here
  const vpx = Math.round(Math.max(40, cx - (HG.halfW || 300) - (p.runup ?? 120)));
  const transit = +(C - I).toFixed(3);
  const css = `
  #dim { position:absolute; inset:0; opacity:0; background:#04060a; }
  #tunnel { position:absolute; inset:0; opacity:0;
            background: radial-gradient(115% 100% at ${((cx / W) * 100).toFixed(0)}% ${((cy / H) * 100).toFixed(0)}%, rgba(0,0,0,0) 38%, rgba(2,4,8,0.85) 100%); }
  #wash { position:absolute; inset:0; opacity:0;
          background: radial-gradient(60% 50% at ${((cx / W) * 100).toFixed(0)}% ${((cy / H) * 100).toFixed(0)}%, ${hexA(HOT, 0.55, 1.18)} 0%, ${hexA(HOT, 0.25)} 40%, ${hexA(HOT, 0)} 75%); }
  #vpglow { position:absolute; left:${vpx}px; top:${cy}px; width:120px; height:70px; opacity:0;
            background: radial-gradient(50% 50% at 50% 50%, rgba(255,236,214,0.95) 0%, ${hexA(HOT, 0.55, 1.2)} 40%, ${hexA(HOT, 0)} 75%);
            filter: blur(4px); }
  #apex { position:absolute; left:${cx}px; top:${cy}px; width:0; height:0; opacity:0; }
  #aword { position:absolute; left:0; top:0; white-space:nowrap;
           font-family:'${dna.fonts.hero}', sans-serif; font-style:italic; font-weight:${p.weight || 600};
           font-size:${hpx}px; line-height:1; letter-spacing:${trk}em; color:${BONE};
           text-shadow: 0 0 26px ${hexA(HOT, 0.55)}, 0 4px 22px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.5); }
  #aglow { position:absolute; left:0; top:${Math.round(hpx * 0.053)}px; white-space:nowrap;
           font-family:'${dna.fonts.hero}', sans-serif; font-style:italic; font-weight:${p.weight || 600};
           font-size:${hpx}px; line-height:1; letter-spacing:${trk}em; color:${HOT};
           filter: blur(${Math.round(hpx * 0.173)}px); opacity:0; }
  .dtrail { position:absolute; left:0; top:${Math.round(hpx * 0.027)}px; white-space:nowrap;
            font-family:'${dna.fonts.hero}', sans-serif; font-style:italic; font-weight:${p.weight || 600};
            font-size:${hpx}px; line-height:1; letter-spacing:${trk}em; color:${HOT}; opacity:0; }
  #dtr1 { filter: blur(${Math.round(hpx * 0.033)}px); }
  #dtr2 { filter: blur(${Math.round(hpx * 0.06)}px); }
  #dtr3 { filter: blur(${Math.round(hpx * 0.093)}px); }`;
  const html = `      <div id="dim"></div>
      <div id="tunnel"></div>
      <div id="wash"></div>
      <div id="vpglow"></div>
      <div id="apex">
        <div id="aglow">${esc(heroText)}</div>
        <div class="dtrail" id="dtr3">${esc(heroText)}</div>
        <div class="dtrail" id="dtr2">${esc(heroText)}</div>
        <div class="dtrail" id="dtr1">${esc(heroText)}</div>
        <div id="aword">${esc(heroText)}</div>
      </div>`;
  // transit start x: the word group rides from -runup to 0 as the speck inflates
  const startX = -(p.runup ?? 120) - Math.round((HG.halfW || 300) * 0.4);
  const DIM = dna.plate.dim ?? 0.38;
  const js = `
  // ---- setpiece: DOPPLER (speck at vanishing point → slab transit → lock → cool → whip-off) ----
  const I = ${I.toFixed(3)}, C = ${C.toFixed(3)};
  const HOT = ${J(HOT)}, WARM = ${J(WARM)}, BONE = ${J(BONE)};
  gsap.set("#vpglow", { xPercent:-50, yPercent:-50 });
  gsap.set(["#aword","#aglow"], { xPercent:-50, yPercent:-50 });
  gsap.set("#dtr1", { xPercent:-50, yPercent:-50, x:${Math.round(-hpx * 0.24)} });
  gsap.set("#dtr2", { xPercent:-50, yPercent:-50, x:${Math.round(-hpx * 0.47)} });
  gsap.set("#dtr3", { xPercent:-50, yPercent:-50, x:${Math.round(-hpx * 0.71)} });

  // ===== SCENE CHARGE: asphalt dims as something approaches =====
  tl.fromTo("#dim", { opacity: 0 }, { opacity: ${DIM.toFixed(2)}, duration: 0.42, ease: "power2.in" }, ${(I - 0.21).toFixed(3)});
  tl.to("#dim", { opacity: ${(DIM * 0.58).toFixed(2)}, duration: 0.5, ease: "power2.out" }, ${(C + 0.12).toFixed(3)});
  tl.to("#dim", { opacity: 0, duration: 0.32, ease: "power1.in" }, ${(heroOut - 0.2).toFixed(3)});

  // headlight at the vanishing point grows with the approach
  tl.fromTo("#vpglow", { opacity: 0, scale: 0.3 },
            { opacity: 0.8, scale: 2.4, duration: ${transit.toFixed(3)}, ease: "power3.in" }, I - 0.005);
  tl.to("#vpglow", { opacity: 0, duration: 0.12, ease: "power1.out" }, C + 0.01);

  // ===== DOPPLER TRANSIT: speck → full slab, power4.in =====
  tl.set("#apex", { opacity: 1 }, I - 0.005);
  tl.fromTo("#apex", { x: ${startX}, scale: 0.06 },
            { x: 0, scale: 1.0, duration: ${transit.toFixed(3)}, ease: "power4.in" }, I - 0.005);
  tl.fromTo("#apex", { filter: "blur(8px) brightness(2.6)" },
            { filter: "blur(1px) brightness(2.2)", duration: ${transit.toFixed(3)}, ease: "power4.in" }, I - 0.005);

  // ===== LOCK: contact squash (2 frames) → elastic settle =====
  tl.set("#apex", { scaleX: 1.16, scaleY: 0.88, filter: "blur(0px) brightness(2.3)" }, C + 0.005);
  tl.to("#apex", { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1, 0.36)" }, C + 0.09);
  tl.to("#apex", { filter: "blur(0px) brightness(1)", duration: 0.55, ease: "power2.out" }, C + 0.07);

  // paint cooling: arrives hot, cools to bone-white
  tl.set("#aword", { color: WARM }, C + 0.005);
  tl.to("#aword", { color: BONE, duration: 0.6, ease: "power1.in" }, C + 0.12);
  tl.set("#aword", { textShadow: "0 0 48px ${hexA(HOT, 0.95)}, 0 4px 24px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.5)" }, C + 0.005);
  tl.to("#aword", { textShadow: "0 0 24px ${hexA(HOT, 0.5)}, 0 4px 22px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.5)",
                    duration: 0.8, ease: "power2.out" }, C + 0.25);

  // accent light wash + tunnel vignette on lock
  tl.set("#wash", { opacity: 0.55 }, C + 0.005);
  tl.to("#wash", { opacity: 0, duration: 0.5, ease: "expo.out" }, C + 0.05);
  tl.set("#tunnel", { opacity: 0.5 }, C + 0.005);
  tl.to("#tunnel", { opacity: 0.26, duration: 0.5, ease: "power2.out" }, C + 0.07);
  tl.to("#tunnel", { opacity: 0, duration: 0.32, ease: "power1.in" }, ${(heroOut - 0.2).toFixed(3)});

  // ===== HOLD: heat-ripple trail (3 blurred copies, y oscillating) + glow breathing + loom =====
  tl.set("#dtr1", { opacity: 0.26 }, C + 0.03);
  tl.set("#dtr2", { opacity: 0.16 }, C + 0.05);
  tl.set("#dtr3", { opacity: 0.09 }, C + 0.07);
  tl.to("#dtr1", { keyframes: { y: [0, 4, -3, 3, -2, 0], opacity: [0.26, 0.20, 0.26, 0.18, 0.24, 0.22] },
                  duration: 1.55, ease: "none" }, C + 0.10);
  tl.to("#dtr2", { keyframes: { y: [0, -3, 4, -2, 3, 0], opacity: [0.16, 0.12, 0.17, 0.11, 0.15, 0.13] },
                  duration: 1.55, ease: "none" }, C + 0.12);
  tl.to("#dtr3", { keyframes: { y: [0, 3, -4, 2, -3, 0], opacity: [0.09, 0.06, 0.10, 0.05, 0.08, 0.07] },
                  duration: 1.55, ease: "none" }, C + 0.14);

  tl.fromTo("#aglow", { opacity: 0 }, { opacity: 0.8, duration: 0.12 }, C + 0.01);
  tl.to("#aglow", { keyframes: { opacity: [0.8, 0.45, 0.58, 0.38, 0.5, 0.32] },
                    duration: 1.5, ease: "none" }, C + 0.18);

  // loom: slow forward press during the hold (scale channel free after elastic ends)
  tl.to("#apex", { scale: 1.035, duration: 0.95, ease: "power1.inOut" }, ${(C + 0.69).toFixed(3)});

  // ===== EXIT: whip off right with smear — the body's exit verb at apex amplitude =====
  tl.to("#apex", { x: ${Math.round((HG.halfW || 300) + W * 0.32)}, scaleX: 1.5, opacity: 0, duration: 0.16, ease: "power3.in" }, ${(heroOut - 0.18).toFixed(3)});
  tl.to("#apex", { filter: "blur(10px) brightness(1.2)", duration: 0.16, ease: "power2.in" }, ${(heroOut - 0.18).toFixed(3)});
  tl.set("#apex", { display: "none" }, ${Math.min(heroOut + 0.05, DUR - 0.02).toFixed(3)});`;
  return { css, html, js };
}

const SETPIECES = {
  magnetapex: setpieceMagnetapex,
  masthead: setpieceMasthead,
  detonation: setpieceDetonation,
  decode: setpieceDecode,
  drawon: setpieceDrawon,
  cpslam: setpieceCpslam,
  coverword: setpieceCoverword,
  settle: setpieceSettle,
  flapboard: setpieceFlapboard,
  ledwipe: setpieceLedwipe,
  vhsosd: setpieceVhsosd,
  bossintro: setpieceBossintro,
  rubberstamp: setpieceRubberstamp,
  breakaway: setpieceBreakaway,
  lasercage: setpieceLasercage,
  boltstrike: setpieceBoltstrike,
  holoboot: setpieceHoloboot,
  biobloom: setpieceBiobloom,
  silkribbon: setpieceSilkribbon,
  scopetrace: setpieceScopetrace,
  papermat: setpiecePapermat,
  centerfold: setpieceCenterfold,
  chalkwrite: setpieceChalkwrite,
  spraytag: setpieceSpraytag,
  brushwrite: setpieceBrushwrite,
  plotterdraw: setpiecePlotterdraw,
  inkbloom: setpieceInkbloom,
  ransomnote: setpieceRansomnote,
  breakout: setpieceBreakout,
  scanlock: setpieceScanlock,
  glassslab: setpieceGlassslab,
  starfield: setpieceStarfield,
  possess: setpiecePossess,
  mirrormerge: setpieceMirrormerge,
  ironbrand: setpieceIronbrand,
  doppler: setpieceDoppler,
};

if (!PARADIGMS[dna.body.paradigm])
  throw new Error("[make-theme] unknown body paradigm: " + dna.body.paradigm);
const body = PARADIGMS[dna.body.paradigm]();

let setp = { css: "", html: "", js: "" };
if (!heroInline && !HEROLESS) {
  if (!SETPIECES[dna.hero.setpiece])
    throw new Error("[make-theme] unknown setpiece: " + dna.hero.setpiece);
  setp = SETPIECES[dna.hero.setpiece]();
}
const fx = frontFx();

// bg file: plate reaction + embedded setpiece (+ body if body.layer === "bg")
const bodyInBg = dna.body.layer === "bg";
const poemScrimInBg = dna.body.paradigm === "poem" && dna.body.scrim;
let bgExtra = { css: "", html: "", js: "" };
if (poemScrimInBg) {
  // poem keeps its scrim BEHIND the subject (subject stays lit) while the poem
  // itself rides the fg alpha layer
  const bgScrimSide = typeof CLEARER !== "undefined" && CLEARER === "right" ? "right" : "left";
  bgExtra.css = `
  #pscrimBg { position:absolute; inset:0; opacity:0;
            background: linear-gradient(${bgScrimSide === "left" ? "100deg" : "260deg"},
              rgba(4,8,16,${dna.body.scrim.opacity}) 0%, rgba(4,8,16,${(dna.body.scrim.opacity * 0.6).toFixed(2)}) 38%, rgba(4,8,16,0) 62%); }`;
  bgExtra.html = `      <div id="pscrimBg"></div>`;
  bgExtra.js = `
  tl.fromTo("#pscrimBg", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" }, 0.15);
  tl.to("#pscrimBg", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${(LASTWORD.start + 0.15).toFixed(3)});`;
}

const bgHtml = bgSkeleton(
  [bgExtra.html, setp.html, bodyInBg ? body.html : ""].filter(Boolean).join("\n"),
  [bgExtra.css, setp.css, bodyInBg ? body.css : ""].filter(Boolean).join("\n"),
  [bgExtra.js, setp.js, bodyInBg ? body.js : ""].filter(Boolean).join("\n"),
);
fs.writeFileSync(path.join(PROJECT, "index.html"), bgHtml);

// fg file (rail.html): body paradigm (when fg) + setpiece fg parts + front fx
// (a setpiece may emit fgHtml/fgCss/fgJs — e.g. a verbatim caption chip that
// must ride ABOVE the matte while the setpiece scenery stays embedded behind)
if (!bodyInBg || fx.html || fx.js || setp.fgHtml) {
  const fgHtml = fgSkeleton(
    [!bodyInBg ? body.html : "", setp.fgHtml || "", fx.html].filter(Boolean).join("\n"),
    [!bodyInBg ? body.css : "", setp.fgCss || "", fx.css].filter(Boolean).join("\n"),
    [!bodyInBg ? body.js : "", setp.fgJs || "", fx.js].filter(Boolean).join("\n"),
  );
  fs.writeFileSync(path.join(PROJECT, "rail.html"), fgHtml);
} else if (fs.existsSync(path.join(PROJECT, "rail.html"))) {
  fs.unlinkSync(path.join(PROJECT, "rail.html"));
}

// _postfx.sh: plate reaction after the matte composite (subject+text move as one)
const P = HEROLESS ? {} : dna.plate || {};
// punchOffset: themes whose impact is NOT the hero onset (e.g. flapboard's
// lock-complete clack) shift the plate punch anchor; default keeps onset+2f
const anchorT = (heroIn + (P.punchOffset ?? 0.045)).toFixed(3);
// zoompan resamples EVERY frame it sees (a scale-up→resample→scale-down
// roundtrip — a mild low-pass even at z=1). A `punch` only moves the camera in
// a ~0.5s window, so sending the whole clip through zoompan softened the static
// 95% for nothing. Fix: WINDOWED punch — split the clip, run zoompan ONLY on the
// active window (its softening is hidden by the motion), and pass the rest
// through untouched (no geometric resample → stays as sharp as final.mp4).
// pushIn (continuous whole-clip zoom) is unchanged.
// FILM GRAIN REMOVED 2026-06-17 (user request): the post-composite noise pass is
// gone — text/footage are no longer unified by a shared grain field. Themes whose
// ONLY plate effect was grain now emit no _postfx.sh at all (final_fx = a clean
// copy of final.mp4, no second encode). plate.grain in the DNA JSONs is now inert.
const SS = 2;
const rgba = P.rgbashift
  ? `,rgbashift=rh=-${P.rgbashift}:bh=${P.rgbashift}:enable='between(t,${anchorT},${(heroIn + 0.125).toFixed(3)})+between(t,${(LASTWORD.start + 0.04).toFixed(3)},${(LASTWORD.start + 0.17).toFixed(3)})',format=yuv420p`
  : "";
const tail = `${rgba}[v]`;

// build the punch active window (union of the apex punch + any minor punch)
let GRAPH;
if (P.punch) {
  const win = P.shakeWindow || 0.6;
  const aT = heroIn + (P.punchOffset ?? 0.045);
  const minor = P.minorPunch && LINES.find((L) => L.words.some((w) => w.minor));
  const minorT = minor ? minor.words.find((w) => w.minor).start + 0.01 : null;
  let wStart = aT,
    wEnd = aT + win;
  if (minorT != null) {
    wStart = Math.min(wStart, minorT);
    wEnd = Math.max(wEnd, minorT + 0.4);
  }
  wStart = Math.max(0.04, wStart - 0.05); // pad the easing tails
  wEnd = Math.min(DUR - 0.04, wEnd + 0.15);
  // absolute time inside the PTS-reset middle segment = local time + wStart
  const TA = `(time+${wStart.toFixed(3)})`;
  const aTs = aT.toFixed(3);
  const zp =
    `zoompan=` +
    `z='1+${P.punch}*exp(-${P.punchDecay || 9}*(${TA}-${aTs}))*between(${TA},${aTs},${aTs}+${win})${minorT != null ? `+${P.minorPunch}*exp(-10*(${TA}-${minorT.toFixed(3)}))*between(${TA},${minorT.toFixed(3)},${minorT.toFixed(3)}+0.4)` : ""}':` +
    `x='iw/2-(iw/zoom/2)${P.shakeAmpX ? `+${P.shakeAmpX * SS}*exp(-${P.shakeDecay || 7}*(${TA}-${aTs}))*sin(2*PI*${P.shakeHz || 12}*(${TA}-${aTs}))*between(${TA},${aTs},${aTs}+${win})` : ""}':` +
    `y='ih/2-(ih/zoom/2)${P.shakeAmpY ? `+${P.shakeAmpY * SS}*exp(-${P.shakeDecay || 7}*(${TA}-${aTs}))*cos(2*PI*${((P.shakeHz || 12) * 1.31).toFixed(2)}*(${TA}-${aTs}))*between(${TA},${aTs},${aTs}+${win})` : ""}':` +
    `d=1:s=${W * SS}x${H * SS}:fps=${FPS}`;
  const hasHead = wStart > 0.06; // a passthrough segment before the window
  const hasTail = wEnd < DUR - 0.06; // a passthrough segment after the window
  if (wEnd > wStart + 0.1 && (hasHead || hasTail)) {
    // 2–3 segments: only the [wStart,wEnd] window is resampled (zoompan); the
    // head/tail (whichever exist) pass through with no geometric resample.
    const segs = [];
    const labels = [];
    let n = 0;
    if (hasHead) {
      segs.push(`  [s${n}]trim=0:${wStart.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[a]`);
      labels.push("[a]");
      n++;
    }
    segs.push(
      `  [s${n}]trim=${wStart.toFixed(3)}:${wEnd.toFixed(3)},setpts=PTS-STARTPTS,scale=${W * SS}:${H * SS}:flags=lanczos,${zp},scale=${W}:${H}:flags=lanczos,setsar=1[b]`,
    );
    labels.push("[b]");
    n++;
    if (hasTail) {
      segs.push(`  [s${n}]trim=${wEnd.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[c]`);
      labels.push("[c]");
      n++;
    }
    GRAPH =
      `[0:v]split=${n}${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")};\n` +
      segs.join(";\n") +
      `;\n  ${labels.join("")}concat=n=${n}:v=1:a=0${tail}`;
  } else {
    // window spans nearly the whole clip → whole-clip supersampled path (local
    // time becomes absolute time again, so swap the offset back out)
    GRAPH = `[0:v]scale=${W * SS}:${H * SS}:flags=lanczos,${zp.replace(new RegExp(TA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "time")},scale=${W}:${H}:flags=lanczos${tail}`;
  }
} else if (P.pushIn) {
  GRAPH = `[0:v]scale=${W * SS}:${H * SS}:flags=lanczos,zoompan=z='1+${P.pushIn}*time/${DUR.toFixed(2)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W * SS}x${H * SS}:fps=${FPS},scale=${W}:${H}:flags=lanczos${tail}`;
} else {
  GRAPH = null; // no geometric reaction (and grain is gone) → nothing to post-process
}
const postfxPath = path.join(PROJECT, "_postfx.sh");
if (GRAPH) {
  fs.writeFileSync(
    postfxPath,
    `#!/usr/bin/env bash
# generated by make-theme.cjs — plate reaction for theme "${dna.name}"
# Windowed punch: only the camera-move window is resampled; the rest of the clip
# is passed through untouched so it stays as sharp as final.mp4. (No film grain.)
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -y -v error -i final.mp4 -filter_complex "
  ${GRAPH}" \\
  -map "[v]" -map 0:a -c:v libx264 -crf 14 -preset slow -profile:v high -c:a copy \\
  final_fx.mp4
echo "[postfx] ${dna.name} → final_fx.mp4"
`,
  );
} else {
  // No plate reaction at all → render-theme.sh copies final.mp4 to final_fx.mp4
  // (a lossless first-generation deliverable; no needless second encode). Remove
  // any stale _postfx.sh from a prior run so the copy path is taken.
  fs.rmSync(postfxPath, { force: true });
}

console.log(
  `[make-theme] ${dna.name}: index.html${!bodyInBg || fx.html ? " + rail.html" : ""} + _postfx.sh`,
);
console.log(
  `[make-theme]   body=${dna.body.paradigm}(${dna.body.layer}) hero=${HEROLESS ? "none (pure body)" : heroInline ? "inline:" + dna.hero.setpiece : dna.hero.setpiece + " @" + heroIn.toFixed(2) + "s"} lines=${LINES.length} dur=${DUR}s`,
);
