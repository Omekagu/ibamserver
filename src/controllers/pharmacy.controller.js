const { randomUUID } = require('crypto');
const PharmacyPartner = require('../models/PharmacyPartner');
const PharmacyOrder = require('../models/PharmacyOrder');
const Payment = require('../models/Payment');
const Prescription = require('../models/Prescription');
const User = require('../models/User');
const { uploadBuffer } = require('../services/cloudinary.service');
const { createNotification, notifyAdmins } = require('../services/notification.service');
const { sendAdminAlertEmail } = require('../services/email.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.onboard = asyncHandler(async (req, res, next) => {
  const { name, address, phone, email, password, coverageAreas, licenseNumber, operatingHours } = req.body;
  if (!name || !address || !phone || !email || !password) {
    return next(new AppError('Name, address, phone, email and password are required.', 400));
  }
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return next(new AppError('An account with this email already exists.', 409));

  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    password,
    role: 'pharmacy_partner',
    isVerified: false,
  });

  const partner = await PharmacyPartner.create({
    name,
    address,
    phone,
    email,
    licenseNumber,
    coverageAreas: coverageAreas || [],
    operatingHours: operatingHours || {},
    status: 'pending',
    user: user._id,
  });

  sendAdminAlertEmail({
    subject: 'New pharmacy partner application',
    headline: 'New Pharmacy Application',
    body: `${name} (${email}) has applied to join as a pharmacy partner and is awaiting approval.`,
    ctaLabel: 'Review Partners',
    ctaUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/partners`,
  }).catch(err => console.error('[Email] Admin pharmacy alert failed:', err.message));

  notifyAdmins({
    type: 'partner_onboarded',
    title: 'New Pharmacy Application',
    message: `${name} applied to join as a pharmacy partner and is awaiting review.`,
    metadata: { partnerId: partner._id, email },
  }).catch(() => {});

  sendSuccess(res, 201, 'Application submitted. You will be notified once approved.', { partner });
});

exports.listPartners = asyncHandler(async (req, res) => {
  const partners = await PharmacyPartner.find({ status: 'active' });
  sendSuccess(res, 200, 'Pharmacy partners retrieved.', { partners });
});

// ─── Drug Catalog ────────────────────────────────────────────────────────────

exports.getOwnCatalog = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id });
  if (!partner) return next(new AppError('Pharmacy partner record not found.', 404));
  sendSuccess(res, 200, 'Catalog retrieved.', { drugs: partner.drugsOffered, partner });
});

exports.updateCatalog = asyncHandler(async (req, res, next) => {
  const { drugs } = req.body;
  if (!Array.isArray(drugs)) return next(new AppError('drugs must be an array.', 400));

  const partner = await PharmacyPartner.findOne({ user: req.user._id });
  if (!partner) return next(new AppError('Pharmacy partner record not found.', 404));

  const formatted = drugs.map(d => ({
    _id: d._id || undefined,
    name: d.name,
    price: Number(d.price),
    unit: d.unit || 'pack',
    requiresPrescription: Boolean(d.requiresPrescription),
    inStock: d.inStock !== false,
    adminApproved: true,
  }));

  partner.drugsOffered = formatted;
  await partner.save();
  sendSuccess(res, 200, 'Drug catalog updated.', { drugs: partner.drugsOffered });
});

exports.getPublicCatalog = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findById(req.params.id).select('name address phone drugsOffered status');
  if (!partner || partner.status !== 'active') return next(new AppError('Pharmacy not found.', 404));
  const approvedDrugs = partner.drugsOffered.filter(d => d.inStock);
  sendSuccess(res, 200, 'Catalog retrieved.', { partner, drugs: approvedDrugs });
});

// ─── Orders ──────────────────────────────────────────────────────────────────

exports.placeOrder = asyncHandler(async (req, res, next) => {
  const { prescriptionId, pharmacyId, fulfillmentType, deliveryAddress } = req.body;
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    return next(new AppError('Delivery address required for delivery orders.', 400));
  }

  const prescription = await Prescription.findById(prescriptionId);
  if (!prescription) return next(new AppError('Prescription not found.', 404));
  if (prescription.patient.toString() !== req.user._id.toString()) {
    return next(new AppError('Not authorised.', 403));
  }

  let pickupLocation;
  if (fulfillmentType === 'pickup') {
    try { pickupLocation = req.body.pickupLocation ? JSON.parse(req.body.pickupLocation) : undefined; } catch { /* ignore */ }
  }

  const order = await PharmacyOrder.create({
    orderType: 'prescription',
    prescription: prescriptionId,
    patient: req.user._id,
    pharmacy: pharmacyId,
    fulfillmentType,
    deliveryAddress,
    pickupLocation,
  });

  const pharmacyRecord = pharmacyId
    ? await PharmacyPartner.findById(pharmacyId).select('name user').lean()
    : null;
  const prescriptionItems = (prescription.medications || []).map(m => ({ name: m.name || String(m) }));

  // Notify pharmacy partner about the new order
  if (pharmacyRecord?.user) {
    createNotification({
      userId: pharmacyRecord.user,
      type: 'pharmacy_order_placed',
      title: 'New Prescription Order',
      message: `A patient has submitted a prescription order.`,
      metadata: { orderId: order._id },
    }).catch(err => console.error('[Notification] Pharmacy partner order:', err.message));
  }

  createNotification({
    userId: req.user._id,
    type: 'pharmacy_order_placed',
    title: 'Pharmacy Order Placed',
    message: 'Your prescription order has been submitted and is awaiting processing.',
    metadata: { orderId: order._id },
    emailData: { pharmacyName: pharmacyRecord?.name || 'Pharmacy', items: prescriptionItems },
  }).catch(err => console.error('[Notification] Pharmacy order placed:', err.message));

  notifyAdmins({
    type: 'pharmacy_order_placed',
    title: 'New Prescription Order',
    message: `${req.user.name} placed a prescription order${pharmacyRecord ? ` at ${pharmacyRecord.name}` : ''}.`,
    metadata: { orderId: order._id, patientId: req.user._id },
  }).catch(() => {});
  sendAdminAlertEmail({
    subject: `New prescription order — ${req.user.name}`,
    headline: 'New Prescription Order',
    body: `${req.user.name} placed a prescription order${pharmacyRecord ? ` at ${pharmacyRecord.name}` : ''}.`,
    ctaLabel: 'View Orders',
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/orders`,
  }).catch(() => {});

  sendSuccess(res, 201, 'Order placed.', { order });
});

