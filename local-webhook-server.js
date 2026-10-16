/**
 * Local Notion Webhook Server
 *
 * Receives Notion webhook events and runs the local sync directly on the host
 * machine. This server is intentionally separate from webhook-server.js so the
 * existing GitHub dispatch path can stay live during migration.
 */

const crypto = require('crypto');
const express = require('express');

require('./config');

const logger = require('./utils/logger');
const syncOrchestrator = require('./syncOrchestrator');
const { withSyncLock } = require('./utils/syncLock');

/**
 * @typedef {Object} SyncResultSummary
 * @property {string} status
 * @property {number} runId
 * @property {string} trigger
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {number} durationMs
 * @property {number|null} tracksProcessed
 * @property {number|null} tracksMarkedRemoved
 * @property {number|null} totalErrors
 * @property {string|null} error
 */

/**
 * @typedef {Object} LocalWebhookState
 * @property {boolean} syncRunning
 * @property {boolean} pendingSync
 * @property {string|null} lastStartedAt
 * @property {string|null} lastFinishedAt
 * @property {SyncResultSummary|null} lastResult
 * @property {number} nextRunId
 */

/**
 * Create the initial in-memory server state.
 * @returns {LocalWebhookState}
 */
function createInitialState() {
  return {
    syncRunning: false,
    pendingSync: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastResult: null,
    nextRunId: 1,
  };
}

/**
 * Parse and validate the configured webhook port.
 * @returns {number}
 */
