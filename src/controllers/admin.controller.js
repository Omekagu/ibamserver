const User = require('../models/User')
const Doctor = require('../models/Doctor')
const Patient = require('../models/Patient')
const Specialization = require('../models/Specialization')
const PlatformService = require('../models/PlatformService')
const LabTest = require('../models/LabTest')
const WellnessPackage = require('../models/WellnessPackage')
const Appointment = require('../models/Appointment')
const Consultation = require('../models/Consultation')
const Message = require('../models/Message')
const DiagnosticsRequest = require('../models/DiagnosticsRequest')
const LabResult = require('../models/LabResult')
const PharmacyOrder = require('../models/PharmacyOrder')
const Payment = require('../models/Payment')
const Subscription = require('../models/Subscription')
const DoctorEarning = require('../models/DoctorEarning')
const PartnerEarning = require('../models/PartnerEarning')
const LabPartner = require('../models/LabPartner')
const PharmacyPartner = require('../models/PharmacyPartner')
const AuditLog = require('../models/AuditLog')
const Triage = require('../models/Triage')
const PlatformSettings = require('../models/PlatformSettings')
const SubscriptionPlan = require('../models/SubscriptionPlan')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const { sendPushNotifications } = require('../services/push.service')
const {
  sendBroadcastEmail,
  sendAdminAlertEmail,
  sendAccountCreatedEmail,
  sendOTPEmail,
  sendWalkInPatientEmail,
  sendWalkInAdminEmail
} = require('../services/email.service')
const { getPaymentGateway } = require('../services/payment.gateway')
const crypto = require('crypto')

// Silently attempt auto-payout for partner earnings on manual confirm
async function tryAutoPartnerPayout (earning, partnerType) {
  try {
    const settings = await PlatformSettings.findOne().lean()
    const provider = settings?.paymentProvider || process.env.PAYMENT_PROVIDER || 'paystack'
    if (provider === 'paystack') {
      if (!settings?.paystackEnabled) return
      const key = settings.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY
      if (!key) return
    } else {
      if (!settings?.monnifyEnabled) return
      const apiKey = settings.monnifyApiKey || process.env.MONNIFY_API_KEY
      if (!apiKey) return
    }
    const Profile = partnerType === 'pharmacy' ? PharmacyPartner : LabPartner
    const profile = await Profile.findOne({ user: earning.partner }).lean()
    const bank = profile?.bankAccount
    if (!bank?.accountNumber || !bank?.bankCode) return
    const gateway = await getPaymentGateway()
    const recipient = await gateway.createTransferRecipient({
      name: bank.accountName || earning.partnerName || 'Partner',
      accountNumber: bank.accountNumber,
      bankCode: bank.bankCode
    })
    await gateway.initiateTransfer({
      amount: earning.netAmount,
      recipient: recipient.recipient_code,
      reason: `iBam Health payout – ${earning.partnerName || partnerType}`
    })
    await PartnerEarning.findByIdAndUpdate(earning._id, {
      payoutStatus: 'paid',
      paidAt: new Date()
    })
  } catch {
    /* non-fatal */
  }
}
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

// Write an audit record silently — never throws.
function logAction (adminUser, action, targetModel, targetId, details, req) {
  AuditLog.create({
    admin: adminUser._id,
    action,
    targetModel: targetModel || undefined,
    targetId: targetId || undefined,
    details: details || undefined,
    ipAddress:
      req?.ip ||
      (Array.isArray(req?.headers?.['x-forwarded-for'])
        ? req.headers['x-forwarded-for'][0]
        : req?.headers?.['x-forwarded-for']) ||
      undefined
  }).catch(() => {})
}

exports.getDashboard = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalDoctors,
    totalAppointments,
    revenueByType,
    activeSubscriptions
  ] = await Promise.all([
    User.countDocuments(),
    Doctor.countDocuments({ isApproved: true }),
    Appointment.countDocuments(),
    Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } }
    ]),
    Subscription.countDocuments({ status: 'active' })
  ])

  const revenue = {
    total: 0,
    consultation: 0,
    pharmacy: 0,
    lab_test: 0,
    subscription: 0,
    wellness_package: 0
  }
  for (const r of revenueByType) {
    revenue.total += r.total
    if (r._id && r._id in revenue) revenue[r._id] = r.total
  }

  sendSuccess(res, 200, 'Dashboard stats retrieved.', {
    totalUsers,
    totalDoctors,
    totalAppointments,
    totalRevenue: revenue.total,
    revenue,
    activeSubscriptions
  })
})

exports.getDoctors = asyncHandler(async (req, res) => {
  const { approved, page = 1, limit = 20 } = req.query
  const filter = {}
  if (approved !== undefined) filter.isApproved = approved === 'true'

  const doctors = await Doctor.find(filter)
    .populate('user', 'name email phone isActive')
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Doctor.countDocuments(filter)
  sendSuccess(res, 200, 'Doctors retrieved.', { doctors, total })
})

exports.approveDoctor = asyncHandler(async (req, res, next) => {
  const { isApproved = true } = req.body
  const doctor = await Doctor.findById(req.params.id)
  if (!doctor) return next(new AppError('Doctor not found.', 404))

  doctor.isApproved = isApproved
  if (isApproved) {
    doctor.approvedBy = req.user._id
    doctor.approvedAt = new Date()
    doctor.kycStatus = 'approved'
  } else {
    doctor.kycStatus = 'rejected'
  }
  await doctor.save()

  // Mirror status on the User so GET /kyc/status reflects approval immediately
  await User.findByIdAndUpdate(doctor.user, {
    kycStatus: isApproved ? 'approved' : 'rejected'
  })

  await createNotification({
    userId: doctor.user,
    type: isApproved ? 'doctor_approved' : 'doctor_rejected',
    title: isApproved ? 'Account Approved' : 'Application Rejected',
    message: isApproved
      ? 'Your doctor account has been approved. You can now receive appointments.'
      : 'Your doctor account application has been reviewed and was not approved. Please contact support for more information.',
    emailData: {}
  })

  // When rejecting: alert admins if this doctor has unresolved earnings (patients may need refunds)
  if (!isApproved) {
    const unresolvedEarnings = await DoctorEarning.find({
      doctor: doctor.user,
      payoutStatus: { $in: ['pending', 'requested'] }
    }).lean()
    if (unresolvedEarnings.length) {
      const totalGross = unresolvedEarnings.reduce(
        (s, e) => s + e.grossAmount,
        0
      )
      const doctorUser = await User.findById(doctor.user)
        .select('name email')
        .lean()
      notifyAdmins({
        type: 'refund_alert',
        title: 'Rejected Doctor  Refund Review Required',
        message: `Dr. ${doctorUser?.name ?? 'Unknown'} (${
          doctorUser?.email ?? ''
        }) was rejected but has ${
          unresolvedEarnings.length
        } unresolved earning(s) totalling ₦${totalGross.toLocaleString(
          'en-NG'
        )}. Review consultations and process patient refunds if applicable.`,
        metadata: {
          doctorUserId: doctor.user,
          earningCount: unresolvedEarnings.length,
          totalGross
        }
      }).catch(() => {})
      sendAdminAlertEmail({
        subject: `Refund Review  Rejected Dr. ${doctorUser?.name ?? ''}`,
        headline: 'Rejected Doctor Has Unresolved Earnings',
        body: `Dr. ${doctorUser?.name ?? 'Unknown'} (${
          doctorUser?.email ?? ''
        }) has been rejected but has ${
          unresolvedEarnings.length
        } consultation earning(s) totalling ₦${totalGross.toLocaleString(
          'en-NG'
        )} in a pending/requested state.\n\nPlease review the associated consultations and determine whether patient refunds are required.`,
        ctaLabel: 'Review Payouts',
        ctaUrl: `${
          process.env.CLIENT_URL || 'https://ibamhealth.com'
        }/admin/payouts`
      }).catch(() => {})
    }
  }

  logAction(
    req.user,
    isApproved ? 'Approved doctor' : 'Rejected doctor',
    'Doctor',
    doctor._id,
    { isApproved },
    req
  )
  sendSuccess(res, 200, isApproved ? 'Doctor approved.' : 'Doctor rejected.', {
    doctor
  })
})

exports.getUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 50, search } = req.query
  const filter = {}
  if (role && role !== 'all') filter.role = role
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { name: new RegExp(escaped, 'i') },
      { email: new RegExp(escaped, 'i') },
      { phone: new RegExp(escaped, 'i') }
    ]
  }
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await User.countDocuments(filter)
  sendSuccess(res, 200, 'Users retrieved.', { users, total })
})

exports.getUserProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).lean()
  if (!user) return next(new AppError('User not found.', 404))

  let profile = null
  if (user.role === 'doctor') {
    profile = await Doctor.findOne({ user: user._id })
      .populate('user', 'name email phone')
      .lean()
  } else if (user.role === 'pharmacy_partner') {
    profile = await PharmacyPartner.findOne({ user: user._id }).lean()
  } else if (user.role === 'lab_partner') {
    profile = await LabPartner.findOne({ user: user._id }).lean()
  }

  sendSuccess(res, 200, 'User profile retrieved.', { user, profile })
})

exports.suspendUser = asyncHandler(async (req, res, next) => {
  const { isActive } = req.body
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: isActive ?? false },
    { returnDocument: 'after' }
  )
  if (!user) return next(new AppError('User not found.', 404))
  sendSuccess(res, 200, 'User updated.', { user })
})

exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id)
  if (!user) return next(new AppError('User not found.', 404))
  if (['admin', 'lab_scientist'].includes(user.role))
    return next(
      new AppError(
        'Use the staff management section to delete staff accounts.',
        400
      )
    )
  if (user.role === 'doctor') await Doctor.findOneAndDelete({ user: user._id })
  else if (user.role === 'patient')
    await Patient.findOneAndDelete({ user: user._id })
  await User.findByIdAndDelete(user._id)
  logAction(
    req.user,
    'Deleted user account',
    'User',
    user._id,
    { email: user.email, role: user.role },
    req
  )
  sendSuccess(res, 200, 'User permanently deleted.')
})

exports.getAppointments = asyncHandler(async (req, res) => {
  const { status, doctorId, patientId, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status
  if (doctorId) filter.doctor = doctorId
  if (patientId) filter.patient = patientId

  const appointments = await Appointment.find(filter)
    .populate('patient', 'name')
    .populate('doctor', 'name')
    .sort({ scheduledAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Appointment.countDocuments(filter)
  sendSuccess(res, 200, 'Appointments retrieved.', { appointments, total })
})

exports.getPayments = asyncHandler(async (req, res) => {
  const { status, type, method, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status
  if (type) filter.type = type
  if (method) filter.method = method

  const payments = await Payment.find(filter)
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Payment.countDocuments(filter)
  sendSuccess(res, 200, 'Payments retrieved.', { payments, total })
})

exports.confirmPayment = asyncHandler(async (req, res, next) => {
  const { adminNotes } = req.body
  const payment = await Payment.findById(req.params.id)
  if (!payment) return next(new AppError('Payment not found.', 404))
  if (payment.status === 'success')
    return next(new AppError('Payment is already confirmed.', 400))

  payment.status = 'success'
  if (adminNotes) payment.adminNotes = adminNotes
  await payment.save()

  // Confirm the related service record
  if (payment.type === 'consultation' && payment.serviceRef) {
    const appt = await Appointment.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'confirmed' },
      { returnDocument: 'after' }
    )
    if (appt) {
      const Availability = require('../models/Availability')
      const scheduledDate = new Date(appt.scheduledAt)
      const slotTime = `${String(scheduledDate.getHours()).padStart(
        2,
        '0'
      )}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`
      await Availability.findOneAndUpdate(
        { doctor: appt.doctor, isActive: true, 'slots.startTime': slotTime },
        { $set: { 'slots.$.isBooked': true } }
      )
    }
  }
  if (payment.type === 'pharmacy' && payment.serviceRef) {
    const order = await PharmacyOrder.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'processing' },
      { returnDocument: 'after' }
    ).populate('pharmacy', 'user name')
    if (order?.pharmacy?.user) {
      const gross = payment.amount / 100
      const cut = Math.round(gross * 0.1 * 100) / 100
      const earning = await PartnerEarning.create({
        partner: order.pharmacy.user,
        partnerType: 'pharmacy',
        partnerName: order.pharmacy.name,
        serviceRef: payment.serviceRef,
        grossAmount: gross,
        platformCut: cut,
        netAmount: gross - cut
      })
      tryAutoPartnerPayout(earning, 'pharmacy')
    }
  }
  if (payment.type === 'lab_test' && payment.serviceRef) {
    const diagReq = await DiagnosticsRequest.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'assigned' },
      { returnDocument: 'after' }
    ).populate('lab', 'user name')
    if (diagReq?.lab?.user) {
      const gross = payment.amount / 100
      const cut = Math.round(gross * 0.1 * 100) / 100
      const earning = await PartnerEarning.create({
        partner: diagReq.lab.user,
        partnerType: 'lab',
        partnerName: diagReq.lab.name,
        serviceRef: payment.serviceRef,
        grossAmount: gross,
        platformCut: cut,
        netAmount: gross - cut
      })
      tryAutoPartnerPayout(earning, 'lab')
    }
  }

  const typeLabels = {
    consultation: 'Doctor Appointment',
    pharmacy: 'Pharmacy Order',
    lab_test: 'Lab Test',
    subscription: 'Subscription'
  }
  // Notify the user
  await createNotification({
    userId: payment.user,
    type: 'payment_success',
    title: 'Payment Confirmed',
    message: `Your bank transfer of ₦${(
      payment.amount / 100
    ).toLocaleString()} has been confirmed by admin.`,
    metadata: { paymentId: payment._id },
    emailData: {
      amount: payment.amount / 100,
      description: typeLabels[payment.type] || payment.type
    }
  })

  logAction(
    req.user,
    'Confirmed manual payment',
    'Payment',
    payment._id,
    { type: payment.type, amount: payment.amount, adminNotes },
    req
  )
  sendSuccess(res, 200, 'Payment confirmed.', { payment })
})

exports.getPayouts = asyncHandler(async (req, res) => {
  const PayoutRequest = require('../models/PayoutRequest')
  const { status, type } = req.query
  const results = []

  // Doctor earnings (individual records, still using DoctorEarning)
  if (!type || type === 'doctor') {
    const filter = {}
    if (status) filter.payoutStatus = status
    const docs = await DoctorEarning.find(filter)
      .populate('doctor', 'name email')
      .populate({
        path: 'doctor',
        populate: { path: 'doctor', model: 'Doctor', select: 'bankAccount' }
      })
      .sort({ createdAt: -1 })
    const doctorProfiles = await Doctor.find({
      user: { $in: docs.map(d => d.doctor?._id).filter(Boolean) }
    }).lean()
    const bankMap = {}
    doctorProfiles.forEach(p => {
      bankMap[String(p.user)] = p.bankAccount
    })
    docs.forEach(e => {
      results.push({
        _id: e._id,
        partnerType: 'doctor',
        partnerName: e.doctor?.name,
        partnerEmail: e.doctor?.email,
        totalGross: e.grossAmount,
        platformCut: e.platformCut,
        totalNet: e.netAmount,
        bankAccount: bankMap[String(e.doctor?._id)] || null,
        payoutStatus: e.payoutStatus,
        requestedAt: e.payoutRequestedAt,
        paidAt: e.paidAt,
        createdAt: e.createdAt,
        isDoctor: true
      })
    })
  }

  // Pharmacy & lab  use consolidated PayoutRequests
  if (!type || type === 'pharmacy' || type === 'lab') {
    const filter = {}
    if (status) filter.status = status
    if (type === 'pharmacy') filter.partnerType = 'pharmacy'
    else if (type === 'lab') filter.partnerType = 'lab'
    const requests = await PayoutRequest.find(filter)
      .populate('partner', 'name email')
      .sort({ requestedAt: -1 })
    requests.forEach(r => {
      results.push({
        _id: r._id,
        partnerType: r.partnerType,
        partnerName: r.partnerName || r.partner?.name,
        partnerEmail: r.partner?.email,
        totalGross: r.totalGross,
        platformCut: Math.round((r.totalGross - r.totalNet) * 100) / 100,
        totalNet: r.totalNet,
        bankAccount: r.bankAccount,
        payoutStatus: r.status,
        requestedAt: r.requestedAt,
        paidAt: r.processedAt,
        createdAt: r.requestedAt,
        isDoctor: false,
        earningCount: r.earningIds?.length ?? 0
      })
    })
  }

  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  sendSuccess(res, 200, 'Payouts retrieved.', { earnings: results })
})

// GET /admin/earnings — per-transaction earning history across all partner types
exports.getEarningHistory = asyncHandler(async (req, res) => {
  const { type, status, from, to, page = 1, limit = 50 } = req.query

  const dateFilter = {}
  if (from) dateFilter.$gte = new Date(from)
  if (to) dateFilter.$lte = new Date(to)

  const rows = []

  // ── Doctor earnings (per consultation) ──────────────────────────────────
  if (!type || type === 'doctor') {
    const filter = {}
    if (status) filter.payoutStatus = status
    if (from || to) filter.createdAt = dateFilter
    const docs = await DoctorEarning.find(filter)
      .populate('doctor', 'name email')
      .sort({ createdAt: -1 })
      .lean()
    for (const e of docs) {
      rows.push({
        _id: String(e._id),
        serviceType: 'consultation',
        partnerType: 'doctor',
        partnerName: e.doctor?.name ?? '—',
        partnerEmail: e.doctor?.email ?? '',
        grossAmount: e.grossAmount,
        platformCut: e.platformCut,
        platformPct: e.grossAmount
          ? Math.round((e.platformCut / e.grossAmount) * 100)
          : 0,
        netAmount: e.netAmount,
        payoutStatus: e.payoutStatus,
        createdAt: e.createdAt,
        requestedAt: e.payoutRequestedAt ?? null,
        paidAt: e.paidAt ?? null
      })
    }
  }

  // ── Pharmacy & lab earnings (per order/request) ──────────────────────────
  if (!type || type === 'pharmacy' || type === 'lab') {
    const filter = {}
    if (status) filter.payoutStatus = status
    if (type === 'pharmacy') filter.partnerType = 'pharmacy'
    if (type === 'lab') filter.partnerType = 'lab'
    if (from || to) filter.createdAt = dateFilter
    const docs = await PartnerEarning.find(filter)
      .populate('partner', 'name email')
      .sort({ createdAt: -1 })
      .lean()
    for (const e of docs) {
      rows.push({
        _id: String(e._id),
        serviceType:
          e.partnerType === 'pharmacy' ? 'pharmacy_order' : 'lab_test',
        partnerType: e.partnerType,
        partnerName: e.partnerName ?? e.partner?.name ?? '—',
        partnerEmail: e.partner?.email ?? '',
        grossAmount: e.grossAmount,
        platformCut: e.platformCut,
        platformPct: e.grossAmount
          ? Math.round((e.platformCut / e.grossAmount) * 100)
          : 0,
        netAmount: e.netAmount,
        payoutStatus: e.payoutStatus,
        createdAt: e.createdAt,
        requestedAt: e.payoutRequestedAt ?? null,
        paidAt: e.paidAt ?? null
      })
    }
  }

  // Sort all rows newest-first
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  // Summary totals (across ALL rows, ignoring pagination)
  const summary = {
    platformRevenue: 0,
    pendingNet: 0,
    requestedNet: 0,
    paidNet: 0,
    totalTransactions: rows.length
  }
  for (const r of rows) {
    summary.platformRevenue += r.platformCut
    if (r.payoutStatus === 'pending') summary.pendingNet += r.netAmount
    if (r.payoutStatus === 'requested') summary.requestedNet += r.netAmount
    if (r.payoutStatus === 'paid') summary.paidNet += r.netAmount
  }

  // Paginate
  const total = rows.length
  const pageNum = Math.max(1, Number(page))
  const pageSize = Math.min(200, Math.max(1, Number(limit)))
  const paged = rows.slice((pageNum - 1) * pageSize, pageNum * pageSize)

  sendSuccess(res, 200, 'Earning history retrieved.', {
    earnings: paged,
    total,
    page: pageNum,
    pages: Math.ceil(total / pageSize),
    summary
  })
})

