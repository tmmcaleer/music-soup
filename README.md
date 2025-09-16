# 🎵 Music Soup

A Node.js automation that syncs Spotify and Apple Music playlists into a Notion database, designed and built formusic supervision and playlist management workflows in a film/tv context but could work in others!

## 🎯 What It Does

Music Soup automatically:
- **Monitors playlists** from Spotify and Apple Music
- **Extracts metadata** (title, artist, album, duration, ISRC, etc.)
- **Syncs to Notion** with smart deduplication via ISRC codes
- **Handles updates** when tracks are added, removed, or modified
- **Formats data** for music supervision workflows (duration in MM:SS, release years, composer credits)

## 🏗️ Architecture

### Core Components
- **`spotifyClient.js`** - Spotify Web API integration with OAuth refresh flow
- **`appleMusicClient.js`** - Apple Music API integration with JWT developer tokens
- **`notionClient.js`** - Notion API integration with smart schema mapping
- **`syncOrchestrator.js`** - Main sync logic and deduplication handling
- **`config.js`** - Centralized environment variable management

### API Clients
Each API client is independently testable with comprehensive error handling:
- **Rate limiting** with exponential backoff
- **Token management** (OAuth refresh for Spotify, JWT generation for Apple Music)
- **Metadata normalization** across different service schemas
- **Graceful degradation** when services are unavailable

## 🔧 Key Features

### Smart Deduplication
Uses ISRC (International Standard Recording Code) as primary key for matching tracks across platforms, with title/artist fallback for tracks without ISRC data.

### Metadata Enrichment
- **Spotify**: Track info, popularity scores, external URLs
- **Apple Music**: Enhanced composer credits, detailed genre information
- **Cross-platform**: Combines best metadata from both sources

### Robust Error Handling
- **API failures**: Retry logic with exponential backoff
- **Rate limits**: Automatic throttling and queue management
- **Partial failures**: Continue sync even if one service fails
- **Schema mismatches**: Graceful handling of missing/changed Notion properties

### Automated Cleanup
Tracks removed from playlists are marked as "removed" in Notion rather than deleted, preserving historical data for music supervision workflows.

## 🚀 Deployment

### GitHub Actions
- **Scheduled sync**: Configurable cron schedule (default: every 5 minutes)
- **Manual triggers**: On-demand sync via GitHub UI
- **Webhook support**: Integration with external systems via repository dispatch
- **Secure secrets**: All API credentials stored in GitHub Secrets

### Environment Configuration
All sensitive configuration managed through environment variables:
- Spotify OAuth credentials and refresh tokens
- Apple Music developer certificates and user tokens  
- Notion integration keys and database IDs

## 📊 Notion Schema

### Automated Fields
- Track metadata (title, artist, album, duration, release date)
- Platform URLs and unique identifiers
- Playlist classification and source tracking

### Manual Fields  
- Custom tagging (themes, moods, instruments)
- Editorial notes and collaboration comments
- Project-specific metadata (record dates, etc.)

## 🛡️ Security & Best Practices

### API Safety
- **No hardcoded credentials** - all secrets via environment variables
- **Endpoint validation** - all API calls verified against official documentation
- **Schema safety** - Notion field mapping explicitly defined
- **Rate limit compliance** - respects platform API limits

### Code Organization
- **Modular design** - each API client completely independent
- **Comprehensive logging** - structured logging with multiple levels
- **Error boundaries** - failures isolated to prevent cascade issues
- **Type safety** - JSDoc annotations for better IDE support

## 🧪 Testing

### Integration Tests
- **API connectivity** validation for each service
- **Authentication flow** testing (OAuth, JWT, API keys)
- **Schema validation** for Notion database structure
- **Error scenario** testing (network failures, rate limits, etc.)

### Local Development
- **Mock responses** for API testing without hitting rate limits
- **Environment validation** to catch configuration issues early
- **Debug utilities** for troubleshooting API responses

## 📋 Requirements

### APIs
- **Spotify Web API** - Client credentials and user authorization
- **Apple Music API** - Developer program membership and user tokens
- **Notion API** - Integration token and database access

### Runtime
- **Node.js 18+** 
- **Dependencies**: JWT handling, HTTP clients, logging utilities
- **Environment**: GitHub Actions or any Node.js runtime environment

## 🎵 Use Cases

### Music Supervision
- **Playlist management** for film/TV projects
- **Metadata tracking** across multiple streaming platforms  
- **Collaboration tools** with editorial notes and tagging
- **Historical tracking** of playlist changes over time

### Music Discovery
- **Cross-platform sync** to maintain playlists on multiple services
- **Metadata enrichment** by combining data from different sources
- **Automated backup** of playlist contents to prevent data loss

---

**Built for music industry workflows with enterprise-grade reliability and security.**
