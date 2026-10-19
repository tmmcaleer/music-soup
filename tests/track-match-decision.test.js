/**
 * Identity order in the conservative matcher: platform track ID before ISRC.
 *
 * Labels give one ISRC to different recordings and several ISRCs to one
 * recording. The platform track ID (spotify:<id> / appleMusic:<id>) names one
 * catalogue entry on one service, so an exact provider match must never be
 * blocked or outvoted by pages that merely share the ISRC or the title.
 */
const mockQuery = jest.fn();

jest.mock('@notionhq/client', () => ({
  Client: jest.fn(() => ({ databases: { query: mockQuery } })),
}));
jest.mock('../config', () => ({
  notion: { apiKey: 'test-key', databaseId: 'music-db' },
  config: { dryRun: false, logLevel: 'error' },
}));
jest.mock('../utils/logger', () => ({
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
}));

const { decideTrackMatch, TrackIdentityReviewError } = require('../utils/trackMatchDecision');
const { TrackIdentityIndex } = require('../utils/trackIdentity');
const { findTrackByIdentity } = require('../notionClient');
const { notionPage, spotifyTrack, appleMusicTrack } = require('./fixtures/musicPages');

const SHARED_ISRC = 'USSHARED00001';

const original = () => notionPage({
  id: 'original-release', isrc: SHARED_ISRC,
  platformTrackId: 'spotify:original', url: 'https://open.spotify.com/track/original',
});
const repackaged = () => notionPage({
  id: 'repackaged-release', isrc: SHARED_ISRC,
  platformTrackId: 'spotify:repackaged', url: 'https://open.spotify.com/track/repackaged',
});

describe('decideTrackMatch identity order', () => {
  test('an exact platform track ID match wins over pages that only share the ISRC', () => {
    const pages = [original(), repackaged()];

    const forRepackaged = decideTrackMatch(spotifyTrack({ sourceId: 'repackaged' }), pages);
    expect(forRepackaged.outcome).toBe('match');
    expect(forRepackaged.recordId).toBe('repackaged-release');
    expect(forRepackaged.identityTier).toBe('platform_track_id');
    expect(forRepackaged.evidence).toBe('exact_provider_id_with_metadata');
    expect(forRepackaged.candidates).toHaveLength(1);

    const forOriginal = decideTrackMatch(spotifyTrack({ sourceId: 'original' }), pages);
    expect(forOriginal.outcome).toBe('match');
    expect(forOriginal.recordId).toBe('original-release');
  });

  test('an exact platform track ID match is not outvoted by a same-title page', () => {
    const pages = [
      repackaged(),
      notionPage({ id: 'other-recording', isrc: 'USOTHER000001', platformTrackId: 'spotify:other', url: 'https://open.spotify.com/track/other' }),
    ];
    const decision = decideTrackMatch(spotifyTrack({ sourceId: 'repackaged' }), pages);
    expect(decision.outcome).toBe('match');
    expect(decision.recordId).toBe('repackaged-release');
  });

  test('ISRC remains a cross-service hint when no page carries the platform ID', () => {
    const decision = decideTrackMatch(appleMusicTrack({ isrc: SHARED_ISRC }), [original()]);
    expect(decision.outcome).toBe('match');
    expect(decision.recordId).toBe('original-release');
    expect(decision.identityTier).toBe('isrc_or_title');
    expect(decision.evidence).toBe('corroborated_cross_provider_candidate');
  });

  test('a shared ISRC on the same service without the platform ID is not merged', () => {
    const decision = decideTrackMatch(spotifyTrack({ sourceId: 'brandnewrecording' }), [original()]);
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toContain('unverified_source_alias');
    expect(decision.identityTier).toBe('isrc_or_title');
  });

  test('a shared ISRC pointing at two pages still requires review without a platform ID match', () => {
    const decision = decideTrackMatch(appleMusicTrack({ isrc: SHARED_ISRC }), [original(), repackaged()]);
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toEqual(['multiple_candidates']);
  });

  test('title and artist alone never produce a match', () => {
    const decision = decideTrackMatch(
      spotifyTrack({ sourceId: 'newrecording', isrc: 'USNEW0000001' }),
      [notionPage({ id: 'other-recording', isrc: 'USOTHER000001', platformTrackId: 'spotify:other', url: 'https://open.spotify.com/track/other' })]
    );
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toContain('no_shared_strong_identity');

    const noIdentity = decideTrackMatch(
      spotifyTrack({ sourceId: 'newrecording', isrc: '' }),
      [notionPage({ id: 'no-identity-at-all' })]
    );
    expect(noIdentity.outcome).toBe('review');
    expect(noIdentity.reasons).toContain('no_shared_strong_identity');
  });

  test('an exact platform track ID match still reviews conflicting metadata', () => {
    const conflicting = notionPage({
      id: 'repackaged-release', isrc: 'USDIFFERENT001',
      platformTrackId: 'spotify:repackaged', url: 'https://open.spotify.com/track/repackaged',
    });
    const decision = decideTrackMatch(spotifyTrack({ sourceId: 'repackaged' }), [conflicting]);
    expect(decision.outcome).toBe('review');
    expect(decision.identityTier).toBe('platform_track_id');
    expect(decision.reasons).toContain('isrc_conflict');
  });

  test('two pages with the same platform track ID require review', () => {
    const duplicate = { ...repackaged(), id: 'repackaged-duplicate' };
    const decision = decideTrackMatch(spotifyTrack({ sourceId: 'repackaged' }), [repackaged(), duplicate]);
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toEqual(['multiple_candidates']);
    expect(decision.identityTier).toBe('platform_track_id');
  });

  test('a track with no candidates is new', () => {
    const decision = decideTrackMatch(spotifyTrack({ sourceId: 'unseen', isrc: 'USUNSEEN00001', title: 'Unseen Song' }), [original()]);
    expect(decision.outcome).toBe('new');
  });
});

