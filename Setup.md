🛠 Setup & Build Roadmap

Step 0. Confirm .env Setup
	•	Check that all required values exist in .env.
	•	Common mistakes: missing Apple Music User Token, misformatted private key (must preserve line breaks).

Step 1. Generate Apple Music Tokens
	1.	Generate Developer Token with Node.js + jsonwebtoken (using .env values).
	2.	Use MusicKit JS in a simple HTML file:
	•	Insert Developer Token.
	•	Supervisor logs in.
	•	Capture Music User Token.
	3.	Add APPLE_MUSIC_USER_TOKEN to .env.
	4.	Test with:

curl -v -H "Authorization: Bearer $DEV_TOKEN" \
     -H "Music-User-Token: $APPLE_MUSIC_USER_TOKEN" \
     "https://api.music.apple.com/v1/me/library/playlists"

→ Should return playlists.

Step 2. Test Spotify API Access
	•	Exchange Client ID + Secret + Refresh Token for access token.
	•	Call /v1/playlists/{SPOTIFY_PLAYLIST_ID}/tracks.
	•	Confirm response with track metadata.

Step 3. Test Notion Access
	•	Run a simple script to insert a dummy row into the target DB.
	•	Confirm it appears in Notion UI.

Step 4. Normalize Metadata
	•	Fetch one playlist from each service.
	•	Normalize to internal schema:

{
  title,
  artist,
  album,
  trackNumber,
  releaseDate,
  duration,
  label,
  isrc,
  url,
  playlistName,
  playlistId,
  type
}


	•	Log results to terminal.

Step 5. Insert into Notion
	•	Implement upsertTrack() using ISRC as primary key.
	•	If row exists → update. Else → insert.

Step 6. GitHub Actions Automation
	•	Add .github/workflows/sync.yml with cron schedule.
	•	Load .env from GitHub Secrets.
	•	Confirm automation runs without manual trigger.

Step 7. Optional Enrichment
	•	Add MusicBrainz for Composer (Spotify).
	•	Add Odesli (Songlink) for cross-service links.
	•	Add error logging & run summaries in Actions output.

⸻

✅ Deliverables for dev:
	•	Working cron job that fetches playlists, normalizes data, and inserts into Notion.
	•	Documented .env format.
	•	Scripts for testing API access independently.
	•	Flexible schema that tolerates missing fields.

