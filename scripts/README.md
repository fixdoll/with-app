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

- **`add-video.js`** — *implemented, this is the main tool.* Fully automated:
  give it one YouTube link and it does everything —

    ```
    YOUTUBE_API_KEY=xxxx node scripts/add-video.js "https://youtube.com/watch?v=..."
    ```

  It fetches the title/thumbnail/poster via oEmbed (free), pulls the full
  description via `videos.list` (1 unit), regexes the description for other
  channel links, resolves any new channel IDs/handles via `channels.list`
  (1 unit each), and merges everything directly into `data/creators.json`
  and `data/videos.json`. Nothing is committed automatically — review with
  `git diff data/` before pushing, same as any manual edit.

  Given how rare description-linking turned out to be in practice, most
  runs will only add the poster as a creator — that's expected, not a bug.
  It's still worth running on every video you want in the database, since
  it saves you from hand-typing the JSON entry either way.

- **`parse-hub-list.js`** — *implemented.* Converts a pasted list of
  `Name - channel URL` lines into ready-to-copy JSON for `creators.json` /
  `videos.json`. Still the right tool specifically for hub videos like
  YGS 100, where you already have 50+ names typed out from a description
  and want to bulk-seed them without calling the API 50 times individually.
  Does not call any API — purely local text parsing.

- **`resolve-handles.js`** — *stub, not implemented.* Superseded by the
  handle-resolution logic now built into `add-video.js`. Kept only in case
  a standalone batch-resolution tool is useful later for cleaning up old
  `parse-hub-list.js` output that still has unresolved handles sitting in
  `creators.json`.

## Ideas parked for later (not built)

- RSS-feed crawl (`videos.xml?channel_id=...`) seeded from a hub video's
  creator list, breadth-first, capped at a fixed node count.
- `playlistItems.list`-based full back-catalog pulls for specific
  high-value/well-connected creators once the graph has some shape.
- A small serverless function (Cloudflare Worker or similar) that takes
  in-game video submissions and opens a GitHub Issue automatically, instead
  of relying on the manual Issue template alone.
