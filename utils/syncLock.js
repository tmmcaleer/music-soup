/**
 * Simple process lock to prevent concurrent sync runs from creating duplicates.
 */

const fs = require('fs');
const path = require('path');

const LOCK_PATH = path.join(__dirname, '..', '.music-soup-sync.lock');

/**
 * @returns {boolean}
 */
function isSyncLockHeld() {
  return fs.existsSync(LOCK_PATH);
}

/**
 * @returns {number|null}
 */
function readSyncLockPid() {
  if (!isSyncLockHeld()) {
    return null;
  }

  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Run work while holding the sync lock.
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withSyncLock(work) {
  if (isSyncLockHeld()) {
    const pid = readSyncLockPid();
    throw new Error(
      pid
        ? `Another Music Soup sync is already running (pid ${pid})`
        : 'Another Music Soup sync is already running'
    );
  }

  fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });

  const releaseOwnedLock = () => {
    try {
      if (readSyncLockPid() === process.pid) {
        fs.unlinkSync(LOCK_PATH);
      }
    } catch {
      // The lock may already be gone; cleanup must not mask the sync result.
    }
  };

  // `process.exit()` does not wait for Promise finally blocks, so also clean
  // up synchronously on the process exit event (including the CLI SIGINT path).
  process.once('exit', releaseOwnedLock);

  try {
    return await work();
  } finally {
    process.removeListener('exit', releaseOwnedLock);
    releaseOwnedLock();
  }
}

module.exports = {
  LOCK_PATH,
  isSyncLockHeld,
  readSyncLockPid,
  withSyncLock,
};
