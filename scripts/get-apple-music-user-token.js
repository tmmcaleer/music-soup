#!/usr/bin/env node

/**
 * Apple Music User Token Generator
 * 
 * This script helps generate an Apple Music user token for accessing personal music library.
 * Run with: node scripts/get-apple-music-user-token.js
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Load config for Apple Music credentials
const config = require('../config');

const TEAM_ID = config.appleMusic.teamId;
const KEY_ID = config.appleMusic.keyId;
const PRIVATE_KEY = config.appleMusic.privateKey;
const PORT = 3001;

/**
 * Generate Apple Music developer token (same as in appleMusicClient.js)
 */
function generateDeveloperToken() {
  const jwt = require('jsonwebtoken');
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: TEAM_ID,
    iat: now,
    exp: now + (180 * 24 * 60 * 60), // 180 days
    aud: 'appstoreconnect-v1',
  };

  const header = {
    alg: 'ES256',
    kid: KEY_ID,
  };

  return jwt.sign(payload, PRIVATE_KEY, { 
    algorithm: 'ES256',
    header: header
  });
}

/**
 * Create HTML page for Apple Music authorization
 */
function createAuthPage(developerToken) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Apple Music Authorization</title>
    <meta name="appleitunes" content="app-id=myAppId">
    <meta name="apple-music-developer-token" content="${developerToken}">
    <meta name="apple-music-app-name" content="Music Soup">
    <meta name="apple-music-app-build" content="1.0">
    <script src="https://js-cdn.music.apple.com/musickit/v1/musickit.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        .button { background: #007AFF; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 16px; }
        .button:hover { background: #0056CC; }
        .success { background: #34C759; color: white; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .error { background: #FF3B30; color: white; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .token { background: #f0f0f0; padding: 16px; border-radius: 8px; word-break: break-all; font-family: monospace; }
    </style>
</head>
<body>
    <h1>🍎 Apple Music User Token Generator</h1>
    <p>Click the button below to authorize Music Soup to access your Apple Music library:</p>
    
    <button id="authorize" class="button">Authorize Apple Music Access</button>
    <div id="status"></div>
    <div id="result"></div>

    <script>
        document.addEventListener('DOMContentLoaded', async function () {
            try {
                // Configure MusicKit
                await MusicKit.configure({
                    developerToken: '${developerToken}',
                    app: {
                        name: 'Music Soup',
                        build: '1.0'
                    }
                });
                
                const music = MusicKit.getInstance();
                
                document.getElementById('authorize').addEventListener('click', async () => {
                    try {
                        document.getElementById('status').innerHTML = '<div style="color: #007AFF;">Requesting authorization...</div>';
                        
                        // Request user authorization
                        const userToken = await music.authorize();
                        
                        document.getElementById('status').innerHTML = '<div class="success">✅ Authorization successful!</div>';
                        document.getElementById('result').innerHTML = \`
                            <h2>Your Apple Music User Token:</h2>
                            <div class="token">\${userToken}</div>
                            <p><strong>Instructions:</strong></p>
                            <ol>
                                <li>Copy the token above</li>
                                <li>Go to GitHub → Settings → Secrets → Actions</li>
                                <li>Add new secret: <code>APPLE_MUSIC_USER_TOKEN</code></li>
                                <li>Paste the token as the value</li>
                            </ol>
                        \`;
                        
                        // Send token to local server for easy copying
                        fetch('/save-token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userToken })
                        });
                        
                    } catch (error) {
                        document.getElementById('status').innerHTML = \`<div class="error">❌ Authorization failed: \${error.message}</div>\`;
                        console.error('Authorization error:', error);
                    }
                });
                
            } catch (error) {
                document.getElementById('status').innerHTML = \`<div class="error">❌ MusicKit configuration failed: \${error.message}</div>\`;
                console.error('MusicKit error:', error);
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Create local server to handle the authorization flow
 */
function createAuthServer() {
  return new Promise((resolve, reject) => {
    let userToken = null;
    
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      
      if (parsedUrl.pathname === '/') {
        // Serve the authorization page
        try {
          const developerToken = generateDeveloperToken();
          const html = createAuthPage(developerToken);
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${error.message}</p>`);
        }
        
      } else if (parsedUrl.pathname === '/save-token' && req.method === 'POST') {
        // Save the user token
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            userToken = data.userToken;
            
            console.log('\n🎉 SUCCESS! Apple Music User Token obtained:');
            console.log('==========================================');
            console.log(`APPLE_MUSIC_USER_TOKEN=${userToken}`);
            console.log('\n💡 Add this to your GitHub Secrets:');
            console.log('1. Go to: https://github.com/tmmcaleer/music-soup/settings/secrets/actions');
            console.log('2. Click "New repository secret"');
            console.log('3. Name: APPLE_MUSIC_USER_TOKEN');
            console.log(`4. Value: ${userToken}`);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            
            // Close server after successful token retrieval
            setTimeout(() => {
              console.log('\n✅ Server closing. Token saved successfully!');
              server.close();
              resolve(userToken);
            }, 2000);
            
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      }
    });
    
    server.listen(PORT, () => {
      console.log(`🍎 Apple Music User Token Generator`);
      console.log(`==================================\n`);
      console.log(`1. Open this URL in your browser:`);
      console.log(`   http://localhost:${PORT}`);
      console.log(`\n2. Click "Authorize Apple Music Access"`);
      console.log(`3. Sign in with your Apple ID when prompted`);
      console.log(`4. Your user token will be displayed and logged here\n`);
      console.log(`💡 Make sure you're signed into the Apple ID that has access to your music!\n`);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error.message);
      reject(error);
    });
  });
}

async function main() {
  if (!TEAM_ID || !KEY_ID || !PRIVATE_KEY) {
    console.error('❌ Missing Apple Music configuration in .env file');
    console.error('Make sure APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY are set');
    process.exit(1);
  }
  
  try {
    await createAuthServer();
  } catch (error) {
    console.error('\n❌ Failed to get Apple Music user token:', error.message);
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
