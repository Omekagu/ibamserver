const mongoose = require('mongoose');
const Review = require('../models/Review');
const Doctor = require('../models/Doctor');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.create = asyncHandler(async (req, res, next) => {
  const { targetType, targetId, rating, comment, appointmentId } = req.body;
  if (!targetType || !targetId || !rating) {
    return next(new AppError('targetType, targetId, and rating are required.', 400));
  }

  const review = await Review.findOneAndUpdate(
    { patient: req.user._id, target: targetId },
    {
      patient: req.user._id,
      targetType,
      target: targetId,
      rating: Number(rating),
      comment: comment?.trim() || undefined,
      appointment: appointmentId,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  if (targetType === 'doctor') {
    const [stats] = await Review.aggregate([
      { $match: { target: new mongoose.Types.ObjectId(targetId), targetType: 'doctor' } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (stats) {
      await Doctor.findOneAndUpdate(
        { user: targetId },
        { 'ratings.average': Math.round(stats.avg * 10) / 10, 'ratings.count': stats.count }
      );
    }
  }

  sendSuccess(res, 201, 'Review submitted.', { review });
});

exports.getForTarget = asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.params;
  const { page = 1, limit = 15 } = req.query;

  const [reviews, total] = await Promise.all([
    Review.find({ target: targetId, targetType })
      .populate('patient', 'name avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Review.countDocuments({ target: targetId, targetType }),
  ]);

  sendSuccess(res, 200, 'Reviews retrieved.', { reviews, total });
});

exports.myReviewFor = asyncHandler(async (req, res) => {
  const review = await Review.findOne({
    patient: req.user._id,
    target: req.params.targetId,
  }).lean();
  sendSuccess(res, 200, 'Review retrieved.', { review: review ?? null });
});

