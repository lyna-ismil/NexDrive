const mongoose = require('mongoose');

/**
 * Materialized view: latest telemetry snapshot per car.
 * Upserted on every ingest — provides O(1) reads for GET /cars/:carId/latest.
 */
const CarTelemetryLatestSchema = new mongoose.Schema({
  carId:    { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, required: true, index: true },
  ts:       { type: Date, required: true, index: true },
  payload:  { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

module.exports = mongoose.model('CarTelemetryLatest', CarTelemetryLatestSchema);
