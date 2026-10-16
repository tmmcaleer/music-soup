/**
 * Canonical track identity helpers used by sync and audit tooling.
 */

const { NOTION_FIELDS } = require('../schema');

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeIsrc(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeService(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]/g, '');
  if (normalized.includes('spotify')) return 'spotify';
  if (normalized.includes('applemusic')) return 'appleMusic';
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePlatformTrackId(value) {
  const raw = String(value || '').trim();
  const separator = raw.indexOf(':');
  if (separator < 1) return '';

  const service = normalizeService(raw.slice(0, separator));
  const sourceId = raw.slice(separator + 1).trim();
  return service && sourceId ? `${service}:${sourceId}` : '';
}

/**
 * Extract a stable, platform-qualified track ID from a streaming URL.
 * @param {unknown} value
 * @returns {string}
 */
function extractPlatformTrackId(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'open.spotify.com') {
      const match = url.pathname.match(/^\/track\/([A-Za-z0-9]+)/);
      return match ? `spotify:${match[1]}` : '';
    }

    if (hostname === 'music.apple.com' || hostname.endsWith('.music.apple.com')) {
      const queryId = url.searchParams.get('i');
      if (queryId) return `appleMusic:${queryId}`;

      const match = url.pathname.match(/\/(?:song|album)\/[^/]+\/(\d+)\/?$/);
      return match ? `appleMusic:${match[1]}` : '';
    }
  } catch {
    return '';
  }

  return '';
}

/**
 * @param {Object} trackData
 * @returns {string}
 */
function buildPlatformTrackId(trackData) {
  const persisted = normalizePlatformTrackId(trackData.platformTrackId);
  if (persisted) return persisted;

  const service = normalizeService(trackData.source || trackData.service);
  const sourceId = String(trackData.sourceId || '').trim();
  if (service && sourceId) return `${service}:${sourceId}`;

  return extractPlatformTrackId(trackData.url);
}

/**
 * @param {unknown} title
 * @param {unknown} artist
 * @returns {string}
 */
function buildTitleArtistKey(title, artist) {
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artist);
  return normalizedTitle && normalizedArtist
    ? `${normalizedTitle}|||${normalizedArtist}`
    : '';
}

/**
 * @param {Object} property
 * @returns {string}
 */
function getNotionText(property) {
  if (!property) return '';
  const items = property.title || property.rich_text || [];
  return items.map((item) => item.plain_text || item.text?.content || '').join('');
}

/**
 * @param {Object} trackData
 * @returns {{isrc: string, platformTrackId: string, titleArtist: string}}
 */
function identityFromTrackData(trackData) {
  return {
    isrc: normalizeIsrc(trackData.isrc),
    platformTrackId: buildPlatformTrackId(trackData),
    titleArtist: buildTitleArtistKey(trackData.title, trackData.artist),
  };
}

/**
 * @param {Object} page
 * @returns {{isrc: string, platformTrackId: string, titleArtist: string}}
 */
function identityFromNotionPage(page) {
  const properties = page.properties || {};
  const persistedPlatformId = getNotionText(properties[NOTION_FIELDS.PLATFORM_TRACK_ID]);
  const url = properties[NOTION_FIELDS.URL]?.url || '';

  return {
    isrc: normalizeIsrc(getNotionText(properties[NOTION_FIELDS.ISRC_UPC])),
    platformTrackId: normalizePlatformTrackId(persistedPlatformId) || extractPlatformTrackId(url),
    titleArtist: buildTitleArtistKey(
      getNotionText(properties[NOTION_FIELDS.TRACK_TITLE]),
      getNotionText(properties[NOTION_FIELDS.ARTIST])
    ),
  };
}

/**
 * In-memory identity index for one sync run.
 */
class TrackIdentityIndex {
  constructor() {
    this.byIsrc = new Map();
    this.byPlatformTrackId = new Map();
    this.byTitleArtist = new Map();
  }

  /**
   * @param {Object} page
   * @returns {void}
   */
  addNotionPage(page) {
    this.addIdentity(identityFromNotionPage(page), page);
  }

  /**
   * @param {Object} trackData
   * @param {Object} record
   * @returns {void}
   */
  addTrackData(trackData, record) {
    this.addIdentity(identityFromTrackData(trackData), record);
  }

  /**
   * @param {{isrc: string, platformTrackId: string, titleArtist: string}} identity
   * @param {Object} record
   * @returns {void}
   */
  addIdentity(identity, record) {
    if (identity.isrc && !this.byIsrc.has(identity.isrc)) {
      this.byIsrc.set(identity.isrc, record);
    }
    if (identity.platformTrackId && !this.byPlatformTrackId.has(identity.platformTrackId)) {
      this.byPlatformTrackId.set(identity.platformTrackId, record);
    }
    if (identity.titleArtist) {
      const entries = this.byTitleArtist.get(identity.titleArtist) || [];
      entries.push({ identity, record });
      this.byTitleArtist.set(identity.titleArtist, entries);
    }
  }

  /**
   * @param {Object} trackData
   * @returns {Object|null}
   */
  find(trackData) {
    const identity = identityFromTrackData(trackData);

    if (identity.isrc && this.byIsrc.has(identity.isrc)) {
      return this.byIsrc.get(identity.isrc);
    }

    if (identity.platformTrackId && this.byPlatformTrackId.has(identity.platformTrackId)) {
      return this.byPlatformTrackId.get(identity.platformTrackId);
    }

    if (!identity.titleArtist) return null;

    const candidates = this.byTitleArtist.get(identity.titleArtist) || [];
    for (const candidate of candidates) {
      const existing = candidate.identity;
      const conflictingIsrc = identity.isrc && existing.isrc && identity.isrc !== existing.isrc;
      const conflictingPlatformId = identity.platformTrackId
        && existing.platformTrackId
        && identity.platformTrackId !== existing.platformTrackId;

      if (!conflictingIsrc && !conflictingPlatformId) {
        return candidate.record;
      }
    }

    return null;
  }

  /**
   * @param {Array<Object>} pages
   * @returns {TrackIdentityIndex}
   */
  static fromNotionPages(pages) {
    const index = new TrackIdentityIndex();
    for (const page of pages) index.addNotionPage(page);
    return index;
  }
}

module.exports = {
  TrackIdentityIndex,
  buildPlatformTrackId,
  buildTitleArtistKey,
  extractPlatformTrackId,
  getNotionText,
  identityFromNotionPage,
  identityFromTrackData,
  normalizeIsrc,
  normalizePlatformTrackId,
  normalizeService,
  normalizeText,
};
