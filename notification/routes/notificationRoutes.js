const express = require('express');
const Joi = require('joi');
const Notification = require('../models/notification');
const { validate } = require('../../shared/validate');
const { sendError } = require('../../shared/errorHandler');
const { verifyGatewayOrigin, attachGatewayIdentity, requireRole } = require('../../shared/authMiddleware');

const router = express.Router();

// ── Provider Interface ─────────────────────────────────────
// MVP: console provider — real providers (SendGrid, Twilio, FCM)
// can be plugged in by implementing the same interface.

const providers = {
  EMAIL: {
    send: async (recipient, title, body, data, idempotencyKey) => {
      console.log(`📧 [EMAIL] To: ${recipient} | Subject: ${title} | Body: ${body} | Key: ${idempotencyKey || 'none'}`);
      return { success: true, provider: 'console-email', providerMessageId: `email-${Date.now()}` };
    }
  },
  SMS: {
    send: async (recipient, title, body, data, idempotencyKey) => {
      console.log(`📱 [SMS] To: ${recipient} | ${body} | Key: ${idempotencyKey || 'none'}`);
      return { success: true, provider: 'console-sms', providerMessageId: `sms-${Date.now()}` };
    }
  },
  PUSH: {
    send: async (recipient, title, body, data, idempotencyKey) => {
      console.log(`🔔 [PUSH] To: ${recipient} | Title: ${title} | Body: ${body} | Key: ${idempotencyKey || 'none'}`);
      return { success: true, provider: 'console-push', providerMessageId: `push-${Date.now()}` };
    }
  },
  IN_APP: {
    send: async (recipient, title, body, data, idempotencyKey) => {
      // In-app notifications are stored in DB only — no external delivery
      return { success: true, provider: 'in-app', providerMessageId: `inapp-${Date.now()}` };
    }
  }
};

// --- Validation Schemas ---
const sendNotificationSchema = Joi.object({
  userId:   Joi.string().hex().length(24).required(),
  type:     Joi.string().valid(
    'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'PAYMENT_RECEIVED', 'MAINTENANCE_DUE',
    'DEVICE_ALERT', 'RECLAMATION_UPDATE', 'SYSTEM', 'PROMOTIONAL'
  ).required(),
  title:    Joi.string().required(),
  body:     Joi.string().required(),
  channel:  Joi.string().valid('IN_APP', 'EMAIL', 'SMS', 'PUSH').optional(),
  template: Joi.string().optional().allow(''),
  scheduledAt: Joi.date().iso().optional(),
  metadata: Joi.object().optional()
});

const processSchema = Joi.object({
  batchSize: Joi.number().integer().min(1).max(100).default(20)
});

