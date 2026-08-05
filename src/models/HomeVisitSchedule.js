const mongoose = require('mongoose');

const homeVisitSchema = new mongoose.Schema(
  {
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'DiagnosticsRequest', required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldAgent', required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: String, required: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'en_route', 'arrived', 'collected', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HomeVisitSchedule', homeVisitSchema);
