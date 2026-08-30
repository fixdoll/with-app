# /scripts

Tooling for building out `/data`. Nothing here runs automatically yet —
these are manual, run-when-needed helpers, not a CI pipeline.

## Current status

Automated description-link scraping and the RSS-based crawl were explored
and mostly deprioritized: recent testing showed most current videos don't
reliably credit collaborators in their descriptions, so the signal-to-effort
ratio wasn't worth building out yet. The current plan leans on:

1. **Manually seeded hub videos** (e.g. YGS 100) — high creator density,
   confirmed by hand.
2. **In-game player submissions** — crowdsourced, reviewed via GitHub Issues.

Scraping may come back later as a supplementary source, not a primary one.

## Scripts

- **`parse-hub-list.js`** — *implemented.* Converts a pasted list of
  `Name - channel URL` lines into ready-to-copy JSON for `creators.json` /
  `videos.json`. Use this for manual hub-seeding (see `/data/README.md`).
  Does not call any API — purely local text parsing.

- **`resolve-handles.js`** — *stub, not implemented.* Intended to resolve
  `@handle`-only creators (produced by `parse-hub-list.js` when a channel
  URL only has a handle, no `UC...` ID) into real channel IDs via
  `channels.list`. Needs a `YOUTUBE_API_KEY`. Low cost (1 unit/handle) —
  quota is not a concern here.

## Ideas parked for later (not built)

- RSS-feed crawl (`videos.xml?channel_id=...`) seeded from a hub video's
  creator list, breadth-first, capped at a fixed node count.
- `playlistItems.list`-based full back-catalog pulls for specific
  high-value/well-connected creators once the graph has some shape.
- A small serverless function (Cloudflare Worker or similar) that takes
  in-game video submissions and opens a GitHub Issue automatically, instead
  of relying on the manual Issue template alone.
