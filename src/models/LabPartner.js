const mongoose = require('mongoose');

const testSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    turnaroundHours: { type: Number, default: 24 },
  },
  { _id: false }
);

const labPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    phone: { type: String, required: true },
    email: { type: String },
    testsOffered: [testSchema],
    coverageAreas: [{ type: String }],
    licenseNumber: { type: String },
    status: { type: String, enum: ['pending', 'active', 'inactive', 'suspended'], default: 'pending' },
    cacNumber: { type: String },
    cacVerified: { type: Boolean, default: false },
    cacRegisteredName: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    bankAccount: {
      bankName:      { type: String },
      accountNumber: { type: String },
      accountName:   { type: String },
      bankCode:      { type: String },
      verified:      { type: Boolean, default: false },
      verifiedAt:    { type: Date },
    },
  },
  { timestamps: true }
);

labPartnerSchema.index(
  { 'bankAccount.accountNumber': 1, 'bankAccount.bankCode': 1 },
  { unique: true, sparse: true, partialFilterExpression: { 'bankAccount.verified': true } }
);

module.exports = mongoose.model('LabPartner', labPartnerSchema);
