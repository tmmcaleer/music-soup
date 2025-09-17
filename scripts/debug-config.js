/**
 * Debug configuration to check which secrets are missing
 */

const config = require('../config');

console.log('🔍 Configuration Debug:');
console.log('======================');

console.log('\n📝 Notion:');
console.log('  API Key:', config.notion.apiKey ? '✅ Set' : '❌ Missing');
console.log('  Database ID:', config.notion.databaseId ? '✅ Set' : '❌ Missing');

console.log('\n🎧 Spotify:');
console.log('  Client ID:', config.spotify.clientId ? '✅ Set' : '❌ Missing');
console.log('  Client Secret:', config.spotify.clientSecret ? '✅ Set' : '❌ Missing');
console.log('  Refresh Token:', config.spotify.refreshToken ? '✅ Set' : '❌ Missing');
console.log('  Source Playlist:', config.spotify.playlists.source.id ? '✅ Set' : '❌ Missing');
console.log('  Temp Playlist:', config.spotify.playlists.temp.id ? '✅ Set' : '❌ Empty (optional)');

console.log('\n🍎 Apple Music:');
console.log('  Team ID:', config.appleMusic.teamId ? '✅ Set' : '❌ Missing');
console.log('  Key ID:', config.appleMusic.keyId ? '✅ Set' : '❌ Missing');
console.log('  Private Key:', config.appleMusic.privateKey ? '✅ Set' : '❌ Missing');
console.log('  User Token:', config.appleMusic.userToken ? '✅ Set' : '❌ Missing');
console.log('  Source Playlist:', config.appleMusic.playlists.source.id ? '✅ Set' : '❌ Missing');
console.log('  Temp Playlist:', config.appleMusic.playlists.temp.id ? '✅ Set' : '❌ Missing');
console.log('  Storefront:', config.appleMusic.storefront ? '✅ Set' : '❌ Missing');

// Get all configured playlists
const configuredPlaylists = config.getAllConfiguredPlaylists();

console.log('\n🎯 Configured Playlists:');
if (configuredPlaylists.length === 0) {
  console.log('  ❌ No playlists configured');
} else {
  configuredPlaylists.forEach(playlist => {
    console.log(`  ✅ ${playlist.service} ${playlist.type}: ${playlist.id}`);
  });
}

console.log('\n🎵 Sync Status:');
console.log('  Total playlists to sync:', configuredPlaylists.length);
console.log('  Spotify playlists:', configuredPlaylists.filter(p => p.service === 'spotify').length);
console.log('  Apple Music playlists:', configuredPlaylists.filter(p => p.service === 'appleMusic').length);
