const mongoose = require('mongoose');

const drugSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    unit: { type: String, default: 'pack' },
    requiresPrescription: { type: Boolean, default: false },
    inStock: { type: Boolean, default: true },
    adminApproved: { type: Boolean, default: true },
  },
  { _id: true }
);

const pharmacyPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    phone: { type: String, required: true },
    email: { type: String },
    coverageAreas: [{ type: String }],
    operatingHours: {
      open: { type: String },
      close: { type: String },
      days: [{ type: String }],
    },
    licenseNumber: { type: String },
    drugsOffered: [drugSchema],
    status: { type: String, enum: ['pending', 'active', 'inactive', 'suspended'], default: 'pending' },
    cacNumber: { type: String },
    cacVerified: { type: Boolean, default: false },
    cacRegisteredName: { type: String },
    logo: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    bankAccount: {
      bankName:      { type: String },
      accountNumber: { type: String },
      accountName:   { type: String },
      bankCode:      { type: String },
      verified:      { type: Boolean, default: false },
      verifiedAt:    { type: Date },
    },
    subaccountCode: { type: String, default: null },
  },
  { timestamps: true }
);

// Prevent two verified partners sharing the same account number + bank code
pharmacyPartnerSchema.index(
  { 'bankAccount.accountNumber': 1, 'bankAccount.bankCode': 1 },
  { unique: true, sparse: true, partialFilterExpression: { 'bankAccount.verified': true } }
);

module.exports = mongoose.model('PharmacyPartner', pharmacyPartnerSchema);
