const {
  getTotalAdded,
  shouldPostComment,
  formatTrackLine,
  buildCommentText,
  buildCommentRichText,
  pickQuip,
} = require('../utils/scheduledSyncComment');

const LYNNE_USER_ID = '21ed872b-594c-8194-9d97-0002083b9569';

describe('scheduled sync comment helpers', () => {
  test('getTotalAdded sums spotify and apple music counts', () => {
    expect(getTotalAdded(2, 3)).toBe(5);
    expect(getTotalAdded(0, 0)).toBe(0);
  });

  test('shouldPostComment only posts when added > 0', () => {
    expect(shouldPostComment(0)).toBe(false);
    expect(shouldPostComment(1)).toBe(true);
    expect(shouldPostComment(4)).toBe(true);
  });

  test('formatTrackLine includes service and playlist type', () => {
    const line = formatTrackLine({
      title: 'Test Song',
      artist: 'Test Artist',
      service: 'spotify',
      playlistType: 'Source',
    });

    expect(line).toBe('• Test Song — Test Artist (Spotify / Source)');
  });

  test('pickQuip returns casual copy', () => {
    const quip = pickQuip(2, new Date('2026-07-08T13:00:00.000Z'));
    expect(quip).toMatch(/added|showed up|landed|fyi/i);
    expect(quip).not.toMatch(/soup|broth|patrol/i);
  });

  test('buildCommentText formats header and track list', () => {
    const text = buildCommentText({
      newTracks: [
        {
          title: 'Song A',
          artist: 'Artist A',
          service: 'spotify',
          playlistType: 'Source',
        },
        {
          title: 'Song B',
          artist: 'Artist B',
          service: 'appleMusic',
          playlistType: 'Temp',
        },
      ],
      totalAdded: 2,
      syncDate: new Date('2026-07-08T13:00:00.000Z'),
      timeZone: 'America/New_York',
    });

    expect(text).toContain('Hey —');
    expect(text).toContain('• Song A — Artist A (Spotify / Source)');
    expect(text).toContain('• Song B — Artist B (Apple Music / Temp)');
  });

  test('buildCommentRichText includes @mention and quippy intro', () => {
    const blocks = buildCommentRichText({
      newTracks: [
        {
          title: 'Song A',
          artist: 'Artist A',
          service: 'spotify',
          playlistType: 'Source',
        },
      ],
      totalAdded: 1,
      mentionUserId: LYNNE_USER_ID,
      syncDate: new Date('2026-07-08T13:00:00.000Z'),
      timeZone: 'America/New_York',
    });

    const mention = blocks.find((block) => block.type === 'mention');
    expect(mention).toBeDefined();
    expect(mention.mention.user.id).toBe(LYNNE_USER_ID);

    const body = blocks.map((block) => {
      if (block.type === 'text') {
        return block.text.content;
      }
      if (block.type === 'mention') {
        return '@Lynne';
      }
      return '';
    }).join('');

    expect(body).toContain('Heyo ');
    expect(body).toContain('@Lynne');
    expect(body).toContain('• Song A — Artist A (Spotify / Source)');
  });

  test('buildCommentText omits track list for large batches', () => {
    const newTracks = Array.from({ length: 30 }, (_, index) => ({
      title: `Song ${index + 1}`,
      artist: 'Artist',
      service: 'spotify',
      playlistType: 'Source',
    }));

    const text = buildCommentText({
      newTracks,
      totalAdded: 30,
      syncDate: new Date('2026-07-08T13:00:00.000Z'),
      timeZone: 'America/New_York',
    });

    expect(text).toContain('30 new tracks');
    expect(text).not.toContain('Song 1');
    expect(text).not.toContain('•');
  });

  test('buildCommentText lists up to 10 tracks', () => {
    const newTracks = Array.from({ length: 10 }, (_, index) => ({
      title: `Song ${index + 1}`,
      artist: 'Artist',
      service: 'spotify',
      playlistType: 'Source',
    }));

    const text = buildCommentText({
      newTracks,
      totalAdded: 10,
      syncDate: new Date('2026-07-08T13:00:00.000Z'),
      timeZone: 'America/New_York',
    });

    expect(text).toContain('Song 1');
    expect(text).toContain('Song 10');
  });
});
