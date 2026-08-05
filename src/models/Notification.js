const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'appointment_booked', 'appointment_booked_patient', 'appointment_confirmed', 'appointment_cancelled',
        'appointment_reminder', 'consultation_started', 'consultation_ended',
        'prescription_ready', 'pharmacy_order_update', 'lab_result_ready',
        'home_visit_scheduled', 'sample_collected', 'payment_success',
        'subscription_activated', 'subscription_cancelled', 'payout_processed',
        'doctor_approved', 'partner_approved', 'drug_approval',
        'order_approval', 'test_request_approval',
        'follow_up_scheduled', 'general',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
