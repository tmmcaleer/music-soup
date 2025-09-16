# Music Soup Scripts

This directory contains utility scripts for setting up and managing Music Soup.

## 🎵 Spotify Token Generator

**`get-spotify-token.js`** - Generates a Spotify refresh token for API access.

### Usage:
1. Make sure your Spotify app is configured with redirect URI: `http://localhost:3000/callback`
2. Run the script: `node scripts/get-spotify-token.js`
3. Open the displayed URL in your browser
4. Log into Spotify and authorize the app
5. Copy the refresh token to your `.env` file

### Required Spotify App Settings:
- **Redirect URIs**: `http://localhost:3000/callback`
- **Scopes needed**: `playlist-read-private`, `playlist-read-collaborative`, `user-read-private`, `user-read-email`

## 📝 Notion Setup

For Notion integration, you need to:

1. **Create a Notion integration**: https://www.notion.so/my-integrations
2. **Get the integration token** (starts with `secret_`)
3. **Create a database** with the required schema (see schema.js)
4. **Share the database** with your integration
5. **Copy the database ID** from the URL

## 🍎 Apple Music Setup

For Apple Music, you need:

1. **Developer account** with Apple Music API access
2. **Music User Token** - requires authenticating with an Apple Music subscriber account
3. **Your current setup looks good** - the developer token is working!

## 🔧 Troubleshooting

### Spotify Issues:
- `invalid_grant` error = bad refresh token, regenerate with this script
- `403` error = check scopes in your Spotify app settings
- `404` error = check playlist ID and make sure it's accessible

### Notion Issues:
- `unauthorized` error = bad integration token or token format
- `404` error = database not shared with integration or wrong database ID
- `400` error = schema mismatch, check field names and types

### Apple Music Issues:
- `401/403` errors = check user token or private key format
- `404` errors = check playlist ID format (should start with `pl.`)
- Token generation errors = check team ID, key ID, and private key

## 🎯 Quick Fixes

If you're getting errors, try these common fixes:

1. **Regenerate tokens** using the scripts in this directory
2. **Check field formats** in your .env file (no spaces around `=`)
3. **Verify permissions** for all integrations and apps
4. **Test individual components** with `node integration-test.js`

