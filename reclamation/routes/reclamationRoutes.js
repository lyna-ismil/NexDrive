const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const Reclamation = require('../models/reclamation');
const upload = require('../middleware/upload');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');

const router = express.Router();

const USER_SERVICE_URL = process.env.USER_SERVICE || 'http://localhost:6004';

// --- Validation Schemas ---
const createReclamationSchema = Joi.object({
  userId:    Joi.string().hex().length(24).required(),
  message:   Joi.string().required().min(5).max(2000),
  bookingId: Joi.string().hex().length(24).optional().allow(null, '')
});

const updateReclamationSchema = Joi.object({
  message: Joi.string().min(5).max(2000).optional()
}).min(1);

const assignSchema = Joi.object({
  assignedAdminId: Joi.string().hex().length(24).required()
});

const resolveSchema = Joi.object({
  status: Joi.string().valid('RESOLVED', 'REJECTED').required()
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
      image: req.file ? req.file.filename : null
    });

    await reclamation.save();
    res.status(201).json(reclamation);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL RECLAMATIONS (with filters)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.assignedAdminId) filter.assignedAdminId = req.query.assignedAdminId;

    const reclamations = await Reclamation.find(filter).sort({ createdAt: -1 });

    // Enrich with user data
    const enriched = await Promise.all(reclamations.map(async (r) => {
      let user = null;
      try {
        const resp = await axios.get(`${USER_SERVICE_URL}/users/${r.userId}`, { timeout: 4000 });
        user = resp.data;
      } catch { /* user unavailable */ }
      return { ...r.toObject(), user };
    }));

    res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
});

// ✅ GET RECLAMATION BY ID
router.get('/:id', async (req, res, next) => {
  try {
    const reclamation = await Reclamation.findById(req.params.id);
    if (!reclamation) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');

    let user = null;
    try {
      const resp = await axios.get(`${USER_SERVICE_URL}/users/${reclamation.userId}`, { timeout: 4000 });
      user = resp.data;
    } catch { /* user unavailable */ }

    res.status(200).json({ ...reclamation.toObject(), user });
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE MESSAGE
router.put('/:id', validate(updateReclamationSchema), async (req, res, next) => {
  try {
    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      { message: req.body.message },
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

// ✅ RESOLVE / REJECT
router.put('/:id/resolve', validate(resolveSchema), async (req, res, next) => {
  try {
    const updated = await Reclamation.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!updated) return sendError(res, 404, 'RECLAMATION_NOT_FOUND', 'Reclamation not found');
    res.status(200).json({ message: `Reclamation ${req.body.status.toLowerCase()}`, reclamation: updated });
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
