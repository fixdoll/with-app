#!/usr/bin/env node
/**
 * unprune.js
 *
 * Restore a wrongly-pruned creator: moves them out of
 * data/pruned-creators.json and back into data/creators.json, re-fetching
 * fresh name/avatar/handle via the API.
 *
 *   YOUTUBE_API_KEY=xxxx node scripts/unprune.js <channelId or name substring>
 *
 * Note: this restores the CREATOR, not any video connections that were
 * stripped when they were originally pruned — those are gone for good
 * unless rediscovered. Re-running crawl-rss.js after unpruning should pick
 * most of them back up naturally, now that the offending filter is off or
 * the person is no longer on the exclusion list.
 */

const fs = require("fs");
const path = require("path");
const { resolveChannelById } = require("./lib/youtube");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(__dirname, "..", "data");
const CREATORS_PATH = path.join(DATA_DIR, "creators.json");
const PRUNED_PATH = path.join(DATA_DIR, "pruned-creators.json");

function fail(msg) {
  console.error("✖ " + msg);
  process.exit(1);
}

if (!API_KEY) fail("Missing YOUTUBE_API_KEY environment variable.");

const query = process.argv[2];
if (!query) fail('Usage: node scripts/unprune.js "<channelId or name substring>"');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function saveJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const creators = loadJson(CREATORS_PATH);
  const pruned = loadJson(PRUNED_PATH);

  let matchId = pruned[query] ? query : null;
  if (!matchId) {
    const lower = query.toLowerCase();
    const matches = Object.entries(pruned).filter(([, info]) => info.name.toLowerCase().includes(lower));
    if (matches.length === 0) fail(`No pruned entry found matching "${query}".`);
    if (matches.length > 1) {
      console.log(`Multiple matches — re-run with the exact channel ID:`);
      matches.forEach(([id, info]) => console.log(`  ${id}  ${info.name}  (${info.reason})`));
      process.exit(1);
    }
    matchId = matches[0][0];
  }

  const prunedInfo = pruned[matchId];
  console.log(`Restoring ${prunedInfo.name} (${matchId})...`);
  console.log(`  Was pruned because: ${prunedInfo.reason}`);

  const fresh = await resolveChannelById(API_KEY, matchId);
  if (!fresh) fail(`Channel ${matchId} no longer resolves — can't restore.`);

  creators[matchId] = { name: fresh.name, handle: fresh.handle, avatar: fresh.avatar };
  delete pruned[matchId];

  saveJson(CREATORS_PATH, creators);
  saveJson(PRUNED_PATH, pruned);

  console.log(`✔ Restored ${fresh.name} to creators.json.`);
  console.log(`  Note: video connections stripped during pruning were NOT restored.`);
  console.log(`  Re-run crawl-rss.js to rediscover them.`);
}

main().catch((err) => fail(err.message));
