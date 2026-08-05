const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  { name: String, price: Number, qty: { type: Number, default: 1 } },
  { _id: false }
);

const pharmacyOrderSchema = new mongoose.Schema(
  {
    orderType: { type: String, enum: ['prescription', 'direct'], default: 'prescription' },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },
    items: [orderItemSchema],
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: 'PharmacyPartner', required: true },
    fulfillmentType: { type: String, enum: ['delivery', 'pickup'], required: true },
    deliveryAddress: { type: String },
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'dispatched', 'delivered', 'cancelled'],
      default: 'pending',
    },
    totalAmount: { type: Number, default: 0 },
    externalPrescriptionUrl: { type: String },
    requiresApproval: { type: Boolean, default: false },
    adminApprovalStatus: {
      type: String,
      enum: ['na', 'pending', 'approved', 'rejected'],
      default: 'na',
    },
    paymentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    notes: { type: String },
    pickupLocation: {
      address: { type: String },
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PharmacyOrder', pharmacyOrderSchema);
