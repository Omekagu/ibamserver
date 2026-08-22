const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduledAt: { type: Date, required: true },
    type: { type: String, enum: ['video', 'audio', 'chat'], required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
    },
    triageRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Triage' },
    consultationFee: { type: Number, default: 0 },
    paymentRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    cancellationReason: { type: String },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isFollowUp: { type: Boolean, default: false },
    followUpRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    notes: { type: String },
    isUrgent: { type: Boolean, default: false },
    sessionDurationMinutes: { type: Number, default: 30 },
    // Doctor-initiated reschedule tracking
    rescheduleReason: { type: String },
    rescheduledAt:    { type: Date },
    rescheduleCount:  { type: Number, default: 0 },
  },
  { timestamps: true }
);

appointmentSchema.index({ patient: 1, scheduledAt: -1 });
appointmentSchema.index({ doctor: 1, scheduledAt: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
