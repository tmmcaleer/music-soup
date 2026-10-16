/**
 * Conservative recording decisions. A review is never equivalent to "not found".
 * No I/O: the same decision is used by the snapshot index and final live lookup.
 */
const { NOTION_FIELDS } = require('../schema');
const {
  buildPlatformTrackId, extractPlatformTrackId, getNotionText,
  normalizeIsrc, normalizeText,
} = require('./trackIdentity');

class TrackIdentityReviewError extends Error {
  constructor(decision) {
    super('Track identity requires review: ' + decision.reasons.join(', '));
    this.name = 'TrackIdentityReviewError';
    this.decision = decision;
  }
}

function durationSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const parts = String(value).trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(x => !/^\d+(?:\.\d+)?$/.test(x))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function trackFacts(record) {
  const p = record.properties;
  const text = name => getNotionText(p?.[name]);
  const url = p ? p[NOTION_FIELDS.URL]?.url || '' : record.url || '';
  const persistedId = p ? text(NOTION_FIELDS.PLATFORM_TRACK_ID) : record.platformTrackId;
  const platformId = buildPlatformTrackId(p
    ? { platformTrackId: persistedId, url }
    : record);
  const urlId = extractPlatformTrackId(url);
  return {
    id: record.id || null,
    title: normalizeText(p ? text(NOTION_FIELDS.TRACK_TITLE) : record.title),
    artist: normalizeText(p ? text(NOTION_FIELDS.ARTIST) : record.artist),
    album: normalizeText(p ? text(NOTION_FIELDS.ALBUM) : record.album),
    isrc: normalizeIsrc(p ? text(NOTION_FIELDS.ISRC_UPC) : record.isrc),
    platformId,
    service: platformId.split(':')[0] || '',
    duration: durationSeconds(p ? text(NOTION_FIELDS.DURATION) : record.duration),
    trackNumber: numberOrNull(p ? p[NOTION_FIELDS.TRACK_NUMBER]?.number : record.trackNumber),
    discNumber: numberOrNull(p ? p['Disc Number']?.number : record.discNumber),
    removed: Boolean(p ? p[NOTION_FIELDS.REMOVED]?.checkbox : record.removed),
    inconsistentSource: Boolean(platformId && urlId && platformId !== urlId),
  };
}

function durationEvidence(a, b) {
  if (a === null || b === null) return { available: false };
  // Compare at provider precision so floating-point subtraction cannot move an
  // exact two-second difference across the review threshold.
  const deltaMilliseconds = Math.round(a * 1000) - Math.round(b * 1000);
  const deltaSeconds = deltaMilliseconds / 1000;
  const absoluteSeconds = Math.abs(deltaSeconds);
  const relativePercent = b > 0 ? absoluteSeconds / b * 100 : (a === 0 ? 0 : Infinity);
  return {
    available: true, deltaMilliseconds, deltaSeconds, absoluteSeconds, relativePercent,
    compatible: absoluteSeconds <= 2 && !(absoluteSeconds > 0.5 && relativePercent > 5),
    band: absoluteSeconds <= 2 ? 'within_2_seconds' : absoluteSeconds <= 5 ? '2_to_5_seconds' : 'over_5_seconds',
  };
}

function compareCandidate(incoming, candidate) {
  const existing = trackFacts(candidate);
  const reasons = [];
  const duration = durationEvidence(incoming.duration, existing.duration);
  const exactSource = Boolean(incoming.platformId && incoming.platformId === existing.platformId);
  const sameIsrc = Boolean(incoming.isrc && incoming.isrc === existing.isrc);
  const sameTitle = Boolean(incoming.title && incoming.title === existing.title);
  const sameArtist = Boolean(incoming.artist && incoming.artist === existing.artist);
  if (incoming.inconsistentSource || existing.inconsistentSource) reasons.push('source_id_url_conflict');
  if (incoming.isrc && existing.isrc && incoming.isrc !== existing.isrc) reasons.push('isrc_conflict');
  if (!sameTitle) reasons.push('title_or_version_conflict');
  if (!sameArtist) reasons.push('artist_conflict');
  if (incoming.album && existing.album && incoming.album !== existing.album) reasons.push('album_edition_conflict');
  if (incoming.trackNumber && existing.trackNumber && incoming.trackNumber !== existing.trackNumber) reasons.push('track_number_conflict');
  if (incoming.discNumber && existing.discNumber && incoming.discNumber !== existing.discNumber) reasons.push('disc_number_conflict');
  if (!duration.available) reasons.push('duration_unavailable');
  else if (!duration.compatible) reasons.push('duration_conflict');

  if (!exactSource) {
    const crossProvider = incoming.platformId && existing.platformId && incoming.service !== existing.service;
    if (!sameIsrc) reasons.push('no_shared_strong_identity');
    if (!crossProvider) reasons.push('unverified_source_alias');
    if (!incoming.album || !existing.album) reasons.push('cross_provider_album_unavailable');
    if (!incoming.trackNumber || !existing.trackNumber) reasons.push('cross_provider_track_number_unavailable');
  }
  return {
    record: candidate._matchRecord || candidate,
    recordId: existing.id,
    existing,
    reasons: [...new Set(reasons)],
    duration,
    evidence: exactSource ? 'exact_provider_id_with_metadata' : 'corroborated_cross_provider_candidate',
  };
}

function decideTrackMatch(trackData, records) {
  const incoming = trackFacts(trackData);
  if (incoming.inconsistentSource) return { outcome: 'review', reasons: ['source_id_url_conflict'], candidates: [] };
  if (!incoming.platformId || !incoming.title || !incoming.artist || incoming.duration === null || incoming.duration <= 0) {
    return { outcome: 'review', reasons: ['incoming_identity_incomplete'], candidates: [] };
  }
  const unique = new Map();
  records.forEach((record, i) => unique.set(record.id || 'anonymous:' + i, record));
  const candidates = [...unique.values()].filter(record => {
    const f = trackFacts(record);
    return (incoming.platformId && incoming.platformId === f.platformId)
      || (incoming.isrc && incoming.isrc === f.isrc)
      || (incoming.title && incoming.title === f.title);
  }).map(record => compareCandidate(incoming, record));
  if (!candidates.length) return { outcome: 'new', reasons: [], candidates: [] };
  if (candidates.length > 1) return { outcome: 'review', reasons: ['multiple_candidates'], candidates };
  const candidate = candidates[0];
  if (candidate.reasons.length) return { outcome: 'review', reasons: candidate.reasons, candidates };
  return {
    outcome: 'match', reasons: [], candidates,
    record: candidate.record, recordId: candidate.recordId,
    removed: candidate.existing.removed, evidence: candidate.evidence,
  };
}

module.exports = { TrackIdentityReviewError, decideTrackMatch, durationEvidence, durationSeconds, trackFacts };
