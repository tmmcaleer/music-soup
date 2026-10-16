#!/usr/bin/env node

/**
 * Find duplicate tracks in the Notion database (same ISRC or title+artist).
 */

require('dotenv').config();

const notionClient = require('../notionClient');
const { NOTION_FIELDS } = require('../schema');

function getTitle(page) {
  return page.properties[NOTION_FIELDS.TRACK_TITLE]?.title?.[0]?.plain_text || '';
}

function getArtist(page) {
  return page.properties[NOTION_FIELDS.ARTIST]?.rich_text?.[0]?.plain_text || '';
}

function getIsrc(page) {
  return page.properties[NOTION_FIELDS.ISRC_UPC]?.rich_text?.[0]?.plain_text || '';
}

function getCreated(page) {
  return page.created_time;
}

function getRemoved(page) {
  return page.properties[NOTION_FIELDS.REMOVED]?.checkbox === true;
}

function groupByKey(pages, keyFn) {
  const groups = new Map();

  for (const page of pages) {
    const key = keyFn(page);
    if (!key) {
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(page);
  }

  return [...groups.entries()].filter(([, pages]) => pages.length > 1);
}

async function main() {
  const dateArg = process.argv[2];
  const pages = await notionClient.queryAllDatabase();

  const filtered = dateArg
    ? pages.filter((page) => getCreated(page).startsWith(dateArg))
    : pages;

  const isrcDupes = groupByKey(filtered, getIsrc);
  const titleArtistDupes = groupByKey(
    filtered,
    (page) => {
      const title = getTitle(page).toLowerCase().trim();
      const artist = getArtist(page).toLowerCase().trim();
      return title && artist ? `${title}|||${artist}` : '';
    }
  );

  console.log(`Scanned ${filtered.length} track(s)${dateArg ? ` created on ${dateArg}` : ''}.`);
  console.log(`ISRC duplicate groups: ${isrcDupes.length}`);
  console.log(`Title+artist duplicate groups: ${titleArtistDupes.length}`);
  console.log('');

  for (const [isrc, group] of isrcDupes) {
    console.log(`ISRC ${isrc} (${group.length} pages):`);
    for (const page of group) {
      console.log(
        `  - ${getTitle(page)} — ${getArtist(page)} | created ${getCreated(page)} | removed=${getRemoved(page)} | ${page.id}`
      );
    }
    console.log('');
  }
}

main().catch((error) => {
  console.error('Duplicate scan failed:', error.message);
  process.exit(1);
});
