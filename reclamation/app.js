require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { globalErrorHandler } = require('../shared/errorHandler');
const { requestLogger } = require('../shared/logger');

const app = express();

// ── Security ───────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());

// ── Mongoose ───────────────────────────────────────────────
mongoose.set('strictQuery', true);
const MONGO_URI = process.env.MONGO_URI_RECLAMATION || 'mongodb://localhost:27017/reclamationdb';
const PORT = process.env.PORT_RECLAMATION || 6007;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB (Reclamation) connected'))
  .catch(err => {
    console.error('❌ MongoDB (Reclamation) connection error:', err.message);
    process.exit(1);
  });

mongoose.connection.on('error', err => console.error('❌ Mongoose runtime error:', err.message));

// ── Structured Request Logger ──────────────────────────────
app.use(requestLogger('reclamation'));

// ── Routes ─────────────────────────────────────────────────
const reclamationRoutes = require('./routes/reclamationRoutes');
app.use('/reclamations', reclamationRoutes);

// ── Health / Debug ─────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ service: 'reclamation', status: 'UP', timestamp: new Date().toISOString() });
});
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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Reclamation Service running on port ${PORT}`));

module.exports = app;
