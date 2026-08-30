#!/usr/bin/env node
/**
 * add-video.js
 *
 * Fully automated video ingestion: give it one YouTube link, it does the rest.
 *
 *   node scripts/add-video.js "https://youtube.com/watch?v=XXXXXXXXXXX"
 *
 * Requires a YOUTUBE_API_KEY environment variable (used only for cheap,
 * 1-unit `channels.list` calls to resolve names/IDs — never for search).
 *
 * What it does:
 *   1. Extracts the video ID from the link.
 *   2. Calls YouTube's oEmbed endpoint (free, no key) to get the title,
 *      thumbnail, and the uploading channel's name/URL.
 *   3. Calls `videos.list` (1 unit) to get the full description text.
 *   4. Regexes the description for other channel links (/channel/UC... and
 *      /@handle forms).
 *   5. For every channel involved (poster + any linked creators) that isn't
 *      already in creators.json, calls `channels.list` (1 unit each) to
 *      resolve a stable channel ID, display name, and avatar.
 *   6. Merges the new video + any new/updated creators into
 *      data/creators.json and data/videos.json.
 *
 * This does NOT commit or push anything — it only edits the local JSON
 * files. Review the diff (`git diff data/`) before committing, same as any
 * other change to the dataset.
 */

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(__dirname, "..", "data");
const CREATORS_PATH = path.join(DATA_DIR, "creators.json");
const VIDEOS_PATH = path.join(DATA_DIR, "videos.json");

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

if (!API_KEY) {
  fail("Missing YOUTUBE_API_KEY environment variable.\n  Usage: YOUTUBE_API_KEY=xxxx node scripts/add-video.js <url>");
}

const inputUrl = process.argv[2];
if (!inputUrl) {
  fail('Usage: node scripts/add-video.js "https://youtube.com/watch?v=..."');
}

