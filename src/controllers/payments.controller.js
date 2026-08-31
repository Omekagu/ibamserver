const { randomUUID } = require('crypto')
const Payment = require('../models/Payment')
const Appointment = require('../models/Appointment')
const Availability = require('../models/Availability')
const PharmacyOrder = require('../models/PharmacyOrder')
const Prescription = require('../models/Prescription')
const DiagnosticsRequest = require('../models/DiagnosticsRequest')
const PartnerEarning = require('../models/PartnerEarning')
const Doctor = require('../models/Doctor')
const {
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer
} = require('../services/paystack.service')
const PlatformSettings = require('../models/PlatformSettings')
const PharmacyPartner = require('../models/PharmacyPartner')
const LabPartner = require('../models/LabPartner')
const {
  createNotification,
  notifyAdmins
} = require('../services/notification.service')
const {
  sendAdminAlertEmail,
  sendAppointmentBookedPatientEmail,
  sendPharmacyOrderConfirmedEmail
} = require('../services/email.service')
const { sendSuccess } = require('../utils/response')
const AppError = require('../utils/AppError')
const asyncHandler = require('../utils/asyncHandler')

// Attempt Paystack auto-payout for a partner earning; silently swallows errors.
async function tryAutoPartnerPayout (earning) {
  try {
    const settings = await PlatformSettings.findOne().lean()
    if (!settings?.paystackEnabled) return
    const key = settings.paystackSecretKey || process.env.PAYSTACK_SECRET_KEY
    if (!key) return

    const Profile =
      earning.partnerType === 'pharmacy' ? PharmacyPartner : LabPartner
    const profile = await Profile.findOne({ user: earning.partner }).lean()
    const bank = profile?.bankAccount
    if (!bank?.accountNumber || !bank?.bankCode) return

    const recipient = await createTransferRecipient({
      name: bank.accountName || earning.partnerName || 'Partner',
      accountNumber: bank.accountNumber,
      bankCode: bank.bankCode
    })
    await initiateTransfer({
      amount: earning.netAmount,
      recipient: recipient.recipient_code,
      reason: `iBam Health payout â€" ${
        earning.partnerName || earning.partnerType
      }`
    })
    await PartnerEarning.findByIdAndUpdate(earning._id, {
      payoutStatus: 'paid',
      paidAt: new Date()
    })
  } catch {
    /* non-fatal  leave earning as pending */
  }
}

exports.initiate = asyncHandler(async (req, res, next) => {
  const { type, serviceId, referenceId, amount, batchRefs } = req.body
  if (!type || !amount)
    return next(new AppError('type and amount required.', 400))

  // Normalise: 'appointment_booking' → 'consultation'; referenceId is alias for serviceId
  const paymentType = type === 'appointment_booking' ? 'consultation' : type
  const effectiveRefId = serviceId || referenceId

  // Resolve provider's Paystack subaccount for automatic split at transaction time.
  // Lab tests are excluded — the lab is assigned after payment, so splitting happens
  // via manual transfer in the verify handler once a lab claims the request.
  let subaccount = null
  if (paymentType === 'consultation' && effectiveRefId) {
    const appt = await Appointment.findById(effectiveRefId).select('doctor').lean()
    if (appt?.doctor) {
      const doc = await Doctor.findOne({ user: appt.doctor }).select('subaccountCode').lean()
        .catch(() => null)
      // Doctor model's user field may differ — try findById if user lookup failed
      || await Doctor.findById(appt.doctor).select('subaccountCode').lean().catch(() => null)
      subaccount = doc?.subaccountCode || null
    }
  } else if (paymentType === 'pharmacy' && effectiveRefId) {
    const order = await PharmacyOrder.findById(effectiveRefId).select('pharmacy').populate('pharmacy', 'subaccountCode').lean()
    subaccount = order?.pharmacy?.subaccountCode || null
  }

  const reference = `ibam_${randomUUID().replace(/-/g, '').slice(0, 16)}`

  const payment = await Payment.create({
    user: req.user._id,
    amount: amount * 100,
    reference,
    type: paymentType,
    method: 'paystack',
    serviceRef: effectiveRefId,
    batchRefs: Array.isArray(batchRefs) ? batchRefs : [],
    subaccountCode: subaccount || undefined,
  })

  const paystackData = await initializeTransaction({
    email: req.user.email,
    amount,
    reference,
    metadata: { type: paymentType, serviceId: effectiveRefId, userId: req.user._id },
    ...(subaccount ? { subaccount, bearer: 'account' } : {}),
  })

  const settings = await PlatformSettings.findOne().select('paystackPublicKey').lean()
  const paystackPublicKey = settings?.paystackPublicKey || process.env.PAYSTACK_PUBLIC_KEY || ''

  sendSuccess(res, 200, 'Payment initialised.', {
    paymentId: payment._id,
    reference,
    authorizationUrl: paystackData.authorization_url,
    accessCode: paystackData.access_code,
    paystackPublicKey
  })
})

