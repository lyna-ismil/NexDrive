const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'yourSuperSecretKey';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'nexdrive-gateway-internal-key';
const INTERNAL_S2S_SECRET = process.env.INTERNAL_S2S_SECRET || 'nexdrive-s2s-internal-key';
const S2S_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // ±5 minutes

// ── Nonce dedup store (in-memory, cleaned every 10 min) ───
const usedNonces = new Map(); // nonce → expiresAt
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces) {
    if (now > expiresAt) usedNonces.delete(nonce);
  }
}, 10 * 60 * 1000);

// ── JWT Verification ───────────────────────────────────────

/**
 * Verify JWT token from Authorization header.
 * Sets req.user = { id, email, role } on success.
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'AUTH_TOKEN_MISSING', message: 'Authorization token is required' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID';
    return res.status(401).json({
      error: { code, message: err.message }
    });
  }
};

// ── Role-based Access ──────────────────────────────────────

/**
 * Role-based access guard. Use after verifyToken or attachGatewayIdentity.
 * @param  {...string} allowedRoles - e.g. 'ADMIN', 'SUPER_ADMIN', 'USER'
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: { code: 'AUTH_ROLE_MISSING', message: 'User role not found in token' }
      });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: { code: 'AUTH_FORBIDDEN', message: `Role '${req.user.role}' is not authorized` }
      });
    }
    next();
  };
};

// ── Gateway Origin Verification ────────────────────────────

/**
 * Defense-in-depth: verify request came through the API Gateway.
 * Checks x-internal-gateway-key header against GATEWAY_SECRET env var.
 */
const verifyGatewayOrigin = (req, res, next) => {
  const gatewayKey = req.headers['x-internal-gateway-key'];
  if (!gatewayKey || gatewayKey !== GATEWAY_SECRET) {
    return res.status(403).json({
      error: { code: 'GATEWAY_AUTH_FAILED', message: 'Request must originate from the API Gateway' }
    });
  }
  next();
};

/**
 * Attach user identity from gateway-forwarded headers.
 * MUST be used after verifyGatewayOrigin to trust the headers.
 * Sets req.user = { id, role, email } from x-user-id/role/email headers.
 */
const attachGatewayIdentity = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const role   = req.headers['x-user-role'];
  const email  = req.headers['x-user-email'];

  if (userId && role) {
    req.user = { id: userId, role, email: email || '' };
  }
  next();
};

// ── Service-to-Service (S2S) HMAC Auth ─────────────────────

/**
 * Verify HMAC signature from an internal service call.
 * Expects headers: x-internal-service, x-internal-signature,
 *                  x-internal-timestamp, x-internal-nonce
 * The signature is computed as:
 *   HMAC-SHA256(INTERNAL_S2S_SECRET, "<serviceName>:<resource-identifier>:<timestamp>:<nonce>")
 *
 * The resource identifier is extracted from req.params (first param value).
 * Rejects requests with timestamps outside ±5 min or repeated nonces.
 */
const verifyInternalService = (req, res, next) => {
  const svc   = req.headers['x-internal-service'];
  const sig   = req.headers['x-internal-signature'];
  const ts    = req.headers['x-internal-timestamp'];
  const nonce = req.headers['x-internal-nonce'];

  if (!svc || !sig || !ts || !nonce) {
    return res.status(401).json({
      error: { code: 'S2S_UNAUTHORIZED', message: 'Missing internal service auth headers' }
    });
  }

  // Timestamp check: reject if outside ±5 min
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > S2S_TIMESTAMP_TOLERANCE_MS) {
    return res.status(401).json({
      error: { code: 'S2S_TIMESTAMP_INVALID', message: 'Request timestamp is outside acceptable window' }
    });
  }

  // Nonce check: reject replays
  if (usedNonces.has(nonce)) {
    return res.status(401).json({
      error: { code: 'S2S_NONCE_REUSED', message: 'Nonce has already been used' }
    });
  }

  // Build payload from service name + first route param + timestamp + nonce
  const paramValues = Object.values(req.params);
  const resourceId = paramValues.length > 0 ? paramValues[0] : '';
  const payload = `${svc}:${resourceId}:${ts}:${nonce}`;

  const expected = crypto
    .createHmac('sha256', INTERNAL_S2S_SECRET)
    .update(payload)
    .digest('hex');

  if (sig !== expected) {
    return res.status(401).json({
      error: { code: 'S2S_UNAUTHORIZED', message: 'Invalid internal service signature' }
    });
  }

  // Record nonce to prevent replay (TTL = 2x tolerance)
  usedNonces.set(nonce, Date.now() + S2S_TIMESTAMP_TOLERANCE_MS * 2);

  req.internalService = svc;
  next();
};

module.exports = {
  verifyToken,
  requireRole,
  verifyGatewayOrigin,
  attachGatewayIdentity,
  verifyInternalService
};
