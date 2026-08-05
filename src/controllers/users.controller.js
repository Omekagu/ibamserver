const User = require('../models/User');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { uploadBuffer } = require('../services/cloudinary.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  let profile = null;
  if (user.role === 'patient') profile = await Patient.findOne({ user: user._id });
  if (user.role === 'doctor') profile = await Doctor.findOne({ user: user._id });
  sendSuccess(res, 200, 'Profile retrieved.', { user, profile });
});

exports.updateProfile = asyncHandler(async (req, res, next) => {
  const { name, phone } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (phone) updates.phone = phone;

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });

  if (req.user.role === 'patient') {
    const { dateOfBirth, gender, bloodGroup, allergies, emergencyContact } = req.body;
    await Patient.findOneAndUpdate(
      { user: req.user._id },
      { dateOfBirth, gender, bloodGroup, allergies, emergencyContact },
      { new: true, runValidators: true }
    );
  }

  if (req.user.role === 'doctor') {
    const { bio, consultationFee, yearsOfExperience } = req.body;
    await Doctor.findOneAndUpdate(
      { user: req.user._id },
      { bio, consultationFee, yearsOfExperience },
      { new: true }
    );
  }

  sendSuccess(res, 200, 'Profile updated.', { user });
});

exports.uploadAvatar = asyncHandler(async (req, res, next) => {
  // Direct Cloudinary URL from mobile direct upload
  const directUrl = req.body?.url;
  if (directUrl) {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: directUrl },
      { new: true }
    );
    return sendSuccess(res, 200, 'Avatar updated.', { avatar: user.avatar });
  }
  if (!req.file) return next(new AppError('No file uploaded.', 400));
  const result = await uploadBuffer(req.file.buffer, 'avatars', 'image');
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { avatar: result.secure_url },
    { new: true }
  );
  sendSuccess(res, 200, 'Avatar uploaded.', { avatar: user.avatar });
});

exports.addMedicalHistory = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'patient') return next(new AppError('Only patients can add medical history.', 403));
  const { condition, diagnosedDate, notes } = req.body;
  const patient = await Patient.findOneAndUpdate(
    { user: req.user._id },
    { $push: { medicalHistory: { condition, diagnosedDate, notes } } },
    { new: true }
  );
  sendSuccess(res, 200, 'Medical history updated.', { medicalHistory: patient.medicalHistory });
});
