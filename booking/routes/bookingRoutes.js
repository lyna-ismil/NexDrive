const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const Booking = require('../models/booking');
const BookingOutbox = require('../models/bookingOutbox');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { inc } = require('../../shared/metrics');

const router = express.Router();

const USER_SERVICE_URL = process.env.USER_SERVICE || 'http://localhost:6004';
const CAR_SERVICE_URL  = process.env.CAR_SERVICE  || 'http://localhost:6002';
const INTERNAL_S2S_SECRET = process.env.INTERNAL_S2S_SECRET || 'nexdrive-s2s-internal-key';

const axiosInstance = axios.create({ timeout: 4000 });
const fetchFromService = async (url) => {
  try {
    const response = await axiosInstance.get(url);
    return response.data;
  } catch (error) {
    console.error(`❌ Fetch failed: ${url} — ${error.message}`);
    return null;
  }
};

const upload = require('../../shared/upload')(path.join(__dirname, '../uploads'));

// ── S2S Helper: sign + patch Car availability ─────────────
function signS2S(svc, resourceId, ts, nonce) {
  const payload = `${svc}:${resourceId}:${ts}:${nonce}`;
  return crypto.createHmac('sha256', INTERNAL_S2S_SECRET).update(payload).digest('hex');
}

async function patchCarAvailability(carId, status, bookingId) {
  const ts = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sig = signS2S('booking', carId, ts, nonce);
  await axiosInstance.patch(`${CAR_SERVICE_URL}/cars/${carId}/availability`, {
    status, bookingId: bookingId || null
  }, {
    headers: {
      'x-internal-service': 'booking',
      'x-internal-signature': sig,
      'x-internal-timestamp': ts,
      'x-internal-nonce': nonce
    }
  });
}

async function syncCarOrOutbox(carId, bookingId, action) {
  try {
    await patchCarAvailability(carId, action, action === 'AVAILABLE' ? null : bookingId);
  } catch (err) {
    console.error(`⚠️ Car availability patch failed for ${carId}, enqueueing outbox: ${err.message}`);
    await BookingOutbox.create({ carId, bookingId, action });
  }
}

// --- Validation Schemas ---
const createBookingSchema = Joi.object({
  userId:          Joi.string().hex().length(24).required(),
  carId:           Joi.string().hex().length(24).required(),
  startDate:       Joi.date().iso().required().custom((value, helpers) => {
    const MAX_PAST_MS = 60 * 60 * 1000; // 1 hour
    if (new Date(value).getTime() < Date.now() - MAX_PAST_MS)
      return helpers.error('date.tooFarPast');
    return value;
  }).messages({ 'date.tooFarPast': 'startDate cannot be more than 1 hour in the past' }),
  endDate:         Joi.date().iso().greater(Joi.ref('startDate')).required(),
  pickupLocation:  Joi.string().optional().allow(''),
  dropoffLocation: Joi.string().optional().allow(''),
  contractUrl:     Joi.string().uri().optional().allow(''),
  payment: Joi.object({
    amount:   Joi.number().min(0).optional(),
    currency: Joi.string().optional(),
    status:   Joi.string().valid('UNPAID', 'PAID', 'FAILED', 'REFUNDED').optional()
  }).optional()
});

const updateBookingSchema = Joi.object({
  startDate:       Joi.date().iso().optional(),
  endDate:         Joi.date().iso().optional(),
  status:          Joi.string().valid('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED').optional(),
  pickupLocation:  Joi.string().optional().allow(''),
  dropoffLocation: Joi.string().optional().allow(''),
  contractUrl:     Joi.string().uri().optional().allow(''),
  payment: Joi.object({
    amount:   Joi.number().min(0).optional(),
    currency: Joi.string().optional(),
    status:   Joi.string().valid('UNPAID', 'PAID', 'FAILED', 'REFUNDED').optional()
  }).optional()
}).min(1);

// ✅ CREATE BOOKING (with overlap protection)
router.post('/', upload.single('image'), validate(createBookingSchema), async (req, res, next) => {
  try {
    const { userId, carId, startDate, endDate } = req.body;

    const [user, car] = await Promise.all([
      fetchFromService(`${USER_SERVICE_URL}/users/${userId}`),
      fetchFromService(`${CAR_SERVICE_URL}/cars/${carId}`)
    ]);
    if (!user) return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    if (!car)  return sendError(res, 404, 'CAR_NOT_FOUND', 'Car not found');

    // ── Overlap check: prevent double booking ──────────────
    const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE'];
    const overlap = await Booking.findOne({
      carId,
      status: { $in: ACTIVE_STATUSES },
      startDate: { $lt: new Date(endDate) },   // existing starts before requested end
      endDate:   { $gt: new Date(startDate) }   // existing ends after requested start
    }).lean();

    if (overlap) {
      return sendError(res, 409, 'CAR_NOT_AVAILABLE',
        'This car is already booked for the selected time range');
    }

    const bookingData = { ...req.body };
    if (req.file) bookingData.image = `/uploads/${req.file.filename}`;

    const booking = new Booking(bookingData);
    await booking.save();

    // Sync car availability (best-effort with outbox fallback)
    await syncCarOrOutbox(carId, booking._id.toString(), 'RESERVED');

    res.status(201).json(booking);
    inc('booking.create.success');
  } catch (error) {
    next(error);
  }
});

// ✅ GET ALL BOOKINGS (with optional enrichment)
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.carId)  filter.carId  = req.query.carId;
    if (req.query.status) filter.status = req.query.status;

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });

    const enriched = await Promise.all(bookings.map(async (b) => {
      const [user, car] = await Promise.all([
        fetchFromService(`${USER_SERVICE_URL}/users/${b.userId}`),
        fetchFromService(`${CAR_SERVICE_URL}/cars/${b.carId}`)
      ]);
      return { ...b.toObject(), user: user || null, car: car || null };
    }));

    res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
});

