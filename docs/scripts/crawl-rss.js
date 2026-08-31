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
 *      - If the feed comes back empty (private/deleted/never posted), the
 *        creator is PRUNED: removed from creators.json, stripped from any
 *        video's creatorIds, and recorded in data/pruned-creators.json so
 *        future crawls skip them instantly instead of re-discovering and
 *        re-removing them every time they're mentioned again elsewhere.
 *   3. For each video, extract channel references from its description.
 *      - If NONE found: skip the video entirely.
 *      - Once total creators has reached MAX_CREATORS, the crawl keeps
 *        running but stops ADDING new creators: a mention that would
 *        introduce someone new is dropped, but the video still gets added
 *        if at least one mentioned creator is already known (poster +
 *        already-known others is a real, useful connection even after the
 *        cap). A video whose only mentions are brand-new people gets
 *        skipped entirely once capped.
 *   4. Stops only when the queue is fully empty — the cap no longer ends
 *      the crawl early, it just stops it from growing further.
 *
 * Re-running this script is safe and reasonably cheap: it re-fetches RSS
 * feeds for previously-visited creators (free) but skips any video already
 * in videos.json before doing any channel-resolution work.
 *
 * This does NOT commit or push anything. Review with `git diff data/`
 * before committing, and expect to spend real time reviewing a crawl this
 * size before treating it as trustworthy — this is a bulk discovery tool,
 * not a verified-data tool.
 */

const fs = require("fs");
const path = require("path");
const { extractChannelRefs, resolveRef, meetsSignalThreshold, MIN_SUBSCRIBERS, MIN_VIDEOS, ENABLE_SUBSCRIBER_FILTER, ENABLE_VIDEO_COUNT_FILTER } = require("./lib/youtube");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(__dirname, "..", "data");
const CREATORS_PATH = path.join(DATA_DIR, "creators.json");
const VIDEOS_PATH = path.join(DATA_DIR, "videos.json");
const BANNED_PATH = path.join(DATA_DIR, "banned-creators.json");
const PRUNED_PATH = path.join(DATA_DIR, "pruned-creators.json");

const MAX_CREATORS = 500; // stops new creators from being added past this point — does not stop the crawl itself
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

