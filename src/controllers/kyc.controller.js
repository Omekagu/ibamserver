const User           = require('../models/User');
const Doctor         = require('../models/Doctor');
const PharmacyPartner = require('../models/PharmacyPartner');
const LabPartner     = require('../models/LabPartner');
const { lookupNIN, faceMatch, lookupCAC } = require('../services/dojah.service');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// ─── NIN Verification ─────────────────────────────────────────────────────────
// POST /api/kyc/verify-nin
// Patient or doctor submits their NIN. We verify it via Dojah and check that
// the name on the NIN record closely matches the account name.
exports.verifyNIN = asyncHandler(async (req, res, next) => {
  const { nin } = req.body;
  if (!nin || !/^\d{11}$/.test(nin)) {
    return next(new AppError('A valid 11-digit NIN is required.', 400));
  }

  // Hard lock: once NIN or any later step is done, reject resubmission
  const existingUser = await User.findById(req.user._id).select('kycStatus');
  if (['nin_verified', 'face_verified', 'approved'].includes(existingUser?.kycStatus)) {
    return next(new AppError('NIN already verified. Your KYC is locked and cannot be resubmitted.', 409));
  }

  let entity;
  try {
    entity = await lookupNIN(nin);
  } catch (err) {
    return next(new AppError(err.message || 'Could not verify NIN. Try again later.', 422));
  }

  // Name match — split both sides into tokens, require at least one overlap.
  // Skipped in bypass/dev mode since the mock entity returns generic tokens.
  let nameMatch = true;
  if (process.env.DOJAH_BYPASS !== 'true') {
    const normalize = (s) => (s ?? '').toLowerCase().replace(/[^a-z]/g, ' ').trim();
    const accountTokens = new Set(normalize(req.user.name).split(/\s+/).filter(Boolean));
    const dojahTokens   = [
      ...normalize(entity.firstname  ?? '').split(/\s+/),
      ...normalize(entity.lastname   ?? '').split(/\s+/),
      ...normalize(entity.middlename ?? '').split(/\s+/),
    ].filter(t => t.length > 1);

    nameMatch = dojahTokens.length === 0 || dojahTokens.some(t => accountTokens.has(t));

    if (!nameMatch) {
      return next(new AppError(
        `NIN name (${entity.firstname} ${entity.lastname}) does not match your account name. Update your account name or use your correct NIN.`,
        422
      ));
    }
  }

  // Mark user as NIN-verified
  await User.findByIdAndUpdate(req.user._id, {
    nin: nin,
    ninVerified: true,
    kycStatus: 'nin_verified',
    isVerified: true,
  });

  // If doctor, also update their KYC status
  if (req.user.role === 'doctor') {
    await Doctor.findOneAndUpdate(
      { user: req.user._id },
      { ninVerified: true, kycStatus: 'nin_verified' }
    );
  }

  sendSuccess(res, 200, 'NIN verified successfully.', {
    verified: true,
    nameMatch,
    dojahName: `${entity.firstname} ${entity.lastname}`,
    // Return the NIN photo so the frontend can use it for face match
    ninPhoto: entity.photo ?? null,
  });
});

