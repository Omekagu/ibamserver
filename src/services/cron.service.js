const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const ReminderLog = require('../models/ReminderLog');
const { sendAppointmentReminderEmail } = require('./email.service');
const { createNotification, notifyAdmins } = require('./notification.service');

async function sendReminders() {
  const now = new Date();

  // "Starting now" window: appointments 0–16 min from now
  const winNowStart = now;
  const winNowEnd   = new Date(now.getTime() + 16 * 60_000);

  // 1-hour window: appointments 50–70 min from now
  const win1Start   = new Date(now.getTime() + 50 * 60_000);
  const win1End     = new Date(now.getTime() + 70 * 60_000);

  // 24-hour window: appointments 23h50m–24h10m from now
  const win24Start  = new Date(now.getTime() + 23 * 3600_000 + 50 * 60_000);
  const win24End    = new Date(now.getTime() + 24 * 3600_000 + 10 * 60_000);

  const upcoming = await Appointment.find({
    status: { $in: ['pending', 'confirmed'] },
    scheduledAt: { $gte: winNowStart, $lte: win24End },
  })
    .populate('patient', 'name email expoPushToken')
    .populate('doctor', 'name')
    .lean();

  for (const appt of upcoming) {
    const at = new Date(appt.scheduledAt);
    const patient     = appt.patient;
    const doctorName  = appt.doctor?.name ?? 'Your doctor';
    const patientName = patient?.name ?? 'Patient';

    // "Starting now" reminder
    if (at >= winNowStart && at <= winNowEnd) {
      const inserted = await insertReminderLog(appt._id, 'now');
      if (inserted !== false && patient?._id) {
        createNotification({
          userId: patient._id,
          type: 'appointment_reminder',
          title: 'Appointment Starting Now',
          message: `Your ${appt.type} appointment with Dr. ${doctorName} is starting now. Please join the session.`,
          metadata: { appointmentId: appt._id },
        }).catch(() => {});
      }
    }

    // 1-hour reminder
    if (at >= win1Start && at <= win1End) {
      const inserted = await insertReminderLog(appt._id, '1h');
      if (inserted !== false) {
        const payload = { doctorName, patientName, type: appt.type, scheduledAt: at, windowLabel: '1 hour away' };
        if (patient?.email) sendAppointmentReminderEmail({ email: patient.email, name: patientName, ...payload }).catch(() => {});
        if (patient?._id) {
          createNotification({
            userId: patient._id,
            type: 'appointment_reminder',
            title: 'Appointment in 1 Hour',
            message: `Your ${appt.type} appointment with Dr. ${doctorName} starts in about 1 hour.`,
            metadata: { appointmentId: appt._id },
          }).catch(() => {});
        }
      }
    }

    // 24-hour reminder
    if (at >= win24Start && at <= win24End) {
      const inserted = await insertReminderLog(appt._id, '24h');
      if (inserted !== false) {
        const payload = { doctorName, patientName, type: appt.type, scheduledAt: at, windowLabel: '24 hours away' };
        if (patient?.email) sendAppointmentReminderEmail({ email: patient.email, name: patientName, ...payload }).catch(() => {});
        if (patient?._id) {
          createNotification({
            userId: patient._id,
            type: 'appointment_reminder',
            title: 'Appointment Tomorrow',
            message: `Your ${appt.type} appointment with Dr. ${doctorName} is tomorrow at ${at.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.`,
            metadata: { appointmentId: appt._id },
          }).catch(() => {});
        }
      }
    }
  }
}

// Returns false if the reminder was already sent (duplicate), true if inserted fresh
async function insertReminderLog(appointmentId, window) {
  try {
    await ReminderLog.create({ appointmentId, window });
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // duplicate key — already sent
    throw err;
  }
}

async function expireWalkIns() {
  const now = new Date();
  const expired = await DiagnosticsRequest.find({
    status: 'pending',
    collectionType: 'walk_in',
    walkInExpiresAt: { $lte: now },
  }).lean();

  if (!expired.length) return;

  const ids = expired.map(r => r._id);
  await DiagnosticsRequest.updateMany({ _id: { $in: ids } }, { status: 'expired' });

  for (const req of expired) {
    createNotification({
      userId: req.patient,
      type:   'lab_request_placed',
      title:  'Walk-in Booking Expired',
      message: 'Your walk-in lab test booking has expired. Please book again or contact us.',
      metadata: { requestId: req._id },
    }).catch(() => {});
  }

  notifyAdmins({
    type:    'lab_request_placed',
    title:   `${expired.length} Walk-in Booking${expired.length > 1 ? 's' : ''} Expired`,
    message: `${expired.length} pending walk-in lab request${expired.length > 1 ? 's have' : ' has'} expired without a patient visit.`,
    metadata: { count: expired.length },
  }).catch(() => {});
}

function startCronJobs() {
  // Appointment reminders — every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    sendReminders().catch(err => console.error('[Cron] reminder error:', err.message));
  });
  console.log('[Cron] Appointment reminder job started (every 15 min)');

  // Walk-in expiry — every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    expireWalkIns().catch(err => console.error('[Cron] walk-in expiry error:', err.message));
  });
  console.log('[Cron] Walk-in expiry job started (every 30 min)');
}

module.exports = { startCronJobs };
