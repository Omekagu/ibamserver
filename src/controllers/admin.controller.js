const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Specialization = require('../models/Specialization');
const PlatformService = require('../models/PlatformService');
const LabTest = require('../models/LabTest');
const WellnessPackage = require('../models/WellnessPackage');
const Appointment = require('../models/Appointment');
const Consultation = require('../models/Consultation');
const Message = require('../models/Message');
const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const PharmacyOrder = require('../models/PharmacyOrder');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const DoctorEarning = require('../models/DoctorEarning');
const PartnerEarning = require('../models/PartnerEarning');
const LabPartner = require('../models/LabPartner');
const PharmacyPartner = require('../models/PharmacyPartner');
const AuditLog = require('../models/AuditLog');
const Triage = require('../models/Triage');
const PlatformSettings = require('../models/PlatformSettings');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { createNotification } = require('../services/notification.service');
const { sendPushNotifications } = require('../services/push.service');
const { sendBroadcastEmail, sendAdminAlertEmail, sendAccountCreatedEmail, sendOTPEmail } = require('../services/email.service');
const { createTransferRecipient, initiateTransfer } = require('../services/paystack.service');
const crypto = require('crypto');

// Silently attempt Paystack auto-payout for partner earnings on manual confirm
async function tryAutoPartnerPayout (earning, partnerType) {
  try {
    const settings = await PlatformSettings.findOne().lean();
    if (!settings?.paystackEnabled) return;
    const key = settings.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY;
    if (!key) return;
    const Profile = partnerType === 'pharmacy' ? PharmacyPartner : LabPartner;
    const profile = await Profile.findOne({ user: earning.partner }).lean();
    const bank = profile?.bankAccount;
    if (!bank?.accountNumber || !bank?.bankCode) return;
    const recipient = await createTransferRecipient({
      name: bank.accountName || earning.partnerName || 'Partner',
      accountNumber: bank.accountNumber,
      bankCode: bank.bankCode,
    });
    await initiateTransfer({
      amount: earning.netAmount,
      recipient: recipient.recipient_code,
      reason: `iBam Health payout – ${earning.partnerName || partnerType}`,
    });
    await PartnerEarning.findByIdAndUpdate(earning._id, { payoutStatus: 'paid', paidAt: new Date() });
  } catch { /* non-fatal */ }
}
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.getDashboard = asyncHandler(async (req, res) => {
  const [totalUsers, totalDoctors, totalAppointments, revenueByType, activeSubscriptions] =
    await Promise.all([
      User.countDocuments(),
      Doctor.countDocuments({ isApproved: true }),
      Appointment.countDocuments(),
      Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: '$type', total: { $sum: '$amount' } } },
      ]),
      Subscription.countDocuments({ status: 'active' }),
    ]);

  const revenue = { total: 0, consultation: 0, pharmacy: 0, lab_test: 0, subscription: 0, wellness_package: 0 };
  for (const r of revenueByType) {
    revenue.total += r.total;
    if (r._id && r._id in revenue) revenue[r._id] = r.total;
  }

  sendSuccess(res, 200, 'Dashboard stats retrieved.', {
    totalUsers,
    totalDoctors,
    totalAppointments,
    totalRevenue: revenue.total,
    revenue,
    activeSubscriptions,
  });
});

exports.getDoctors = asyncHandler(async (req, res) => {
  const { approved, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (approved !== undefined) filter.isApproved = approved === 'true';

  const doctors = await Doctor.find(filter)
    .populate('user', 'name email phone isActive')
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Doctor.countDocuments(filter);
  sendSuccess(res, 200, 'Doctors retrieved.', { doctors, total });
});

exports.approveDoctor = asyncHandler(async (req, res, next) => {
  const { isApproved = true } = req.body;
  const doctor = await Doctor.findById(req.params.id);
  if (!doctor) return next(new AppError('Doctor not found.', 404));

  doctor.isApproved = isApproved;
  if (isApproved) {
    doctor.approvedBy = req.user._id;
    doctor.approvedAt = new Date();
    doctor.kycStatus  = 'approved';
  } else {
    doctor.kycStatus = 'rejected';
  }
  await doctor.save();

  // Mirror status on the User so GET /kyc/status reflects approval immediately
  await User.findByIdAndUpdate(doctor.user, {
    kycStatus: isApproved ? 'approved' : 'rejected',
  });

  await createNotification({
    userId: doctor.user,
    type: isApproved ? 'doctor_approved' : 'doctor_rejected',
    title: isApproved ? 'Account Approved' : 'Application Rejected',
    message: isApproved
      ? 'Your doctor account has been approved. You can now receive appointments.'
      : 'Your doctor account application has been reviewed and was not approved. Please contact support for more information.',
    emailData: {},
  });

  sendSuccess(res, 200, isApproved ? 'Doctor approved.' : 'Doctor rejected.', { doctor });
});

exports.getUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 50, search } = req.query;
  const filter = {};
  if (role && role !== 'all') filter.role = role;
  if (search) {
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
    ];
  }
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await User.countDocuments(filter);
  sendSuccess(res, 200, 'Users retrieved.', { users, total });
});

exports.getUserProfile = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) return next(new AppError('User not found.', 404));

  let profile = null;
  if (user.role === 'doctor') {
    profile = await Doctor.findOne({ user: user._id })
      .populate('user', 'name email phone')
      .lean();
  } else if (user.role === 'pharmacy_partner') {
    profile = await PharmacyPartner.findOne({ user: user._id }).lean();
  } else if (user.role === 'lab_partner') {
    profile = await LabPartner.findOne({ user: user._id }).lean();
  }

  sendSuccess(res, 200, 'User profile retrieved.', { user, profile });
});

exports.suspendUser = asyncHandler(async (req, res, next) => {
  const { isActive } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: isActive ?? false }, { new: true });
  if (!user) return next(new AppError('User not found.', 404));
  sendSuccess(res, 200, 'User updated.', { user });
});

