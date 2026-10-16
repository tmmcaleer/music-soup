/**
 * Helpers for scheduled sync Notion page comments.
 */

const MAX_TRACK_LINES = 25;
const MAX_TRACKS_TO_LIST = 10;

const SERVICE_LABELS = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
};

const CASUAL_INTROS = [
  (count) => (count === 1
    ? 'looks like more was added'
    : `looks like ${count} more were added`),
  (count) => (count === 1
    ? 'a new track just showed up'
    : `${count} new tracks just showed up`),
  (count) => (count === 1
    ? 'heads up, one more landed in the db'
    : `heads up, ${count} more landed in the db`),
  (count) => (count === 1
    ? 'fyi, something new was added'
    : `fyi, ${count} new tracks were added`),
];

/**
 * @param {number} spotifyAdded
 * @param {number} appleMusicAdded
 * @returns {number}
 */
function getTotalAdded(spotifyAdded, appleMusicAdded) {
  return spotifyAdded + appleMusicAdded;
}

/**
 * @param {number} totalAdded
 * @returns {boolean}
 */
function shouldPostComment(totalAdded) {
  return totalAdded > 0;
}

/**
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
function formatSyncTimestamp(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/**
 * @param {number} totalAdded
 * @param {Date} [syncDate]
 * @returns {string}
 */
function pickQuip(totalAdded, syncDate = new Date()) {
  const index = (syncDate.getUTCHours() + totalAdded) % CASUAL_INTROS.length;
  return CASUAL_INTROS[index](totalAdded);
}

/**
 * @param {number} totalAdded
 * @returns {boolean}
 */
function shouldListTracks(totalAdded) {
  return totalAdded <= MAX_TRACKS_TO_LIST;
}

/**
 * @param {{ title: string, artist: string, service: string, playlistType: string }} track
 * @returns {string}
 */
function formatTrackLine(track) {
  const serviceLabel = SERVICE_LABELS[track.service] || track.service;
  const artist = track.artist || 'Unknown artist';
  return `• ${track.title} — ${artist} (${serviceLabel} / ${track.playlistType})`;
}

/**
 * @param {Array<{ title: string, artist: string, service: string, playlistType: string }>} newTracks
 * @returns {string}
 */
function formatTrackList(newTracks) {
  if (newTracks.length === 0) {
    return '';
  }

  const visibleTracks = newTracks.slice(0, MAX_TRACK_LINES);
  const lines = visibleTracks.map(formatTrackLine);
  const remaining = newTracks.length - visibleTracks.length;

  if (remaining > 0) {
    lines.push(`…and ${remaining} more`);
  }

  return `\n\n${lines.join('\n')}`;
}

/**
 * Build plain-text comment body for a sync run.
 * @param {Object} params
 * @param {Array<{ title: string, artist: string, service: string, playlistType: string }>} params.newTracks
 * @param {number} params.totalAdded
 * @param {Date} [params.syncDate]
 * @param {string} [params.timeZone]
 * @returns {string}
 */
function buildCommentText({
  newTracks,
  totalAdded,
  syncDate = new Date(),
  timeZone = 'America/New_York',
}) {
  const intro = pickQuip(totalAdded, syncDate);
  const trackList = shouldListTracks(totalAdded) ? formatTrackList(newTracks) : '';
  return `Hey — ${intro}${trackList ? `:${trackList}` : ''}`;
}

/**
 * Build Notion rich_text blocks with an @mention and quippy intro.
 * @param {Object} params
 * @param {Array<{ title: string, artist: string, service: string, playlistType: string }>} params.newTracks
 * @param {number} params.totalAdded
 * @param {string} params.mentionUserId
 * @param {Date} [params.syncDate]
 * @param {string} [params.timeZone]
 * @returns {Array<Object>}
 */
function buildCommentRichText({
  newTracks,
  totalAdded,
  mentionUserId,
  syncDate = new Date(),
  timeZone = 'America/New_York',
}) {
  const intro = pickQuip(totalAdded, syncDate);
  const trackList = shouldListTracks(totalAdded) ? formatTrackList(newTracks) : '';
  const suffix = trackList ? `:${trackList}` : '';

  const blocks = [
    { type: 'text', text: { content: 'Heyo ' } },
    { type: 'mention', mention: { type: 'user', user: { id: mentionUserId } } },
    { type: 'text', text: { content: ` — ${intro}${suffix}` } },
  ];

  return blocks;
}

/**
 * Convert plain text to a single Notion rich_text block.
 * @param {string} text
 * @returns {Array<{ type: string, text: { content: string } }>}
 */
function toRichTextBlocks(text) {
  return [{ type: 'text', text: { content: text } }];
}

module.exports = {
  MAX_TRACK_LINES,
  MAX_TRACKS_TO_LIST,
  CASUAL_INTROS,
  getTotalAdded,
  shouldPostComment,
  shouldListTracks,
  formatSyncTimestamp,
  pickQuip,
  formatTrackLine,
  formatTrackList,
  buildCommentText,
  buildCommentRichText,
  toRichTextBlocks,
};
