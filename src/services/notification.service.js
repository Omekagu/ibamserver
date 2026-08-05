const Notification = require('../models/Notification');
const User = require('../models/User');
const { getIO } = require('../config/socket');
const { sendPushNotifications } = require('./push.service');
const {
  sendAppointmentBookedEmail,
  sendAppointmentBookedPatientEmail,
  sendAppointmentConfirmedEmail,
  sendAppointmentCancelledEmail,
  sendFollowUpEmail,
  sendConsultationStartedEmail,
  sendConsultationSummaryEmail,
  sendPrescriptionReadyEmail,
  sendLabResultReadyEmail,
  sendPharmacyOrderUpdateEmail,
  sendLabRequestConfirmedEmail,
  sendPharmacyOrderConfirmedEmail,
  sendKYCRejectedEmail,
  sendPartnerRejectedEmail,
  sendPaymentSuccessEmail,
  sendSubscriptionEmail,
  sendDoctorApprovedEmail,
  sendPartnerApprovedEmail,
  sendAdminAlertEmail,
  sendOrderApprovalEmail,
  sendTestApprovalEmail,
  sendSampleCollectedEmail,
  sendHomeVisitScheduledEmail,
} = require('./email.service');

const APP_URL = process.env.CLIENT_URL || 'https://ibamhealth.com';

async function dispatchEmail(type, user, d) {
  const { email, name } = user;
  switch (type) {
    case 'appointment_booked':
      await sendAppointmentBookedEmail({
        doctorEmail: email, doctorName: name,
        patientName: d.patientName || 'Patient',
        type: d.appointmentType || 'consultation',
        scheduledAt: d.scheduledAt || new Date(),
      });
      sendAdminAlertEmail({
        subject: 'New appointment booked',
        headline: 'New Appointment',
        body: `${d.patientName || 'A patient'} booked a ${d.appointmentType || 'consultation'} appointment with Dr. ${name}.`,
        ctaLabel: 'View Appointments',
        ctaUrl: `${APP_URL}/admin/appointments`,
      }).catch(() => {});
      break;

    case 'appointment_confirmed':
      await sendAppointmentConfirmedEmail({
        patientEmail: email, patientName: name,
        doctorName: d.doctorName || 'Doctor',
        type: d.appointmentType || 'consultation',
        scheduledAt: d.scheduledAt || new Date(),
      });
      break;

    case 'appointment_booked_patient':
      await sendAppointmentBookedPatientEmail({
        patientEmail: email, patientName: name,
        doctorName: d.doctorName || 'Doctor',
        type: d.appointmentType || 'consultation',
        scheduledAt: d.scheduledAt || new Date(),
      });
      break;

    case 'appointment_cancelled':
      await sendAppointmentCancelledEmail({
        email, name,
        doctorName: d.doctorName || 'Doctor',
        scheduledAt: d.scheduledAt || new Date(),
        reason: d.reason,
      });
      break;

    case 'follow_up_scheduled':
      await sendFollowUpEmail({
        email, name,
        doctorName: d.doctorName || 'Doctor',
        scheduledAt: d.scheduledAt || new Date(),
        type: d.appointmentType,
      });
      break;

    case 'consultation_started':
      await sendConsultationStartedEmail({
        email, name,
        doctorName: d.doctorName || 'Doctor',
        type: d.appointmentType || 'consultation',
      });
      break;

    case 'consultation_ended':
      await sendConsultationSummaryEmail({
        email, name,
        doctorName: d.doctorName || 'Doctor',
        duration: d.duration,
        summary: d.summary,
      });
      break;

    case 'prescription_ready':
      await sendPrescriptionReadyEmail({
        email, name,
        doctorName: d.doctorName || 'Doctor',
        medications: d.medications || [],
      });
      break;

    case 'lab_result_ready':
      await sendLabResultReadyEmail({ email, name, tests: d.tests || [] });
      break;

    case 'pharmacy_order_update':
      await sendPharmacyOrderUpdateEmail({
        email, name,
        status: d.status || 'pending',
        pharmacyName: d.pharmacyName || 'Pharmacy',
        items: d.items || [],
      });
      break;

    case 'payment_success':
      await sendPaymentSuccessEmail({
        email, name,
        amount: d.amount || 0,
        description: d.description || 'iBam Health Service',
      });
      break;

    case 'subscription_activated':
      await sendSubscriptionEmail({ email, name, planName: d.planName || 'iBam Health', status: 'activated' });
      break;

    case 'subscription_cancelled':
      await sendSubscriptionEmail({ email, name, planName: d.planName || 'iBam Health', status: 'cancelled' });
      break;

    case 'doctor_approved':
      await sendDoctorApprovedEmail({ email, name });
      sendAdminAlertEmail({
        subject: 'Doctor account approved',
        headline: 'Doctor Approved',
        body: `Dr. ${name}'s account has been approved and is now active on the platform.`,
        ctaLabel: 'View Doctors',
        ctaUrl: `${APP_URL}/admin/doctors`,
      }).catch(() => {});
      break;

    case 'partner_approved':
      await sendPartnerApprovedEmail({ email, name, partnerType: d.partnerType || 'partner' });
      break;

    case 'doctor_rejected':
      await sendKYCRejectedEmail({ email, name });
      break;

    case 'partner_rejected':
      await sendPartnerRejectedEmail({ email, name, partnerType: d.partnerType || 'Partner' });
      break;

    case 'lab_request_placed':
      await sendLabRequestConfirmedEmail({ email, name, tests: d.tests || [], collectionType: d.collectionType || 'walk_in' });
      break;

    case 'pharmacy_order_placed':
      await sendPharmacyOrderConfirmedEmail({ email, name, pharmacyName: d.pharmacyName || 'Pharmacy', items: d.items || [] });
      break;

    case 'payout_processed':
      await sendPaymentSuccessEmail({
        email, name,
        amount: d.amount || 0,
        description: 'Payout from iBam Health',
      });
      break;

    case 'order_approval':
      await sendOrderApprovalEmail({ email, name, approved: d.approved, note: d.note });
      break;

    case 'test_request_approval':
      await sendTestApprovalEmail({ email, name, approved: d.approved, tests: d.tests || [], note: d.note });
      break;

    case 'sample_collected':
      await sendSampleCollectedEmail({ email, name, tests: d.tests || [] });
      break;

    case 'home_visit_scheduled':
      await sendHomeVisitScheduledEmail({ email, name, scheduledAt: d.scheduledAt || new Date() });
      break;

    case 'drug_approval':
      if (d.approved) {
        await sendPartnerApprovedEmail({ email, name, partnerType: 'Pharmacy (drug listing)' });
      } else {
        await sendPartnerRejectedEmail({ email, name, partnerType: 'Pharmacy (drug listing)' });
      }
      break;

    default:
      break;
  }
}