exports.getAppointments = asyncHandler(async (req, res) => {
  const { status, doctorId, patientId, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (doctorId) filter.doctor = doctorId;
  if (patientId) filter.patient = patientId;

  const appointments = await Appointment.find(filter)
    .populate('patient', 'name')
    .populate('doctor', 'name')
    .sort({ scheduledAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Appointment.countDocuments(filter);
  sendSuccess(res, 200, 'Appointments retrieved.', { appointments, total });
});

exports.getPayments = asyncHandler(async (req, res) => {
  const { status, type, method, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type)   filter.type   = type;
  if (method) filter.method = method;

  const payments = await Payment.find(filter)
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Payment.countDocuments(filter);
  sendSuccess(res, 200, 'Payments retrieved.', { payments, total });
});

exports.confirmPayment = asyncHandler(async (req, res, next) => {
  const { adminNotes } = req.body;
  const payment = await Payment.findById(req.params.id);
  if (!payment) return next(new AppError('Payment not found.', 404));
  if (payment.status === 'success') return next(new AppError('Payment is already confirmed.', 400));

  payment.status     = 'success';
  if (adminNotes) payment.adminNotes = adminNotes;
  await payment.save();

  // Confirm the related service record
  if (payment.type === 'consultation' && payment.serviceRef) {
    const appt = await Appointment.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'confirmed' },
      { new: true }
    );
    if (appt) {
      const Availability = require('../models/Availability');
      const scheduledDate = new Date(appt.scheduledAt);
      const slotTime = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;
      await Availability.findOneAndUpdate(
        { doctor: appt.doctor, isActive: true, 'slots.startTime': slotTime },
        { $set: { 'slots.$.isBooked': true } }
      );
    }
  }
  if (payment.type === 'pharmacy' && payment.serviceRef) {
    const order = await PharmacyOrder.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'processing' },
      { new: true }
    ).populate('pharmacy', 'user name');
    if (order?.pharmacy?.user) {
      const gross = payment.amount / 100;
      const cut   = Math.round(gross * 0.1 * 100) / 100;
      const earning = await PartnerEarning.create({
        partner:     order.pharmacy.user,
        partnerType: 'pharmacy',
        partnerName: order.pharmacy.name,
        serviceRef:  payment.serviceRef,
        grossAmount: gross,
        platformCut: cut,
        netAmount:   gross - cut,
      });
      tryAutoPartnerPayout(earning, 'pharmacy');
    }
  }
  if (payment.type === 'lab_test' && payment.serviceRef) {
    const diagReq = await DiagnosticsRequest.findByIdAndUpdate(
      payment.serviceRef,
      { paymentRef: payment._id, status: 'assigned' },
      { new: true }
    ).populate('lab', 'user name');
    if (diagReq?.lab?.user) {
      const gross = payment.amount / 100;
      const cut   = Math.round(gross * 0.1 * 100) / 100;
      const earning = await PartnerEarning.create({
        partner:     diagReq.lab.user,
        partnerType: 'lab',
        partnerName: diagReq.lab.name,
        serviceRef:  payment.serviceRef,
        grossAmount: gross,
        platformCut: cut,
        netAmount:   gross - cut,
      });
      tryAutoPartnerPayout(earning, 'lab');
    }
  }

  const typeLabels = { consultation: 'Doctor Appointment', pharmacy: 'Pharmacy Order', lab_test: 'Lab Test', subscription: 'Subscription' };
  // Notify the user
  await createNotification({
    userId: payment.user,
    type: 'payment_success',
    title: 'Payment Confirmed',
    message: `Your bank transfer of ₦${(payment.amount / 100).toLocaleString()} has been confirmed by admin.`,
    metadata: { paymentId: payment._id },
    emailData: {
      amount: payment.amount / 100,
      description: typeLabels[payment.type] || payment.type,
    },
  });

  sendSuccess(res, 200, 'Payment confirmed.', { payment });
});

exports.getPayouts = asyncHandler(async (req, res) => {
  const PayoutRequest = require('../models/PayoutRequest');
  const { status, type } = req.query;
  const results = [];

  // Doctor earnings (individual records, still using DoctorEarning)
  if (!type || type === 'doctor') {
    const filter = {};
    if (status) filter.payoutStatus = status;
    const docs = await DoctorEarning.find(filter)
      .populate('doctor', 'name email')
      .populate({ path: 'doctor', populate: { path: 'doctor', model: 'Doctor', select: 'bankAccount' } })
      .sort({ createdAt: -1 });
    const doctorProfiles = await Doctor.find({ user: { $in: docs.map(d => d.doctor?._id).filter(Boolean) } }).lean();
    const bankMap = {};
    doctorProfiles.forEach(p => { bankMap[String(p.user)] = p.bankAccount; });
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
        isDoctor: true,
      });
    });
  }

  // Pharmacy & lab — use consolidated PayoutRequests
  if (!type || type === 'pharmacy' || type === 'lab') {
    const filter = {};
    if (status) filter.status = status;
    if (type === 'pharmacy') filter.partnerType = 'pharmacy';
    else if (type === 'lab') filter.partnerType = 'lab';
    const requests = await PayoutRequest.find(filter)
      .populate('partner', 'name email')
      .sort({ requestedAt: -1 });
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
        earningCount: r.earningIds?.length ?? 0,
      });
    });
  }

  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendSuccess(res, 200, 'Payouts retrieved.', { earnings: results });
});

