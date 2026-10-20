# /data

This is the source of truth the game reads at runtime. Two files:

- **`creators.json`** — every known creator, keyed by their YouTube **channel ID**
  (the stable `UC...` string), not by name or handle. Names and handles can
  change; the ID doesn't.
- **`videos.json`** — every confirmed video, keyed by an arbitrary short ID
  (e.g. `ygs100`), pointing to a real YouTube URL and a list of `creatorIds`
  who appear in it.
- **`banned-creators.json`** — channel IDs that should never appear as a
  selectable option in the game, even if they're still listed as a
  collaborator on some video's `creatorIds`. Maintained by hand, not by any
  script. `add-video.js` and `crawl-rss.js` both skip banned IDs entirely
  (won't add them to `creators.json`, won't crawl their feed, won't include
  them as a mentioned creator on a video) — and the game itself filters
  them out at runtime too, as a second line of defense in case a banned ID
  is already sitting in existing data.
- **`pruned-creators.json`** — channel IDs `crawl-rss.js` automatically
  removed because their RSS feed came back empty (private, deleted, or a
  channel that's never posted publicly — often someone only mentioned as an
  editor/musician credit rather than a recognizable creator in their own
  right). Auto-maintained, not meant for manual editing, though nothing
  breaks if you do. Functions identically to `banned-creators.json` at
  read time — both get filtered out of the game and both stop new
  discovery from re-adding the same channel — but kept as a separate file
  so the *reason* stays distinguishable (curated judgment call vs. "this
  channel simply has no content").

See `creators.example.json` / `videos.example.json` for the exact shape —
those two files are never loaded by the game, they're just documentation.

## Adding data

- **Manual hub seeding** (e.g. YGS 100): add entries by hand directly to
  both files. Every new creator mentioned in a video needs a matching entry
  in `creators.json`, even if it's minimal at first (name only, backfill
  avatar/handle later).
- **In-game submissions**: land here as GitHub Issues first (see
  `.github/ISSUE_TEMPLATE/`), get manually reviewed, then get folded into
  these files as a normal commit.
- **API-assisted lookups**: any script that resolves a channel ID to a name
  (`channels.list`) or a video's poster (oEmbed) should write directly into
  this shape — see `/scripts/README.md`.

## Rules of thumb

- Channel ID is the only safe key. Never key on name or handle.
- Don't delete a creator/video just because a lookup temporarily fails —
  dormant or renamed channels are still valid nodes in the graph.
- Keep this JSON valid at all times — the game fetches it directly with no
  build step in between.

## Creator popularity

`popularity` is the channel's public YouTube subscriber count, fetched from `channels.list` statistics. It is a numeric count, not a normalized score, so consumers can choose their own scale or weighting. A `null` value means YouTube hides the count or did not return a usable count. Older creator records may omit the field; treat an omitted or null value as unknown, never as zero. `popularityUpdatedAt` is the UTC date the count was last refreshed.

To refresh counts, set `YOUTUBE_API_KEY` in your shell and run `node scripts/refresh-popularity.js` from `docs/`. The script requests channel statistics in batches of 50, updates only popularity fields, and writes the file only after all API requests succeed. IDs missing from an API response retain their previous values. Review the diff and commit the resulting data when appropriate. The key is read from the environment and must not be saved in the repository.