exports.approvePayout = asyncHandler(async (req, res, next) => {
  const PayoutRequest = require('../models/PayoutRequest')

  // Try DoctorEarning first
  const doctorEarning = await DoctorEarning.findById(req.params.id)
  if (doctorEarning) {
    if (doctorEarning.payoutStatus !== 'requested')
      return next(new AppError('Payout not in requested state.', 400))

    // Attempt Paystack auto-transfer using doctor's saved bank account
    let transferred = false
    const doctorProfile = await Doctor.findOne({ user: doctorEarning.doctor })
      .select('bankAccount displayName')
      .lean()
    const bank = doctorProfile?.bankAccount
    if (bank?.accountNumber && bank?.bankCode) {
      try {
        const settings = await PlatformSettings.findOne().lean()
        const key =
          settings?.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY
        if (settings?.paystackEnabled && key) {
          const doctorUser = await User.findById(doctorEarning.doctor)
            .select('name')
            .lean()
          const recipient = await createTransferRecipient({
            name:
              bank.accountName ||
              doctorProfile.displayName ||
              doctorUser?.name ||
              'Doctor',
            accountNumber: bank.accountNumber,
            bankCode: bank.bankCode
          })
          await initiateTransfer({
            amount: doctorEarning.netAmount,
            recipient: recipient.recipient_code,
            reason: `iBam Health payout â€“ Dr. ${doctorUser?.name ?? ''}`
          })
          transferred = true
        }
      } catch {
        /* fall through to manual */
      }
    }

    doctorEarning.payoutStatus = 'paid'
    doctorEarning.paidAt = new Date()
    await doctorEarning.save()
    await createNotification({
      userId: doctorEarning.doctor,
      type: 'payout_processed',
      title: 'Payout Processed',
      message: `Your payout of ₦${doctorEarning.netAmount.toLocaleString(
        'en-NG'
      )} has been ${
        transferred ? 'transferred to your bank account' : 'processed'
      }.`
    })
    return sendSuccess(res, 200, 'Payout approved.', {
      earning: doctorEarning,
      transferred
    })
  }

  // Partner payout request (consolidated)
  const request = await PayoutRequest.findById(req.params.id)
  if (!request) return next(new AppError('Payout request not found.', 404))
  if (request.status !== 'requested')
    return next(new AppError('Payout not in requested state.', 400))

  // Try Paystack auto-transfer
  let transferred = false
  const bank = request.bankAccount
  if (bank?.accountNumber && bank?.bankCode) {
    try {
      const settings = await PlatformSettings.findOne().lean()
      const key = settings?.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY
      if (settings?.paystackEnabled && key) {
        const recipient = await createTransferRecipient({
          name: bank.accountName || request.partnerName || 'Partner',
          accountNumber: bank.accountNumber,
          bankCode: bank.bankCode
        })
        await initiateTransfer({
          amount: request.totalNet,
          recipient: recipient.recipient_code,
          reason: `iBam Health payout â€“ ${request.partnerName}`
        })
        transferred = true
      }
    } catch {
      /* fall through to manual */
    }
  }

  request.status = 'paid'
  request.processedAt = new Date()
  await request.save()

  await PartnerEarning.updateMany(
    { _id: { $in: request.earningIds } },
    { payoutStatus: 'paid', paidAt: new Date() }
  )

  await createNotification({
    userId: request.partner,
    type: 'payout_processed',
    title: 'Payout Processed',
    message: `Your payout of ₦${request.totalNet.toLocaleString(
      'en-NG'
    )} has been ${
      transferred ? 'transferred to your bank account' : 'processed'
    }.`
  })

  sendSuccess(res, 200, 'Payout approved.', { transferred })
})

exports.getPartners = asyncHandler(async (req, res) => {
  const [labs, pharmacies] = await Promise.all([
    LabPartner.find(),
    PharmacyPartner.find()
  ])
  sendSuccess(res, 200, 'Partners retrieved.', { labs, pharmacies })
})

exports.updateTriageQuestions = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, 'Triage question bank update received.', {
    note: 'Persist to DB in v2.'
  })
})

// â”€â”€â”€ Live monitoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getLiveConsultations = asyncHandler(async (req, res) => {
  // Auto-close sessions stuck as active for over 4 hours — covers cases where
  // the doctor closed the app without ending and the socket timer was missed.
  const staleAt = new Date(Date.now() - 4 * 60 * 60 * 1000)
  await Consultation.updateMany(
    { status: 'active', startedAt: { $lt: staleAt } },
    { $set: { status: 'ended', endedAt: new Date(), timedOut: true } }
  )

  const consultations = await Consultation.find({ status: 'active' })
    .populate({
      path: 'appointment',
      populate: [
        { path: 'patient', select: 'name email phone' },
        { path: 'doctor', select: 'name email' }
      ]
    })
    .sort({ startedAt: -1 })
  sendSuccess(res, 200, 'Live consultations retrieved.', { consultations })
})

exports.getAllConsultations = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status

  const consultations = await Consultation.find(filter)
    .populate({
      path: 'appointment',
      populate: [
        { path: 'patient', select: 'name email' },
        { path: 'doctor', select: 'name email' }
      ]
    })
    .sort({ startedAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Consultation.countDocuments(filter)
  sendSuccess(res, 200, 'Consultations retrieved.', { consultations, total })
})

exports.getConsultationMessages = asyncHandler(async (req, res, next) => {
  const consultation = await Consultation.findById(req.params.id)
  if (!consultation) return next(new AppError('Consultation not found.', 404))

  const messages = await Message.find({ consultation: req.params.id })
    .populate('sender', 'name role')
    .sort({ createdAt: 1 })
  sendSuccess(res, 200, 'Messages retrieved.', { messages })
})

// â”€â”€â”€ Pharmacy management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getPharmacies = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status

  const pharmacies = await PharmacyPartner.find(filter)
    .populate('user', 'name email isActive')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await PharmacyPartner.countDocuments(filter)
  sendSuccess(res, 200, 'Pharmacies retrieved.', { pharmacies, total })
})

exports.updatePharmacyStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body
  if (!['pending', 'active', 'inactive', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status.', 400))
  }
  const pharmacy = await PharmacyPartner.findByIdAndUpdate(
    req.params.id,
    { status },
    { returnDocument: 'after' }
  )
  if (!pharmacy) return next(new AppError('Pharmacy not found.', 404))

  if (pharmacy.user) {
    const isActive = status === 'active'
    await User.findByIdAndUpdate(pharmacy.user, { isActive })
    if (status === 'active') {
      await createNotification({
        userId: pharmacy.user,
        type: 'partner_approved',
        title: 'Pharmacy Account Approved',
        message:
          'Your pharmacy application has been approved. You can now receive orders.',
        emailData: { partnerType: 'Pharmacy' }
      })
    } else if (status === 'suspended' || status === 'inactive') {
      await createNotification({
        userId: pharmacy.user,
        type: 'partner_rejected',
        title:
          'Pharmacy Account ' +
          (status === 'suspended' ? 'Suspended' : 'Deactivated'),
        message: `Your pharmacy account has been ${status}. Please contact support for more information.`,
        emailData: { partnerType: 'Pharmacy' }
      })
    }
  }

  logAction(
    req.user,
    `Updated pharmacy status to ${status}`,
    'PharmacyPartner',
    pharmacy._id,
    { status },
    req
  )
  sendSuccess(res, 200, 'Pharmacy status updated.', { pharmacy })
})

// â”€â”€â”€ Lab management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getLabs = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status

  const labs = await LabPartner.find(filter)
    .populate('user', 'name email isActive')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await LabPartner.countDocuments(filter)
  sendSuccess(res, 200, 'Labs retrieved.', { labs, total })
})

