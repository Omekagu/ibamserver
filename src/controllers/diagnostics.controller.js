const { randomUUID } = require('crypto')
const DiagnosticsRequest = require('../models/DiagnosticsRequest')
const LabPartner = require('../models/LabPartner')
const LabResult = require('../models/LabResult')
const LabTest = require('../models/LabTest')
const Payment = require('../models/Payment')
const FieldAgent = require('../models/FieldAgent')
const HomeVisitSchedule = require('../models/HomeVisitSchedule')
const User = require('../models/User')
const WellnessPackage = require('../models/WellnessPackage')
const { uploadBuffer } = require('../services/cloudinary.service')
const cloudinary = require('../config/cloudinary')
const toPdf = require('../utils/toPdf')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const {
  sendAdminAlertEmail,
  sendNewLabRequestAdminEmail,
  sendWalkInAdminEmail,
  sendWalkInPatientEmail
} = require('../services/email.service')
const AuditLog = require('../models/AuditLog')
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

function signResultUrl (fileUrl, expiresAt) {
  try {
    // Only sign URLs belonging to the currently configured cloud account.
    // Files from a previous cloud (different cloud_name) are served as plain URLs.
    const currentCloud = cloudinary.config().cloud_name
    if (currentCloud && !fileUrl.includes(`/${currentCloud}/`)) return fileUrl

    // Detect resource type from the stored URL (raw or image)
    const rtMatch = fileUrl.match(/cloudinary\.com\/[^/]+\/([^/]+)\/upload\//)
    const resourceType = rtMatch?.[1] ?? 'image'
    const afterUpload = fileUrl.split('/upload/')[1] ?? ''
    const versionless = afterUpload.replace(/^v\d+\//, '')
    const extMatch = versionless.match(/\.([a-z0-9]+)$/i)
    const format = extMatch ? extMatch[1] : 'pdf'
    const publicId = versionless.replace(/\.[^/.]+$/, '')
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      format,
      sign_url: true,
      expires_at: expiresAt,
      secure: true
    })
  } catch (_) {
    return fileUrl
  }
}

async function getLabForUser (user) {
  if (user.role === 'lab_partner') return LabPartner.findOne({ user: user._id })
  if (
    user.role === 'admin' &&
    user.adminRole === 'lab_admin' &&
    user.managedLabId
  )
    return LabPartner.findById(user.managedLabId)
  return null
}

exports.listLabTests = asyncHandler(async (req, res) => {
  const tests = await LabTest.find({ isActive: true })
    .select('name category')
    .sort({ order: 1, name: 1 })
    .lean()
  sendSuccess(res, 200, 'Lab tests retrieved.', { tests })
})

exports.onboardLab = asyncHandler(async (req, res, next) => {
  const {
    name,
    address,
    phone,
    email,
    password,
    testsOffered,
    coverageAreas,
    licenseNumber
  } = req.body
  if (!name || !address || !phone || !email || !password) {
    return next(
      new AppError(
        'Name, address, phone, email and password are required.',
        400
      )
    )
  }
  const existing = await User.findOne({ email: email.toLowerCase().trim() })
  if (existing)
    return next(new AppError('An account with this email already exists.', 409))

  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    password,
    role: 'lab_partner',
    isVerified: false
  })

  const lab = await LabPartner.create({
    name,
    address,
    phone,
    email,
    licenseNumber,
    testsOffered: testsOffered || [],
    coverageAreas: coverageAreas || [],
    status: 'pending',
    user: user._id
  })

  sendAdminAlertEmail({
    subject: 'New lab partner application',
    headline: 'New Lab Application',
    body: `${name} (${email}) has applied to join as a laboratory partner and is awaiting approval.`,
    ctaLabel: 'Review Partners',
    ctaUrl: `${
      process.env.CLIENT_URL || 'https://www.ibamhealth.com'
    }/admin/partners`
  }).catch(err => console.error('[Email] Admin lab alert failed:', err.message))

  notifyAdmins({
    type: 'partner_onboarded',
    title: 'New Lab Partner Application',
    message: `${name} applied to join as a lab partner and is awaiting review.`,
    metadata: { labId: lab._id, email }
  }).catch(() => {})

  sendSuccess(
    res,
    201,
    'Lab application submitted. You will be notified once approved.',
    { lab }
  )
})

