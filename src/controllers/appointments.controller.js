const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.book = asyncHandler(async (req, res, next) => {
  const { doctorId, scheduledAt, type, triageRef, availabilityId, slotId, isUrgent, sessionDurationMinutes } = req.body;

  if (new Date(scheduledAt) <= new Date()) {
    return next(new AppError('Cannot book a time slot that has already passed.', 400));
  }

  const doctor = await Doctor.findOne({ user: doctorId, isApproved: true });
  if (!doctor) return next(new AppError('Doctor not found or not approved.', 404));

  // ── Prevent double-booking ─────────────────────────────────────────────────
  const conflict = await Appointment.findOne({
    doctor: doctorId,
    scheduledAt: new Date(scheduledAt),
    status: { $nin: ['cancelled'] },
  });
  if (conflict) return next(new AppError('This time slot is already booked. Please select a different time.', 409));

  // ── Mark slot as booked ────────────────────────────────────────────────────
  const scheduledDate = new Date(scheduledAt);
  const slotTime = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;

  if (availabilityId && slotId) {
    await Availability.findOneAndUpdate(
      { _id: availabilityId, 'slots._id': slotId, 'slots.isBooked': false },
      { $set: { 'slots.$.isBooked': true } }
    );
  } else {
    // Fall back to time-based lookup when client doesn't send explicit IDs
    await Availability.findOneAndUpdate(
      { doctor: doctor._id, isActive: true, 'slots.startTime': slotTime, 'slots.isBooked': false },
      { $set: { 'slots.$.isBooked': true } }
    );
  }

  // Compute fee: type-specific rate → billing model → urgency surcharge
  const durationMin = Number(sessionDurationMinutes) || doctor.sessionDurationMinutes || 30;
  const typeFee = (doctor.fees && doctor.fees[type] != null) ? doctor.fees[type] : (doctor.consultationFee || 0);
  let consultationFee = typeFee;
  if (doctor.rateType === 'per_hour')   consultationFee = Math.ceil(durationMin / 60) * typeFee;
  if (doctor.rateType === 'per_minute') consultationFee = durationMin * typeFee;
  if (isUrgent && doctor.urgentSurcharge) consultationFee += doctor.urgentSurcharge;

  const appointment = await Appointment.create({
    patient: req.user._id,
    doctor: doctorId,
    scheduledAt: new Date(scheduledAt),
    type,
    triageRef,
    consultationFee,
    isUrgent: Boolean(isUrgent),
    sessionDurationMinutes: durationMin,
    // Free appointments are confirmed immediately; paid ones wait for payment verification
    status: consultationFee === 0 ? 'confirmed' : 'pending',
  });

  const doctorUser = await User.findById(doctorId).select('name').lean();

  // Notify patient (in-app)
  createNotification({
    userId: req.user._id,
    type: 'appointment_booked',
    title: 'Appointment Booked',
    message: `Your ${type} appointment with Dr. ${doctorUser?.name || 'your doctor'} has been booked. Awaiting payment confirmation.`,
    metadata: { appointmentId: appointment._id },
  }).catch(() => {});

  // Only notify doctor immediately for free appointments (auto-confirmed).
  // Paid appointments: doctor notification fires in payments.controller.js after payment succeeds.
  if (consultationFee === 0) {
    createNotification({
      userId: doctorId,
      type: 'appointment_confirmed',
      title: 'New Appointment',
      message: `A patient has booked a ${type} appointment with you.`,
      metadata: { appointmentId: appointment._id },
    }).catch(() => {});
  }

  sendSuccess(res, 201, 'Appointment booked.', { appointment });
});

exports.getMyAppointments = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { patient: req.user._id };
  if (status) filter.status = status;

  const appointments = await Appointment.find(filter)
    .populate('doctor', 'name avatar')
    .sort({ scheduledAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Appointment.countDocuments(filter);
  sendSuccess(res, 200, 'Appointments retrieved.', { appointments, total });
});

