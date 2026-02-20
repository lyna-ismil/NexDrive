const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const DeviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4(),
    index: true
  },
  serialNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  carId: {
    type: String,
    index: true,
    sparse: true,
    default: null
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'BLOCKED', 'RETIRED'],
    default: 'ACTIVE',
    index: true
  },
  firmwareVersion: {
    type: String,
    trim: true,
    default: null
  },
  lastSeenAt: {
    type: Date,
    default: null
  },
  auth: {
    sharedSecretHash: { type: String, select: false }
  }
}, { timestamps: true });

// Never return sharedSecretHash by default
DeviceSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  if (obj.auth) delete obj.auth.sharedSecretHash;
  return obj;
};

module.exports = mongoose.model('Device', DeviceSchema);
