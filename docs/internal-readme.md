# 🎵 Music Soup - Internal Team Guide

**⚠️ INTERNAL DOCUMENTATION - FOR MUSIC SUPERVISION TEAM ONLY**

**Music Soup** automatically syncs tracks from your Spotify and Apple Music playlists into a Notion database, giving you a centralized place to organize and annotate your music for film/TV projects.

## 🎯 What This Does

- **Watches your playlists**: Monitors specified Spotify and Apple Music playlists every 5 minutes
- **Extracts metadata**: Pulls track information (title, artist, album, duration, etc.)
- **Updates Notion**: Adds new tracks and updates existing ones in your music database
- **Handles duplicates**: Uses ISRC codes to avoid duplicate entries across platforms
- **Tracks removals**: Marks tracks as "removed" when they're deleted from playlists

## 📊 What Gets Updated in Notion

### Automatically Populated Fields
When a track is added to your playlist, these fields are automatically filled in Notion:

- **Track Title** - Song name
- **Artist** - Primary artist(s)
- **Performed By** - Performing artist(s) 
- **Album** - Album/release name
- **Track Number** - Position on album
- **Duration** - Length in MM:SS format (e.g., "3:47")
- **Release Date** - Year of release (e.g., 2023)
- **ISRC/UPC** - Unique identifier for deduplication
- **URL** - Direct link to track on Spotify/Apple Music
- **Playlist** - Source playlist name
- **Type** - Source/Temp classification
- **Composer** - Songwriter credits (when available from Apple Music)

### Manual Fields (Your Input)
These fields are left blank for your team to fill in:

- **Record Date** - Custom dating for your project
- **Themes** - Thematic tags
- **Mood/Keywords** - Descriptive tags for music supervision
- **Instruments** - Instrumentation notes
- **Notes** - General comments and collaboration notes

## ⚡ How It Works

1. **Add music** to your Spotify or Apple Music playlists
2. **Wait 5 minutes** (or less) for automatic sync
3. **Check Notion** - new tracks appear with all metadata filled in
4. **Add your notes** in the manual fields for music supervision workflow

## 🔧 Manual Sync (When You Can't Wait)

If you want to sync immediately instead of waiting for the automatic run:

1. Go to [GitHub Actions](https://github.com/tmmcaleer/music-soup/actions)
2. Click on **"Music Soup Sync"**
3. Click the **"Run workflow"** button (top right)
4. Click **"Run workflow"** in the popup
5. Wait ~1-2 minutes for completion

## 📋 Checking Sync Logs

To see what happened during a sync (useful for troubleshooting):

1. Go to [GitHub Actions](https://github.com/tmmcaleer/music-soup/actions)
2. Click on any **"Music Soup Sync"** run
3. Click **"sync-playlists"** to expand the job
4. Click **"Run playlist sync"** to see detailed logs

### What to Look For in Logs:
- ✅ **"Spotify sync completed"** - Shows tracks added/updated
- ✅ **"Apple Music sync completed"** - Shows tracks added/updated  
- ✅ **"Sync completed successfully!"** - Everything worked
- ❌ **Red errors** - Something went wrong (contact Tim)

## 🎵 Current Setup

- **Spotify Playlist**: "Test Playlist" - automatically synced
- **Apple Music Playlist**: "Test Playlist" - automatically synced
- **Sync Frequency**: Every 5 minutes, 24/7
- **Notion Database**: "Music Options" - automatically updated

## 🚨 Troubleshooting

### No New Tracks Appearing?
1. Check that tracks were actually added to the correct playlists
2. Wait 5-10 minutes for the next automatic sync
3. Check [GitHub Actions logs](https://github.com/tmmcaleer/music-soup/actions) for errors
4. Try a manual sync

### Duplicate Tracks?
- The system uses ISRC codes to prevent duplicates
- If you see duplicates, they might be different versions/remixes
- Check the ISRC/UPC field to confirm

### Missing Information?
- Some metadata might not be available from streaming services
- Composer info is more complete from Apple Music than Spotify
- You can always fill in missing details manually

## 📞 Support

For technical issues or setup changes, contact Tim. Include:
- What you were trying to do
- What happened instead
- Link to the GitHub Actions run (if applicable)

---

**Last Updated**: September 2025  
**Status**: ✅ Active and Running
