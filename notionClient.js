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
const { withNotionRetry } = require('./utils/notionRetry');
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
 * Query all pages in the database, following pagination.
 * @param {Object} [filters]
 * @returns {Promise<Array>}
 */
async function queryAllDatabase(filters) {
  const results = [];
  let cursor;

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

    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
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
  const incoming = identityFromTrackData(trackData);

  if (incoming.isrc) {
    const isrcMatch = await findTrackByIsrc(incoming.isrc);
    if (isrcMatch) return isrcMatch;
  }

  if (incoming.platformTrackId) {
    const platformMatches = await queryDatabase({
      property: NOTION_FIELDS.PLATFORM_TRACK_ID,
      rich_text: { equals: incoming.platformTrackId },
    });
    if (platformMatches.length > 0) return platformMatches[0];
  }

  if (trackData.url) {
    const urlMatches = await queryDatabase({
      property: NOTION_FIELDS.URL,
      url: { equals: trackData.url },
    });
    if (urlMatches.length > 0) return urlMatches[0];
  }

  if (!trackData.title || !trackData.artist) return null;

  const titleMatches = await queryDatabase({
    property: NOTION_FIELDS.TRACK_TITLE,
    title: { equals: trackData.title },
  });
  const normalizedArtist = normalizeText(trackData.artist);
  const compatibleMatches = titleMatches.filter((page) => {
    const existingArtist = page.properties[NOTION_FIELDS.ARTIST]?.rich_text?.[0]?.text?.content;
    if (!existingArtist || normalizeText(existingArtist) !== normalizedArtist) return false;

    const existing = identityFromNotionPage(page);
    const conflictingIsrc = incoming.isrc && existing.isrc && incoming.isrc !== existing.isrc;
    const conflictingPlatformId = incoming.platformTrackId
      && existing.platformTrackId
      && incoming.platformTrackId !== existing.platformTrackId;
    return !conflictingIsrc && !conflictingPlatformId;
  });

  return compatibleMatches.find(
    (page) => !page.properties[NOTION_FIELDS.REMOVED]?.checkbox
  ) || compatibleMatches[0] || null;
}

/**
 * Create new track record in Notion
 * @param {Object} trackData - Track metadata object
 * @returns {Promise<Object>} - Created page object
 */
async function createTrack(trackData) {
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
 * Mark track as removed
 * @param {string} pageId - Page ID to mark as removed
 * @returns {Promise<Object>} - Updated page object
 */
async function markTrackRemoved(pageId) {
  try {
    if (config.config.dryRun) {
      logger.info('DRY RUN: Would mark track as removed', { pageId });
      return { id: pageId };
    }

    // Notion Update Page: https://developers.notion.com/reference/patch-page
    const response = await withNotionRetry('mark track removed', () => notion.pages.update({
        page_id: pageId,
        properties: {
          [NOTION_FIELDS.REMOVED]: {
            checkbox: true,
          },
        },
      }), { mode: 'update' });

    logger.info(`Marked track as removed`, { pageId });
    return response;
  } catch (error) {
    logger.error(`Failed to mark track as removed ${pageId}: ${error.message}`, error);
    throw error;
  }
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

  if (trackData.playlist) {
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

  // Set removed to false for new/updated tracks
  properties[NOTION_FIELDS.REMOVED] = {
    checkbox: formatCheckbox(false),
  };

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
