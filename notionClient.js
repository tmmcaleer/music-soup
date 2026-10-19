/**
 * Notion API Client
 * 
 * Handles all Notion API interactions including database queries, page creation,
 * and updates for the music sync automation.
 * 
 * Dependencies: @notionhq/client, config.js, schema.js, utils/logger.js
 * API Docs: https://developers.notion.com/reference/
 */

const { Client } = require('@notionhq/client');
const config = require('./config');
const { NOTION_FIELDS, formatRichText, formatTitle, formatDate, formatDuration, formatReleaseYear, formatSelect, formatUrl, formatNumber, formatCheckbox, formatMultiSelect } = require('./schema');
const { NOTION } = require('./endpoints');
const logger = require('./utils/logger');
const { assertWriteAllowed } = require('./utils/mutationGuard');
const { withNotionRetry, NotionOperationError } = require('./utils/notionRetry');
const { decideTrackMatch, TrackIdentityReviewError } = require('./utils/trackMatchDecision');
const {
  buildPlatformTrackId,
  identityFromNotionPage,
  identityFromTrackData,
  normalizeText,
} = require('./utils/trackIdentity');

// Initialize Notion client
const notion = new Client({
  auth: config.notion.apiKey,
});

/**
 * Query database for existing tracks
 * @param {Object} filters - Notion filter object
 * @returns {Promise<Array>} - Array of page objects
 */
async function queryDatabase(filters = {}) {
  try {
    // Notion Database Query: https://developers.notion.com/reference/post-database-query
    const response = await withNotionRetry('query database', () => notion.databases.query({
        database_id: config.notion.databaseId,
        page_size: 100,
        filter: filters,
        sorts: [
          {
            property: NOTION_FIELDS.CREATED_TIME,
            direction: 'descending',
          },
        ],
      }), { mode: 'read' });

    logger.debug(`Queried Notion database`, {
      databaseId: config.notion.databaseId,
      resultCount: response.results.length,
    });

    return response.results;
  } catch (error) {
    logger.error(`Failed to query Notion database: ${error.message}`, error);
    throw error;
  }
}

/**
 * Reject partial page objects before they can hide an existing identity.
 * Empty property values are valid; missing or malformed containers are not.
 */
function validateInventoryPage(page, seenPageIds) {
  const fail = reason => { throw new NotionOperationError('database snapshot', new Error(reason)); };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(page) || page.object !== 'page' || typeof page.id !== 'string' || !page.id.trim() || !isObject(page.properties)) {
    fail('Missing or malformed Notion page identity/properties');
  }
  if (seenPageIds.has(page.id)) fail('Duplicate Notion page ID in database snapshot: ' + page.id);
  seenPageIds.add(page.id);

  const required = [
    [NOTION_FIELDS.TRACK_TITLE, 'title'], [NOTION_FIELDS.ARTIST, 'rich_text'],
    [NOTION_FIELDS.ALBUM, 'rich_text'], [NOTION_FIELDS.ISRC_UPC, 'rich_text'],
    [NOTION_FIELDS.PLATFORM_TRACK_ID, 'rich_text'], [NOTION_FIELDS.DURATION, 'rich_text'],
    [NOTION_FIELDS.TRACK_NUMBER, 'number'], [NOTION_FIELDS.URL, 'url'],
    [NOTION_FIELDS.REMOVED, 'checkbox'], [NOTION_FIELDS.SOURCE, 'select'],
  ];
  if ('Disc Number' in page.properties) required.push(['Disc Number', 'number']);
  for (const [name, type] of required) {
    const property = page.properties[name];
    if (!isObject(property) || (property.type !== undefined && property.type !== type) || property.has_more === true) {
      fail('Missing, malformed or truncated Notion property: ' + name);
    }
    const value = property[type];
    let valid;
    if (type === 'title' || type === 'rich_text') {
      valid = Array.isArray(value) && value.every(item => isObject(item)
        && (typeof item.plain_text === 'string' || typeof item.text?.content === 'string')
        && (item.plain_text === undefined || typeof item.plain_text === 'string')
        && (item.text === undefined || (isObject(item.text) && typeof item.text.content === 'string')));
    } else if (type === 'number') {
      valid = value === null || (typeof value === 'number' && Number.isFinite(value));
    } else if (type === 'url') {
      valid = value === null || typeof value === 'string';
    } else if (type === 'checkbox') {
      valid = typeof value === 'boolean';
    } else if (type === 'select') {
      valid = value === null || (isObject(value) && typeof value.name === 'string');
    }
    if (!valid) fail('Missing or malformed Notion property value: ' + name);
  }
}

