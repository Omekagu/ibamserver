const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const payoutRequestSchema = new mongoose.Schema(
  {
    partner:     { type: ObjectId, ref: 'User', required: true },
    partnerType: { type: String, enum: ['pharmacy', 'lab'], required: true },
    partnerName: { type: String },
    earningIds:  [{ type: ObjectId, ref: 'PartnerEarning' }],
    totalGross:  { type: Number, required: true },
    totalNet:    { type: Number, required: true },
    bankAccount: {
      bankName:      { type: String },
      accountNumber: { type: String },
      accountName:   { type: String },
      bankCode:      { type: String },
    },
    status:      { type: String, enum: ['requested', 'paid', 'failed'], default: 'requested' },
    processedAt: { type: Date },
    requestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PayoutRequest', payoutRequestSchema);
