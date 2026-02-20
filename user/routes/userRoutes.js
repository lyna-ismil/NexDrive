const express = require('express');
const Joi = require('joi');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/user');
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
  phone:     Joi.string().optional(),
  facture:   Joi.number().optional(),
  nbr_fois_allocation: Joi.number().optional(),
  blacklist: Joi.boolean().optional(),
  status:    Joi.string().valid('ACTIVE', 'SUSPENDED').optional()
}).min(1);

const createUserSchema = Joi.object({
  email:           Joi.string().email().required(),
  password:        Joi.string().min(6).required(),
  fullName:        Joi.string().required(),
  phone:           Joi.string().required(),
  cinImageUrl:     Joi.string().uri().required(),
  licenseImageUrl: Joi.string().uri().required(),
  role:            Joi.string().valid('USER').optional(),
  status:          Joi.string().valid('ACTIVE', 'SUSPENDED').optional()
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

// ✅ UPDATE USER
router.put('/:id', validate(updateUserSchema), async (req, res, next) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, req.body, {
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

module.exports = router;
