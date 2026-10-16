/**
 * Test fixtures shaped like the Music Options database pages and the
 * normalized provider tracks the sync feeds into the matcher. Every page
 * carries all properties validateInventoryPage requires.
 */
const { NOTION_FIELDS } = require('../../schema');

const richText = value => [{ plain_text: value, text: { content: value } }];

const SONG = {
  title: 'Georgia Buck',
  artist: 'Joe Thompson, Odell Thompson',
  album: 'Old-Time Music from the North Carolina Piedmont',
  duration: 192,
  trackNumber: 4,
};

function notionPage({
  id,
  title = SONG.title,
  artist = SONG.artist,
  album = SONG.album,
  isrc = '',
  platformTrackId = '',
  url = '',
  duration = '3:12.000',
  trackNumber = SONG.trackNumber,
  removed = false,
  source = 'Spotify - Source',
}) {
  return {
    object: 'page',
    id,
    properties: {
      [NOTION_FIELDS.TRACK_TITLE]: { title: richText(title) },
      [NOTION_FIELDS.ARTIST]: { rich_text: richText(artist) },
      [NOTION_FIELDS.ALBUM]: { rich_text: richText(album) },
      [NOTION_FIELDS.ISRC_UPC]: { rich_text: richText(isrc) },
      [NOTION_FIELDS.PLATFORM_TRACK_ID]: { rich_text: richText(platformTrackId) },
      [NOTION_FIELDS.DURATION]: { rich_text: richText(duration) },
      [NOTION_FIELDS.TRACK_NUMBER]: { number: trackNumber },
      [NOTION_FIELDS.URL]: { url },
      [NOTION_FIELDS.REMOVED]: { checkbox: removed },
      [NOTION_FIELDS.SOURCE]: { select: source ? { name: source } : null },
    },
  };
}

function spotifyTrack(overrides = {}) {
  const sourceId = overrides.sourceId || 'repackaged';
  return {
    source: 'Spotify',
    sourceId,
    ...SONG,
    isrc: 'USSHARED00001',
    url: `https://open.spotify.com/track/${sourceId}`,
    playlist: 'Spotify - E2E SOURCE MX',
    ...overrides,
  };
}

function appleMusicTrack(overrides = {}) {
  const sourceId = overrides.sourceId || '777000111';
  return {
    source: 'Apple Music',
    sourceId,
    ...SONG,
    isrc: 'USSHARED00001',
    url: `https://music.apple.com/us/album/old-time-music/123456?i=${sourceId}`,
    playlist: 'Apple Music - E2E SOURCE MX',
    ...overrides,
  };
}

module.exports = { SONG, richText, notionPage, spotifyTrack, appleMusicTrack };
