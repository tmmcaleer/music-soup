#!/usr/bin/env node
/** Preview an initial current-membership baseline. Never creates a live schema. */
process.env.LOG_LEVEL = 'error';
const config = require('../config');
const { fullSync } = require('../syncOrchestrator');
const membershipStore = require('../membershipStore');
const { withSyncLock } = require('../utils/syncLock');

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: initialize-memberships.js [--apply]');
  const apply = args.includes('--apply');
  if (!config.notion.membershipDatabaseId) {
    if (apply) throw new Error('Create/share the separate membership database and configure NOTION_MEMBERSHIP_DB_ID first');
    return { mode: 'preview', status: 'requires_schema_setup', schema: membershipStore.SCHEMA,
      instruction: 'Create a visible separate Notion database, share it with the production integration, and set NOTION_MEMBERSHIP_DB_ID. No live schema was created.' };
  }
  const work = async () => {
    const report = await fullSync({ shadow: true, initializeMemberships: true });
    if (!report.success) throw new Error(report.error || 'Initialization requires a successful complete shadow read');
    const plan = report.cleanup.membershipPlan;
    const commit = apply ? await membershipStore.commitPlan(plan) : { committed: false };
    return { mode: apply ? 'apply' : 'preview', baselinePolicy: 'current_complete_playlists_only_no_legacy_removal_inference', plan, commit };
  };
  return apply ? withSyncLock(work) : work();
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
module.exports = { main };
