const mongoose = require('mongoose');

const LabTestSchema = new mongoose.Schema({
  name:            { type: String, required: true, unique: true, trim: true },
  category:        { type: String, trim: true },
  description:     { type: String },
  walkInPrice:     { type: Number },      // price for walk-in at lab
  homeVisitPrice:  { type: Number },      // price for home sample collection
  estimatedPrice:  { type: Number },      // kept for backward compat (= walkInPrice fallback)
  turnaroundHours: { type: Number, default: 24 },
  isActive:        { type: Boolean, default: true },
  order:           { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('LabTest', LabTestSchema);