exports.getLabProfile = asyncHandler(async (req, res, next) => {
  const lab = await getLabForUser(req.user)
  if (!lab) return next(new AppError('Lab partner record not found.', 404))
  sendSuccess(res, 200, 'Lab profile retrieved.', { lab })
})

exports.updateLabProfile = asyncHandler(async (req, res, next) => {
  const { name, address, phone } = req.body
  // bankAccount is intentionally excluded — use POST /api/kyc/verify-bank instead
  const update = {}
  if (name) update.name = name
  if (address) update.address = address
  if (phone) update.phone = phone

  const existing = await getLabForUser(req.user)
  if (!existing) return next(new AppError('Lab partner record not found.', 404))
  const lab = await LabPartner.findByIdAndUpdate(existing._id, update, {
    returnDocument: 'after',
    runValidators: true
  })
  sendSuccess(res, 200, 'Lab profile updated.', { lab })
})

exports.updateLabTests = asyncHandler(async (req, res, next) => {
  const { testsOffered } = req.body
  if (!Array.isArray(testsOffered))
    return next(new AppError('testsOffered must be an array.', 400))

  const existing = await getLabForUser(req.user)
  if (!existing) return next(new AppError('Lab partner record not found.', 404))
  const lab = await LabPartner.findByIdAndUpdate(
    existing._id,
    { testsOffered },
    { returnDocument: 'after', runValidators: true }
  )
  sendSuccess(res, 200, 'Tests updated.', { lab })
})

// Full test catalog with pricing (lab portal walk-in registration)
exports.getLabTestCatalog = asyncHandler(async (req, res) => {
  const tests = await LabTest.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .lean()
  sendSuccess(res, 200, 'Lab test catalog retrieved.', { tests })
})

// Returns active wellness packages (for lab partner walk-in flow)
exports.getWellnessPackagesForLab = asyncHandler(async (req, res) => {
  const packages = await WellnessPackage.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .lean()
  sendSuccess(res, 200, 'Wellness packages retrieved.', packages)
})

