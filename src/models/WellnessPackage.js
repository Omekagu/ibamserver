const mongoose = require('mongoose');

const WellnessPackageSchema = new mongoose.Schema({
  name:           { type: String, required: true, unique: true, trim: true },
  slug:           { type: String, required: true, unique: true, trim: true },
  targetAudience: { type: String },
  benefits:       { type: String },
  includedTests:  [{ type: String }],
  walkInPrice:    { type: Number, required: true },
  homeVisitPrice: { type: Number, required: true },
  gender:         { type: String, enum: ['male', 'female', 'all'], default: 'all' },
  isActive:       { type: Boolean, default: true },
  order:          { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('WellnessPackage', WellnessPackageSchema);
