const SubscriptionPlan = require('../models/SubscriptionPlan');
const Subscription = require('../models/Subscription');
const { createSubscription, cancelSubscription } = require('../services/paystack.service');
const { createNotification } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.listPlans = asyncHandler(async (req, res) => {
  const plans = await SubscriptionPlan.find({ isActive: true });
  sendSuccess(res, 200, 'Plans retrieved.', { plans });
});

exports.subscribe = asyncHandler(async (req, res, next) => {
  const { planId } = req.body;
  const plan = await SubscriptionPlan.findById(planId);
  if (!plan || !plan.isActive) return next(new AppError('Plan not found or inactive.', 404));
  if (!plan.paystackPlanCode) return next(new AppError('Plan not yet configured on Paystack.', 503));

  const existing = await Subscription.findOne({ user: req.user._id, status: 'active' });
  if (existing) return next(new AppError('You already have an active subscription.', 400));

  const paystackSub = await createSubscription({
    customer: req.user.email,
    plan: plan.paystackPlanCode,
  });

  const subscription = await Subscription.create({
    user: req.user._id,
    plan: planId,
    paystackSubscriptionCode: paystackSub.subscription_code,
    paystackEmailToken: paystackSub.email_token,
    nextBillingDate: paystackSub.next_payment_date,
  });

  await createNotification({
    userId: req.user._id,
    type: 'subscription_activated',
    title: 'Subscription Activated',
    message: `Your ${plan.name} subscription is now active.`,
    emailData: { planName: plan.name },
  });

  sendSuccess(res, 201, 'Subscription activated.', { subscription });
});

exports.cancel = asyncHandler(async (req, res, next) => {
  const subscription = await Subscription.findOne({ user: req.user._id, status: 'active' }).populate('plan', 'name');
  if (!subscription) return next(new AppError('No active subscription found.', 404));

  await cancelSubscription({
    code: subscription.paystackSubscriptionCode,
    token: subscription.paystackEmailToken,
  });

  subscription.status = 'cancelled';
  await subscription.save();

  await createNotification({
    userId: req.user._id,
    type: 'subscription_cancelled',
    title: 'Subscription Cancelled',
    message: 'Your subscription has been cancelled.',
    emailData: { planName: subscription.plan?.name || 'iBam Health' },
  });

  sendSuccess(res, 200, 'Subscription cancelled.', { subscription });
});

exports.getMine = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({ user: req.user._id, status: 'active' }).populate('plan');
  sendSuccess(res, 200, 'Subscription retrieved.', { subscription });
});