exports.approvePayout = asyncHandler(async (req, res, next) => {
  const PayoutRequest = require('../models/PayoutRequest');

  // Try DoctorEarning first
  const doctorEarning = await DoctorEarning.findById(req.params.id);
  if (doctorEarning) {
    if (doctorEarning.payoutStatus !== 'requested') return next(new AppError('Payout not in requested state.', 400));
    doctorEarning.payoutStatus = 'paid';
    doctorEarning.paidAt = new Date();
    await doctorEarning.save();
    await createNotification({
      userId: doctorEarning.doctor,
      type: 'payout_processed',
      title: 'Payout Processed',
      message: `Your payout of ₦${doctorEarning.netAmount.toLocaleString('en-NG')} has been processed.`,
    });
    return sendSuccess(res, 200, 'Payout approved.', { earning: doctorEarning });
  }

  // Partner payout request (consolidated)
  const request = await PayoutRequest.findById(req.params.id);
  if (!request) return next(new AppError('Payout request not found.', 404));
  if (request.status !== 'requested') return next(new AppError('Payout not in requested state.', 400));

  // Try Paystack auto-transfer
  let transferred = false;
  const bank = request.bankAccount;
  if (bank?.accountNumber && bank?.bankCode) {
    try {
      const settings = await PlatformSettings.findOne().lean();
      const key = settings?.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY;
      if (settings?.paystackEnabled && key) {
        const recipient = await createTransferRecipient({
          name: bank.accountName || request.partnerName || 'Partner',
          accountNumber: bank.accountNumber,
          bankCode: bank.bankCode,
        });
        await initiateTransfer({
          amount: request.totalNet,
          recipient: recipient.recipient_code,
          reason: `iBam Health payout – ${request.partnerName}`,
        });
        transferred = true;
      }
    } catch { /* fall through to manual */ }
  }

  request.status = 'paid';
  request.processedAt = new Date();
  await request.save();

  await PartnerEarning.updateMany(
    { _id: { $in: request.earningIds } },
    { payoutStatus: 'paid', paidAt: new Date() }
  );

  await createNotification({
    userId: request.partner,
    type: 'payout_processed',
    title: 'Payout Processed',
    message: `Your payout of ₦${request.totalNet.toLocaleString('en-NG')} has been ${transferred ? 'transferred to your bank account' : 'processed'}.`,
  });

  sendSuccess(res, 200, 'Payout approved.', { transferred });
});

exports.getPartners = asyncHandler(async (req, res) => {
  const [labs, pharmacies] = await Promise.all([
    LabPartner.find(),
    PharmacyPartner.find(),
  ]);
  sendSuccess(res, 200, 'Partners retrieved.', { labs, pharmacies });
});

exports.updateTriageQuestions = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, 'Triage question bank update received.', { note: 'Persist to DB in v2.' });
});

// ─── Live monitoring ────────────────────────────────────
exports.getLiveConsultations = asyncHandler(async (req, res) => {
  const consultations = await Consultation.find({ status: 'active' })
    .populate({
      path: 'appointment',
      populate: [
        { path: 'patient', select: 'name email phone' },
        { path: 'doctor', select: 'name email' },
      ],
    })
    .sort({ startedAt: -1 });
  sendSuccess(res, 200, 'Live consultations retrieved.', { consultations });
});

exports.getAllConsultations = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const consultations = await Consultation.find(filter)
    .populate({
      path: 'appointment',
      populate: [
        { path: 'patient', select: 'name email' },
        { path: 'doctor', select: 'name email' },
      ],
    })
    .sort({ startedAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Consultation.countDocuments(filter);
  sendSuccess(res, 200, 'Consultations retrieved.', { consultations, total });
});

exports.getConsultationMessages = asyncHandler(async (req, res, next) => {
  const consultation = await Consultation.findById(req.params.id);
  if (!consultation) return next(new AppError('Consultation not found.', 404));

  const messages = await Message.find({ consultation: req.params.id })
    .populate('sender', 'name role')
    .sort({ createdAt: 1 });
  sendSuccess(res, 200, 'Messages retrieved.', { messages });
});

// ─── Pharmacy management ────────────────────────────────
exports.getPharmacies = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const pharmacies = await PharmacyPartner.find(filter)
    .populate('user', 'name email isActive')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await PharmacyPartner.countDocuments(filter);
  sendSuccess(res, 200, 'Pharmacies retrieved.', { pharmacies, total });
});

exports.updatePharmacyStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  if (!['pending', 'active', 'inactive', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status.', 400));
  }
  const pharmacy = await PharmacyPartner.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!pharmacy) return next(new AppError('Pharmacy not found.', 404));

  if (pharmacy.user) {
    const isActive = status === 'active';
    await User.findByIdAndUpdate(pharmacy.user, { isActive });
    if (status === 'active') {
      await createNotification({
        userId: pharmacy.user,
        type: 'partner_approved',
        title: 'Pharmacy Account Approved',
        message: 'Your pharmacy application has been approved. You can now receive orders.',
        emailData: { partnerType: 'Pharmacy' },
      });
    } else if (status === 'suspended' || status === 'inactive') {
      await createNotification({
        userId: pharmacy.user,
        type: 'partner_rejected',
        title: 'Pharmacy Account ' + (status === 'suspended' ? 'Suspended' : 'Deactivated'),
        message: `Your pharmacy account has been ${status}. Please contact support for more information.`,
        emailData: { partnerType: 'Pharmacy' },
      });
    }
  }

  sendSuccess(res, 200, 'Pharmacy status updated.', { pharmacy });
});

// ─── Lab management ─────────────────────────────────────
exports.getLabs = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const labs = await LabPartner.find(filter)
    .populate('user', 'name email isActive')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await LabPartner.countDocuments(filter);
  sendSuccess(res, 200, 'Labs retrieved.', { labs, total });
});

exports.updateLabTests = asyncHandler(async (req, res, next) => {
  const { testsOffered } = req.body;
  if (!Array.isArray(testsOffered)) return next(new AppError('testsOffered must be an array.', 400));
  const cleaned = testsOffered
    .filter(t => t.name && t.name.trim())
    .map(t => ({
      name: t.name.trim(),
      price: Number(t.price) || 0,
      turnaroundHours: Number(t.turnaroundHours) || 24,
    }));
  const lab = await LabPartner.findByIdAndUpdate(
    req.params.id,
    { testsOffered: cleaned },
    { new: true }
  );
  if (!lab) return next(new AppError('Lab not found.', 404));
  sendSuccess(res, 200, 'Lab tests updated.', { lab });
});

