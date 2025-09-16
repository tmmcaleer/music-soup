/**
 * Notion Database Schema Definitions
 * 
 * Defines the structure and field mappings for the Notion database.
 * All Notion field references MUST use these constants to prevent typos and API errors.
 * 
 * Dependencies: None
 */

// Notion Database Property Names
// These MUST match the exact property names in your Notion database
const NOTION_FIELDS = {
  // Automated Fields (managed by sync process)
  TRACK_TITLE: 'Track Title',
  TRACK_NUMBER: 'Track Number', 
  ALBUM: 'Album',
  ARTIST: 'Artist',
  PERFORMED_BY: 'Performed By',
  RELEASE_DATE: 'Release Date',
  DURATION: 'Duration',
  ISRC_UPC: 'ISRC/UPC',
  URL: 'URL',
  PLAYLIST: 'Playlist',
  TYPE: 'Type',
  CREATED_TIME: 'Created time',
  REMOVED: 'Removed',
  
  // Manual Fields (preserved during sync)
  RECORD_DATE: 'Record Date',
  COMPOSER: 'Composer',
  THEMES: 'Themes',
  NOTES: 'Notes', 
  INSTRUMENTS: 'Instruments',
  MOOD: 'Mood/Keywords',
};

// Notion Property Types
// Used for creating and updating database properties
const NOTION_PROPERTY_TYPES = {
  TITLE: 'title',
  RICH_TEXT: 'rich_text',
  NUMBER: 'number',
  SELECT: 'select',
  MULTI_SELECT: 'multi_select',
  DATE: 'date',
  URL: 'url',
  CHECKBOX: 'checkbox',
  CREATED_TIME: 'created_time',
};

// Database Schema Definition
// This defines the expected structure of the Notion database
const DATABASE_SCHEMA = {
  [NOTION_FIELDS.TRACK_TITLE]: {
    type: NOTION_PROPERTY_TYPES.TITLE,
    required: true,
    automated: true,
  },
  [NOTION_FIELDS.TRACK_NUMBER]: {
    type: NOTION_PROPERTY_TYPES.NUMBER,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.ALBUM]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.ARTIST]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.PERFORMED_BY]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.RELEASE_DATE]: {
    type: NOTION_PROPERTY_TYPES.NUMBER,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.DURATION]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.ISRC_UPC]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.URL]: {
    type: NOTION_PROPERTY_TYPES.URL,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.PLAYLIST]: {
    type: NOTION_PROPERTY_TYPES.SELECT,
    required: true,
    automated: true,
  },
  [NOTION_FIELDS.TYPE]: {
    type: NOTION_PROPERTY_TYPES.SELECT,
    required: true,
    automated: true,
    options: ['Source', 'Temp'],
  },
  [NOTION_FIELDS.CREATED_TIME]: {
    type: NOTION_PROPERTY_TYPES.CREATED_TIME,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.REMOVED]: {
    type: NOTION_PROPERTY_TYPES.CHECKBOX,
    required: false,
    automated: true,
  },
  [NOTION_FIELDS.RECORD_DATE]: {
    type: NOTION_PROPERTY_TYPES.DATE,
    required: false,
    automated: false,
  },
  [NOTION_FIELDS.COMPOSER]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: false,
  },
  [NOTION_FIELDS.THEMES]: {
    type: NOTION_PROPERTY_TYPES.MULTI_SELECT,
    required: false,
    automated: false,
  },
  [NOTION_FIELDS.NOTES]: {
    type: NOTION_PROPERTY_TYPES.RICH_TEXT,
    required: false,
    automated: false,
  },
  [NOTION_FIELDS.INSTRUMENTS]: {
    type: NOTION_PROPERTY_TYPES.MULTI_SELECT,
    required: false,
    automated: false,
  },
  [NOTION_FIELDS.MOOD]: {
    type: NOTION_PROPERTY_TYPES.MULTI_SELECT,
    required: false,
    automated: false,
  },
};

// Helper Functions for Notion Property Formatting

/**
 * Format text for Notion rich_text property
 * @param {string} text - Text to format
 * @returns {Array} - Notion rich_text array
 */
function formatRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text) } }];
}

/**
 * Format title for Notion title property
 * @param {string} title - Title to format
 * @returns {Array} - Notion title array
 */
function formatTitle(title) {
  if (!title) return [];
  return [{ type: 'text', text: { content: String(title) } }];
}

/**
 * Format date for Notion date property
 * @param {string|Date} date - Date to format
 * @returns {Object|null} - Notion date object or null
 */
function formatDate(date) {
  if (!date) return null;
  const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : String(date);
  return { start: dateStr };
}

/**
 * Format duration in seconds to MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} - Formatted duration or null
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Extract year from release date
 * @param {string} releaseDate - Release date string (YYYY-MM-DD)
 * @returns {number|null} - Year as number or null
 */
function formatReleaseYear(releaseDate) {
  if (!releaseDate) return null;
  const year = releaseDate.split('-')[0];
  const yearNum = parseInt(year);
  return isNaN(yearNum) ? null : yearNum;
}

/**
 * Format select for Notion select property
 * @param {string} value - Select value
 * @returns {Object|null} - Notion select object or null
 */
function formatSelect(value) {
  if (!value) return null;
  return { name: String(value) };
}

/**
 * Format URL for Notion url property
 * @param {string} url - URL to format
 * @returns {string|null} - Formatted URL or null
 */
function formatUrl(url) {
  if (!url) return null;
  return String(url);
}

/**
 * Format number for Notion number property
 * @param {number|string} number - Number to format
 * @returns {number|null} - Formatted number or null
 */
function formatNumber(number) {
  if (number === null || number === undefined || number === '') return null;
  const parsed = Number(number);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Format checkbox for Notion checkbox property
 * @param {boolean|string} value - Checkbox value
 * @returns {boolean} - Formatted checkbox value
 */
function formatCheckbox(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

module.exports = {
  NOTION_FIELDS,
  NOTION_PROPERTY_TYPES,
  DATABASE_SCHEMA,
  formatRichText,
  formatTitle,
  formatDate,
  formatDuration,
  formatReleaseYear,
  formatSelect,
  formatUrl,
  formatNumber,
  formatCheckbox,
};

