/**
 * Retry helpers for Notion API operations.
 *
 * Reads and idempotent updates can safely retry transient failures. Creates
 * only retry explicit rate-limit responses because retrying an ambiguous
 * timeout could create the same page twice.
 */

const logger = require('./logger');

const RETRYABLE_API_CODES = new Set([
  'rate_limited',
  'conflict_error',
  'internal_server_error',
  'bad_gateway',
  'service_unavailable',
  'database_connection_unavailable',
  'gateway_timeout',
]);

class NotionOperationError extends Error {
  /**
   * @param {string} label
   * @param {unknown} cause
   */
  constructor(label, cause) {
    super(`Notion operation failed (${label}): ${cause?.message || String(cause)}`);
    this.name = 'NotionOperationError';
    this.cause = cause;
    this.code = cause?.code;
    this.status = cause?.status;
    this.headers = cause?.headers;
  }
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * @param {unknown} error
 * @returns {number|null}
 */
function getRetryAfterMs(error) {
  const headers = error && error.headers;
  let value;

  if (headers && typeof headers.get === 'function') {
    value = headers.get('retry-after');
  } else if (headers) {
    value = headers['retry-after'] || headers['Retry-After'];
  }

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

/**
 * @param {unknown} error
 * @param {'read'|'update'|'create'} mode
 * @returns {boolean}
 */
function isRetryableNotionError(error, mode = 'read') {
  const code = error && error.code;

  if (mode === 'create') {
    return code === 'rate_limited';
  }

  return code === 'notionhq_client_request_timeout'
    || RETRYABLE_API_CODES.has(code)
    || RETRYABLE_NETWORK_CODES.has(code);
}

/**
 * @param {number} delayMs
 * @returns {Promise<void>}
 */
function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Run a Notion request with bounded retry/backoff.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} operation
 * @param {Object} [options]
 * @param {'read'|'update'|'create'} [options.mode]
 * @param {number} [options.maxAttempts]
 * @param {number} [options.baseDelayMs]
 * @param {(delayMs: number) => Promise<void>} [options.sleepFn]
 * @returns {Promise<T>}
 */
async function withNotionRetry(label, operation, options = {}) {
  const mode = options.mode || 'read';
  const maxAttempts = options.maxAttempts || 4;
  const baseDelayMs = options.baseDelayMs || 500;
  const sleepFn = options.sleepFn || sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = attempt < maxAttempts && isRetryableNotionError(error, mode);
      if (!shouldRetry) {
        throw new NotionOperationError(label, error);
      }

      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = retryAfterMs ?? baseDelayMs * (2 ** (attempt - 1));

      logger.warn('Retrying Notion request after transient failure', {
        label,
        mode,
        attempt,
        maxAttempts,
        delayMs,
        code: error.code || null,
        error: error.message,
      });

      await sleepFn(delayMs);
    }
  }

  throw new Error(`Notion request exhausted retries: ${label}`);
}

module.exports = {
  NotionOperationError,
  getRetryAfterMs,
  isRetryableNotionError,
  withNotionRetry,
};
