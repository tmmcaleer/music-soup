const {
  TrackIdentityIndex,
  buildPlatformTrackId,
  extractPlatformTrackId,
  identityFromTrackData,
  normalizeIsrc,
} = require('../utils/trackIdentity');

describe('track identity helpers', () => {
  test('normalizes ISRC formatting and platform-qualifies otherwise identical source IDs', () => {
    expect(normalizeIsrc(' us-sf1-9810405 ')).toBe('USSF19810405');

    expect(buildPlatformTrackId({ source: 'Spotify', sourceId: 'shared-id' }))
      .toBe('spotify:shared-id');
    expect(buildPlatformTrackId({ source: 'Apple Music', sourceId: 'shared-id' }))
      .toBe('appleMusic:shared-id');
  });

  test('extracts stable IDs from Spotify and Apple Music URLs without collapsing Apple album tracks', () => {
    expect(extractPlatformTrackId('https://open.spotify.com/track/62e6WDg7JqjAPTm4jvr4Pz?si=tracking'))
      .toBe('spotify:62e6WDg7JqjAPTm4jvr4Pz');
    expect(extractPlatformTrackId('https://music.apple.com/us/album/example/12345?i=67890&utm_source=test'))
      .toBe('appleMusic:67890');
    expect(extractPlatformTrackId('https://music.apple.com/us/album/example/12345?i=67891'))
      .toBe('appleMusic:67891');
  });

  test('matches in strong identity priority order before title and artist', () => {
    const index = new TrackIdentityIndex();
    const titleRecord = { id: 'title-record' };
    const platformRecord = { id: 'platform-record' };
    const isrcRecord = { id: 'isrc-record' };

    index.addTrackData({ title: 'Georgia Buck', artist: 'Joe Thompson, Odell Thompson' }, titleRecord);
    index.addTrackData({ source: 'Spotify', sourceId: 'spotify-track' }, platformRecord);
    index.addTrackData({ isrc: 'USSF19810405' }, isrcRecord);

    expect(index.find({
      isrc: 'us-sf1-9810405',
      source: 'Spotify',
      sourceId: 'spotify-track',
      title: 'Georgia Buck',
      artist: 'Joe Thompson, Odell Thompson',
    })).toBe(isrcRecord);

    expect(index.find({
      source: 'Spotify',
      sourceId: 'spotify-track',
      title: 'Georgia Buck',
      artist: 'Joe Thompson, Odell Thompson',
    })).toBe(platformRecord);
  });

  test('does not merge equal title and artist when strong identities conflict', () => {
    const index = new TrackIdentityIndex();
    const existing = {
      isrc: 'USAAA1111111',
      source: 'Spotify',
      sourceId: 'spotify-one',
      title: 'Same Song',
      artist: 'Same Artist',
    };

    index.addTrackData(existing, { id: 'existing' });

    expect(index.find({
      isrc: 'USBBB2222222',
      source: 'Spotify',
      sourceId: 'spotify-two',
      title: '  SAME   SONG ',
      artist: 'same artist',
    })).toBeNull();
  });

  test('keeps the same raw source ID distinct across platforms', () => {
    const index = new TrackIdentityIndex();
    const spotifyRecord = { id: 'spotify-record' };

    index.addTrackData({ source: 'Spotify', sourceId: '12345' }, spotifyRecord);

    expect(index.find({ source: 'Spotify', sourceId: '12345' })).toBe(spotifyRecord);
    expect(index.find({ source: 'Apple Music', sourceId: '12345' })).toBeNull();

    expect(identityFromTrackData({ source: 'Spotify', sourceId: '12345' }).platformTrackId)
      .not.toBe(identityFromTrackData({ source: 'Apple Music', sourceId: '12345' }).platformTrackId);
  });
});