// ─── Face Match (doctors only) ────────────────────────────────────────────────
// POST /api/kyc/verify-face
// Doctor uploads a selfie (base64). We compare it against the NIN photo
// retrieved live from Dojah for their stored NIN.
exports.verifyFace = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'doctor') {
    return next(new AppError('Face verification is required for doctors only.', 403));
  }

  const { selfie } = req.body;
  if (!selfie) return next(new AppError('selfie (base64) is required.', 400));

  const user = await User.findById(req.user._id).select('+nin ninVerified kycStatus');
  if (!user.ninVerified || !user.nin) {
    return next(new AppError('Complete NIN verification first.', 400));
  }

  // Hard lock: once face is verified or approved, reject resubmission
  if (['face_verified', 'approved'].includes(user?.kycStatus)) {
    return next(new AppError('Face verification already completed. Your KYC is locked.', 409));
  }

  let matchResult;

  if (process.env.DOJAH_BYPASS === 'true') {
    // Dev bypass — skip real photo fetch and face match entirely.
    matchResult = { match: true, confidence: 99 };
  } else {
    // Fetch the NIN photo to compare against
    let ninEntity;
    try {
      ninEntity = await lookupNIN(user.nin);
    } catch {
      return next(new AppError('Could not retrieve NIN photo for face match. Try again.', 422));
    }

    if (!ninEntity.photo) {
      return next(new AppError('No photo found on NIN record. Contact support.', 422));
    }

    try {
      matchResult = await faceMatch(selfie, ninEntity.photo);
    } catch (err) {
      return next(new AppError(err.message || 'Face match failed. Try again with a clearer selfie.', 422));
    }
  }

  const doctor = await Doctor.findOneAndUpdate(
    { user: req.user._id },
    {
      faceMatchVerified: matchResult.match,
      faceMatchScore: matchResult.confidence,
      ...(matchResult.match && { kycStatus: 'face_verified' }),
    },
    { new: true }
  );

  // Mirror the status on the User so getStatus returns the right step on reload.
  if (matchResult.match) {
    await User.findByIdAndUpdate(req.user._id, { kycStatus: 'face_verified' });
  }

  if (matchResult.match) {
    await createNotification({
      userId: req.user._id,
      type: 'general',
      title: 'Identity Verified',
      message: 'Your identity has been verified. Your account is now pending licence review by our team.',
      emailData: {},
    });
  }

  sendSuccess(res, matchResult.match ? 200 : 422,
    matchResult.match ? 'Face match successful.' : 'Face match failed. Please retake your selfie.',
    {
      match: matchResult.match,
      confidence: matchResult.confidence,
      kycStatus: doctor?.kycStatus,
    }
  );
});

// ─── CAC Verification (pharmacy & lab partners) ───────────────────────────────
// POST /api/kyc/verify-cac
exports.verifyCAC = asyncHandler(async (req, res, next) => {
  const role = req.user.role;
  if (!['pharmacy_partner', 'lab_partner'].includes(role)) {
    return next(new AppError('CAC verification is for pharmacy and lab partners only.', 403));
  }

  const { rcNumber, businessName } = req.body;
  if (!rcNumber) return next(new AppError('RC number is required.', 400));

  let entity;
  try {
    entity = await lookupCAC(rcNumber);
  } catch (err) {
    return next(new AppError(err.message || 'Could not verify CAC number. Check the RC number and try again.', 422));
  }

  // Loose name match check
  const registeredName = (entity.company_name ?? '').toLowerCase();
  const submittedName  = (businessName ?? '').toLowerCase();
  const nameMatch = !businessName || registeredName.includes(submittedName) || submittedName.includes(registeredName.split(' ')[0]);

  // Update the relevant partner model
  const update = { cacNumber: rcNumber, cacVerified: true, cacRegisteredName: entity.company_name };
  if (role === 'pharmacy_partner') {
    await PharmacyPartner.findOneAndUpdate({ user: req.user._id }, update);
  } else {
    await LabPartner.findOneAndUpdate({ user: req.user._id }, update);
  }

  sendSuccess(res, 200, 'CAC number verified successfully.', {
    verified: true,
    nameMatch,
    registeredName: entity.company_name,
    rcNumber: entity.rc_number,
    status: entity.status,
  });
});

// ─── KYC Status ───────────────────────────────────────────────────────────────
// GET /api/kyc/status
// Returns the current KYC status for the authenticated user.
exports.getStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('nin ninVerified kycStatus isVerified');

  let details = {};
  if (req.user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user: req.user._id })
      .select('kycStatus faceMatchVerified faceMatchScore isApproved licenseDocument');
    details = { doctor };
  }
  if (['pharmacy_partner', 'lab_partner'].includes(req.user.role)) {
    const Model = req.user.role === 'pharmacy_partner' ? PharmacyPartner : LabPartner;
    const partner = await Model.findOne({ user: req.user._id }).select('cacVerified cacNumber cacRegisteredName status');
    details = { partner };
  }

  sendSuccess(res, 200, 'KYC status retrieved.', { user, ...details });
});
