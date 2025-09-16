/**
 * Centralized Logging Utility
 * 
 * Provides consistent logging across all modules with configurable levels.
 * All logging MUST go through this module for proper error tracking and debugging.
 * 
 * Dependencies: config.js for log level configuration
 */

const config = require('../config');

// Log Levels (in order of severity)
const LOG_LEVELS = {
  error: 0,
  warn: 1, 
  info: 2,
  debug: 3,
};

// Get current log level from config
const currentLogLevel = LOG_LEVELS[config.config.logLevel] ?? LOG_LEVELS.info;

/**
 * Format timestamp for log entries
 * @returns {string} - ISO timestamp string
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Log message with specified level
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} message - Message to log
 * @param {Object} meta - Optional metadata object
 */
function log(level, message, meta = {}) {
  const levelNum = LOG_LEVELS[level];
  
  // Only log if current level allows this message
  if (levelNum > currentLogLevel) {
    return;
  }
  
  const timestamp = getTimestamp();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...meta,
  };
  
  // Use appropriate console method based on level
  const consoleMethod = level === 'error' ? console.error : 
                       level === 'warn' ? console.warn : 
                       console.log;
  
  consoleMethod(JSON.stringify(logEntry));
}

/**
 * Log error message
 * @param {string} message - Error message
 * @param {Error|Object} error - Error object or metadata
 */
function error(message, error = {}) {
  const meta = error instanceof Error ? {
    error: error.message,
    stack: error.stack,
  } : error;
  
  log('error', message, meta);
}

/**
 * Log warning message
 * @param {string} message - Warning message
 * @param {Object} meta - Optional metadata
 */
function warn(message, meta = {}) {
  log('warn', message, meta);
}

/**
 * Log info message
 * @param {string} message - Info message
 * @param {Object} meta - Optional metadata
 */
function info(message, meta = {}) {
  log('info', message, meta);
}

/**
 * Log debug message
 * @param {string} message - Debug message
 * @param {Object} meta - Optional metadata
 */
function debug(message, meta = {}) {
  log('debug', message, meta);
}

/**
 * Log sync summary with statistics
 * @param {Object} summary - Sync summary object
 * @param {string} summary.source - Source platform (Spotify/Apple Music)
 * @param {number} summary.processed - Number of tracks processed
 * @param {number} summary.created - Number of new records created
 * @param {number} summary.updated - Number of records updated
 * @param {number} summary.errors - Number of errors encountered
 * @param {number} summary.duration - Sync duration in milliseconds
 */
function syncSummary(summary) {
  info('Sync completed', {
    source: summary.source,
    processed: summary.processed,
    created: summary.created,
    updated: summary.updated,
    errors: summary.errors,
    duration: `${summary.duration}ms`,
  });
}

/**
 * Log API rate limit information
 * @param {string} service - Service name (Spotify, Apple Music, Notion)
 * @param {number} remaining - Remaining requests
 * @param {number} resetTime - Reset time in seconds
 */
function rateLimitInfo(service, remaining, resetTime) {
  const resetDate = new Date(resetTime * 1000);
  warn('API rate limit approaching', {
    service,
    remaining,
    resetsAt: resetDate.toISOString(),
  });
}

/**
 * Log metadata gap for missing fields
 * @param {string} trackId - Track identifier
 * @param {string} source - Source platform
 * @param {Array<string>} missingFields - Array of missing field names
 */
function metadataGap(trackId, source, missingFields) {
  warn('Incomplete metadata detected', {
    trackId,
    source,
    missingFields,
  });
}

module.exports = {
  error,
  warn,
  info,
  debug,
  syncSummary,
  rateLimitInfo,
  metadataGap,
  LOG_LEVELS,
};

