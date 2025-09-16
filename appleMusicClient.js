/**
 * Apple Music API Client
 * 
 * Handles all Apple Music API interactions including developer token generation,
 * playlist fetching, and track metadata retrieval.
 * 
 * Dependencies: jsonwebtoken, node-fetch, config.js, endpoints.js, utils/logger.js
 * API Docs: https://developer.apple.com/documentation/applemusicapi/
 */

const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const config = require('./config');
const { APPLE_MUSIC } = require('./endpoints');
const logger = require('./utils/logger');

// Cache for developer token
let developerToken = null;
let tokenExpiry = null;

/**
 * Generate Apple Music Developer Token
 * @returns {string} - JWT developer token
 */
function generateDeveloperToken() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + (6 * 30 * 24 * 60 * 60); // 6 months

    const payload = {
      iss: config.appleMusic.teamId,
      iat: now,
      exp: expiry,
    };

    const token = jwt.sign(payload, config.appleMusic.privateKey, {
      algorithm: 'ES256',
      keyid: config.appleMusic.keyId,
    });

    developerToken = token;
    tokenExpiry = expiry * 1000; // Convert to milliseconds

    logger.info('Apple Music developer token generated', {
      teamId: config.appleMusic.teamId,
      keyId: config.appleMusic.keyId,
      expiresAt: new Date(tokenExpiry).toISOString(),
    });

    return token;
  } catch (error) {
    logger.error(`Failed to generate Apple Music developer token: ${error.message}`, error);
    throw error;
  }
}

/**
 * Get valid developer token, generating if necessary
 * @returns {string} - Valid developer token
 */
function getDeveloperToken() {
  // Return cached token if still valid (refresh 1 day early)
  if (developerToken && tokenExpiry && Date.now() < (tokenExpiry - 86400000)) {
    return developerToken;
  }

  return generateDeveloperToken();
}

/**
 * Make authenticated request to Apple Music API with retry logic
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} - API response data
 */