// Lab creates a walk-in request on behalf of a patient (receptionist flow)
exports.createLabWalkIn = asyncHandler(async (req, res, next) => {
  const lab = await getLabForUser(req.user)
  if (!lab) return next(new AppError('Lab profile not found.', 404))

  const {
    patientName,
    patientPhone,
    patientEmail,
    tests: rawTests,
    paymentMethod,
    totalAmount: rawTotal,
    notes,
    confirmExisting,
    wellnessPackageId
  } = req.body

  if (!patientName?.trim() || !patientPhone?.trim()) {
    return next(new AppError('Patient name and phone are required.', 400))
  }

  let tests = rawTests
  let totalAmount = rawTotal
  let wellnessPkg = null
  if (wellnessPackageId) {
    wellnessPkg = await WellnessPackage.findById(wellnessPackageId)
    if (!wellnessPkg || !wellnessPkg.isActive)
      return next(new AppError('Wellness package not found.', 404))
    tests = wellnessPkg.includedTests
    totalAmount = wellnessPkg.walkInPrice
  }

  if (!Array.isArray(tests) || !tests.length) {
    return next(new AppError('At least one test must be selected.', 400))
  }

  // Search for any existing user by phone or email (no role filter —
  // the email could belong to a doctor/admin who is also a walk-in patient)
  const orConditions = []
  if (patientPhone) orConditions.push({ phone: patientPhone.trim() })
  if (patientEmail)
    orConditions.push({ email: patientEmail.toLowerCase().trim() })

  let patient = orConditions.length
    ? await User.findOne({ $or: orConditions })
    : null

  // If any account exists but staff hasn't confirmed yet, ask for confirmation
  if (patient && !confirmExisting) {
    const safeEmail = patient.email?.includes('@ibamhealth.guest')
      ? null
      : patient.email
    return sendSuccess(res, 200, 'Patient already exists.', {
      requiresConfirmation: true,
      existingPatient: {
        name: patient.name,
        email: safeEmail,
        phone: patient.phone
      }
    })
  }

  let isNewPatient = false
  let tempPassword = null

  if (!patient) {
    isNewPatient = true
    const hasRealEmail = !!patientEmail?.trim()
    const guestEmail = hasRealEmail
      ? patientEmail.toLowerCase().trim()
      : `walkin_${Date.now()}_${patientPhone
          .replace(/\D/g, '')
          .slice(-8)}@ibamhealth.guest`

    tempPassword = `Ibam@${Math.floor(100000 + Math.random() * 900000)}`

    try {
      patient = await User.create({
        name: patientName.trim(),
        email: guestEmail,
        phone: patientPhone.trim(),
        password: tempPassword,
        role: 'patient',
        isVerified: false
      })
    } catch (createErr) {
      // E11000 means email or phone is taken by a user we didn't find with our query
      // (e.g. a guest email collision). Re-query without role filter and treat as existing.
      if (createErr.code === 11000) {
        patient = await User.findOne({ $or: orConditions })
        if (!patient)
          return next(new AppError('Account conflict — please try again.', 409))
        isNewPatient = false
        tempPassword = null
      } else {
        throw createErr
      }
    }
  }

  const amountNaira = Number(totalAmount) || 0

  // Create the diagnostics request
  const request = await DiagnosticsRequest.create({
    patient: patient._id,
    lab: lab._id,
    tests,
    collectionType: 'walk_in',
    notes:
      notes?.trim() ||
      (wellnessPkg
        ? `Booked via "${wellnessPkg.name}" wellness package.`
        : undefined),
    totalAmount: amountNaira,
    requiresApproval: false,
    adminApprovalStatus: 'na',
    status: 'assigned',
    walkInExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    registeredBy: req.user._id,
    ...(wellnessPkg ? { wellnessPackage: wellnessPkg._id } : {})
  })

  // Record payment if method + amount provided — store amount in kobo (consistent with Paystack)
  const validMethods = ['walk_in_cash', 'pos', 'direct_transfer']
  if (
    paymentMethod &&
    validMethods.includes(paymentMethod) &&
    amountNaira > 0
  ) {
    const reference = `ibam_wk_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const payment = await Payment.create({
      user: patient._id,
      type: 'lab_test',
      serviceRef: request._id,
      serviceModel: 'DiagnosticsRequest',
      amount: Math.round(amountNaira * 100), // store in kobo, consistent with Paystack
      method: paymentMethod,
      reference,
      status: 'success'
    })
    request.paymentRef = payment._id
    await request.save()
  }

  const hasRealEmail =
    patient.email && !patient.email.includes('@ibamhealth.guest')

  // Notify patient — in-app notification (always) + email (if real email exists)
  createNotification({
    userId: patient._id,
    type: 'lab_request_placed',
    title: 'Lab Test Registered for You',
    message: isNewPatient
      ? `${lab.name} has registered a lab test on your behalf and created an iBam Health account for you. Please log in to verify your account and track your results.`
      : `${lab.name} has registered a lab test on your behalf. Log in to view and track your results.`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  if (hasRealEmail) {
    sendWalkInPatientEmail({
      email: patient.email,
      name: patient.name,
      labName: lab.name,
      tests,
      tempPassword: isNewPatient ? tempPassword : undefined,
      isNew: isNewPatient
    }).catch(() => {})
  }

  // Notify admins — in-app notification + email (fire-and-forget)
  notifyAdmins({
    type: 'lab_walk_in_registered',
    title: 'Walk-In Registered',
    message: `${req.user.name || 'Lab staff'} at ${lab.name} registered a walk-in for ${patient.name} (${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''}).`,
    metadata: { requestId: request._id, labId: lab._id }
  }).catch(() => {})

  User.find({ role: 'admin', adminRole: { $in: ['super_admin', 'lab_admin'] }, isActive: true })
    .select('email').lean()
    .then(admins => {
      const emails = admins.map(a => a.email).filter(Boolean)
      if (!emails.length) return
      sendWalkInAdminEmail({
        emails,
        patientName: patient.name,
        labName: lab.name,
        registeredBy: req.user.name || 'Lab Staff',
        tests,
        totalAmount: Number(totalAmount) || 0,
        paymentMethod
      })
    })
    .catch(() => {})

  // Audit log — track which lab staff registered the walk-in
  AuditLog.create({
    admin: req.user._id,
    actorRole: req.user.role,
    action: 'lab_walk_in_registered',
    targetModel: 'DiagnosticsRequest',
    targetId: request._id,
    details: {
      patientName: patient.name,
      patientPhone: patient.phone,
      tests,
      totalAmount: amountNaira,
      paymentMethod,
      labName: lab.name,
      isNewPatient,
      wellnessPackageId: wellnessPkg?._id
    },
    ipAddress: req.ip
  }).catch(() => {})

  const safeEmail = hasRealEmail ? patient.email : null
  sendSuccess(res, 201, 'Walk-in request created.', {
    request,
    patient: {
      name: patient.name,
      phone: patient.phone,
      email: safeEmail,
      isNew: isNewPatient
    },
    bookingRef: `#${request._id.toString().slice(-8).toUpperCase()}`
  })
})

