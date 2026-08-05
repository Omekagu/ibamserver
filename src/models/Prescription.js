const mongoose = require('mongoose');

const medicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    dosage: { type: String, required: true },
    frequency: { type: String, required: true },
    duration: { type: String, required: true },
    instructions: { type: String },
    quantity: { type: Number },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    consultation: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },
    medications: { type: [medicationSchema], required: true },
    diagnosis: { type: String },
    instructions: { type: String },
    status: {
      type: String,
      enum: ['active', 'fulfilled', 'expired', 'cancelled'],
      default: 'active',
    },
    forwardedToPharmacy: { type: Boolean, default: false },
  },
  { timestamps: true }
);

prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ consultation: 1 });

module.exports = mongoose.model('Prescription', prescriptionSchema);