/**
 * Query all pages in the database, following pagination.
 * @param {Object} [filters]
 * @returns {Promise<Array>}
 */
async function queryAllDatabase(filters) {
  const results = [];
  let cursor;
  const seenCursors = new Set();
  const seenPageIds = new Set();

  do {
    const query = {
      database_id: config.notion.databaseId,
      page_size: 100,
      start_cursor: cursor,
      sorts: [
        {
          property: NOTION_FIELDS.CREATED_TIME,
          direction: 'descending',
        },
      ],
    };

    if (filters && Object.keys(filters).length > 0) {
      query.filter = filters;
    }

    const response = await withNotionRetry(
      `query database page${cursor ? ` after ${cursor}` : ''}`,
      () => notion.databases.query(query),
      { mode: 'read' }
    );

    if (!response || !Array.isArray(response.results) || response.results.length > query.page_size || typeof response.has_more !== 'boolean') {
      throw new NotionOperationError('database snapshot', new Error('Missing result page or invalid pagination state'));
    }
    if (response.has_more && (typeof response.next_cursor !== 'string' || !response.next_cursor.trim() || seenCursors.has(response.next_cursor))) {
      throw new NotionOperationError('database snapshot', new Error('Incomplete or repeated pagination cursor'));
    }
    if ((!response.has_more && response.next_cursor !== null) || (response.has_more && response.results.length === 0)) {
      throw new NotionOperationError('database snapshot', new Error('Inconsistent pagination state'));
    }
    response.results.forEach(page => validateInventoryPage(page, seenPageIds));
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  logger.debug('Queried all Notion database pages', {
    databaseId: config.notion.databaseId,
    resultCount: results.length,
  });

  return results;
}

/**
 * Search for existing track by ISRC
 * @param {string} isrc - ISRC code to search for
 * @returns {Promise<Object|null>} - Existing page object or null
 */
async function findTrackByIsrc(isrc) {
  if (!isrc) return null;

  const filter = {
    property: NOTION_FIELDS.ISRC_UPC,
    rich_text: {
      equals: isrc,
    },
  };

  const results = await queryDatabase(filter);

  if (results.length > 0) {
    const activeTrack = results.find(
      (page) => !page.properties[NOTION_FIELDS.REMOVED]?.checkbox
    );
    const match = activeTrack || results[0];
    logger.debug(`Found existing track by ISRC`, { isrc, pageId: match.id });
    return match;
  }

  return null;
}

/**
 * Search for existing track by title and artist
 * @param {string} title - Track title
 * @param {string} artist - Track artist
 * @returns {Promise<Object|null>} - Existing page object or null
 */
async function findTrackByTitleArtist(title, artist) {
  if (!title || !artist) return null;

  const filter = {
    property: NOTION_FIELDS.TRACK_TITLE,
    title: {
      equals: title,
    },
  };

  const results = await queryDatabase(filter);
  const normalizedArtist = normalizeText(artist);

  for (const result of results) {
    const existingArtist = result.properties[NOTION_FIELDS.ARTIST]?.rich_text?.[0]?.text?.content;
    if (existingArtist && normalizeText(existingArtist) === normalizedArtist) {
      logger.debug(`Found existing track by title/artist`, {
        title,
        artist,
        pageId: result.id,
      });
      return result;
    }
  }

  return null;
}

/**
 * Perform a final live identity check immediately before a create.
 * Lookup errors throw; they are never interpreted as "not found".
 * @param {Object} trackData
 * @returns {Promise<Object|null>}
 */
async function findTrackByIdentity(trackData) {
  // The final check must also see duplicate/contradictory identities, including
  // legacy rows whose persisted IDs do not match their displayed URL. It uses
  // the same decision as the in-memory index: platform track ID first, ISRC
  // only as a cross-service hint when no page carries that platform ID.
  const pages = await queryAllDatabase();
  const decision = decideTrackMatch(trackData, pages);
  if (decision.outcome === 'review') throw new TrackIdentityReviewError(decision);
  return decision.outcome === 'match' ? decision.record : null;
}

/**
 * Create new track record in Notion
 * @param {Object} trackData - Track metadata object
 * @returns {Promise<Object>} - Created page object
 */
async function createTrack(trackData) {
  assertWriteAllowed('createTrack');
  try {
    const properties = buildTrackProperties(trackData);
    
    if (config.config.dryRun) {
      logger.info('DRY RUN: Would create track', { trackData });
      return { id: 'dry-run-id', properties };
    }

    // Notion Create Page: https://developers.notion.com/reference/post-page
    const response = await withNotionRetry('create track page', () => notion.pages.create({
        parent: {
          database_id: config.notion.databaseId,
        },
        properties,
      }), { mode: 'create' });

    logger.info(`Created new track record`, {
      pageId: response.id,
      title: trackData.title,
      artist: trackData.artist,
      source: trackData.source,
    });

    return response;
  } catch (error) {
    logger.error(`Failed to create track: ${error.message}`, {
      trackData,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Update existing track record in Notion
 * @param {string} pageId - Page ID to update
 * @param {Object} trackData - Track metadata object
 * @returns {Promise<Object>} - Updated page object
 */
async function updateTrack(pageId, trackData) {
  assertWriteAllowed('updateTrack');
  try {
    const properties = buildTrackProperties(trackData, true);
    
    if (config.config.dryRun) {
      logger.info('DRY RUN: Would update track', { pageId, trackData });
      return { id: pageId, properties };
    }

    // Notion Update Page: https://developers.notion.com/reference/patch-page
    const response = await withNotionRetry('update track page', () => notion.pages.update({
        page_id: pageId,
        properties,
      }), { mode: 'update' });

    logger.info(`Updated track record`, {
      pageId,
      title: trackData.title,
      artist: trackData.artist,
      source: trackData.source,
    });

    return response;
  } catch (error) {
    logger.error(`Failed to update track ${pageId}: ${error.message}`, {
      pageId,
      trackData,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Legacy entry point: playlist removal must not change a global music flag.
 * @param {string} pageId - Page ID to mark as removed
 * @returns {Promise<Object>} - Updated page object
 */
async function markTrackRemoved(pageId) {
  assertWriteAllowed('markTrackRemoved');
  throw new Error('Global Removed updates are disabled; reconcile per-playlist membership instead');
}

/**
 * Build Notion properties object from track data
 * @param {Object} trackData - Track metadata
 * @param {boolean} isUpdate - Whether this is an update (preserve manual fields)
 * @returns {Object} - Notion properties object
 */
function buildTrackProperties(trackData, isUpdate = false) {
  const properties = {};

  // Always update automated fields
  if (trackData.title) {
    properties[NOTION_FIELDS.TRACK_TITLE] = {
      title: formatTitle(trackData.title),
    };
  }

  if (trackData.trackNumber !== undefined) {
    properties[NOTION_FIELDS.TRACK_NUMBER] = {
      number: formatNumber(trackData.trackNumber),
    };
  }

  if (trackData.album) {
    properties[NOTION_FIELDS.ALBUM] = {
      rich_text: formatRichText(trackData.album),
    };
  }

  if (trackData.artist) {
    properties[NOTION_FIELDS.ARTIST] = {
      rich_text: formatRichText(trackData.artist),
    };
  }

  if (trackData.performedBy) {
    properties[NOTION_FIELDS.PERFORMED_BY] = {
      rich_text: formatRichText(trackData.performedBy),
    };
  }

  if (trackData.releaseDate) {
    properties[NOTION_FIELDS.RELEASE_DATE] = {
      number: formatReleaseYear(trackData.releaseDate),
    };
  }

  if (trackData.duration !== undefined) {
    properties[NOTION_FIELDS.DURATION] = {
      rich_text: formatRichText(formatDuration(trackData.duration)),
    };
  }

  if (trackData.isrc) {
    properties[NOTION_FIELDS.ISRC_UPC] = {
      rich_text: formatRichText(trackData.isrc),
    };
  }

  const platformTrackId = buildPlatformTrackId(trackData);
  if (platformTrackId) {
    properties[NOTION_FIELDS.PLATFORM_TRACK_ID] = {
      rich_text: formatRichText(platformTrackId),
    };
  }

  if (trackData.url) {
    properties[NOTION_FIELDS.URL] = {
      url: formatUrl(trackData.url),
    };
  }

  if (trackData.playlist && !isUpdate) {
    properties[NOTION_FIELDS.SOURCE] = {
      select: formatSelect(trackData.playlist),
    };
  }

  if (trackData.type) {
    properties[NOTION_FIELDS.TYPE] = {
      multi_select: formatMultiSelect(trackData.type),
    };
  }

  if (trackData.composer) {
    properties[NOTION_FIELDS.COMPOSER] = {
      rich_text: formatRichText(trackData.composer),
    };
  }

  // Source/Removed are creation-time legacy fields, never refreshed on updates.
  if (!isUpdate) properties[NOTION_FIELDS.REMOVED] = { checkbox: formatCheckbox(false) };

  return properties;
}

/**
 * Get all tracks from a specific playlist
 * @param {string} playlistName - Name of the playlist
 * @returns {Promise<Array>} - Array of track page objects
 */
async function getPlaylistTracks(playlistName) {
  try {
    const filter = {
      property: NOTION_FIELDS.SOURCE,
      rich_text: {
        equals: playlistName,
      },
    };

    const results = await queryDatabase(filter);
    
    logger.debug(`Retrieved tracks from playlist`, {
      playlistName,
      trackCount: results.length,
    });

    return results;
  } catch (error) {
    logger.error(`Failed to get playlist tracks: ${error.message}`, error);
    throw error;
  }
}

/**
 * Create a top-level comment on a Notion page
 * @param {string} pageId - Notion page ID
 * @param {Array<Object>} richTextBlocks - Notion rich_text blocks
 * @returns {Promise<Object>} - Created comment object
 */
async function createPageComment(pageId, richTextBlocks) {
  assertWriteAllowed('createPageComment');
  try {
    if (config.config.dryRun) {
      logger.info('DRY RUN: Would create page comment', { pageId, richTextBlocks });
      return { id: 'dry-run-comment-id' };
    }

    const response = await withNotionRetry('create page comment', () => notion.comments.create({
        parent: { page_id: pageId },
        rich_text: richTextBlocks,
      }), { mode: 'create' });

    logger.info('Created Notion page comment', { pageId, commentId: response.id });
    return response;
  } catch (error) {
    logger.error(`Failed to create page comment: ${error.message}`, { pageId, error: error.message });
    throw error;
  }
}

/**
 * Get database schema information
 * @returns {Promise<Object>} - Database schema object
 */
async function getDatabaseSchema() {
  try {
    // Notion Retrieve Database: https://developers.notion.com/reference/retrieve-a-database
    const response = await withNotionRetry('retrieve database schema', () => notion.databases.retrieve({
        database_id: config.notion.databaseId,
      }), { mode: 'read' });

    logger.debug(`Retrieved database schema`, {
      databaseId: config.notion.databaseId,
      title: response.title?.[0]?.text?.content,
      propertyCount: Object.keys(response.properties).length,
    });

    return response;
  } catch (error) {
    logger.error(`Failed to retrieve database schema: ${error.message}`, error);
    throw error;
  }
}

module.exports = {
  queryDatabase,
  queryAllDatabase,
  findTrackByIsrc,
  findTrackByTitleArtist,
  findTrackByIdentity,
  createTrack,
  updateTrack,
  markTrackRemoved,
  createPageComment,
  getPlaylistTracks,
  getDatabaseSchema,
  buildTrackProperties,
};