exports.placeDirectOrder = asyncHandler(async (req, res, next) => {
  const { pharmacyId, fulfillmentType, deliveryAddress, notes } = req.body;
  // items may arrive as a JSON string (FormData) or as an array (JSON body)
  let items;
  try {
    items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
  } catch { items = []; }
  if (!pharmacyId) return next(new AppError('pharmacyId is required.', 400));
  if (!Array.isArray(items) || items.length === 0) return next(new AppError('items array is required.', 400));
  if (!fulfillmentType) return next(new AppError('fulfillmentType is required.', 400));
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    return next(new AppError('Delivery address required for delivery orders.', 400));
  }

  const pharmacy = await PharmacyPartner.findById(pharmacyId);
  if (!pharmacy || pharmacy.status !== 'active') return next(new AppError('Pharmacy not found or inactive.', 404));

  let totalAmount = 0;
  let requiresApproval = false;
  const orderItems = [];

  for (const item of items) {
    const catalogDrug = pharmacy.drugsOffered.find(
      d => String(d._id) === String(item.drugId)
    );
    if (!catalogDrug) return next(new AppError(`Drug not found in pharmacy catalog: ${item.name}`, 400));
    if (!catalogDrug.inStock) return next(new AppError(`${catalogDrug.name} is currently out of stock.`, 400));
    const qty = Math.max(1, parseInt(item.qty) || 1);
    totalAmount += catalogDrug.price * qty;
    if (catalogDrug.requiresPrescription) requiresApproval = true;
    orderItems.push({ name: catalogDrug.name, price: catalogDrug.price, qty });
  }

  let externalPrescriptionUrl;
  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, 'prescriptions', 'auto');
    externalPrescriptionUrl = uploaded.secure_url;
  }

  let pickupLocation;
  if (fulfillmentType === 'pickup') {
    try { pickupLocation = req.body.pickupLocation ? JSON.parse(req.body.pickupLocation) : undefined; } catch { /* ignore */ }
  }

  const order = await PharmacyOrder.create({
    orderType: 'direct',
    items: orderItems,
    patient: req.user._id,
    pharmacy: pharmacyId,
    fulfillmentType,
    deliveryAddress,
    totalAmount,
    requiresApproval,
    adminApprovalStatus: requiresApproval ? 'pending' : 'na',
    externalPrescriptionUrl,
    notes,
    pickupLocation,
  });

  // Notify pharmacy partner
  if (pharmacy.user) {
    createNotification({
      userId: pharmacy.user,
      type: 'pharmacy_order_placed',
      title: 'New Order Received',
      message: `A new order has been placed with you${requiresApproval ? ' (awaiting admin approval for prescription items)' : ''}.`,
      metadata: { orderId: order._id },
    }).catch(err => console.error('[Notification] Pharmacy partner direct order:', err.message));
  }

  sendAdminAlertEmail({
    subject: requiresApproval ? `Pharmacy order awaiting approval — ${req.user.name}` : `New pharmacy order — ${req.user.name}`,
    headline: requiresApproval ? 'Pharmacy Order Pending Approval' : 'New Pharmacy Order',
    body: requiresApproval
      ? `${req.user.name || 'A patient'} placed an order from ${pharmacy.name} containing prescription drugs that require admin approval.`
      : `${req.user.name || 'A patient'} placed an order from ${pharmacy.name}.`,
    ctaLabel: requiresApproval ? 'Review Order' : 'View Orders',
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/orders`,
  }).catch(err => console.error('[Email] Admin pharmacy order alert:', err.message));

  createNotification({
    userId: req.user._id,
    type: 'pharmacy_order_placed',
    title: 'Pharmacy Order Placed',
    message: requiresApproval
      ? 'Your order requires admin approval because it contains prescription drugs.'
      : `Your order from ${pharmacy.name} has been placed successfully.`,
    metadata: { orderId: order._id },
    emailData: { pharmacyName: pharmacy.name, items: orderItems },
  }).catch(err => console.error('[Notification] Direct order placed:', err.message));

  notifyAdmins({
    type: 'pharmacy_order_placed',
    title: requiresApproval ? 'Order Awaiting Approval' : 'New Pharmacy Order',
    message: `${req.user.name || 'A patient'} ordered from ${pharmacy.name}${requiresApproval ? ' — contains prescription drugs, requires approval' : ''}.`,
    metadata: { orderId: order._id, patientId: req.user._id, requiresApproval },
  }).catch(() => {});

  sendSuccess(res, 201, 'Order placed.', { order, requiresApproval });
});

exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status, totalAmount } = req.body;
  const order = await PharmacyOrder.findById(req.params.id).populate('pharmacy');
  if (!order) return next(new AppError('Order not found.', 404));

  const isPharmacy = order.pharmacy.user?.toString() === req.user._id.toString();
  if (!isPharmacy && req.user.role !== 'admin') {
    return next(new AppError('Not authorised.', 403));
  }

  if (status) order.status = status;
  if (totalAmount !== undefined && totalAmount >= 0) order.totalAmount = totalAmount;

  // When a pharmacy partner confirms a walk-in/pickup order as processing,
  // record the cash payment so the platform has an audit trail
  if (
    status === 'processing' &&
    order.fulfillmentType === 'pickup' &&
    !order.paymentRef &&
    order.totalAmount > 0
  ) {
    const reference = `ibam_wic_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const payment = await Payment.create({
      user:     order.patient,
      amount:   order.totalAmount * 100, // store in kobo
      reference,
      type:     'pharmacy',
      method:   'walk_in_cash',
      serviceRef: order._id,
      status:   'success',
    });
    order.paymentRef = payment._id;
  }

  await order.save();

  await createNotification({
    userId: order.patient,
    type: 'pharmacy_order_update',
    title: 'Pharmacy Order Update',
    message: `Your pharmacy order status has changed to: ${status}.`,
    metadata: { orderId: order._id },
    emailData: { status, pharmacyName: order.pharmacy?.name || 'Pharmacy', items: order.items || [] },
  });

  sendSuccess(res, 200, 'Order status updated.', { order });
});