exports.updateLabStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  if (!['pending', 'active', 'inactive', 'suspended'].includes(status)) {
    return next(new AppError('Invalid status.', 400));
  }
  const lab = await LabPartner.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!lab) return next(new AppError('Lab not found.', 404));

  if (lab.user) {
    const isActive = status === 'active';
    await User.findByIdAndUpdate(lab.user, { isActive });
    if (status === 'active') {
      await createNotification({
        userId: lab.user,
        type: 'partner_approved',
        title: 'Lab Account Approved',
        message: 'Your lab application has been approved. You can now receive test requests.',
        emailData: { partnerType: 'Laboratory' },
      });
    } else if (status === 'suspended' || status === 'inactive') {
      await createNotification({
        userId: lab.user,
        type: 'partner_rejected',
        title: 'Lab Account ' + (status === 'suspended' ? 'Suspended' : 'Deactivated'),
        message: `Your lab account has been ${status}. Please contact support for more information.`,
        emailData: { partnerType: 'Laboratory' },
      });
    }
  }

  sendSuccess(res, 200, 'Lab status updated.', { lab });
});

// ─── Diagnostics management ─────────────────────────────
exports.getDiagnosticsRequests = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (status) filter.status = status;

  if (search && search.trim()) {
    const q = search.trim();
    const isObjectId = /^[0-9a-f]{24}$/i.test(q);
    if (isObjectId) {
      // Match request ID, patient user ID, or payment/transaction ID
      filter.$or = [{ _id: q }, { patient: q }, { paymentRef: q }];
    } else {
      // Search by patient name, email, or phone
      const patients = await User.find({
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
        ],
      }, '_id').lean();
      if (!patients.length) {
        return sendSuccess(res, 200, 'No matching requests found.', { requests: [], total: 0 });
      }
      filter.patient = { $in: patients.map(p => p._id) };
    }
  }

  const requests = await DiagnosticsRequest.find(filter)
    .populate('patient', 'name email phone')
    .populate('lab', 'name address phone')
    .populate({ path: 'paymentRef', select: 'status amount reference' })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await DiagnosticsRequest.countDocuments(filter);
  sendSuccess(res, 200, 'Diagnostics requests retrieved.', { requests, total });
});

exports.getSubscriptions = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const subscriptions = await Subscription.find(filter)
    .populate('user', 'name email')
    .populate('plan', 'name price interval')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Subscription.countDocuments(filter);
  sendSuccess(res, 200, 'Subscriptions retrieved.', { subscriptions, total });
});

// ─── All orders (pharmacy) ───────────────────────────────
exports.getAllOrders = asyncHandler(async (req, res) => {
  const { status, orderType, pharmacyId, page = 1, limit = 25 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (orderType) filter.orderType = orderType;
  if (pharmacyId) filter.pharmacy = pharmacyId;

  const orders = await PharmacyOrder.find(filter)
    .populate('patient', 'name email phone')
    .populate('pharmacy', 'name address phone')
    .populate('prescription', 'medications diagnosis')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await PharmacyOrder.countDocuments(filter);
  sendSuccess(res, 200, 'All orders retrieved.', { orders, total });
});

// ─── All lab / diagnostics requests ─────────────────────
// (re-exported alias — getDiagnosticsRequests already covers this)

// ─── Audit log ───────────────────────────────────────────
exports.getAuditLogs = asyncHandler(async (req, res) => {
  const { action, adminId, page = 1, limit = 30 } = req.query;
  const filter = {};
  if (action) filter.action = new RegExp(action, 'i');
  if (adminId) filter.admin = adminId;

  const logs = await AuditLog.find(filter)
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await AuditLog.countDocuments(filter);
  sendSuccess(res, 200, 'Audit logs retrieved.', { logs, total });
});

// ─── Platform settings ───────────────────────────────────
exports.getPublicContent = asyncHandler(async (req, res) => {
  let settings = await PlatformSettings.findOne().select('healthTips announcement');
  if (!settings) settings = await PlatformSettings.create({});

  const [specializations, services, plans, labTests, wellnessPackages] = await Promise.all([
    Specialization.find({ isActive: true }).sort({ order: 1, name: 1 }).select('name description'),
    PlatformService.find({ isActive: true }).sort({ order: 1 }).select('-__v'),
    SubscriptionPlan.find({ isActive: true }).sort({ price: 1 }).select('-__v'),
    LabTest.find({ isActive: true }).sort({ order: 1, name: 1 }).select('name category walkInPrice homeVisitPrice estimatedPrice turnaroundHours'),
    WellnessPackage.find({ isActive: true }).sort({ order: 1, name: 1 }).select('-__v'),
  ]);

  // Re-fetch only paystackPublicKey to avoid over-fetching above
  const pkSettings = await PlatformSettings.findOne().select('paystackPublicKey').lean();

  sendSuccess(res, 200, 'Public content retrieved.', {
    healthTips: settings.healthTips ?? [],
    announcement: settings.announcement ?? '',
    specializations,
    services,
    plans,
    labTests,
    wellnessPackages,
    paystackPublicKey: pkSettings?.paystackPublicKey ?? '',
  });
});

exports.getSettings = asyncHandler(async (req, res) => {
  let settings = await PlatformSettings.findOne().lean();
  if (!settings) settings = await PlatformSettings.create({});
  // Never expose secret key to client — send a flag instead
  const out = { ...settings, paystackSecretKey: undefined, paystackKeySet: !!(settings.paystackSecretKey) };
  sendSuccess(res, 200, 'Settings retrieved.', { settings: out });
});

exports.requestSettingsOtp = asyncHandler(async (req, res) => {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await PlatformSettings.findOneAndUpdate(
    {},
    { settingsOtpHash: hash, settingsOtpExpiry: expiry },
    { upsert: true }
  );

  await sendOTPEmail(req.user.email, otp);
  sendSuccess(res, 200, 'OTP sent to your admin email.');
});

exports.updateSettings = asyncHandler(async (req, res, next) => {
  const {
    paystackEnabled, paystackSecretKey, paystackPublicKey, otp,
    directPaymentEnabled, companyBankName, companyAccountNumber, companyAccountName, companyBankCode, directPaymentNote,
    announcement, healthTips,
  } = req.body;

  // OTP required when changing API keys
  if (paystackSecretKey !== undefined || paystackPublicKey !== undefined) {
    const current = await PlatformSettings.findOne().select('+settingsOtpHash +settingsOtpExpiry').lean();
    const currentHasKey = !!(current?.paystackSecretKey);

    if (currentHasKey) {
      if (!otp) return next(new AppError('OTP required to update API keys.', 403));
      if (!current.settingsOtpHash || !current.settingsOtpExpiry || current.settingsOtpExpiry < new Date())
        return next(new AppError('OTP expired. Please request a new one.', 403));
      const hash = crypto.createHash('sha256').update(String(otp)).digest('hex');
      if (hash !== current.settingsOtpHash)
        return next(new AppError('Invalid OTP.', 403));
    }
  }

  const update = {};
  if (typeof paystackEnabled       === 'boolean') update.paystackEnabled       = paystackEnabled;
  if (paystackSecretKey            !== undefined) update.paystackSecretKey     = paystackSecretKey;
  if (paystackPublicKey            !== undefined) update.paystackPublicKey     = paystackPublicKey;
  if (typeof directPaymentEnabled  === 'boolean') update.directPaymentEnabled  = directPaymentEnabled;
  if (companyBankName      !== undefined) update.companyBankName      = companyBankName;
  if (companyAccountNumber !== undefined) update.companyAccountNumber = companyAccountNumber;
  if (companyAccountName   !== undefined) update.companyAccountName   = companyAccountName;
  if (companyBankCode      !== undefined) update.companyBankCode      = companyBankCode;
  if (directPaymentNote    !== undefined) update.directPaymentNote    = directPaymentNote;
  if (announcement         !== undefined) update.announcement         = announcement;
  if (Array.isArray(healthTips))          update.healthTips           = healthTips;

  // Clear OTP after use
  if (otp) { update.settingsOtpHash = null; update.settingsOtpExpiry = null; }

  const settings = await PlatformSettings.findOneAndUpdate({}, update, { upsert: true, new: true }).lean();
  const out = { ...settings, paystackSecretKey: undefined, paystackKeySet: !!(settings.paystackSecretKey) };
  sendSuccess(res, 200, 'Settings updated.', { settings: out });
});

// ─── Plan management ─────────────────────────────────────
exports.listPlans = asyncHandler(async (req, res) => {
  const plans = await SubscriptionPlan.find().sort({ price: 1 });
  sendSuccess(res, 200, 'Plans retrieved.', { plans });
});

exports.createPlan = asyncHandler(async (req, res) => {
  const { name, description, price, interval, features, isActive, featured, paystackPlanCode } = req.body;
  const plan = await SubscriptionPlan.create({ name, description, price, interval, features, isActive, featured, paystackPlanCode });
  sendSuccess(res, 201, 'Plan created.', { plan });
});

exports.updatePlan = asyncHandler(async (req, res, next) => {
  const { name, description, price, interval, features, isActive, featured, paystackPlanCode } = req.body;
  const plan = await SubscriptionPlan.findByIdAndUpdate(
    req.params.id,
    { name, description, price, interval, features, isActive, featured, paystackPlanCode },
    { new: true, runValidators: true }
  );
  if (!plan) return next(new AppError('Plan not found.', 404));
  sendSuccess(res, 200, 'Plan updated.', { plan });
});

exports.deletePlan = asyncHandler(async (req, res, next) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!plan) return next(new AppError('Plan not found.', 404));
  sendSuccess(res, 200, 'Plan deactivated.', { plan });
});