exports.requestTests = asyncHandler(async (req, res, next) => {
  // Support both JSON body (tests: [...]) and FormData (tests[]: ...)
  const rawTests = req.body['tests[]'] || req.body.tests
  const tests = Array.isArray(rawTests) ? rawTests : rawTests ? [rawTests] : []
  const { collectionType, notes, preferredDate, preferredTime } = req.body
  const clientAmount = req.body.amount ? Number(req.body.amount) : 0

  if (!tests.length || !collectionType) {
    return next(
      new AppError('tests array and collectionType are required.', 400)
    )
  }

  if (
    collectionType === 'home_visit' &&
    !req.body.pickupLocation &&
    !req.body['pickupLocation']
  ) {
    // address is mandatory for home visits (validated on client; be lenient here)
  }

  let externalReferralUrl

  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, 'referrals', 'auto')
    externalReferralUrl = uploaded.secure_url
  }

  let pickupLocation
  try {
    pickupLocation = req.body.pickupLocation
      ? JSON.parse(req.body.pickupLocation)
      : undefined
  } catch {
    /* ignore */
  }

  const walkInExpiresAt =
    collectionType === 'walk_in'
      ? new Date(Date.now() + 48 * 60 * 60 * 1000)
      : undefined

  const request = await DiagnosticsRequest.create({
    patient: req.user._id,
    tests,
    collectionType,
    notes,
    totalAmount: clientAmount,
    requiresApproval: false,
    adminApprovalStatus: 'na',
    externalReferralUrl,
    pickupLocation,
    walkInExpiresAt,
    ...(collectionType === 'home_visit' && preferredDate
      ? { preferredDate: new Date(preferredDate) }
      : {}),
    ...(collectionType === 'home_visit' && preferredTime
      ? { preferredTime }
      : {})
  })

  // Only notify patient immediately for free requests; paid requests are confirmed after payment verify
  if (clientAmount === 0) {
    createNotification({
      userId: req.user._id,
      type: 'lab_request_placed',
      title: 'Lab Test Request Submitted',
      message: `Your request for ${tests.slice(0, 2).join(', ')}${
        tests.length > 2 ? ` +${tests.length - 2} more` : ''
      } has been submitted. Our lab team will process it shortly.`,
      metadata: { requestId: request._id },
      emailData: { tests, collectionType }
    }).catch(err =>
      console.error('[Notification] Lab request placed:', err.message)
    )
  }

  // Lab partners are notified AFTER payment is confirmed (in payments.controller.js verify handler).

  // Notify all super_admins and lab_admins — in-app + email (fire-and-forget)
  notifyAdmins({
    type: 'lab_request_placed',
    title: 'New Lab Test Request',
    message: `${req.user.name || 'A patient'} submitted a ${collectionType === 'home_visit' ? 'home visit' : 'walk-in'} request for ${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''}.`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  User.find({
    role: 'admin',
    adminRole: { $in: ['super_admin', 'lab_admin'] },
    isActive: true
  })
    .select('email')
    .lean()
    .then(admins => {
      const emails = admins.map(a => a.email).filter(Boolean)
      if (!emails.length) return
      sendNewLabRequestAdminEmail({
        emails,
        patientName: req.user.name,
        tests,
        collectionType,
        requestId: request._id
      })
    })
    .catch(() => {})

  sendSuccess(res, 201, 'Diagnostics request submitted.', { request })
})

