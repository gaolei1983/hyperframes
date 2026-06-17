# process

Transform an existing asset. The intent is usually explicit, which makes this a clean media-use job.

## Operations

`remove-background` · `matting` · `upscale` · `crop` · `trim` · `normalize` (audio) · `transcribe` · `extract-alpha`

## Free-first (today)

- **background removal:** `npx hyperframes remove-background ...` (local). Note: `--background-output` is hole-cut, not inpainted — for "scene without the person" a different tool is needed (see `/hyperframes-media`).
- **transcribe:** `npx hyperframes transcribe --model <m> ...`.

## Procedure

```
process --asset img_001 --action remove-bg
```

1. run the underlying tool (free/local first; see `provider-routing.md`)
2. write the output into `.media/processed/`
3. register a new AssetRecord with `source: "processed"` and `provenance.derived_from: "img_001"`
4. regenerate `index.md`

## Runnable (v0.1)

`node scripts/process.mjs --workspace <dir> --asset <id> --action <remove-bg|transcribe>`:

- **remove-bg** — `hyperframes remove-background` → transparent `.png` (image) / `.webm` (video) into `.media/processed/`.
- **transcribe** — `hyperframes transcribe`. Note: `--json` returns a _status_ summary, not the transcript; the script moves the real word-level transcript from `transcriptPath` to a stable `.media/processed/<id>_transcript.json` (the tool otherwise writes a generic `transcript.json` next to the audio, which collides on repeat).

Both register a new AssetRecord with `source: processed` + `provenance.derived_from: <id>`, then regenerate the index.

## Paid / heavy [later]

HQ matting / upscale / A-roll are GPU-heavy → route to the key-gated provider when available; otherwise a local rough version, or skip-with-report. These are the monetizable capabilities that come after the free wedge.
