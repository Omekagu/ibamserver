const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  { name: String, price: Number, qty: { type: Number, default: 1 } },
  { _id: false }
);

const testItemSchema = new mongoose.Schema(
  { name: String, price: Number },
  { _id: false }
);

const productSubscriptionSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['drug', 'test'], required: true },

    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmacyPartner' },
    drugItems: [itemSchema],
    fulfillmentType: { type: String, enum: ['delivery', 'pickup'] },
    deliveryAddress: { type: String },

    lab: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPartner' },
    testItems: [testItemSchema],
    collectionType: { type: String, enum: ['home_visit', 'walk_in'] },

    frequency: { type: String, enum: ['weekly', 'biweekly', 'monthly'], required: true },
    nextDue: { type: Date },
    status: { type: String, enum: ['active', 'paused', 'cancelled'], default: 'active' },
    totalAmount: { type: Number, default: 0 },
    notes: { type: String },
  },
  { timestamps: true }
);

productSubscriptionSchema.index({ patient: 1, status: 1 });

module.exports = mongoose.model('ProductSubscription', productSubscriptionSchema);
