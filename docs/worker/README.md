# /worker

A single Cloudflare Worker that turns an in-game "submit a video" into a
GitHub Issue. This exists purely to keep a GitHub token off the client —
the game itself never touches it.

## Why this is needed at all

The game runs as static HTML/JS with no backend. A GitHub personal access
token pasted into client-side code would be visible to anyone who opens
dev tools. This Worker is the smallest possible thing that can hold a
secret safely: one function, no server to maintain, free at this scale
(Cloudflare's free tier is 100,000 requests/day).

## Setup

1. **Create a fine-grained GitHub PAT**, scoped to:
   - Repository access: only `with-app`
   - Permissions: **Issues: Read and write** — nothing else
2. Install wrangler and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. From this folder, deploy:
   ```
   wrangler deploy
   ```
4. Set the token as a secret (never goes in any committed file):
   ```
   wrangler secret put GITHUB_TOKEN
   ```
   (paste the PAT when prompted)
5. Wrangler prints the deployed URL, something like:
   ```
   https://submit-collab.YOUR_SUBDOMAIN.workers.dev
   ```
   Put that in the game's `SUBMIT_ENDPOINT` constant (see index.html).

## What it does

- Accepts `POST { videoUrl, creators, notes }` from the game.
- Validates the input minimally (both fields present, videoUrl looks like
  a YouTube link).
- Opens a GitHub Issue on `with-app` using the same fields as
  `.github/ISSUE_TEMPLATE/collab-submission.yml`, labeled
  `collab-submission` + `needs-review`.
- CORS-restricted to the GitHub Pages origin — update `ALLOWED_ORIGIN` in
  `submit-collab.js` if the game ever moves domains.

## What it deliberately does NOT do

- Doesn't write directly to `data/videos.json` or `data/creators.json` —
  submissions still go through manual review via the Issue queue, same as
  every other data source in this project.
- Doesn't require the player to have a GitHub account or log in anywhere.
- Doesn't block the game if it fails — see the "provisional accept"
  behavior in index.html: the player's hop counts locally regardless of
  whether the Issue creation succeeds, since submission delivery is a
  background concern, not part of the gameplay loop.