exports.getMyOrders = asyncHandler(async (req, res) => {
  const orders = await PharmacyOrder.find({ patient: req.user._id })
    .populate('pharmacy', 'name address phone')
    .populate('prescription', 'medications diagnosis')
    .sort({ createdAt: -1 });
  sendSuccess(res, 200, 'Orders retrieved.', { orders });
});

exports.getPharmacyProfile = asyncHandler(async (req, res, next) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id });
  if (!partner) return next(new AppError('Pharmacy partner record not found.', 404));
  sendSuccess(res, 200, 'Profile retrieved.', { partner });
});

exports.updatePharmacyProfile = asyncHandler(async (req, res, next) => {
  const { name, address, phone, coverageAreas, operatingHours, bankAccount } = req.body;
  const update = {
    ...(name && { name }), ...(address && { address }), ...(phone && { phone }),
    ...(coverageAreas && { coverageAreas }), ...(operatingHours && { operatingHours }),
    ...(bankAccount && typeof bankAccount === 'object' && { bankAccount }),
  };
  const partner = await PharmacyPartner.findOneAndUpdate({ user: req.user._id }, update, { new: true, runValidators: true });
  if (!partner) return next(new AppError('Pharmacy partner record not found.', 404));
  sendSuccess(res, 200, 'Profile updated.', { partner });
});

