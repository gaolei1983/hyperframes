# workspace

Files, not a DB. One unified `.media/` folder, at two tiers: a per-project `.media/` + a global/personal `~/.media/`.

## Layout

```
<project>/.media/             # PROJECT tier — one ledger + files for this project
  manifest.jsonl             # SSOT (one AssetRecord per line)
  index.md                   # generated, agent-readable view (never hand-edit)
  config.json  reports/  snippets/
  audio/{bgm,sfx,voice}/  images/ icons/ raw/ generated/ processed/ preview/
~/.media/                    # GLOBAL / personal tier — cross-project reusable assets
  manifest.jsonl  index.md   # own copies, marked reusable + used_in / usage_count
  audio/ images/ ...
```

## Source of truth

- `manifest.jsonl` = SSOT for the project. Only the skill's helpers / the CLI write it.
- `index.md` = generated, human/agent-readable view. **Read it; never hand-edit it.** Regenerate from the manifest after any change.
- `~/.media/manifest.jsonl` = the global/personal tier — cross-project reusable assets (post-project organize promotes here).

## organize (procedure)

Bring files (uploaded / searched / generated / processed) under management:

1. copy or move into the right `.media/` subdir
2. create an AssetRecord (`asset-record.md`) — description, tags, source, usage_intent
3. append the record to `manifest.jsonl`
4. regenerate `index.md`

Runnable: `node scripts/register-asset.mjs --workspace <dir> --id … --type … --path … --source … [--derived_from … --usage_intent … --tags a,b]` (or `--json '{…}'`) does steps 3–4 — upsert by `asset_id` + reindex. `render-index.mjs` regenerates the view alone.

## Reuse — post-project + cross-project

- **On session end / project done:** mark which assets the composition used (`used_in`, `usage_count`, `reusable`); promote reusable ones to `~/.media/` (its manifest + index regenerate). (Can be a cron / post-session hook.)
- **On a new similar project:** query `~/.media/index.md`, copy selected assets into the new project's `.media/`, register them locally.

> Compositions reference the **project-local copy**, never the global path — this keeps the render reproducible and prevents a cleaned global cache from breaking an old project.
