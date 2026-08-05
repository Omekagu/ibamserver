const DoctorEarning = require('../models/DoctorEarning');
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
  sendSuccess(res, 200, 'Payout requested.', { totalRequested, count: pendingEarnings.length });
});