exports.getPartnerOrders = asyncHandler(async (req, res) => {
  const partner = await PharmacyPartner.findOne({ user: req.user._id });
  if (!partner) return sendSuccess(res, 200, 'No orders.', { orders: [] });
  const orders = await PharmacyOrder.find({ pharmacy: partner._id })
    .populate('patient', 'name phone')
    .populate('prescription')
    .sort({ createdAt: -1 });
  sendSuccess(res, 200, 'Partner orders retrieved.', { orders });
});

exports.getPharmacyEarnings = asyncHandler(async (req, res) => {
  const PartnerEarning = require('../models/PartnerEarning');
  const earnings = await PartnerEarning.find({ partner: req.user._id, partnerType: 'pharmacy' }).sort({ createdAt: -1 });
  const totals = earnings.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount;
      acc.net   += e.netAmount;
      acc.pending += e.payoutStatus === 'pending' ? e.netAmount : 0;
      return acc;
    },
    { gross: 0, net: 0, pending: 0 }
  );
  sendSuccess(res, 200, 'Earnings retrieved.', { earnings, totals });
});

exports.requestPharmacyPayout = asyncHandler(async (req, res, next) => {
  const PartnerEarning = require('../models/PartnerEarning');
  const PayoutRequest  = require('../models/PayoutRequest');

  const pending = await PartnerEarning.find({ partner: req.user._id, partnerType: 'pharmacy', payoutStatus: 'pending' });
  if (!pending.length) return next(new AppError('No pending earnings to pay out.', 400));

  const pharmacy = await PharmacyPartner.findOne({ user: req.user._id }).lean();
  const bankAccount  = pharmacy?.bankAccount || {};
  const ids          = pending.map(e => e._id);
  const totalGross   = Math.round(pending.reduce((s, e) => s + e.grossAmount, 0) * 100) / 100;
  const totalNet     = Math.round(pending.reduce((s, e) => s + e.netAmount,   0) * 100) / 100;

  // Merge into existing open request for this partner, or create a new one
  let request = await PayoutRequest.findOne({ partner: req.user._id, status: 'requested' });
  if (request) {
    request.earningIds.push(...ids);
    request.totalGross = Math.round((request.totalGross + totalGross) * 100) / 100;
    request.totalNet   = Math.round((request.totalNet   + totalNet)   * 100) / 100;
    if (bankAccount.accountNumber) request.bankAccount = bankAccount;
    await request.save();
  } else {
    request = await PayoutRequest.create({
      partner: req.user._id,
      partnerType: 'pharmacy',
      partnerName: pharmacy?.name || req.user.name,
      earningIds: ids,
      totalGross,
      totalNet,
      bankAccount,
      requestedAt: new Date(),
    });
  }

  await PartnerEarning.updateMany({ _id: { $in: ids } }, { payoutStatus: 'requested', payoutRequestedAt: new Date() });

  notifyAdmins({
    type: 'payout_requested',
    title: 'Pharmacy Payout Request',
    message: `${req.user.name} (pharmacy) requested a payout of ₦${totalNet.toLocaleString('en-NG')}.`,
    metadata: { partnerId: req.user._id, amount: totalNet, partnerType: 'pharmacy' },
  }).catch(() => {});

  sendSuccess(res, 200, 'Payout requested.', { totalRequested: totalNet, count: pending.length });
});