exports.updateLabTests = asyncHandler(async (req, res, next) => {
  const { testsOffered } = req.body
  if (!Array.isArray(testsOffered))
    return next(new AppError('testsOffered must be an array.', 400))
  const cleaned = testsOffered
    .filter(t => t.name && t.name.trim())
    .map(t => ({
      name: t.name.trim(),
      price: Number(t.price) || 0,
      turnaroundHours: Number(t.turnaroundHours) || 24
    }))
  const lab = await LabPartner.findByIdAndUpdate(
    req.params.id,
    { testsOffered: cleaned },
    { returnDocument: 'after' }
  )
  if (!lab) return next(new AppError('Lab not found.', 404))
  sendSuccess(res, 200, 'Lab tests updated.', { lab })
})

exports.updateLabStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body
  if (!['pending', 'active', 'inactive', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status.', 400))
  }
  const lab = await LabPartner.findByIdAndUpdate(
    req.params.id,
    { status },
    { returnDocument: 'after' }
  )
  if (!lab) return next(new AppError('Lab not found.', 404))

  if (lab.user) {
    const isActive = status === 'active'
    await User.findByIdAndUpdate(lab.user, { isActive })
    if (status === 'active') {
      await createNotification({
        userId: lab.user,
        type: 'partner_approved',
        title: 'Lab Account Approved',
        message:
          'Your lab application has been approved. You can now receive test requests.',
        emailData: { partnerType: 'Laboratory' }
      })
    } else if (status === 'suspended' || status === 'inactive') {
      await createNotification({
        userId: lab.user,
        type: 'partner_rejected',
        title:
          'Lab Account ' +
          (status === 'suspended' ? 'Suspended' : 'Deactivated'),
        message: `Your lab account has been ${status}. Please contact support for more information.`,
        emailData: { partnerType: 'Laboratory' }
      })
    }
  }

  logAction(
    req.user,
    `Updated lab status to ${status}`,
    'LabPartner',
    lab._id,
    { status },
    req
  )
  sendSuccess(res, 200, 'Lab status updated.', { lab })
})

// â”€â”€â”€ Diagnostics management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getDiagnosticsRequests = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query
  const filter = {}
  if (status) filter.status = status

  if (search && search.trim()) {
    const q = search.trim()
    const isObjectId = /^[0-9a-f]{24}$/i.test(q)
    if (isObjectId) {
      // Match request ID, patient user ID, or payment/transaction ID
      filter.$or = [{ _id: q }, { patient: q }, { paymentRef: q }]
    } else {
      // Search by patient name, email, or phone
      const patients = await User.find(
        {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } }
          ]
        },
        '_id'
      ).lean()
      if (!patients.length) {
        return sendSuccess(res, 200, 'No matching requests found.', {
          requests: [],
          total: 0
        })
      }
      filter.patient = { $in: patients.map(p => p._id) }
    }
  }

  const requests = await DiagnosticsRequest.find(filter)
    .populate('patient', 'name email phone')
    .populate('lab', 'name address phone')
    .populate({
      path: 'paymentRef',
      select: 'status amount reference method transferReference'
    })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await DiagnosticsRequest.countDocuments(filter)

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
        _id: lr._id,
        fileUrl: lr.fileUrl,
        notes: lr.notes,
        createdAt: lr.createdAt
      }
    return obj
  })

  sendSuccess(res, 200, 'Diagnostics requests retrieved.', {
    requests: enriched,
    total
  })
})

exports.getSubscriptions = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status

  const subscriptions = await Subscription.find(filter)
    .populate('user', 'name email')
    .populate('plan', 'name price interval')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Subscription.countDocuments(filter)
  sendSuccess(res, 200, 'Subscriptions retrieved.', { subscriptions, total })
})

// â”€â”€â”€ All orders (pharmacy) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { status, orderType, pharmacyId, page = 1, limit = 25 } = req.query
  const filter = {}
  if (status) filter.status = status
  if (orderType) filter.orderType = orderType
  if (pharmacyId) filter.pharmacy = pharmacyId

  const orders = await PharmacyOrder.find(filter)
    .populate('patient', 'name email phone')
    .populate('pharmacy', 'name address phone')
    .populate('prescription', 'medications diagnosis')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await PharmacyOrder.countDocuments(filter)
  sendSuccess(res, 200, 'All orders retrieved.', { orders, total })
})

// â”€â”€â”€ All lab / diagnostics requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// (re-exported alias  getDiagnosticsRequests already covers this)

// â”€â”€â”€ Audit log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getLabWalkInHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, search = '' } = req.query
  const pg = Math.max(1, Number(page))
  const lim = Math.min(100, Math.max(1, Number(limit)))

  const filter = { collectionType: 'walk_in', registeredBy: { $exists: true } }
  if (search.trim()) {
    const q = search.trim()
    filter.$or = [{ 'patientSnapshot.name': new RegExp(q, 'i') }]
  }

  const [rows, total] = await Promise.all([
    DiagnosticsRequest.find(filter)
      .populate('patient', 'name phone email')
      .populate('registeredBy', 'name email adminRole role')
      .populate('lab', 'name')
      .populate('paymentRef', 'amount method reference status')
      .populate('wellnessPackage', 'name')
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .lean(),
    DiagnosticsRequest.countDocuments(filter)
  ])

  sendSuccess(res, 200, 'Walk-in history retrieved.', { rows, total })
})

exports.getAuditLogs = asyncHandler(async (req, res) => {
  const { action, adminId, page = 1, limit = 30 } = req.query
  const filter = {}
  if (action)
    filter.action = new RegExp(
      action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    )
  if (adminId) filter.admin = adminId

  const logs = await AuditLog.find(filter)
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await AuditLog.countDocuments(filter)
  sendSuccess(res, 200, 'Audit logs retrieved.', { logs, total })
})

// â”€â”€â”€ Platform settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getPublicContent = asyncHandler(async (req, res) => {
  let settings = await PlatformSettings.findOne().select(
    'healthTips announcement'
  )
  if (!settings) settings = await PlatformSettings.create({})

  const [specializations, services, plans, labTests, wellnessPackages] =
    await Promise.all([
      Specialization.find({ isActive: true })
        .sort({ order: 1, name: 1 })
        .select('name description'),
      PlatformService.find({ isActive: true })
        .sort({ order: 1 })
        .select('-__v'),
      SubscriptionPlan.find({ isActive: true })
        .sort({ price: 1 })
        .select('-__v'),
      LabTest.find({ isActive: true })
        .sort({ order: 1, name: 1 })
        .select(
          'name category walkInPrice homeVisitPrice estimatedPrice turnaroundHours'
        ),
      WellnessPackage.find({ isActive: true })
        .sort({ order: 1, name: 1 })
        .select('-__v')
    ])

  // Re-fetch only paystackPublicKey to avoid over-fetching above
  const pkSettings = await PlatformSettings.findOne()
    .select('paystackPublicKey')
    .lean()

  sendSuccess(res, 200, 'Public content retrieved.', {
    healthTips: settings.healthTips ?? [],
    announcement: settings.announcement ?? '',
    specializations,
    services,
    plans,
    labTests,
    wellnessPackages,
    paystackPublicKey: pkSettings?.paystackPublicKey ?? ''
  })
})

exports.getSettings = asyncHandler(async (req, res) => {
  let settings = await PlatformSettings.findOne().lean()
  if (!settings) settings = await PlatformSettings.create({})
  // Never expose secret keys to client — send flag indicators instead
  const out = {
    ...settings,
    paystackSecretKey:  undefined,
    paystackKeySet:     !!settings.paystackSecretKey,
    monnifySecretKey:   undefined,
    monnifyKeySet:      !!settings.monnifySecretKey,
    monnifyApiKeySet:   !!settings.monnifyApiKey,
  }
  sendSuccess(res, 200, 'Settings retrieved.', { settings: out })
})

exports.requestSettingsOtp = asyncHandler(async (req, res) => {
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const hash = crypto.createHash('sha256').update(otp).digest('hex')
  const expiry = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await PlatformSettings.findOneAndUpdate(
    {},
    { settingsOtpHash: hash, settingsOtpExpiry: expiry },
    { upsert: true }
  )

  await sendOTPEmail(req.user.email, otp)
  sendSuccess(res, 200, 'OTP sent to your admin email.')
})

