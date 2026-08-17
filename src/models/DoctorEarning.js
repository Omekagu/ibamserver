const mongoose = require('mongoose');

const doctorEarningSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    consultation: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
    grossAmount: { type: Number, required: true },
    platformCut: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    payoutStatus: {
      type: String,
      enum: ['pending', 'requested', 'paid'],
      default: 'pending',
    },
    payoutRequestedAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

doctorEarningSchema.index({ doctor: 1, payoutStatus: 1 });
doctorEarningSchema.index({ consultation: 1 }, { unique: true });

module.exports = mongoose.model('DoctorEarning', doctorEarningSchema);
