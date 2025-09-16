/**
 * Spotify API Client
 * 
 * Handles all Spotify Web API interactions including authentication,
 * playlist fetching, and track metadata retrieval.
 * 
 * Dependencies: node-fetch, config.js, endpoints.js, utils/logger.js
 * API Docs: https://developer.spotify.com/documentation/web-api/
 */

const fetch = require('node-fetch');
const config = require('./config');
const { SPOTIFY } = require('./endpoints');
const logger = require('./utils/logger');

// Cache for access token
let accessToken = null;
let tokenExpiry = null;

/**
 * Get valid access token, refreshing if necessary
 * @returns {Promise<string>} - Valid access token
 */
async function getAccessToken() {
  // Return cached token if still valid
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    // Spotify Token Exchange: https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
    const response = await fetch(SPOTIFY.TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.spotify.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
    
    logger.info('Spotify access token refreshed', {
      expiresIn: data.expires_in,
    });

    return accessToken;
  } catch (error) {
    logger.error(`Failed to refresh Spotify access token: ${error.message}`, error);
    throw error;
  }
}

/**
 * Make authenticated request to Spotify API with retry logic
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} - API response data
 */
async function spotifyRequest(url, options = {}) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const token = await getAccessToken();
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '1');
        logger.warn(`Spotify rate limited, waiting ${retryAfter}s`, {
          url,
          retryAfter,
          attempt: retryCount + 1,
        });
        
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // Handle token expiry
      if (response.status === 401) {
        logger.warn('Spotify token expired, refreshing', { attempt: retryCount + 1 });
        accessToken = null; // Force token refresh
        retryCount++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // Log rate limit info if available
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining && parseInt(remaining) < 10) {
        logger.rateLimitInfo('Spotify', parseInt(remaining), Date.now() / 1000 + 3600);
      }

      return data;
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        logger.error(`Spotify request failed after ${maxRetries} attempts: ${error.message}`, {
          url,
          error: error.message,
        });
        throw error;
      }
      
      retryCount++;
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      logger.warn(`Spotify request failed, retrying in ${delay}ms`, {
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
 * @param {string} playlistId - Spotify playlist ID
 * @returns {Promise<Object>} - Playlist metadata
 */
async function getPlaylist(playlistId) {
  try {
    // Spotify Get Playlist: https://developer.spotify.com/documentation/web-api/reference/get-playlist
    const url = SPOTIFY.PLAYLIST(playlistId);
    const data = await spotifyRequest(url);

    logger.debug(`Retrieved Spotify playlist`, {
      playlistId,
      name: data.name,
      trackCount: data.tracks.total,
    });

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      trackCount: data.tracks.total,
      url: data.external_urls.spotify,
    };
  } catch (error) {
    logger.error(`Failed to get Spotify playlist ${playlistId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Get all tracks from a playlist with pagination
 * @param {string} playlistId - Spotify playlist ID
 * @returns {Promise<Array>} - Array of track objects
 */
async function getPlaylistTracks(playlistId) {
  try {
    const tracks = [];
    let nextUrl = SPOTIFY.PLAYLIST_TRACKS(playlistId);
    
    while (nextUrl) {
      // Spotify Get Playlist Tracks: https://developer.spotify.com/documentation/web-api/reference/get-playlists-tracks
      const data = await spotifyRequest(nextUrl);
      
      // Process each track item
      for (const item of data.items) {
        if (item.track && item.track.type === 'track') {
          const trackData = await processTrackData(item.track, playlistId);
          tracks.push(trackData);
        }
      }
      
      nextUrl = data.next;
      
      logger.debug(`Processed Spotify playlist page`, {
        playlistId,
        pageItems: data.items.length,
        totalSoFar: tracks.length,
        hasMore: !!nextUrl,
      });
    }

    logger.info(`Retrieved all Spotify playlist tracks`, {
      playlistId,
      totalTracks: tracks.length,
    });

    return tracks;
  } catch (error) {
    logger.error(`Failed to get Spotify playlist tracks ${playlistId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Get detailed track information
 * @param {string} trackId - Spotify track ID
 * @returns {Promise<Object>} - Track metadata
 */
async function getTrack(trackId) {
  try {
    // Spotify Get Track: https://developer.spotify.com/documentation/web-api/reference/get-track
    const url = SPOTIFY.TRACK(trackId);
    const data = await spotifyRequest(url);

    logger.debug(`Retrieved Spotify track`, {
      trackId,
      name: data.name,
      artist: data.artists[0]?.name,
    });

    return data;
  } catch (error) {
    logger.error(`Failed to get Spotify track ${trackId}: ${error.message}`, error);
    throw error;
  }
}

/**
 * Process track data into normalized format
 * @param {Object} track - Spotify track object
 * @param {string} playlistId - Source playlist ID
 * @returns {Promise<Object>} - Normalized track data
 */
async function processTrackData(track, playlistId) {
  const missingFields = [];
  
  // Basic track information
  const trackData = {
    source: 'Spotify',
    sourceId: track.id,
    title: track.name,
    url: track.external_urls?.spotify,
    duration: track.duration_ms ? Math.round(track.duration_ms / 1000) : null,
    trackNumber: track.track_number,
    explicit: track.explicit,
    popularity: track.popularity,
  };

  // Artist information
  if (track.artists && track.artists.length > 0) {
    trackData.artist = track.artists.map(artist => artist.name).join(', ');
    trackData.performedBy = trackData.artist; // Same for Spotify
  } else {
    missingFields.push('artist');
  }

  // Album information
  if (track.album) {
    trackData.album = track.album.name;
    trackData.releaseDate = track.album.release_date;
    trackData.label = track.album.label;
  } else {
    missingFields.push('album');
  }

  // External IDs (ISRC)
  if (track.external_ids?.isrc) {
    trackData.isrc = track.external_ids.isrc;
  } else {
    missingFields.push('isrc');
  }

  // Playlist information - will be set by orchestrator
  trackData.type = 'Source'; // Default, will be overridden by orchestrator
  
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
    logger.metadataGap(track.id, 'Spotify', missingFields);
  }

  return trackData;
}

/**
 * Extract playlist ID from Spotify URL
 * @param {string} url - Spotify playlist URL
 * @returns {string|null} - Playlist ID or null if invalid
 */
function extractPlaylistId(url) {
  const regex = /spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

/**
 * Check if Spotify service is available
 * @returns {Promise<boolean>} - Service availability status
 */
async function checkServiceHealth() {
  try {
    await getAccessToken();
    return true;
  } catch (error) {
    logger.error(`Spotify service health check failed: ${error.message}`, error);
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
  getAccessToken,
};

