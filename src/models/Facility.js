const mongoose = require('mongoose');

const facilitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['hospital', 'clinic', 'pharmacy', 'lab', 'emergency'],
      required: true,
    },
    address: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    phone: { type: String },
    email: { type: String },
    website: { type: String },
    operatingHours: { type: String },
    services: [{ type: String }],
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

facilitySchema.index({ location: '2dsphere' });
facilitySchema.index({ type: 1 });

module.exports = mongoose.model('Facility', facilitySchema);
