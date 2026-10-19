# Local Webhook Cutover

This document is the Phase 1 handoff for moving **Notion-triggered** syncs off Fly.io and onto the local machine at `/Volumes/music-soup-server`.

Phase 1 scope is intentionally narrow:

- Notion webhook traffic moves to the local machine.
- GitHub Actions manual `Run workflow` remains the fallback and manual path.
- Fly.io stays available until the local path is validated end to end.

## Target State

- Repo location: `/Volumes/music-soup-server`
- Runtime: plain Node.js on macOS
- Public ingress: `ngrok http <WEBHOOK_PORT>`
- Local webhook server: `npm run webhook:local`
- Local webhook endpoint: `http://127.0.0.1:<WEBHOOK_PORT>/notion-webhook`
- Local health endpoint: `http://127.0.0.1:<WEBHOOK_PORT>/health`

## 1. Replace The Old Shim With The Real Repo

Current observed state on the target machine:

- `/Volumes/music-soup-server` exists
- it contains the old standalone `webhook-server.js` shim
- its `.env` only covers the old GitHub-dispatch path
- on the mounted copy inspected during planning, it was an unconnected `git init`, not a usable clone of this repo

Before deleting anything, inspect whether the remote machine has accidentally wired this folder to some other repository:

```bash
cd /Volumes/music-soup-server
git status --short --branch || true
git remote -v || true
git log --oneline -5 || true
```

If `git remote -v` shows any remote, or `git log` shows commits that do not belong to `tmmcaleer/music-soup`, record that output and then remove the old `.git` directory during replacement. This folder must end up as a clone of the real `music-soup` repository, not a separate repo.

Back up the old shim `.env` before replacing the folder contents:

```bash
cp /Volumes/music-soup-server/.env "$HOME/music-soup-server-shim.env.backup"
```

Clear the old shim contents:

```bash
cd /Volumes/music-soup-server
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
```

Clone the real repo into the now-empty folder:

```bash
cd /Volumes/music-soup-server
git clone git@github.com:tmmcaleer/music-soup.git .
```

If the folder has already been converted into a real clone, use:

```bash
cd /Volumes/music-soup-server
git pull --ff-only
```

Install dependencies:

```bash
cd /Volumes/music-soup-server
npm ci
```

## 2. Build The Local `.env`

Use the current GitHub repository secrets as the source of truth and mirror them into `/Volumes/music-soup-server/.env`.

Start from `env.example`:

```bash
cd /Volumes/music-soup-server
cp env.example .env
```

Do not reuse the old shim `.env` as-is. It only contains:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `WEBHOOK_PORT`
- `WEBHOOK_SECRET`

It does not contain the Notion, Spotify, or Apple Music credentials required for direct local sync.

Fill in the existing sync values from GitHub Secrets:

- `NOTION_KEY`
- `NOTION_DB_ID`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`
- `SPOTIFY_SOURCE_PLAYLIST_ID`
- `SPOTIFY_TEMP_PLAYLIST_ID`
- `APPLE_MUSIC_TEAM_ID`
- `APPLE_MUSIC_KEY_ID`
- `APPLE_MUSIC_PRIVATE_KEY`
- `APPLE_MUSIC_USER_TOKEN`
- `APPLE_MUSIC_STOREFRONT`
- `APPLE_MUSIC_SOURCE_PLAYLIST_ID`
- `APPLE_MUSIC_TEMP_PLAYLIST_ID`
- `SYNC_INTERVAL_MINUTES`
- `LOG_LEVEL`
- `DRY_RUN`
- `REMOVED_FLAG_POLICY` (optional, `ignore` by default)

Add the local webhook values:

- `WEBHOOK_PORT=3000`
- `WEBHOOK_SECRET=<random shared secret>`

Use a high-entropy `WEBHOOK_SECRET`. The same value must be configured as the `x-webhook-secret` header in Notion.

## 3. Validate API Credentials Before Cutover

Run the existing integration test script with the real `.env`:

```bash
cd /Volumes/music-soup-server
node tests/integration-test.js
```

Do not continue until Spotify, Notion, and any enabled Apple Music playlist access checks pass.

## 4. Start The Local Webhook Server

First run it in the foreground:

```bash
cd /Volumes/music-soup-server
npm run webhook:local
```

Expected startup log includes:

- `Local Notion webhook server started`
- `webhookUrl: http://127.0.0.1:3000/notion-webhook`
- `healthUrl: http://127.0.0.1:3000/health`

## 5. Validate The Local Endpoints Before Touching Notion

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Expected shape:

```json
{
  "status": "ok",
  "syncRunning": false,
  "pendingSync": false,
  "lastStartedAt": null,
  "lastFinishedAt": null,
  "lastResult": null
}
```

Signed webhook test:

```bash
curl -i -X POST http://127.0.0.1:3000/notion-webhook \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-secret: REPLACE_WITH_WEBHOOK_SECRET' \
  -d '{"source":"manual-validation"}'
```

Expected response:

- HTTP `202`
- JSON with `"status": "accepted"`

Invalid secret test:

```bash
curl -i -X POST http://127.0.0.1:3000/notion-webhook \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-secret: wrong-secret' \
  -d '{"source":"manual-validation"}'
```

Expected response:

- HTTP `401`
- JSON with `"message": "Invalid webhook secret"`

After the valid signed POST, inspect health again:

```bash
curl http://127.0.0.1:3000/health
```

Confirm all of the following:

- `syncRunning` flips to `true` during execution
- `lastStartedAt` is populated
- `lastFinishedAt` is populated when the run completes
- `lastResult` contains the latest status and summary

## 6. Verify Single-Flight Behavior

While one sync is already running, send two more signed webhook requests quickly:

```bash
curl -X POST http://127.0.0.1:3000/notion-webhook \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-secret: REPLACE_WITH_WEBHOOK_SECRET' \
  -d '{"source":"queue-test-1"}'

curl -X POST http://127.0.0.1:3000/notion-webhook \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-secret: REPLACE_WITH_WEBHOOK_SECRET' \
  -d '{"source":"queue-test-2"}'
```

Expected behavior:

- The first request during an active run returns `"mode": "queued"`
- Additional requests during that same run return `"mode": "coalesced"`
- Only one active sync runs at a time
- At most one follow-up sync is queued

## 7. Put The Server Under `launchd`

Copy the committed template into your LaunchAgents directory:

```bash
mkdir -p ~/Library/LaunchAgents
cp /Volumes/music-soup-server/deployment/com.music-soup.local-webhook.plist \
  ~/Library/LaunchAgents/com.music-soup.local-webhook.plist
```

```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.music-soup.local-webhook.plist
launchctl kickstart -k "gui/$(id -u)/com.music-soup.local-webhook"
```

Check status:

```bash
launchctl print "gui/$(id -u)/com.music-soup.local-webhook"
```

Logs:

- Standard output: `/Volumes/music-soup-server/local-webhook.stdout.log`
- Standard error: `/Volumes/music-soup-server/local-webhook.stderr.log`

To stop it later:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.music-soup.local-webhook.plist
```

## 8. Expose The Local Service With ngrok

Start the tunnel from the target machine:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding URL and append `/notion-webhook`.

Example:

```text
https://example.ngrok-free.app/notion-webhook
```

Important:

- Free ngrok URLs can change after restart.
- If the ngrok URL changes, update the Notion automation URL before resuming traffic.
- Do not disable the Fly.io URL until the ngrok-backed local path has succeeded with a real webhook.

## 9. Cut Over The Notion Automation

In Notion, update the existing automation or button that currently targets Fly.io.

Change:

- Old URL: `https://<fly-app>.fly.dev/notion-webhook`

To:

- New URL: `https://<ngrok-url>/notion-webhook`

Keep the custom header:

- Header name: `x-webhook-secret`
- Header value: the exact `WEBHOOK_SECRET` from `.env`

Do not change the GitHub manual workflow. That remains the fallback.

## 10. Validate The Real End-To-End Flow

After updating the Notion automation URL:

1. Trigger the Notion sync button or automation once.
2. Confirm the ngrok request appears in the ngrok inspector or terminal output.
3. Confirm the local server logs `Received local webhook request`.
4. Confirm the local server logs either `Local sync run completed` or a concrete failure message.
5. Confirm `/health` shows a populated `lastResult`.
6. Confirm the expected Notion sync result occurred.

GitHub fallback validation:

1. Go to GitHub Actions.
2. Open `Music Soup Sync`.
3. Run the workflow manually from the UI.
4. Confirm the existing GitHub-hosted sync still succeeds.

## Rollback

If local cutover fails:

1. In Notion, restore the webhook URL back to the Fly.io endpoint.
2. Stop the local service:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.music-soup.local-webhook.plist
```

3. Stop the foreground server if it is still running.
4. Stop the ngrok tunnel.
5. Leave GitHub manual sync available while debugging the local machine.

Rollback is complete when Notion points back to Fly.io and no traffic is expected to hit the local webhook.

## Post-Cutover Cleanup

Once the local path has succeeded and you are comfortable leaving Fly.io behind:

1. Keep `.github/workflows/sync-music.yml` enabled because it is still the manual fallback.
2. Disable the `Fly Deploy` workflow in GitHub Actions or remove `.github/workflows/fly-deploy.yml` in a later repo change.
3. Stop routing Notion traffic to the old Fly.io webhook endpoint.
4. Scale the Fly app to zero or remove it only after the ngrok-backed local path has been stable for a while.