// ─── Drug catalog management ─────────────────────────────
exports.getAllDrugs = asyncHandler(async (req, res) => {
  const pharmacies = await PharmacyPartner.find({ status: 'active' }).select('name address drugsOffered');
  const drugs = pharmacies.flatMap(p =>
    p.drugsOffered.map(d => ({ ...d.toObject(), pharmacyId: p._id, pharmacyName: p.name, pharmacyAddress: p.address }))
  );
  sendSuccess(res, 200, 'All drugs retrieved.', { drugs, total: drugs.length });
});

exports.approveDrug = asyncHandler(async (req, res, next) => {
  const { pharmacyId, drugId } = req.params;
  const { approved } = req.body;
  const pharmacy = await PharmacyPartner.findById(pharmacyId);
  if (!pharmacy) return next(new AppError('Pharmacy not found.', 404));
  const drug = pharmacy.drugsOffered.id(drugId);
  if (!drug) return next(new AppError('Drug not found.', 404));
  drug.adminApproved = approved !== false;
  await pharmacy.save();
  if (pharmacy.user) {
    await createNotification({
      userId: pharmacy.user,
      type: 'drug_approval',
      title: approved !== false ? 'Drug Approved' : 'Drug Rejected',
      message: `Your drug listing "${drug.name}" has been ${approved !== false ? 'approved' : 'rejected'}.`,
      metadata: { pharmacyId, drugId },
      emailData: { approved: approved !== false, drugName: drug.name },
    });
  }
  sendSuccess(res, 200, 'Drug approval updated.', { drug });
});

// ─── Pending approvals ───────────────────────────────────
exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const [orders, testRequests] = await Promise.all([
    PharmacyOrder.find({ requiresApproval: true, adminApprovalStatus: 'pending' })
      .populate('patient', 'name email phone')
      .populate('pharmacy', 'name address')
      .sort({ createdAt: -1 }),
    DiagnosticsRequest.find({ requiresApproval: true, adminApprovalStatus: 'pending' })
      .populate('patient', 'name email phone')
      .populate('lab', 'name address')
      .sort({ createdAt: -1 }),
  ]);
  sendSuccess(res, 200, 'Pending approvals retrieved.', {
    orders,
    testRequests,
    total: orders.length + testRequests.length,
  });
});

