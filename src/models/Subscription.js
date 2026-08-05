const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired', 'paused'],
      default: 'active',
    },
    startDate: { type: Date, default: Date.now },
    nextBillingDate: { type: Date },
    paystackSubscriptionCode: { type: String },
    paystackEmailToken: { type: String },
  },
  { timestamps: true }
);

subscriptionSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
