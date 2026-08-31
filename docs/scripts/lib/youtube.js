/**
 * lib/youtube.js
 *
 * Shared helpers for anything that needs to find or resolve YouTube channel
 * references. Used by both add-video.js and crawl-rss.js — keep fixes here,
 * not duplicated in each script.
 */

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

/**
 * Extract every channel reference from a block of text (typically a video
 * description). Returns an array of "kind:value" strings — kind is one of
 * "id" (a real UC... channel ID), "handle" (@name), or "username" (legacy
 * /user/NAME or bare vanity /NAME links).
 */
function extractChannelRefs(text) {
  if (!text) return [];
  const refs = new Set();

  const idPattern = /channel\/(UC[\w-]{10,})/g;
  const handlePattern = /youtube\.com\/@([\w.-]+)/g;
  const userPattern = /youtube\.com\/user\/([\w-]+)/g;

  // IMPORTANT: the \b must wrap the WHOLE alternation group, not just the
  // last entry — otherwise short reserved entries like "v" or "c" wrongly
  // block any name that merely *starts* with that letter (e.g. "vsauce",
  // "commentiquette"). This bit us once already; don't regress it.
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

async function resolveChannelById(apiKey, channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`;
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
    subscriberCount: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? NaN),
    videoCount: Number(item.statistics?.videoCount ?? NaN),
  };
}

async function resolveChannelByHandle(apiKey, handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${handle}&key=${apiKey}`;
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
    subscriberCount: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? NaN),
    videoCount: Number(item.statistics?.videoCount ?? NaN),
  };
}

async function resolveChannelByUsername(apiKey, username) {
  // Legacy parameter. Covers /user/NAME and old bare vanity URLs. Not every
  // legacy vanity URL is backed by a real "username" in the API's sense —
  // this can legitimately come back empty even for a real, active channel.
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forUsername=${username}&key=${apiKey}`;
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
    subscriberCount: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? NaN),
    videoCount: Number(item.statistics?.videoCount ?? NaN),
  };
}

/**
 * Resolve a single "kind:value" ref (as produced by extractChannelRefs) to
 * a full { id, name, handle, avatar } record, or null if it can't be
 * resolved. Costs 1 quota unit per call (0 if kind is "id" and the ID is
 * already known, since the caller should skip those before calling this).
 */
async function resolveRef(apiKey, kind, value) {
  if (kind === "id") return resolveChannelById(apiKey, value);
  if (kind === "handle") return resolveChannelByHandle(apiKey, value);
  if (kind === "username") return resolveChannelByUsername(apiKey, value);
  throw new Error("Unknown ref kind: " + kind);
}

module.exports = {
  RESERVED_PATHS,
  extractChannelRefs,
  resolveChannelById,
  resolveChannelByHandle,
  resolveChannelByUsername,
  resolveRef,
};
