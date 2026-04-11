const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, min: 0 },
  currency: { type: String, default: 'TND', trim: true },
  status: {
    type: String,
    enum: ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'],
    default: 'UNPAID'
  }
}, { _id: false });

const BookingSchema = new mongoose.Schema({
  userId:    { type: String, required: true, index: true },
  carId:     { type: String, required: true, index: true },
  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
    default: 'PENDING',
    index: true
  },
  pickupLocation:  { type: String, trim: true },
  dropoffLocation: { type: String, trim: true },
  payment:     { type: paymentSchema, default: () => ({}) },
  contractUrl: { type: String, trim: true },
  image:       { type: String, trim: true },
  current_Key_car: { type: String, default: null },
  keyExpiresAt:    { type: Date, default: null }
}, { timestamps: true });

// Validate endDate > startDate
BookingSchema.pre('validate', function (next) {
  if (this.endDate && this.startDate && this.endDate <= this.startDate) {
    this.invalidate('endDate', 'endDate must be after startDate');
  }
  next();
});

// Compound indexes for common queries
BookingSchema.index({ carId: 1, status: 1 });
BookingSchema.index({ userId: 1, createdAt: -1 });
BookingSchema.index({ carId: 1, startDate: 1, endDate: 1, status: 1 }); // overlap check

module.exports = mongoose.model('Booking', BookingSchema);