exports.approveOrder = asyncHandler(async (req, res, next) => {
  const { approved, note } = req.body;
  const order = await PharmacyOrder.findById(req.params.id).populate('pharmacy', 'name');
  if (!order) return next(new AppError('Order not found.', 404));
  order.adminApprovalStatus = approved ? 'approved' : 'rejected';
  if (!approved) order.status = 'cancelled';
  await order.save();
  await createNotification({
    userId: order.patient,
    type: 'order_approval',
    title: approved ? 'Order Approved' : 'Order Rejected',
    message: approved
      ? 'Your pharmacy order has been approved and is now being processed.'
      : `Your pharmacy order was rejected. ${note || ''}`,
    metadata: { orderId: order._id },
    emailData: { approved: !!approved, note: note || '', pharmacyName: order.pharmacy?.name || 'Pharmacy', items: order.items || [] },
  });
  sendSuccess(res, 200, 'Order approval updated.', { order });
});

exports.approveTestRequest = asyncHandler(async (req, res, next) => {
  const { approved, note } = req.body;
  const req_ = await DiagnosticsRequest.findById(req.params.id);
  if (!req_) return next(new AppError('Test request not found.', 404));
  req_.adminApprovalStatus = approved ? 'approved' : 'rejected';
  if (!approved) req_.status = 'cancelled';
  await req_.save();
  await createNotification({
    userId: req_.patient,
    type: 'test_request_approval',
    title: approved ? 'Test Request Approved' : 'Test Request Rejected',
    message: approved
      ? 'Your lab test request has been approved. You can now proceed with payment.'
      : `Your lab test request was rejected. ${note || ''}`,
    metadata: { requestId: req_._id },
    emailData: { approved: !!approved, tests: req_.tests || [], note: note || '' },
  });
  sendSuccess(res, 200, 'Test request approval updated.', { request: req_ });
});

// ─── Admin-initiated registration ────────────────────────────────────────────

exports.createDoctor = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, specialization, licenseNumber, consultationFee, bio, autoApprove } = req.body;
  if (!name || !email || !password || !specialization || !licenseNumber) {
    return next(new AppError('name, email, password, specialization and licenseNumber are required.', 400));
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return next(new AppError('A user with that email already exists.', 409));

  const existingDoctor = await Doctor.findOne({ licenseNumber });
  if (existingDoctor) return next(new AppError('A doctor with that license number already exists.', 409));

  const user = await User.create({
    name, email, phone: phone || undefined, password,
    role: 'doctor', isVerified: true, isActive: true,
    kycStatus: autoApprove ? 'approved' : 'pending',
  });

  let doctor;
  try {
    const doctorData = {
      user: user._id, specialization, licenseNumber,
      consultationFee: consultationFee || 0, bio: bio || '',
      isApproved: !!autoApprove,
    };
    if (autoApprove) {
      doctorData.kycStatus  = 'approved';
      doctorData.approvedBy = req.user._id;
      doctorData.approvedAt = new Date();
    }
    doctor = await Doctor.create(doctorData);
  } catch (err) {
    await User.findByIdAndDelete(user._id);
    return next(new AppError(`Failed to create doctor profile: ${err.message}`, 500));
  }

  await createNotification({
    userId: user._id,
    type: 'doctor_approved',
    title: autoApprove ? 'Account Created & Approved' : 'Account Created',
    message: autoApprove
      ? 'Your doctor account has been created and approved by an admin. You can log in now.'
      : 'Your doctor account has been created by an admin. Complete your KYC to get approved.',
  });

  sendAccountCreatedEmail({ email, name, password, role: 'doctor' })
    .catch(err => console.error('[Email] Doctor account created:', err.message));

  sendSuccess(res, 201, 'Doctor account created.', { user, doctor });
});

exports.createLab = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, address, licenseNumber, cacNumber, coverageAreas, testsOffered, autoActivate } = req.body;
  if (!name || !email || !password || !address) {
    return next(new AppError('name, email, password and address are required.', 400));
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return next(new AppError('A user with that email already exists.', 409));

  if (licenseNumber) {
    const existingLab = await LabPartner.findOne({ licenseNumber });
    if (existingLab) return next(new AppError('A lab with that license number already exists.', 409));
  }
  if (cacNumber) {
    const existingLab = await LabPartner.findOne({ cacNumber });
    if (existingLab) return next(new AppError('A lab with that CAC number already exists.', 409));
  }

  const user = await User.create({
    name, email, phone: phone || undefined, password,
    role: 'lab_partner', isVerified: true, isActive: true,
    kycStatus: autoActivate ? 'approved' : 'pending',
  });

  let lab;
  try {
    lab = await LabPartner.create({
      user: user._id, name, address,
      phone: phone || '',
      email: email || '',
      licenseNumber: licenseNumber || '',
      cacNumber: cacNumber || '',
      cacVerified: !!autoActivate,
      status: autoActivate ? 'active' : 'pending',
      coverageAreas: Array.isArray(coverageAreas) ? coverageAreas
        : typeof coverageAreas === 'string' ? coverageAreas.split(',').map(s => s.trim()).filter(Boolean) : [],
      testsOffered: Array.isArray(testsOffered) ? testsOffered : [],
    });
  } catch (err) {
    await User.findByIdAndDelete(user._id);
    return next(new AppError(`Failed to create lab profile: ${err.message}`, 500));
  }

  await createNotification({
    userId: user._id,
    type: 'partner_approved',
    title: autoActivate ? 'Lab Account Created & Activated' : 'Lab Account Created',
    message: autoActivate
      ? 'Your diagnostic lab account has been created and activated by an admin.'
      : 'Your diagnostic lab account has been created by an admin. Pending approval.',
  });

  sendAccountCreatedEmail({ email, name, password, role: 'lab_partner' })
    .catch(err => console.error('[Email] Lab account created:', err.message));

  sendSuccess(res, 201, 'Lab account created.', { user, lab });
});