async function appleMusicRequest(url, options = {}) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const devToken = getDeveloperToken();
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${devToken}`,
          'Music-User-Token': config.appleMusic.userToken,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      // Handle rate limiting (Apple Music uses different status codes)
      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        logger.warn(`Apple Music rate limited, waiting ${retryAfter}s`, {
          url,
          status: response.status,
          retryAfter,
          attempt: retryCount + 1,
        });
        
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // Handle token issues
      if (response.status === 401 || response.status === 403) {
        logger.warn('Apple Music auth failed', { 
          status: response.status,
          attempt: retryCount + 1 
        });
        
        // Try regenerating developer token
        developerToken = null;
        retryCount++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Apple Music API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // Log any API warnings or rate limit info
      const warnings = response.headers.get('x-apple-music-warnings');
      if (warnings) {
        logger.warn('Apple Music API warnings', { warnings });
      }

      return data;
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        logger.error(`Apple Music request failed after ${maxRetries} attempts: ${error.message}`, {
          url,
          error: error.message,
        });
        throw error;
      }
      
      retryCount++;
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      logger.warn(`Apple Music request failed, retrying in ${delay}ms`, {
        url,
        attempt: retryCount,
        error: error.message,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Get playlist metadata
 * @param {string} playlistId - Apple Music playlist ID
 * @returns {Promise<Object>} - Playlist metadata
 */
async function getPlaylist(playlistId) {
  try {
    // Apple Music Get Playlist: https://developer.apple.com/documentation/applemusicapi/get_a_catalog_playlist
    const url = APPLE_MUSIC.PLAYLIST(config.appleMusic.storefront, playlistId);
    const data = await appleMusicRequest(url);

    const playlist = data.data[0];
    if (!playlist) {
      throw new Error(`Playlist ${playlistId} not found`);
    }

    logger.debug(`Retrieved Apple Music playlist`, {
      playlistId,
      name: playlist.attributes.name,
      trackCount: playlist.attributes.trackCount,
    });

    return {
      id: playlist.id,
      name: playlist.attributes.name,
      description: playlist.attributes.description?.standard || '',
      trackCount: playlist.attributes.trackCount,
      url: playlist.attributes.url,
      curatorName: playlist.attributes.curatorName,
    };
  } catch (error) {
    logger.error(`Failed to get Apple Music playlist ${playlistId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Get all tracks from a playlist with pagination
 * @param {string} playlistId - Apple Music playlist ID
 * @returns {Promise<Array>} - Array of track objects
 */
async function getPlaylistTracks(playlistId) {
  try {
    const tracks = [];
    let nextUrl = `${APPLE_MUSIC.PLAYLIST_TRACKS(config.appleMusic.storefront, playlistId)}?limit=100`;
    
    while (nextUrl) {
      // Apple Music Get Playlist Tracks: https://developer.apple.com/documentation/applemusicapi/get_a_catalog_playlist_s_tracks
      const data = await appleMusicRequest(nextUrl);
      
      // Process each track
      if (data.data) {
        for (const track of data.data) {
          if (track.type === 'songs') {
            const trackData = await processTrackData(track, playlistId);
            tracks.push(trackData);
          }
        }
      }
      
      // Check for pagination
      nextUrl = data.next ? `${APPLE_MUSIC.BASE_URL}${data.next}` : null;
      
      logger.debug(`Processed Apple Music playlist page`, {
        playlistId,
        pageItems: data.data?.length || 0,
        totalSoFar: tracks.length,
        hasMore: !!nextUrl,
      });
    }

    logger.info(`Retrieved all Apple Music playlist tracks`, {
      playlistId,
      totalTracks: tracks.length,
    });

    return tracks;
  } catch (error) {
    logger.error(`Failed to get Apple Music playlist tracks ${playlistId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Get detailed track information
 * @param {string} trackId - Apple Music track ID
 * @returns {Promise<Object>} - Track metadata
 */
async function getTrack(trackId) {
  try {
    // Apple Music Get Song: https://developer.apple.com/documentation/applemusicapi/get_a_catalog_song
    const url = APPLE_MUSIC.SONG(config.appleMusic.storefront, trackId);
    const data = await appleMusicRequest(url);

    const track = data.data[0];
    if (!track) {
      throw new Error(`Track ${trackId} not found`);
    }

    logger.debug(`Retrieved Apple Music track`, {
      trackId,
      name: track.attributes.name,
      artist: track.attributes.artistName,
    });

    return track;
  } catch (error) {
    logger.error(`Failed to get Apple Music track ${trackId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Process track data into normalized format
 * @param {Object} track - Apple Music track object
 * @param {string} playlistId - Source playlist ID
 * @returns {Promise<Object>} - Normalized track data
 */
async function processTrackData(track, playlistId) {
  const missingFields = [];
  const attrs = track.attributes;
  
  // Basic track information
  const trackData = {
    source: 'Apple Music',
    sourceId: track.id,
    title: attrs.name,
    url: attrs.url,
    duration: attrs.durationInMillis ? Math.round(attrs.durationInMillis / 1000) : null,
    trackNumber: attrs.trackNumber,
    explicit: attrs.contentRating === 'explicit',
  };

  // Artist information
  if (attrs.artistName) {
    trackData.artist = attrs.artistName;
    trackData.performedBy = attrs.artistName;
  } else {
    missingFields.push('artist');
  }

  // Album information
  if (attrs.albumName) {
    trackData.album = attrs.albumName;
  } else {
    missingFields.push('album');
  }

  // Release date
  if (attrs.releaseDate) {
    trackData.releaseDate = attrs.releaseDate;
  } else {
    missingFields.push('releaseDate');
  }

  // Label/Publisher information
  if (attrs.recordLabel) {
    trackData.label = attrs.recordLabel;
  } else {
    missingFields.push('label');
  }

  // ISRC
  if (attrs.isrc) {
    trackData.isrc = attrs.isrc;
  } else {
    missingFields.push('isrc');
  }

  // Composer information (Apple Music specific)
  if (attrs.composerName) {
    trackData.composer = attrs.composerName;
  }

  // Genre information
  if (attrs.genreNames && attrs.genreNames.length > 0) {
    trackData.genre = attrs.genreNames.join(', ');
  }

  // Playlist information
  const playlistType = config.playlistTypes[playlistId] || 'Source';
  trackData.type = playlistType;
  
  // Get playlist name for reference
  try {
    const playlist = await getPlaylist(playlistId);
    trackData.playlist = playlist.name;
  } catch (error) {
    logger.warn(`Could not get playlist name for ${playlistId}, using ID`, error);
    trackData.playlist = playlistId;
  }

  // Log metadata gaps
  if (missingFields.length > 0) {
    logger.metadataGap(track.id, 'Apple Music', missingFields);
  }

  return trackData;
}

/**
 * Extract playlist ID from Apple Music URL
 * @param {string} url - Apple Music playlist URL
 * @returns {string|null} - Playlist ID or null if invalid
 */
function extractPlaylistId(url) {
  // Handle both catalog and library playlist URLs
  const catalogRegex = /music\.apple\.com\/[^/]+\/playlist\/[^/]+\/pl\.([a-zA-Z0-9_-]+)/;
  const libraryRegex = /music\.apple\.com\/[^/]+\/playlist\/pl\.([a-zA-Z0-9_-]+)/;
  
  let match = url.match(catalogRegex);
  if (!match) {
    match = url.match(libraryRegex);
  }
  
  return match ? `pl.${match[1]}` : null;
}

/**
 * Check if Apple Music service is available
 * @returns {Promise<boolean>} - Service availability status
 */
async function checkServiceHealth() {
  try {
    getDeveloperToken();
    
    // Test with a simple API call
    const testUrl = `${APPLE_MUSIC.BASE_URL}/catalog/${config.appleMusic.storefront}/genres`;
    await appleMusicRequest(testUrl);
    
    return true;
  } catch (error) {
    logger.error(`Apple Music service health check failed: ${error.message}`, error);
    return false;
  }
}

module.exports = {
  getPlaylist,
  getPlaylistTracks,
  getTrack,
  processTrackData,
  extractPlaylistId,
  checkServiceHealth,
  getDeveloperToken,
  generateDeveloperToken,
};

