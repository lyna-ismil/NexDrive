const rateLimit = require('express-rate-limit');

/**
 * Strict limiter for sensitive endpoints (device registration, auth).
 */
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' }
  }
});

/**
 * General limiter for read endpoints.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' }
  }
});

module.exports = { sensitiveLimiter, generalLimiter };
