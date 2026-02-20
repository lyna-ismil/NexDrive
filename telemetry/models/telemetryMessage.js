const mongoose = require('mongoose');

const gpsSchema = new mongoose.Schema({
  lat: { type: Number },
  lng: { type: Number }
}, { _id: false });

const payloadSchema = new mongoose.Schema({
  speed:          { type: Number },
  rpm:            { type: Number },
  fuelLevel:      { type: Number },
  dtcCodes:       [{ type: String }],
  gps:            { type: gpsSchema },
  engineRunning:  { type: Boolean },
  odometer:       { type: Number },
  batteryVoltage: { type: Number },
  coolantTemp:    { type: Number }
}, { _id: false, strict: false }); // strict:false allows extra fields

const TelemetryMessageSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  carId:    { type: String, required: true, index: true },
  ts:       { type: Date,   required: true, index: true },
  payload:  { type: payloadSchema, required: true }
}, { timestamps: true });

// Compound indexes for the two primary query patterns
TelemetryMessageSchema.index({ carId: 1, ts: -1 });
TelemetryMessageSchema.index({ deviceId: 1, ts: -1 });

module.exports = mongoose.model('TelemetryMessage', TelemetryMessageSchema);
