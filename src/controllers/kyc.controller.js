const User = require('../models/User')
const Doctor = require('../models/Doctor')
const PharmacyPartner = require('../models/PharmacyPartner')
const LabPartner = require('../models/LabPartner')
const crypto = require('crypto')
const { lookupNIN, faceMatch, lookupCAC } = require('../services/dojah.service')
const { resolveAccount } = require('../services/paystack.service')
const { sendOTPEmail } = require('../services/email.service')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const { sendAdminAlertEmail } = require('../services/email.service')
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

// â”€â”€â”€ NIN Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/kyc/verify-nin
// Patient or doctor submits their NIN. We verify it via Dojah and check that
// the name on the NIN record closely matches the account name.
exports.verifyNIN = asyncHandler(async (req, res, next) => {
  const { nin } = req.body
  if (!nin || !/^\d{11}$/.test(nin)) {
    return next(new AppError('A valid 11-digit NIN is required.', 400))
  }

  // Hard lock: once NIN or any later step is done, reject resubmission
  const existingUser = await User.findById(req.user._id).select('kycStatus')
  if (
    ['nin_verified', 'face_verified', 'approved'].includes(
      existingUser?.kycStatus
    )
  ) {
    return next(
      new AppError(
        'NIN already verified. Your KYC is locked and cannot be resubmitted.',
        409
      )
    )
  }

  let entity
  try {
    entity = await lookupNIN(nin)
  } catch (err) {
    return next(
      new AppError(err.message || 'Could not verify NIN. Try again later.', 422)
    )
  }

  // Name match  split both sides into tokens, require at least one overlap.
  // Skipped in bypass/dev mode since the mock entity returns generic tokens.
  let nameMatch = true
  if (process.env.DOJAH_BYPASS !== 'true') {
    const normalize = s =>
      (s ?? '')
        .toLowerCase()
        .replace(/[^a-z]/g, ' ')
        .trim()
    const accountTokens = new Set(
      normalize(req.user.name).split(/\s+/).filter(Boolean)
    )
    const dojahTokens = [
      ...normalize(entity.firstname ?? '').split(/\s+/),
      ...normalize(entity.lastname ?? '').split(/\s+/),
      ...normalize(entity.middlename ?? '').split(/\s+/)
    ].filter(t => t.length > 1)

    nameMatch =
      dojahTokens.length === 0 || dojahTokens.some(t => accountTokens.has(t))

    if (!nameMatch) {
      return next(
        new AppError(
          `NIN name (${entity.firstname} ${entity.lastname}) does not match your account name. Update your account name or use your correct NIN.`,
          422
        )
      )
    }
  }

  // Deduplication: reject if another account already owns this NIN
  const ninOwner = await User.findOne({ nin, _id: { $ne: req.user._id } })
    .select('_id')
    .lean()
  if (ninOwner) {
    return next(
      new AppError(
        'This NIN is already linked to another account. Contact support if this is an error.',
        409
      )
    )
  }

  // Mark user as NIN-verified
  await User.findByIdAndUpdate(req.user._id, {
    nin: nin,
    ninVerified: true,
    kycStatus: 'nin_verified',
    isVerified: true
  })

  // If doctor, also update their KYC status
  if (req.user.role === 'doctor') {
    await Doctor.findOneAndUpdate(
      { user: req.user._id },
      { ninVerified: true, kycStatus: 'nin_verified' }
    )
  }

  sendSuccess(res, 200, 'NIN verified successfully.', {
    verified: true,
    nameMatch,
    dojahName: `${entity.firstname} ${entity.lastname}`,
    // Return the NIN photo so the frontend can use it for face match
    ninPhoto: entity.photo ?? null
  })
})

