/**
 * Music Soup Sync Orchestrator
 * 
 * Main orchestration logic that coordinates playlist synchronization between
 * Spotify, Apple Music, and Notion database.
 * 
 * Dependencies: config.js, all API clients, utils/logger.js
 */

const config = require('./config');
const logger = require('./utils/logger');
const spotifyClient = require('./spotifyClient');
const appleMusicClient = require('./appleMusicClient');
const notionClient = require('./notionClient');

/**
 * Sync all configured playlists to Notion
 * @returns {Promise<Object>} - Sync summary statistics
 */
async function syncAllPlaylists() {
  const syncStart = Date.now();
  const summary = {
    spotify: { added: 0, updated: 0, skipped: 0, errors: 0 },
    appleMusic: { added: 0, updated: 0, skipped: 0, errors: 0 },
    total: { processed: 0, successful: 0, skipped: 0, errors: 0 },
    duration: 0,
    errors: []
  };

  const configuredPlaylists = config.getAllConfiguredPlaylists();
  
  logger.info('🎵 Starting Music Soup sync process', {
    configuredPlaylists: configuredPlaylists.map(p => ({ service: p.service, type: p.type, id: p.id })),
    totalPlaylists: configuredPlaylists.length,
    dryRun: config.config.dryRun
  });

  try {
    // Sync all configured playlists
    for (const playlist of configuredPlaylists) {
      try {
        let result;
        if (playlist.service === 'spotify') {
          logger.info('🎧 Syncing Spotify playlist', { 
            playlistId: playlist.id, 
            type: playlist.type,
            key: playlist.key 
          });
          result = await syncSpotifyPlaylist(playlist.id, playlist.type);
        } else if (playlist.service === 'appleMusic') {
          logger.info('🍎 Syncing Apple Music playlist', { 
            playlistId: playlist.id, 
            type: playlist.type,
            key: playlist.key 
          });
          result = await syncAppleMusicPlaylist(playlist.id, playlist.type);
        }

        if (result) {
          // Accumulate results by service
          if (playlist.service === 'spotify') {
            summary.spotify.added += result.added;
            summary.spotify.updated += result.updated;
            summary.spotify.skipped += result.skipped;
            summary.spotify.errors += result.errors;
          } else if (playlist.service === 'appleMusic') {
            summary.appleMusic.added += result.added;
            summary.appleMusic.updated += result.updated;
            summary.appleMusic.skipped += result.skipped;
            summary.appleMusic.errors += result.errors;
          }

          summary.total.processed += result.added + result.updated;
          summary.total.successful += result.added + result.updated;
          summary.total.skipped += result.skipped;
          summary.total.errors += result.errors;
        }

      } catch (error) {
        logger.error(`Failed to sync ${playlist.service} playlist ${playlist.id}`, {
          playlistType: playlist.type,
          error: error.message
        });
        if (playlist.service === 'spotify') {
          summary.spotify.errors++;
        } else if (playlist.service === 'appleMusic') {
          summary.appleMusic.errors++;
        }
        summary.total.errors++;
      }
    }

    if (configuredPlaylists.length === 0) {
      logger.warn('⚠️  No playlists configured for sync');
    }

    summary.duration = Date.now() - syncStart;

    logger.info('✅ Sync process completed', {
      duration: `${summary.duration}ms`,
      totalProcessed: summary.total.processed,
      totalSuccessful: summary.total.successful,
      totalSkipped: summary.total.skipped,
      totalErrors: summary.total.errors,
      spotify: summary.spotify,
      appleMusic: summary.appleMusic
    });

    return summary;

  } catch (error) {
    summary.duration = Date.now() - syncStart;
    summary.errors.push(error.message);
    logger.error('❌ Sync process failed', {
      error: error.message,
      duration: `${summary.duration}ms`,
      summary
    });
    throw error;
  }
}

/**
 * Sync Spotify playlist to Notion
 * @param {string} playlistId - Spotify playlist ID to sync
 * @param {string} playlistType - Type of playlist (Source/Temp)
 * @returns {Promise<Object>} - Sync results for Spotify
 */