// Admin opens a lab's dashboard without requiring the lab to log in separately.
// Returns a short-lived token (4 h) for that lab's user account.
exports.impersonateLab = asyncHandler(async (req, res, next) => {
  const { signAccessToken } = require('../utils/jwt');
  const lab = await LabPartner.findById(req.params.id).populate('user', '_id name email role isActive');
  if (!lab) return next(new AppError('Lab not found.', 404));
  if (!lab.user) return next(new AppError('Lab has no user account.', 404));
  if (!lab.user.isActive) return next(new AppError('Lab user account is inactive.', 403));

  // Sign a 4-hour token for the lab user; mark as impersonated for audit purposes
  const token = signAccessToken({ id: lab.user._id, impersonatedBy: req.user._id });

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  sendSuccess(res, 200, 'Impersonation token generated.', {
    token,
    labName: lab.name,
    url: `${clientUrl}/lab?token=${token}`,
  });
});

exports.createPharmacy = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, address, licenseNumber, cacNumber, coverageAreas, autoActivate } = req.body;
  if (!name || !email || !password || !address) {
    return next(new AppError('name, email, password and address are required.', 400));
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return next(new AppError('A user with that email already exists.', 409));

  if (licenseNumber) {
    const existingPharmacy = await PharmacyPartner.findOne({ licenseNumber });
    if (existingPharmacy) return next(new AppError('A pharmacy with that license number already exists.', 409));
  }
  if (cacNumber) {
    const existingPharmacy = await PharmacyPartner.findOne({ cacNumber });
    if (existingPharmacy) return next(new AppError('A pharmacy with that CAC number already exists.', 409));
  }

  const user = await User.create({
    name, email, phone: phone || undefined, password,
    role: 'pharmacy_partner', isVerified: true, isActive: true,
    kycStatus: autoActivate ? 'approved' : 'pending',
  });

  let pharmacy;
  try {
    pharmacy = await PharmacyPartner.create({
      user: user._id, name, address,
      phone: phone || '',
      email: email || '',
      licenseNumber: licenseNumber || '',
      cacNumber: cacNumber || '',
      cacVerified: !!autoActivate,
      status: autoActivate ? 'active' : 'pending',
      coverageAreas: Array.isArray(coverageAreas) ? coverageAreas
        : typeof coverageAreas === 'string' ? coverageAreas.split(',').map(s => s.trim()).filter(Boolean) : [],
    });
  } catch (err) {
    await User.findByIdAndDelete(user._id);
    return next(new AppError(`Failed to create pharmacy profile: ${err.message}`, 500));
  }

  await createNotification({
    userId: user._id,
    type: 'partner_approved',
    title: autoActivate ? 'Pharmacy Account Created & Activated' : 'Pharmacy Account Created',
    message: autoActivate
      ? 'Your pharmacy account has been created and activated by an admin.'
      : 'Your pharmacy account has been created by an admin. Pending approval.',
  });

  sendAccountCreatedEmail({ email, name, password, role: 'pharmacy_partner' })
    .catch(err => console.error('[Email] Pharmacy account created:', err.message));

  sendSuccess(res, 201, 'Pharmacy account created.', { user, pharmacy });
});

exports.manualKycVerify = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { kycStatus, reason } = req.body;
  const VALID = ['pending', 'nin_verified', 'face_verified', 'approved', 'rejected'];
  if (!VALID.includes(kycStatus)) return next(new AppError('Invalid kycStatus.', 400));

  const user = await User.findById(userId);
  if (!user) return next(new AppError('User not found.', 404));

  user.kycStatus = kycStatus;
  if (kycStatus === 'approved') user.isVerified = true;
  await user.save();

  // Sync on role-specific profile
  if (user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user: userId });
    if (doctor) {
      doctor.kycStatus  = kycStatus;
      doctor.isApproved = kycStatus === 'approved';
      if (kycStatus === 'approved') { doctor.approvedBy = req.user._id; doctor.approvedAt = new Date(); }
      await doctor.save();
    }
  } else if (user.role === 'lab_partner') {
    await LabPartner.findOneAndUpdate({ user: userId }, {
      cacVerified: kycStatus === 'approved',
      status: kycStatus === 'approved' ? 'active' : kycStatus === 'rejected' ? 'suspended' : 'pending',
    });
  } else if (user.role === 'pharmacy_partner') {
    await PharmacyPartner.findOneAndUpdate({ user: userId }, {
      cacVerified: kycStatus === 'approved',
      status: kycStatus === 'approved' ? 'active' : kycStatus === 'rejected' ? 'suspended' : 'pending',
    });
  }

  const notifMap = {
    approved: { title: 'Account Verified', message: reason || 'Your account has been verified by an admin.' },
    rejected: { title: 'Verification Failed', message: reason || 'Your KYC was rejected by an admin.' },
    nin_verified: { title: 'NIN Verified', message: 'Your NIN has been manually verified by an admin.' },
    face_verified: { title: 'Identity Verified', message: 'Your identity has been manually verified by an admin.' },
    pending: { title: 'KYC Reset', message: 'Your KYC status has been reset. Please resubmit your documents.' },
  };
  const notif = notifMap[kycStatus];
  const notifType = kycStatus === 'approved'
    ? (user.role === 'doctor' ? 'doctor_approved' : 'partner_approved')
    : kycStatus === 'rejected'
    ? (user.role === 'doctor' ? 'doctor_rejected' : 'partner_rejected')
    : 'doctor_approved';
  const partnerType = user.role === 'lab_partner' ? 'Laboratory' : user.role === 'pharmacy_partner' ? 'Pharmacy' : undefined;
  await createNotification({
    userId,
    type: notifType,
    title: notif.title,
    message: notif.message,
    emailData: (kycStatus === 'approved' || kycStatus === 'rejected') ? { partnerType } : undefined,
  });

  sendSuccess(res, 200, 'KYC status updated.', { user });
});

