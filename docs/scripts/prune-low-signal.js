#!/usr/bin/env node
/**
 * prune-low-signal.js
 *
 * Retroactive cleanup: scans every creator ALREADY in data/creators.json
 * against the same subscriber/video-count thresholds crawl-rss.js now
 * applies going forward, and prunes anyone who falls short — second
 * channels, featured-artist credits, near-empty channels, etc. that got
 * added before this filter existed.
 *
 *   YOUTUBE_API_KEY=xxxx node scripts/prune-low-signal.js
 *
 * Uses the same pruneCreator() behavior as crawl-rss.js: removes the
 * creator from creators.json, strips them from every video's creatorIds
 * (deleting the video if that drops it below 2 valid creators), and
 * records them in data/pruned-creators.json so future crawls never
 * re-add them.
 *
 * Costs 1 quota unit per existing creator (a channels.list call to fetch
 * current stats) — for a database of a few hundred creators this is
 * trivial against the 10,000/day budget.
 *
 * This does NOT commit or push anything. Review with `git diff data/`
 * before committing — a first run against a database that predates this
 * filter could prune a meaningful chunk of it, so worth skimming the diff
 * rather than blindly trusting it.
 */

const fs = require("fs");
const path = require("path");
const { resolveChannelById, meetsSignalThreshold, MIN_SUBSCRIBERS, MIN_VIDEOS, ENABLE_SUBSCRIBER_FILTER, ENABLE_VIDEO_COUNT_FILTER } = require("./lib/youtube");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(__dirname, "..", "data");
const CREATORS_PATH = path.join(DATA_DIR, "creators.json");
const VIDEOS_PATH = path.join(DATA_DIR, "videos.json");
const PRUNED_PATH = path.join(DATA_DIR, "pruned-creators.json");

// Threshold constants and meetsSignalThreshold now live in lib/youtube.js —
// single source of truth shared with crawl-rss.js.
const REQUEST_DELAY_MS = 300;

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

if (!API_KEY) {
  fail("Missing YOUTUBE_API_KEY environment variable.\n  Usage: YOUTUBE_API_KEY=xxxx node scripts/prune-low-signal.js");
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

function pruneCreator(channelId, creators, videos, pruned, reason) {
  const name = creators[channelId]?.name || channelId;
  pruned[channelId] = { name, reason };
  delete creators[channelId];

  for (const videoId of Object.keys(videos)) {
    const v = videos[videoId];
    if (!v.creatorIds.includes(channelId)) continue;
    v.creatorIds = v.creatorIds.filter((id) => id !== channelId);
    if (v.creatorIds.length < 2) delete videos[videoId];
  }

  return name;
}

async function main() {
  const creators = loadJson(CREATORS_PATH);
  const videos = loadJson(VIDEOS_PATH);
  const pruned = loadJson(PRUNED_PATH);

  const ids = Object.keys(creators);
  if (ids.length === 0) fail("data/creators.json is empty — nothing to check.");

  console.log(`Checking ${ids.length} existing creator(s) against thresholds (${MIN_SUBSCRIBERS}+ subs, ${MIN_VIDEOS}+ videos)...\n`);

  let checked = 0;
  let prunedCount = 0;

  for (const id of ids) {
    checked++;
    const name = creators[id].name;
    let stats;
    try {
      stats = await resolveChannelById(API_KEY, id);
    } catch (err) {
      console.warn(`  ⚠ [${checked}/${ids.length}] Lookup failed for ${name}: ${err.message} — leaving as-is.`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!stats) {
      console.warn(`  ⚠ [${checked}/${ids.length}] ${name} no longer resolves (deleted/renamed?) — leaving as-is, check manually.`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    if (!meetsSignalThreshold(stats)) {
      const subsBad = ENABLE_SUBSCRIBER_FILTER && stats.subscriberCount !== null && !Number.isNaN(stats.subscriberCount) && stats.subscriberCount < MIN_SUBSCRIBERS;
      const videosBad = ENABLE_VIDEO_COUNT_FILTER && !Number.isNaN(stats.videoCount) && stats.videoCount < MIN_VIDEOS;
      const causes = [subsBad && "low subscribers", videosBad && "low video count"].filter(Boolean).join(" + ");
      pruneCreator(
        id,
        creators,
        videos,
        pruned,
        `${causes} (${stats.subscriberCount ?? "hidden"} subscribers, ${stats.videoCount} videos) — likely a second channel or featured-artist credit`
      );
      prunedCount++;
      console.log(`  ✂ [${checked}/${ids.length}] Pruned ${name} — ${causes} (${stats.subscriberCount ?? "hidden"} subs, ${stats.videoCount} videos)`);
    } else {
      console.log(`  ✔ [${checked}/${ids.length}] ${name} OK (${stats.subscriberCount ?? "hidden"} subs, ${stats.videoCount} videos)`);
    }

    // Save incrementally, same pattern as the other scripts.
    saveJson(CREATORS_PATH, creators);
    saveJson(VIDEOS_PATH, videos);
    saveJson(PRUNED_PATH, pruned);

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n✔ Done. Checked ${checked}, pruned ${prunedCount}.`);
  console.log(`Review with: git diff data/`);
}

main().catch((err) => fail(err.message));
