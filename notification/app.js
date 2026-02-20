require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { globalErrorHandler } = require('../shared/errorHandler');
const { requestLogger } = require('../shared/logger');
const { metricsRoute } = require('../shared/metrics');

const app = express();

// ── Security ───────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());

// ── Mongoose ───────────────────────────────────────────────
mongoose.set('strictQuery', true);
const MONGO_URI = process.env.MONGO_URI_NOTIFICATION || 'mongodb://localhost:27017/notificationdb';
const PORT = process.env.PORT_NOTIFICATION || 6008;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB (Notification) connected'))
  .catch(err => {
    console.error('❌ MongoDB (Notification) connection error:', err.message);
    process.exit(1);
  });

mongoose.connection.on('error', err => console.error('❌ Mongoose runtime error:', err.message));

// ── Structured Request Logger ──────────────────────────────
app.use(requestLogger('notification'));

// ── Routes ─────────────────────────────────────────────────
const notificationRoutes = require('./routes/notificationRoutes');
app.use('/notifications', notificationRoutes);

// ── Health / Debug ─────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ service: 'notification', status: 'UP', timestamp: new Date().toISOString() });
});
app.get('/metrics', metricsRoute('notification'));
app.get('/debug/database', (_req, res) => {
  const state = mongoose.connection.readyState;
  res.json({ status: state === 1 ? 'Connected ✅' : 'Not Connected ❌', readyState: state });
});

// ── 404 ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
});

// ── Global error handler ──────────────────────────────────
app.use(globalErrorHandler);

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Notification Service running on port ${PORT}`));

module.exports = app;