exports.verify = asyncHandler(async (req, res, next) => {
  const { reference } = req.params
  const paystackData = await verifyTransaction(reference)

  const payment = await Payment.findOne({ reference })
  if (!payment) return next(new AppError('Payment record not found.', 404))

  if (paystackData.status === 'success') {
    payment.status = 'success'
    payment.paystackRef = paystackData.reference
    await payment.save()

    if (payment.type === 'consultation' && payment.serviceRef) {
      const appt = await Appointment.findByIdAndUpdate(
        payment.serviceRef,
        { paymentRef: payment._id, status: 'confirmed' },
        { returnDocument: 'after' }
      ).populate('doctor', 'name')
      if (appt) {
        const doctorId = appt.doctor?._id ?? appt.doctor
        const doctorName = appt.doctor?.name ?? 'Doctor'
        const scheduledDate = new Date(appt.scheduledAt)
        const slotTime = `${String(scheduledDate.getHours()).padStart(
          2,
          '0'
        )}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`
        await Availability.findOneAndUpdate(
          { doctor: doctorId, isActive: true, 'slots.startTime': slotTime },
          { $set: { 'slots.$.isBooked': true } }
        )
        // Doctor notification with email (fires after payment confirmed)
        createNotification({
          userId: doctorId,
          type: 'appointment_confirmed',
          title: 'Appointment Confirmed',
          message: `${req.user.name}'s ${appt.type} appointment is confirmed. Payment received.`,
          metadata: { appointmentId: appt._id },
          emailData: {
            patientName: req.user.name,
            appointmentType: appt.type,
            scheduledAt: appt.scheduledAt
          }
        }).catch(() => {})
        // Patient confirmation email (fires after payment confirmed)
        sendAppointmentBookedPatientEmail({
          patientEmail: req.user.email,
          patientName: req.user.name,
          doctorName,
          type: appt.type,
          scheduledAt: appt.scheduledAt
        }).catch(() => {})
        // Admin notification (fires after payment confirmed)
        notifyAdmins({
          type: 'appointment_booked',
          title: 'New Appointment Confirmed',
          message: `${req.user.name} confirmed a ${appt.type} appointment with Dr. ${doctorName}.`,
          metadata: {
            appointmentId: appt._id,
            patientId: req.user._id,
            doctorId
          }
        }).catch(() => {})
        // Record doctor earning — Paystack already split if subaccountCode is set
        if (payment.subaccountCode) {
          const gross = payment.amount / 100
          const cut = Math.round(gross * 0.1 * 100) / 100
          PartnerEarning.create({
            partner: doctorId,
            partnerType: 'doctor',
            partnerName: doctorName,
            serviceRef: payment.serviceRef,
            grossAmount: gross,
            platformCut: cut,
            netAmount: gross - cut,
            payoutStatus: 'split',
          }).catch(() => {})
        }
      }
    }
    if (payment.type === 'pharmacy' && payment.serviceRef) {
      const order = await PharmacyOrder.findByIdAndUpdate(
        payment.serviceRef,
        { paymentRef: payment._id, status: 'processing' },
        { returnDocument: 'after' }
      ).populate('pharmacy', 'user name')
      // Mark the linked prescription as forwarded now that payment is confirmed
      if (order?.prescription) {
        Prescription.findByIdAndUpdate(order.prescription, {
          forwardedToPharmacy: true
        }).catch(() => {})
      }
      if (order?.pharmacy?.user) {
        const gross = payment.amount / 100
        const cut = Math.round(gross * 0.1 * 100) / 100
        const isAutoSplit = !!payment.subaccountCode
        const earning = await PartnerEarning.create({
          partner: order.pharmacy.user,
          partnerType: 'pharmacy',
          partnerName: order.pharmacy.name,
          serviceRef: payment.serviceRef,
          grossAmount: gross,
          platformCut: cut,
          netAmount: gross - cut,
          payoutStatus: isAutoSplit ? 'split' : 'pending',
        })
        if (!isAutoSplit) tryAutoPartnerPayout(earning) // skip when Paystack already settled via split
        createNotification({
          userId: order.pharmacy.user,
          type: 'pharmacy_order_placed',
          title: 'New Order Received',
          message: `A patient has paid ₦${gross.toLocaleString(
            'en-NG'
          )} for an order. Please process it.`,
          metadata: { orderId: payment.serviceRef }
        }).catch(() => {})
        createNotification({
          userId: req.user._id,
          type: 'pharmacy_order_placed',
          title: 'Order Confirmed!',
          message: `Your order from ${order.pharmacy.name} is confirmed and being processed.`,
          metadata: { orderId: payment.serviceRef }
        }).catch(() => {})
        sendPharmacyOrderConfirmedEmail({
          email: req.user.email,
          name: req.user.name,
          pharmacyName: order.pharmacy.name,
          items: order.items ?? []
        }).catch(() => {})
      }
      if (order) {
        const gross = payment.amount / 100
        sendAdminAlertEmail({
          subject: `New pharmacy order paid  ${req.user.name}`,
          headline: 'New Pharmacy Order Paid',
          body: `${req.user.name} paid ₦${gross.toLocaleString(
            'en-NG'
          )} for an order${
            order.pharmacy?.name ? ` from ${order.pharmacy.name}` : ''
          }.`,
          ctaLabel: 'View Orders',
          ctaUrl: `${
            process.env.CLIENT_URL || 'https://ibamhealth.com'
          }/admin/orders`
        }).catch(() => {})
        notifyAdmins({
          type: 'pharmacy_order_placed',
          title: 'New Pharmacy Order Paid',
          message: `${req.user.name} paid for an order${
            order.pharmacy?.name ? ` from ${order.pharmacy.name}` : ''
          }.`,
          metadata: { orderId: payment.serviceRef, patientId: req.user._id }
        }).catch(() => {})
      }
    }

    // â"€â"€ Multi-pharmacy batch: one payment, one PartnerEarning per store â"€â"€â"€â"€â"€â"€â"€
    if (payment.type === 'pharmacy_batch' && payment.batchRefs?.length) {
      const orders = await PharmacyOrder.find({
        _id: { $in: payment.batchRefs }
      }).populate('pharmacy', 'user name')

      const pharmacyNames = orders.map(o => o.pharmacy?.name).filter(Boolean)

      for (const order of orders) {
        await PharmacyOrder.findByIdAndUpdate(order._id, {
          paymentRef: payment._id,
          status: 'processing'
        })
        if (order.prescription) {
          Prescription.findByIdAndUpdate(order.prescription, {
            forwardedToPharmacy: true
          }).catch(() => {})
        }
        if (order.pharmacy?.user && order.totalAmount > 0) {
          const gross = order.totalAmount
          const cut = Math.round(gross * 0.1 * 100) / 100
          const earning = await PartnerEarning.create({
            partner: order.pharmacy.user,
            partnerType: 'pharmacy',
            partnerName: order.pharmacy.name,
            serviceRef: order._id,
            grossAmount: gross,
            platformCut: cut,
            netAmount: gross - cut
          })
          tryAutoPartnerPayout(earning) // non-blocking
          createNotification({
            userId: order.pharmacy.user,
            type: 'pharmacy_order_placed',
            title: 'New Order Received',
            message: `A patient paid ₦${gross.toLocaleString(
              'en-NG'
            )} for an order. Please process it.`,
            metadata: { orderId: order._id }
          }).catch(() => {})
          sendPharmacyOrderConfirmedEmail({
            email: req.user.email,
            name: req.user.name,
            pharmacyName: order.pharmacy.name,
            items: order.items ?? []
          }).catch(() => {})
        }
      }
      // Single patient + admin notification covering all stores in the batch
      createNotification({
        userId: req.user._id,
        type: 'pharmacy_order_placed',
        title: 'Orders Confirmed!',
        message: `Your orders from ${pharmacyNames.join(
          ', '
        )} are confirmed and being processed.`,
        metadata: { orderIds: orders.map(o => o._id) }
      }).catch(() => {})
      const batchTotal = (payment.amount / 100).toLocaleString('en-NG')
      sendAdminAlertEmail({
        subject: `Multi-pharmacy order paid  ${req.user.name}`,
        headline: 'Multi-pharmacy Order Paid',
        body: `${req.user.name} paid ₦${batchTotal} across ${
          orders.length
        } pharmacies: ${pharmacyNames.join(', ')}.`,
        ctaLabel: 'View Orders',
        ctaUrl: `${
          process.env.CLIENT_URL || 'https://ibamhealth.com'
        }/admin/orders`
      }).catch(() => {})
      notifyAdmins({
        type: 'pharmacy_order_placed',
        title: 'Multi-pharmacy Order Paid',
        message: `${
          req.user.name
        } paid ₦${batchTotal} across ${pharmacyNames.join(', ')}.`,
        metadata: { orderIds: orders.map(o => o._id), patientId: req.user._id }
      }).catch(() => {})
    }
    if (payment.type === 'lab_test' && payment.serviceRef) {
      const diagReq = await DiagnosticsRequest.findByIdAndUpdate(
        payment.serviceRef,
        { paymentRef: payment._id },
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
        tryAutoPartnerPayout(earning) // non-blocking
      }
      // Patient confirmation  fires here so it only triggers after payment, not at request creation
      if (diagReq) {
        const tests = Array.isArray(diagReq.tests) ? diagReq.tests : []
        createNotification({
          userId: req.user._id,
          type: 'lab_request_placed',
          title: 'Lab Booking Confirmed!',
          message: `Your booking for ${tests.slice(0, 2).join(', ')}${
            tests.length > 2 ? ` +${tests.length - 2} more` : ''
          } is confirmed. Our team will be in touch with next steps.`,
          metadata: { requestId: payment.serviceRef }
        }).catch(() => {})
      }
      // Admin + lab partner notifications fire after payment confirmed, not at request creation
      if (diagReq) {
        const tests = Array.isArray(diagReq.tests) ? diagReq.tests : []
        sendAdminAlertEmail({
          subject: 'New lab test request paid',
          headline: 'New Lab Test Request',
          body: `${req.user.name || 'A patient'} paid for lab tests: ${tests
            .slice(0, 3)
            .join(', ')}${
            tests.length > 3 ? ` +${tests.length - 3} more` : ''
          }.${
            diagReq.collectionType === 'home_visit' && diagReq.preferredDate
              ? ` Preferred visit: ${diagReq.preferredDate}${
                  diagReq.preferredTime ? ' at ' + diagReq.preferredTime : ''
                }.`
              : ''
          }`,
          ctaLabel: 'View Lab Portal',
          ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/lab`
        }).catch(err =>
          console.error('[Email] Admin lab test alert:', err.message)
        )
        notifyAdmins({
          type: 'lab_request_placed',
          title: 'New Lab Test Request',
          message: `${req.user.name || 'A patient'} paid for: ${tests
            .slice(0, 2)
            .join(', ')}${
            tests.length > 2 ? ` +${tests.length - 2} more` : ''
          }.`,
          metadata: { requestId: payment.serviceRef, patientId: req.user._id }
        }).catch(() => {})
        // Notify all active lab partners that a paid request is now available to claim
        const activeLabs = await LabPartner.find(
          { status: 'active' },
          'user'
        ).lean()
        for (const lab of activeLabs) {
          if (lab.user) {
            createNotification({
              userId: lab.user,
              type: 'lab_request_placed',
              title: 'New Lab Request Available',
              message: `Paid ${
                diagReq.collectionType === 'home_visit'
                  ? 'home visit'
                  : 'walk-in'
              } request: ${tests.slice(0, 2).join(', ')}${
                tests.length > 2 ? ` +${tests.length - 2} more` : ''
              }.`,
              metadata: { requestId: payment.serviceRef }
            }).catch(() => {})
          }
        }
      }
    }

    const typeLabels = {
      consultation: 'Doctor Appointment',
      pharmacy: 'Pharmacy Order',
      lab_test: 'Lab Test',
      subscription: 'Subscription'
    }
    await createNotification({
      userId: req.user._id,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Your payment of ₦${(
        payment.amount / 100
      ).toLocaleString()} was successful.`,
      metadata: { paymentId: payment._id },
      emailData: {
        amount: payment.amount / 100,
        description: typeLabels[payment.type] || payment.type
      }
    })
  } else {
    payment.status = 'failed'
    await payment.save()

    // On payment failure, cancel the appointment and free the slot
    if (payment.type === 'consultation' && payment.serviceRef) {
      const appt = await Appointment.findByIdAndUpdate(
        payment.serviceRef,
        { status: 'cancelled', cancellationReason: 'Payment failed' },
        { returnDocument: 'after' }
      )
      if (appt) {
        const scheduledDate = new Date(appt.scheduledAt)
        const slotTime = `${String(scheduledDate.getHours()).padStart(
          2,
          '0'
        )}:${String(scheduledDate.getMinutes()).padStart(2, '0')}`
        await Availability.findOneAndUpdate(
          { doctor: appt.doctor, isActive: true, 'slots.startTime': slotTime },
          { $set: { 'slots.$.isBooked': false } }
        )
      }
    }
  }

  sendSuccess(res, 200, 'Payment verified.', { payment })
})

exports.webhook = asyncHandler(async (req, res) => {
  // Paystack sends the event type and data
  const event = req.body
  if (event.event === 'charge.success') {
    const { reference } = event.data
    const payment = await Payment.findOne({ reference })
    if (payment && payment.status !== 'success') {
      payment.status = 'success'
      payment.paystackRef = event.data.reference
      await payment.save()
    }
  }
  res.sendStatus(200)
})

exports.requestRefund = asyncHandler(async (req, res, next) => {
  const { paymentId, reason } = req.body
  if (!reason?.trim())
    return next(
      new AppError('A reason is required for the refund request.', 400)
    )

  const payment = await Payment.findOne({ _id: paymentId, user: req.user._id })
  if (!payment) return next(new AppError('Payment not found.', 404))
  if (payment.status !== 'success')
    return next(new AppError('Only successful payments can be refunded.', 400))
  if (payment.refundRequested)
    return next(
      new AppError('A refund has already been requested for this payment.', 400)
    )

  payment.refundRequested = true
  payment.refundReason = reason.trim()
  await payment.save()

  const { notifyAdmins } = require('../services/notification.service')
  notifyAdmins({
    type: 'refund_requested',
    title: 'Refund Request',
    message: `${req.user.name || 'A patient'} requested a refund of ₦${(
      payment.amount / 100
    ).toLocaleString()} (${payment.type}). Reason: ${reason.trim()}`,
    metadata: {
      paymentId: payment._id,
      userId: req.user._id,
      amount: payment.amount,
      type: payment.type
    }
  }).catch(() => {})

  sendSuccess(
    res,
    200,
    'Refund request submitted. Our team will review within 24â€"48 hours.',
    {}
  )
})

exports.getMine = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const payments = await Payment.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
  const total = await Payment.countDocuments({ user: req.user._id })
  sendSuccess(res, 200, 'Payments retrieved.', { payments, total })
})

