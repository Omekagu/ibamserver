const Facility = require('../models/Facility');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.create = asyncHandler(async (req, res, next) => {
  const { name, type, address, lat, lng, phone, email, website, operatingHours, services } = req.body;
  if (!lat || !lng) return next(new AppError('Coordinates (lat, lng) required.', 400));

  const facility = await Facility.create({
    name, type, address, phone, email, website, operatingHours, services,
    location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
  });
  sendSuccess(res, 201, 'Facility created.', { facility });
});

exports.getNearby = asyncHandler(async (req, res, next) => {
  const { lat, lng, radius = 5000, type } = req.query;
  if (!lat || !lng) return next(new AppError('lat and lng query params required.', 400));

  const filter = {
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        $maxDistance: Number(radius),
      },
    },
  };
  if (type) filter.type = type;

  const facilities = await Facility.find(filter).limit(20);
  sendSuccess(res, 200, 'Nearby facilities retrieved.', { facilities, count: facilities.length });
});

exports.getEmergency = asyncHandler(async (req, res, next) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return next(new AppError('lat and lng query params required.', 400));

  const facilities = await Facility.find({
    type: { $in: ['emergency', 'hospital'] },
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        $maxDistance: 20000, // 20km
      },
    },
  }).limit(5);

  sendSuccess(res, 200, 'Emergency facilities retrieved.', { facilities });
});

exports.getOne = asyncHandler(async (req, res, next) => {
  const facility = await Facility.findById(req.params.id);
  if (!facility) return next(new AppError('Facility not found.', 404));
  sendSuccess(res, 200, 'Facility retrieved.', { facility });
});

exports.update = asyncHandler(async (req, res, next) => {
  const { lat, lng, ...rest } = req.body;
  const updates = { ...rest };
  if (lat && lng) updates.location = { type: 'Point', coordinates: [Number(lng), Number(lat)] };

  const facility = await Facility.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!facility) return next(new AppError('Facility not found.', 404));
  sendSuccess(res, 200, 'Facility updated.', { facility });
});

exports.list = asyncHandler(async (req, res) => {
  const { type, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (type) filter.type = type;
  const facilities = await Facility.find(filter)
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Facility.countDocuments(filter);
  sendSuccess(res, 200, 'Facilities retrieved.', { facilities, total });
});
