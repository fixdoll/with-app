# /scripts

Tooling for building out `/data`. Nothing here runs automatically as CI —
these are manual, run-when-needed tools.

## Current status

Automated description-link scraping was initially deprioritized after
testing showed most current videos don't credit collaborators in
descriptions anymore. `crawl-rss.js` exists as a working bulk-discovery
pass regardless — it's cheap (mostly free RSS calls) to run, it just won't
find hits on every video it checks. Treat its output as *candidates* to
skim before trusting, same as any other automated pass.

## Scripts

- **`add-video.js`** — *implemented.* Give it one YouTube link, it does
  everything for that single video:

    ```
    YOUTUBE_API_KEY=xxxx node scripts/add-video.js "https://youtube.com/watch?v=..."
    ```

  Fetches title/thumbnail via oEmbed (free), description + poster's real
  channel ID via `videos.list` (1 unit), extracts other channel refs from
  the description, resolves any new ones via `channels.list` (1 unit each),
  and merges everything into `data/creators.json` / `data/videos.json`.

- **`crawl-rss.js`** — *implemented.* Breadth-first crawl starting from
  every creator currently in `data/creators.json`:

    ```
    YOUTUBE_API_KEY=xxxx node scripts/crawl-rss.js
    ```

  For each creator, pulls their last 15 videos via the free RSS feed
  (`youtube.com/feeds/videos.xml?channel_id=...`), scans each description
  for channel mentions, and:
  - Skips the video entirely if no mentions are found (expected for most
    videos — this is by design, not a bug).
  - Otherwise adds the video (poster + mentioned creators) and enqueues any
    newly-found creators for their own crawl pass.
  - **Prunes** any creator whose RSS feed comes back completely empty
    (private, deleted, or never posted) — removes them from
    `creators.json`, strips them from any video's `creatorIds` (deleting
    the video too if that drops it below 2 valid creators), and records
    them in `data/pruned-creators.json` so future crawls skip them
    instantly instead of re-discovering and re-pruning the same
    unrecognizable channel every time they're mentioned elsewhere. This
    also keeps the 500-cap budget from being spent on people who'd never
    be a satisfying answer in-game anyway (often editors/musicians credited
    on someone else's video, not creators in their own right).
  - **Keeps running past `MAX_CREATORS`** rather than stopping there: once
    the cap is hit, new creators stop being added, but the crawl keeps
    visiting everyone already known, and still adds videos that connect
    already-known people to each other. A video whose only mentions are
    brand-new people gets skipped once capped; a video mentioning a mix of
    known and new people still gets added, just with the new mentions
    dropped. The crawl only fully stops once the queue is empty.

  Only costs quota on `channels.list` resolution calls (1 unit each) — RSS
  fetches are free. Safe to re-run at any time, including after raising
  `MAX_CREATORS` — see the comment header in the file for details.

- **`lib/youtube.js`** — shared helpers used by both scripts above:
  channel-reference extraction (handles `/channel/UC...`, `/@handle`,
  `/user/NAME`, and legacy bare vanity URLs) and the `channels.list`
  resolution functions. Fix bugs here, not in either script individually —
  this got split out specifically after a regex bug had to be fixed twice.

- **`parse-hub-list.js`** — *implemented.* Converts a pasted list of
  `Name - channel URL` lines into ready-to-copy JSON. Still the right tool
  for a hub video where you already have names typed out from a
  description and want to bulk-seed without calling the API per name.

- **`resolve-handles.js`** — *stub, superseded.* Handle resolution now
  lives in `lib/youtube.js` and is used automatically by both scripts
  above. Kept only in case a standalone batch-cleanup tool is useful later.

## Ideas parked for later (not built)

- RSS-feed crawl (`videos.xml?channel_id=...`) seeded from a hub video's
  creator list, breadth-first, capped at a fixed node count.
- `playlistItems.list`-based full back-catalog pulls for specific
  high-value/well-connected creators once the graph has some shape.
- A small serverless function (Cloudflare Worker or similar) that takes
  in-game video submissions and opens a GitHub Issue automatically, instead
  of relying on the manual Issue template alone.
