const Consultation = require('../models/Consultation');
const Message = require('../models/Message');
const Appointment = require('../models/Appointment');
const DoctorEarning = require('../models/DoctorEarning');
const { generateRtcToken } = require('../services/agora.service');
const { uploadBuffer } = require('../services/cloudinary.service');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { filterProfanity } = require('../utils/profanityFilter');

const PLATFORM_CUT_PERCENT = Number(process.env.PLATFORM_CUT_PERCENT) || 20;

exports.startConsultation = asyncHandler(async (req, res, next) => {
  const { appointmentId } = req.body;
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return next(new AppError('Appointment not found.', 404));
  if (appointment.doctor.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the assigned doctor can start this consultation.', 403));
  }

  const existing = await Consultation.findOne({ appointment: appointmentId });
  if (existing) return sendSuccess(res, 200, 'Consultation already exists.', { consultation: existing });

  const channelName = `ibam_${appointmentId}`;
  let agoraToken = null;
  if (['audio', 'video'].includes(appointment.type)) {
    try {
      agoraToken = generateRtcToken(channelName, 0);
    } catch { /* Agora not configured yet */ }
  }

  const consultation = await Consultation.create({
    appointment: appointmentId,
    consultationType: appointment.type,
    agoraChannel: channelName,
    agoraToken,
  });

  appointment.status = 'confirmed';
  await appointment.save();

  await createNotification({
    userId: appointment.patient,
    type: 'consultation_started',
    title: 'Your Consultation Has Started',
    message: 'Your doctor is ready. Join your consultation now.',
    metadata: { consultationId: consultation._id },
    emailData: { doctorName: req.user.name, appointmentType: appointment.type },
  });

  sendSuccess(res, 201, 'Consultation started.', { consultation });
});

exports.getByAppointment = asyncHandler(async (req, res, next) => {
  const consultation = await Consultation.findOne({ appointment: req.params.appointmentId })
    .populate({
      path: 'appointment',
      populate: [
        { path: 'patient', select: 'name avatar' },
        { path: 'doctor', select: 'name avatar' },
      ],
    });
  if (!consultation) return next(new AppError('Consultation not started yet.', 404));
  sendSuccess(res, 200, 'Consultation retrieved.', { consultation });
});

exports.getMessages = asyncHandler(async (req, res, next) => {
  // Run auth-check lookup and message fetch in parallel instead of sequentially
  const [consultation, messages] = await Promise.all([
    Consultation.findById(req.params.id)
      .populate('appointment', 'patient doctor')
      .lean(),
    Message.find({ consultation: req.params.id })
      .populate('sender', 'name avatar')
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  if (!consultation) return next(new AppError('Consultation not found.', 404));

  const appt = consultation.appointment;
  const uid = req.user._id.toString();
  if (appt.patient.toString() !== uid && appt.doctor.toString() !== uid) {
    return next(new AppError('Not authorised.', 403));
  }

  sendSuccess(res, 200, 'Messages retrieved.', { messages });
});

exports.generateAgoraToken = asyncHandler(async (req, res, next) => {
  const { consultationId, uid = 0 } = req.body;
  const consultation = await Consultation.findById(consultationId).populate('appointment');
  if (!consultation) return next(new AppError('Consultation not found.', 404));

  const appt = consultation.appointment;
  const isParticipant =
    appt.patient.toString() === req.user._id.toString() ||
    appt.doctor.toString() === req.user._id.toString();
  if (!isParticipant) return next(new AppError('Not authorised.', 403));

  const token = generateRtcToken(consultation.agoraChannel, uid);
  sendSuccess(res, 200, 'Agora token generated.', { token, channel: consultation.agoraChannel });
});

exports.endConsultation = asyncHandler(async (req, res, next) => {
  const { summary, soapNote } = req.body;
  const consultation = await Consultation.findById(req.params.id).populate('appointment');
  if (!consultation) return next(new AppError('Consultation not found.', 404));

  if (consultation.appointment.doctor.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the doctor can end the consultation.', 403));
  }

  const durationMs = Date.now() - consultation.startedAt.getTime();
  consultation.status = 'ended';
  consultation.endedAt = new Date();
  consultation.duration = Math.ceil(durationMs / 60000);
  if (summary) consultation.summary = summary;
  if (soapNote) consultation.soapNote = soapNote;
  await consultation.save();

  const appt = consultation.appointment;
  appt.status = 'completed';
  await appt.save();

  // Record doctor earnings
  if (appt.consultationFee > 0) {
    const platformCut = (appt.consultationFee * PLATFORM_CUT_PERCENT) / 100;
    await DoctorEarning.create({
      doctor: appt.doctor,
      consultation: consultation._id,
      grossAmount: appt.consultationFee,
      platformCut,
      netAmount: appt.consultationFee - platformCut,
    });
  }

  await createNotification({
    userId: appt.patient,
    type: 'consultation_ended',
    title: 'Consultation Ended',
    message: 'Your consultation has ended. Your doctor may issue a prescription shortly.',
    metadata: { consultationId: consultation._id },
    emailData: { doctorName: req.user.name, duration: consultation.duration, summary: consultation.summary },
  });

  sendSuccess(res, 200, 'Consultation ended.', { consultation });
});

exports.sendMessage = asyncHandler(async (req, res, next) => {
  const { content } = req.body;
  if (!content?.trim()) return next(new AppError('Message content required.', 400));

  const consultation = await Consultation.findById(req.params.id).populate('appointment');
  if (!consultation) return next(new AppError('Consultation not found.', 404));

  const appt = consultation.appointment;
  const isParticipant =
    appt.patient.toString() === req.user._id.toString() ||
    appt.doctor.toString() === req.user._id.toString();
  if (!isParticipant) return next(new AppError('Not authorised.', 403));

  const { clean } = filterProfanity(content.trim());

  const message = await Message.create({
    consultation: req.params.id,
    sender: req.user._id,
    content: clean,
    type: 'text',
  });

  await message.populate('sender', 'name avatar');
  sendSuccess(res, 201, 'Message sent.', { message });
});

exports.uploadChatFile = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No file provided.', 400));
  const result = await uploadBuffer(req.file.buffer, 'chat_files', 'auto');

  const msg = await Message.create({
    consultation: req.params.id,
    sender: req.user._id,
    type: req.file.mimetype.startsWith('image') ? 'image' : 'file',
    fileUrl: result.secure_url,
    fileName: req.file.originalname,
  });

  sendSuccess(res, 201, 'File uploaded.', { message: msg });
});