exports.cancel = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) return next(new AppError('Appointment not found.', 404));

  const isOwner =
    appointment.patient.toString() === req.user._id.toString() ||
    appointment.doctor.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    return next(new AppError('Not authorised.', 403));
  }
  if (['completed', 'cancelled'].includes(appointment.status)) {
    return next(new AppError(`Cannot cancel a ${appointment.status} appointment.`, 400));
  }

  appointment.status = 'cancelled';
  appointment.cancellationReason = reason;
  appointment.cancelledBy = req.user._id;
  await appointment.save();

  const notifyId = req.user._id.toString() === appointment.patient.toString()
    ? appointment.doctor
    : appointment.patient;

  const isNotifyingPatient = notifyId.toString() === appointment.patient.toString();
  let cancelEmailData;
  if (isNotifyingPatient) {
    const doctorUser = await User.findById(appointment.doctor).select('name').lean();
    cancelEmailData = { doctorName: doctorUser?.name || 'Doctor', scheduledAt: appointment.scheduledAt, reason };
  }

  await createNotification({
    userId: notifyId,
    type: 'appointment_cancelled',
    title: 'Appointment Cancelled',
    message: `An appointment on ${appointment.scheduledAt.toDateString()} has been cancelled.`,
    metadata: { appointmentId: appointment._id, reason },
    emailData: cancelEmailData,
  });

  sendSuccess(res, 200, 'Appointment cancelled.', { appointment });
});

exports.reschedule = asyncHandler(async (req, res, next) => {
  const { scheduledAt } = req.body;
  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) return next(new AppError('Appointment not found.', 404));
  if (appointment.patient.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the patient can reschedule.', 403));
  }
  if (['completed', 'cancelled'].includes(appointment.status)) {
    return next(new AppError(`Cannot reschedule a ${appointment.status} appointment.`, 400));
  }

  appointment.scheduledAt = new Date(scheduledAt);
  await appointment.save();

  await createNotification({
    userId: appointment.doctor,
    type: 'appointment_booked',
    title: 'Appointment Rescheduled',
    message: `An appointment has been rescheduled to ${appointment.scheduledAt.toDateString()}.`,
    metadata: { appointmentId: appointment._id },
    emailData: { patientName: req.user.name, appointmentType: appointment.type, scheduledAt: appointment.scheduledAt },
  });

  sendSuccess(res, 200, 'Appointment rescheduled.', { appointment });
});

exports.scheduleFollowUp = asyncHandler(async (req, res, next) => {
  const { scheduledAt, type, notes } = req.body;
  const original = await Appointment.findById(req.params.id);
  if (!original) return next(new AppError('Original appointment not found.', 404));
  if (original.doctor.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the treating doctor can schedule a follow-up.', 403));
  }

  const followUp = await Appointment.create({
    patient: original.patient,
    doctor: original.doctor,
    scheduledAt: new Date(scheduledAt),
    type: type || original.type,
    consultationFee: 0,
    isFollowUp: true,
    followUpRef: original._id,
    notes,
    status: 'confirmed',
  });

  await createNotification({
    userId: original.patient,
    type: 'follow_up_scheduled',
    title: 'Follow-Up Appointment Scheduled',
    message: `Your doctor has scheduled a follow-up appointment for ${followUp.scheduledAt.toDateString()}.`,
    metadata: { appointmentId: followUp._id },
    emailData: { doctorName: req.user.name, scheduledAt: followUp.scheduledAt, appointmentType: followUp.type },
  });

  sendSuccess(res, 201, 'Follow-up appointment scheduled.', { followUp });
});

exports.getFollowUps = asyncHandler(async (req, res) => {
  const followUps = await Appointment.find({ patient: req.user._id, isFollowUp: true, status: { $nin: ['completed', 'cancelled'] } })
    .populate('doctor', 'name avatar')
    .sort({ scheduledAt: 1 });
  sendSuccess(res, 200, 'Follow-up appointments retrieved.', { followUps });
});
