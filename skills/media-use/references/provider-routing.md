# provider routing

Routing (local / HeyGen / ElevenLabs / free) is decided by the **CLI from environment**, NOT by this skill's prompt. The skill issues a business command; the CLI picks the backend.

## env → backend

- `HEYGEN_API_KEY` / OAuth → `heygen` CLI (TTS via `voice speech create`; upload via `asset create`; BGM / SFX when shipped)
- `ELEVENLABS_API_KEY` → ElevenLabs (TTS / ASR) where wired
- neither → free / local (`npx hyperframes ...`) or royalty-free base; for paid-only ops, return `needs_auth`

## free-first policy

Lead with cheap / free endpoints so users get value before any paywall. Connecting a HeyGen key is part of onboarding, but the **first capabilities surfaced are free** (local tools, and BGM/SFX from inventory once it ships) — not the expensive ones. "Giving people good stuff is the goal."

## what exists today (heygen v0.0.10)

- `heygen` CLI: `voice` (TTS: `voice speech create`), `asset` (upload), `video`, `video-agent`, `lipsync`, `avatar`, `brand-kit`, `voice clone`. **No `music` / `bgm` / `sfx` command.**
- `npx hyperframes` (free / local): `tts` (Kokoro), `transcribe` (Whisper), `remove-background`.
- ElevenLabs: wrapped for TTS / ASR when a key is present.

## CLI ownership

- Capability APIs live in the **`heygen` CLI** — install and use it; do not fork them into HyperFrames. Exception: cloud-rendering APIs live in the HyperFrames CLI.
- Whether media-use's own bookkeeping verbs (`find` / `organize` / `resolve` orchestration) become real `hyperframes media <verb>` subcommands, or stay skill procedures + thin helper scripts, is **open / TBD**.

## never

- Never put cost / model-selection logic in the skill prompt (`if cost > x`). Models and prices change behind the CLI; the skill stays stable.

## planned

- A per-skill **memory** of the user's provider preferences, stored in the global workspace — so the agent recalls "use ElevenLabs for SFX" without re-deciding each time. Not in this prompt.
