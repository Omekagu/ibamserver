const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const ReminderLog = require('../models/ReminderLog');
const { sendAppointmentReminderEmail } = require('./email.service');
const { createNotification } = require('./notification.service');

async function sendReminders() {
  const now = new Date();

  // 24-hour window: appointments between 23h55m and 24h10m from now
  const win24Start = new Date(now.getTime() + 23 * 3600_000 + 55 * 60_000);
  const win24End   = new Date(now.getTime() + 24 * 3600_000 + 10 * 60_000);

  // 1-hour window: appointments between 55m and 70m from now
  const win1Start  = new Date(now.getTime() + 55 * 60_000);
  const win1End    = new Date(now.getTime() + 70 * 60_000);

  const upcoming = await Appointment.find({
    status: { $in: ['pending', 'confirmed'] },
    scheduledAt: { $gte: win1Start, $lte: win24End },
  })
    .populate('patient', 'name email expoPushToken')
    .populate({ path: 'doctor', select: 'name', populate: { path: 'user', select: 'name email' } })
    .lean();

  for (const appt of upcoming) {
    const at = new Date(appt.scheduledAt);
    const key = appt._id.toString();

    const patient     = appt.patient;
    const doctorUser  = appt.doctor?.user;
    const doctorName  = doctorUser?.name ?? appt.doctor?.name ?? 'Your doctor';
    const patientName = patient?.name ?? 'Patient';

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
            message: `Your appointment with Dr. ${doctorName} is tomorrow at ${at.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.`,
            metadata: { appointmentId: appt._id },
          }).catch(() => {});
        }
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
            message: `Your appointment with Dr. ${doctorName} starts in about 1 hour.`,
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

function startCronJobs() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    sendReminders().catch(err => console.error('[Cron] reminder error:', err.message));
  });
  console.log('[Cron] Appointment reminder job started (every 15 min)');
}

module.exports = { startCronJobs };
