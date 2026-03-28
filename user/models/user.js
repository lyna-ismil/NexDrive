const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  phone:    { type: String, required: true, trim: true },
  cinImageUrl:     { type: String, required: true, trim: true },
  licenseImageUrl: { type: String, required: true, trim: true },
  profilePhoto:    { type: String, trim: true, default: null },
  facture:            { type: Number, default: 0 },
  nbr_fois_allocation: { type: Number, default: 0 },
  blacklist: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['ACTIVE', 'SUSPENDED'],
    default: 'ACTIVE',
    index: true
  },
  notes: [{
    text: String,
    createdBy: String, // admin email or ID
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare entered password with hashed password
UserSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
