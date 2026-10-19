# Server Agent Handoff Prompt

Use this prompt with the coding agent on the target machine.

```text
You are setting up the Music Soup Phase 1 local webhook cutover on the host that contains /Volumes/music-soup-server.

Objective:
- Replace any old standalone webhook shim in /Volumes/music-soup-server with a real clone of the tmmcaleer/music-soup repository.
- Run the new local webhook server there.
- Keep GitHub Actions manual sync as the fallback.
- Do not break the existing Fly.io path until the new local path is validated.

Important local context:
- The canonical repo already contains the new local webhook implementation in local-webhook-server.js.
- The source-of-truth setup doc is docs/local-webhook-cutover.md.
- The committed launchd template is deployment/com.music-soup.local-webhook.plist.
- The old server folder may still contain only webhook-server.js plus a shim .env with GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO/WEBHOOK_PORT/WEBHOOK_SECRET.
- The old server folder may also be accidentally initialized as its own git repo. Audit and remove that if present.
- The GitHub workflow to keep is Music Soup Sync (.github/workflows/sync-music.yml).
- The GitHub workflow likely to disable later is Fly Deploy (.github/workflows/fly-deploy.yml), but only after the new local path is working.

Required process:
1. Inspect /Volumes/music-soup-server and determine whether it is:
   - already a real clone of tmmcaleer/music-soup, or
   - an old standalone shim, or
   - a separate accidental git repo.
2. Capture the current state before changing anything:
   - ls -la /Volumes/music-soup-server
   - git -C /Volumes/music-soup-server status --short --branch || true
   - git -C /Volumes/music-soup-server remote -v || true
   - git -C /Volumes/music-soup-server log --oneline -5 || true
   - show the existing file list
3. If /Volumes/music-soup-server is not already a real clone of tmmcaleer/music-soup:
   - back up the existing .env outside the folder
   - remove the old contents, including any accidental .git
   - clone git@github.com:tmmcaleer/music-soup.git into /Volumes/music-soup-server
4. Open and follow docs/local-webhook-cutover.md, but adapt only where real machine facts require it.
5. Build a local .env for direct sync from the GitHub repository secrets. Do not reuse the old shim .env as the final env.
6. Run the integration test:
   - node tests/integration-test.js
7. Start the local webhook server:
   - npm ci
   - npm run webhook:local
8. Validate locally:
   - GET /health
   - POST /notion-webhook with valid x-webhook-secret
   - POST /notion-webhook with invalid x-webhook-secret
   - prove single-flight behavior with queued/coalesced requests
9. If local validation passes:
   - install the launchd job from deployment/com.music-soup.local-webhook.plist
   - start ngrok against the configured webhook port
   - report the HTTPS webhook URL
10. Do not switch Notion or disable Fly.io yourself unless you can validate the whole path or you have explicit approval in the session.
11. If the repo still pushes Fly deploys on main, note that Fly Deploy should be disabled later, but do not remove the Music Soup Sync workflow because it remains the fallback.

Deliverables back to me:
- Exact current-state findings for /Volumes/music-soup-server
- Whether it had an accidental git remote or commit history
- What you replaced or preserved
- Whether npm install and integration tests passed
- Health endpoint output
- Webhook validation results
- launchd status
- ngrok URL if available
- Clear statement of whether the machine is ready for Notion cutover
- Any manual actions still required in GitHub, Notion, or Fly.io
```
