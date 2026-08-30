# /data

This is the source of truth the game reads at runtime. Two files:

- **`creators.json`** — every known creator, keyed by their YouTube **channel ID**
  (the stable `UC...` string), not by name or handle. Names and handles can
  change; the ID doesn't.
- **`videos.json`** — every confirmed video, keyed by an arbitrary short ID
  (e.g. `ygs100`), pointing to a real YouTube URL and a list of `creatorIds`
  who appear in it.

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
