#!/usr/bin/env node
/**
 * resolve-handles.js  [STUB — not yet implemented]
 *
 * Intended purpose: take any creator in data/creators.json keyed with a
 * placeholder "UNRESOLVED_HANDLE_..." id (see parse-hub-list.js) and resolve
 * it to a real, stable channel ID via the YouTube Data API:
 *
 *   GET https://www.googleapis.com/youtube/v3/channels
 *       ?part=snippet&forHandle={handle}&key={YOUTUBE_API_KEY}
 *
 * Cost: 1 quota unit per handle resolved. At 10,000 units/day this is not a
 * meaningful constraint even for large batches.
 *
 * Once implemented, this script should:
 *   1. Read data/creators.json
 *   2. Find all keys starting with "UNRESOLVED_HANDLE_"
 *   3. Call channels.list for each one
 *   4. Rewrite creators.json with the real UC... key, migrating the entry
 *      (name/handle/avatar) across, and update any videos.json entries that
 *      reference the old placeholder key
 *   5. Print a diff-friendly summary rather than silently overwriting
 *
 * Needs: a YOUTUBE_API_KEY environment variable. Do not commit a key to
 * this repo — read it from process.env only.
 */

console.log("resolve-handles.js is a stub. See the comment header for the intended behavior.");
console.log("Requires a YOUTUBE_API_KEY environment variable once implemented.");
