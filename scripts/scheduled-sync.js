#!/usr/bin/env node

/**
 * Scheduled Music Soup sync runner.
 *
 * Runs a full sync and posts a Notion page comment when new tracks were added.
 */

const config = require('../config');
const syncOrchestrator = require('../syncOrchestrator');
const notionClient = require('../notionClient');
const logger = require('../utils/logger');
const { withSyncLock } = require('../utils/syncLock');
const {
  getTotalAdded,
  shouldPostComment,
  buildCommentRichText,
  toRichTextBlocks,
  buildCommentText,
} = require('../utils/scheduledSyncComment');

/**
 * @param {Object} syncResults
 * @returns {number}
 */
function countAdded(syncResults) {
  return getTotalAdded(syncResults.spotify.added, syncResults.appleMusic.added);
}

/**
 * @param {Object} fullResults
 * @returns {Promise<void>}
 */
async function maybePostSyncComment(fullResults) {
  const syncResults = fullResults.sync;
  const totalAdded = countAdded(syncResults);

  if (!shouldPostComment(totalAdded)) {
    logger.info('Scheduled sync completed with no new tracks; skipping Notion comment');
    return;
  }

  const reportPageId = config.notion.reportPageId;
  if (!reportPageId) {
    throw new Error('NOTION_REPORT_PAGE_ID is required to post sync comments');
  }

  const mentionUserId = config.notion.mentionUserId;
  const richText = mentionUserId
    ? buildCommentRichText({
        newTracks: syncResults.newTracks,
        totalAdded,
        mentionUserId,
        timeZone: config.config.syncTimezone,
      })
    : toRichTextBlocks(buildCommentText({
        newTracks: syncResults.newTracks,
        totalAdded,
        timeZone: config.config.syncTimezone,
      }));

  await notionClient.createPageComment(reportPageId, richText);
  logger.info('Posted Notion sync comment', {
    pageId: reportPageId,
    totalAdded,
    trackLines: syncResults.newTracks.length,
  });
}

async function main() {
  logger.info('Starting scheduled Music Soup sync', {
    dryRun: config.config.dryRun,
    timeZone: config.config.syncTimezone,
  });

  await withSyncLock(async () => {
    const fullResults = await syncOrchestrator.fullSync();
    await maybePostSyncComment(fullResults);

    const totalAdded = countAdded(fullResults.sync);
    console.log(`Scheduled sync completed. New tracks added: ${totalAdded}`);
  });

  process.exit(0);
}

main().catch((error) => {
  if (error.message.includes('already running')) {
    console.log(error.message);
    logger.warn('Scheduled sync skipped because another sync is in progress');
    process.exit(0);
  }

  console.error('Scheduled sync failed:', error.message);
  logger.error('Scheduled sync failed', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
