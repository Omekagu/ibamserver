const Prescription = require('../models/Prescription');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.create = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'doctor') return next(new AppError('Only doctors can issue prescriptions.', 403));
  const { patientId, consultationId, medications, diagnosis, instructions } = req.body;
  if (!medications?.length) return next(new AppError('At least one medication required.', 400));

  const prescription = await Prescription.create({
    doctor: req.user._id,
    patient: patientId,
    consultation: consultationId,
    medications,
    diagnosis,
    instructions,
  });

  await createNotification({
    userId: patientId,
    type: 'prescription_ready',
    title: 'Prescription Issued',
    message: 'Your doctor has issued a new prescription. Check your prescriptions tab.',
    metadata: { prescriptionId: prescription._id },
    emailData: {
      doctorName: req.user.name,
      medications: medications.map(m => m.name || String(m)),
    },
  });

  sendSuccess(res, 201, 'Prescription created.', { prescription });
});

exports.getMine = asyncHandler(async (req, res) => {
  const field = req.user.role === 'doctor' ? 'doctor' : 'patient';
  const prescriptions = await Prescription.find({ [field]: req.user._id })
    .populate('doctor', 'name')
    .populate('patient', 'name')
    .sort({ createdAt: -1 });
  sendSuccess(res, 200, 'Prescriptions retrieved.', { prescriptions });
});

exports.getOne = asyncHandler(async (req, res, next) => {
  const prescription = await Prescription.findById(req.params.id)
    .populate('doctor', 'name')
    .populate('patient', 'name');
  if (!prescription) return next(new AppError('Prescription not found.', 404));

  const isAuthorised =
    prescription.doctor._id.toString() === req.user._id.toString() ||
    prescription.patient._id.toString() === req.user._id.toString() ||
    req.user.role === 'admin';
  if (!isAuthorised) return next(new AppError('Not authorised.', 403));

  sendSuccess(res, 200, 'Prescription retrieved.', { prescription });
});

exports.forwardToPharmacy = asyncHandler(async (req, res, next) => {
  const prescription = await Prescription.findById(req.params.id);
  if (!prescription) return next(new AppError('Prescription not found.', 404));
  if (prescription.patient.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorised.', 403));
  }
  prescription.forwardedToPharmacy = true;
  await prescription.save();
  sendSuccess(res, 200, 'Prescription forwarded to pharmacy.', { prescription });
});

exports.getByConsultation = asyncHandler(async (req, res, next) => {
  const { cid } = req.params;
  const prescriptions = await Prescription.find({ consultation: cid })
    .populate('doctor', 'name')
    .sort({ createdAt: 1 })
    .lean();
  sendSuccess(res, 200, 'Prescriptions retrieved.', { prescriptions });
});