// â”€â”€â”€ Face Match (doctors only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/kyc/verify-face
// Doctor uploads a selfie (base64). We compare it against the NIN photo
// retrieved live from Dojah for their stored NIN.
exports.verifyFace = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'doctor') {
    return next(
      new AppError('Face verification is required for doctors only.', 403)
    )
  }

  const { selfie } = req.body
  if (!selfie) return next(new AppError('selfie (base64) is required.', 400))

  const user = await User.findById(req.user._id).select(
    '+nin ninVerified kycStatus'
  )
  if (!user.ninVerified || !user.nin) {
    return next(new AppError('Complete NIN verification first.', 400))
  }

  // Hard lock: once face is verified or approved, reject resubmission
  if (['face_verified', 'approved'].includes(user?.kycStatus)) {
    return next(
      new AppError(
        'Face verification already completed. Your KYC is locked.',
        409
      )
    )
  }

  let matchResult

  if (process.env.DOJAH_BYPASS === 'true') {
    // Dev bypass  skip real photo fetch and face match entirely.
    matchResult = { match: true, confidence: 99 }
  } else {
    // Fetch the NIN photo to compare against
    let ninEntity
    try {
      ninEntity = await lookupNIN(user.nin)
    } catch {
      return next(
        new AppError(
          'Could not retrieve NIN photo for face match. Try again.',
          422
        )
      )
    }

    if (!ninEntity.photo) {
      return next(
        new AppError('No photo found on NIN record. Contact support.', 422)
      )
    }

    try {
      matchResult = await faceMatch(selfie, ninEntity.photo)
    } catch (err) {
      return next(
        new AppError(
          err.message || 'Face match failed. Try again with a clearer selfie.',
          422
        )
      )
    }
  }

  const doctor = await Doctor.findOneAndUpdate(
    { user: req.user._id },
    {
      faceMatchVerified: matchResult.match,
      faceMatchScore: matchResult.confidence,
      ...(matchResult.match && { kycStatus: 'face_verified' })
    },
    { returnDocument: 'after' }
  )

  // Mirror the status on the User so getStatus returns the right step on reload.
  if (matchResult.match) {
    await User.findByIdAndUpdate(req.user._id, { kycStatus: 'face_verified' })
  }

  if (matchResult.match) {
    await createNotification({
      userId: req.user._id,
      type: 'general',
      title: 'Identity Verified',
      message:
        'Your identity has been verified. Your account is now pending licence review by our team.',
      emailData: {}
    })

    notifyAdmins({
      type: 'kyc_submitted',
      title: 'KYC Submitted for Review',
      message: `${req.user.name} completed identity verification and is awaiting licence review.`,
      metadata: { userId: req.user._id, role: req.user.role }
    }).catch(() => {})
    sendAdminAlertEmail({
      subject: `KYC submitted  ${req.user.name}`,
      headline: 'KYC Awaiting Review',
      body: `${req.user.name} (${req.user.email}) has completed identity verification and is now awaiting licence review.`,
      ctaLabel: 'Review KYC',
      ctaUrl: `${
        process.env.CLIENT_URL || 'https://ibamhealth.com'
      }/admin/approvals`
    }).catch(() => {})
  }

  sendSuccess(
    res,
    matchResult.match ? 200 : 422,
    matchResult.match
      ? 'Face match successful.'
      : 'Face match failed. Please retake your selfie.',
    {
      match: matchResult.match,
      confidence: matchResult.confidence,
      kycStatus: doctor?.kycStatus
    }
  )
})