// User submits a bank transfer reference after making the platform transfer
exports.submitTransfer = asyncHandler(async (req, res, next) => {
  const { type, referenceId, serviceId, amount, transferReference } = req.body
  if (!type || !amount || !transferReference) {
    return next(
      new AppError('type, amount, and transferReference are required.', 400)
    )
  }

  const paymentType = type === 'appointment_booking' ? 'consultation' : type
  const effectiveRefId = serviceId || referenceId
  const { randomUUID } = require('crypto')
  const reference = `ibam_dt_${randomUUID().replace(/-/g, '').slice(0, 14)}`

  const payment = await Payment.create({
    user: req.user._id,
    amount,
    reference,
    type: paymentType,
    method: 'direct_transfer',
    serviceRef: effectiveRefId,
    transferReference,
    status: 'pending'
  })

  // Notify admins that a transfer was submitted and needs confirmation
  const { notifyAdmins } = require('../services/notification.service')
  notifyAdmins({
    type: 'transfer_submitted',
    title: 'Bank Transfer Submitted',
    message: `${req.user.name} submitted a bank transfer of ₦${(
      amount / 100
    ).toLocaleString()} (ref: ${transferReference}). Please verify and confirm.`,
    metadata: {
      paymentId: payment._id,
      userId: req.user._id,
      transferReference
    }
  }).catch(() => {})

  sendSuccess(
    res,
    201,
    'Transfer reference submitted. Awaiting admin confirmation.',
    { payment }
  )
})
