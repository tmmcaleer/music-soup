# Running copy vs. main: identity hardening convergence (2026-10-16)

Two code lines of Music Soup existed on 2026-10-16:

| | `main` (fc1c334) | running copy (`running-copy-2026-10-16`) |
|---|---|---|
| Where | GitHub `main`; byte-identical copies of the imported files in the workspace checkout on the sync host (`~/Documents/Github/music-soup-server`) | `~/music-soup-server` on the sync host, the tree `com.music-soup.scheduled-sync` runs at 09/13/18 via `npm run sync:scheduled` |
| Base commit | `fbabb02` (September hardening imported) + `a0cced7` (fix 5) | `dfd1907` + uncommitted refactor, snapshotted verbatim in this branch |
| Matching | ordered lookups: `TrackIdentityIndex.find` (platform ID, ISRC, title/artist) and `findTrackByIdentity` (platform ID query, ISRC query, URL query, title query) | one pure decision, `decideTrackMatch` in `utils/trackMatchDecision.js`, used by both the in-memory index and the live pre-create lookup over a full validated snapshot |
| Removal | `cleanupRemovedTracks` sets the legacy `Removed` checkbox when a page is not in any current playlist | `cleanupRemovedTracks` never writes `Removed` (`markTrackRemoved` throws); it reports per-page membership state and, when `NOTION_MEMBERSHIP_DB_ID` is set, records per-playlist memberships in a separate database |

## What main's hardening the running copy already has

| File on main | Running copy |
|---|---|
| `utils/notionRetry.js` | identical blob |
| `utils/syncLock.js` | identical blob |
| `utils/trackIdentity.js` normalizers (`normalizeIsrc`, `normalizeService`, `normalizePlatformTrackId`, `buildPlatformTrackId`, `identityFromNotionPage`, ...) | same code. Differences: `extractPlatformTrackId` only accepts a numeric Apple `?i=` and only `/song/<slug>/<id>` paths (main also accepts `/album/<slug>/<id>`); `TrackIdentityIndex` keeps raw records and delegates to `decideTrackMatch` instead of three maps |
| `schema.js` `Platform Track ID` field | present. Extra: `formatDuration` keeps milliseconds (`M:SS.mmm`) because the matcher compares durations |
| `notionClient.js` `queryAllDatabase` with pagination guards, `withNotionRetry` on every call | present, plus `validateInventoryPage` (rejects partial pages) and `assertWriteAllowed` (shadow mode guard) |
| `syncOrchestrator.js` run-scoped snapshot, fatal `NotionOperationError` propagation, playlist-complete gate | present, plus shadow mode, proposals (`review_identity`, `review_reactivation`, `create`), membership planning |
| `sync.js` sync lock | present, plus `--shadow` |
| jest suites `tests/track-identity.test.js`, `tests/sync-deduplication.test.js`, `tests/notion-retry.test.js` | absent before this branch; this branch adds `tests/track-match-decision.test.js` and `tests/membership-removal-identity.test.js` |

Files only in the running copy: `utils/trackMatchDecision.js`, `utils/mutationGuard.js`,
`utils/playlistMemberships.js`, `membershipStore.js`, `scripts/initialize-memberships.js`,
`scripts/find-duplicates.js`, `scripts/scheduled-sync.js`, `utils/scheduledSyncComment.js`,
`deployment/com.music-soup.scheduled-sync.plist`, `docs/local-cron-sync.md`.

## Where identity lookups happen in the running copy

- `utils/trackMatchDecision.js` `decideTrackMatch(trackData, records)`: the only matching
  logic. `trackFacts` normalizes a provider track or a Notion page; `compareCandidate`
  lists conflict reasons; the decision is `new`, `match` or `review`.
- `utils/trackIdentity.js` `TrackIdentityIndex.decide/find`: the in-memory snapshot index
  for one run; `find` throws `TrackIdentityReviewError` on `review`.
- `notionClient.js` `findTrackByIdentity`: the live pre-create lookup; re-reads the whole
  database and runs the same `decideTrackMatch`.
- `syncOrchestrator.js` `cleanupRemovedTracks`: runs `identityIndex.decide` for every
  current playlist track and records membership only on `match`.
- `utils/playlistMemberships.js` / `membershipStore.js`: membership rows are keyed by
  `(service, playlistId, sourceId)`, i.e. by provider track ID only. ISRC, title and
  artist play no part in membership presence or removal there.

## Fix 5 ported (this branch)

Main's fix 5 (`a0cced7`) reorders lookups so the platform track ID is checked before
ISRC and removes the title/artist fallback from removal detection. In the running copy:

- `decideTrackMatch` now splits candidates into tiers. Pages carrying the incoming
  platform track ID are decided on their own; pages sharing only the ISRC or the title
  are consulted only when no page carries that platform ID. Before this change an exact
  provider match was reported as `review: multiple_candidates` whenever another page
  shared its ISRC (the "one ISRC, two catalogue entries" case), so the track was never
  recorded as present. The decision now also reports `identityTier`
  (`platform_track_id` or `isrc_or_title`). Both the index and the live lookup go
  through this function, so one change covers both.
- ISRC stays a cross-service hint: an Apple Music track with no Apple page but a
  Spotify page with the same ISRC and agreeing metadata still matches
  (`corroborated_cross_provider_candidate`). A same-service page that shares only the
  ISRC is still `review` (`unverified_source_alias`), not a merge and not `new`.
- Removal detection already treated a page as present only by platform ID or ISRC:
  `compareCandidate` requires an exact platform ID or a shared ISRC for `match`, so
  title/artist alone always yields `review` and never records membership. This is now
  pinned by `tests/membership-removal-identity.test.js`. Unlike main, the running copy
  never writes the legacy `Removed` flag; absence is reported as
  `not_confirmed_in_monitored_playlists`.
- Metadata still has to agree on an exact platform ID match (title, artist, album,
  track number, duration within tolerance). A conflicting ISRC on the same platform ID
  is `review: isrc_conflict`. This is stricter than main and deliberately kept.

## How the two lines converge

1. Merge this branch into `main`. `main` then equals the running copy plus the ported
   fix and tests. Of main's three imported suites, `tests/notion-retry.test.js` is kept
   (`utils/notionRetry.js` is identical); `tests/track-identity.test.js` and
   `tests/sync-deduplication.test.js` are dropped because they test the replaced
   `TrackIdentityIndex` maps and the legacy `Removed` write path. Main's docs commits
   (`docs/local-webhook-cutover.md`, `docs/server-agent-handoff-prompt.md`, the
   local-webhook plist) and the `.music-soup-sync.lock` ignore entry are carried.
2. Cut `~/music-soup-server` over to the merged `main` (fast-forward; its working tree is
   byte-identical to the snapshot commit, so nothing is lost).
3. Fast-forward the workspace share `~/Documents/Github/music-soup-server` to the same
   commit; its uncommitted non-source files (scheduled-sync, soup-web, audit scripts,
   plists, docs, config/env/package changes) are unaffected by the source files.
4. Follow-ups, not in this branch: `extractPlatformTrackId` album-URL acceptance from
   main if Apple album links appear in the database; whether to stop tracking
   `node_modules/` and the Apple key in git.
