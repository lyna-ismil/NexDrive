const mongoose = require('mongoose');

const TelemetryEventSchema = new mongoose.Schema({
  carId:    { type: String, required: true, index: true },
  deviceId: { type: String, required: true, index: true },
  eventType: {
    type: String,
    required: true,
    enum: ['ENGINE_STATUS', 'GPS_LOCATION', 'SPEED', 'FUEL_LEVEL', 'BATTERY', 'OBD_DIAGNOSTIC', 'ALERT', 'HEARTBEAT'],
    index: true
  },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// TTL index — auto-delete events older than 90 days
TelemetryEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Compound index for common queries
TelemetryEventSchema.index({ carId: 1, eventType: 1, timestamp: -1 });

module.exports = mongoose.model('TelemetryEvent', TelemetryEventSchema);
