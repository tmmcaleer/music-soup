/**
 * Removal detection identity in the membership-based cleanup.
 *
 * In this code line cleanupRemovedTracks never writes the legacy Removed flag;
 * it reports per-page membership state. A page counts as present only through
 * the matcher: by platform track ID, or by ISRC as a cross-service hint.
 * Title and artist alone never make a page present.
 *
 * The legacy Removed checkbox is read-only and, by default, does not change
 * the outcome of a match (REMOVED_FLAG_POLICY=ignore).
 */
const mockConfig = {
  notion: { apiKey: 'test-key', databaseId: 'music-db', membershipDatabaseId: '' },
  config: { dryRun: false, logLevel: 'error', removedFlagPolicy: 'ignore' },
  getAllConfiguredPlaylists: jest.fn(),
};
const mockSpotifyClient = { checkServiceHealth: jest.fn(), getPlaylist: jest.fn(), getPlaylistTracks: jest.fn() };
const mockAppleMusicClient = { checkServiceHealth: jest.fn(), getPlaylist: jest.fn(), getPlaylistTracks: jest.fn() };
const mockNotionClient = {
  queryAllDatabase: jest.fn(), findTrackByIdentity: jest.fn(), createTrack: jest.fn(), markTrackRemoved: jest.fn(),
};
const mockMembershipStore = { readState: jest.fn(), commitPlan: jest.fn() };

jest.mock('../config', () => mockConfig);
jest.mock('../spotifyClient', () => mockSpotifyClient);
jest.mock('../appleMusicClient', () => mockAppleMusicClient);
jest.mock('../notionClient', () => mockNotionClient);
jest.mock('../membershipStore', () => mockMembershipStore);
jest.mock('../utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));

const { createSyncContext, syncAllPlaylists, cleanupRemovedTracks } = require('../syncOrchestrator');
const { notionPage, spotifyTrack } = require('./fixtures/musicPages');

const present = spotifyTrack({ sourceId: 'presentid', isrc: 'USPRESENT0001' });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.config.removedFlagPolicy = 'ignore';
  mockConfig.getAllConfiguredPlaylists.mockReturnValue([
    { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
  ]);
  mockSpotifyClient.checkServiceHealth.mockResolvedValue(true);
  mockSpotifyClient.getPlaylist.mockImplementation(async id => ({ id, name: `Spotify ${id}`, trackCount: 1 }));
  mockSpotifyClient.getPlaylistTracks.mockResolvedValue([present]);
  mockAppleMusicClient.checkServiceHealth.mockResolvedValue(true);
  mockNotionClient.findTrackByIdentity.mockResolvedValue(null);
  mockNotionClient.createTrack.mockImplementation(async track => notionPage({
    id: `created-${track.sourceId}`, isrc: track.isrc,
    platformTrackId: `spotify:${track.sourceId}`, url: track.url,
  }));
  mockMembershipStore.readState.mockResolvedValue(null);
});

async function runCleanup(pages) {
  mockNotionClient.queryAllDatabase.mockResolvedValue(pages);
  const context = await createSyncContext();
  const summary = await syncAllPlaylists(context);
  const cleanup = await cleanupRemovedTracks(context);
  const state = Object.fromEntries(cleanup.observations.map(o => [o.pageId, o.state]));
  return { summary, cleanup, state, context };
}

