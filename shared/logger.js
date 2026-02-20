const pino = require('pino');

/**
 * Shared structured logger (Pino).
 * All services use this instead of console.log for structured, JSON-formatted logs.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  base: null // don't include pid/hostname unless needed
});

/**
 * Express middleware that creates a child logger with service + correlationId.
 * Sets req.log for use in route handlers.
 *
 * @param {string} serviceName - e.g. 'booking', 'admin'
 */
function requestLogger(serviceName) {
  return (req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || 'no-correlation';
    req.log = logger.child({ service: serviceName, correlationId });

    req.log.info({ method: req.method, path: req.originalUrl }, 'request');

    res.on('finish', () => {
      req.log.info({ statusCode: res.statusCode }, 'response');
    });

    next();
  };
}

module.exports = { logger, requestLogger };
