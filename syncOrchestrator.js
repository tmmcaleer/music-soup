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
const membershipStore = require('./membershipStore');
const { planPlaylistMemberships } = require('./utils/playlistMemberships');
const { NOTION_FIELDS } = require('./schema');
const { NotionOperationError } = require('./utils/notionRetry');
const { TrackIdentityReviewError, trackFacts } = require('./utils/trackMatchDecision');
const { runReadOnly } = require('./utils/mutationGuard');
const {
  TrackIdentityIndex,
} = require('./utils/trackIdentity');
const SYNC_POLICY_VERSION = 'playlist-membership-v1-library-retention';

/**
 * Build the complete, run-scoped state used for matching and cleanup.
 * A failed or partial Notion read throws before any playlist is processed.
 * @returns {Promise<Object>}
 */
async function createSyncContext(options = {}) {
  const membershipState = await membershipStore.readState({ allowUninitialized: options.initializeMemberships === true });
  const notionPages = await notionClient.queryAllDatabase();
  return {
    notionPages,
    membershipState,
    shadow: options.shadow === true,
    proposals: [],
    memberships: new Map(),
    playlistSnapshots: new Map(),
    identityIndex: TrackIdentityIndex.fromNotionPages(notionPages),
    currentPlaylistTracks: [],
    playlistFetchFailures: [],
  };
}

/**
 * @param {Object|undefined} context
 * @returns {Promise<Object>}
 */
async function ensureSyncContext(context) {
  const result = context || await createSyncContext();
  result.proposals ||= [];
  result.memberships ||= new Map();
  result.playlistSnapshots ||= new Map();
  result.currentPlaylistTracks ||= [];
  result.playlistFetchFailures ||= [];
  return result;
}

function addProposal(context, proposal) {
  const key = JSON.stringify([proposal.kind, proposal.pageId, proposal.sourceId, proposal.reasons]);
  if (!context.proposals.some(item => item.key === key)) context.proposals.push({ key, ...proposal });
}

async function readPlaylistSnapshot(service, playlistId, context) {
  const key = service + ':' + playlistId;
  if (context.playlistSnapshots.has(key)) return context.playlistSnapshots.get(key);
  const client = service === 'spotify' ? spotifyClient : appleMusicClient;
  if (!await client.checkServiceHealth()) throw new Error(service + ' service is not available');
  const playlist = await client.getPlaylist(playlistId);
  const tracks = await client.getPlaylistTracks(playlistId, { playlistName: playlist.name });
  if (!Array.isArray(tracks)) throw new Error('Incomplete playlist snapshot: expected track array');
  if (typeof playlist.trackCount === 'number' && tracks.length !== playlist.trackCount) {
    throw new Error('Incomplete playlist snapshot: expected ' + playlist.trackCount + ' tracks, received ' + tracks.length);
  }
  const snapshot = { service, playlistId, playlist, tracks, complete: true, observedAt: new Date().toISOString() };
  context.playlistSnapshots.set(key, snapshot);
  const configured = config.getAllConfiguredPlaylists().find(item => item.service === service && item.id === playlistId);
  context.currentPlaylistTracks.push(...tracks.map(track => ({
    ...track, playlistId, playlistService: service,
    playlist: (service === 'spotify' ? 'Spotify' : 'Apple Music') + ' - ' + playlist.name,
    playlistType: configured?.type, type: configured?.type || track.type,
  })));
  return snapshot;
}

async function readAllPlaylistSnapshots(context) {
  if (context.playlistReadsComplete) return;
  const configured = config.getAllConfiguredPlaylists();
  if (!configured.length) throw new Error('No configured playlists; membership cannot be determined');
  for (const playlist of configured) {
    try {
      await readPlaylistSnapshot(playlist.service, playlist.id, context);
    } catch (error) {
      context.playlistFetchFailures.push({ service: playlist.service, playlistId: playlist.id, error: error.message });
    }
  }
  if (context.playlistFetchFailures.length) {
    throw new Error('Playlist snapshot incomplete; no sync actions are allowed: ' + context.playlistFetchFailures[0].error);
  }
  // Validate provider IDs and the membership inventory before any normal create.
  planPlaylistMemberships(context.membershipState, [...context.playlistSnapshots.values()]);
  context.playlistReadsComplete = true;
}