function getWebhookPort() {
  const portValue = process.env.WEBHOOK_PORT || '3000';
  const port = Number.parseInt(portValue, 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid WEBHOOK_PORT value: ${portValue}`);
  }

  return port;
}

/**
 * Create a safe request log payload without leaking secrets.
 * @param {import('express').Request} req
 * @returns {Object}
 */
function buildRequestMetadata(req) {
  return {
    contentType: req.get('content-type') || null,
    contentLength: req.get('content-length') || null,
    hasWebhookSecretHeader: Boolean(req.get('x-webhook-secret')),
    ip: req.ip,
    method: req.method,
    path: req.path,
    payloadKeys: Object.keys(req.body || {}),
    userAgent: req.get('user-agent') || null,
  };
}

/**
 * Compare webhook secrets with constant-time semantics.
 * @param {string} expectedSecret
 * @param {string} receivedSecret
 * @returns {boolean}
 */
function secretsMatch(expectedSecret, receivedSecret) {
  const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
  const receivedBuffer = Buffer.from(receivedSecret, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Validate the incoming webhook secret when one is configured.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isAuthorizedWebhook(req) {
  const expectedSecret = process.env.WEBHOOK_SECRET || '';

  if (!expectedSecret) {
    return true;
  }

  const receivedSecret = req.get('x-webhook-secret');
  if (!receivedSecret) {
    return false;
  }

  return secretsMatch(expectedSecret, receivedSecret);
}

/**
 * Build the public health payload from internal state.
 * @param {LocalWebhookState} state
 * @returns {Object}
 */
function buildHealthResponse(state) {
  return {
    status: 'ok',
    syncPolicy: syncOrchestrator.SYNC_POLICY_VERSION,
    syncRunning: state.syncRunning,
    pendingSync: state.pendingSync,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastResult: state.lastResult,
  };
}

/**
 * Build a trigger description for logs and result records.
 * @param {import('express').Request} req
 * @param {number} requestId
 * @returns {string}
 */
function buildTriggerName(req, requestId) {
  const source = req.body && typeof req.body.source === 'string' ? req.body.source : 'notion-webhook';
  return `${source}:request-${requestId}`;
}

/**
 * Create a compact result summary from a sync run.
 * @param {number} runId
 * @param {string} trigger
 * @param {string} startedAt
 * @param {string} finishedAt
 * @param {number} durationMs
 * @param {Object|null} syncResults
 * @param {Error|null} error
 * @returns {SyncResultSummary}
 */
function buildResultSummary(runId, trigger, startedAt, finishedAt, durationMs, syncResults, error) {
  const tracksProcessed = syncResults ? syncResults.sync.total.processed : null;
  const tracksMarkedRemoved = syncResults ? syncResults.cleanup.marked : null;
  const totalErrors = syncResults ? syncResults.sync.total.errors + syncResults.cleanup.errors : null;

  return {
    status: error ? 'error' : 'success',
    runId,
    trigger,
    startedAt,
    finishedAt,
    durationMs,
    tracksProcessed,
    tracksMarkedRemoved,
    totalErrors,
    error: error ? error.message : null,
  };
}

/**
 * Run a single sync and record its outcome in the shared state.
 * @param {LocalWebhookState} state
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function runSingleSync(state, trigger) {
  const runId = state.nextRunId;
  state.nextRunId += 1;

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  state.lastStartedAt = startedAt;

  logger.info('Starting local sync run', {
    runId,
    trigger,
  });

  try {
    const syncResults = await withSyncLock(() => syncOrchestrator.fullSync());
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    state.lastFinishedAt = finishedAt;
    state.lastResult = buildResultSummary(
      runId,
      trigger,
      startedAt,
      finishedAt,
      durationMs,
      syncResults,
      null
    );

    logger.info('Local sync run completed', {
      runId,
      trigger,
      durationMs,
      totalErrors: state.lastResult.totalErrors,
      tracksMarkedRemoved: state.lastResult.tracksMarkedRemoved,
      tracksProcessed: state.lastResult.tracksProcessed,
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    state.lastFinishedAt = finishedAt;
    state.lastResult = buildResultSummary(
      runId,
      trigger,
      startedAt,
      finishedAt,
      durationMs,
      null,
      error
    );

    logger.error('Local sync run failed', {
      runId,
      trigger,
      durationMs,
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Process the current sync request and one coalesced follow-up request.
 * @param {LocalWebhookState} state
 * @param {string} initialTrigger
 * @returns {Promise<void>}
 */
async function processSyncQueue(state, initialTrigger) {
  state.syncRunning = true;

  let nextTrigger = initialTrigger;

  try {
    while (nextTrigger) {
      state.pendingSync = false;

      const trigger = nextTrigger;
      nextTrigger = null;

      await runSingleSync(state, trigger);

      if (state.pendingSync) {
        nextTrigger = 'queued-webhook';
      }
    }
  } finally {
    state.syncRunning = false;
    state.pendingSync = false;
  }
}

/**
 * Accept a new sync trigger and either start or queue the work.
 * @param {LocalWebhookState} state
 * @param {string} trigger
 * @returns {{ mode: string, syncRunning: boolean, pendingSync: boolean }}
 */
function acceptSyncTrigger(state, trigger) {
  if (state.syncRunning) {
    const mode = state.pendingSync ? 'coalesced' : 'queued';

    state.pendingSync = true;

    logger.info('Accepted webhook while sync was already running', {
      trigger,
      mode,
      pendingSync: state.pendingSync,
    });

    return {
      mode,
      syncRunning: state.syncRunning,
      pendingSync: state.pendingSync,
    };
  }

  void processSyncQueue(state, trigger);

  logger.info('Accepted webhook and started sync loop', {
    trigger,
    mode: 'started',
  });

  return {
    mode: 'started',
    syncRunning: true,
    pendingSync: state.pendingSync,
  };
}

/**
 * Build the Express application.
 * @param {LocalWebhookState} state
 * @returns {import('express').Express}
 */
function createApp(state) {
  const app = express();
  let requestId = 1;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (req, res) => {
    res.json(buildHealthResponse(state));
  });

  app.post('/notion-webhook', (req, res) => {
    const currentRequestId = requestId;
    requestId += 1;

    const requestMetadata = buildRequestMetadata(req);

    logger.info('Received local webhook request', {
      requestId: currentRequestId,
      ...requestMetadata,
    });

    if (!isAuthorizedWebhook(req)) {
      logger.warn('Rejected webhook request with invalid secret', {
        requestId: currentRequestId,
        ...requestMetadata,
      });

      return res.status(401).json({
        status: 'error',
        message: 'Invalid webhook secret',
      });
    }

    const trigger = buildTriggerName(req, currentRequestId);
    const queueState = acceptSyncTrigger(state, trigger);

    return res.status(202).json({
      status: 'accepted',
      mode: queueState.mode,
      syncRunning: queueState.syncRunning,
      pendingSync: queueState.pendingSync,
      requestId: currentRequestId,
      trigger,
      acceptedAt: new Date().toISOString(),
    });
  });

  return app;
}

/**
 * Start the local webhook server.
 * @returns {{ app: import('express').Express, state: LocalWebhookState, server: import('http').Server }}
 */
function startServer() {
  const port = getWebhookPort();
  const state = createInitialState();
  const app = createApp(state);
  const server = app.listen(port, () => {
    logger.info('Local Notion webhook server started', {
      port,
      webhookSecretConfigured: Boolean(process.env.WEBHOOK_SECRET),
      webhookUrl: `http://127.0.0.1:${port}/notion-webhook`,
      healthUrl: `http://127.0.0.1:${port}/health`,
    });
  });

  return {
    app,
    state,
    server,
  };
}

/**
 * Attach graceful shutdown handlers for a running server instance.
 * @param {import('http').Server} server
 * @returns {void}
 */
function attachShutdownHandlers(server) {
  process.on('SIGINT', () => {
    logger.info('Shutting down local webhook server', {
      signal: 'SIGINT',
    });

    server.close(() => {
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down local webhook server', {
      signal: 'SIGTERM',
    });

    server.close(() => {
      process.exit(0);
    });
  });
}

if (require.main === module) {
  const runtime = startServer();
  attachShutdownHandlers(runtime.server);
}

module.exports = {
  attachShutdownHandlers,
  createApp,
  createInitialState,
  startServer,
};
