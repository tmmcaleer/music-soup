/**
 * Spotify Refresh Token Generator
 * 
 * This script helps generate a Spotify refresh token for the Music Soup app.
 * Run with: node scripts/get-spotify-token.js
 */

const http = require('http');
const url = require('url');
const querystring = require('querystring');
const fetch = require('node-fetch');

// Load config for client credentials
const config = require('../config');

const CLIENT_ID = config.spotify.clientId;
const CLIENT_SECRET = config.spotify.clientSecret;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const PORT = 3000;

// Required scopes for playlist access
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email'
].join(' ');

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(code) {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
      body: querystring.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokens = await response.json();
    return tokens;
  } catch (error) {
    console.error('Error exchanging code for tokens:', error.message);
    throw error;
  }
}

/**
 * Create HTTP server to handle OAuth callback
 */
function createCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/callback') {
        const { code, error } = parsedUrl.query;
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>Authorization failed.</p>`);
          reject(new Error(`Spotify authorization error: ${error}`));
          return;
        }
        
        if (code) {
          try {
            const tokens = await exchangeCodeForTokens(code);
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <h1>✅ Success!</h1>
              <p>Authorization successful. You can close this window.</p>
              <h2>Your Refresh Token:</h2>
              <code style="background: #f0f0f0; padding: 10px; display: block; word-break: break-all;">
                ${tokens.refresh_token}
              </code>
              <h2>Your Access Token (expires in ${tokens.expires_in} seconds):</h2>
              <code style="background: #f0f0f0; padding: 10px; display: block; word-break: break-all;">
                ${tokens.access_token}
              </code>
            `);
            
            console.log('\n🎉 SUCCESS! Your Spotify tokens:');
            console.log('=====================================');
            console.log('Refresh Token (add this to your .env file):');
            console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}`);
            console.log('\nAccess Token (temporary, will be auto-refreshed):');
            console.log(tokens.access_token);
            console.log('\nExpires in:', tokens.expires_in, 'seconds');
            
            resolve(tokens);
            
            // Close server after successful exchange
            setTimeout(() => {
              server.close();
            }, 1000);
            
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Error</h1><p>${error.message}</p>`);
            reject(error);
          }
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      }
    });
    
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Callback server running on http://127.0.0.1:${PORT}`);
    });
  });
}

async function main() {
  console.log('🎵 Spotify Refresh Token Generator');
  console.log('==================================\n');
  
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing Spotify credentials in .env file');
    console.error('Make sure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set');
    process.exit(1);
  }
  
  // Build authorization URL
  const authUrl = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    show_dialog: 'true', // Force re-authorization for testing
  });
  
  console.log('1. Starting callback server...');
  
  try {
    // Start the callback server
    const tokensPromise = createCallbackServer();
    
    console.log('2. Open this URL in your browser to authorize the app:');
    console.log('\n' + authUrl + '\n');
    console.log('3. After authorizing, you\'ll be redirected back here with your tokens.\n');
    console.log('💡 Make sure you\'re logged into the Spotify account that has access to your playlist!\n');
    
    // Wait for authorization
    const tokens = await tokensPromise;
    
    console.log('\n✅ Done! Copy the refresh token to your .env file.');
    
  } catch (error) {
    console.error('\n❌ Failed to get Spotify tokens:', error.message);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Exiting...');
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Unexpected error:', error.message);
  process.exit(1);
});
