const { randomUUID } = require('crypto');
const Payment = require('../models/Payment');
const Appointment = require('../models/Appointment');
const PharmacyOrder = require('../models/PharmacyOrder');
const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const { initializeTransaction, verifyTransaction } = require('../services/paystack.service');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.initiate = asyncHandler(async (req, res, next) => {
  const { type, serviceId, amount } = req.body;
  if (!type || !amount) return next(new AppError('type and amount required.', 400));

  const reference = `ibam_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const payment = await Payment.create({
    user: req.user._id,
    amount,
    reference,
    type,
    serviceRef: serviceId,
  });

  const paystackData = await initializeTransaction({
    email: req.user.email,
    amount,
    reference,
    metadata: { type, serviceId, userId: req.user._id },
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
      await Appointment.findByIdAndUpdate(payment.serviceRef, { paymentRef: payment._id, status: 'confirmed' });
    }
    if (payment.type === 'pharmacy' && payment.serviceRef) {
      await PharmacyOrder.findByIdAndUpdate(payment.serviceRef, { paymentRef: payment._id, status: 'processing' });
    }
    if (payment.type === 'lab_test' && payment.serviceRef) {
      await DiagnosticsRequest.findByIdAndUpdate(payment.serviceRef, { paymentRef: payment._id });
    }

    await createNotification({
      userId: req.user._id,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Your payment of ₦${payment.amount} was successful.`,
      metadata: { paymentId: payment._id },
      emailData: { amount: payment.amount, description: `${payment.type} payment` },
    });
  } else {
    payment.status = 'failed';
    await payment.save();
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
