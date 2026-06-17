# search strategy

The design for media-use's `resolve` search: given the text for a video, understand it, plan queries, search, review, collect. This file keeps the full design so `resolve` doesn't regress to "just search."

## resolve is four steps, not one

1. **Analyze / plan** (LLM) — read the input; extract named entities (people, orgs, brands, locations, events), key topics that need visuals, and temporal context. Emit a search plan.
2. **Search** (no LLM) — execute the plan across sources; high-priority queries first, independent ones in parallel. The file system is the interface (results land in the workspace).
3. **Review / select** — judge each candidate, mark `use` / `maybe` / `reject`. **This is the step that makes resolve good** — search ≠ resolve; an agent that takes the first / generated result produces bad output.
4. **Organize** — write the kept assets to the workspace ledger (`workspace.md`); freeze stable paths (rehost if third-party).

## Two-pole query strategy (the core rule)

Generate ONLY **atomic** or **specific** queries — never middle-ground.

- **Atomic (1–3 words)** → composable visual building blocks: portraits ("Elon Musk"), logos/icons ("SNL logo"), objects ("microphone"). Platform: almost always `image`. Stable, high reuse → cacheable.
- **Specific (5–15 words)** → editorial / contextual: news events, tweets, articles. Platform: `news` / `tweet` / `web`. Near-unique per video → not cached. If it returns nothing useful, **give up — do not broaden and retry.**
- ❌ Never the middle ("Elon Musk SNL" — too vague for news, too specific for an atomic image).

## Platform routing

| Content              | Platform | Strategy |
| -------------------- | -------- | -------- |
| person portrait      | image    | atomic   |
| logo / icon / symbol | image    | atomic   |
| object / scene       | image    | atomic   |
| news event           | news     | specific |
| social reaction      | tweet    | specific |
| background / context | web      | specific |

## Review: text vs vision ◇ (decision)

- **Text-only review** (title / snippet / description) — fast, cheap, no image analysis.
- **Vision self-review** — analyze the candidate image to pick the best — higher quality, more cost.
- Decide per use: text-only for v0 speed; vision when selection quality matters. This is the "selection is the hard part" crux.

## Principles

- **No video search** — low ROI, skip.
- **No reframe** — modern generation handles aspect ratios.
- **Fail fast** — a failed specific query is skipped, not broadened.
- **File system is the interface** — all I/O through the workspace.

## Providers

- **image / icon:** a stock-provider layer (a web image source + an icon source) behind the `MEDIA_USE_SEARCH_CMD` backend is the production path — reuse it; don't call providers directly from the skill.
- **news / tweet / web:** source adapters (not yet in media-use) — a later `/hyperframes-media`-style addition.
