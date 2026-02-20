const express = require('express');
const Joi = require('joi');
const Car = require('../models/car');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { verifyInternalService } = require('../../shared/authMiddleware');

const router = express.Router();

// --- Validation Schemas ---
const createCarSchema = Joi.object({
  matricule:        Joi.string().required(),
  marque:           Joi.string().required(),
  location:         Joi.string().required(),
  visite_technique: Joi.date().required(),
  date_assurance:   Joi.date().required(),
  vignette:         Joi.date().required(),
  healthStatus:     Joi.string().valid('OK', 'WARN', 'CRITICAL').optional()
});

const updateCarSchema = Joi.object({
  marque:           Joi.string().optional(),
  location:         Joi.string().optional(),
  visite_technique: Joi.date().optional(),
  date_assurance:   Joi.date().optional(),
  vignette:         Joi.date().optional(),
  healthStatus:     Joi.string().valid('OK', 'WARN', 'CRITICAL').optional()
}).min(1);

const healthPatchSchema = Joi.object({
  healthStatus:      Joi.string().valid('OK', 'WARN', 'CRITICAL').required(),
  lastKnownLocation: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required()
  }).optional(),
  lastKnownOdometer: Joi.number().min(0).optional()
});

// ✅ CREATE CAR
router.post('/', validate(createCarSchema), async (req, res, next) => {
  try {
    const existing = await Car.findOne({ matricule: req.body.matricule });
    if (existing) return sendError(res, 409, 'DUPLICATE_MATRICULE', 'A car with this matricule already exists');

    const car = new Car(req.body);
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

// ✅ UPDATE CAR
router.put('/:id', validate(updateCarSchema), async (req, res, next) => {
  try {
    const car = await Car.findByIdAndUpdate(req.params.id, req.body, {
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
  status:    Joi.string().valid('AVAILABLE', 'RESERVED', 'IN_USE').required(),
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
