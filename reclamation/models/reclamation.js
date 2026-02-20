const mongoose = require('mongoose');

const ReclamationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  message: { type: String, required: true, trim: true },
  image:   { type: String, trim: true },
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
    default: 'OPEN',
    index: true
  },
  assignedAdminId: { type: String, index: true },
  bookingId:       { type: String, index: true }
}, { timestamps: true });

module.exports = mongoose.models.Reclamation || mongoose.model('Reclamation', ReclamationSchema);