async function syncSpotifyPlaylist(playlistId, playlistType = 'Source') {
  const results = { added: 0, updated: 0, skipped: 0, errors: 0, tracks: [] };

  try {
    // Check Spotify service health
    const isHealthy = await spotifyClient.checkServiceHealth();
    if (!isHealthy) {
      throw new Error('Spotify service is not available');
    }

    // Get playlist metadata
    const playlist = await spotifyClient.getPlaylist(playlistId);
    logger.info(`📋 Processing Spotify playlist: ${playlist.name}`, {
      trackCount: playlist.trackCount,
      playlistId: playlistId,
      playlistType: playlistType
    });

    // Get all tracks from the playlist
    const tracks = await spotifyClient.getPlaylistTracks(playlistId);
    
    // Process each track
    for (const track of tracks) {
      try {
        // Add playlist type to track data and override the type field
        const trackWithPlaylistInfo = {
          ...track,
          type: playlistType,
          playlistType: playlistType
        };
        
        const result = await syncTrackToNotion(trackWithPlaylistInfo);
        results.tracks.push({ track: track.title, result });
        
        if (result === 'created') {
          results.added++;
        } else if (result === 'updated') {
          results.updated++;
        } else if (result === 'skipped') {
          results.skipped++;
        }
        
        // Add small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.errors++;
        logger.error(`Failed to sync Spotify track: ${track.title}`, {
          trackId: track.sourceId,
          playlistType: playlistType,
          error: error.message
        });
      }
    }

    logger.info('🎧 Spotify sync completed', {
      playlistName: playlist.name,
      totalTracks: tracks.length,
      added: results.added,
      updated: results.updated,
      skipped: results.skipped,
      errors: results.errors
    });

    return results;

  } catch (error) {
    logger.error('Failed to sync Spotify playlist', {
      playlistId: playlistId,
      playlistType: playlistType,
      error: error.message
    });
    results.errors++;
    throw error;
  }
}

/**
 * Sync Apple Music playlist to Notion
 * @param {string} playlistId - Apple Music playlist ID to sync
 * @param {string} playlistType - Type of playlist (Source/Temp)
 * @returns {Promise<Object>} - Sync results for Apple Music
 */
async function syncAppleMusicPlaylist(playlistId, playlistType = 'Source') {
  const results = { added: 0, updated: 0, skipped: 0, errors: 0, tracks: [] };

  try {
    // Check Apple Music service health
    const isHealthy = await appleMusicClient.checkServiceHealth();
    if (!isHealthy) {
      throw new Error('Apple Music service is not available');
    }

    // Get playlist metadata
    const playlist = await appleMusicClient.getPlaylist(playlistId);
    logger.info(`📋 Processing Apple Music playlist: ${playlist.name}`, {
      trackCount: playlist.trackCount,
      playlistId: playlistId,
      playlistType: playlistType
    });

    // Get all tracks from the playlist
    const tracks = await appleMusicClient.getPlaylistTracks(playlistId);
    
    // Process each track
    for (const track of tracks) {
      try {
        // Add playlist type to track data and override the type field
        const trackWithPlaylistInfo = {
          ...track,
          type: playlistType,
          playlistType: playlistType
        };
        
        const result = await syncTrackToNotion(trackWithPlaylistInfo);
        results.tracks.push({ track: track.title, result });
        
        if (result === 'created') {
          results.added++;
        } else if (result === 'updated') {
          results.updated++;
        } else if (result === 'skipped') {
          results.skipped++;
        }
        
        // Add small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.errors++;
        logger.error(`Failed to sync Apple Music track: ${track.title}`, {
          trackId: track.sourceId,
          playlistType: playlistType,
          error: error.message
        });
      }
    }

    logger.info('🍎 Apple Music sync completed', {
      playlistName: playlist.name,
      totalTracks: tracks.length,
      added: results.added,
      updated: results.updated,
      skipped: results.skipped,
      errors: results.errors
    });

    return results;

  } catch (error) {
    logger.error('Failed to sync Apple Music playlist', {
      playlistId: playlistId,
      playlistType: playlistType,
      error: error.message
    });
    results.errors++;
    throw error;
  }
}

/**
 * Sync a single track to Notion database
 * @param {Object} trackData - Normalized track data from music service
 * @returns {Promise<string>} - Result: 'created', 'updated', or 'skipped'
 */
