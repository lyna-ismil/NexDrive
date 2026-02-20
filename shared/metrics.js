/**
 * Lightweight in-process metrics counters.
 * Usage:
 *   const { inc, metricsRoute } = require('../shared/metrics');
 *   inc('booking.create.success');
 *   app.get('/metrics', metricsRoute('booking'));
 */

const counters = {};

/**
 * Increment a named counter.
 * @param {string} name - Dot-separated metric name
 * @param {number} [n=1] - Amount to increment
 */
const inc = (name, n = 1) => {
  counters[name] = (counters[name] || 0) + n;
};

/**
 * Get all counters as a plain object.
 */
const get = () => ({ ...counters });

/**
 * Express route handler that returns current counters.
 * @param {string} serviceName
 */
const metricsRoute = (serviceName) => (_req, res) => {
  res.json({
    service: serviceName,
    counters: get(),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
};

module.exports = { inc, get, metricsRoute };