describe('TrackIdentityIndex (in-memory snapshot) follows the same order', () => {
  test('find resolves each shared-ISRC entry by its own platform ID', () => {
    const index = TrackIdentityIndex.fromNotionPages([original(), repackaged()]);
    expect(index.find(spotifyTrack({ sourceId: 'repackaged' })).id).toBe('repackaged-release');
    expect(index.find(spotifyTrack({ sourceId: 'original' })).id).toBe('original-release');
  });

  test('find throws a review error instead of matching on title and artist', () => {
    const index = TrackIdentityIndex.fromNotionPages([
      notionPage({ id: 'other-recording', isrc: 'USOTHER000001', platformTrackId: 'spotify:other', url: 'https://open.spotify.com/track/other' }),
    ]);
    expect(() => index.find(spotifyTrack({ sourceId: 'newrecording', isrc: 'USNEW0000001' })))
      .toThrow(TrackIdentityReviewError);
  });

  test('records added during the run are matched by platform ID as well', () => {
    const index = TrackIdentityIndex.fromNotionPages([original()]);
    const created = { id: 'created-repackaged' };
    index.addTrackData(spotifyTrack({ sourceId: 'repackaged' }), created);
    expect(index.find(spotifyTrack({ sourceId: 'repackaged' }))).toBe(created);
    expect(index.find(spotifyTrack({ sourceId: 'original' })).id).toBe('original-release');
  });
});

describe('findTrackByIdentity (live pre-create lookup) follows the same order', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ results: [original(), repackaged()], has_more: false, next_cursor: null });
  });

  test('returns the page with the incoming platform ID, not the first shared-ISRC page', async () => {
    const page = await findTrackByIdentity(spotifyTrack({ sourceId: 'repackaged' }));
    expect(page.id).toBe('repackaged-release');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('falls back to the ISRC hint across services', async () => {
    mockQuery.mockResolvedValue({ results: [original()], has_more: false, next_cursor: null });
    const page = await findTrackByIdentity(appleMusicTrack({ isrc: SHARED_ISRC }));
    expect(page.id).toBe('original-release');
  });

  test('propagates a review instead of treating ambiguity as not found', async () => {
    await expect(findTrackByIdentity(appleMusicTrack({ isrc: SHARED_ISRC })))
      .rejects.toBeInstanceOf(TrackIdentityReviewError);
  });
});
