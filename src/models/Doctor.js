const mongoose = require('mongoose');

const qualificationSchema = new mongoose.Schema(
  {
    degree: { type: String, required: true },
    institution: { type: String, required: true },
    year: { type: Number, required: true },
  },
  { _id: false }
);

const doctorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    specialization: { type: String, required: true },
    licenseNumber: { type: String, required: true, unique: true },
    licenseDocument: { type: String },
    employmentType: { type: String, enum: ['freelancer', 'employed'], default: 'freelancer' },
    bio: { type: String },
    consultationFee: { type: Number, default: 0 },
    yearsOfExperience: { type: Number, default: 0 },
    qualifications: [qualificationSchema],
    isAvailable: { type: Boolean, default: false },
    isApproved:  { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    kycStatus: {
      type: String,
      enum: ['pending', 'nin_verified', 'face_verified', 'approved', 'rejected'],
      default: 'pending',
    },
    ninVerified: { type: Boolean, default: false },
    faceMatchVerified: { type: Boolean, default: false },
    faceMatchScore: { type: Number },
    ratings: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    rateType: { type: String, enum: ['per_session', 'per_hour', 'per_minute'], default: 'per_session' },
    sessionDurationMinutes: { type: Number, default: 30, min: 15, max: 120 },
    urgentAvailable: { type: Boolean, default: false },
    urgentSurcharge: { type: Number, default: 0 },
    fees: {
      video: { type: Number },
      audio: { type: Number },
      chat:  { type: Number },
    },
    bankAccount: {
      bankName:      { type: String },
      accountNumber: { type: String },
      accountName:   { type: String },
      bankCode:      { type: String },
      verified:      { type: Boolean, default: false },
      verifiedAt:    { type: Date },
    },
    displayName: { type: String },
    socialLinks: {
      twitter:  { type: String },
      linkedin: { type: String },
      website:  { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Doctor', doctorSchema);