// ✅ GENERATE NFC KEY (server-side)
router.post('/:id/generate-key', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    // Verify booking status
    if (booking.status !== 'CONFIRMED') {
      return sendError(res, 403, 'INVALID_STATUS',
        'Key can only be generated for CONFIRMED bookings');
    }

    // Verify payment
    if (!booking.payment || booking.payment.status !== 'PAID') {
      return sendError(res, 403, 'UNPAID',
        'Key can only be generated after payment is completed');
    }

    // Verify pickup date (cannot generate before pickup date)
    if (new Date() < new Date(booking.startDate)) {
      return sendError(res, 403, 'TOO_EARLY',
        'Key cannot be generated before the pickup date');
    }

    // Generate cryptographically secure key
    const nfcKey = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(booking.endDate);

    booking.current_Key_car = nfcKey;
    booking.keyExpiresAt = expiresAt;
    await booking.save();

    res.status(200).json({ nfcKey, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

// ✅ GET CONTRACT URL
router.get('/:id/contract', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    if (!booking.contractUrl) {
      return sendError(res, 404, 'NO_CONTRACT', 'No contract available for this booking');
    }

    res.status(200).json({ contractUrl: booking.contractUrl });
  } catch (error) {
    next(error);
  }
});

// ✅ GET BOOKING BY ID
router.get('/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    const [user, car] = await Promise.all([
      fetchFromService(`${USER_SERVICE_URL}/users/${booking.userId}`),
      fetchFromService(`${CAR_SERVICE_URL}/cars/${booking.carId}`)
    ]);

    res.status(200).json({ ...booking.toObject(), user: user || null, car: car || null });
  } catch (error) {
    next(error);
  }
});

// ✅ GET BOOKINGS BY USER (enriched with car data)
router.get('/user/:userId', async (req, res, next) => {
  try {
    const bookings = await Booking.find({ userId: req.params.userId }).sort({ createdAt: -1 });

    const enriched = await Promise.all(bookings.map(async (b) => {
      const car = await fetchFromService(`${CAR_SERVICE_URL}/cars/${b.carId}`);
      return { ...b.toObject(), car: car || null };
    }));

    res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
});

// ✅ GET MY BOOKINGS (Split active/history)
router.get('/my-bookings', async (req, res, next) => {
  try {
    const userId = req.user?.id || req.headers['x-user-id'] || req.query.userId;
    if (!userId) return sendError(res, 400, 'MISSING_USER_ID', 'User ID is required');

    const bookings = await Booking.find({ userId }).sort({ createdAt: -1 });

    const enriched = await Promise.all(bookings.map(async (b) => {
      const car = await fetchFromService(`${CAR_SERVICE_URL}/cars/${b.carId}`);
      return { ...b.toObject(), car: car || null };
    }));

    const activeStatuses = ['PENDING', 'CONFIRMED', 'ACTIVE'];
    const active = enriched.filter(b => activeStatuses.includes(b.status));
    const history = enriched.filter(b => !activeStatuses.includes(b.status));

    res.status(200).json({ active, history });
  } catch (error) {
    next(error);
  }
});

// ✅ GET BOOKINGS BY CAR
router.get('/car/:carId', async (req, res, next) => {
  try {
    const bookings = await Booking.find({ carId: req.params.carId }).sort({ createdAt: -1 });
    res.status(200).json(bookings);
  } catch (error) {
    next(error);
  }
});

// ✅ UPDATE BOOKING
router.put('/:id', upload.single('image'), (req, res, next) => {
  if (typeof req.body.payment === 'string') {
    try { req.body.payment = JSON.parse(req.body.payment); } catch (e) {}
  }
  next();
}, validate(updateBookingSchema), async (req, res, next) => {
  try {
    const updateFields = { ...req.body };
    if (req.file) updateFields.image = `/uploads/${req.file.filename}`;

    const booking = await Booking.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true
    });
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    res.status(200).json(booking);
  } catch (error) {
    next(error);
  }
});

// ✅ CONFIRM BOOKING
router.put('/:id/confirm', async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'CONFIRMED' },
      { new: true, runValidators: true }
    );
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    res.status(200).json({ message: 'Booking confirmed', booking });
  } catch (error) {
    next(error);
  }
});

// ✅ CANCEL BOOKING
router.put('/:id/cancel', async (req, res, next) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'CANCELLED' },
      { new: true, runValidators: true }
    );
    if (!booking) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    // Release car availability
    await syncCarOrOutbox(booking.carId, booking._id.toString(), 'AVAILABLE');

    res.status(200).json({ message: 'Booking cancelled', booking });
    inc('booking.cancel.success');
  } catch (error) {
    next(error);
  }
});

// ✅ DELETE BOOKING
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Booking.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    res.status(200).json({ message: 'Booking deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Serve uploaded images
router.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Outbox Processor (call via cron) ──────────────────────
router.post('/process-outbox', async (req, res, next) => {
  try {
    const pending = await BookingOutbox.find({ status: 'PENDING' })
      .sort({ createdAt: 1 }).limit(20);
    const results = { processed: 0, succeeded: 0, failed: 0 };

    for (const entry of pending) {
      results.processed++;
      try {
        await patchCarAvailability(entry.carId, entry.action,
          entry.action === 'AVAILABLE' ? null : entry.bookingId);
        entry.status = 'DONE';
        await entry.save();
        results.succeeded++;
      } catch (err) {
        entry.retryCount += 1;
        entry.lastError = err.message;
        if (entry.retryCount >= 5) entry.status = 'FAILED';
        await entry.save();
        results.failed++;
      }
    }

    res.status(200).json({ message: `Outbox processed`, ...results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
