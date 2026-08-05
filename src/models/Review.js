const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['doctor', 'pharmacy', 'lab'], required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, maxlength: 1000 },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    order: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

reviewSchema.index({ patient: 1, target: 1 }, { unique: true });
reviewSchema.index({ target: 1 });

module.exports = mongoose.model('Review', reviewSchema);