function recordMembership(context, pageId, trackData) {
  const observations = context.memberships.get(pageId) || [];
  const observation = {
    service: trackData.source, sourceId: trackFacts(trackData).platformId,
    playlistId: trackData.playlistId, playlistName: trackData.playlist,
    type: trackData.playlistType || trackData.type,
  };
  if (!observations.some(item => JSON.stringify(item) === JSON.stringify(observation))) observations.push(observation);
  context.memberships.set(pageId, observations);
}

/**
 * Sync all configured playlists to Notion
 * @returns {Promise<Object>} - Sync summary statistics
 */
async function syncAllPlaylists(context) {
  const syncContext = await ensureSyncContext(context);
  const syncStart = Date.now();
  const summary = {
    spotify: { added: 0, updated: 0, skipped: 0, review: 0, proposed: 0, errors: 0 },
    appleMusic: { added: 0, updated: 0, skipped: 0, review: 0, proposed: 0, errors: 0 },
    total: { processed: 0, successful: 0, skipped: 0, review: 0, proposed: 0, errors: 0 },
    newTracks: [],
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
    // Prove every configured playlist read complete before the first write.
    await readAllPlaylistSnapshots(syncContext);
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
          result = await syncSpotifyPlaylist(playlist.id, playlist.type, syncContext);
        } else if (playlist.service === 'appleMusic') {
          logger.info('🍎 Syncing Apple Music playlist', { 
            playlistId: playlist.id, 
            type: playlist.type,
            key: playlist.key 
          });
          result = await syncAppleMusicPlaylist(playlist.id, playlist.type, syncContext);
        }

        if (result) {
          // Accumulate results by service
          if (playlist.service === 'spotify') {
            summary.spotify.added += result.added;
            summary.spotify.updated += result.updated;
            summary.spotify.skipped += result.skipped;
            summary.spotify.errors += result.errors;
            summary.spotify.review += result.review;
            summary.spotify.proposed += result.proposed;
          } else if (playlist.service === 'appleMusic') {
            summary.appleMusic.added += result.added;
            summary.appleMusic.updated += result.updated;
            summary.appleMusic.skipped += result.skipped;
            summary.appleMusic.errors += result.errors;
            summary.appleMusic.review += result.review;
            summary.appleMusic.proposed += result.proposed;
          }

          summary.total.processed += result.added + result.updated;
          summary.total.successful += result.added + result.updated;
          summary.total.skipped += result.skipped;
          summary.total.errors += result.errors;
          summary.total.review += result.review;
          summary.total.proposed += result.proposed;
          summary.newTracks.push(...(result.newTracks || []));
        }

      } catch (error) {
        if (error instanceof NotionOperationError) {
          throw error;
        }

        syncContext.playlistFetchFailures.push({
          service: playlist.service,
          playlistId: playlist.id,
          error: error.message,
        });
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
async function syncSpotifyPlaylist(playlistId, playlistType = 'Source', context) {
  const syncContext = await ensureSyncContext(context);
  const results = { added: 0, updated: 0, skipped: 0, review: 0, proposed: 0, errors: 0, tracks: [], newTracks: [] };

  try {
    await readAllPlaylistSnapshots(syncContext);
    const { playlist, tracks } = await readPlaylistSnapshot('spotify', playlistId, syncContext);
    
    // Process each track
    for (const track of tracks) {
      try {
        // Add playlist type to track data and override the type field
        const trackWithPlaylistInfo = {
          ...track,
          type: playlistType,
          playlistType: playlistType,
          playlistId
        };
        
        const result = await syncTrackToNotion(trackWithPlaylistInfo, syncContext);
        results.tracks.push({ track: track.title, result });
        
        if (result === 'created') {
          results.added++;
          results.newTracks.push({
            title: track.title,
            artist: track.artist,
            service: 'spotify',
            playlistType,
          });
        } else if (result === 'updated') {
          results.updated++;
        } else if (result === 'skipped') {
          results.skipped++;
        } else if (result === 'review') {
          results.review++;
        } else if (result === 'proposed') {
          results.proposed++;
        }
        
        // Add small delay to respect rate limits
        if (!syncContext.shadow) await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        if (error instanceof NotionOperationError) {
          throw error;
        }
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
async function syncAppleMusicPlaylist(playlistId, playlistType = 'Source', context) {
  const syncContext = await ensureSyncContext(context);
  const results = { added: 0, updated: 0, skipped: 0, review: 0, proposed: 0, errors: 0, tracks: [], newTracks: [] };

  try {
    await readAllPlaylistSnapshots(syncContext);
    const { playlist, tracks } = await readPlaylistSnapshot('appleMusic', playlistId, syncContext);
    
    // Process each track
    for (const track of tracks) {
      try {
        // Add playlist type to track data and override the type field
        const trackWithPlaylistInfo = {
          ...track,
          type: playlistType,
          playlistType: playlistType,
          playlistId
        };
        
        const result = await syncTrackToNotion(trackWithPlaylistInfo, syncContext);
        results.tracks.push({ track: track.title, result });
        
        if (result === 'created') {
          results.added++;
          results.newTracks.push({
            title: track.title,
            artist: track.artist,
            service: 'appleMusic',
            playlistType,
          });
        } else if (result === 'updated') {
          results.updated++;
        } else if (result === 'skipped') {
          results.skipped++;
        } else if (result === 'review') {
          results.review++;
        } else if (result === 'proposed') {
          results.proposed++;
        }
        
        // Add small delay to respect rate limits
        if (!syncContext.shadow) await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        if (error instanceof NotionOperationError) {
          throw error;
        }
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
async function syncTrackToNotion(trackData, context) {
  const syncContext = await ensureSyncContext(context);
  // Exported single-playlist/track entry points have the same preflight gate.
  await readAllPlaylistSnapshots(syncContext);
  try {
    let existingTrack = syncContext.identityIndex.find(trackData);
    if (!existingTrack && !syncContext.shadow) {
      // This lookup uses the same conservative validator and propagates errors.
      existingTrack = await notionClient.findTrackByIdentity(trackData);
      if (existingTrack) syncContext.identityIndex.addNotionPage(existingTrack);
    }
    if (existingTrack) {
      recordMembership(syncContext, existingTrack.id, trackData);
      if (trackFacts(existingTrack).removed) {
        addProposal(syncContext, {
          kind: 'review_reactivation', pageId: existingTrack.id,
          sourceId: trackFacts(trackData).platformId,
          reasons: ['present_in_current_playlist_but_legacy_removed'],
          requiresApproval: true,
        });
        return 'review';
      }
      return 'skipped'; // Canonical and manually edited metadata stays intact.
    }
    if (syncContext.shadow) {
      const id = 'shadow:' + trackFacts(trackData).platformId;
      const proposed = { id };
      addProposal(syncContext, {
        kind: 'create', pageId: id, sourceId: trackFacts(trackData).platformId,
        track: trackData, requiresApproval: true,
      });
      syncContext.identityIndex.addTrackData(trackData, proposed);
      recordMembership(syncContext, id, trackData);
      return 'proposed';
    }
    const newPage = await notionClient.createTrack(trackData);
    syncContext.notionPages.push(newPage);
    syncContext.identityIndex.addTrackData(trackData, newPage);
    recordMembership(syncContext, newPage.id, trackData);
    return 'created';
  } catch (error) {
    if (error instanceof TrackIdentityReviewError) {
      addProposal(syncContext, {
        kind: 'review_identity', sourceId: trackFacts(trackData).platformId,
        track: trackData, reasons: error.decision.reasons,
        candidates: error.decision.candidates.map(candidate => ({
          pageId: candidate.recordId, reasons: candidate.reasons,
          duration: candidate.duration, evidence: candidate.evidence,
        })), requiresApproval: true,
      });
      return 'review';
    }
    throw error;
  }
}

/**
 * Reconcile per-playlist membership; legacy Removed/Source stay read-only.
 * @returns {Promise<Object>} - Cleanup results
 */
async function cleanupRemovedTracks(context) {
  const syncContext = await ensureSyncContext(context);
  await readAllPlaylistSnapshots(syncContext);
  for (const track of syncContext.currentPlaylistTracks) {
    const decision = syncContext.identityIndex.decide(track);
    if (decision.outcome !== 'match') continue;
    recordMembership(syncContext, decision.recordId, track);
    if (decision.removed) addProposal(syncContext, {
      kind: 'review_reactivation', pageId: decision.recordId,
      sourceId: trackFacts(track).platformId,
      reasons: ['present_in_current_playlist_but_legacy_removed'], requiresApproval: true,
    });
  }
  const observations = [];
  for (const page of syncContext.notionPages) {
    const facts = trackFacts(page);
    const historicalSource = page.properties?.[NOTION_FIELDS.SOURCE]?.select?.name || '';
    const currentMemberships = syncContext.memberships.get(page.id) || [];
    const state = currentMemberships.length ? 'present' : 'not_confirmed_in_monitored_playlists';
    observations.push({
      pageId: page.id, currentMemberships, state, historicalSource,
      legacyRemoved: facts.removed,
    });
    // Existing Removed/Source fields cannot distinguish human exclusion from
    // playlist absence. Report membership separately; never infer permission
    // to erase an exclusion, recategorize the track, or mark it removed.
  }
  const associations = new Map();
  for (const [pageId, memberships] of syncContext.memberships) {
    for (const membership of memberships) {
      const pages = associations.get(membership.sourceId) || [];
      pages.push(pageId);
      associations.set(membership.sourceId, pages);
    }
  }
  const membershipPlan = planPlaylistMemberships(syncContext.membershipState, [...syncContext.playlistSnapshots.values()], associations);
  const membershipCommit = membershipPlan.status !== 'unconfigured' && !syncContext.shadow && !config.config.dryRun
    ? await membershipStore.commitPlan(membershipPlan)
    : { committed: false };
  return { marked: 0, errors: 0, observations, membershipPlan, membershipCommit,
    mutationPolicy: 'per_playlist_memberships_only_legacy_fields_read_only' };
}

/**
 * Full sync with cleanup - the complete synchronization process
 * @returns {Promise<Object>} - Complete sync results
 */
async function executeFullSync(options = {}) {
  const fullSyncStart = Date.now();
  
  try {
    logger.info('🚀 Starting full synchronization process');

    const context = await createSyncContext(options);

    // Step 1: Sync all playlists
    const syncResults = await syncAllPlaylists(context);

    // Step 2: Cleanup removed tracks
    const cleanupResults = await cleanupRemovedTracks(context);

    const totalDuration = Date.now() - fullSyncStart;

    const fullResults = {
      sync: syncResults,
      cleanup: cleanupResults,
      totalDuration,
      success: syncResults.total.errors === 0 && cleanupResults.errors === 0,
      mode: options.shadow ? 'shadow' : 'sync',
      syncPolicy: SYNC_POLICY_VERSION,
      proposals: context.proposals,
      observedPlaylists: [...context.playlistSnapshots.values()].map(snapshot => ({
        service: snapshot.service, playlistId: snapshot.playlistId,
        name: snapshot.playlist.name, trackCount: snapshot.tracks.length,
      })),
      writesSuppressed: options.shadow === true
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

async function fullSync(options = {}) {
  if (!options.shadow) return executeFullSync(options);
  return runReadOnly(async () => {
    try {
      return await executeFullSync({ ...options, shadow: true });
    } catch (error) {
      return {
        mode: 'shadow', success: false, blocked: true, writesSuppressed: true,
        proposals: [], error: error.message,
      };
    }
  });
}

module.exports = {
  SYNC_POLICY_VERSION,
  createSyncContext,
  syncAllPlaylists,
  syncSpotifyPlaylist,
  syncAppleMusicPlaylist,
  syncTrackToNotion,
  cleanupRemovedTracks,
  fullSync
};
