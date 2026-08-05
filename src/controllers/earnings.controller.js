const DoctorEarning = require('../models/DoctorEarning');
const { notifyAdmins } = require('../services/notification.service');
const { sendAdminAlertEmail } = require('../services/email.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.getEarnings = asyncHandler(async (req, res) => {
  const earnings = await DoctorEarning.find({ doctor: req.user._id })
    .populate('consultation', 'consultationType startedAt')
    .sort({ createdAt: -1 });

  const totals = earnings.reduce(
    (acc, e) => {
      acc.gross += e.grossAmount;
      acc.net += e.netAmount;
      acc.pending += e.payoutStatus === 'pending' ? e.netAmount : 0;
      return acc;
    },
    { gross: 0, net: 0, pending: 0 }
  );

  sendSuccess(res, 200, 'Earnings retrieved.', { earnings, totals });
});

exports.requestPayout = asyncHandler(async (req, res, next) => {
  const pendingEarnings = await DoctorEarning.find({ doctor: req.user._id, payoutStatus: 'pending' });
  if (!pendingEarnings.length) return next(new AppError('No pending earnings to pay out.', 400));

  const ids = pendingEarnings.map((e) => e._id);
  await DoctorEarning.updateMany({ _id: { $in: ids } }, { payoutStatus: 'requested', payoutRequestedAt: new Date() });

  const totalRequested = pendingEarnings.reduce((sum, e) => sum + e.netAmount, 0);

  notifyAdmins({
    type: 'payout_requested',
    title: 'Payout Request',
    message: `Dr. ${req.user.name} requested a payout of ₦${totalRequested.toLocaleString('en-NG')}.`,
    metadata: { doctorId: req.user._id, amount: totalRequested, count: pendingEarnings.length },
  }).catch(() => {});
  sendAdminAlertEmail({
    subject: `Payout request — Dr. ${req.user.name}`,
    headline: 'Doctor Payout Request',
    body: `Dr. ${req.user.name} has requested a payout of ₦${totalRequested.toLocaleString('en-NG')} for ${pendingEarnings.length} consultation${pendingEarnings.length !== 1 ? 's' : ''}.`,
    ctaLabel: 'Review Payouts',
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/payouts`,
  }).catch(() => {});

  sendSuccess(res, 200, 'Payout requested.', { totalRequested, count: pendingEarnings.length });
});
