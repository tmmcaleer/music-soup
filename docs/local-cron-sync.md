# Local Scheduled Sync

Music Soup runs on the local Mac at `/Users/admin/music-soup-server` three times per day. Each run performs a full playlist sync into Notion. When new tracks are added, a comment is posted on the Music hub page.

## Schedule

- 9:00 AM local time
- 1:00 PM local time
- 6:00 PM local time

The launchd job uses the Mac system timezone. Set the host to `America/New_York` so these times match Eastern Time.

Equivalent cron expression: `0 9,13,18 * * *`

## Runtime layout

| Path | Purpose |
|------|---------|
| `/Users/admin/music-soup-server` | launchd runtime clone |
| `/Users/admin/Documents/Github/music-soup-server` | dev/workspace clone |
| `/Users/admin/bin/start-music-soup-scheduled-sync.sh` | launchd entry script |

When you change secrets, copy `.env` to both runtime and workspace clones.

## Required environment variables

Add to `.env`:

```bash
NOTION_REPORT_PAGE_ID=27055135-bed9-8089-928a-f94b13b4e557
SYNC_TIMEZONE=America/New_York
```

Existing sync credentials (`NOTION_KEY`, `NOTION_DB_ID`, Spotify, Apple Music) remain required.

## Notion setup

1. Open the [Music hub page](https://app.notion.com/p/ffbk/Music-27055135bed98089928af94b13b4e557).
2. Share the page with the Music Soup Notion integration.
3. Ensure the integration can insert comments.

Comments are posted only when `added > 0` during a scheduled run.

## Install launchd job

```bash
cp /Users/admin/music-soup-server/deployment/com.music-soup.scheduled-sync.plist \
  ~/Library/LaunchAgents/com.music-soup.scheduled-sync.plist

launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.music-soup.scheduled-sync.plist
launchctl print "gui/$(id -u)/com.music-soup.scheduled-sync"
```

## Manual validation

```bash
cd /Users/admin/music-soup-server
npm run sync:scheduled
```

Expected behavior:

- Sync completes successfully
- If no new tracks were added: logs `no new tracks; skipping Notion comment`
- If new tracks were added: a comment appears on the Music hub page

Logs:

- `/Users/admin/music-soup-server/scheduled-sync.stdout.log`
- `/Users/admin/music-soup-server/scheduled-sync.stderr.log`

## Decommission checklist

After the local scheduled path is validated:

| Component | Action |
|-----------|--------|
| `com.music-soup.local-webhook` launchd job | `launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.music-soup.local-webhook.plist` |
| ngrok | Stop any tunnel |
| Notion webhook automation | Disable the button/automation pointing at Fly.io or ngrok |
| `.github/workflows/sync-music.yml` | Deprecated; manual dispatch only |
| `.github/workflows/fly-deploy.yml` | Disabled |
| Fly.io app `music-soup-webhook-tim-still-frost-1777` | Scale to 0 or destroy when rollback is no longer needed |

## Deprecated paths

These remain in the repo for reference but are no longer the primary runtime:

- `webhook-server.js` (GitHub Actions dispatch shim)
- `local-webhook-server.js` (Phase 1 local webhook server)
- `docs/local-webhook-cutover.md`