async function syncTrackToNotion(trackData) {
  try {
    // First try to find existing track by ISRC (best match)
    let existingTrack = null;
    if (trackData.isrc) {
      existingTrack = await notionClient.findTrackByIsrc(trackData.isrc);
    }

    // If no ISRC match, try title/artist search
    if (!existingTrack) {
      existingTrack = await notionClient.findTrackByTitleArtist(trackData.title, trackData.artist);
    }

    if (existingTrack) {
      // Skip existing track to preserve manual edits
      logger.debug(`Skipped existing track: ${trackData.title}`, {
        pageId: existingTrack.id,
        source: trackData.source,
        reason: 'Preserving manual edits'
      });
      return 'skipped';
    } else {
      // Create new track
      const newPage = await notionClient.createTrack(trackData);
      logger.debug(`Created new track: ${trackData.title}`, {
        pageId: newPage.id,
        source: trackData.source
      });
      return 'created';
    }

  } catch (error) {
    logger.error(`Failed to sync track to Notion: ${trackData.title}`, {
      source: trackData.source,
      sourceId: trackData.sourceId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Clean up removed tracks (mark tracks as removed if they're no longer in playlists)
 * @returns {Promise<Object>} - Cleanup results
 */
async function cleanupRemovedTracks() {
  const results = { marked: 0, errors: 0 };

  try {
    logger.info('🧹 Starting cleanup of removed tracks');

    // Get all tracks from Notion that are not marked as removed
    const allNotionTracks = await notionClient.queryDatabase({
      property: 'Removed',
      checkbox: {
        equals: false
      }
    });

    // Get current playlist tracks from all configured playlists
    const configuredPlaylists = config.getAllConfiguredPlaylists();
    const currentSpotifyTracks = [];
    const currentAppleTracks = [];

    for (const playlist of configuredPlaylists) {
      try {
        if (playlist.service === 'spotify') {
          const tracks = await spotifyClient.getPlaylistTracks(playlist.id);
          currentSpotifyTracks.push(...tracks);
        } else if (playlist.service === 'appleMusic') {
          const tracks = await appleMusicClient.getPlaylistTracks(playlist.id);
          currentAppleTracks.push(...tracks);
        }
      } catch (error) {
        logger.warn(`Failed to get tracks for cleanup from ${playlist.service} playlist ${playlist.id}`, {
          error: error.message
        });
      }
    }

    // Create set of current track identifiers
    const currentTrackIds = new Set();
    [...currentSpotifyTracks, ...currentAppleTracks].forEach(track => {
      if (track.isrc) currentTrackIds.add(track.isrc);
      currentTrackIds.add(`${track.title.toLowerCase()}:${track.artist.toLowerCase()}`);
    });

    // Check each Notion track
    for (const notionTrack of allNotionTracks) {
      try {
        const isrc = notionTrack.properties['ISRC/UPC']?.rich_text?.[0]?.text?.content;
        const title = notionTrack.properties['Track Title']?.title?.[0]?.text?.content;
        const artist = notionTrack.properties['Artist']?.rich_text?.[0]?.text?.content;
        const source = notionTrack.properties['Source']?.select?.name;

        // Skip tracks that were manually added (Link Only or File Upload)
        if (source === 'Link Only' || source === 'File Upload') {
          logger.debug(`Skipping manually added track: ${title}`, {
            source: source,
            pageId: notionTrack.id
          });
          continue;
        }

        let trackExists = false;
        
        // Check by ISRC first
        if (isrc && currentTrackIds.has(isrc)) {
          trackExists = true;
        }
        
        // Check by title/artist
        if (!trackExists && title && artist) {
          const titleArtistKey = `${title.toLowerCase()}:${artist.toLowerCase()}`;
          if (currentTrackIds.has(titleArtistKey)) {
            trackExists = true;
          }
        }

        // Mark as removed if not found in current playlists
        if (!trackExists) {
          await notionClient.markTrackRemoved(notionTrack.id);
          results.marked++;
          logger.info(`Marked track as removed: ${title}`, {
            pageId: notionTrack.id
          });
        }

      } catch (error) {
        results.errors++;
        logger.error(`Failed to process track during cleanup`, {
          pageId: notionTrack.id,
          error: error.message
        });
      }
    }

    logger.info('🧹 Cleanup completed', {
      tracksMarked: results.marked,
      errors: results.errors
    });

    return results;

  } catch (error) {
    logger.error('Failed to cleanup removed tracks', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Full sync with cleanup - the complete synchronization process
 * @returns {Promise<Object>} - Complete sync results
 */
async function fullSync() {
  const fullSyncStart = Date.now();
  
  try {
    logger.info('🚀 Starting full synchronization process');

    // Step 1: Sync all playlists
    const syncResults = await syncAllPlaylists();

    // Step 2: Cleanup removed tracks
    const cleanupResults = await cleanupRemovedTracks();

    const totalDuration = Date.now() - fullSyncStart;

    const fullResults = {
      sync: syncResults,
      cleanup: cleanupResults,
      totalDuration,
      success: true
    };

    logger.info('🎉 Full synchronization completed successfully', {
      totalDuration: `${totalDuration}ms`,
      tracksProcessed: syncResults.total.processed,
      tracksMarkedRemoved: cleanupResults.marked,
      totalErrors: syncResults.total.errors + cleanupResults.errors
    });

    return fullResults;

  } catch (error) {
    const totalDuration = Date.now() - fullSyncStart;
    logger.error('❌ Full synchronization failed', {
      error: error.message,
      duration: `${totalDuration}ms`
    });
    
    throw error;
  }
}

module.exports = {
  syncAllPlaylists,
  syncSpotifyPlaylist,
  syncAppleMusicPlaylist,
  syncTrackToNotion,
  cleanupRemovedTracks,
  fullSync
};