// Doctor orders lab tests for a patient during/after a consultation
exports.requestTestsForPatient = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'doctor')
    return next(
      new AppError('Only doctors can order lab tests for patients.', 403)
    )
  const { patientId, tests, notes, consultationId } = req.body
  if (!patientId) return next(new AppError('patientId is required.', 400))
  if (!Array.isArray(tests) || !tests.length)
    return next(new AppError('tests array is required.', 400))

  const request = await DiagnosticsRequest.create({
    patient: patientId,
    doctor: req.user._id,
    tests,
    collectionType: 'walk_in',
    notes,
    totalAmount: 0,
    requiresApproval: false,
    adminApprovalStatus: 'na',
    ...(consultationId ? { consultation: consultationId } : {})
  })

  createNotification({
    userId: patientId,
    type: 'lab_request_placed',
    title: 'Lab Tests Ordered',
    message: `Your doctor has ordered ${tests.slice(0, 2).join(', ')}${
      tests.length > 2 ? ` +${tests.length - 2} more` : ''
    }. Check your Lab section to pay and proceed.`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  sendSuccess(res, 201, 'Lab tests ordered for patient.', { request })
})

exports.cancelMyRequest = asyncHandler(async (req, res, next) => {
  const request = await DiagnosticsRequest.findOne({
    _id: req.params.id,
    patient: req.user._id
  })
  if (!request) return next(new AppError('Request not found.', 404))
  if (request.paymentRef)
    return next(new AppError('Cannot cancel a paid request.', 400))
  await request.deleteOne()
  sendSuccess(res, 200, 'Request cancelled.', {})
})

exports.listLabs = asyncHandler(async (req, res) => {
  const labs = await LabPartner.find({ status: 'active' })
  sendSuccess(res, 200, 'Labs retrieved.', { labs })
})

exports.getLabRequests = asyncHandler(async (req, res) => {
  const lab = await getLabForUser(req.user)
  if (!lab)
    return sendSuccess(res, 200, 'No requests.', { available: [], mine: [] })

  // Available: paid requests not yet claimed by any lab
  const available = await DiagnosticsRequest.find({
    lab: { $exists: false },
    status: 'pending',
    paymentRef: { $exists: true }
  })
    .populate('patient', 'name phone email _id')
    .populate({
      path: 'paymentRef',
      select: 'status amount method reference transferReference'
    })
    .sort({ createdAt: -1 })
    .lean()

  // Mine: requests this lab has claimed / is processing
  const mine = await DiagnosticsRequest.find({ lab: lab._id })
    .populate('patient', 'name phone email _id')
    .populate({
      path: 'paymentRef',
      select: 'status amount method reference transferReference'
    })
    .sort({ createdAt: -1 })
    .lean()

  // Attach uploaded results so the lab portal can show download links
  const resultDocs = await LabResult.find({
    request: { $in: mine.map(r => r._id) }
  })
    .select('request fileUrl notes createdAt')
    .lean()
  const resultMap = Object.fromEntries(
    resultDocs.map(r => [r.request.toString(), r])
  )

  const expiresAt = Math.floor(Date.now() / 1000) + 7200
  const mineWithResults = mine.map(r => {
    const result = resultMap[r._id.toString()] ?? null
    if (result?.fileUrl)
      result.signedUrl = signResultUrl(result.fileUrl, expiresAt)
    return { ...r, result }
  })

  sendSuccess(res, 200, 'Lab requests retrieved.', {
    available,
    mine: mineWithResults
  })
})

