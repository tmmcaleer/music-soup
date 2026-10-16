/** Durable Notion membership storage. Never touches music pages or Removed/Source. */
const { Client } = require('@notionhq/client');
const config = require('./config');
const { withNotionRetry } = require('./utils/notionRetry');
const { assertWriteAllowed } = require('./utils/mutationGuard');
const { readSyncLockPid } = require('./utils/syncLock');
const { VERSION, MANIFEST_KEY, membershipKey, playlistKey } = require('./utils/playlistMemberships');
const FIELDS = { key: 'Membership Key', present: 'Present', evidence: 'Evidence' };
const SCHEMA = { [FIELDS.key]: { title: {} }, [FIELDS.present]: { checkbox: {} }, [FIELDS.evidence]: { rich_text: {} } };
let client;
const api = () => client ||= new Client({ auth: config.notion.apiKey });
const text = items => items.map(item => item.plain_text ?? item.text?.content ?? '').join('');

function decodePage(page) {
  if (!page || page.object !== 'page' || typeof page.id !== 'string' || !page.id || !page.properties) throw new Error('Malformed membership page');
  const p = page.properties;
  const title = p[FIELDS.key]?.title;
  const rich = p[FIELDS.evidence]?.rich_text;
  if (![title, rich].every(items => Array.isArray(items) && items.every(item => item && (typeof item.plain_text === 'string' || typeof item.text?.content === 'string')))
      || p[FIELDS.key]?.has_more === true || p[FIELDS.evidence]?.has_more === true || typeof p[FIELDS.present]?.checkbox !== 'boolean') throw new Error('Incomplete membership properties');
  const key = text(title);
  const evidence = JSON.parse(text(rich));
  if (evidence.version !== VERSION || !Number.isSafeInteger(evidence.revision) || evidence.revision < 1) throw new Error('Unsupported membership evidence version/revision');
  if (key === MANIFEST_KEY) {
    if (evidence.kind !== 'manifest' || p[FIELDS.present].checkbox || typeof evidence.musicDatabaseId !== 'string'
        || !Array.isArray(evidence.currentScope) || new Set(evidence.currentScope).size !== evidence.currentScope.length
        || !evidence.observations || typeof evidence.observations !== 'object' || Array.isArray(evidence.observations)
        || evidence.currentScope.some(key => typeof key !== 'string' || !evidence.observations[key])
        || Object.entries(evidence.observations).some(([key, observation]) => !observation
          || !['spotify', 'appleMusic'].includes(observation.service) || typeof observation.playlistId !== 'string' || !observation.playlistId
          || key !== playlistKey(observation.service, observation.playlistId) || !Number.isFinite(Date.parse(observation.observedAt)))
        || !Number.isFinite(Date.parse(evidence.initializedAt))) throw new Error('Malformed membership manifest');
  } else {
    if (evidence.kind !== 'membership' || !['spotify', 'appleMusic'].includes(evidence.service)
        || typeof evidence.playlistId !== 'string' || !evidence.playlistId || typeof evidence.sourceId !== 'string' || !evidence.sourceId
        || key !== membershipKey(evidence.service, evidence.playlistId, evidence.sourceId)
        || typeof evidence.present !== 'boolean' || evidence.present !== p[FIELDS.present].checkbox
        || !Array.isArray(evidence.musicPageIds) || !evidence.musicPageIds.every(id => typeof id === 'string')
        || !Number.isFinite(Date.parse(evidence.firstObservedAt)) || !Number.isFinite(Date.parse(evidence.observedAt))
        || !Number.isInteger(evidence.occurrences) || evidence.occurrences < 0
        || (evidence.present ? evidence.occurrences === 0 : evidence.occurrences !== 0)
        || !Array.isArray(evidence.history) || !evidence.history.length
        || evidence.history.some(event => !event || !['observed_present', 'removed', 're_added'].includes(event.event) || !Number.isFinite(Date.parse(event.at)))) throw new Error('Malformed membership evidence');
    let present = false, lastAt = -Infinity, lastRevision = 0;
    evidence.history.forEach((event, index) => {
      const expected = index === 0 ? 'observed_present' : present ? 'removed' : 're_added';
      if (event.event !== expected || Date.parse(event.at) < lastAt || !Number.isSafeInteger(event.revision)
          || event.revision < 1 || event.revision < lastRevision || event.revision > evidence.revision) throw new Error('Contradictory membership history');
      present = event.event !== 'removed'; lastAt = Date.parse(event.at); lastRevision = event.revision;
    });
    if (present !== evidence.present || lastAt > Date.parse(evidence.observedAt)) throw new Error('Membership state disagrees with history');
  }
  return { key, pageId: page.id, evidence };
}

