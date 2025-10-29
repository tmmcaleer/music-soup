# 📁 Project Structure

This document outlines the organized structure of the Music Soup project and explains where to find different types of files.

## 🏗️ Directory Layout

```
music-soup/
├── 📋 Core Application Files
│   ├── config.js                 # Centralized environment variable access
│   ├── endpoints.js              # All API endpoint constants
│   ├── schema.js                 # Notion schema and response field definitions
│   ├── spotifyClient.js          # Spotify API integration only
│   ├── appleMusicClient.js       # Apple Music API integration only
│   ├── notionClient.js           # Notion API integration only
│   ├── syncOrchestrator.js       # Main orchestration logic
│   ├── sync.js                   # Entry point for sync operations
│   └── webhook-server.js         # Webhook server for external integrations
│
├── 🛠️ scripts/                   # Utility and debug scripts
│   ├── get-spotify-token.js      # Spotify OAuth token generation
│   ├── get-apple-music-user-token.js  # Apple Music user token helper
│   ├── debug-config.js           # Configuration validation script
│   ├── debug-apple-key.js        # Apple Music key format debugging
│   └── README.md                 # Script documentation
│
├── 🧪 tests/                     # Integration test stubs
│   └── integration-test.js       # Full API integration testing
│
├── 🔧 utils/                     # Shared utilities
│   └── logger.js                 # Central logging with levels
│
├── 📚 docs/                      # Documentation files
│   ├── initial-prd.md            # Original project requirements
│   ├── setup.md                  # Setup and configuration guide
│   ├── webhook-setup.md          # Webhook configuration guide
│   ├── flyio-setup.md            # Fly.io deployment guide
│   ├── internal-readme.md        # Internal development notes
│   └── project-structure.md      # This file
│
├── 🚀 deployment/                # Deployment configuration
│   ├── Dockerfile                # Container build configuration
│   └── fly.toml                  # Fly.io deployment settings
│
├── ⚙️ .github/workflows/         # GitHub Actions automation
│   └── sync-music.yml            # Scheduled sync workflow
│
├── 🔐 Configuration Files
│   ├── package.json              # Node.js dependencies and scripts
│   ├── package-lock.json         # Locked dependency versions
│   ├── env.example               # Environment variable template
│   └── AuthKey_*.p8              # Apple Music private key (gitignored)
│
└── 📖 README.md                  # Main project documentation
```

## 📋 File Categories

### Core Application Code
- **API Clients**: `*Client.js` files handle individual service integrations
- **Configuration**: `config.js`, `endpoints.js`, `schema.js` define app behavior
- **Orchestration**: `syncOrchestrator.js` coordinates the sync process
- **Entry Points**: `sync.js` and `webhook-server.js` provide different execution modes

### Development Tools
- **Scripts**: Debugging and utility scripts in `scripts/`
- **Tests**: Integration tests in `tests/`
- **Utils**: Shared utilities like logging in `utils/`

### Documentation
- **Setup Guides**: Configuration and deployment instructions
- **Architecture**: Technical documentation and project requirements
- **Internal Notes**: Development notes and troubleshooting guides

### Deployment
- **Container**: Docker configuration for containerized deployment
- **Platform**: Platform-specific deployment files (Fly.io)
- **Automation**: GitHub Actions workflows for CI/CD

## 🔍 Finding What You Need

### Setting Up the Project
1. **Start with**: `README.md` (main overview)
2. **Configuration**: `docs/setup.md` 
3. **Environment**: `env.example` (copy to `.env`)
4. **Testing**: `tests/integration-test.js`

### Development & Debugging
1. **Configuration Issues**: `scripts/debug-config.js`
2. **Apple Music Auth**: `scripts/debug-apple-key.js`
3. **Token Generation**: `scripts/get-*-token.js`
4. **Logs**: Check `utils/logger.js` configuration

### Deployment
1. **GitHub Actions**: `.github/workflows/sync-music.yml`
2. **Container**: `deployment/Dockerfile`
3. **Platform Deploy**: `docs/flyio-setup.md`
4. **Webhooks**: `docs/webhook-setup.md`

### Understanding the Code
1. **API Integration**: Individual `*Client.js` files
2. **Data Flow**: `syncOrchestrator.js`
3. **Configuration**: `config.js`
4. **Schema**: `schema.js`

## 🏛️ Architecture Principles

### Modular Design
- Each API client is completely independent
- Shared utilities are minimal and focused
- Configuration is centralized but flexible

### Security First
- No hardcoded credentials anywhere
- All environment variables accessed through `config.js`
- Secrets managed via GitHub Secrets or `.env`

### Testing & Debugging
- Integration tests validate real API connectivity
- Debug scripts help troubleshoot common issues
- Structured logging provides operational visibility

### Documentation
- Each component has clear purpose and dependencies
- Setup guides cover common deployment scenarios
- Internal docs capture development decisions and troubleshooting

---

This structure follows Node.js best practices and ensures the codebase remains maintainable as it grows.




