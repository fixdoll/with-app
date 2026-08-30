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
 *   2. Calls YouTube's oEmbed endpoint (free, no key) to get the title and
 *      thumbnail.
 *   3. Calls `videos.list` (1 unit) to get the full description + the
 *      poster's real channel ID.
 *   4. Extracts other channel references from the description (see
 *      lib/youtube.js — handles /channel/UC..., /@handle, /user/NAME, and
 *      legacy bare vanity URLs).
 *   5. Resolves any new channel refs via `channels.list` (1 unit each).
 *   6. Merges the new video + any new/updated creators into
 *      data/creators.json and data/videos.json.
 *
 * This does NOT commit or push anything — it only edits the local JSON
 * files. Review with `git diff data/` before committing.
 */

const fs = require("fs");
const path = require("path");
const { extractChannelRefs, resolveRef } = require("./lib/youtube");

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

  console.log(`→ Fetching description via videos.list (1 unit)...`);
  const { description, channelId: posterId } = await fetchVideoDescription(videoId);

  const creators = loadJson(CREATORS_PATH);
  const videos = loadJson(VIDEOS_PATH);

  const refs = extractChannelRefs(description);
  console.log(`→ Found ${refs.length} channel reference(s) in the description.`);

  const toResolve = new Map();
  if (!creators[posterId]) toResolve.set("id:" + posterId, { kind: "id", value: posterId });

  const linkedIds = new Set();
  for (const ref of refs) {
    const [kind, value] = ref.split(":");
    if (kind === "id") {
      linkedIds.add(value);
      if (!creators[value]) toResolve.set(ref, { kind, value });
    } else {
      toResolve.set(ref, { kind, value });
    }
  }

  const newlyResolved = {};
  const unresolved = [];
  for (const [, task] of toResolve) {
    const label = task.kind === "id" ? task.value : task.kind === "handle" ? "@" + task.value : task.value;
    console.log(`→ Resolving ${label} via channels.list (1 unit)...`);
    const result = await resolveRef(API_KEY, task.kind, task.value);

    if (!result) {
      console.warn(`  ⚠ Could not resolve ${label} — skipping (legacy vanity URLs don't always map cleanly).`);
      unresolved.push(label);
      continue;
    }
    newlyResolved[result.id] = result;
    if (task.kind === "handle" || task.kind === "username") linkedIds.add(result.id);
  }

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
