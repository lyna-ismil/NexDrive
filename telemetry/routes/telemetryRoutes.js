const express = require('express');
const Joi = require('joi');
const TelemetryMessage = require('../models/telemetryMessage');
const CarTelemetryLatest = require('../models/carTelemetryLatest');
const { verifyDeviceToken } = require('../middleware/deviceAuth');
const { ingestionLimiter, queryLimiter } = require('../middleware/rateLimiter');
const { verifyGatewayOrigin, attachGatewayIdentity, requireRole } = require('../../shared/authMiddleware');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { inc } = require('../../shared/metrics');
const { verifyDevice } = require('../services/deviceClient');

const router = express.Router();

// --- Timestamp bounds ---
const MAX_FUTURE_MS = 5 * 60 * 1000;      // +5 minutes
const MAX_PAST_MS   = 24 * 60 * 60 * 1000; // −24 hours

// --- Validation Schemas ------------------------------------------------

const ingestSchema = Joi.object({
  ts: Joi.date().iso().required().custom((value, helpers) => {
    const now = Date.now();
    const t = new Date(value).getTime();
    if (t > now + MAX_FUTURE_MS) return helpers.error('date.maxFuture');
    if (t < now - MAX_PAST_MS)   return helpers.error('date.maxPast');
    return value;
  }).messages({
    'date.maxFuture': 'ts is too far in the future (max +5 min)',
    'date.maxPast':   'ts is too far in the past (max −24 h)'
  }),
  payload: Joi.object({
    speed:          Joi.number().optional(),
    rpm:            Joi.number().optional(),
    fuelLevel:      Joi.number().min(0).max(100).optional(),
    dtcCodes:       Joi.array().items(Joi.string()).optional(),
    gps: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required()
    }).optional(),
    engineRunning:  Joi.boolean().optional(),
    odometer:       Joi.number().min(0).optional(),
    batteryVoltage: Joi.number().optional(),
    coolantTemp:    Joi.number().optional()
  }).required()
});

const rangeQuerySchema = Joi.object({
  from:  Joi.date().iso().required(),
  to:    Joi.date().iso().required(),
  limit: Joi.number().integer().min(1).max(1000).default(200),
  skip:  Joi.number().integer().min(0).default(0)
});

// ────────────────────────────────────────────────────────────
// POST /telemetry — Ingest telemetry (device-authenticated)
// Auth: Bearer <device-jwt> issued by POST /devices/authenticate
//
// Chain order: verifyDeviceToken → ingestionLimiter → validate → handler
// verifyDeviceToken MUST come first so ingestionLimiter can key by deviceId.
// ────────────────────────────────────────────────────────────
router.post('/',
  verifyDeviceToken,       // 1. authenticate device — sets req.device
  ingestionLimiter,        // 2. rate limit per deviceId (needs req.device)
  validate(ingestSchema),  // 3. validate body + timestamp bounds
  async (req, res, next) => {
    try {
      const { deviceId, carId } = req.device;

      // Validate device is still active via Device service (resilient call)
      const device = await verifyDevice(deviceId, req.headers['x-correlation-id']);
      if (!device) {
        return sendError(res, 403, 'DEVICE_INVALID', 'Device not found or inactive');
      }

      // Use carId from the device record (source of truth) not from JWT
      const resolvedCarId = device.carId || carId;
      if (!resolvedCarId) {
        return sendError(res, 400, 'NO_CAR_PAIRED', 'Device is not paired with any car');
      }

      const ts = req.body.ts;
      const payload = req.body.payload;

      // Insert raw telemetry message
      const message = new TelemetryMessage({
        deviceId,
        carId: resolvedCarId,
        ts,
        payload
      });
      await message.save();

      // Upsert latest snapshot for O(1) reads
      await CarTelemetryLatest.findOneAndUpdate(
        { carId: resolvedCarId },
        { carId: resolvedCarId, deviceId, ts, payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.status(201).json({ acknowledged: true, id: message._id });
      inc('telemetry.ingest.success');
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /telemetry/cars/:carId/latest — Latest snapshot (admin)
// Uses CarTelemetryLatest for O(1) lookup instead of sorting raw collection.
// ────────────────────────────────────────────────────────────
router.get('/cars/:carId/latest',
  queryLimiter,
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const snapshot = await CarTelemetryLatest.findOne({ carId: req.params.carId });
      if (!snapshot) return sendError(res, 404, 'NO_TELEMETRY', 'No telemetry data for this car');
      res.status(200).json(snapshot);
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /telemetry/cars/:carId/range?from=&to=&limit=&skip=
// Admin only — paginated range query
// ────────────────────────────────────────────────────────────
router.get('/cars/:carId/range',
  queryLimiter,
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(rangeQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { from, to, limit, skip } = req.query;

      const filter = {
        carId: req.params.carId,
        ts: { $gte: new Date(from), $lte: new Date(to) }
      };

      const [messages, total] = await Promise.all([
        TelemetryMessage.find(filter)
          .sort({ ts: -1 })
          .skip(skip)
          .limit(limit),
        TelemetryMessage.countDocuments(filter)
      ]);

      res.status(200).json({ messages, total, limit, skip });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
