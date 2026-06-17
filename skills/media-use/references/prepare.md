# prepare ◇ (open / negotiable)

> **Open design question.** Whether `prepare` belongs in media-use is not settled — the video workflow could write its own snippets, with media-use stopping at the AssetRecord. Listed as a proposal; decide with the team.

If kept: turn an AssetRecord into a **declarative** HyperFrames snippet the workflow can place. This is **not** full apply — which scene / component it goes into is the workflow's decision (see `/hyperframes-core` for placement).

Example (attribute names are **proposed**, pending the HyperFrames composition contract):

```html
<audio
  data-hf-media="asset:bgm_001"
  data-hf-role="bgm"
  data-hf-duck-against="role:voiceover"
  data-hf-volume="0.28"
/>
```

## Multi-turn edit benefit

Swapping an asset changes **one** `src` / reference, not the timeline — `find` locates the old asset, the declarative snippet avoids drift when the script length changes. This is the structural answer to "subsequent edits break the video."