// Lab claims an unassigned pending request
exports.claimRequest = asyncHandler(async (req, res, next) => {
  const lab = await getLabForUser(req.user)
  if (!lab) return next(new AppError('Lab partner record not found.', 404))

  const request = await DiagnosticsRequest.findOne({
    _id: req.params.id,
    status: 'pending',
    lab: { $exists: false },
    paymentRef: { $exists: true }
  })
  if (!request)
    return next(
      new AppError('Request not found, unpaid, or already claimed.', 404)
    )

  request.lab = lab._id
  request.status = 'assigned'
  await request.save()

  createNotification({
    userId: request.patient,
    type: 'lab_request_placed',
    title: 'Lab Request Picked Up',
    message: `${
      lab.name
    } has picked up your lab request and will process it shortly.${
      request.collectionType === 'home_visit'
        ? ' They will contact you to confirm your home visit schedule.'
        : ''
    }`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  sendSuccess(res, 200, 'Request claimed successfully.', { request })
})

exports.assignLab = asyncHandler(async (req, res, next) => {
  const { labId } = req.body
  const request = await DiagnosticsRequest.findById(req.params.id)
  if (!request) return next(new AppError('Request not found.', 404))

  request.lab = labId
  request.status = 'assigned'
  await request.save()
  sendSuccess(res, 200, 'Lab assigned.', { request })
})

exports.uploadResult = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No file uploaded.', 400))
  const allowed = ['image/jpeg', 'image/png', 'application/pdf']
  if (!allowed.includes(req.file.mimetype))
    return next(
      new AppError(
        'Only JPEG, PNG, or PDF files are accepted for results.',
        400
      )
    )

  const request = await DiagnosticsRequest.findById(req.params.id)
  if (!request) return next(new AppError('Request not found.', 404))

  const pdfBuffer = await toPdf(req.file.buffer, req.file.mimetype)
  let result_file
  try {
    result_file = await uploadBuffer(pdfBuffer, 'lab_results', 'auto')
  } catch (uploadErr) {
    console.error(
      '[uploadResult] Cloudinary error:',
      uploadErr?.message ?? uploadErr
    )
    console.error(
      '[uploadResult] Cloudinary error detail:',
      JSON.stringify(uploadErr, null, 2)
    )
    return next(
      new AppError('Failed to upload result file. Please try again.', 502)
    )
  }
  const result = await LabResult.create({
    request: req.params.id,
    fileUrl: result_file.secure_url,
    uploadedBy: req.user._id,
    notes: req.body.notes
  })

  request.status = 'completed'
  await request.save()

  await createNotification({
    userId: request.patient,
    type: 'lab_result_ready',
    title: 'Lab Result Ready',
    message: 'Your lab test results are now available.',
    metadata: { requestId: request._id, resultId: result._id },
    emailData: { tests: (request.tests || []).map(t => t.name || String(t)) }
  })

  sendSuccess(res, 201, 'Result uploaded.', { result })
})

exports.getMyResults = asyncHandler(async (req, res) => {
  const requests = await DiagnosticsRequest.find({ patient: req.user._id })
    .populate('lab', 'name')
    .populate('wellnessPackage', 'name')
    .populate({
      path: 'paymentRef',
      select: 'amount method status transferReference reference createdAt'
    })
    .sort({ createdAt: -1 })

  const requestIds = requests.map(r => r._id)
  const labResults = await LabResult.find({
    request: { $in: requestIds }
  }).lean()

  const resultMap = {}
  for (const lr of labResults) resultMap[lr.request.toString()] = lr

  const resultExpiresAt = Math.floor(Date.now() / 1000) + 7200
  const enriched = requests.map(r => {
    const obj = r.toObject()
    const lr = resultMap[r._id.toString()]
    if (lr) {
      obj.result = {
        fileUrl: lr.fileUrl,
        signedUrl: signResultUrl(lr.fileUrl, resultExpiresAt),
        notes: lr.notes,
        createdAt: lr.createdAt
      }
    }
    return obj
  })

  sendSuccess(res, 200, 'Results retrieved.', {
    requests: enriched,
    results: labResults
  })
})

exports.scheduleHomeVisit = asyncHandler(async (req, res, next) => {
  const { agentId, scheduledAt, address, coordinates } = req.body
  const request = await DiagnosticsRequest.findById(req.params.id)
  if (!request) return next(new AppError('Request not found.', 404))
  if (request.collectionType !== 'home_visit') {
    return next(new AppError('This request is not a home visit.', 400))
  }

  const agent = await FieldAgent.findById(agentId)
  if (!agent || agent.status !== 'available') {
    return next(new AppError('Field agent not available.', 400))
  }

  const visit = await HomeVisitSchedule.create({
    request: request._id,
    agent: agentId,
    patient: request.patient,
    address,
    coordinates,
    scheduledAt: new Date(scheduledAt)
  })

  agent.status = 'busy'
  request.fieldAgent = agentId
  request.status = 'assigned'
  await Promise.all([agent.save(), request.save()])

  await createNotification({
    userId: request.patient,
    type: 'home_visit_scheduled',
    title: 'Home Visit Scheduled',
    message: `A lab professional will visit you on ${new Date(
      scheduledAt
    ).toDateString()}.`,
    metadata: { visitId: visit._id },
    emailData: { scheduledAt }
  })

  sendSuccess(res, 201, 'Home visit scheduled.', { visit })
})

