# Notion Webhook Setup Guide

This guide shows how to set up Notion webhooks to trigger music sync automatically when playlists change.

## 🏗️ **Setup Overview**

1. **Run webhook server** in your office (receives Notion webhooks)
2. **Expose server** via ngrok or port forwarding
3. **Configure Notion automation** to send webhooks
4. **Test the integration**

## 📋 **Step 1: Install Dependencies**

```bash
npm install express axios
```

## 🔑 **Step 2: Create GitHub Personal Access Token**

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name: "Music Soup Webhook"
4. Select scopes: **`repo`** (Full control of private repositories)
5. Copy the token (you won't see it again!)

## ⚙️ **Step 3: Configure Environment Variables**

Create a `.env` file in the same directory as `webhook-server.js`:

```bash
# GitHub Configuration
GITHUB_TOKEN=ghp_your_actual_token_here
GITHUB_OWNER=tmmcaleer
GITHUB_REPO=music-soup

# Server Configuration  
WEBHOOK_PORT=3000

# Security (Optional)
WEBHOOK_SECRET=your-secret-here
```

## 🚀 **Step 4: Start the Webhook Server**

```bash
node webhook-server.js
```

You should see:
```
🎵 Notion Webhook Server Started
📡 Server running on port 3000
🔗 Webhook URL: http://localhost:3000/notion-webhook
```

## 🌐 **Step 5: Expose Server (Choose One)**

### Option A: ngrok (Recommended for testing)
```bash
# Install ngrok: https://ngrok.com/
ngrok http 3000
```
Copy the `https://xyz.ngrok.io` URL

### Option B: Port Forwarding (Permanent setup)
Configure your router to forward port 3000 to your office machine.
Use your public IP: `http://your-public-ip:3000/notion-webhook`

## 🔔 **Step 6: Configure Notion Automation**

### Option A: Database Automation (Recommended)
1. Go to your Music Database in Notion
2. Click "•••" → "Database automations"
3. Click "New automation"
4. **Trigger**: "When a page is added" or "When a page is edited"
5. **Action**: "Send webhook"
6. **URL**: `https://your-ngrok-url.ngrok.io/notion-webhook`
7. **Custom Header** (optional):
   - Key: `x-webhook-secret`
   - Value: `your-secret-here`

### Option B: Manual Button (For testing)
1. Add a new property to your database: "Sync" (Button type)
2. Configure the button:
   - **Action**: "Send webhook"
   - **URL**: `https://your-ngrok-url.ngrok.io/notion-webhook`

## 🧪 **Step 7: Test the Integration**

1. **Test the webhook server**:
   ```bash
   curl http://localhost:3000/health
   ```

2. **Test via Notion**:
   - Add a new track to your database, OR
   - Click the "Sync" button if you created one

3. **Check the logs**:
   - Webhook server should show "🔔 Webhook received from Notion"
   - GitHub Actions should trigger a new workflow run

## 🔍 **Troubleshooting**

### Server Issues
- **Port in use**: Change `WEBHOOK_PORT` to a different port
- **Connection refused**: Check firewall settings
- **GitHub API errors**: Verify your `GITHUB_TOKEN` has `repo` permissions

### Notion Issues
- **Webhook not triggering**: Check the automation is enabled
- **403/401 errors**: Verify the webhook URL is correct
- **Payload issues**: Check webhook server logs for details

### ngrok Issues
- **Tunnel expired**: Restart ngrok (free accounts have time limits)
- **URL changed**: Update the URL in Notion automation

## 🔒 **Security Best Practices**

1. **Use HTTPS**: Always use `https://` URLs (ngrok provides this)
2. **Set webhook secret**: Add `WEBHOOK_SECRET` for validation
3. **Limit GitHub token**: Only give `repo` permissions, not more
4. **Monitor logs**: Watch for suspicious webhook requests

## 📊 **Expected Workflow**

1. **Music supervisor** adds/edits tracks in Notion database
2. **Notion automation** sends webhook to your server
3. **Webhook server** triggers GitHub Actions via `repository_dispatch`
4. **GitHub Actions** runs the music sync workflow
5. **Sync completes** and updates the database

## ⏱️ **Performance Notes**

- **No more timeouts**: Unlike cron jobs, this only runs when needed
- **Real-time sync**: Changes sync within seconds of Notion updates
- **Rate limit friendly**: Only syncs when there are actual changes
- **Cost effective**: No wasted compute cycles on empty syncs

## 🎵 **Ready to Rock!**

Once set up, your music sync will be completely automated and responsive to changes, perfect for fast-paced music supervision workflows! 🎬
