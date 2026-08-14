const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    reference: { type: String, required: true, unique: true },
    paystackRef: { type: String },
    type: {
      type: String,
      enum: ['consultation', 'pharmacy', 'lab_test', 'subscription', 'wellness_package'],
      required: true,
    },
    method: {
      type: String,
      enum: ['paystack', 'direct_transfer', 'walk_in_cash'],
      default: 'paystack',
    },
    serviceRef: { type: mongoose.Schema.Types.ObjectId },
    serviceModel: { type: String },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'refunded'],
      default: 'pending',
    },
    transferReference: { type: String },
    adminNotes:        { type: String },
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
