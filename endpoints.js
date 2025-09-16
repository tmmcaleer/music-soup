/**
 * API Endpoints Configuration
 * 
 * Centralized constants for all external API endpoints.
 * All API calls MUST reference these constants and include links to official documentation.
 * 
 * Dependencies: None
 */

// Spotify Web API Endpoints
// Documentation: https://developer.spotify.com/documentation/web-api/
const SPOTIFY = {
  BASE_URL: 'https://api.spotify.com/v1',
  TOKEN: 'https://accounts.spotify.com/api/token',
  PLAYLIST: (playlistId) => `https://api.spotify.com/v1/playlists/${playlistId}`,
  PLAYLIST_TRACKS: (playlistId) => `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
  TRACK: (trackId) => `https://api.spotify.com/v1/tracks/${trackId}`,
  ALBUM: (albumId) => `https://api.spotify.com/v1/albums/${albumId}`,
};

// Apple Music API Endpoints  
// Documentation: https://developer.apple.com/documentation/applemusicapi/
const APPLE_MUSIC = {
  BASE_URL: 'https://api.music.apple.com/v1',
  PLAYLIST: (storefront, playlistId) => `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}`,
  PLAYLIST_TRACKS: (storefront, playlistId) => `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${playlistId}/tracks`,
  SONG: (storefront, songId) => `https://api.music.apple.com/v1/catalog/${storefront}/songs/${songId}`,
  ALBUM: (storefront, albumId) => `https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}`,
};

// Notion API Endpoints
// Documentation: https://developers.notion.com/reference/
const NOTION = {
  BASE_URL: 'https://api.notion.com/v1',
  DATABASE_QUERY: (databaseId) => `https://api.notion.com/v1/databases/${databaseId}/query`,
  DATABASE_RETRIEVE: (databaseId) => `https://api.notion.com/v1/databases/${databaseId}`,
  PAGE_CREATE: 'https://api.notion.com/v1/pages',
  PAGE_UPDATE: (pageId) => `https://api.notion.com/v1/pages/${pageId}`,
  PAGE_RETRIEVE: (pageId) => `https://api.notion.com/v1/pages/${pageId}`,
};

module.exports = {
  SPOTIFY,
  APPLE_MUSIC,
  NOTION,
};