exports.updateSettings = asyncHandler(async (req, res, next) => {
  const {
    paymentProvider,
    paystackEnabled,
    paystackSecretKey,
    paystackPublicKey,
    monnifyEnabled,
    monnifyApiKey,
    monnifySecretKey,
    monnifyContractCode,
    monnifyBaseUrl,
    monnifySourceAccountNumber,
    otp,
    directPaymentEnabled,
    companyBankName,
    companyAccountNumber,
    companyAccountName,
    companyBankCode,
    directPaymentNote,
    announcement,
    healthTips
  } = req.body

  // OTP required when changing any secret API keys
  const changingSecretKey = paystackSecretKey !== undefined || monnifySecretKey !== undefined || monnifyApiKey !== undefined
  if (changingSecretKey) {
    const current = await PlatformSettings.findOne()
      .select('+settingsOtpHash +settingsOtpExpiry')
      .lean()
    const currentHasKey = !!current?.paystackSecretKey || !!current?.monnifySecretKey

    if (currentHasKey) {
      if (!otp)
        return next(new AppError('OTP required to update API keys.', 403))
      if (
        !current.settingsOtpHash ||
        !current.settingsOtpExpiry ||
        current.settingsOtpExpiry < new Date()
      )
        return next(new AppError('OTP expired. Please request a new one.', 403))
      const hash = crypto.createHash('sha256').update(String(otp)).digest('hex')
      if (hash !== current.settingsOtpHash)
        return next(new AppError('Invalid OTP.', 403))
    }
  }

  const update = {}
  if (paymentProvider !== undefined && ['paystack', 'monnify'].includes(paymentProvider))
    update.paymentProvider = paymentProvider
  if (typeof paystackEnabled === 'boolean')   update.paystackEnabled   = paystackEnabled
  if (paystackSecretKey !== undefined)        update.paystackSecretKey = paystackSecretKey
  if (paystackPublicKey !== undefined)        update.paystackPublicKey = paystackPublicKey
  if (typeof monnifyEnabled === 'boolean')    update.monnifyEnabled    = monnifyEnabled
  if (monnifyApiKey !== undefined)            update.monnifyApiKey     = monnifyApiKey
  if (monnifySecretKey !== undefined)         update.monnifySecretKey  = monnifySecretKey
  if (monnifyContractCode !== undefined)      update.monnifyContractCode = monnifyContractCode
  if (monnifyBaseUrl !== undefined)           update.monnifyBaseUrl    = monnifyBaseUrl
  if (monnifySourceAccountNumber !== undefined) update.monnifySourceAccountNumber = monnifySourceAccountNumber
  if (typeof directPaymentEnabled === 'boolean')
    update.directPaymentEnabled = directPaymentEnabled
  if (companyBankName !== undefined)      update.companyBankName      = companyBankName
  if (companyAccountNumber !== undefined) update.companyAccountNumber = companyAccountNumber
  if (companyAccountName !== undefined)   update.companyAccountName   = companyAccountName
  if (companyBankCode !== undefined)      update.companyBankCode      = companyBankCode
  if (directPaymentNote !== undefined)    update.directPaymentNote    = directPaymentNote
  if (announcement !== undefined)         update.announcement         = announcement
  if (Array.isArray(healthTips))          update.healthTips           = healthTips

  // Clear OTP after use
  if (otp) {
    update.settingsOtpHash   = null
    update.settingsOtpExpiry = null
  }

  const settings = await PlatformSettings.findOneAndUpdate({}, update, {
    upsert: true,
    returnDocument: 'after'
  }).lean()
  const out = {
    ...settings,
    paystackSecretKey: undefined,
    paystackKeySet:    !!settings.paystackSecretKey,
    monnifySecretKey:  undefined,
    monnifyKeySet:     !!settings.monnifySecretKey,
    monnifyApiKeySet:  !!settings.monnifyApiKey,
  }
  sendSuccess(res, 200, 'Settings updated.', { settings: out })
})

// â”€â”€â”€ Plan management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.listPlans = asyncHandler(async (req, res) => {
  const plans = await SubscriptionPlan.find().sort({ price: 1 })
  sendSuccess(res, 200, 'Plans retrieved.', { plans })
})

exports.createPlan = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    interval,
    features,
    isActive,
    featured,
    paystackPlanCode
  } = req.body
  const plan = await SubscriptionPlan.create({
    name,
    description,
    price,
    interval,
    features,
    isActive,
    featured,
    paystackPlanCode
  })
  sendSuccess(res, 201, 'Plan created.', { plan })
})

exports.updatePlan = asyncHandler(async (req, res, next) => {
  const {
    name,
    description,
    price,
    interval,
    features,
    isActive,
    featured,
    paystackPlanCode
  } = req.body
  const plan = await SubscriptionPlan.findByIdAndUpdate(
    req.params.id,
    {
      name,
      description,
      price,
      interval,
      features,
      isActive,
      featured,
      paystackPlanCode
    },
    { returnDocument: 'after', runValidators: true }
  )
  if (!plan) return next(new AppError('Plan not found.', 404))
  sendSuccess(res, 200, 'Plan updated.', { plan })
})

exports.deletePlan = asyncHandler(async (req, res, next) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { returnDocument: 'after' }
  )
  if (!plan) return next(new AppError('Plan not found.', 404))
  sendSuccess(res, 200, 'Plan deactivated.', { plan })
})

// â”€â”€â”€ Drug catalog management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getAllDrugs = asyncHandler(async (req, res) => {
  const pharmacies = await PharmacyPartner.find({ status: 'active' }).select(
    'name address drugsOffered'
  )
  const drugs = pharmacies.flatMap(p =>
    p.drugsOffered.map(d => ({
      ...d.toObject(),
      pharmacyId: p._id,
      pharmacyName: p.name,
      pharmacyAddress: p.address
    }))
  )
  sendSuccess(res, 200, 'All drugs retrieved.', { drugs, total: drugs.length })
})

exports.approveDrug = asyncHandler(async (req, res, next) => {
  const { pharmacyId, drugId } = req.params
  const { approved } = req.body
  const pharmacy = await PharmacyPartner.findById(pharmacyId)
  if (!pharmacy) return next(new AppError('Pharmacy not found.', 404))
  const drug = pharmacy.drugsOffered.id(drugId)
  if (!drug) return next(new AppError('Drug not found.', 404))
  drug.adminApproved = approved !== false
  await pharmacy.save()
  if (pharmacy.user) {
    await createNotification({
      userId: pharmacy.user,
      type: 'drug_approval',
      title: approved !== false ? 'Drug Approved' : 'Drug Rejected',
      message: `Your drug listing "${drug.name}" has been ${
        approved !== false ? 'approved' : 'rejected'
      }.`,
      metadata: { pharmacyId, drugId },
      emailData: { approved: approved !== false, drugName: drug.name }
    })
  }
  sendSuccess(res, 200, 'Drug approval updated.', { drug })
})

// â”€â”€â”€ Pending approvals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const [orders, testRequests] = await Promise.all([
    PharmacyOrder.find({
      requiresApproval: true,
      adminApprovalStatus: 'pending'
    })
      .populate('patient', 'name email phone')
      .populate('pharmacy', 'name address')
      .sort({ createdAt: -1 }),
    DiagnosticsRequest.find({
      requiresApproval: true,
      adminApprovalStatus: 'pending'
    })
      .populate('patient', 'name email phone')
      .populate('lab', 'name address')
      .sort({ createdAt: -1 })
  ])
  sendSuccess(res, 200, 'Pending approvals retrieved.', {
    orders,
    testRequests,
    total: orders.length + testRequests.length
  })
})

exports.approveOrder = asyncHandler(async (req, res, next) => {
  const { approved, note } = req.body
  const order = await PharmacyOrder.findById(req.params.id).populate(
    'pharmacy',
    'name'
  )
  if (!order) return next(new AppError('Order not found.', 404))
  order.adminApprovalStatus = approved ? 'approved' : 'rejected'
  if (!approved) order.status = 'cancelled'
  await order.save()
  await createNotification({
    userId: order.patient,
    type: 'order_approval',
    title: approved ? 'Order Approved' : 'Order Rejected',
    message: approved
      ? 'Your pharmacy order has been approved and is now being processed.'
      : `Your pharmacy order was rejected. ${note || ''}`,
    metadata: { orderId: order._id },
    emailData: {
      approved: !!approved,
      note: note || '',
      pharmacyName: order.pharmacy?.name || 'Pharmacy',
      items: order.items || []
    }
  })
  sendSuccess(res, 200, 'Order approval updated.', { order })
})

exports.approveTestRequest = asyncHandler(async (req, res, next) => {
  const { approved, note } = req.body
  const req_ = await DiagnosticsRequest.findById(req.params.id)
  if (!req_) return next(new AppError('Test request not found.', 404))
  req_.adminApprovalStatus = approved ? 'approved' : 'rejected'
  if (!approved) req_.status = 'cancelled'
  await req_.save()
  await createNotification({
    userId: req_.patient,
    type: 'test_request_approval',
    title: approved ? 'Test Request Approved' : 'Test Request Rejected',
    message: approved
      ? 'Your lab test request has been approved. You can now proceed with payment.'
      : `Your lab test request was rejected. ${note || ''}`,
    metadata: { requestId: req_._id },
    emailData: {
      approved: !!approved,
      tests: req_.tests || [],
      note: note || ''
    }
  })
  sendSuccess(res, 200, 'Test request approval updated.', { request: req_ })
})

// â”€â”€â”€ Admin-initiated registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.createDoctor = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    phone,
    password,
    specialization,
    licenseNumber,
    consultationFee,
    bio,
    autoApprove
  } = req.body
  if (!name || !email || !password || !specialization || !licenseNumber) {
    return next(
      new AppError(
        'name, email, password, specialization and licenseNumber are required.',
        400
      )
    )
  }
  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing)
    return next(new AppError('A user with that email already exists.', 409))

  const existingDoctor = await Doctor.findOne({ licenseNumber })
  if (existingDoctor)
    return next(
      new AppError('A doctor with that license number already exists.', 409)
    )

  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password,
    role: 'doctor',
    isVerified: true,
    isActive: true,
    kycStatus: autoApprove ? 'approved' : 'pending'
  })

  let doctor
  try {
    const doctorData = {
      user: user._id,
      specialization,
      licenseNumber,
      consultationFee: consultationFee || 0,
      bio: bio || '',
      isApproved: !!autoApprove
    }
    if (autoApprove) {
      doctorData.kycStatus = 'approved'
      doctorData.approvedBy = req.user._id
      doctorData.approvedAt = new Date()
    }
    doctor = await Doctor.create(doctorData)
  } catch (err) {
    await User.findByIdAndDelete(user._id)
    return next(
      new AppError(`Failed to create doctor profile: ${err.message}`, 500)
    )
  }

  await createNotification({
    userId: user._id,
    type: 'doctor_approved',
    title: autoApprove ? 'Account Created & Approved' : 'Account Created',
    message: autoApprove
      ? 'Your doctor account has been created and approved by an admin. You can log in now.'
      : 'Your doctor account has been created by an admin. Complete your KYC to get approved.'
  })

  sendAccountCreatedEmail({ email, name, password, role: 'doctor' }).catch(
    err => console.error('[Email] Doctor account created:', err.message)
  )

  sendSuccess(res, 201, 'Doctor account created.', { user, doctor })
})

