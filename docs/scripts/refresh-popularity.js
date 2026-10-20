#!/usr/bin/env node
/** Refreshes creators' popularity and channel avatars from YouTube. */
const fs = require("fs");
const path = require("path");

const apiKey = process.env.YOUTUBE_API_KEY;
if (!apiKey) {
  console.error("Missing YOUTUBE_API_KEY environment variable.");
  process.exit(1);
}

const creatorsPath = path.join(__dirname, "..", "data", "creators.json");

function usableAvatar(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function channelAvatar(channel) {
  const thumbnails = channel.snippet?.thumbnails || {};
  // Prefer the largest usable image, falling back when YouTube omits a size.
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const candidate = thumbnails[size]?.url;
    if (usableAvatar(candidate)) return candidate;
  }
  return null;
}

async function main() {
  const creators = JSON.parse(fs.readFileSync(creatorsPath, "utf8"));
  const ids = Object.keys(creators);
  let updated = 0;
  let avatarsFilled = 0;

  // channels.list accepts at most 50 IDs per request. Build the complete
  // update in memory and only write after every request has succeeded.
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.search = new URLSearchParams({
      part: "snippet,statistics",
      id: batch.join(","),
      key: apiKey,
    }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`channels.list failed (${response.status})`);
    const data = await response.json();
    if (data.error) throw new Error("channels.list error: " + data.error.message);

    for (const channel of data.items || []) {
      const creator = creators[channel.id];
      if (!creator) continue;
      const raw = channel.statistics?.subscriberCount;
      const count = channel.statistics?.hiddenSubscriberCount || raw == null
        ? null
        : Number(raw);
      creator.popularity = Number.isSafeInteger(count) && count >= 0 ? count : null;
      creator.popularityUpdatedAt = new Date().toISOString().slice(0, 10);
      const avatar = channelAvatar(channel);
      if (!usableAvatar(creator.avatar) && avatar) {
        creator.avatar = avatar;
        avatarsFilled++;
      }
      updated++;
    }
  }

  fs.writeFileSync(creatorsPath, JSON.stringify(creators, null, 2) + "\n");
  console.log(`Updated popularity for ${updated} of ${ids.length} creators; filled ${avatarsFilled} missing avatar(s).`);
  if (updated < ids.length) console.warn(`${ids.length - updated} channel(s) were absent from YouTube's response; their existing values were preserved.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