exports.markSampleCollected = asyncHandler(async (req, res, next) => {
  const { paymentMethod, transferReference } = req.body

  const visit = await HomeVisitSchedule.findOne({ request: req.params.id })
  if (!visit) return next(new AppError('Home visit not found.', 404))

  const agent = await FieldAgent.findById(visit.agent)
  if (agent.user.toString() !== req.user._id.toString()) {
    return next(
      new AppError('Only the assigned field agent can mark collection.', 403)
    )
  }

  visit.status = 'collected'
  await visit.save()

  const request = await DiagnosticsRequest.findById(req.params.id)
  request.status = 'sample_collected'

  // Record on-spot payment collected by the field agent
  if (!request.paymentRef && request.totalAmount > 0 && paymentMethod) {
    const validMethods = ['walk_in_cash', 'direct_transfer', 'pos']
    if (validMethods.includes(paymentMethod)) {
      const reference = `ibam_hv_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const payment = await Payment.create({
        user: request.patient,
        amount: request.totalAmount * 100,
        reference,
        type: request.wellnessPackage ? 'wellness_package' : 'lab_test',
        method: paymentMethod,
        serviceRef: request._id,
        status: paymentMethod === 'direct_transfer' ? 'pending' : 'success',
        ...(transferReference ? { transferReference } : {})
      })
      request.paymentRef = payment._id
    }
  }

  await request.save()

  if (agent) {
    agent.status = 'available'
    await agent.save()
  }

  createNotification({
    userId: request.patient,
    type: 'sample_collected',
    title: 'Sample Collected',
    message:
      'Your sample has been collected and is being processed in the lab.',
    metadata: { requestId: request._id },
    emailData: { tests: request.tests || [] }
  }).catch(err =>
    console.error('[Notification] Sample collected:', err.message)
  )

  sendSuccess(res, 200, 'Sample collection confirmed.', { visit })
})

exports.updateLabRequestStatus = asyncHandler(async (req, res, next) => {
  const { status, resultNotes, paymentMethod, transferReference } = req.body
  const lab = await getLabForUser(req.user)
  if (!lab) return next(new AppError('Lab partner record not found.', 404))

  const request = await DiagnosticsRequest.findOne({
    _id: req.params.id,
    lab: lab._id
  }).populate('patient', 'name')
  if (!request) return next(new AppError('Request not found.', 404))

  const allowed = [
    'assigned',
    'sample_collected',
    'processing',
    'completed',
    'no_show'
  ]
  if (!allowed.includes(status))
    return next(
      new AppError(`Status must be one of: ${allowed.join(', ')}.`, 400)
    )

  if (status === 'no_show') {
    request.status = 'no_show'
    request.noShowAt = new Date()
    await request.save()

    createNotification({
      userId: request.patient,
      type: 'lab_request_placed',
      title: 'Walk-in Marked as No Show',
      message:
        'You were marked as a no-show for your lab test walk-in. Please contact us to reschedule.',
      metadata: { requestId: request._id }
    }).catch(() => {})

    notifyAdmins({
      type: 'lab_request_placed',
      title: 'Walk-in No Show',
      message: `A patient did not show up for their walk-in lab test (Request #${request._id}).`,
      metadata: { requestId: request._id }
    }).catch(() => {})

    return sendSuccess(res, 200, 'Request marked as no show.', { request })
  }

  // Record on-spot payment when home visit sample is collected
  if (
    status === 'sample_collected' &&
    request.collectionType === 'home_visit' &&
    !request.paymentRef &&
    request.totalAmount > 0 &&
    paymentMethod
  ) {
    const validMethods = ['walk_in_cash', 'direct_transfer', 'pos']
    if (!validMethods.includes(paymentMethod)) {
      return next(
        new AppError(
          'paymentMethod must be walk_in_cash, direct_transfer, or pos.',
          400
        )
      )
    }
    const reference = `ibam_hv_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const payment = await Payment.create({
      user: request.patient,
      amount: request.totalAmount * 100,
      reference,
      type: request.wellnessPackage ? 'wellness_package' : 'lab_test',
      method: paymentMethod,
      serviceRef: request._id,
      status: paymentMethod === 'direct_transfer' ? 'pending' : 'success',
      ...(transferReference ? { transferReference } : {})
    })
    request.paymentRef = payment._id
  }

  request.status = status
  if (resultNotes) request.resultNotes = resultNotes
  await request.save()

  if (status === 'completed') {
    await createNotification({
      userId: request.patient,
      type: 'lab_result_ready',
      title: 'Lab Result Ready',
      message: 'Your lab test results are now available.',
      metadata: { requestId: request._id },
      emailData: { tests: request.tests || [] }
    })
  }

  sendSuccess(res, 200, 'Request status updated.', { request })
})

exports.getLabEarnings = asyncHandler(async (req, res) => {
  const PartnerEarning = require('../models/PartnerEarning')
  const lab = await getLabForUser(req.user)
  const partnerId = lab?.user ?? req.user._id
  const earnings = await PartnerEarning.find({
    partner: partnerId,
    partnerType: 'lab'
  }).sort({ createdAt: -1 })
  const totals = earnings.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount
      acc.net += e.netAmount
      acc.pending += e.payoutStatus === 'pending' ? e.netAmount : 0
      return acc
    },
    { gross: 0, net: 0, pending: 0 }
  )
  sendSuccess(res, 200, 'Earnings retrieved.', { earnings, totals })
})

exports.requestLabPayout = asyncHandler(async (req, res, next) => {
  const PartnerEarning = require('../models/PartnerEarning')
  const PayoutRequest = require('../models/PayoutRequest')

  const lab = await getLabForUser(req.user)
  const partnerId = lab?.user ?? req.user._id

  const pending = await PartnerEarning.find({
    partner: partnerId,
    partnerType: 'lab',
    payoutStatus: 'pending'
  })
  if (!pending.length)
    return next(new AppError('No pending earnings to pay out.', 400))

  const bankAccount = lab?.bankAccount || {}
  const ids = pending.map(e => e._id)
  const totalGross =
    Math.round(pending.reduce((s, e) => s + e.grossAmount, 0) * 100) / 100
  const totalNet =
    Math.round(pending.reduce((s, e) => s + e.netAmount, 0) * 100) / 100

  let request = await PayoutRequest.findOne({
    partner: partnerId,
    status: 'requested'
  })
  if (request) {
    request.earningIds.push(...ids)
    request.totalGross =
      Math.round((request.totalGross + totalGross) * 100) / 100
    request.totalNet = Math.round((request.totalNet + totalNet) * 100) / 100
    if (bankAccount.accountNumber) request.bankAccount = bankAccount
    await request.save()
  } else {
    request = await PayoutRequest.create({
      partner: partnerId,
      partnerType: 'lab',
      partnerName: lab?.name || req.user.name,
      earningIds: ids,
      totalGross,
      totalNet,
      bankAccount,
      requestedAt: new Date()
    })
  }

  await PartnerEarning.updateMany(
    { _id: { $in: ids } },
    { payoutStatus: 'requested', payoutRequestedAt: new Date() }
  )

  notifyAdmins({
    type: 'payout_requested',
    title: 'Lab Payout Request',
    message: `${
      req.user.name
    } (lab) requested a payout of ₦${totalNet.toLocaleString('en-NG')}.`,
    metadata: { partnerId: req.user._id, amount: totalNet, partnerType: 'lab' }
  }).catch(() => {})

  sendSuccess(res, 200, 'Payout requested.', {
    totalRequested: totalNet,
    count: pending.length
  })
})

exports.getAgentSchedule = asyncHandler(async (req, res) => {
  const agent = await FieldAgent.findOne({ user: req.user._id })
  if (!agent) return sendSuccess(res, 200, 'No schedule found.', { visits: [] })

  const visits = await HomeVisitSchedule.find({
    agent: agent._id,
    status: { $in: ['scheduled', 'en_route', 'arrived'] }
  })
    .populate('patient', 'name phone')
    .sort({ scheduledAt: 1 })
  sendSuccess(res, 200, 'Agent schedule retrieved.', { visits })
})