// ─── Broadcast message ────────────────────────────────────────────────────────
// POST /admin/broadcast
// body: { title, message, roles?: string[], channels?: ('push'|'email'|'in_app')[] }
exports.broadcastMessage = asyncHandler(async (req, res, next) => {
  const { title, message, roles, channels = ['push', 'email', 'in_app'] } = req.body;
  if (!title || !message) return next(new AppError('Title and message are required.', 400));

  const filter = { isActive: true };
  if (roles?.length) filter.role = { $in: roles };

  const users = await User.find(filter).select('_id name email expoPushToken').lean();
  if (!users.length) {
    return sendSuccess(res, 200, 'No users matched the filter.', { sent: 0 });
  }

  const results = { inApp: 0, push: 0, email: 0 };

  // In-app (Socket.io) notifications
  if (channels.includes('in_app')) {
    await Promise.all(
      users.map(u =>
        createNotification({ userId: u._id, type: 'general', title, message }).then(() => { results.inApp++; }).catch(() => {})
      )
    );
  }

  // Push notifications (batch)
  if (channels.includes('push')) {
    const tokens = users.map(u => u.expoPushToken).filter(Boolean);
    if (tokens.length) {
      await sendPushNotifications({ tokens, title, body: message, data: { type: 'broadcast' } });
      results.push = tokens.length;
    }
  }

  // Emails (fire-and-forget per user so one failure doesn't abort others)
  if (channels.includes('email')) {
    await Promise.allSettled(
      users.filter(u => u.email).map(u =>
        sendBroadcastEmail({ to: u.email, name: u.name, title, message })
          .then(() => { results.email++; })
          .catch(() => {})
      )
    );
  }

  sendSuccess(res, 200, `Broadcast sent to ${users.length} users.`, { recipients: users.length, ...results });
});

// ─── Specialization management ────────────────────────────────────────────────

exports.listSpecializations = asyncHandler(async (req, res) => {
  const specs = await Specialization.find().sort({ order: 1, name: 1 });
  sendSuccess(res, 200, 'Specializations retrieved.', { specializations: specs });
});

exports.createSpecialization = asyncHandler(async (req, res, next) => {
  const { name, description, order } = req.body;
  if (!name) return next(new AppError('name is required.', 400));
  const spec = await Specialization.create({ name, description, order });
  sendSuccess(res, 201, 'Specialization created.', { specialization: spec });
});

exports.updateSpecialization = asyncHandler(async (req, res, next) => {
  const { name, description, isActive, order } = req.body;
  const spec = await Specialization.findByIdAndUpdate(
    req.params.id,
    { name, description, isActive, order },
    { new: true, runValidators: true }
  );
  if (!spec) return next(new AppError('Specialization not found.', 404));
  sendSuccess(res, 200, 'Specialization updated.', { specialization: spec });
});

exports.deleteSpecialization = asyncHandler(async (req, res, next) => {
  const spec = await Specialization.findByIdAndDelete(req.params.id);
  if (!spec) return next(new AppError('Specialization not found.', 404));
  sendSuccess(res, 200, 'Specialization deleted.');
});

// ─── Platform service management ──────────────────────────────────────────────

exports.listServices = asyncHandler(async (req, res) => {
  const services = await PlatformService.find().sort({ order: 1 });
  sendSuccess(res, 200, 'Services retrieved.', { services });
});

exports.createService = asyncHandler(async (req, res, next) => {
  const { iconName, tagLabel, title, description, steps, visualLabel, visualSub, cta, ctaHref, order } = req.body;
  if (!title || !description || !iconName || !tagLabel) {
    return next(new AppError('iconName, tagLabel, title and description are required.', 400));
  }
  const service = await PlatformService.create({ iconName, tagLabel, title, description, steps, visualLabel, visualSub, cta, ctaHref, order });
  sendSuccess(res, 201, 'Service created.', { service });
});

exports.updateService = asyncHandler(async (req, res, next) => {
  const { iconName, tagLabel, title, description, steps, visualLabel, visualSub, cta, ctaHref, order, isActive } = req.body;
  const service = await PlatformService.findByIdAndUpdate(
    req.params.id,
    { iconName, tagLabel, title, description, steps, visualLabel, visualSub, cta, ctaHref, order, isActive },
    { new: true, runValidators: true }
  );
  if (!service) return next(new AppError('Service not found.', 404));
  sendSuccess(res, 200, 'Service updated.', { service });
});

exports.deleteService = asyncHandler(async (req, res, next) => {
  const service = await PlatformService.findByIdAndDelete(req.params.id);
  if (!service) return next(new AppError('Service not found.', 404));
  sendSuccess(res, 200, 'Service deleted.');
});

// ─── Lab test catalog ──────────────────────────────────────────────────────────

exports.listLabTests = asyncHandler(async (req, res) => {
  const labTests = await LabTest.find().sort({ order: 1, name: 1 });
  sendSuccess(res, 200, 'Lab tests retrieved.', { labTests });
});

exports.createLabTest = asyncHandler(async (req, res, next) => {
  const { name, category, description, walkInPrice, homeVisitPrice, estimatedPrice, turnaroundHours, order } = req.body;
  if (!name) return next(new AppError('Test name is required.', 400));
  const labTest = await LabTest.create({
    name, category, description, turnaroundHours, order,
    walkInPrice:    walkInPrice    ?? estimatedPrice,
    homeVisitPrice: homeVisitPrice ?? estimatedPrice,
    estimatedPrice: estimatedPrice ?? walkInPrice,
  });
  sendSuccess(res, 201, 'Lab test created.', { labTest });
});

exports.updateLabTest = asyncHandler(async (req, res, next) => {
  const { name, category, description, walkInPrice, homeVisitPrice, estimatedPrice, turnaroundHours, order, isActive } = req.body;
  const update = { name, category, description, turnaroundHours, order, isActive };
  if (walkInPrice    !== undefined) update.walkInPrice    = walkInPrice;
  if (homeVisitPrice !== undefined) update.homeVisitPrice = homeVisitPrice;
  if (estimatedPrice !== undefined) update.estimatedPrice = estimatedPrice;
  const labTest = await LabTest.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!labTest) return next(new AppError('Lab test not found.', 404));
  sendSuccess(res, 200, 'Lab test updated.', { labTest });
});

exports.deleteLabTest = asyncHandler(async (req, res, next) => {
  const labTest = await LabTest.findByIdAndDelete(req.params.id);
  if (!labTest) return next(new AppError('Lab test not found.', 404));
  sendSuccess(res, 200, 'Lab test deleted.');
});