// emailData — when passed, triggers an email to the notification recipient.
// Omit entirely (undefined) to suppress email for that notification.
const createNotification = async ({ userId, type, title, message, metadata = {}, emailData }) => {
  const notification = await Notification.create({ user: userId, type, title, message, metadata });

  try {
    const io = getIO();
    io.to(`user:${userId}`).emit('notification', notification);
  } catch {
    // Socket not initialised during tests — non-fatal
  }

  // Push notification + optional email (fire-and-forget)
  User.findById(userId).select('email name expoPushToken').lean()
    .then(user => {
      if (!user) return;
      if (user.expoPushToken) {
        sendPushNotifications({ tokens: [user.expoPushToken], title, body: message, data: { type, ...metadata } })
          .catch(err => console.error('[Push notification]', err.message));
      }
      if (emailData !== undefined && user.email) {
        return dispatchEmail(type, user, emailData);
      }
    })
    .catch(err => console.error('[Notification]', err.message));

  return notification;
};

// Broadcast an in-app notification to every active admin user.
// Fire-and-forget safe — errors are logged but never thrown.
const notifyAdmins = async ({ type, title, message, metadata = {} }) => {
  try {
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    if (!admins.length) return;
    await Promise.allSettled(
      admins.map(admin => createNotification({ userId: admin._id, type, title, message, metadata }))
    );
  } catch (err) {
    console.error('[notifyAdmins]', err.message);
  }
};

const markAsRead = async (notificationId, userId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true },
    { new: true }
  );
};

const markAllAsRead = async (userId) => {
  return Notification.updateMany({ user: userId, isRead: false }, { isRead: true });
};

module.exports = { createNotification, notifyAdmins, markAsRead, markAllAsRead };
