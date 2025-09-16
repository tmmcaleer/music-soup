#!/usr/bin/env node

/**
 * Music Soup CLI Sync Runner
 * 
 * Command-line interface for running playlist synchronization.
 * 
 * Usage:
 *   node sync.js              # Full sync with cleanup
 *   node sync.js --spotify    # Sync only Spotify
 *   node sync.js --apple      # Sync only Apple Music  
 *   node sync.js --cleanup    # Only cleanup removed tracks
 *   node sync.js --dry-run    # Preview changes without applying
 * 
 * Dependencies: syncOrchestrator.js, config.js, utils/logger.js
 */

const syncOrchestrator = require('./syncOrchestrator');
const config = require('./config');
const logger = require('./utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  spotifyOnly: args.includes('--spotify'),
  appleOnly: args.includes('--apple'),
  cleanupOnly: args.includes('--cleanup'),
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h')
};

/**
 * Display help information
 */
function showHelp() {
  console.log(`
🎵 Music Soup - Playlist Sync Automation

USAGE:
  node sync.js [options]

OPTIONS:
  --spotify     Sync only Spotify playlist
  --apple       Sync only Apple Music playlist
  --cleanup     Only cleanup removed tracks
  --dry-run     Preview changes without applying them
  --help, -h    Show this help message

EXAMPLES:
  node sync.js                    # Full sync (recommended)
  node sync.js --spotify          # Sync only Spotify
  node sync.js --dry-run           # Preview what would be synced
  node sync.js --cleanup --dry-run # Preview cleanup actions

CONFIGURATION:
  Configuration is loaded from .env file.
  See env.example for required environment variables.

CURRENT SETTINGS:
  Dry Run: ${config.config.dryRun ? 'ON' : 'OFF'}
  Log Level: ${config.config.logLevel}
  Spotify Playlist: ${config.spotify.playlistId}
  Apple Music Playlist: ${config.appleMusic.playlistId}
  Notion Database: ${config.notion.databaseId}
`);
}

/**
 * Main CLI function
 */
async function main() {
  // Handle help request
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Override dry run if specified
  if (options.dryRun) {
    process.env.DRY_RUN = 'true';
    config.config.dryRun = true;
  }

  try {
    console.log('🎵 Music Soup Sync Starting...\n');
    
    // Log current configuration
    logger.info('Sync configuration', {
      dryRun: config.config.dryRun,
      logLevel: config.config.logLevel,
      options: options
    });

    let results;

    if (options.cleanupOnly) {
      // Only run cleanup
      console.log('🧹 Running cleanup only...\n');
      results = await syncOrchestrator.cleanupRemovedTracks();
      
      console.log('\n📊 Cleanup Results:');
      console.log(`   Tracks marked as removed: ${results.marked}`);
      console.log(`   Errors: ${results.errors}`);

    } else if (options.spotifyOnly) {
      // Only sync Spotify
      console.log('🎧 Syncing Spotify only...\n');
      results = await syncOrchestrator.syncSpotifyPlaylist();
      
      console.log('\n📊 Spotify Sync Results:');
      console.log(`   New tracks added: ${results.added}`);
      console.log(`   Tracks updated: ${results.updated}`);
      console.log(`   Errors: ${results.errors}`);

    } else if (options.appleOnly) {
      // Only sync Apple Music
      console.log('🍎 Syncing Apple Music only...\n');
      results = await syncOrchestrator.syncAppleMusicPlaylist();
      
      console.log('\n📊 Apple Music Sync Results:');
      console.log(`   New tracks added: ${results.added}`);
      console.log(`   Tracks updated: ${results.updated}`);
      console.log(`   Errors: ${results.errors}`);

    } else {
      // Full sync (default)
      console.log('🚀 Running full synchronization...\n');
      results = await syncOrchestrator.fullSync();
      
      console.log('\n📊 Full Sync Results:');
      console.log('═══════════════════════════');
      console.log(`Total Duration: ${results.totalDuration}ms`);
      console.log('');
      console.log('🎧 Spotify:');
      console.log(`   New tracks: ${results.sync.spotify.added}`);
      console.log(`   Updated: ${results.sync.spotify.updated}`);
      console.log(`   Errors: ${results.sync.spotify.errors}`);
      console.log('');
      console.log('🍎 Apple Music:');
      console.log(`   New tracks: ${results.sync.appleMusic.added}`);
      console.log(`   Updated: ${results.sync.appleMusic.updated}`);
      console.log(`   Errors: ${results.sync.appleMusic.errors}`);
      console.log('');
      console.log('🧹 Cleanup:');
      console.log(`   Tracks marked removed: ${results.cleanup.marked}`);
      console.log(`   Errors: ${results.cleanup.errors}`);
      console.log('');
      console.log('📈 Summary:');
      console.log(`   Total processed: ${results.sync.total.processed}`);
      console.log(`   Total successful: ${results.sync.total.successful}`);
      console.log(`   Total errors: ${results.sync.total.errors + results.cleanup.errors}`);
    }

    if (config.config.dryRun) {
      console.log('\n💡 This was a DRY RUN - no changes were actually made to Notion.');
      console.log('   Remove --dry-run flag or set DRY_RUN=false in .env to apply changes.');
    }

    console.log('\n✅ Sync completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    logger.error('CLI sync failed', {
      error: error.message,
      stack: error.stack,
      options: options
    });
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('\n💥 Unexpected error:', error.message);
  logger.error('Uncaught exception in sync CLI', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled promise rejection:', reason);
  logger.error('Unhandled promise rejection in sync CLI', {
    reason: reason,
    promise: promise
  });
  process.exit(1);
});

// Handle SIGINT (Ctrl+C) gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Sync interrupted by user');
  logger.info('Sync interrupted by SIGINT');
  process.exit(0);
});

// Run the CLI
main().catch(error => {
  console.error('\n💥 CLI execution failed:', error.message);
  process.exit(1);
});
