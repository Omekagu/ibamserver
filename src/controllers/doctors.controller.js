const Doctor = require('../models/Doctor');
const User   = require('../models/User');
const Availability = require('../models/Availability');
const Appointment = require('../models/Appointment');
const { uploadBuffer } = require('../services/cloudinary.service');
const { sendAdminAlertEmail } = require('../services/email.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.listDoctors = asyncHandler(async (req, res) => {
  const { specialization, page = 1, limit = 20 } = req.query;
  const filter = { isApproved: true };
  if (specialization) filter.specialization = new RegExp(specialization, 'i');

  const doctors = await Doctor.find(filter)
    .populate('user', 'name avatar')
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const total = await Doctor.countDocuments(filter);
  sendSuccess(res, 200, 'Doctors retrieved.', { doctors, total, page: Number(page), pages: Math.ceil(total / limit) });
});

exports.getDoctorProfile = asyncHandler(async (req, res, next) => {
  const doctor = await Doctor.findOne({ user: req.params.id }).populate('user', 'name avatar email');
  if (!doctor) return next(new AppError('Doctor not found.', 404));
  sendSuccess(res, 200, 'Doctor profile retrieved.', { doctor });
});

exports.uploadLicense = asyncHandler(async (req, res, next) => {
  const doctor = await Doctor.findOne({ user: req.user._id }).select('licenseDocument kycStatus');
  if (doctor?.licenseDocument) {
    return next(new AppError('License already submitted. Your KYC is locked.', 409));
  }
  if (!req.file) return next(new AppError('No file uploaded.', 400));
  const result = await uploadBuffer(req.file.buffer, 'licenses', 'auto');
  await Doctor.findOneAndUpdate({ user: req.user._id }, { licenseDocument: result.secure_url });

  sendAdminAlertEmail({
    subject: 'Doctor licence submitted for review',
    headline: 'New Licence Document',
    body: `Dr. ${req.user.name} (${req.user.email}) has uploaded their licence document and is awaiting KYC approval.`,
    ctaLabel: 'Review Doctor',
    ctaUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/doctors`,
  }).catch(err => console.error('[Email] Admin licence alert failed:', err.message));

  sendSuccess(res, 200, 'License uploaded.', { licenseUrl: result.secure_url });
});

exports.getMyProfile = asyncHandler(async (req, res, next) => {
  const doctor = await Doctor.findOne({ user: req.user._id }).populate('user', 'name email phone avatar');
  if (!doctor) return next(new AppError('Doctor profile not found.', 404));
  sendSuccess(res, 200, 'Profile retrieved.', { doctor });
});

exports.updateMyProfile = asyncHandler(async (req, res, next) => {
  const { bio, consultationFee, yearsOfExperience, qualifications, rateType, sessionDurationMinutes, urgentAvailable, urgentSurcharge, fees, isAvailable, bankAccount, displayName, socialLinks } = req.body;
  const update = { bio, consultationFee, yearsOfExperience, qualifications, rateType, sessionDurationMinutes, urgentAvailable, urgentSurcharge };
  if (typeof isAvailable === 'boolean') update.isAvailable = isAvailable;
  if (fees && typeof fees === 'object') update.fees = fees;
  if (bankAccount && typeof bankAccount === 'object') update.bankAccount = bankAccount;
  if (displayName !== undefined) update.displayName = displayName;
  if (socialLinks && typeof socialLinks === 'object') update.socialLinks = socialLinks;
  const doctor = await Doctor.findOneAndUpdate(
    { user: req.user._id },
    update,
    { new: true, runValidators: true }
  ).populate('user', 'name email phone avatar');
  if (!doctor) return next(new AppError('Doctor profile not found.', 404));
  sendSuccess(res, 200, 'Profile updated.', { doctor });
});

exports.uploadAvatar = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No file uploaded.', 400));
  const result = await uploadBuffer(req.file.buffer, 'avatars', 'image');
  await User.findByIdAndUpdate(req.user._id, { avatar: result.secure_url });
  sendSuccess(res, 200, 'Avatar updated.', { avatarUrl: result.secure_url });
});

exports.setAvailability = asyncHandler(async (req, res, next) => {
  const { type, dayOfWeek, date, slots } = req.body;
  if (!type || !slots?.length) return next(new AppError('type and slots are required.', 400));

  const filter = { doctor: req.user._id, type };
  if (type === 'recurring') filter.dayOfWeek = dayOfWeek;
  else filter.date = new Date(date);

  const availability = await Availability.findOneAndUpdate(
    filter,
    { doctor: req.user._id, type, dayOfWeek, date: date ? new Date(date) : undefined, slots, isActive: true },
    { upsert: true, new: true }
  );
  sendSuccess(res, 200, 'Availability set.', { availability });
});

exports.getAvailableSlots = asyncHandler(async (req, res, next) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) return next(new AppError('doctorId and date required.', 400));

  const targetDate = new Date(date);
  const dayOfWeek = targetDate.getDay();

  const [oneOff, recurring] = await Promise.all([
    Availability.findOne({ doctor: doctorId, type: 'one_off', date: targetDate, isActive: true }),
    Availability.findOne({ doctor: doctorId, type: 'recurring', dayOfWeek, isActive: true }),
  ]);

  const availability = oneOff || recurring;
  if (!availability) {
    return sendSuccess(res, 200, 'No availability for this date.', { slots: [] });
  }

  const freeSlots = availability.slots.filter((s) => !s.isBooked);
  sendSuccess(res, 200, 'Available slots retrieved.', { slots: freeSlots, availabilityId: availability._id });
});

exports.getMyAvailability = asyncHandler(async (req, res) => {
  const availabilities = await Availability.find({ doctor: req.user._id, isActive: true }).lean();
  sendSuccess(res, 200, 'Availability retrieved.', { availabilities });
});

exports.getDoctorAppointments = asyncHandler(async (req, res) => {
  const { date, status } = req.query;
  const filter = { doctor: req.params.id || req.user._id };
  if (status) filter.status = status;
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    filter.scheduledAt = { $gte: start, $lt: end };
  }
  const appointments = await Appointment.find(filter)
    .populate('patient', 'name avatar')
    .sort({ scheduledAt: 1 });
  sendSuccess(res, 200, 'Appointments retrieved.', { appointments });
});
