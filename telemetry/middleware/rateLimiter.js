const rateLimit = require('express-rate-limit');

/**
 * Ingestion rate limiter — keyed by deviceId (per-device limiting).
 * IMPORTANT: verifyDeviceToken MUST run before this middleware
 * so that req.device.deviceId is populated.
 */
const ingestionLimiter = rateLimit({
  windowMs: 60 * 1000,           // 1 minute
  max: 120,                      // 120 msgs/min/device (~2 msg/s)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.device?.deviceId || req.ip;
  },
  handler: (_req, res) => {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many telemetry messages.' }
    });
  }
});

/**
 * Admin query rate limiter.
 */
const queryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' }
  }
});

module.exports = { ingestionLimiter, queryLimiter };
