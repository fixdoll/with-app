#!/usr/bin/env node
/**
 * parse-hub-list.js
 *
 * Turns a pasted list of "Name — channel URL" lines (one per creator, as you'd
 * copy out of a video description or a wiki page) into ready-to-merge JSON
 * snippets for creators.json and videos.json.
 *
 * This does NOT hit the YouTube API — it just extracts whatever ID/handle is
 * in the URL you pasted. Names, avatars, and confirmed channel IDs (for
 * @handle links) still need a follow-up API/oEmbed pass — see resolve-handles.js.
 *
 * USAGE:
 *   1. Put your pasted lines into input.txt, one creator per line, formatted as:
 *        Creator Name - https://youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx
 *        Creator Name - https://youtube.com/@somehandle
 *   2. Run:
 *        node parse-hub-list.js input.txt "video-id" "https://youtube.com/watch?v=..." "Video Title"
 *   3. Copy the printed JSON into data/creators.json and data/videos.json by hand
 *      (intentionally not auto-writing to the real data files — always eyeball
 *      this output before merging).
 */

const fs = require("fs");

const [, , inputPath, videoId, videoUrl, videoTitle] = process.argv;

if (!inputPath || !videoId || !videoUrl || !videoTitle) {
  console.error(
    'Usage: node parse-hub-list.js <input.txt> <videoId> <videoUrl> "<Video Title>"'
  );
  process.exit(1);
}

const lines = fs
  .readFileSync(inputPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const creators = {};
const creatorIds = [];

for (const line of lines) {
  // Accept "Name - url", "Name — url", or "Name, url"
  const match = line.match(/^(.+?)\s*[-—,]\s*(https?:\/\/\S+)$/);
  if (!match) {
    console.error(`Skipping unparseable line: "${line}"`);
    continue;
  }
  const [, name, url] = match;

  let idOrHandle;
  let key;
  const channelIdMatch = url.match(/channel\/(UC[\w-]{10,})/);
  const handleMatch = url.match(/@([\w.-]+)/);

  if (channelIdMatch) {
    key = channelIdMatch[1];
  } else if (handleMatch) {
    // No stable ID available yet — use a placeholder key that flags itself
    // for resolution. Swap this for the real UC... ID via resolve-handles.js
    // before merging into the real data files.
    key = "UNRESOLVED_HANDLE_" + handleMatch[1];
  } else {
    console.error(`Skipping line with unrecognized URL shape: "${line}"`);
    continue;
  }

  creators[key] = {
    name: name.trim(),
    handle: handleMatch ? "@" + handleMatch[1] : undefined,
    avatar: null, // fill in later via channels.list or oEmbed
  };
  creatorIds.push(key);
}

const videoEntry = {
  [videoId]: {
    url: videoUrl,
    title: videoTitle,
    creatorIds,
  },
};

console.log("\n--- Append to data/creators.json ---\n");
console.log(JSON.stringify(creators, null, 2));

console.log("\n--- Append to data/videos.json ---\n");
console.log(JSON.stringify(videoEntry, null, 2));

const unresolved = creatorIds.filter((id) => id.startsWith("UNRESOLVED_HANDLE_"));
if (unresolved.length) {
  console.log(
    `\n⚠ ${unresolved.length} creator(s) only had an @handle, not a channel ID.`
  );
  console.log("Resolve these via channels.list before merging for real:");
  unresolved.forEach((id) => console.log("  -", id.replace("UNRESOLVED_HANDLE_", "@")));
}