// ────────────────────────────────────────────────────────────
// POST /notifications/send — Queue a notification
// Supports X-Idempotency-Key header to prevent duplicates.
// ────────────────────────────────────────────────────────────
router.post('/send',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(sendNotificationSchema),
  async (req, res, next) => {
    try {
      // Idempotency check
      const idempotencyKey = req.headers['x-idempotency-key'];
      if (idempotencyKey) {
        const existing = await Notification.findOne({ idempotencyKey });
        if (existing) {
          return res.status(409).json({
            error: { code: 'DUPLICATE_NOTIFICATION', message: 'Notification with this idempotency key already exists' },
            notification: existing
          });
        }
      }

      const notification = new Notification({
        ...req.body,
        status: req.body.scheduledAt ? 'QUEUED' : 'QUEUED',
        ...(idempotencyKey && { idempotencyKey })
      });

      await notification.save();
      res.status(201).json({ message: 'Notification queued', notification });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// POST /notifications/process — Process queued notifications
// Uses atomic findOneAndUpdate to claim jobs (prevents duplicates).
// Failed jobs are re-queued with exponential backoff.
// ────────────────────────────────────────────────────────────
router.post('/process',
  verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'),
  validate(processSchema),
  async (req, res, next) => {
    try {
      const batchSize = req.body.batchSize || 20;
      const results = { processed: 0, sent: 0, failed: 0 };
      const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 hour cap

      for (let i = 0; i < batchSize; i++) {
        // Atomic claim: QUEUED → PROCESSING (prevents race conditions)
        const job = await Notification.findOneAndUpdate(
          {
            status: 'QUEUED',
            $or: [
              { scheduledAt: { $exists: false } },
              { scheduledAt: null },
              { scheduledAt: { $lte: new Date() } }
            ]
          },
          { $set: { status: 'PROCESSING', processingAt: new Date() } },
          { sort: { createdAt: 1 }, new: true }
        );

        if (!job) break; // No more jobs

        results.processed++;
        try {
          const channel = job.channel || 'IN_APP';
          const provider = providers[channel];

          if (!provider) {
            job.status = 'FAILED';
            job.retryCount = (job.retryCount || 0) + 1;
            await job.save();
            results.failed++;
            continue;
          }

          const result = await provider.send(
            job.userId,
            job.title,
            job.body,
            job.metadata,
            job.idempotencyKey
          );

          if (result.success) {
            job.status = 'SENT';
            job.sentAt = new Date();
            if (result.providerMessageId) job.providerMessageId = result.providerMessageId;
            await job.save();
            results.sent++;
          } else {
            throw new Error('Provider returned failure');
          }
        } catch (err) {
          // Exponential backoff: re-queue with delay
          job.retryCount = (job.retryCount || 0) + 1;
          const delayMs = Math.min(MAX_BACKOFF_MS, Math.pow(2, job.retryCount) * 1000);
          job.scheduledAt = new Date(Date.now() + delayMs);
          job.status = 'QUEUED'; // re-queue with backoff
          await job.save();
          results.failed++;
        }
      }

      res.status(200).json({
        message: `Processed ${results.processed} notifications`,
        ...results
      });
    } catch (error) {
      next(error);
    }
  }
);

// ────────────────────────────────────────────────────────────
// GET /notifications/user/:userId — Get notifications (paginated)
// ────────────────────────────────────────────────────────────
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = { userId: req.params.userId };
    if (status) filter.status = status;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);
    const unread = await Notification.countDocuments({ userId: req.params.userId, status: { $nin: ['READ'] } });

    res.status(200).json({ notifications, total, unread, limit: parseInt(limit), skip: parseInt(skip) });
  } catch (error) {
    next(error);
  }
});

// ────────────────────────────────────────────────────────────
// GET /notifications/recent — Get recent global notifications enriched with user
// ────────────────────────────────────────────────────────────
const axios = require('axios');
const USER_SERVICE_URL = process.env.USER_SERVICE || 'http://localhost:6001';

const fetchUserInfo = async (userId) => {
  try {
    const resp = await axios.get(`${USER_SERVICE_URL}/users/${userId}`, { timeout: 4000 });
    return resp.data;
  } catch { return null; }
};

router.get('/recent', verifyGatewayOrigin, attachGatewayIdentity, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const notifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const enriched = await Promise.all(notifications.map(async (n) => {
      let userName = 'Unknown User';
      let userEmail = '';
      if (n.userId) {
        const user = await fetchUserInfo(n.userId);
        if (user) {
          userName = user.fullName || user.firstName + ' ' + user.lastName;
          userEmail = user.email || '';
        }
      }
      return { ...n, user: { name: userName, email: userEmail } };
    }));

    res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
});

// ────────────────────────────────────────────────────────────
// PATCH /notifications/:id/read — Mark as read
// ────────────────────────────────────────────────────────────
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { status: 'READ', readAt: new Date() },
      { new: true }
    );
    if (!notification) return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    res.status(200).json(notification);
  } catch (error) {
    next(error);
  }
});

// ────────────────────────────────────────────────────────────
// PATCH /notifications/user/:userId/read-all — Mark all as read
// ────────────────────────────────────────────────────────────
router.patch('/user/:userId/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.params.userId, status: { $ne: 'READ' } },
      { status: 'READ', readAt: new Date() }
    );
    res.status(200).json({ message: `${result.modifiedCount} notifications marked as read` });
  } catch (error) {
    next(error);
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /notifications/:id
// ────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await Notification.findByIdAndDelete(req.params.id);
    if (!deleted) return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    res.status(200).json({ message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
