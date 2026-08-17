const { randomUUID } = require('crypto')
const DiagnosticsRequest = require('../models/DiagnosticsRequest')
const LabPartner = require('../models/LabPartner')
const LabResult = require('../models/LabResult')
const Payment = require('../models/Payment')
const FieldAgent = require('../models/FieldAgent')
const HomeVisitSchedule = require('../models/HomeVisitSchedule')
const User = require('../models/User')
require('../models/WellnessPackage') // ensure model registered for populate
const { uploadBuffer } = require('../services/cloudinary.service')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const { sendAdminAlertEmail } = require('../services/email.service')
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

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
      process.env.CLIENT_URL || 'http://10.0.1.44:3000'
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
  const lab = await LabPartner.findOne({ user: req.user._id })
  if (!lab) return next(new AppError('Lab partner record not found.', 404))
  sendSuccess(res, 200, 'Lab profile retrieved.', { lab })
})

exports.updateLabProfile = asyncHandler(async (req, res, next) => {
  const { name, address, phone, bankAccount } = req.body
  const update = {}
  if (name) update.name = name
  if (address) update.address = address
  if (phone) update.phone = phone
  if (bankAccount && typeof bankAccount === 'object')
    update.bankAccount = bankAccount

  const lab = await LabPartner.findOneAndUpdate(
    { user: req.user._id },
    update,
    { new: true, runValidators: true }
  )
  if (!lab) return next(new AppError('Lab partner record not found.', 404))
  sendSuccess(res, 200, 'Lab profile updated.', { lab })
})

exports.updateLabTests = asyncHandler(async (req, res, next) => {
  const { testsOffered } = req.body
  if (!Array.isArray(testsOffered))
    return next(new AppError('testsOffered must be an array.', 400))

  const lab = await LabPartner.findOneAndUpdate(
    { user: req.user._id },
    { testsOffered },
    { new: true, runValidators: true }
  )
  if (!lab) return next(new AppError('Lab partner record not found.', 404))
  sendSuccess(res, 200, 'Tests updated.', { lab })
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

  // Notify patient
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

  // Lab partners are notified AFTER payment is confirmed (in payments.controller.js verify handler).
  sendSuccess(res, 201, 'Diagnostics request submitted.', { request })
})

// Doctor orders lab tests for a patient during/after a consultation
exports.requestTestsForPatient = asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'doctor') return next(new AppError('Only doctors can order lab tests for patients.', 403))
  const { patientId, tests, notes, consultationId } = req.body
  if (!patientId) return next(new AppError('patientId is required.', 400))
  if (!Array.isArray(tests) || !tests.length) return next(new AppError('tests array is required.', 400))

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
    message: `Your doctor has ordered ${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''}. Check your Lab section to pay and proceed.`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  sendSuccess(res, 201, 'Lab tests ordered for patient.', { request })
})

exports.listLabs = asyncHandler(async (req, res) => {
  const labs = await LabPartner.find({ status: 'active' })
  sendSuccess(res, 200, 'Labs retrieved.', { labs })
})

exports.getLabRequests = asyncHandler(async (req, res) => {
  const lab = await LabPartner.findOne({ user: req.user._id })
  if (!lab)
    return sendSuccess(res, 200, 'No requests.', { available: [], mine: [] })

  // Available: paid requests not yet claimed by any lab
  const available = await DiagnosticsRequest.find({
    lab: { $exists: false },
    status: 'pending',
    paymentRef: { $exists: true }
  })
    .populate('patient', 'name phone email _id')
    .populate({ path: 'paymentRef', select: 'status amount method reference' })
    .sort({ createdAt: -1 })
    .lean()

  // Mine: requests this lab has claimed / is processing
  const mine = await DiagnosticsRequest.find({ lab: lab._id })
    .populate('patient', 'name phone email _id')
    .populate({ path: 'paymentRef', select: 'status amount method reference' })
    .sort({ createdAt: -1 })
    .lean()

  sendSuccess(res, 200, 'Lab requests retrieved.', { available, mine })
})

// Lab claims an unassigned pending request
exports.claimRequest = asyncHandler(async (req, res, next) => {
  const lab = await LabPartner.findOne({ user: req.user._id })
  if (!lab) return next(new AppError('Lab partner record not found.', 404))

  const request = await DiagnosticsRequest.findOne({
    _id: req.params.id,
    status: 'pending',
    lab: { $exists: false },
    paymentRef: { $exists: true }
  })
  if (!request)
    return next(new AppError('Request not found, unpaid, or already claimed.', 404))

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
  const request = await DiagnosticsRequest.findById(req.params.id)
  if (!request) return next(new AppError('Request not found.', 404))

  const result_file = await uploadBuffer(req.file.buffer, 'lab_results', 'auto')
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

  const enriched = requests.map(r => {
    const obj = r.toObject()
    const lr = resultMap[r._id.toString()]
    if (lr)
      obj.result = {
        fileUrl: lr.fileUrl,
        notes: lr.notes,
        createdAt: lr.createdAt
      }
    return obj
  })

  sendSuccess(res, 200, 'Results retrieved.', { requests: enriched })
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
  const lab = await LabPartner.findOne({ user: req.user._id })
  if (!lab) return next(new AppError('Lab partner record not found.', 404))

  const request = await DiagnosticsRequest.findOne({
    _id: req.params.id,
    lab: lab._id
  }).populate('patient', 'name')
  if (!request) return next(new AppError('Request not found.', 404))

  const allowed = ['assigned', 'collected', 'completed', 'no_show']
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
    status === 'collected' &&
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
  const earnings = await PartnerEarning.find({
    partner: req.user._id,
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

  const pending = await PartnerEarning.find({
    partner: req.user._id,
    partnerType: 'lab',
    payoutStatus: 'pending'
  })
  if (!pending.length)
    return next(new AppError('No pending earnings to pay out.', 400))

  const lab = await LabPartner.findOne({ user: req.user._id }).lean()
  const bankAccount = lab?.bankAccount || {}
  const ids = pending.map(e => e._id)
  const totalGross =
    Math.round(pending.reduce((s, e) => s + e.grossAmount, 0) * 100) / 100
  const totalNet =
    Math.round(pending.reduce((s, e) => s + e.netAmount, 0) * 100) / 100

  let request = await PayoutRequest.findOne({
    partner: req.user._id,
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
      partner: req.user._id,
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
