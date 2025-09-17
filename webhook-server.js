/**
 * Notion Webhook Server
 * 
 * Receives webhook events from Notion automations and triggers GitHub Actions
 * workflow via repository_dispatch events.
 * 
 * SECURITY NOTE: This code is in a public GitHub repo.
 * - NO sensitive data is hardcoded
 * - Secrets are provided via environment variables
 * - Deploy to Fly.io using `fly secrets set` for security
 * 
 * Setup:
 * 1. Deploy to Fly.io (see FLYIO_SETUP.md)
 * 2. Set secrets: fly secrets set GITHUB_TOKEN=your_token
 * 3. Configure Notion webhook with your Fly.io URL
 */

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables needed:
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // GitHub Personal Access Token
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'tmmcaleer'; // GitHub username
const GITHUB_REPO = process.env.GITHUB_REPO || 'music-soup'; // Repository name
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Optional: secret for webhook validation

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    server: 'notion-webhook-server'
  });
});

/**
 * Notion webhook endpoint
 * Receives POST requests from Notion automations
 */
app.post('/notion-webhook', async (req, res) => {
  console.log('🔔 Webhook received from Notion');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    // Optional: Validate webhook secret if configured
    if (WEBHOOK_SECRET) {
      const receivedSecret = req.headers['x-webhook-secret'] || req.body.secret;
      if (receivedSecret !== WEBHOOK_SECRET) {
        console.error('❌ Invalid webhook secret');
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    // Trigger GitHub Actions workflow
    const success = await triggerGitHubWorkflow(req.body);
    
    if (success) {
      console.log('✅ Successfully triggered GitHub Actions workflow');
      res.json({ 
        status: 'success', 
        message: 'Music sync workflow triggered',
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('❌ Failed to trigger GitHub Actions workflow');
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to trigger workflow' 
      });
    }

  } catch (error) {
    console.error('💥 Error processing webhook:', error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

/**
 * Trigger GitHub Actions workflow via repository_dispatch
 */
async function triggerGitHubWorkflow(notionData) {
  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN not configured');
    return false;
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;
    
    const payload = {
      event_type: 'notion-sync',
      client_payload: {
        source: 'notion-webhook',
        timestamp: new Date().toISOString(),
        notion_data: notionData
      }
    };

    console.log(`🚀 Triggering GitHub workflow: ${url}`);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'notion-webhook-server'
      }
    });

    console.log('✅ GitHub API Response:', response.status);
    return response.status === 204; // GitHub returns 204 for successful dispatch

  } catch (error) {
    console.error('❌ GitHub API Error:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log('🎵 Notion Webhook Server Started');
  console.log('================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/notion-webhook`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📋 Required Environment Variables:');
  console.log(`   GITHUB_TOKEN: ${GITHUB_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`   GITHUB_OWNER: ${GITHUB_OWNER}`);
  console.log(`   GITHUB_REPO: ${GITHUB_REPO}`);
  console.log(`   WEBHOOK_SECRET: ${WEBHOOK_SECRET ? '✅ Set' : '⚠️  Optional'}`);
  console.log('');
  console.log('🚀 Ready to receive Notion webhooks!');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down webhook server...');
  process.exit(0);
});

module.exports = app;