// â”€â”€â”€ CAC Verification (pharmacy & lab partners) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/kyc/verify-cac
exports.verifyCAC = asyncHandler(async (req, res, next) => {
  const role = req.user.role
  if (!['pharmacy_partner', 'lab_partner'].includes(role)) {
    return next(
      new AppError(
        'CAC verification is for pharmacy and lab partners only.',
        403
      )
    )
  }

  const { rcNumber, businessName } = req.body
  if (!rcNumber) return next(new AppError('RC number is required.', 400))

  let entity
  try {
    entity = await lookupCAC(rcNumber)
  } catch (err) {
    return next(
      new AppError(
        err.message ||
          'Could not verify CAC number. Check the RC number and try again.',
        422
      )
    )
  }

  // Loose name match check
  const registeredName = (entity.company_name ?? '').toLowerCase()
  const submittedName = (businessName ?? '').toLowerCase()
  const nameMatch =
    !businessName ||
    registeredName.includes(submittedName) ||
    submittedName.includes(registeredName.split(' ')[0])

  // Update the relevant partner model
  const update = {
    cacNumber: rcNumber,
    cacVerified: true,
    cacRegisteredName: entity.company_name
  }
  if (role === 'pharmacy_partner') {
    await PharmacyPartner.findOneAndUpdate({ user: req.user._id }, update)
  } else {
    await LabPartner.findOneAndUpdate({ user: req.user._id }, update)
  }

  sendSuccess(res, 200, 'CAC number verified successfully.', {
    verified: true,
    nameMatch,
    registeredName: entity.company_name,
    rcNumber: entity.rc_number,
    status: entity.status
  })
})

