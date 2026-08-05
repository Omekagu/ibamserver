const ProductSubscription = require('../models/ProductSubscription');
const PharmacyPartner = require('../models/PharmacyPartner');
const LabPartner = require('../models/LabPartner');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

function nextDueDate (frequency) {
  const d = new Date();
  if (frequency === 'weekly')   d.setDate(d.getDate() + 7);
  if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  if (frequency === 'monthly')  d.setMonth(d.getMonth() + 1);
  return d;
}

exports.getMine = asyncHandler(async (req, res) => {
  const subs = await ProductSubscription.find({ patient: req.user._id })
    .populate('pharmacy', 'name address')
    .populate('lab', 'name address')
    .sort({ createdAt: -1 });
  sendSuccess(res, 200, 'Subscriptions retrieved.', { subscriptions: subs });
});

exports.create = asyncHandler(async (req, res, next) => {
  const { type, pharmacyId, labId, drugItems, testItems, collectionType,
          fulfillmentType, deliveryAddress, frequency, notes } = req.body;

  if (!type || !frequency) return next(new AppError('type and frequency are required.', 400));

  let totalAmount = 0;

  if (type === 'drug') {
    if (!pharmacyId || !Array.isArray(drugItems) || !drugItems.length) {
      return next(new AppError('pharmacyId and drugItems required for drug subscription.', 400));
    }
    const pharmacy = await PharmacyPartner.findById(pharmacyId);
    if (!pharmacy) return next(new AppError('Pharmacy not found.', 404));
    for (const item of drugItems) totalAmount += (item.price || 0) * (item.qty || 1);
  }

  if (type === 'test') {
    if (!labId || !Array.isArray(testItems) || !testItems.length) {
      return next(new AppError('labId and testItems required for test subscription.', 400));
    }
    const lab = await LabPartner.findById(labId);
    if (!lab) return next(new AppError('Lab not found.', 404));
    for (const item of testItems) totalAmount += item.price || 0;
  }

  const sub = await ProductSubscription.create({
    patient: req.user._id,
    type,
    pharmacy: pharmacyId || undefined,
    drugItems: type === 'drug' ? drugItems : [],
    fulfillmentType: type === 'drug' ? fulfillmentType : undefined,
    deliveryAddress: type === 'drug' ? deliveryAddress : undefined,
    lab: labId || undefined,
    testItems: type === 'test' ? testItems : [],
    collectionType: type === 'test' ? collectionType : undefined,
    frequency,
    nextDue: nextDueDate(frequency),
    totalAmount,
    notes,
  });

  sendSuccess(res, 201, 'Subscription created.', { subscription: sub });
});

exports.update = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const sub = await ProductSubscription.findOne({ _id: req.params.id, patient: req.user._id });
  if (!sub) return next(new AppError('Subscription not found.', 404));
  if (status) sub.status = status;
  await sub.save();
  sendSuccess(res, 200, 'Subscription updated.', { subscription: sub });
});

exports.getAll = asyncHandler(async (req, res) => {
  const { status, type, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  const subs = await ProductSubscription.find(filter)
    .populate('patient', 'name email')
    .populate('pharmacy', 'name')
    .populate('lab', 'name')
    .sort({ nextDue: 1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await ProductSubscription.countDocuments(filter);
  sendSuccess(res, 200, 'All subscriptions retrieved.', { subscriptions: subs, total });
});
