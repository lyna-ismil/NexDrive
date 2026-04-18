const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const Reclamation = require('../models/reclamation');
const upload = require('../middleware/upload');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');

const router = express.Router();

const USER_SERVICE_URL    = process.env.USER_SERVICE    || 'http://localhost:6004';
const CAR_SERVICE_URL     = process.env.CAR_SERVICE     || 'http://localhost:6002';
const BOOKING_SERVICE_URL = process.env.BOOKING_SERVICE || 'http://localhost:6003';

const fetchFromService = async (url) => {
  try {
    const resp = await axios.get(url, { timeout: 4000 });
    return resp.data;
  } catch { return null; }
};

// --- Validation Schemas ---
const createReclamationSchema = Joi.object({
  userId:    Joi.string().hex().length(24).required(),
  carId:     Joi.string().hex().length(24).optional().allow(null, ''),
  message:   Joi.string().required().min(5).max(2000),
  bookingId: Joi.string().hex().length(24).optional().allow(null, ''),
  priority:  Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional()
});

const updateReclamationSchema = Joi.object({
  message:   Joi.string().min(5).max(2000).optional(),
  adminNote: Joi.string().max(2000).optional().allow(''),
  status:    Joi.string().valid('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED').optional(),
  assignedAdminId: Joi.string().hex().length(24).optional().allow(''),
  priority:  Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional()
}).min(1);

const assignSchema = Joi.object({
  assignedAdminId: Joi.string().hex().length(24).required()
});

const resolveSchema = Joi.object({
  status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED').required()
});

const noteSchema = Joi.object({
  adminNote: Joi.string().max(2000).required().allow('')
});

// ✅ CREATE RECLAMATION
router.post('/', upload.single('image'), validate(createReclamationSchema), async (req, res, next) => {
  try {
    const { userId } = req.body;

    // Verify user exists via HTTP
    try {
      await axios.get(`${USER_SERVICE_URL}/users/${userId}`, { timeout: 4000 });
    } catch {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    }

    const reclamation = new Reclamation({
      ...req.body,
      image: req.file ? req.file.path : null
    });

    await reclamation.save();
    res.status(201).json(reclamation);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL RECLAMATIONS (with user + car enrichment)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.assignedAdminId) filter.assignedAdminId = req.query.assignedAdminId;

    const reclamations = await Reclamation.find(filter).sort({ createdAt: -1 });

    // Enrich with user + car data
    const enriched = await Promise.all(reclamations.map(async (r) => {
      const [user, car] = await Promise.all([
        fetchFromService(`${USER_SERVICE_URL}/users/${r.userId}`),
        r.carId ? fetchFromService(`${CAR_SERVICE_URL}/cars/${r.carId}`) : null
      ]);
      return { ...r.toObject(), user, car };
    }));

    res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
});

// ✅ GET RECLAMATION BY ID (full detail with user history + car info)
router.get('/:id', async (req, res, next) => {
  try {
    const reclamation = await Reclamation.findById(req.params.id);
    if (!reclamation) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');

    // Fetch user, car, user bookings, and user reclamation count in parallel
    const [user, car, userBookings, userReclamations] = await Promise.all([
      fetchFromService(`${USER_SERVICE_URL}/users/${reclamation.userId}`),
      reclamation.carId ? fetchFromService(`${CAR_SERVICE_URL}/cars/${reclamation.carId}`) : null,
      fetchFromService(`${BOOKING_SERVICE_URL}/bookings/user/${reclamation.userId}`),
      Reclamation.countDocuments({ userId: reclamation.userId })
    ]);

    // Enrich bookings with car data
    let enrichedBookings = [];
    if (userBookings && Array.isArray(userBookings)) {
      enrichedBookings = await Promise.all(userBookings.map(async (b) => {
        const bookingCar = b.carId ? await fetchFromService(`${CAR_SERVICE_URL}/cars/${b.carId}`) : null;
        return { ...b, car: bookingCar };
      }));
    }

    res.status(200).json({
      ...reclamation.toObject(),
      user,
      car,
      userBookings: enrichedBookings,
      userReclamationCount: userReclamations
    });
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE RECLAMATION
router.put('/:id', upload.single('image'), validate(updateReclamationSchema), async (req, res, next) => {
  try {
    const updateFields = {};
    if (req.body.message) updateFields.message = req.body.message;
    if (req.body.adminNote !== undefined) updateFields.adminNote = req.body.adminNote;
    if (req.body.status) updateFields.status = req.body.status;
    if (req.body.assignedAdminId) updateFields.assignedAdminId = req.body.assignedAdminId;
    if (req.body.priority) updateFields.priority = req.body.priority;
    if (req.file) updateFields.image = req.file.path;

    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );
    if (!updated) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE ADMIN NOTE
router.put('/:id/note', validate(noteSchema), async (req, res, next) => {
  try {
    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      { adminNote: req.body.adminNote },
      { new: true, runValidators: true }
    );
    if (!updated) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

// ✅ ASSIGN TO ADMIN
router.put('/:id/assign', validate(assignSchema), async (req, res, next) => {
  try {
    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      { assignedAdminId: req.body.assignedAdminId, status: 'IN_PROGRESS' },
      { new: true, runValidators: true }
    );
    if (!updated) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json({ message: 'Reclamation assigned', reclamation: updated });
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE STATUS
router.put('/:id/status', validate(resolveSchema), async (req, res, next) => {
  try {
    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!updated) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json({ message: `Reclamation status updated to ${req.body.status}`, reclamation: updated });
  } catch (error) {
    next(error);
  }
});

// ✅ DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Reclamation.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json({ message: 'Reclamation deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