function extractVideoId(url) {
  const patterns = [
    /watch\?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Reserved YouTube path segments that are NOT channel vanity names — needed
// so the bare-vanity-URL pattern below doesn't misfire on things like
// youtube.com/watch, youtube.com/redirect, youtube.com/hashtag/..., etc.
const RESERVED_PATHS = [
  "watch", "results", "playlist", "feed", "feeds", "channel", "user", "c",
  "redirect", "shorts", "hashtag", "embed", "v", "attribution_link",
  "oembed", "premium", "gaming", "about", "upload", "account", "live",
  "trending", "subscription_center", "howyoutubeworks", "jobs", "creators",
  "ads", "reporthistory", "clip",
];

function extractChannelRefs(text) {
  if (!text) return [];
  const refs = new Set();

  const idPattern = /channel\/(UC[\w-]{10,})/g;
  const handlePattern = /youtube\.com\/@([\w.-]+)/g;
  // Legacy /user/NAME links
  const userPattern = /youtube\.com\/user\/([\w-]+)/g;
  // Legacy bare vanity links, e.g. youtube.com/seanklitzner — these predate
  // the @handle system. Excludes reserved paths via negative lookahead so it
  // doesn't misfire on youtube.com/watch, /redirect, /hashtag/..., etc.
  const reservedAlternation = RESERVED_PATHS.join("|");
  const vanityPattern = new RegExp(
    `youtube\\.com\\/(?!(?:${reservedAlternation})\\b)([\\w-]{2,})(?![\\w-])`,
    "g"
  );

  let m;
  while ((m = idPattern.exec(text))) refs.add("id:" + m[1]);
  while ((m = handlePattern.exec(text))) refs.add("handle:" + m[1]);
  while ((m = userPattern.exec(text))) refs.add("username:" + m[1]);
  while ((m = vanityPattern.exec(text))) refs.add("username:" + m[1]);

  return [...refs];
}

async function fetchOEmbed(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`oEmbed failed (${res.status}) — is the video public?`);
  return res.json();
}

async function fetchVideoDescription(videoId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("videos.list error: " + data.error.message);
  const item = data.items && data.items[0];
  if (!item) throw new Error("Video not found via videos.list — check the link.");
  return {
    description: item.snippet.description || "",
    channelId: item.snippet.channelId, // poster's real channel ID, straight from the API
  };
}

async function resolveChannelById(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("channels.list error: " + data.error.message);
  const item = data.items && data.items[0];
  if (!item) return null;
  return {
    id: channelId,
    name: item.snippet.title,
    handle: item.snippet.customUrl || null,
    avatar: item.snippet.thumbnails?.default?.url || null,
  };
}

async function resolveChannelByHandle(handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${handle}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("channels.list (forHandle) error: " + data.error.message);
  const item = data.items && data.items[0];
  if (!item) return null;
  return {
    id: item.id,
    name: item.snippet.title,
    handle: "@" + handle,
    avatar: item.snippet.thumbnails?.default?.url || null,
  };
}

async function resolveChannelByUsername(username) {
  // Legacy parameter — covers both youtube.com/user/NAME and the older bare
  // youtube.com/NAME vanity URLs. Not every legacy vanity URL is a real
  // "username" in the API's sense (some are custom URLs with no username
  // backing them at all), so this can legitimately come back empty even for
  // a real, active channel — that's a limitation of the old API surface,
  // not a bug here.
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&forUsername=${username}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("channels.list (forUsername) error: " + data.error.message);
  const item = data.items && data.items[0];
  if (!item) return null;
  return {
    id: item.id,
    name: item.snippet.title,
    handle: item.snippet.customUrl || null,
    avatar: item.snippet.thumbnails?.default?.url || null,
  };
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function saveJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const videoId = extractVideoId(inputUrl);
  if (!videoId) fail("Couldn't extract a video ID from that URL.");

  console.log(`→ Fetching oEmbed for ${videoId}...`);
  const oembed = await fetchOEmbed(videoId);
  console.log(`  Title: ${oembed.title}`);
  console.log(`  Poster (per oEmbed): ${oembed.author_name}`);

  console.log(`→ Fetching description via videos.list (1 unit)...`);
  const { description, channelId: posterId } = await fetchVideoDescription(videoId);

  const creators = loadJson(CREATORS_PATH);
  const videos = loadJson(VIDEOS_PATH);

  const refs = extractChannelRefs(description);
  console.log(`→ Found ${refs.length} channel reference(s) in the description.`);

  // Always resolve the poster, even if the description mentions no one else.
  const toResolve = new Map(); // channelId -> already known name, or null if needs a lookup
  if (!creators[posterId]) toResolve.set(posterId, { by: "id", value: posterId });

  const linkedIds = new Set();
  for (const ref of refs) {
    const [kind, value] = ref.split(":");
    if (kind === "id") {
      linkedIds.add(value);
      if (!creators[value]) toResolve.set(value, { by: "id", value });
    } else if (kind === "handle") {
      // We don't know the real ID yet — resolve by handle, add the result's real ID after.
      toResolve.set("handle:" + value, { by: "handle", value });
    } else if (kind === "username") {
      toResolve.set("username:" + value, { by: "username", value });
    }
  }

  const newlyResolved = {};
  const unresolved = [];
  for (const [key, task] of toResolve) {
    const label = task.by === "id" ? task.value : task.by === "handle" ? "@" + task.value : task.value;
    console.log(`→ Resolving ${label} via channels.list (1 unit)...`);
    let result;
    if (task.by === "id") result = await resolveChannelById(task.value);
    else if (task.by === "handle") result = await resolveChannelByHandle(task.value);
    else result = await resolveChannelByUsername(task.value);

    if (!result) {
      console.warn(`  ⚠ Could not resolve ${label} — skipping (legacy vanity URLs don't always map cleanly).`);
      unresolved.push(label);
      continue;
    }
    newlyResolved[result.id] = result;
    if (task.by === "handle" || task.by === "username") linkedIds.add(result.id);
  }

  // Merge newly resolved creators into creators.json (don't clobber existing entries).
  for (const [id, info] of Object.entries(newlyResolved)) {
    creators[id] = creators[id] || { name: info.name, handle: info.handle, avatar: info.avatar };
  }

  const allCreatorIds = [posterId, ...linkedIds].filter((id, i, arr) => arr.indexOf(id) === i && creators[id]);

  videos[videoId] = {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: oembed.title,
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    creatorIds: allCreatorIds,
  };

  saveJson(CREATORS_PATH, creators);
  saveJson(VIDEOS_PATH, videos);

  console.log(`\n✔ Added "${oembed.title}"`);
  console.log(`  Creators: ${allCreatorIds.map(id => creators[id].name).join(", ")}`);
  if (unresolved.length) {
    console.log(`\n⚠ ${unresolved.length} reference(s) couldn't be resolved automatically:`);
    unresolved.forEach(u => console.log("  -", u));
    console.log("  These likely need manual entry — search their name + \"youtube\" to find the current channel.");
  }
  console.log(`\nReview with: git diff data/`);
}

main().catch(err => fail(err.message));
