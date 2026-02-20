const mongoose = require('mongoose');

const BookingOutboxSchema = new mongoose.Schema({
  carId:     { type: String, required: true },
  bookingId: { type: String, required: true },
  action:    { type: String, enum: ['RESERVED', 'AVAILABLE', 'IN_USE'], required: true },
  status:    { type: String, enum: ['PENDING', 'DONE', 'FAILED'], default: 'PENDING', index: true },
  retryCount: { type: Number, default: 0 },
  lastError:  { type: String }
}, { timestamps: true });

BookingOutboxSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('BookingOutbox', BookingOutboxSchema);
