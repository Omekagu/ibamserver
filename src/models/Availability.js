const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema(
  {
    startTime: { type: String, required: true }, // "09:00"
    endTime: { type: String, required: true },   // "09:30"
    isBooked: { type: Boolean, default: false },
  },
  { _id: true }
);

const availabilitySchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['recurring', 'one_off'], required: true },
    dayOfWeek: { type: Number, min: 0, max: 6 }, // 0 = Sunday — recurring only
    date: { type: Date },                          // one_off only
    slots: [slotSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

availabilitySchema.index({ doctor: 1, dayOfWeek: 1 });
availabilitySchema.index({ doctor: 1, date: 1 });

module.exports = mongoose.model('Availability', availabilitySchema);
