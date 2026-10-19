/** Pure per-provider/playlist membership history; independent of canonical metadata. */
const { buildPlatformTrackId, extractPlatformTrackId } = require('./trackIdentity');

const VERSION = 1;
const MANIFEST_KEY = '__music_soup_membership_manifest_v1__';
const membershipKey = (service, playlistId, sourceId) => JSON.stringify([service, playlistId, sourceId]);
const playlistKey = (service, playlistId) => JSON.stringify([service, playlistId]);

function planPlaylistMemberships(state, snapshots, associations = new Map()) {
  if (!state) return { status: 'unconfigured', changes: [], transitions: [] };
  if (!snapshots.length || snapshots.some(s => s.complete !== true)) throw new Error('Membership decisions require complete playlist snapshots');
  const previous = new Map(state.entries.map(entry => [entry.key, entry]));
  const revision = (state.manifest?.evidence.revision || 0) + 1;
  const observed = new Map();
  const scope = new Set();
  const observations = { ...(state.manifest?.evidence.observations || {}) };
  for (const snapshot of snapshots) {
    const { service, playlistId, tracks, observedAt, playlist } = snapshot;
    if (!['spotify', 'appleMusic'].includes(service) || !playlistId || !Array.isArray(tracks) || !Number.isFinite(Date.parse(observedAt))) {
      throw new Error('Malformed complete playlist snapshot');
    }
    const scopeKey = playlistKey(service, playlistId);
    if (scope.has(scopeKey)) throw new Error('Duplicate playlist snapshot');
    if (Date.parse(observedAt) < (observations[scopeKey] ? Date.parse(observations[scopeKey].observedAt) : -Infinity)
        || state.entries.some(entry => playlistKey(entry.evidence.service, entry.evidence.playlistId) === scopeKey
          && Date.parse(observedAt) < Date.parse(entry.evidence.observedAt))) throw new Error('Playlist snapshot predates durable membership evidence');
    scope.add(scopeKey);
    observations[scopeKey] = { service, playlistId, name: playlist.name, observedAt, trackCount: tracks.length };
    for (const track of tracks) {
      const sourceId = track.sourceId;
      if (typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('Playlist item has no exact provider track ID');
      const providerId = service + ':' + sourceId;
      const urlId = extractPlatformTrackId(track.url);
      if (buildPlatformTrackId(track) !== providerId || (urlId && urlId !== providerId)) throw new Error('Playlist item provider ID conflicts with its source/URL');
      const key = membershipKey(service, playlistId, sourceId);
      if (observed.has(key)) { observed.get(key).occurrences++; continue; }
      observed.set(key, {
        version: VERSION, kind: 'membership', revision, service, playlistId, sourceId,
        playlistName: playlist.name, title: track.title || '', artist: track.artist || '', album: track.album || '',
        url: track.url || '', present: true, occurrences: 1,
        musicPageIds: [...new Set(associations.get(providerId) || [])].filter(id => !id.startsWith('shadow:')).sort(),
        observedAt,
      });
    }
  }
  const changes = [];
  const transitions = [];
  for (const [key, next] of observed) {
    const prior = previous.get(key);
    const at = next.observedAt;
    const event = !prior ? 'observed_present' : !prior.evidence.present ? 're_added' : null;
    const history = [...(prior?.evidence.history || [])];
    if (event) { history.push({ at, event, revision }); transitions.push({ key, event, service: next.service, playlistId: next.playlistId, sourceId: next.sourceId, at }); }
    const evidence = { ...next, firstObservedAt: prior?.evidence.firstObservedAt || at, history };
    // The manifest records every completed observation; unchanged members need
    // no per-run write. A row timestamp records its latest stored observation.
    const comparable = value => { const { observedAt, revision, ...rest } = value; return JSON.stringify(rest); };
    if (!prior || comparable(evidence) !== comparable(prior.evidence)) changes.push({ key, pageId: prior?.pageId, evidence });
  }
  for (const prior of previous.values()) {
    const old = prior.evidence;
    const scopeKey = playlistKey(old.service, old.playlistId);
    if (observed.has(prior.key) || !scope.has(scopeKey) || !old.present) continue;
    const at = observations[scopeKey].observedAt;
    const evidence = { ...old, revision, present: false, occurrences: 0, observedAt: at, history: [...old.history, { at, event: 'removed', revision }] };
    changes.push({ key: prior.key, pageId: prior.pageId, evidence });
    transitions.push({ key: prior.key, event: 'removed', service: old.service, playlistId: old.playlistId, sourceId: old.sourceId, at });
  }
  const manifest = {
    key: MANIFEST_KEY, pageId: state.manifest?.pageId,
    evidence: { version: VERSION, kind: 'manifest', revision, musicDatabaseId: state.musicDatabaseId,
      initializedAt: state.manifest?.evidence.initializedAt || snapshots[0].observedAt,
      baselinePolicy: 'complete_current_playlists_only', currentScope: [...scope].sort(), observations },
  };
  return { status: state.manifest ? 'ready' : 'initialization', databaseId: state.databaseId, readComplete: true, changes, transitions, manifest };
}

module.exports = { VERSION, MANIFEST_KEY, membershipKey, playlistKey, planPlaylistMemberships };
