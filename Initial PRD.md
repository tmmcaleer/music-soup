
📄 PRD: Playlist → Notion Automation Workflow

Overview

We want to automate the capture of tracks added by the music supervisor into Apple Music and Spotify playlists, and automatically create structured records in a Notion database. The workflow should capture as much metadata as possible, while staying flexible to API limitations and mapping inconsistencies.

⸻

Objectives
	•	Automatically sync new playlist entries from Spotify and Apple Music into Notion.
	•	Capture metadata: track title, artist, album, release year, duration, publisher/label, ISRC/UPC (if available), playlist name, and type (Source/Temp).
	•	Store Spotify and Apple Music URLs together in the same URL property in Notion.
	•	Prevent duplicates (prefer ISRC as unique key).
	•	Allow human tagging and annotation in Notion (themes, notes, instruments, mood, record date).
	•	Run serverlessly on GitHub Actions, with configuration via .env.

⸻

Flexibility Note
	•	APIs for Spotify and Apple Music differ. Some fields (e.g., Composer vs. Artist, Label metadata) may not map perfectly or may be missing.
	•	The workflow should remain flexible: if metadata is missing, insert what is available, log the gap, and allow future enrichment.

⸻

Users
	•	Primary: Music Supervisor — keeps adding tracks to playlists.
	•	Secondary: Producers/Researchers — reference the Notion database.

⸻

Technical Design

Spotify
	•	Auth via Client ID + Secret + Refresh Token.
	•	Needs playlist-read-private scope.
	•	Playlist ID comes from playlist URL (https://open.spotify.com/playlist/{playlistId}).

Apple Music
	•	Requires both:
	•	Developer Token → generated from TEAM_ID, KEY_ID, and .p8 private key.
	•	Music User Token → generated once by logging in with Apple Music account.
	•	Playlist ID comes from Apple Music URL (https://music.apple.com/.../playlist/{playlistId}).
	•	Storefront required (e.g. us, gb, tr).

Notion
	•	Use Notion API with integration key.
	•	Database fields:
	•	Automatable: Track Title, Track Number, Album, Artist, Performed By, Release Date, Duration, Label/Publisher, ISRC/UPC, URL, Playlist, Type, Created Time.
	•	Manual: Record Date, Composer (Spotify), Themes, Notes, Instruments, Mood.

Environment Setup
	•	.env file must include:

NOTION_KEY=xxx
NOTION_DB_ID=xxx

SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SPOTIFY_REFRESH_TOKEN=xxx
SPOTIFY_PLAYLIST_ID=xxx

APPLE_MUSIC_TEAM_ID=xxx
APPLE_MUSIC_KEY_ID=xxx
APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----"
APPLE_MUSIC_USER_TOKEN=xxx
APPLE_MUSIC_PLAYLIST_ID=xxx
APPLE_MUSIC_STOREFRONT=us


	•	.p8 file can live at project root for dev, but the private key text in .env is enough.

⸻

