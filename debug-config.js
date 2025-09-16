/**
 * Debug configuration to check which secrets are missing
 */

const config = require('./config');

console.log('🔍 Configuration Debug:');
console.log('======================');

console.log('\n📝 Notion:');
console.log('  API Key:', config.notion.apiKey ? '✅ Set' : '❌ Missing');
console.log('  Database ID:', config.notion.databaseId ? '✅ Set' : '❌ Missing');

console.log('\n🎧 Spotify:');
console.log('  Client ID:', config.spotify.clientId ? '✅ Set' : '❌ Missing');
console.log('  Client Secret:', config.spotify.clientSecret ? '✅ Set' : '❌ Missing');
console.log('  Refresh Token:', config.spotify.refreshToken ? '✅ Set' : '❌ Missing');
console.log('  Playlist ID:', config.spotify.playlistId ? '✅ Set' : '❌ Missing');

console.log('\n🍎 Apple Music:');
console.log('  Team ID:', config.appleMusic.teamId ? '✅ Set' : '❌ Missing');
console.log('  Key ID:', config.appleMusic.keyId ? '✅ Set' : '❌ Missing');
console.log('  Private Key:', config.appleMusic.privateKey ? '✅ Set' : '❌ Missing');
console.log('  User Token:', config.appleMusic.userToken ? '✅ Set' : '❌ Missing');
console.log('  Playlist ID:', config.appleMusic.playlistId ? '✅ Set' : '❌ Missing');
console.log('  Storefront:', config.appleMusic.storefront ? '✅ Set' : '❌ Missing');

// Check the condition that determines if Apple Music runs
const appleMusicWillRun = config.appleMusic.playlistId && config.appleMusic.userToken && 
                         config.appleMusic.playlistId !== 'MISSING_APPLE_MUSIC_PLAYLIST_ID';

console.log('\n🎯 Apple Music Sync Condition:');
console.log('  Will Apple Music sync run?', appleMusicWillRun ? '✅ YES' : '❌ NO');

if (!appleMusicWillRun) {
  console.log('\n🚨 Apple Music will be skipped because:');
  if (!config.appleMusic.playlistId) console.log('  - Missing APPLE_MUSIC_PLAYLIST_ID');
  if (!config.appleMusic.userToken) console.log('  - Missing APPLE_MUSIC_USER_TOKEN');
  if (config.appleMusic.playlistId === 'MISSING_APPLE_MUSIC_PLAYLIST_ID') console.log('  - Playlist ID is default placeholder');
}