describe('removal detection identity', () => {
  test('a page is present by platform track ID', async () => {
    const { summary, cleanup, state } = await runCleanup([
      notionPage({ id: 'by-platform', isrc: '', platformTrackId: 'spotify:presentid', url: present.url }),
    ]);
    expect(state['by-platform']).toBe('present');
    expect(summary.spotify.skipped).toBe(1);
    expect(cleanup.marked).toBe(0);
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('a page is present by ISRC as a cross-service hint when it has no Spotify ID', async () => {
    const { state, cleanup } = await runCleanup([
      notionPage({
        id: 'by-isrc', isrc: 'USPRESENT0001', platformTrackId: 'appleMusic:555000111',
        url: 'https://music.apple.com/us/album/old-time-music/123456?i=555000111',
      }),
    ]);
    expect(state['by-isrc']).toBe('present');
    expect(cleanup.marked).toBe(0);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('the exact platform ID page is present even when another page shares its ISRC', async () => {
    const { state, summary } = await runCleanup([
      notionPage({ id: 'by-platform', isrc: 'USPRESENT0001', platformTrackId: 'spotify:presentid', url: present.url }),
      notionPage({ id: 'shares-isrc', isrc: 'USPRESENT0001', platformTrackId: 'spotify:otherrelease', url: 'https://open.spotify.com/track/otherrelease' }),
    ]);
    expect(state['by-platform']).toBe('present');
    expect(state['shares-isrc']).toBe('not_confirmed_in_monitored_playlists');
    expect(summary.spotify.skipped).toBe(1);
    expect(summary.spotify.review).toBe(0);
  });

  test('same title and artist alone does not keep a different recording present', async () => {
    const { state, cleanup, summary, context } = await runCleanup([
      notionPage({ id: 'other-recording', isrc: 'USOTHER000001', platformTrackId: 'spotify:otherrecording', url: 'https://open.spotify.com/track/otherrecording' }),
      notionPage({ id: 'no-identity-at-all' }),
    ]);
    expect(state['other-recording']).toBe('not_confirmed_in_monitored_playlists');
    expect(state['no-identity-at-all']).toBe('not_confirmed_in_monitored_playlists');
    // Ambiguity is surfaced for review rather than resolved by title.
    expect(summary.spotify.review).toBe(1);
    expect(context.proposals.map(p => p.kind)).toEqual(['review_identity']);
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
    // The legacy Removed flag is never written by this code line.
    expect(cleanup.marked).toBe(0);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
    expect(cleanup.mutationPolicy).toBe('per_playlist_memberships_only_legacy_fields_read_only');
  });

  test('a legacy-removed page matched by platform ID is an ordinary match by default', async () => {
    const { state, summary, context, cleanup } = await runCleanup([
      notionPage({ id: 'legacy-removed', isrc: 'USPRESENT0001', platformTrackId: 'spotify:presentid', url: present.url, removed: true }),
    ]);
    // Membership is recorded and the track is skipped, exactly like a non-removed page.
    expect(state['legacy-removed']).toBe('present');
    expect(summary.spotify.skipped).toBe(1);
    expect(summary.spotify.review).toBe(0);
    expect(context.proposals).toEqual([]);
    expect(cleanup.observations[0].legacyRemoved).toBe(true);
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
    // The flag itself is still never written in either direction.
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('REMOVED_FLAG_POLICY=review restores the reactivation review proposal', async () => {
    mockConfig.config.removedFlagPolicy = 'review';
    const { state, summary, context } = await runCleanup([
      notionPage({ id: 'legacy-removed', isrc: 'USPRESENT0001', platformTrackId: 'spotify:presentid', url: present.url, removed: true }),
    ]);
    expect(state['legacy-removed']).toBe('present');
    expect(summary.spotify.review).toBe(1);
    expect(summary.spotify.skipped).toBe(0);
    expect(context.proposals.map(p => p.kind)).toEqual(['review_reactivation']);
    expect(context.proposals[0].pageId).toBe('legacy-removed');
    expect(context.proposals[0].reasons).toEqual(['present_in_current_playlist_but_legacy_removed']);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('membership storage is not written when it is unconfigured', async () => {
    const { cleanup } = await runCleanup([
      notionPage({ id: 'by-platform', isrc: '', platformTrackId: 'spotify:presentid', url: present.url }),
    ]);
    expect(cleanup.membershipPlan.status).toBe('unconfigured');
    expect(cleanup.membershipCommit.committed).toBe(false);
    expect(mockMembershipStore.commitPlan).not.toHaveBeenCalled();
  });
});
