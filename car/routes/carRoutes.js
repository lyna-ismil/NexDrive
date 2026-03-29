const express = require('express');
const Joi = require('joi');
const path = require('path');
const axios = require('axios');
const Car = require('../models/car');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { verifyInternalService } = require('../../shared/authMiddleware');

const router = express.Router();

const DEVICE_SERVICE_URL = process.env.DEVICE_SERVICE || 'http://localhost:6006';

const fetchFromService = async (url) => {
  try {
    const resp = await axios.get(url, { timeout: 4000 });
    return resp.data;
  } catch { return null; }
};

// Multer upload middleware for car photos
const upload = require('../../shared/upload')(path.join(__dirname, '../uploads'));

// --- Validation Schemas ---
const createCarSchema = Joi.object({
  matricule:        Joi.string().required(),
  marque:           Joi.string().required(),
  location:         Joi.string().required(),
  visite_technique: Joi.date().required(),
  date_assurance:   Joi.date().required(),
  vignette:         Joi.date().required(),
  healthStatus:     Joi.string().valid('OK', 'WARN', 'CRITICAL').optional(),
  description:      Joi.string().max(2000).optional().allow(''),
  cityRestriction:  Joi.boolean().optional(),
  allowedCities:    Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ).optional(),
  deviceId:         Joi.string().optional().allow(null, '')
});

const updateCarSchema = Joi.object({
  matricule:        Joi.string().optional(),
  marque:           Joi.string().optional(),
  location:         Joi.string().optional(),
  visite_technique: Joi.date().optional(),
  date_assurance:   Joi.date().optional(),
  vignette:         Joi.date().optional(),
  healthStatus:     Joi.string().valid('OK', 'WARN', 'CRITICAL').optional(),
  description:      Joi.string().max(2000).optional().allow(''),
  cityRestriction:  Joi.boolean().optional(),
  allowedCities:    Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ).optional(),
  deviceId:         Joi.string().optional().allow(null, '')
}).min(1);

const healthPatchSchema = Joi.object({
  healthStatus:      Joi.string().valid('OK', 'WARN', 'CRITICAL').required(),
  lastKnownLocation: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required()
  }).optional(),
  lastKnownOdometer: Joi.number().min(0).optional()
});

// Helper: parse allowedCities from form data (may come as comma-separated string or JSON string)
function parseAllowedCities(body) {
  if (!body.allowedCities) return [];
  if (Array.isArray(body.allowedCities)) return body.allowedCities;
  try {
    const parsed = JSON.parse(body.allowedCities);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  // Comma-separated fallback
  return body.allowedCities.split(',').map(c => c.trim()).filter(Boolean);
}

// Helper: parse boolean from form data
function parseBool(val) {
  if (val === true || val === 'true' || val === '1') return true;
  if (val === false || val === 'false' || val === '0') return false;
  return undefined;
}

// ✅ CREATE CAR
router.post('/', upload.single('photo'), async (req, res, next) => {
  try {
    const existing = await Car.findOne({ matricule: req.body.matricule });
    if (existing) return sendError(res, 409, 'DUPLICATE_MATRICULE', 'A car with this matricule already exists');

    const carData = { ...req.body };

    // Handle photo upload
    if (req.file) {
      carData.photo = `/uploads/${req.file.filename}`;
    }

    // Parse form-data specific fields
    if (carData.cityRestriction !== undefined) {
      carData.cityRestriction = parseBool(carData.cityRestriction);
    }
    if (carData.allowedCities !== undefined) {
      carData.allowedCities = parseAllowedCities(carData);
    }

    // Validate deviceId uniqueness (one-to-one)
    if (carData.deviceId) {
      const alreadyLinked = await Car.findOne({ deviceId: carData.deviceId });
      if (alreadyLinked) {
        return sendError(res, 400, 'DEVICE_ALREADY_LINKED', 'Device already linked to another vehicle');
      }
    } else {
      carData.deviceId = null;
    }

    const car = new Car(carData);
    await car.save();
    res.status(201).json(car);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL CARS (with filters)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.healthStatus) filter.healthStatus = req.query.healthStatus;
    if (req.query.location)     filter.location     = req.query.location;

    const cars = await Car.find(filter);
    res.status(200).json(cars);
  } catch (error) {
    next(error);
  }
});

