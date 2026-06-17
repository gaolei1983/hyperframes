# AssetRecord

The central object. media-use is root-level and often runs with no composition, so the unit is an asset **and its record** — not a video binding.

```ts
type AssetRecord = {
  asset_id: string;
  type: "image" | "audio" | "bgm" | "sfx" | "video" | "voice" | "text" | "unknown";
  path: string; // workspace-local, stable
  source: "user_upload" | "url" | "search" | "generated" | "processed" | "project_output";
  description: string; // so an agent can reason without re-opening the file
  tags: string[];
  usage_intent?: "must_use" | "prefer_use" | "reference_only" | "style_reference";
  provenance?: { provider?: string; model?: string; prompt?: string; derived_from?: string };
  metadata?: {
    duration?: number;
    width?: number;
    height?: number;
    bpm?: number;
    loudness?: number;
    has_alpha?: boolean;
  };
  reusable?: boolean;
  used_in?: string[];
  usage_count?: number;
  status: "ready" | "failed" | "deprecated";
};
```

One record per line in `manifest.jsonl`. `index.md` is a readable table generated from these.

## usage_intent

User-specified priority enters `description` / `tags` at **organize** time. Whether an asset is actually used is the workflow's call, but the user's instruction must be preserved on the record.

```json
{
  "asset_id": "logo_001",
  "type": "image",
  "path": ".media/raw/logo.png",
  "usage_intent": "must_use",
  "description": "Acme logo, must appear in final CTA",
  "tags": ["brand", "logo", "must_use"],
  "status": "ready"
}
```

## Determinism

`path` is a frozen, project-local file. Never store a prompt or a remote URL as the thing a composition references — **resolve first, then freeze.**
