#!/usr/bin/env node
/**
 * crawl-rss.js
 *
 * Breadth-first crawl over the CURRENT creator list, using YouTube's free
 * per-channel RSS feed (no API key, no quota cost) to pull each creator's
 * most recent 15 videos, scanning descriptions for other channel mentions.
 *
 *   YOUTUBE_API_KEY=xxxx node scripts/crawl-rss.js
 *
 * Still needs a YOUTUBE_API_KEY — RSS itself is free, but resolving any
 * newly-found @handle/username/channel-ID references into full creator
 * records uses channels.list (1 unit each). At 1 unit/lookup this is cheap
 * even for hundreds of new creators.
 *
 * Algorithm:
 *   1. Queue = every creator currently in data/creators.json.
 *   2. For each creator, fetch their RSS feed (free) — up to 15 videos.
 *   3. For each video, extract channel references from its description.
 *      - If NONE found: skip the video entirely (don't add it).
 *      - If any found: add the video to videos.json with creatorIds =
 *        [poster, ...mentioned creators], and add any newly-mentioned
 *        creators to creators.json + the back of the queue.
 *   4. Stop when the queue is empty, OR total creators reaches MAX_CREATORS
 *      (500 by default) — whichever comes first.
 *
 * This does NOT commit or push anything. Review with `git diff data/`
 * before committing, and expect to spend real time reviewing a crawl this
 * size before treating it as trustworthy — this is a bulk discovery tool,
 * not a verified-data tool.
 */

const fs = require("fs");
const path = require("path");
const { extractChannelRefs, resolveRef } = require("./lib/youtube");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(__dirname, "..", "data");
const CREATORS_PATH = path.join(DATA_DIR, "creators.json");
const VIDEOS_PATH = path.join(DATA_DIR, "videos.json");

const MAX_CREATORS = 500;   // primary stop condition, per plan
const REQUEST_DELAY_MS = 300; // be polite to the unauthenticated RSS endpoint

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

if (!API_KEY) {
  fail("Missing YOUTUBE_API_KEY environment variable.\n  Usage: YOUTUBE_API_KEY=xxxx node scripts/crawl-rss.js");
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function saveJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Minimal, purpose-built parser for YouTube's channel RSS feed. Not a
 * general XML parser — just regexes the handful of fields we actually need.
 * Returns [] if the feed is empty, private, or the channel doesn't exist.
 */
function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.map((entry) => {
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = decodeEntities((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const description = decodeEntities(
      (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || ""
    );
    return { videoId, title, description };
  }).filter((e) => e.videoId);
}

async function fetchFeed(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url);
  if (!res.ok) return []; // private/deleted/never-existed channel — treat as a dead end, not a crash
  const xml = await res.text();
  return parseFeed(xml);
}

async function main() {
  const creators = loadJson(CREATORS_PATH);
  const videos = loadJson(VIDEOS_PATH);

  const startingIds = Object.keys(creators);
  if (startingIds.length === 0) {
    fail("data/creators.json is empty — seed at least one creator (e.g. via add-video.js) before crawling.");
  }

  const queue = [...startingIds];
  const visited = new Set(); // channels whose RSS feed we've already pulled
  let videosAdded = 0;
  let creatorsAdded = 0;

  console.log(`Starting crawl from ${startingIds.length} creator(s). Cap: ${MAX_CREATORS} total creators.\n`);

  while (queue.length > 0 && Object.keys(creators).length < MAX_CREATORS) {
    const channelId = queue.shift();
    if (visited.has(channelId)) continue;
    visited.add(channelId);

    const name = creators[channelId]?.name || channelId;
    console.log(`→ [${Object.keys(creators).length}/${MAX_CREATORS}] Crawling ${name}...`);

    let feedEntries;
    try {
      feedEntries = await fetchFeed(channelId);
    } catch (err) {
      console.warn(`  ⚠ Feed fetch failed for ${name}: ${err.message} — skipping.`);
      continue;
    }

    if (feedEntries.length === 0) {
      console.log(`  (no videos found — private, deleted, or empty channel)`);
    }

    for (const entry of feedEntries) {
      const refs = extractChannelRefs(entry.description);
      if (refs.length === 0) continue; // most videos — no mentions, skip entirely

      const mentionedIds = new Set();
      for (const ref of refs) {
        const [kind, value] = ref.split(":");

        if (kind === "id") {
          if (creators[value]) {
            mentionedIds.add(value);
            continue;
          }
        }

        // Need a lookup — either a brand-new ID, or a handle/username.
        const label = kind === "id" ? value : kind === "handle" ? "@" + value : value;
        console.log(`    → Resolving ${label} via channels.list (1 unit)...`);
        let result;
        try {
          result = await resolveRef(API_KEY, kind, value);
        } catch (err) {
          console.warn(`    ⚠ Resolution failed for ${label}: ${err.message}`);
          continue;
        }
        if (!result) {
          console.warn(`    ⚠ Could not resolve ${label} — skipping this mention.`);
          continue;
        }

        if (!creators[result.id]) {
          creators[result.id] = { name: result.name, handle: result.handle, avatar: result.avatar };
          creatorsAdded++;
          if (!visited.has(result.id)) queue.push(result.id);
        }
        mentionedIds.add(result.id);
      }

      if (mentionedIds.size === 0) continue; // everything failed to resolve — nothing usable

      const allCreatorIds = [channelId, ...mentionedIds].filter((id, i, arr) => arr.indexOf(id) === i);

      if (!videos[entry.videoId]) {
        videos[entry.videoId] = {
          url: `https://www.youtube.com/watch?v=${entry.videoId}`,
          title: entry.title,
          thumbnail: `https://img.youtube.com/vi/${entry.videoId}/hqdefault.jpg`,
          creatorIds: allCreatorIds,
        };
        videosAdded++;
        console.log(`    ✔ Added video "${entry.title}" (${allCreatorIds.length} creators)`);
      }
    }

    // Save incrementally after every creator, not just at the end — a long
    // crawl that gets interrupted shouldn't lose everything found so far.
    saveJson(CREATORS_PATH, creators);
    saveJson(VIDEOS_PATH, videos);

    await sleep(REQUEST_DELAY_MS);
  }

  const stopReason = queue.length === 0 ? "queue exhausted" : "hit MAX_CREATORS cap";
  console.log(`\n✔ Crawl finished (${stopReason}).`);
  console.log(`  Creators visited: ${visited.size}`);
  console.log(`  Creators added: ${creatorsAdded}`);
  console.log(`  Videos added: ${videosAdded}`);
  console.log(`  Total creators in database: ${Object.keys(creators).length}`);
  console.log(`\nReview with: git diff data/`);
}

main().catch((err) => fail(err.message));
