/**
 * Configuration Module
 * 
 * Centralized access to all environment variables with validation.
 * All other modules MUST access environment variables through this file.
 * 
 * Dependencies: None
 */

const fs = require('fs');
const path = require('path');

// Load .env file if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

/**
 * Validate required environment variables
 * @param {string} key - Environment variable name
 * @returns {string} - Environment variable value
 * @throws {Error} - If required variable is missing
 */
function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 * @param {string} key - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} - Environment variable value or default
 */
function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

// Notion Configuration
const notion = {
  apiKey: requireEnv('NOTION_KEY'),
  databaseId: requireEnv('NOTION_DB_ID'),
};

// Spotify Configuration
const spotify = {
  clientId: requireEnv('SPOTIFY_CLIENT_ID'),
  clientSecret: requireEnv('SPOTIFY_CLIENT_SECRET'),
  refreshToken: requireEnv('SPOTIFY_REFRESH_TOKEN'),
  playlistId: requireEnv('SPOTIFY_PLAYLIST_ID'),
};

// Apple Music Configuration
const appleMusic = {
  teamId: getEnv('APPLE_MUSIC_TEAM_ID'),
  keyId: getEnv('APPLE_MUSIC_KEY_ID'),
  privateKey: (() => {
    const key = getEnv('APPLE_MUSIC_PRIVATE_KEY');
    if (!key) return key;
    // Only replace \\n if the key doesn't already contain real newlines
    return key.includes('\n') ? key : key.replace(/\\n/g, '\n');
  })(),
  userToken: getEnv('APPLE_MUSIC_USER_TOKEN'),
  playlistId: getEnv('APPLE_MUSIC_PLAYLIST_ID'),
  storefront: getEnv('APPLE_MUSIC_STOREFRONT', 'us'),
};

// Playlist Type Configuration
// Maps playlist IDs to their types (Source/Temp)
const playlistTypes = {
  [spotify.playlistId]: getEnv('SPOTIFY_PLAYLIST_TYPE', 'Source'),
  [appleMusic.playlistId]: getEnv('APPLE_MUSIC_PLAYLIST_TYPE', 'Source'),
};

// General Configuration
const config = {
  syncIntervalMinutes: parseInt(getEnv('SYNC_INTERVAL_MINUTES', '5')),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  dryRun: getEnv('DRY_RUN', 'false').toLowerCase() === 'true',
};

module.exports = {
  notion,
  spotify,
  appleMusic,
  playlistTypes,
  config,
  requireEnv,
  getEnv,
};

