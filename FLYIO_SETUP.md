# Fly.io Webhook Server Setup

Deploy the Notion webhook server to Fly.io for reliable, serverless hosting.

## 🚀 **Quick Setup**

### 1. Install Fly CLI
```bash
# macOS
brew install flyctl

# Or download from: https://fly.io/docs/hands-on/install-flyctl/
```

### 2. Update App Name (IMPORTANT)
Edit `fly.toml` and change the app name to something unique:
```toml
app = "music-soup-webhook-yourname"  # Make this unique!
```

### 3. Login to Fly.io
```bash
fly auth login
```

### 4. Create GitHub Personal Access Token
1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Name: "Music Soup Webhook"
4. Scopes: **`repo`** (Full control of private repositories)
5. Copy the token

### 5. Set Secrets
```bash
# Set your GitHub token (REQUIRED)
fly secrets set GITHUB_TOKEN=ghp_your_actual_token_here

# Optional: Set webhook secret for security
fly secrets set WEBHOOK_SECRET=your-chosen-secret-here
```

### 6. Deploy
```bash
# Deploy the app
fly deploy

# Get your webhook URL
fly status
```

## 📊 **Your Webhook URL**
After deployment, your webhook URL will be:
```
https://your-unique-app-name.fly.dev/notion-webhook
```
(Replace `your-unique-app-name` with whatever you set in fly.toml)

## 🔧 **Useful Commands**

```bash
# Check app status
fly status

# View logs in real-time
fly logs

# Check secrets (won't show values)
fly secrets list

# Scale to zero when not in use (save money)
fly scale count 0

# Scale back up
fly scale count 1

# Update secrets
fly secrets set GITHUB_TOKEN=new_token_here

# Redeploy after changes
fly deploy
```

## 💰 **Cost Management**

The configuration is optimized for minimal cost:
- **Auto-scaling**: Scales to 0 when not in use
- **Minimal resources**: 256MB RAM, shared CPU
- **Pay-per-use**: Only pay when webhooks are being processed

Expected cost: **~$0-2/month** for typical usage.

## 🔔 **Notion Setup**

Use this URL in your Notion automations:
```
https://your-unique-app-name.fly.dev/notion-webhook
```

### Database Automation:
1. Go to your Music Database → "•••" → "Database automations"
2. Trigger: "When a page is added" or "When a page is edited"
3. Action: "Send webhook"
4. URL: `https://your-unique-app-name.fly.dev/notion-webhook`
5. Custom Header (if using webhook secret):
   - Key: `x-webhook-secret`
   - Value: `your-chosen-secret-here`

## 🧪 **Testing**

```bash
# Test health endpoint
curl https://your-unique-app-name.fly.dev/health

# Test webhook (will trigger GitHub Actions)
curl -X POST https://your-unique-app-name.fly.dev/notion-webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "webhook"}'

# Watch logs while testing
fly logs
```

## 🔒 **Security Features**

- **HTTPS by default**: Fly.io provides TLS certificates
- **Webhook secrets**: Optional validation
- **Non-root container**: Runs as limited user
- **Auto-scaling**: No always-on attack surface
- **Health checks**: Automatic restarts if unhealthy

## 🔍 **Troubleshooting**

### Deployment Issues
```bash
# Check build logs
fly logs --app music-soup-webhook

# Restart the app
fly apps restart music-soup-webhook
```

### GitHub API Issues
```bash
# Check if token is set
fly secrets list

# Update token
fly secrets set GITHUB_TOKEN=new_token_here
```

### Notion Webhook Issues
- Verify URL: `https://your-unique-app-name.fly.dev/notion-webhook`
- Check logs: `fly logs` 
- Test endpoint: `curl https://your-unique-app-name.fly.dev/health`

## ⚡ **Production Ready**

This setup is production-ready with:
- ✅ Auto-scaling and auto-healing
- ✅ HTTPS/TLS encryption
- ✅ Health checks and monitoring
- ✅ Cost-optimized configuration
- ✅ Secure secret management
- ✅ Container isolation

Perfect for reliable music sync automation! 🎵
