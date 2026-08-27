const mongoose = require('mongoose');

const partnerEarningSchema = new mongoose.Schema(
  {
    partner:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    partnerType: { type: String, enum: ['pharmacy', 'lab', 'doctor'], required: true },
    partnerName: { type: String },
    serviceRef:  { type: mongoose.Schema.Types.ObjectId },
    grossAmount: { type: Number, required: true },
    platformCut: { type: Number, required: true },
    netAmount:   { type: Number, required: true },
    payoutStatus: {
      type: String,
      enum: ['pending', 'requested', 'paid', 'split'],
      default: 'pending',
    },
    payoutRequestedAt: { type: Date },
    paidAt:            { type: Date },
  },
  { timestamps: true }
);

partnerEarningSchema.index({ partner: 1, payoutStatus: 1 });
partnerEarningSchema.index({ partnerType: 1, payoutStatus: 1 });

module.exports = mongoose.model('PartnerEarning', partnerEarningSchema);
