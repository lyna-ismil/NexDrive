const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  type: {
    type: String,
    required: true,
    enum: ['BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'PAYMENT_RECEIVED', 'MAINTENANCE_DUE',
           'DEVICE_ALERT', 'RECLAMATION_UPDATE', 'SYSTEM', 'PROMOTIONAL'],
    index: true
  },
  title:   { type: String, required: true, trim: true },
  body:    { type: String, required: true, trim: true },
  channel: {
    type: String,
    enum: ['IN_APP', 'EMAIL', 'SMS', 'PUSH'],
    default: 'IN_APP'
  },
  template: { type: String, trim: true },
  status: {
    type: String,
    enum: ['QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED'],
    default: 'QUEUED',
    index: true
  },
  scheduledAt:   { type: Date },
  processingAt:  { type: Date },
  sentAt:      { type: Date },
  readAt:      { type: Date },
  retryCount:  { type: Number, default: 0 },
  idempotencyKey: { type: String, unique: true, sparse: true },
  providerMessageId: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, status: 1 });
NotificationSchema.index({ status: 1, scheduledAt: 1 }); // For queue processing

module.exports = mongoose.model('Notification', NotificationSchema);
