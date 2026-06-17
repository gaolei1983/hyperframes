# find / preview

The agent's lightweight read interface over the workspace. Mental model: **grep for media**. Not a user-facing viewer, not review.

## find (v0.1)

Query the index / manifest by text and/or type; return matching AssetRecords. Today this is a procedure over the manifest:

```
# read the generated view
cat .media/index.md

# or grep the manifest for a type / keyword
grep '"type":"bgm"' .media/manifest.jsonl
```

Runnable: `node scripts/find-asset.mjs --workspace <dir> [--type image | --tag logo | --query "previous bgm"] [--human]` → matching AssetRecords as JSON (or tab-separated with `--human`). (A `hyperframes media find` CLI wrapper is still TBD — see `provider-routing.md`.)

## Why it matters (multi-turn edits)

"swap the BGM", "reuse last version's screenshot", "use the logo I uploaded" all require finding a **prior** asset. Without find, the agent regenerates, picks the wrong asset, or wastes context opening originals. find is what makes edits cheap and is the core support for subsequent edits.

## preview ◇ (later)

For visual assets: a contact sheet + descriptions so the agent can choose among many. Not on the v0.1 critical path.
