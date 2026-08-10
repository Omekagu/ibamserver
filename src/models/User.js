const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    role: {
      type: String,
      enum: ['patient', 'doctor', 'admin', 'lab_partner', 'pharmacy_partner', 'field_agent'],
      default: 'patient',
    },
    password: { type: String, required: true, select: false, minlength: 8 },
    avatar: { type: String },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    nin: { type: String, select: false },
    ninVerified: { type: Boolean, default: false },
    kycStatus: {
      type: String,
      enum: ['pending', 'nin_verified', 'face_verified', 'approved', 'rejected'],
      default: 'pending',
    },
    googleId: { type: String, sparse: true },
    refreshToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    expoPushToken: { type: String, default: null },
    loginAttemptCount: { type: Number, default: 0, select: false },
    loginLockedUntil:  { type: Date,   default: null, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
