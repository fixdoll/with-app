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

  Stops when either the queue empties or the total creator count hits
  `MAX_CREATORS` (500, edit the constant at the top of the file to change
  it). Saves incrementally after every creator, so an interrupted run
  doesn't lose progress. Only costs quota on `channels.list` resolution
  calls (1 unit each) — the RSS fetches themselves are free.

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