// ✅ GET CAR BY ID
router.get('/:id', async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
    res.status(200).json(car);
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE CAR (with photo upload support)
router.put('/:id', upload.single('photo'), async (req, res, next) => {
  try {
    const updateData = { ...req.body };

    // Handle photo upload
    if (req.file) {
      updateData.photo = `/uploads/${req.file.filename}`;
    }

    // Parse form-data specific fields
    if (updateData.cityRestriction !== undefined) {
      updateData.cityRestriction = parseBool(updateData.cityRestriction);
    }
    if (updateData.allowedCities !== undefined) {
      updateData.allowedCities = parseAllowedCities(updateData);
    }

    // Validate deviceId uniqueness (one-to-one)
    if (updateData.deviceId !== undefined) {
      if (updateData.deviceId) {
        const alreadyLinked = await Car.findOne({ deviceId: updateData.deviceId, _id: { $ne: req.params.id } });
        if (alreadyLinked) {
          return sendError(res, 400, 'DEVICE_ALREADY_LINKED', 'Device already linked to another vehicle');
        }
      } else {
        updateData.deviceId = null;
      }
    }

    const car = await Car.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });
    if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
    res.status(200).json(car);
  } catch (error) {
    next(error);
  }
});

// ✅ PATCH HEALTH (called by Telemetry service)
router.patch('/:id/health', validate(healthPatchSchema), async (req, res, next) => {
  try {
    const update = {
      healthStatus:     req.body.healthStatus,
      lastHealthUpdate: new Date()
    };
    if (req.body.lastKnownLocation) update.lastKnownLocation = req.body.lastKnownLocation;
    if (req.body.lastKnownOdometer != null) update.lastKnownOdometer = req.body.lastKnownOdometer;

    const car = await Car.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });
    if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
    res.status(200).json(car);
  } catch (error) {
    next(error);
  }
});

// ✅ PATCH AVAILABILITY (called by Booking service via S2S)
const availabilitySchema = Joi.object({
  status:    Joi.string().valid('AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE').required(),
  bookingId: Joi.string().hex().length(24).optional().allow(null, '')
});

router.patch('/:id/availability',
  verifyInternalService,
  validate(availabilitySchema),
  async (req, res, next) => {
    try {
      const car = await Car.findByIdAndUpdate(
        req.params.id,
        { 'availability.status': req.body.status, 'availability.bookingId': req.body.bookingId || null },
        { new: true, runValidators: true }
      );
      if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
      res.status(200).json({ message: `Car availability set to ${req.body.status}`, car });
    } catch (error) {
      next(error);
    }
  }
);

// ✅ PATCH STATUS (Admin UI override)
const adminStatusSchema = Joi.object({
  status: Joi.string().valid('available', 'rented', 'maintenance', 'AVAILABLE', 'IN_USE', 'MAINTENANCE').required()
});

router.patch('/:id/status', validate(adminStatusSchema), async (req, res, next) => {
  try {
    let newStatus = req.body.status.toUpperCase();
    if (newStatus === 'RENTED') newStatus = 'IN_USE';

    const car = await Car.findByIdAndUpdate(
      req.params.id,
      { 'availability.status': newStatus },
      { new: true, runValidators: true }
    );
    if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
    res.status(200).json(car);
  } catch (error) {
    next(error);
  }
});

// ✅ GET CAR DEVICE INFO (fetched from Device Service via HTTP)
router.get('/:id/device', async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');

    if (!car.deviceId) {
      return res.status(200).json({ device: null, message: 'No device linked to this car' });
    }

    // Fetch device info from Device Service
    const device = await fetchFromService(`${DEVICE_SERVICE_URL}/devices?carId=${car.deviceId}`);
    res.status(200).json({ device: device || null });
  } catch (error) {
    next(error);
  }
});

// ✅ DELETE CAR
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Car.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');
    res.status(200).json({ message: 'Car deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
