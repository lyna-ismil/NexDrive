const mongoose = require('mongoose');

const CarSchema = new mongoose.Schema({
  matricule:  { type: String, required: true, unique: true, trim: true },
  marque:     { type: String, required: true, trim: true },
  location:   { type: String, required: true, trim: true },
  visite_technique: { type: Date, required: true },
  date_assurance:   { type: Date, required: true },
  vignette:         { type: Date, required: true },

  // Health snapshot (updated by Telemetry service)
  healthStatus: {
    type: String,
    enum: ['OK', 'WARN', 'CRITICAL'],
    default: 'OK',
    index: true
  },
  lastHealthUpdate: { type: Date },
  lastKnownLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },
  lastKnownOdometer: { type: Number },

  // Availability snapshot (updated by Booking service via S2S)
  availability: {
    status: {
      type: String,
      enum: ['AVAILABLE', 'RESERVED', 'IN_USE'],
      default: 'AVAILABLE',
      index: true
    },
    bookingId: { type: String, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.models.Car || mongoose.model('Car', CarSchema);
