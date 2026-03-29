const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Device = require('../models/device');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { verifyGatewayOrigin, attachGatewayIdentity, requireRole, verifyInternalService } = require('../../shared/authMiddleware');
const { sensitiveLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const DEVICE_JWT_SECRET = process.env.DEVICE_JWT_SECRET || process.env.JWT_SECRET || 'deviceSecretKey';
const DEVICE_JWT_EXPIRATION = process.env.DEVICE_JWT_EXPIRATION || '1h';

// --- Validation Schemas ---
const registerSchema = Joi.object({
  serialNumber:    Joi.string().required().trim(),
  sharedSecret:    Joi.string().required().min(16),
  firmwareVersion: Joi.string().optional().allow(''),
  carId:           Joi.string().hex().length(24).optional().allow(null, '')
});

const pairSchema = Joi.object({
  carId: Joi.string().hex().length(24).required()
});

const statusSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'BLOCKED', 'RETIRED').required()
});

const authSchema = Joi.object({
  serialNumber: Joi.string().required(),
  sharedSecret: Joi.string().required()
});

const updateDeviceSchema = Joi.object({
  status: Joi.string().valid('ACTIVE', 'BLOCKED', 'RETIRED').optional(),
  firmwareVersion: Joi.string().optional().allow(''),
  carId: Joi.string().hex().length(24).optional().allow(null, '')
}).min(1);