exports.createLab = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    phone,
    password,
    address,
    licenseNumber,
    cacNumber,
    coverageAreas,
    testsOffered,
    autoActivate
  } = req.body
  if (!name || !email || !password || !address) {
    return next(
      new AppError('name, email, password and address are required.', 400)
    )
  }
  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing)
    return next(new AppError('A user with that email already exists.', 409))

  if (licenseNumber) {
    const existingLab = await LabPartner.findOne({ licenseNumber })
    if (existingLab)
      return next(
        new AppError('A lab with that license number already exists.', 409)
      )
  }
  if (cacNumber) {
    const existingLab = await LabPartner.findOne({ cacNumber })
    if (existingLab)
      return next(
        new AppError('A lab with that CAC number already exists.', 409)
      )
  }

  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password,
    role: 'lab_partner',
    isVerified: true,
    isActive: true,
    kycStatus: autoActivate ? 'approved' : 'pending'
  })

  let lab
  try {
    lab = await LabPartner.create({
      user: user._id,
      name,
      address,
      phone: phone || '',
      email: email || '',
      licenseNumber: licenseNumber || '',
      cacNumber: cacNumber || '',
      cacVerified: !!autoActivate,
      status: autoActivate ? 'active' : 'pending',
      coverageAreas: Array.isArray(coverageAreas)
        ? coverageAreas
        : typeof coverageAreas === 'string'
        ? coverageAreas
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
      testsOffered: Array.isArray(testsOffered) ? testsOffered : []
    })
  } catch (err) {
    await User.findByIdAndDelete(user._id)
    return next(
      new AppError(`Failed to create lab profile: ${err.message}`, 500)
    )
  }

  await createNotification({
    userId: user._id,
    type: 'partner_approved',
    title: autoActivate
      ? 'Lab Account Created & Activated'
      : 'Lab Account Created',
    message: autoActivate
      ? 'Your diagnostic lab account has been created and activated by an admin.'
      : 'Your diagnostic lab account has been created by an admin. Pending approval.'
  })

  sendAccountCreatedEmail({ email, name, password, role: 'lab_partner' }).catch(
    err => console.error('[Email] Lab account created:', err.message)
  )

  sendSuccess(res, 201, 'Lab account created.', { user, lab })
})

// Admin opens a lab's dashboard without requiring the lab to log in separately.
// Returns a short-lived token (4 h) for that lab's user account.
exports.impersonateLab = asyncHandler(async (req, res, next) => {
  const { signAccessToken } = require('../utils/jwt')
  const lab = await LabPartner.findById(req.params.id).populate(
    'user',
    '_id name email role isActive'
  )
  if (!lab) return next(new AppError('Lab not found.', 404))
  if (!lab.user) return next(new AppError('Lab has no user account.', 404))
  if (!lab.user.isActive)
    return next(new AppError('Lab user account is inactive.', 403))

  // Sign a 4-hour token for the lab user; mark as impersonated for audit purposes
  const token = signAccessToken({
    id: lab.user._id,
    impersonatedBy: req.user._id
  })

  const clientUrl = process.env.CLIENT_URL || 'https://www.ibamhealth.com'
  sendSuccess(res, 200, 'Impersonation token generated.', {
    token,
    labName: lab.name,
    url: `${clientUrl}/lab?token=${token}`
  })
})

exports.createPharmacy = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    phone,
    password,
    address,
    licenseNumber,
    cacNumber,
    coverageAreas,
    autoActivate
  } = req.body
  if (!name || !email || !password || !address) {
    return next(
      new AppError('name, email, password and address are required.', 400)
    )
  }
  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing)
    return next(new AppError('A user with that email already exists.', 409))

  if (licenseNumber) {
    const existingPharmacy = await PharmacyPartner.findOne({ licenseNumber })
    if (existingPharmacy)
      return next(
        new AppError('A pharmacy with that license number already exists.', 409)
      )
  }
  if (cacNumber) {
    const existingPharmacy = await PharmacyPartner.findOne({ cacNumber })
    if (existingPharmacy)
      return next(
        new AppError('A pharmacy with that CAC number already exists.', 409)
      )
  }

  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password,
    role: 'pharmacy_partner',
    isVerified: true,
    isActive: true,
    kycStatus: autoActivate ? 'approved' : 'pending'
  })

  let pharmacy
  try {
    pharmacy = await PharmacyPartner.create({
      user: user._id,
      name,
      address,
      phone: phone || '',
      email: email || '',
      licenseNumber: licenseNumber || '',
      cacNumber: cacNumber || '',
      cacVerified: !!autoActivate,
      status: autoActivate ? 'active' : 'pending',
      coverageAreas: Array.isArray(coverageAreas)
        ? coverageAreas
        : typeof coverageAreas === 'string'
        ? coverageAreas
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : []
    })
  } catch (err) {
    await User.findByIdAndDelete(user._id)
    return next(
      new AppError(`Failed to create pharmacy profile: ${err.message}`, 500)
    )
  }

  await createNotification({
    userId: user._id,
    type: 'partner_approved',
    title: autoActivate
      ? 'Pharmacy Account Created & Activated'
      : 'Pharmacy Account Created',
    message: autoActivate
      ? 'Your pharmacy account has been created and activated by an admin.'
      : 'Your pharmacy account has been created by an admin. Pending approval.'
  })

  sendAccountCreatedEmail({
    email,
    name,
    password,
    role: 'pharmacy_partner'
  }).catch(err =>
    console.error('[Email] Pharmacy account created:', err.message)
  )

  sendSuccess(res, 201, 'Pharmacy account created.', { user, pharmacy })
})

exports.manualKycVerify = asyncHandler(async (req, res, next) => {
  const { userId } = req.params
  const { kycStatus, reason } = req.body
  const VALID = [
    'pending',
    'nin_verified',
    'face_verified',
    'approved',
    'rejected'
  ]
  if (!VALID.includes(kycStatus))
    return next(new AppError('Invalid kycStatus.', 400))

  const user = await User.findById(userId)
  if (!user) return next(new AppError('User not found.', 404))

  user.kycStatus = kycStatus
  if (kycStatus === 'approved') user.isVerified = true
  await user.save()

  // Sync on role-specific profile
  if (user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user: userId })
    if (doctor) {
      doctor.kycStatus = kycStatus
      doctor.isApproved = kycStatus === 'approved'
      if (kycStatus === 'approved') {
        doctor.approvedBy = req.user._id
        doctor.approvedAt = new Date()
      }
      await doctor.save()
    }
  } else if (user.role === 'lab_partner') {
    await LabPartner.findOneAndUpdate(
      { user: userId },
      {
        cacVerified: kycStatus === 'approved',
        status:
          kycStatus === 'approved'
            ? 'active'
            : kycStatus === 'rejected'
            ? 'suspended'
            : 'pending'
      }
    )
  } else if (user.role === 'pharmacy_partner') {
    await PharmacyPartner.findOneAndUpdate(
      { user: userId },
      {
        cacVerified: kycStatus === 'approved',
        status:
          kycStatus === 'approved'
            ? 'active'
            : kycStatus === 'rejected'
            ? 'suspended'
            : 'pending'
      }
    )
  }

  const notifMap = {
    approved: {
      title: 'Account Verified',
      message: reason || 'Your account has been verified by an admin.'
    },
    rejected: {
      title: 'Verification Failed',
      message: reason || 'Your KYC was rejected by an admin.'
    },
    nin_verified: {
      title: 'NIN Verified',
      message: 'Your NIN has been manually verified by an admin.'
    },
    face_verified: {
      title: 'Identity Verified',
      message: 'Your identity has been manually verified by an admin.'
    },
    pending: {
      title: 'KYC Reset',
      message: 'Your KYC status has been reset. Please resubmit your documents.'
    }
  }
  const notif = notifMap[kycStatus]
  const notifType =
    kycStatus === 'approved'
      ? user.role === 'doctor'
        ? 'doctor_approved'
        : 'partner_approved'
      : kycStatus === 'rejected'
      ? user.role === 'doctor'
        ? 'doctor_rejected'
        : 'partner_rejected'
      : 'doctor_approved'
  const partnerType =
    user.role === 'lab_partner'
      ? 'Laboratory'
      : user.role === 'pharmacy_partner'
      ? 'Pharmacy'
      : undefined
  await createNotification({
    userId,
    type: notifType,
    title: notif.title,
    message: notif.message,
    emailData:
      kycStatus === 'approved' || kycStatus === 'rejected'
        ? { partnerType }
        : undefined
  })

  logAction(
    req.user,
    `KYC status set to ${kycStatus}`,
    'User',
    user._id,
    { kycStatus, reason: reason || null },
    req
  )
  sendSuccess(res, 200, 'KYC status updated.', { user })
})

