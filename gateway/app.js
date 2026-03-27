require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT_GATEWAY || 5000;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'nexdrive-gateway-internal-key';
const { authRouter, verifyToken } = require('./auth');

// ── Security ───────────────────────────────────────────────
app.use(helmet());

// CORS: restrict origins via env var (comma-separated), default '*'
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : '*';
app.use(cors({ origin: corsOrigins }));

app.use(morgan(':method :url :status :response-time ms'));

// ── Correlation ID Middleware ──────────────────────────────
// Generates a correlation ID for every request or reuses the client's.
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
});

// Body parsers (needed for auth routes; proxy has its own body handling)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Auth Router ────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: { code: 'AUTH_RATE_LIMIT', message: 'Too many authentication attempts, try again later' } }
});
app.use('/auth', authLimiter, authRouter);

// ── Service Registry ───────────────────────────────────────
const services = {
  "/admins":        { url: "http://localhost:6000", path: path.join(__dirname, "../admin/app.js") },
  "/reclamations":  { url: "http://localhost:6001", path: path.join(__dirname, "../reclamation/app.js") },
  "/cars":          { url: "http://localhost:6002", path: path.join(__dirname, "../car/app.js") },
  "/bookings":      { url: "http://localhost:6003", path: path.join(__dirname, "../booking/app.js") },
  "/users":         { url: "http://localhost:6004", path: path.join(__dirname, "../user/app.js") },
  "/telemetry":     { url: "http://localhost:6005", path: path.join(__dirname, "../telemetry/app.js") },
  "/devices":       { url: "http://localhost:6006", path: path.join(__dirname, "../device/app.js") },
  "/notifications": { url: "http://localhost:6007", path: path.join(__dirname, "../notification/app.js") }
};

// Routes that use device auth instead of user JWT
const DEVICE_AUTH_ROUTES = new Set(['/telemetry']);

// ── Rate Limiting ──────────────────────────────────────────
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' } }
});
app.use(limiter);

// ── JWT Middleware (optional — applied per-route) ──────────
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function optionalJwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch {
    // Token invalid — continue without user context
  }
  next();
}

// ── Start Microservices ────────────────────────────────────
const microservicesProcesses = {};
const startMicroservices = () => {
  console.log("🚀 Starting Microservices...");
  for (const [route, service] of Object.entries(services)) {
    if (microservicesProcesses[route]) {
      console.log(`✅ ${route} is already running.`);
      continue;
    }

    const microserviceProcess = spawn('node', [`"${service.path}"`], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    microservicesProcesses[route] = microserviceProcess;

    microserviceProcess.on('exit', (code) => {
      console.error(`❌ Microservice ${route} exited with code ${code}. Restarting...`);
      delete microservicesProcesses[route];
      setTimeout(() => startMicroservices(), 3000);
    });
  }
};

// ── Health Checks ──────────────────────────────────────────
const checkMicroserviceHealth = async () => {
  console.log("⏳ Checking microservices...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  for (const [route, service] of Object.entries(services)) {
    try {
      const res = await axios.get(`${service.url}/health`);
      console.log(`✅ ${route} is UP: ${JSON.stringify(res.data)}`);
    } catch (err) {
      console.error(`❌ ${route} is DOWN`);
    }
  }
};

const verifyDatabaseConnections = async () => {
  for (const [route, service] of Object.entries(services)) {
    try {
      const res = await axios.get(`${service.url}/debug/database`);
      console.log(`🔍 ${route} DB Status: ${res.data.status}`);
    } catch (err) {
      console.error(`⚠️ ${route} DB Not Accessible`);
    }
  }
};

// ── Proxy Setup (with identity headers + correlation ID) ───
Object.keys(services).forEach(route => {
  // For device-authenticated routes, skip user JWT validation
  const middlewares = DEVICE_AUTH_ROUTES.has(route) ? [] : [optionalJwtAuth];

  app.use(route, ...middlewares, (req, res, next) => {
    createProxyMiddleware({
      target: services[route].url,
      changeOrigin: true,
      pathRewrite: (path) => path,
      onError: (err, req, res) => {
        console.error(`❌ Proxy Error on ${route}: ${err.message}`);
        res.status(502).json({ error: { code: 'SERVICE_UNAVAILABLE', message: `Service ${route} is unavailable` } });
      },
      onProxyReq: (proxyReq, req, res) => {
        // Forward correlation ID
        proxyReq.setHeader('x-correlation-id', req.correlationId || uuidv4());

        // Forward gateway internal secret (defense-in-depth)
        proxyReq.setHeader('x-internal-gateway-key', GATEWAY_SECRET);

        // Forward user identity headers if JWT was decoded
        if (req.user) {
          proxyReq.setHeader('x-user-id', req.user.id || '');
          proxyReq.setHeader('x-user-role', req.user.role || '');
          proxyReq.setHeader('x-user-email', req.user.email || '');
        }

        // Forward body for non-GET requests
        if (req.body && Object.keys(req.body).length > 0 && req.method !== 'GET') {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }

        console.log(`➡️ [${req.correlationId}] ${req.method} ${req.originalUrl} -> ${services[route].url}`);
      }
    })(req, res, next);
  });
});

// ── Debug Endpoint ─────────────────────────────────────────
app.get('/debug/services', (_req, res) => {
  res.json({ available_services: Object.keys(services) });
});

// ── Gateway Health ─────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ service: 'gateway', status: 'UP', timestamp: new Date().toISOString() });
});

// ── 404 ────────────────────────────────────────────────────
app.use((_req, res) => {
  console.warn(`❌ Unmatched Route: ${_req.method} ${_req.originalUrl}`);
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  startMicroservices();
  await checkMicroserviceHealth();
  await verifyDatabaseConnections();
});
