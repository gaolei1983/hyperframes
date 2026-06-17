# setup

Lazy-init the media workspace and read provider status. Runs automatically on the first media op when no workspace exists — never block the user on an explicit setup step.

## What setup does

- create the workspace asset structure (see `workspace.md`)
- detect provider / auth / local-tool status (via the CLI / env — see `provider-routing.md`)
- write a small readable config the agent can consult

## Global vs project

- **Global** (once per machine): provider / auth / local-tool status. Source of truth lives with the CLI, not this skill — the skill only reads it.
- **Project** (per project): the asset workspace + a small `.media/config.json`.

## Lazy init

If a media op is requested and no `.media/manifest.jsonl` is in scope, create one:

- standalone (no HyperFrames project in cwd) → `./.media-use-workspace/.media/...`
- inside a HyperFrames project → `<project>/.media/...`

Runnable: `node scripts/init-workspace.mjs --workspace <dir>` (idempotent — creates the structure + empty manifest + initial index + `.media/config.json` with a provider probe). Report what was created in one line, then proceed with the op. Example:

```
No media-use workspace found. Created ./.media/manifest.jsonl and ./.media/index.md.
```

## Config (written by `init`)

`init` writes `<project>/.media/config.json` once — defaults plus a **provider probe** (PATH + env scan, no spawn) so the agent knows what's available without re-checking:

```json
{
  "profile": "free-first",
  "default_provider": "free-first",
  "auto_register_outputs": true,
  "composition_ref_policy": "project_local_asset_id",
  "providers": {
    "heygen": {
      "cli": true,
      "authed": true,
      "capabilities": ["tts (voice speech)", "bgm (audio sounds)", "asset upload"]
    },
    "hyperframes": { "cli": true, "capabilities": ["tts", "transcribe", "remove-background"] },
    "elevenlabs": { "key": false },
    "local": { "ffmpeg": true, "python3": true }
  }
}
```

The probe is best-effort: binary on PATH? `heygen` authed via `~/.heygen/credentials` or `HEYGEN_API_KEY`? `ELEVENLABS_API_KEY` set? Deeper provider/model status stays with the CLI — the skill only records what it sees.
