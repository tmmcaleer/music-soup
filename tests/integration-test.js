/**
 * Integration Test for Music Soup API Clients
 * 
 * This script tests authentication and basic API connectivity.
 * Requires real API credentials in .env file.
 * 
 * Run with: node integration-test.js
 */

const config = require('../config');
const logger = require('../utils/logger');

async function testSpotifyAuth() {
  console.log('🎵 Testing Spotify authentication...');
  
  try {
    const spotifyClient = require('../spotifyClient');
    
    // Test if we can get an access token
    const token = await spotifyClient.getAccessToken();
    console.log('✅ Spotify auth successful');
    console.log('   - Token obtained:', token ? 'Yes' : 'No');
    
    // Test service health
    const isHealthy = await spotifyClient.checkServiceHealth();
    console.log('   - Service health:', isHealthy ? '✅ Healthy' : '❌ Unhealthy');
    
    return true;
  } catch (error) {
    console.error('❌ Spotify auth failed:', error.message);
    return false;
  }
}

async function testAppleMusicAuth() {
  console.log('\n🍎 Testing Apple Music authentication...');
  
  try {
    const appleMusicClient = require('../appleMusicClient');
    
    // Test developer token generation
    const token = appleMusicClient.getDeveloperToken();
    console.log('✅ Apple Music developer token generated');
    console.log('   - Token obtained:', token ? 'Yes' : 'No');
    
    // Test service health (this will test both dev token and user token)
    const isHealthy = await appleMusicClient.checkServiceHealth();
    console.log('   - Service health:', isHealthy ? '✅ Healthy' : '❌ Unhealthy');
    
    return true;
  } catch (error) {
    console.error('❌ Apple Music auth failed:', error.message);
    return false;
  }
}

async function testNotionConnection() {
  console.log('\n📝 Testing Notion connection...');
  
  try {
    const notionClient = require('../notionClient');
    
    // Test if we can retrieve the database schema
    const schema = await notionClient.getDatabaseSchema();
    console.log('✅ Notion connection successful');
    console.log('   - Database found:', schema.title?.[0]?.text?.content || 'Untitled');
    console.log('   - Properties count:', Object.keys(schema.properties).length);
    
    // List the properties to verify schema
    console.log('   - Available properties:');
    Object.keys(schema.properties).forEach(prop => {
      const type = schema.properties[prop].type;
      console.log(`     • ${prop} (${type})`);
    });
    
    return true;
  } catch (error) {
    console.error('❌ Notion connection failed:', error.message);
    if (error.message.includes('401')) {
      console.error('   💡 Check your NOTION_KEY in .env file');
    }
    if (error.message.includes('404')) {
      console.error('   💡 Check your NOTION_DB_ID in .env file');
      console.error('   💡 Make sure the integration has access to the database');
    }
    return false;
  }
}

async function testPlaylistAccess() {
  console.log('\n📋 Testing playlist access...');
  
  const results = {
    spotify: false,
    appleMusic: false
  };
  
  // Test Spotify playlist access
  try {
    const spotifyClient = require('../spotifyClient');
    const playlistId = config.spotify.playlists.source.id;
    if (!playlistId) {
      console.log('⚠️  Spotify playlist ID not configured, skipping playlist access test');
      return results;
    }
    const playlist = await spotifyClient.getPlaylist(playlistId);
    console.log('✅ Spotify playlist accessible');
    console.log(`   - Name: ${playlist.name}`);
    console.log(`   - Tracks: ${playlist.trackCount}`);
    results.spotify = true;
  } catch (error) {
    console.error('❌ Spotify playlist access failed:', error.message);
    if (error.message.includes('404')) {
      console.error('   💡 Check your SPOTIFY_PLAYLIST_ID in .env file');
    }
  }
  
  // Test Apple Music playlist access
  try {
    const appleMusicClient = require('../appleMusicClient');
    const playlistId = config.appleMusic.playlists.source.id;
    if (!playlistId) {
      console.log('⚠️  Apple Music playlist ID not configured, skipping playlist access test');
      return results;
    }
    const playlist = await appleMusicClient.getPlaylist(playlistId);
    console.log('✅ Apple Music playlist accessible');
    console.log(`   - Name: ${playlist.name}`);
    console.log(`   - Tracks: ${playlist.trackCount}`);
    results.appleMusic = true;
  } catch (error) {
    console.error('❌ Apple Music playlist access failed:', error.message);
    if (error.message.includes('404')) {
      console.error('   💡 Check your APPLE_MUSIC_PLAYLIST_ID in .env file');
    }
    if (error.message.includes('403')) {
      console.error('   💡 Check your APPLE_MUSIC_USER_TOKEN in .env file');
    }
  }
  
  return results;
}

async function main() {
  console.log('🧪 Music Soup Integration Test\n');
  console.log('This test requires real API credentials in your .env file\\n');
  
  // Check if .env exists
  const fs = require('fs');
  if (!fs.existsSync('.env')) {
    console.error('❌ No .env file found!');
    console.error('💡 Copy env.example to .env and fill in your credentials');
    process.exit(1);
  }
  
  const results = {
    spotify: false,
    appleMusic: false,
    notion: false,
    playlistAccess: { spotify: false, appleMusic: false }
  };
  
  // Run tests
  results.spotify = await testSpotifyAuth();
  results.appleMusic = await testAppleMusicAuth();
  results.notion = await testNotionConnection();
  results.playlistAccess = await testPlaylistAccess();
  
  // Summary
  console.log('\n📊 Integration Test Summary');
  console.log('════════════════════════════');
  console.log(`Spotify Auth:        ${results.spotify ? '✅ Pass' : '❌ Fail'}`);
  console.log(`Apple Music Auth:    ${results.appleMusic ? '✅ Pass' : '❌ Fail'}`);
  console.log(`Notion Connection:   ${results.notion ? '✅ Pass' : '❌ Fail'}`);
  console.log(`Spotify Playlist:    ${results.playlistAccess.spotify ? '✅ Pass' : '❌ Fail'}`);
  console.log(`Apple Music Playlist: ${results.playlistAccess.appleMusic ? '✅ Pass' : '❌ Fail'}`);
  
  const allPassed = results.spotify && results.appleMusic && results.notion && 
                   results.playlistAccess.spotify && results.playlistAccess.appleMusic;
  
  if (allPassed) {
    console.log('\n🎉 All integration tests passed! Ready for full sync testing.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check your .env configuration and API access.');
  }
  
  console.log('\n💡 Next step: Run a test sync with a few tracks to validate end-to-end flow');
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('\n💥 Unexpected error:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled promise rejection:', reason);
  process.exit(1);
});

main().catch(error => {
  console.error('\n💥 Integration test failed:', error.message);
  process.exit(1);
});

