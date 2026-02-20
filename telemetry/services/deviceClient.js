const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE_URL || 'http://localhost:6006';
const TIMEOUT_MS  = parseInt(process.env.DEVICE_CLIENT_TIMEOUT  || '3000', 10);
const MAX_RETRIES = parseInt(process.env.DEVICE_CLIENT_RETRIES  || '2', 10);
const INTERNAL_S2S_SECRET = process.env.INTERNAL_S2S_SECRET || 'nexdrive-s2s-internal-key';

// ── Minimal circuit breaker state ──────────────────────────
let failures = 0;
let circuitOpen = false;
let circuitOpenUntil = 0;
const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS  = 30 * 1000; // 30 s

function resetCircuit() { failures = 0; circuitOpen = false; }

// ── In-memory TTL device cache ─────────────────────────────
const deviceCache = new Map();        // deviceId → { data, expiresAt }
const CACHE_TTL_MS = 60 * 1000;       // 60 seconds

function getCached(deviceId) {
  const entry = deviceCache.get(deviceId);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  deviceCache.delete(deviceId);
  return null;
}

function setCache(deviceId, data) {
  deviceCache.set(deviceId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const client = axios.create({
  baseURL: DEVICE_SERVICE_URL,
  timeout: TIMEOUT_MS
});

/**
 * Sign an internal S2S request payload using HMAC-SHA256.
 * Payload format: <serviceName>:<resourceId>:<timestamp>:<nonce>
 */
function signInternal(svc, resourceId, ts, nonce) {
  const payload = `${svc}:${resourceId}:${ts}:${nonce}`;
  return crypto.createHmac('sha256', INTERNAL_S2S_SECRET).update(payload).digest('hex');
}

/**
 * Fetch device by deviceId from the Device service via the internal verify endpoint.
 * Uses HMAC signature for S2S authentication (with timestamp + nonce for replay protection).
 * Includes retry + circuit-breaker + cache logic.
 * Returns the device object or null.
 */
async function getDeviceById(deviceId, correlationId) {
  // Circuit-breaker: if open, check if cooldown passed
  if (circuitOpen) {
    if (Date.now() < circuitOpenUntil) {
      console.warn(`⚡ Circuit open — serving from cache for ${deviceId}`);
      return getCached(deviceId);
    }
    // Half-open: try one request
    circuitOpen = false;
  }

  const ts = Date.now().toString();
  const nonce = uuidv4();
  const headers = {
    'x-internal-service': 'telemetry',
    'x-internal-signature': signInternal('telemetry', deviceId, ts, nonce),
    'x-internal-timestamp': ts,
    'x-internal-nonce': nonce
  };
  if (correlationId) {
    headers['x-correlation-id'] = correlationId;
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.get(`/devices/${deviceId}/verify`, { headers });
      resetCircuit();
      setCache(deviceId, res.data);  // Cache successful result
      return res.data;
    } catch (err) {
      lastErr = err;
      // Only retry on network / 5xx errors
      if (err.response && err.response.status < 500) break;
      console.warn(`⚠️ Device Service attempt ${attempt + 1} failed: ${err.message}`);
    }
  }

  failures++;
  if (failures >= FAILURE_THRESHOLD) {
    circuitOpen = true;
    circuitOpenUntil = Date.now() + OPEN_DURATION_MS;
    console.error(`🔴 Circuit breaker OPEN for Device Service (${failures} failures)`);
  }

  // Fallback to cache on failure
  const cached = getCached(deviceId);
  if (cached) {
    console.warn(`📦 Serving cached device data for ${deviceId}`);
    return cached;
  }

  console.error(`❌ Device Service unreachable for ${deviceId}: ${lastErr?.message}`);
  return null;
}

/**
 * Look up a device by its deviceId, returning { deviceId, carId, status }.
 * Returns null if the device service is unavailable or the device is not active.
 */
async function verifyDevice(deviceId, correlationId) {
  const device = await getDeviceById(deviceId, correlationId);
  if (!device) return null;
  if (device.status !== 'ACTIVE') return null;
  return device;
}

module.exports = { getDeviceById, verifyDevice };