// â”€â”€â”€ Bank Account Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/kyc/verify-bank
// All partner roles (doctor, pharmacy_partner, lab_partner) call this to add
// their payout bank account. We verify  and reject duplicates across
// the entire system (no two partners can share the same account + bank code).
exports.verifyBankAccount = asyncHandler(async (req, res, next) => {
  const role = req.user.role
  const allowed = ['doctor', 'pharmacy_partner', 'lab_partner']
  if (!allowed.includes(role)) {
    return next(
      new AppError(
        'Bank account verification is for partner accounts only.',
        403
      )
    )
  }

  const { accountNumber, bankCode, bankName } = req.body
  if (!accountNumber || !bankCode) {
    return next(new AppError('accountNumber and bankCode are required.', 400))
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    return next(new AppError('Account number must be exactly 10 digits.', 400))
  }

  // Duplicate check across all partner collections
  const dupQuery = {
    'bankAccount.accountNumber': accountNumber,
    'bankAccount.bankCode': bankCode,
    'bankAccount.verified': true,
    user: { $ne: req.user._id }
  }
  const [dupPharmacy, dupLab, dupDoctor] = await Promise.all([
    PharmacyPartner.findOne(dupQuery).select('_id').lean(),
    LabPartner.findOne(dupQuery).select('_id').lean(),
    Doctor.findOne(dupQuery).select('_id').lean()
  ])
  if (dupPharmacy || dupLab || dupDoctor) {
    return next(
      new AppError(
        'This bank account is already registered to another partner. Each account can only be used once.',
        409
      )
    )
  }

  // Paystack account resolution
  let resolvedName
  try {
    const resolved = await resolveAccount({ accountNumber, bankCode })
    resolvedName = resolved.account_name
  } catch (err) {
    const paystackMsg = err?.response?.data?.message
    console.error(
      '[KYC] Paystack resolveAccount failed:',
      paystackMsg ?? err?.message,
      { accountNumber, bankCode }
    )
    return next(
      new AppError(
        paystackMsg ||
          'Could not verify bank account. Check the account number and bank code, then try again.',
        422
      )
    )
  }

  // Generate 6-digit OTP and store its SHA-256 hash
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex')

  await User.findByIdAndUpdate(req.user._id, {
    pendingBankAccount: {
      accountNumber,
      accountName: resolvedName,
      bankCode,
      bankName: bankName || '',
      otpHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  })

  // Send OTP via email (non-blocking on failure so we still surface the error)
  try {
    await sendOTPEmail(req.user.email, otp)
  } catch (err) {
    console.error('[KYC] sendOTPEmail failed:', err?.message)
    return next(
      new AppError(
        'Could not send verification email. Try again in a moment.',
        502
      )
    )
  }

  sendSuccess(
    res,
    200,
    'Bank account resolved. A 6-digit code has been sent to your email — use it to confirm.',
    {
      accountName: resolvedName
    }
  )
})

// POST /api/kyc/confirm-bank
// Partner submits { pinId, otp }. Verifies OTP, re-checks duplicates, then saves.
exports.confirmBankAccount = asyncHandler(async (req, res, next) => {
  const role = req.user.role
  const allowed = ['doctor', 'pharmacy_partner', 'lab_partner']
  if (!allowed.includes(role)) {
    return next(
      new AppError(
        'Bank account verification is for partner accounts only.',
        403
      )
    )
  }

  const { otp } = req.body
  if (!otp) {
    return next(new AppError('otp is required.', 400))
  }

  const user = await User.findById(req.user._id).select('+pendingBankAccount')

  const pending = user?.pendingBankAccount
  if (!pending?.otpHash) {
    return next(
      new AppError(
        'No pending bank account found. Please start over with /verify-bank.',
        400
      )
    )
  }
  if (new Date() > pending.expiresAt) {
    return next(
      new AppError('OTP has expired. Please start over with /verify-bank.', 400)
    )
  }

  // Compare submitted OTP against stored hash
  const submittedHash = crypto
    .createHash('sha256')
    .update(String(otp))
    .digest('hex')
  if (submittedHash !== pending.otpHash) {
    return next(
      new AppError(
        'Incorrect OTP. Check the code sent to your email and try again.',
        422
      )
    )
  }

  // Re-check duplicates before saving (race condition guard)
  const dupQuery = {
    'bankAccount.accountNumber': pending.accountNumber,
    'bankAccount.bankCode': pending.bankCode,
    'bankAccount.verified': true,
    user: { $ne: req.user._id }
  }
  const [dupPharmacy, dupLab, dupDoctor] = await Promise.all([
    PharmacyPartner.findOne(dupQuery).select('_id').lean(),
    LabPartner.findOne(dupQuery).select('_id').lean(),
    Doctor.findOne(dupQuery).select('_id').lean()
  ])
  if (dupPharmacy || dupLab || dupDoctor) {
    return next(
      new AppError(
        'This bank account was registered to another partner while your OTP was pending. Please use a different account.',
        409
      )
    )
  }

  // Persist verified bank account
  const bankData = {
    bankAccount: {
      bankName: pending.bankName,
      accountNumber: pending.accountNumber,
      accountName: pending.accountName,
      bankCode: pending.bankCode,
      verified: true,
      verifiedAt: new Date()
    }
  }
  if (role === 'pharmacy_partner') {
    await PharmacyPartner.findOneAndUpdate({ user: req.user._id }, bankData)
  } else if (role === 'lab_partner') {
    await LabPartner.findOneAndUpdate({ user: req.user._id }, bankData)
  } else {
    await Doctor.findOneAndUpdate({ user: req.user._id }, bankData)
  }

  // Clear pending state
  await User.findByIdAndUpdate(req.user._id, {
    $unset: { pendingBankAccount: '' }
  })

  sendSuccess(res, 200, 'Bank account verified and saved.', {
    accountNumber: pending.accountNumber,
    accountName: pending.accountName,
    bankCode: pending.bankCode,
    bankName: pending.bankName,
    verified: true
  })
})

// â”€â”€â”€ KYC Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/kyc/status
// Returns the current KYC status for the authenticated user.
exports.getStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    'nin ninVerified kycStatus isVerified'
  )

  let details = {}
  if (req.user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user: req.user._id }).select(
      'kycStatus faceMatchVerified faceMatchScore isApproved licenseDocument'
    )
    details = { doctor }
  }
  if (['pharmacy_partner', 'lab_partner'].includes(req.user.role)) {
    const Model =
      req.user.role === 'pharmacy_partner' ? PharmacyPartner : LabPartner
    const partner = await Model.findOne({ user: req.user._id }).select(
      'cacVerified cacNumber cacRegisteredName status'
    )
    details = { partner }
  }

  sendSuccess(res, 200, 'KYC status retrieved.', { user, ...details })
})
