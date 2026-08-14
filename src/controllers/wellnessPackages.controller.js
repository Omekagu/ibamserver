const WellnessPackage = require('../models/WellnessPackage');
const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const Payment = require('../models/Payment');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification, notifyAdmins } = require('../services/notification.service');
const { sendAdminAlertEmail } = require('../services/email.service');

exports.listPackages = asyncHandler(async (req, res) => {
  const packages = await WellnessPackage.find({ isActive: true }).sort({ order: 1, name: 1 });
  sendSuccess(res, 200, 'Wellness packages retrieved.', { packages });
});

exports.bookPackage = asyncHandler(async (req, res, next) => {
  const pkg = await WellnessPackage.findById(req.params.id);
  if (!pkg || !pkg.isActive) return next(new AppError('Package not found or unavailable.', 404));

  const { collectionType, address, lat, lng, notes, transferReference } = req.body;
  if (!collectionType || !['walk_in', 'home_visit'].includes(collectionType)) {
    return next(new AppError('collectionType must be walk_in or home_visit.', 400));
  }
  if (collectionType === 'home_visit' && !address) {
    return next(new AppError('Address is required for home visit.', 400));
  }

  const totalAmount = collectionType === 'walk_in' ? pkg.walkInPrice : pkg.homeVisitPrice;

  const pickupLocation = collectionType === 'home_visit' && address
    ? {
        address,
        ...(lat != null ? { lat: Number(lat) } : {}),
        ...(lng != null ? { lng: Number(lng) } : {}),
      }
    : undefined;

  const request = await DiagnosticsRequest.create({
    patient:           req.user._id,
    tests:             pkg.includedTests,
    collectionType,
    totalAmount,
    requiresApproval:  false,
    adminApprovalStatus: 'na',
    notes:             notes || `Booked via "${pkg.name}" wellness package.`,
    wellnessPackage:   pkg._id,
    pickupLocation,
  });

  if (transferReference) {
    await Payment.create({
      user:              req.user._id,
      amount:            totalAmount * 100,
      reference:         transferReference,
      type:              'wellness_package',
      method:            'direct_transfer',
      serviceRef:        request._id,
      status:            'pending',
    });
  }

  createNotification({
    userId: req.user._id,
    type:   'lab_request_placed',
    title:  'Wellness Package Booked',
    message: collectionType === 'walk_in'
      ? `Your "${pkg.name}" package has been booked. Visit the assigned lab and pay at the counter.`
      : `Your "${pkg.name}" package has been booked. Our team will contact you to schedule your home visit.`,
    metadata: { requestId: request._id },
  }).catch(() => {});

  sendAdminAlertEmail({
    subject:  `New wellness package booking: ${pkg.name}`,
    headline: 'New Wellness Package Booking',
    body: `${req.user.name || 'A patient'} booked the "${pkg.name}" wellness package (${collectionType.replace('_', ' ')}, ₦${totalAmount.toLocaleString('en-NG')}).`,
    ctaLabel: 'View Requests',
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/diagnostics`,
  }).catch(() => {});

  notifyAdmins({
    type:    'lab_request_placed',
    title:   'New Wellness Package Booking',
    message: `${req.user.name || 'A patient'} booked "${pkg.name}" (${collectionType.replace('_', ' ')}).`,
    metadata: { requestId: request._id },
  }).catch(() => {});

  sendSuccess(res, 201, 'Package booked successfully.', { request, package: pkg });
});