async function readState({ allowUninitialized = false } = {}) {
  const databaseId = config.notion?.membershipDatabaseId;
  if (!databaseId) return null;
  if (databaseId.replace(/-/g, '') === config.notion.databaseId.replace(/-/g, '')) throw new Error('Membership database must be separate from the music database');
  const schema = await withNotionRetry('read membership schema', () => api().databases.retrieve({ database_id: databaseId }), { mode: 'read' });
  for (const [name, property] of Object.entries(SCHEMA)) {
    if (schema.properties?.[name]?.type !== Object.keys(property)[0]) throw new Error('Membership schema missing/wrong property: ' + name);
  }
  const rows = [], ids = new Set(), keys = new Set(), cursors = new Set();
  let cursor;
  do {
    const response = await withNotionRetry('read membership inventory', () => api().databases.query({ database_id: databaseId, page_size: 100, start_cursor: cursor }), { mode: 'read' });
    if (!response || !Array.isArray(response.results) || response.results.length > 100 || typeof response.has_more !== 'boolean'
        || (response.has_more && (typeof response.next_cursor !== 'string' || !response.next_cursor.trim() || !response.results.length || cursors.has(response.next_cursor)))
        || (!response.has_more && response.next_cursor !== null)) throw new Error('Incomplete membership inventory pagination');
    for (const page of response.results) {
      const row = decodePage(page);
      if (ids.has(row.pageId) || keys.has(row.key)) throw new Error('Duplicate membership page/key; review required');
      ids.add(row.pageId); keys.add(row.key); rows.push(row);
    }
    cursor = response.has_more ? response.next_cursor : undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const manifest = rows.find(row => row.key === MANIFEST_KEY);
  if (manifest && manifest.evidence.musicDatabaseId !== config.notion.databaseId) throw new Error('Membership manifest belongs to a different music database');
  if (!manifest && !allowUninitialized) throw new Error('Membership storage is uninitialized; run initialize-memberships.js in preview first');
  if (rows.some(row => row.evidence.revision > (manifest?.evidence.revision || 0) + 1)) throw new Error('Membership rows exceed the pending checkpoint revision');
  return { databaseId, musicDatabaseId: config.notion.databaseId, manifest, entries: rows.filter(row => row !== manifest) };
}

function committedMembership(row, manifest) {
  if (!manifest || row.evidence.revision > manifest.evidence.revision) return { status: 'pending_checkpoint', present: null };
  const key = playlistKey(row.evidence.service, row.evidence.playlistId);
  if (!manifest.evidence.currentScope.includes(key)) return { status: 'not_monitored', present: null };
  return { status: 'committed', present: row.evidence.present, observedAt: manifest.evidence.observations[key].observedAt };
}

function properties(row) {
  const json = JSON.stringify(row.evidence);
  // Notion rich text limits: prepare every payload before the first mutation.
  const chunks = [];
  let chunk = '';
  for (const character of json) {
    if (chunk.length + character.length > 1900) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 100 || row.key.length > 1900) throw new Error('Membership history exceeds storage limit; archive explicitly before proceeding');
  const result = {
    [FIELDS.key]: { title: [{ text: { content: row.key } }] },
    [FIELDS.present]: { checkbox: row.evidence.present === true },
    [FIELDS.evidence]: { rich_text: chunks.map(content => ({ text: { content } })) },
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 450000) throw new Error('Membership payload exceeds the request size budget');
  return result;
}

async function commitPlan(plan) {
  assertWriteAllowed('commitPlaylistMemberships');
  if (config.config.dryRun) throw new Error('Membership commit is disabled in dry-run mode');
  if (readSyncLockPid() !== process.pid) throw new Error('Membership commit requires the current process sync lock');
  if (!plan.readComplete || !plan.manifest || plan.databaseId !== config.notion.membershipDatabaseId) throw new Error('No complete membership plan for the configured database');
  // The manifest is the final checkpoint. A failed write leaves the prior
  // checkpoint intact; retries read the durable rows and do not duplicate events.
  const rows = [...plan.changes, plan.manifest].map(row => ({ row, properties: properties(row) }));
  for (const item of rows) {
    if (item.row.pageId) {
      await withNotionRetry('update playlist membership', () => api().pages.update({ page_id: item.row.pageId, properties: item.properties }), { mode: 'update' });
    } else {
      await withNotionRetry('create playlist membership', () => api().pages.create({ parent: { database_id: plan.databaseId }, properties: item.properties }), { mode: 'create' });
    }
  }
  return { committed: true, membershipsWritten: plan.changes.length, manifestWritten: true };
}

module.exports = { FIELDS, SCHEMA, readState, commitPlan, committedMembership, decodePage, properties };