// â”€â”€â”€ Broadcast message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /admin/broadcast
// body: { title, message, roles?: string[], channels?: ('push'|'email'|'in_app')[] }
exports.broadcastMessage = asyncHandler(async (req, res, next) => {
  const {
    title,
    message,
    roles,
    channels = ['push', 'email', 'in_app']
  } = req.body
  if (!title || !message)
    return next(new AppError('Title and message are required.', 400))

  const filter = { isActive: true }
  if (roles?.length) filter.role = { $in: roles }

  const users = await User.find(filter)
    .select('_id name email expoPushToken')
    .lean()
  if (!users.length) {
    return sendSuccess(res, 200, 'No users matched the filter.', { sent: 0 })
  }

  const results = { inApp: 0, push: 0, email: 0 }

  // In-app (Socket.io) notifications
  if (channels.includes('in_app')) {
    await Promise.all(
      users.map(u =>
        createNotification({ userId: u._id, type: 'general', title, message })
          .then(() => {
            results.inApp++
          })
          .catch(() => {})
      )
    )
  }

  // Push notifications (batch)
  if (channels.includes('push')) {
    const tokens = users.map(u => u.expoPushToken).filter(Boolean)
    if (tokens.length) {
      await sendPushNotifications({
        tokens,
        title,
        body: message,
        data: { type: 'broadcast' }
      })
      results.push = tokens.length
    }
  }

  // Emails (fire-and-forget per user so one failure doesn't abort others)
  if (channels.includes('email')) {
    await Promise.allSettled(
      users
        .filter(u => u.email)
        .map(u =>
          sendBroadcastEmail({ to: u.email, name: u.name, title, message })
            .then(() => {
              results.email++
            })
            .catch(() => {})
        )
    )
  }

  sendSuccess(res, 200, `Broadcast sent to ${users.length} users.`, {
    recipients: users.length,
    ...results
  })
})

// â”€â”€â”€ Specialization management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.listSpecializations = asyncHandler(async (req, res) => {
  const specs = await Specialization.find().sort({ order: 1, name: 1 })
  sendSuccess(res, 200, 'Specializations retrieved.', {
    specializations: specs
  })
})

exports.createSpecialization = asyncHandler(async (req, res, next) => {
  const { name, description, order } = req.body
  if (!name) return next(new AppError('name is required.', 400))
  const spec = await Specialization.create({ name, description, order })
  sendSuccess(res, 201, 'Specialization created.', { specialization: spec })
})

exports.updateSpecialization = asyncHandler(async (req, res, next) => {
  const { name, description, isActive, order } = req.body
  const spec = await Specialization.findByIdAndUpdate(
    req.params.id,
    { name, description, isActive, order },
    { returnDocument: 'after', runValidators: true }
  )
  if (!spec) return next(new AppError('Specialization not found.', 404))
  sendSuccess(res, 200, 'Specialization updated.', { specialization: spec })
})

exports.deleteSpecialization = asyncHandler(async (req, res, next) => {
  const spec = await Specialization.findByIdAndDelete(req.params.id)
  if (!spec) return next(new AppError('Specialization not found.', 404))
  sendSuccess(res, 200, 'Specialization deleted.')
})

// â”€â”€â”€ Platform service management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.listServices = asyncHandler(async (req, res) => {
  const services = await PlatformService.find().sort({ order: 1 })
  sendSuccess(res, 200, 'Services retrieved.', { services })
})

exports.createService = asyncHandler(async (req, res, next) => {
  const {
    iconName,
    tagLabel,
    title,
    description,
    steps,
    visualLabel,
    visualSub,
    cta,
    ctaHref,
    order
  } = req.body
  if (!title || !description || !iconName || !tagLabel) {
    return next(
      new AppError(
        'iconName, tagLabel, title and description are required.',
        400
      )
    )
  }
  const service = await PlatformService.create({
    iconName,
    tagLabel,
    title,
    description,
    steps,
    visualLabel,
    visualSub,
    cta,
    ctaHref,
    order
  })
  sendSuccess(res, 201, 'Service created.', { service })
})

exports.updateService = asyncHandler(async (req, res, next) => {
  const {
    iconName,
    tagLabel,
    title,
    description,
    steps,
    visualLabel,
    visualSub,
    cta,
    ctaHref,
    order,
    isActive
  } = req.body
  const service = await PlatformService.findByIdAndUpdate(
    req.params.id,
    {
      iconName,
      tagLabel,
      title,
      description,
      steps,
      visualLabel,
      visualSub,
      cta,
      ctaHref,
      order,
      isActive
    },
    { returnDocument: 'after', runValidators: true }
  )
  if (!service) return next(new AppError('Service not found.', 404))
  sendSuccess(res, 200, 'Service updated.', { service })
})

exports.deleteService = asyncHandler(async (req, res, next) => {
  const service = await PlatformService.findByIdAndDelete(req.params.id)
  if (!service) return next(new AppError('Service not found.', 404))
  sendSuccess(res, 200, 'Service deleted.')
})

// â”€â”€â”€ Lab test catalog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

exports.listLabTests = asyncHandler(async (req, res) => {
  const labTests = await LabTest.find().sort({ order: 1, name: 1 })
  sendSuccess(res, 200, 'Lab tests retrieved.', { labTests })
})

exports.createLabTest = asyncHandler(async (req, res, next) => {
  const {
    name,
    category,
    description,
    walkInPrice,
    homeVisitPrice,
    estimatedPrice,
    turnaroundHours,
    order
  } = req.body
  if (!name) return next(new AppError('Test name is required.', 400))
  const labTest = await LabTest.create({
    name,
    category,
    description,
    turnaroundHours,
    order,
    walkInPrice: walkInPrice ?? estimatedPrice,
    homeVisitPrice: homeVisitPrice ?? estimatedPrice,
    estimatedPrice: estimatedPrice ?? walkInPrice
  })
  sendSuccess(res, 201, 'Lab test created.', { labTest })
})

exports.updateLabTest = asyncHandler(async (req, res, next) => {
  const {
    name,
    category,
    description,
    walkInPrice,
    homeVisitPrice,
    estimatedPrice,
    turnaroundHours,
    order,
    isActive
  } = req.body
  const update = {
    name,
    category,
    description,
    turnaroundHours,
    order,
    isActive
  }
  if (walkInPrice !== undefined) update.walkInPrice = walkInPrice
  if (homeVisitPrice !== undefined) update.homeVisitPrice = homeVisitPrice
  if (estimatedPrice !== undefined) update.estimatedPrice = estimatedPrice
  const labTest = await LabTest.findByIdAndUpdate(req.params.id, update, {
    returnDocument: 'after',
    runValidators: true
  })
  if (!labTest) return next(new AppError('Lab test not found.', 404))
  sendSuccess(res, 200, 'Lab test updated.', { labTest })
})

exports.deleteLabTest = asyncHandler(async (req, res, next) => {
  const labTest = await LabTest.findByIdAndDelete(req.params.id)
  if (!labTest) return next(new AppError('Lab test not found.', 404))
  sendSuccess(res, 200, 'Lab test deleted.')
})

// ── Wellness package CRUD ─────────────────────────────────────────────────────
exports.listAllWellnessPackages = asyncHandler(async (req, res) => {
  const packages = await WellnessPackage.find().sort({ order: 1, name: 1 })
  sendSuccess(res, 200, 'Wellness packages retrieved.', { packages })
})

exports.createWellnessPackage = asyncHandler(async (req, res, next) => {
  const {
    name,
    targetAudience,
    benefits,
    includedTests,
    walkInPrice,
    homeVisitPrice,
    gender,
    order
  } = req.body
  if (!name?.trim()) return next(new AppError('Package name is required.', 400))
  if (walkInPrice == null || homeVisitPrice == null)
    return next(
      new AppError('walkInPrice and homeVisitPrice are required.', 400)
    )
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const pkg = await WellnessPackage.create({
    name: name.trim(),
    slug,
    targetAudience,
    benefits,
    includedTests: Array.isArray(includedTests)
      ? includedTests
      : includedTests
      ? String(includedTests)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [],
    walkInPrice: Number(walkInPrice),
    homeVisitPrice: Number(homeVisitPrice),
    gender: gender || 'all',
    order: order ? Number(order) : 0
  })
  sendSuccess(res, 201, 'Wellness package created.', { package: pkg })
})

exports.updateWellnessPackage = asyncHandler(async (req, res, next) => {
  const {
    name,
    targetAudience,
    benefits,
    includedTests,
    walkInPrice,
    homeVisitPrice,
    gender,
    order,
    isActive
  } = req.body
  const update = { targetAudience, benefits, gender, isActive }
  if (name?.trim()) {
    update.name = name.trim()
    update.slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }
  if (includedTests !== undefined) {
    update.includedTests = Array.isArray(includedTests)
      ? includedTests
      : String(includedTests)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
  }
  if (walkInPrice !== undefined) update.walkInPrice = Number(walkInPrice)
  if (homeVisitPrice !== undefined)
    update.homeVisitPrice = Number(homeVisitPrice)
  if (order !== undefined) update.order = Number(order)
  const pkg = await WellnessPackage.findByIdAndUpdate(req.params.id, update, {
    returnDocument: 'after',
    runValidators: true
  })
  if (!pkg) return next(new AppError('Wellness package not found.', 404))
  sendSuccess(res, 200, 'Wellness package updated.', { package: pkg })
})

exports.deleteWellnessPackage = asyncHandler(async (req, res, next) => {
  const pkg = await WellnessPackage.findByIdAndDelete(req.params.id)
  if (!pkg) return next(new AppError('Wellness package not found.', 404))
  sendSuccess(res, 200, 'Wellness package deleted.')
})

