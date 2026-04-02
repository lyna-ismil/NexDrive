const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const upload = require('../middleware/upload');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');

const router = express.Router();

// --- Validation Schemas ---
const signupSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().required(),
  phone:    Joi.string().required()
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required()
});

const updateUserSchema = Joi.object({
  fullName:  Joi.string().optional(),
  email:     Joi.string().email().optional(),
  phone:     Joi.string().optional(),
  password:  Joi.string().min(6).optional().allow(''),
  facture:   Joi.number().optional(),
  nbr_fois_allocation: Joi.number().optional(),
  blacklist: Joi.boolean().optional(),
  status:    Joi.string().valid('ACTIVE', 'SUSPENDED').optional(),
  role:      Joi.string().valid('USER', 'ADMIN').optional()
}).min(1);

const createUserSchema = Joi.object({
  email:           Joi.string().email().required(),
  password:        Joi.string().min(6).required(),
  fullName:        Joi.string().required(),
  phone:           Joi.string().required(),
  cinImageUrl:     Joi.string().uri().optional().allow('', null),
  licenseImageUrl: Joi.string().uri().optional().allow('', null),
  role:            Joi.string().valid('USER', 'ADMIN').optional(),
  status:          Joi.string().valid('ACTIVE', 'SUSPENDED').optional(),
  facture:         Joi.number().optional(),
  nbr_fois_allocation: Joi.number().optional(),
  blacklist:       Joi.boolean().optional()
});

// ✅ SIGNUP with CIN + License image upload
router.post('/signup', upload.fields([{ name: 'cin' }, { name: 'permis' }]), validate(signupSchema), async (req, res, next) => {
  try {
    if (!req.files?.cin || !req.files?.permis) {
      return sendError(res, 400, 'MISSING_IMAGES', 'CIN and License images are required');
    }

    const existing = await User.findOne({ email: req.body.email });
    if (existing) return sendError(res, 409, 'USER_EXISTS', 'User already exists with this email');

    const cinImageUrl     = `http://${req.hostname}:6004/uploads/${req.files.cin[0].filename}`;
    const licenseImageUrl = `http://${req.hostname}:6004/uploads/${req.files.permis[0].filename}`;

    const newUser = new User({
      email:    req.body.email,
      password: req.body.password,
      fullName: req.body.fullName,
      phone:    req.body.phone,
      cinImageUrl,
      licenseImageUrl
    });

    await newUser.save();
    const userObj = newUser.toObject();
    delete userObj.password;
    res.status(201).json({ message: 'User registered successfully', user: userObj });
  } catch (error) {
    next(error);
  }
});

// ✅ LOGIN
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    const userObj = user.toObject();
    delete userObj.password;
    res.status(200).json({ message: 'Login successful', user: userObj });
  } catch (error) {
    next(error);
  }
});

// ✅ CREATE USER (admin-facing)
router.post('/', validate(createUserSchema), async (req, res, next) => {
  try {
    delete req.body._id;
    const newUser = new User(req.body);
    await newUser.save();
    const userObj = newUser.toObject();
    delete userObj.password;
    res.status(201).json(userObj);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL USERS
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.blacklist) filter.blacklist = req.query.blacklist === 'true';

    const users = await User.find(filter, { password: 0 });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
});

// ✅ GET USER BY EMAIL
router.get('/email', async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) return sendError(res, 400, 'MISSING_EMAIL', 'Email query parameter is required');

    const user = await User.findOne({ email }).select('+password');
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});

// ✅ GET USER BY ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid user ID format');
    }

    const user = await User.findById(req.params.id, { password: 0 });
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});

// ✅ GET USER HISTORY (bookings with car info + reclamation count)
const BOOKING_SERVICE_URL     = process.env.BOOKING_SERVICE     || 'http://localhost:6003';
const CAR_SERVICE_URL         = process.env.CAR_SERVICE         || 'http://localhost:6002';
const RECLAMATION_SERVICE_URL = process.env.RECLAMATION_SERVICE || 'http://localhost:6001';

const fetchFromService = async (url) => {
  try {
    const resp = await require('axios').get(url, { timeout: 4000 });
    return resp.data;
  } catch { return null; }
};

router.get('/:id/history', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid user ID format');
    }

    const user = await User.findById(req.params.id, { password: 0 });
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');

    // Fetch bookings and reclamations in parallel
    const [bookings, reclamations] = await Promise.all([
      fetchFromService(`${BOOKING_SERVICE_URL}/bookings/user/${req.params.id}`),
      fetchFromService(`${RECLAMATION_SERVICE_URL}/reclamations?userId=${req.params.id}`)
    ]);

    // Enrich bookings with car data
    let enrichedBookings = [];
    if (bookings && Array.isArray(bookings)) {
      enrichedBookings = await Promise.all(bookings.map(async (b) => {
        const car = b.carId ? await fetchFromService(`${CAR_SERVICE_URL}/cars/${b.carId}`) : null;
        return { ...b, car };
      }));
    }

    res.status(200).json({
      user: user.toObject(),
      bookings: enrichedBookings,
      reclamationCount: Array.isArray(reclamations) ? reclamations.length : 0,
      rentalCount: enrichedBookings.length
    });
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE USER
router.put('/:id', upload.single('photo'), async (req, res, next) => {
  try {
    if (req.body.blacklist !== undefined) req.body.blacklist = req.body.blacklist === 'true';
    if (req.body.facture !== undefined) req.body.facture = Number(req.body.facture);
    if (req.body.nbr_fois_allocation !== undefined) req.body.nbr_fois_allocation = Number(req.body.nbr_fois_allocation);

    // Strip empty password before validation so it doesn't fail min(6)
    if (req.body.password !== undefined && req.body.password.trim() === '') {
      delete req.body.password;
    }

    const { error } = updateUserSchema.validate(req.body);
    if (error) return sendError(res, 400, 'VALIDATION_ERROR', error.details[0].message);

    const updateFields = { ...req.body };
    if (req.file) updateFields.profilePhoto = `/uploads/${req.file.filename}`;

    // Hash password if provided
    if (updateFields.password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(updateFields.password, salt);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true,
      projection: { password: 0 }
    });
    if (!updated) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

// ✅ DELETE USER
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ✅ UPLOAD USER PHOTO
router.post('/:id/photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 400, 'NO_FILE', 'Photo file is required');

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { profilePhoto: `/uploads/${req.file.filename}` },
      { new: true, projection: { password: 0 } }
    );
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});

// ✅ ADD ADMIN NOTE TO USER
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { text, createdBy } = req.body;
    if (!text) return sendError(res, 400, 'MISSING_TEXT', 'Note text is required');

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $push: { notes: { text, createdBy: createdBy || 'Admin' } } },
      { new: true, projection: { password: 0 } }
    );
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