/**
 * Remove a creator entirely: from creators.json, from every video's
 * creatorIds, deleting any video that drops below 2 valid creators as a
 * result, and record them in the pruned list so they're never re-added.
 */
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
  const banned = loadJson(BANNED_PATH);
  const pruned = loadJson(PRUNED_PATH);

  const isExcluded = (id) => !!banned[id] || !!pruned[id];

  const startingIds = Object.keys(creators).filter((id) => !isExcluded(id));
  if (startingIds.length === 0) {
    fail("data/creators.json is empty (or everything in it is excluded) — seed at least one creator before crawling.");
  }

  const queue = [...startingIds];
  const visited = new Set(); // channels whose RSS feed we've already pulled
  let videosAdded = 0;
  let creatorsAdded = 0;
  let creatorsPruned = 0;

  console.log(`Starting crawl from ${startingIds.length} creator(s). New-creator cap: ${MAX_CREATORS}.\n`);

  while (queue.length > 0) {
    const channelId = queue.shift();
    if (visited.has(channelId)) continue;
    if (isExcluded(channelId)) continue; // shouldn't normally reach here, but stay safe
    visited.add(channelId);

    const atCap = Object.keys(creators).length >= MAX_CREATORS;
    const name = creators[channelId]?.name || channelId;
    console.log(`→ [${Object.keys(creators).length}/${MAX_CREATORS}${atCap ? ", capped" : ""}] Crawling ${name}...`);

    let feedEntries;
    try {
      feedEntries = await fetchFeed(channelId);
    } catch (err) {
      console.warn(`  ⚠ Feed fetch failed for ${name}: ${err.message} — skipping.`);
      continue;
    }

    if (feedEntries.length === 0) {
      const prunedName = pruneCreator(channelId, creators, videos, pruned, "no public videos found (private/deleted/empty)");
      creatorsPruned++;
      console.log(`  (no videos found — pruning ${prunedName}, unlikely to be recognizable in-game)`);
      saveJson(CREATORS_PATH, creators);
      saveJson(VIDEOS_PATH, videos);
      saveJson(PRUNED_PATH, pruned);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    for (const entry of feedEntries) {
      if (videos[entry.videoId]) continue; // already processed in a prior run — skip entirely, no re-resolving

      const refs = extractChannelRefs(entry.description);
      if (refs.length === 0) continue; // most videos — no mentions, skip entirely

      const mentionedIds = new Set();
      for (const ref of refs) {
        const [kind, value] = ref.split(":");
        const capped = Object.keys(creators).length >= MAX_CREATORS;

        if (kind === "id") {
          if (isExcluded(value)) continue;
          if (creators[value]) {
            mentionedIds.add(value); // already known — always fine, cap doesn't matter
            continue;
          }
          if (capped) continue; // would be a brand-new creator — skip without even spending a lookup
        }

        // Either a brand-new id (not capped), or a handle/username (whose
        // real identity we don't know yet — could turn out to be someone
        // already known under a different URL, so it's always worth the
        // 1-unit lookup regardless of cap state).
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
        if (isExcluded(result.id)) {
          console.log(`    (skipping ${result.name} — excluded)`);
          continue;
        }

        if (creators[result.id]) {
          mentionedIds.add(result.id); // turned out to already be known — include regardless of cap
          continue;
        }
        if (capped) {
          console.log(`    (found new creator ${result.name}, but at cap — not adding)`);
          continue;
        }
        if (!meetsSignalThreshold(result)) {
          const subsBad = ENABLE_SUBSCRIBER_FILTER && result.subscriberCount !== null && !Number.isNaN(result.subscriberCount) && result.subscriberCount < MIN_SUBSCRIBERS;
          const videosBad = ENABLE_VIDEO_COUNT_FILTER && !Number.isNaN(result.videoCount) && result.videoCount < MIN_VIDEOS;
          const causes = [subsBad && "low subscribers", videosBad && "low video count"].filter(Boolean).join(" + ");
          pruned[result.id] = {
            name: result.name,
            reason: `${causes} (${result.subscriberCount ?? "hidden"} subscribers, ${result.videoCount} videos) — likely a second channel or featured-artist credit`,
          };
          creatorsPruned++;
          console.log(`    (skipping ${result.name} — ${causes})`);
          continue;
        }

        creators[result.id] = { name: result.name, handle: result.handle, avatar: result.avatar };
        creatorsAdded++;
        if (!visited.has(result.id)) queue.push(result.id);
        mentionedIds.add(result.id);
      }

      if (mentionedIds.size === 0) continue; // nothing usable — either no valid mentions, or all were new-and-capped

      const allCreatorIds = [channelId, ...mentionedIds].filter((id, i, arr) => arr.indexOf(id) === i);

      videos[entry.videoId] = {
        url: `https://www.youtube.com/watch?v=${entry.videoId}`,
        title: entry.title,
        thumbnail: `https://img.youtube.com/vi/${entry.videoId}/hqdefault.jpg`,
        creatorIds: allCreatorIds,
      };
      videosAdded++;
      console.log(`    ✔ Added video "${entry.title}" (${allCreatorIds.length} creators)`);
    }

    // Save incrementally after every creator, not just at the end — a long
    // crawl that gets interrupted shouldn't lose everything found so far.
    saveJson(CREATORS_PATH, creators);
    saveJson(VIDEOS_PATH, videos);
    saveJson(PRUNED_PATH, pruned);

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n✔ Crawl finished (queue exhausted).`);
  console.log(`  Creators visited: ${visited.size}`);
  console.log(`  Creators added: ${creatorsAdded}`);
  console.log(`  Creators pruned (no public videos): ${creatorsPruned}`);
  console.log(`  Videos added: ${videosAdded}`);
  console.log(`  Total creators in database: ${Object.keys(creators).length}`);
  console.log(`\nReview with: git diff data/`);
}

main().catch((err) => fail(err.message));
