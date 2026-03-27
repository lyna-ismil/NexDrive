const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const path = require('path');
const Admin = require('../models/admin');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');

const router = express.Router();

// Multer upload middleware for admin photos
const upload = require('../../shared/upload')(path.join(__dirname, '../uploads'));

// --- Validation Schemas ---
const createAdminSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  phone:    Joi.string().required(),
  name:     Joi.string().required(),
  role:     Joi.string().valid('ADMIN', 'SUPER_ADMIN').optional(),
  status:   Joi.string().valid('ACTIVE', 'SUSPENDED').optional()
});

const updateAdminSchema = Joi.object({
  email:  Joi.string().email().optional(),
  phone:  Joi.string().optional(),
  name:   Joi.string().optional(),
  role:   Joi.string().valid('ADMIN', 'SUPER_ADMIN').optional(),
  status: Joi.string().valid('ACTIVE', 'SUSPENDED').optional()
}).min(1);

const passwordChangeSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     Joi.string().min(6).required()
});

// ✅ CREATE ADMIN
router.post('/', validate(createAdminSchema), async (req, res, next) => {
  try {
    const admin = new Admin(req.body);
    await admin.save();
    const adminObj = admin.toObject();
    delete adminObj.password;
    res.status(201).json(adminObj);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ADMIN BY EMAIL (internal — used by gateway auth)
router.get('/email', async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) return sendError(res, 400, 'MISSING_EMAIL', 'Email query parameter is required');

    const admin = await Admin.findOne({ email }).select('+password');
    if (!admin) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');

    res.status(200).json(admin);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL ADMINS
router.get('/', async (req, res, next) => {
  try {
    const admins = await Admin.find({}, { password: 0 });
    res.status(200).json(admins);
  } catch (error) {
    next(error);
  }
});

// ✅ GET ADMIN BY ID
router.get('/:id', async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.params.id, { password: 0 });
    if (!admin) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');
    res.status(200).json(admin);
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE ADMIN
router.put('/:id', validate(updateAdminSchema), async (req, res, next) => {
  try {
    const updated = await Admin.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
      projection: { password: 0 }
    });
    if (!updated) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

// ✅ UPLOAD ADMIN PHOTO
router.put('/:id/photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 400, 'NO_FILE', 'Photo file is required');

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { photo: `/uploads/${req.file.filename}` },
      { new: true, projection: { password: 0 } }
    );
    if (!admin) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');
    res.status(200).json(admin);
  } catch (error) {
    next(error);
  }
});

// ✅ CHANGE PASSWORD
router.put('/:id/password', validate(passwordChangeSchema), async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.params.id).select('+password');
    if (!admin) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');

    const isMatch = await bcrypt.compare(req.body.currentPassword, admin.password);
    if (!isMatch) return sendError(res, 400, 'WRONG_PASSWORD', 'Current password is incorrect');

    admin.password = req.body.newPassword;
    await admin.save(); // pre-save hook hashes the password
    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

// ✅ DELETE ADMIN
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Admin.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'ADMIN_NOT_FOUND', 'Admin not found');
    res.status(200).json({ message: 'Admin deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