// ── Walk-in lab registration (receptionist creates request on behalf of patient) ──
exports.createWalkInLabRequest = asyncHandler(async (req, res, next) => {
  const {
    patientName,
    patientPhone,
    patientEmail,
    tests: rawTests,
    paymentMethod,
    totalAmount: rawTotal,
    notes,
    wellnessPackageId
  } = req.body

  if (!patientName?.trim() || !patientPhone?.trim()) {
    return next(new AppError('Patient name and phone are required.', 400))
  }

  // Resolve tests + amount from wellness package or direct input
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

  // Find existing patient by phone or email
  const orConditions = []
  if (patientPhone) orConditions.push({ phone: patientPhone.trim() })
  if (patientEmail)
    orConditions.push({ email: patientEmail.toLowerCase().trim() })

  let patient = orConditions.length
    ? await User.findOne({ $or: orConditions, role: 'patient' })
    : null

  // Create guest patient account if not found
  if (!patient) {
    const guestEmail = patientEmail?.trim()
      ? patientEmail.toLowerCase().trim()
      : `walkin_${Date.now()}_${patientPhone
          .replace(/\D/g, '')
          .slice(-8)}@ibamhealth.guest`
    patient = await User.create({
      name: patientName.trim(),
      email: guestEmail,
      phone: patientPhone.trim(),
      password: crypto.randomBytes(16).toString('hex'),
      role: 'patient',
      isVerified: false
    })
  }

  const amountNaira = Number(totalAmount) || 0

  const request = await DiagnosticsRequest.create({
    patient: patient._id,
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
    walkInExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    registeredBy: req.user._id,
    ...(wellnessPkg ? { wellnessPackage: wellnessPkg._id } : {})
  })

  // Record payment immediately for POS / transfer — store in kobo (consistent with Paystack)
  const validMethods = ['walk_in_cash', 'pos', 'direct_transfer']
  if (
    paymentMethod &&
    validMethods.includes(paymentMethod) &&
    amountNaira > 0
  ) {
    const reference = `ibam_wk_${crypto
      .randomUUID()
      .replace(/-/g, '')
      .slice(0, 12)}`
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

  const bookingRef = `#${request._id.toString().slice(-8).toUpperCase()}`

  // Notify patient in-app + email (fire-and-forget)
  createNotification({
    userId: patient._id,
    type: 'lab_request_placed',
    title: 'Lab Test Registered for You',
    message: `iBam Health has registered a lab test on your behalf. Log in to view and track your results.`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  const hasRealEmail =
    patient.email && !patient.email.includes('@ibamhealth.guest')
  if (hasRealEmail) {
    sendWalkInPatientEmail({
      email: patient.email,
      name: patient.name,
      labName: 'iBam Health',
      tests,
      isNew: false
    }).catch(() => {})
  }

  // Notify other admins so they have visibility (fire-and-forget)
  notifyAdmins({
    type: 'lab_walk_in_registered',
    title: 'Walk-In Registered',
    message: `${req.user.name || 'Admin'} registered a walk-in for ${
      patient.name
    } (${tests.slice(0, 2).join(', ')}${
      tests.length > 2 ? ` +${tests.length - 2} more` : ''
    }).`,
    metadata: { requestId: request._id }
  }).catch(() => {})

  // Admin email alert to lab_admins
  User.find({
    role: 'admin',
    adminRole: { $in: ['super_admin', 'lab_admin'] },
    isActive: true
  })
    .select('email')
    .lean()
    .then(admins => {
      const emails = admins
        .filter(a => String(a._id) !== String(req.user._id))
        .map(a => a.email)
        .filter(Boolean)
      if (!emails.length) return
      sendWalkInAdminEmail({
        emails,
        patientName: patient.name,
        labName: 'iBam Health (Admin)',
        registeredBy: req.user.name || 'Admin',
        tests,
        totalAmount: amountNaira,
        paymentMethod
      })
    })
    .catch(() => {})

  sendSuccess(res, 201, 'Walk-in lab request created.', {
    request,
    patient: { name: patient.name, phone: patient.phone, email: patient.email },
    bookingRef
  })
})

// ── Lab account creation for existing lab ──────────────────────────────────
exports.createLabAccount = asyncHandler(async (req, res, next) => {
  const lab = await LabPartner.findById(req.params.id)
  if (!lab) return next(new AppError('Lab not found.', 404))
  if (lab.user)
    return next(
      new AppError('This lab already has a user account linked.', 409)
    )

  const { name, email, phone, password } = req.body
  if (!name || !email || !password)
    return next(new AppError('name, email and password are required.', 400))

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing)
    return next(new AppError('A user with that email already exists.', 409))

  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password,
    role: 'lab_partner',
    isVerified: true,
    isActive: true,
    kycStatus: 'approved'
  })

  lab.user = user._id
  if (!lab.email) lab.email = email
  await lab.save()

  await createNotification({
    userId: user._id,
    type: 'partner_approved',
    title: 'Lab Account Created',
    message: `Your account for ${lab.name} has been set up by an admin. You can now log in on the mobile app.`
  })

  sendAccountCreatedEmail({ email, name, password, role: 'lab_partner' }).catch(
    err => console.error('[Email] Lab assignee account:', err.message)
  )

  const populated = await LabPartner.findById(lab._id).populate(
    'user',
    'name email isActive'
  )
  sendSuccess(res, 201, 'Lab account created.', { user, lab: populated })
})

// ── Admin user management ───────────────────────────────────────────────────
exports.getAdminUsers = asyncHandler(async (req, res) => {
  const admins = await User.find({ role: { $in: ['admin', 'lab_scientist'] } })
    .select('name email adminRole role isActive createdAt managedLabId')
    .sort({ createdAt: -1 })
  sendSuccess(res, 200, 'Admin users retrieved.', { admins })
})

exports.createAdminUser = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    password,
    adminRole = 'support_admin',
    managedLabId
  } = req.body
  if (!name || !email || !password)
    return next(new AppError('name, email and password are required.', 400))
  if (adminRole === 'lab_admin' && !managedLabId)
    return next(
      new AppError('managedLabId is required for lab_admin accounts.', 400)
    )

  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing)
    return next(new AppError('A user with that email already exists.', 409))

  const user = await User.create({
    name,
    email,
    password,
    role: 'admin',
    adminRole,
    isVerified: true,
    isActive: true,
    ...(managedLabId ? { managedLabId } : {})
  })

  // Welcome email with login credentials
  sendAccountCreatedEmail({
    email,
    name,
    password,
    role: 'admin',
    adminRole
  }).catch(err => console.error('[Email] Admin account created:', err.message))
  logAction(
    req.user,
    `Created admin: ${adminRole}`,
    'User',
    user._id,
    { adminRole, managedLabId: managedLabId || null },
    req
  )

  sendSuccess(res, 201, 'Admin user created.', {
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      adminRole: user.adminRole,
      isActive: user.isActive,
      managedLabId: user.managedLabId
    }
  })
})

exports.updateAdminRole = asyncHandler(async (req, res, next) => {
  const { adminRole } = req.body
  const VALID = [
    'super_admin',
    'lab_admin',
    'finance_admin',
    'support_admin',
    'ops_admin'
  ]
  if (!VALID.includes(adminRole))
    return next(new AppError('Invalid adminRole.', 400))

  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'admin' },
    { adminRole },
    { new: true, select: 'name email adminRole isActive' }
  )
  if (!user) return next(new AppError('Admin user not found.', 404))

  // Prevent demoting yourself
  if (
    req.user._id.toString() === user._id.toString() &&
    adminRole !== 'super_admin'
  ) {
    return next(new AppError('You cannot change your own role.', 403))
  }

  logAction(
    req.user,
    'Updated admin role',
    'User',
    user._id,
    { adminRole },
    req
  )
  sendSuccess(res, 200, 'Admin role updated.', { user })
})

exports.toggleAdminUser = asyncHandler(async (req, res, next) => {
  const target = await User.findOne({
    _id: req.params.id,
    role: { $in: ['admin', 'lab_scientist'] }
  })
  if (!target) return next(new AppError('Staff user not found.', 404))
  if (req.user._id.toString() === target._id.toString()) {
    return next(new AppError('You cannot deactivate your own account.', 403))
  }

  target.isActive = !target.isActive
  await target.save()
  logAction(
    req.user,
    target.isActive ? 'Activated admin account' : 'Deactivated admin account',
    'User',
    target._id,
    { targetEmail: target.email, adminRole: target.adminRole },
    req
  )
  sendSuccess(
    res,
    200,
    `Admin ${target.isActive ? 'activated' : 'deactivated'}.`,
    {
      user: {
        _id: target._id,
        name: target.name,
        email: target.email,
        adminRole: target.adminRole,
        isActive: target.isActive
      }
    }
  )
})

exports.deleteAdminUser = asyncHandler(async (req, res, next) => {
  const target = await User.findOne({
    _id: req.params.id,
    role: { $in: ['admin', 'lab_scientist'] }
  })
  if (!target) return next(new AppError('Staff user not found.', 404))
  if (req.user._id.toString() === target._id.toString()) {
    return next(new AppError('You cannot delete your own account.', 403))
  }

  await User.findByIdAndDelete(target._id)
  logAction(
    req.user,
    'Deleted admin account',
    'User',
    target._id,
    { targetEmail: target.email, adminRole: target.adminRole },
    req
  )
  sendSuccess(res, 200, 'Admin user permanently deleted.')
})