// ────────────────────────────────────────────────────────────
// POST /devices — Register a new device (admin only)
// ────────────────────────────────────────────────────────────
router.post('/',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  sensitiveLimiter,
  validate(registerSchema),
  async (req, res, next) => {
    try {
      const { serialNumber, sharedSecret, firmwareVersion, carId } = req.body;

      // Check duplicate serialNumber
      const existing = await Device.findOne({ serialNumber });
      if (existing) {
        return sendError(res, 409, 'DUPLICATE_SERIAL', 'A device with this serial number already exists');
      }

      // Hash the shared secret — never store raw
      const salt = await bcrypt.genSalt(12);
      const sharedSecretHash = await bcrypt.hash(sharedSecret, salt);

      const device = new Device({
        serialNumber,
        firmwareVersion: firmwareVersion || null,
        carId: carId || null,
        auth: { sharedSecretHash }
      });

      await device.save();
      res.status(201).json({
        message: 'Device registered',
        device: device.toSafeJSON()
      });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// POST /devices/:id/pair — Pair device with a car (admin only)
// ────────────────────────────────────────────────────────────
router.post('/:id/pair',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(pairSchema),
  async (req, res, next) => {
    try {
      const device = await Device.findById(req.params.id);
      if (!device) return sendError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');

      if (device.status !== 'ACTIVE') {
        return sendError(res, 400, 'DEVICE_NOT_ACTIVE', `Cannot pair a ${device.status} device`);
      }

      device.carId = req.body.carId;
      await device.save();

      res.status(200).json({ message: 'Device paired with car', device: device.toSafeJSON() });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// PATCH /devices/:id/status — Change device status (admin only)
// ────────────────────────────────────────────────────────────
router.patch('/:id/status',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(statusSchema),
  async (req, res, next) => {
    try {
      const device = await Device.findByIdAndUpdate(
        req.params.id,
        { status: req.body.status },
        { new: true, runValidators: true }
      );
      if (!device) return sendError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      res.status(200).json({ message: `Device status set to ${req.body.status}`, device: device.toSafeJSON() });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /devices/:id — Get device info (admin only)
// ────────────────────────────────────────────────────────────
router.get('/:id',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const device = await Device.findById(req.params.id);
      if (!device) return sendError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      res.status(200).json(device.toSafeJSON());
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// PUT /devices/:id — Update device info (admin only)
// ────────────────────────────────────────────────────────────
router.put('/:id',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(updateDeviceSchema),
  async (req, res, next) => {
    try {
      const updateFields = {};
      if (req.body.status !== undefined) updateFields.status = req.body.status;
      if (req.body.firmwareVersion !== undefined) updateFields.firmwareVersion = req.body.firmwareVersion;
      if (req.body.carId !== undefined) updateFields.carId = req.body.carId;

      const device = await Device.findByIdAndUpdate(
        req.params.id,
        updateFields,
        { new: true, runValidators: true }
      );
      if (!device) return sendError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      res.status(200).json({ message: 'Device updated', device: device.toSafeJSON() });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /devices — List devices with optional filters (admin only)
// ────────────────────────────────────────────────────────────
router.get('/',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.carId)  filter.carId = req.query.carId;
      if (req.query.status) filter.status = req.query.status;

      const devices = await Device.find(filter).sort({ createdAt: -1 });
      res.status(200).json(devices.map(d => d.toSafeJSON()));
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// POST /devices/authenticate — Device auth → returns short-lived JWT
// Called by devices themselves; not admin‑gated.
// ────────────────────────────────────────────────────────────
router.post('/authenticate',
  sensitiveLimiter,
  validate(authSchema),
  async (req, res, next) => {
    try {
      const { serialNumber, sharedSecret } = req.body;

      // Explicitly select the hashed secret
      const device = await Device.findOne({ serialNumber }).select('+auth.sharedSecretHash');
      if (!device) return sendError(res, 401, 'AUTH_FAILED', 'Invalid credentials');

      if (device.status !== 'ACTIVE') {
        return sendError(res, 403, 'DEVICE_BLOCKED', `Device is ${device.status}`);
      }

      if (!device.auth?.sharedSecretHash) {
        return sendError(res, 401, 'AUTH_FAILED', 'Device has no auth material');
      }

      const valid = await bcrypt.compare(sharedSecret, device.auth.sharedSecretHash);
      if (!valid) return sendError(res, 401, 'AUTH_FAILED', 'Invalid credentials');

      // Update lastSeenAt
      device.lastSeenAt = new Date();
      await device.save();

      // Issue short-lived device JWT
      const token = jwt.sign(
        {
          sub: device.deviceId,
          deviceId: device.deviceId,
          carId: device.carId,
          type: 'device'
        },
        DEVICE_JWT_SECRET,
        { expiresIn: DEVICE_JWT_EXPIRATION }
      );

      res.status(200).json({ token, expiresIn: DEVICE_JWT_EXPIRATION, deviceId: device.deviceId });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /devices/:deviceId/verify — Internal S2S endpoint
// Called by telemetry service to verify a device is active.
// Guarded by HMAC signature, NOT user JWT.
// ────────────────────────────────────────────────────────────
router.get('/:deviceId/verify',
  verifyInternalService,
  async (req, res, next) => {
    try {
      const device = await Device.findOne({ deviceId: req.params.deviceId });
      if (!device) return sendError(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      res.status(200).json({
        deviceId: device.deviceId,
        carId: device.carId,
        status: device.status,
        serialNumber: device.serialNumber
      });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /devices/status — Connection status for ALL devices
// Computes isConnected based on lastSeenAt (< 5 min = connected)
// ────────────────────────────────────────────────────────────
const TELEMETRY_SERVICE_URL = process.env.TELEMETRY_SERVICE || 'http://localhost:6005';
const CONNECTION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

router.get('/status/all',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const devices = await Device.find({ status: 'ACTIVE' }).lean();

      const statuses = devices.map(d => {
        const lastSeen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
        const isConnected = lastSeen ? (Date.now() - lastSeen.getTime()) < CONNECTION_THRESHOLD_MS : false;
        return {
          vehicleId: d.carId || null,
          deviceId: d.deviceId,
          firmwareVersion: d.firmwareVersion || null,
          isConnected,
          lastSeen: lastSeen ? lastSeen.toISOString() : null
        };
      });

      res.status(200).json(statuses);
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /devices/status/:vehicleId — Single vehicle device status
// ────────────────────────────────────────────────────────────
router.get('/status/:vehicleId',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const device = await Device.findOne({ carId: req.params.vehicleId, status: 'ACTIVE' }).lean();
      if (!device) {
        return res.status(200).json({ vehicleId: req.params.vehicleId, device: null, isConnected: false });
      }

      const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
      const isConnected = lastSeen ? (Date.now() - lastSeen.getTime()) < CONNECTION_THRESHOLD_MS : false;

      res.status(200).json({
        vehicleId: req.params.vehicleId,
        deviceId: device.deviceId,
        firmwareVersion: device.firmwareVersion || null,
        isConnected,
        lastSeen: lastSeen ? lastSeen.toISOString() : null
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
