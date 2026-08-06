const { randomUUID } = require('crypto');
const Payment = require('../models/Payment');
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const PharmacyOrder = require('../models/PharmacyOrder');
const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const { initializeTransaction, verifyTransaction } = require('../services/paystack.service');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.initiate = asyncHandler(async (req, res, next) => {
  const { type, serviceId, referenceId, amount } = req.body;
  if (!type || !amount) return next(new AppError('type and amount required.', 400));

  // Normalise: 'appointment_booking' → 'consultation'; referenceId is alias for serviceId
  const paymentType    = type === 'appointment_booking' ? 'consultation' : type;
  const effectiveRefId = serviceId || referenceId;

  const reference = `ibam_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const payment = await Payment.create({
    user: req.user._id,
    amount,
    reference,
    type: paymentType,
    method: 'paystack',
    serviceRef: effectiveRefId,
  });

  const paystackData = await initializeTransaction({
    email: req.user.email,
    amount,
    reference,
    metadata: { type: paymentType, serviceId: effectiveRefId, userId: req.user._id },
  });

  sendSuccess(res, 200, 'Payment initialised.', {
    paymentId: payment._id,
    reference,
    authorizationUrl: paystackData.authorization_url,
  });
});

exports.verify = asyncHandler(async (req, res, next) => {
  const { reference } = req.params;
  const paystackData = await verifyTransaction(reference);

  const payment = await Payment.findOne({ reference });
  if (!payment) return next(new AppError('Payment record not found.', 404));

  if (paystackData.status === 'success') {
    payment.status = 'success';
    payment.paystackRef = paystackData.reference;
    await payment.save();

    if (payment.type === 'consultation' && payment.serviceRef) {
      const appt = await Appointment.findByIdAndUpdate(
        payment.serviceRef,
        { paymentRef: payment._id, status: 'confirmed' },
        { new: true }
      );
      // Ensure the slot stays marked as booked (defensive — book endpoint already does this)
      if (appt) {
        const scheduledDate = new Date(appt.scheduledAt);
        const slotTime = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;
        await Availability.findOneAndUpdate(
          { doctor: appt.doctor, isActive: true, 'slots.startTime': slotTime },
          { $set: { 'slots.$.isBooked': true } }
        );
      }
    }
    if (payment.type === 'pharmacy' && payment.serviceRef) {
      await PharmacyOrder.findByIdAndUpdate(payment.serviceRef, { paymentRef: payment._id, status: 'processing' });
    }
    if (payment.type === 'lab_test' && payment.serviceRef) {
      await DiagnosticsRequest.findByIdAndUpdate(payment.serviceRef, { paymentRef: payment._id });
    }

    const typeLabels = { consultation: 'Doctor Appointment', pharmacy: 'Pharmacy Order', lab_test: 'Lab Test', subscription: 'Subscription' };
    await createNotification({
      userId: req.user._id,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Your payment of ₦${(payment.amount / 100).toLocaleString()} was successful.`,
      metadata: { paymentId: payment._id },
      emailData: { amount: payment.amount / 100, description: typeLabels[payment.type] || payment.type },
    });
  } else {
    payment.status = 'failed';
    await payment.save();

    // On payment failure, cancel the appointment and free the slot
    if (payment.type === 'consultation' && payment.serviceRef) {
      const appt = await Appointment.findByIdAndUpdate(
        payment.serviceRef,
        { status: 'cancelled', cancellationReason: 'Payment failed' },
        { new: true }
      );
      if (appt) {
        const scheduledDate = new Date(appt.scheduledAt);
        const slotTime = `${String(scheduledDate.getHours()).padStart(2, '0')}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`;
        await Availability.findOneAndUpdate(
          { doctor: appt.doctor, isActive: true, 'slots.startTime': slotTime },
          { $set: { 'slots.$.isBooked': false } }
        );
      }
    }
  }

  sendSuccess(res, 200, 'Payment verified.', { payment });
});

exports.webhook = asyncHandler(async (req, res) => {
  // Paystack sends the event type and data
  const event = req.body;
  if (event.event === 'charge.success') {
    const { reference } = event.data;
    const payment = await Payment.findOne({ reference });
    if (payment && payment.status !== 'success') {
      payment.status = 'success';
      payment.paystackRef = event.data.reference;
      await payment.save();
    }
  }
  res.sendStatus(200);
});

exports.getMine = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const payments = await Payment.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Payment.countDocuments({ user: req.user._id });
  sendSuccess(res, 200, 'Payments retrieved.', { payments, total });
});

// User submits a bank transfer reference after making the platform transfer
exports.submitTransfer = asyncHandler(async (req, res, next) => {
  const { type, referenceId, serviceId, amount, transferReference } = req.body;
  if (!type || !amount || !transferReference) {
    return next(new AppError('type, amount, and transferReference are required.', 400));
  }

  const paymentType    = type === 'appointment_booking' ? 'consultation' : type;
  const effectiveRefId = serviceId || referenceId;
  const { randomUUID } = require('crypto');
  const reference      = `ibam_dt_${randomUUID().replace(/-/g, '').slice(0, 14)}`;

  const payment = await Payment.create({
    user: req.user._id,
    amount,
    reference,
    type: paymentType,
    method: 'direct_transfer',
    serviceRef: effectiveRefId,
    transferReference,
    status: 'pending',
  });

  // Notify admins that a transfer was submitted and needs confirmation
  const { notifyAdmins } = require('../services/notification.service');
  notifyAdmins({
    type: 'transfer_submitted',
    title: 'Bank Transfer Submitted',
    message: `${req.user.name} submitted a bank transfer of ₦${(amount / 100).toLocaleString()} (ref: ${transferReference}). Please verify and confirm.`,
    metadata: { paymentId: payment._id, userId: req.user._id, transferReference },
  }).catch(() => {});

  sendSuccess(res, 201, 'Transfer reference submitted. Awaiting admin confirmation.', { payment });
});
