const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        // Appointments
        'appointment_booked', 'appointment_booked_patient', 'appointment_confirmed',
        'appointment_cancelled', 'appointment_reminder', 'follow_up_scheduled',
        // Consultations
        'consultation_started', 'consultation_ended',
        // Prescriptions & medications
        'prescription_ready', 'pharmacy_order_placed', 'pharmacy_order_update',
        'order_approval', 'drug_approval',
        // Lab / diagnostics
        'lab_request_placed', 'lab_result_ready', 'test_request_approval',
        'home_visit_scheduled', 'sample_collected',
        // Payments & subscriptions
        'payment_success', 'payout_processed', 'payout_requested',
        'subscription_activated', 'subscription_cancelled',
        // Account / KYC / approvals
        'new_registration', 'kyc_submitted', 'partner_onboarded',
        'doctor_approved', 'doctor_rejected',
        'partner_approved', 'partner_rejected',
        // Misc
        'general',
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
