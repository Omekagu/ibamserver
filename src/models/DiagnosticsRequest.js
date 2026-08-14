const mongoose = require('mongoose');

const diagnosticsRequestSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tests: [{ type: String, required: true }],
    lab: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPartner' },
    collectionType: { type: String, enum: ['home_visit', 'walk_in'], required: true },
    fieldAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldAgent' },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'sample_collected', 'processing', 'completed', 'cancelled'],
      default: 'pending',
    },
    totalAmount: { type: Number, default: 0 },
    externalReferralUrl: { type: String },
    requiresApproval: { type: Boolean, default: false },
    adminApprovalStatus: {
      type: String,
      enum: ['na', 'pending', 'approved', 'rejected'],
      default: 'na',
    },
    wellnessPackage: { type: mongoose.Schema.Types.ObjectId, ref: 'WellnessPackage' },
    paymentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    notes: { type: String },
    resultNotes: { type: String },
    pickupLocation: {
      address: { type: String },
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { timestamps: true }
);

diagnosticsRequestSchema.index({ patient: 1, createdAt: -1 });

module.exports = mongoose.model('DiagnosticsRequest', diagnosticsRequestSchema);
