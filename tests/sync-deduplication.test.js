const mockConfig = {
  config: { dryRun: false, logLevel: 'error' },
  getAllConfiguredPlaylists: jest.fn(),
};

const mockSpotifyClient = {
  checkServiceHealth: jest.fn(),
  getPlaylist: jest.fn(),
  getPlaylistTracks: jest.fn(),
};

const mockAppleMusicClient = {
  checkServiceHealth: jest.fn(),
  getPlaylist: jest.fn(),
  getPlaylistTracks: jest.fn(),
};

const mockNotionClient = {
  queryAllDatabase: jest.fn(),
  findTrackByIdentity: jest.fn(),
  createTrack: jest.fn(),
  markTrackRemoved: jest.fn(),
};

jest.mock('../config', () => mockConfig);
jest.mock('../spotifyClient', () => mockSpotifyClient);
jest.mock('../appleMusicClient', () => mockAppleMusicClient);
jest.mock('../notionClient', () => mockNotionClient);
jest.mock('../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const { NOTION_FIELDS } = require('../schema');
const { NotionOperationError } = require('../utils/notionRetry');
const { syncAllPlaylists, cleanupRemovedTracks, createSyncContext } = require('../syncOrchestrator');

function richText(value) {
  return [{ plain_text: value, text: { content: value } }];
}

function notionPage({
  id,
  title,
  artist,
  isrc,
  platformTrackId,
  url,
  removed = false,
}) {
  return {
    id,
    properties: {
      [NOTION_FIELDS.TRACK_TITLE]: { title: richText(title) },
      [NOTION_FIELDS.ARTIST]: { rich_text: richText(artist) },
      [NOTION_FIELDS.ISRC_UPC]: { rich_text: richText(isrc) },
      [NOTION_FIELDS.PLATFORM_TRACK_ID]: { rich_text: richText(platformTrackId) },
      [NOTION_FIELDS.URL]: { url },
      [NOTION_FIELDS.REMOVED]: { checkbox: removed },
    },
  };
}

function spotifyTrack(overrides = {}) {
  return {
    source: 'Spotify',
    sourceId: '62e6WDg7JqjAPTm4jvr4Pz',
    title: 'Georgia Buck',
    artist: 'Joe Thompson, Odell Thompson',
    isrc: 'USSF19810405',
    url: 'https://open.spotify.com/track/62e6WDg7JqjAPTm4jvr4Pz',
    playlist: 'Spotify - E2E SOURCE MX',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSpotifyClient.checkServiceHealth.mockResolvedValue(true);
  mockSpotifyClient.getPlaylist.mockImplementation(async (id) => ({
    id,
    name: `Spotify ${id}`,
    trackCount: 1,
  }));
  mockSpotifyClient.getPlaylistTracks.mockResolvedValue([]);
  mockAppleMusicClient.checkServiceHealth.mockResolvedValue(true);
  mockAppleMusicClient.getPlaylist.mockImplementation(async (id) => ({
    id,
    name: `Apple ${id}`,
    trackCount: 1,
  }));
  mockAppleMusicClient.getPlaylistTracks.mockResolvedValue([]);
  mockNotionClient.queryAllDatabase.mockResolvedValue([]);
  mockNotionClient.findTrackByIdentity.mockResolvedValue(null);
  // A real create returns the page with its properties; the snapshot and the
  // cleanup pass rely on them, so the mock returns the same shape.
  mockNotionClient.createTrack.mockImplementation(async (track) => notionPage({
    id: `created-${track.sourceId}`,
    title: track.title,
    artist: track.artist,
    isrc: track.isrc,
    platformTrackId: `spotify:${track.sourceId}`,
    url: track.url,
  }));
  mockNotionClient.markTrackRemoved.mockResolvedValue({});
});

describe('run-scoped synchronization deduplication', () => {
  test('loads one complete Notion snapshot for a multi-playlist run', async () => {
    const sharedTrack = spotifyTrack({
      sourceId: 'shared-new-track',
      isrc: 'USNEW0000001',
      url: 'https://open.spotify.com/track/sharednewtrack',
    });
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
      { service: 'spotify', id: 'spotify-temp', key: 'temp', type: 'Temp' },
      { service: 'appleMusic', id: 'apple-source', key: 'source', type: 'Source' },
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([sharedTrack]);

    const summary = await syncAllPlaylists();

    expect(mockNotionClient.queryAllDatabase).toHaveBeenCalledTimes(1);
    expect(mockSpotifyClient.getPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(mockAppleMusicClient.getPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(mockNotionClient.findTrackByIdentity).toHaveBeenCalledTimes(1);
    expect(mockNotionClient.createTrack).toHaveBeenCalledTimes(1);
    expect(summary.spotify.added).toBe(1);
    expect(summary.spotify.skipped).toBe(1);
  });

  test('skips an EM0932-equivalent track already present in the snapshot', async () => {
    const track = spotifyTrack();
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockNotionClient.queryAllDatabase.mockResolvedValue([
      notionPage({
        id: 'original-em0932',
        title: track.title,
        artist: track.artist,
        isrc: track.isrc,
        platformTrackId: `spotify:${track.sourceId}`,
        url: track.url,
      }),
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([track]);

    const summary = await syncAllPlaylists();

    expect(summary.spotify.skipped).toBe(1);
    expect(summary.spotify.added).toBe(0);
    expect(mockNotionClient.findTrackByIdentity).not.toHaveBeenCalled();
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
  });

  test('creates the same new track only once when it appears twice', async () => {
    const track = spotifyTrack({
      sourceId: 'new-track',
      isrc: 'USNEW1234567',
      url: 'https://open.spotify.com/track/newtrack',
    });
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([track, { ...track }]);

    const summary = await syncAllPlaylists();

    expect(summary.spotify.added).toBe(1);
    expect(summary.spotify.skipped).toBe(1);
    expect(mockNotionClient.findTrackByIdentity).toHaveBeenCalledTimes(1);
    expect(mockNotionClient.createTrack).toHaveBeenCalledTimes(1);
  });

  test('skips by platform ID when a shared ISRC points at a different page', async () => {
    const track = spotifyTrack({ sourceId: 'repackaged', isrc: 'USSHARED00001' });
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockNotionClient.queryAllDatabase.mockResolvedValue([
      notionPage({
        id: 'original-release', title: track.title, artist: track.artist,
        isrc: 'USSHARED00001', platformTrackId: 'spotify:original',
        url: 'https://open.spotify.com/track/original',
      }),
      notionPage({
        id: 'repackaged-release', title: track.title, artist: track.artist,
        isrc: 'USSHARED00001', platformTrackId: 'spotify:repackaged',
        url: 'https://open.spotify.com/track/repackaged',
      }),
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([track]);
    const debug = require('../utils/logger').debug;

    const summary = await syncAllPlaylists();

    expect(summary.spotify.skipped).toBe(1);
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Skipped existing track'),
      expect.objectContaining({ pageId: 'repackaged-release' })
    );
  });

  test('propagates a fatal snapshot failure before touching provider APIs', async () => {
    const fatal = new NotionOperationError('catalog snapshot', new Error('Notion unavailable'));
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockNotionClient.queryAllDatabase.mockRejectedValue(fatal);

    await expect(syncAllPlaylists()).rejects.toBe(fatal);

    expect(mockSpotifyClient.checkServiceHealth).not.toHaveBeenCalled();
    expect(mockSpotifyClient.getPlaylistTracks).not.toHaveBeenCalled();
    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
  });

  test('propagates a fatal live identity lookup instead of creating', async () => {
    const fatal = new NotionOperationError('identity lookup', new Error('Notion unavailable'));
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([
      spotifyTrack({ sourceId: 'unseen-track', isrc: 'USNEW7654321' }),
    ]);
    mockNotionClient.findTrackByIdentity.mockRejectedValue(fatal);

    await expect(syncAllPlaylists()).rejects.toBe(fatal);

    expect(mockNotionClient.createTrack).not.toHaveBeenCalled();
  });

  test('propagates a fatal create failure instead of continuing the run', async () => {
    const fatal = new NotionOperationError('create track', new Error('ambiguous timeout'));
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([
      spotifyTrack({ sourceId: 'unseen-track', isrc: 'USNEW7654321' }),
    ]);
    mockNotionClient.createTrack.mockRejectedValue(fatal);

    await expect(syncAllPlaylists()).rejects.toBe(fatal);

    expect(mockNotionClient.createTrack).toHaveBeenCalledTimes(1);
  });
});

describe('removal detection identity', () => {
  const present = spotifyTrack({ sourceId: 'present-id', isrc: 'USPRESENT0001', url: 'https://open.spotify.com/track/present-id' });

  async function runCleanup(pages) {
    mockConfig.getAllConfiguredPlaylists.mockReturnValue([
      { service: 'spotify', id: 'spotify-source', key: 'source', type: 'Source' },
    ]);
    mockNotionClient.queryAllDatabase.mockResolvedValue(pages);
    mockSpotifyClient.getPlaylistTracks.mockResolvedValue([present]);
    const context = await createSyncContext();
    await syncAllPlaylists(context);
    return cleanupRemovedTracks(context);
  }

  test('a page is present by platform track ID', async () => {
    const results = await runCleanup([
      notionPage({ id: 'by-platform', title: 'Other Title', artist: 'Other Artist', isrc: '', platformTrackId: 'spotify:present-id', url: '' }),
    ]);
    expect(results.marked).toBe(0);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('a page is present by ISRC when it has no platform track ID', async () => {
    const results = await runCleanup([
      notionPage({ id: 'by-isrc', title: 'Other Title', artist: 'Other Artist', isrc: 'USPRESENT0001', platformTrackId: '', url: '' }),
    ]);
    expect(results.marked).toBe(0);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });

  test('same title and artist alone no longer keeps a different recording present', async () => {
    const results = await runCleanup([
      notionPage({
        id: 'other-recording', title: present.title, artist: present.artist,
        isrc: 'USOTHER000001', platformTrackId: 'spotify:other-recording',
        url: 'https://open.spotify.com/track/other-recording',
      }),
      notionPage({
        id: 'no-identity-at-all', title: present.title, artist: present.artist,
        isrc: '', platformTrackId: '', url: '',
      }),
    ]);
    expect(results.marked).toBe(2);
    expect(mockNotionClient.markTrackRemoved).toHaveBeenCalledWith('other-recording');
    expect(mockNotionClient.markTrackRemoved).toHaveBeenCalledWith('no-identity-at-all');
  });

  test('already removed pages and manual Link Only pages are left alone', async () => {
    const manual = notionPage({ id: 'manual', title: 'Manual', artist: 'Someone', isrc: '', platformTrackId: '', url: '' });
    manual.properties[NOTION_FIELDS.SOURCE] = { select: { name: 'Link Only' } };
    const results = await runCleanup([
      manual,
      notionPage({ id: 'already-removed', title: 'Gone', artist: 'Someone', isrc: '', platformTrackId: 'spotify:gone', url: '', removed: true }),
    ]);
    expect(results.marked).toBe(0);
    expect(mockNotionClient.markTrackRemoved).not.toHaveBeenCalled();
  });
});
