/**
 * submit-collab.js  (Cloudflare Worker)
 *
 * Receives a submission from the game's "submit a video" flow and opens a
 * GitHub Issue against the with-app repo, using the collab-submission.yml
 * template's fields. The GitHub token lives only here, as a Worker secret —
 * never in the browser.
 *
 * DEPLOY:
 *   1. Install wrangler:  npm install -g wrangler
 *   2. wrangler login
 *   3. From this folder:  wrangler deploy
 *   4. Set the secret:    wrangler secret put GITHUB_TOKEN
 *      (paste a fine-grained PAT scoped to Issues: write on this one repo only)
 *   5. Note the deployed URL (looks like https://submit-collab.YOUR_SUBDOMAIN.workers.dev)
 *      and put it in the game's SUBMIT_ENDPOINT constant.
 *
 * This Worker does NOT need any GitHub App or OAuth flow — a single
 * repo-scoped PAT is enough for a personal project like this.
 */

const GITHUB_REPO = "fixdoll/with-app"; // owner/repo — update if this ever changes

export default {
  async fetch(request, env) {
    // CORS: allow the game's own origin to call this. Update ALLOWED_ORIGIN
    // if you ever move off GitHub Pages or add a custom domain.
    const ALLOWED_ORIGIN = "https://fixdoll.github.io";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
    }

    const { videoUrl, creators, notes } = body;

    if (!videoUrl || typeof videoUrl !== "string" || !creators || typeof creators !== "string") {
      return new Response("Missing videoUrl or creators", { status: 400, headers: corsHeaders });
    }

    // Basic sanity check — don't accept obviously-not-a-YouTube-link submissions
    if (!/youtube\.com|youtu\.be/.test(videoUrl)) {
      return new Response("videoUrl doesn't look like a YouTube link", { status: 400, headers: corsHeaders });
    }

    const issueBody = [
      `**Video URL:** ${videoUrl}`,
      `**Creators:** ${creators}`,
      `**How was this submitted?:** In-game submission form`,
      `**Additional notes:** ${notes || "—"}`,
    ].join("\n");

    const githubRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "with-app-submission-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `[Collab] ${creators}`,
        body: issueBody,
        labels: ["collab-submission", "needs-review"],
      }),
    });

    if (!githubRes.ok) {
      const errText = await githubRes.text();
      console.error("GitHub API error:", githubRes.status, errText);
      return new Response("Failed to create issue", { status: 502, headers: corsHeaders });
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  },
};
