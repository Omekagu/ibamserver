const Notification = require('../models/Notification');
const { markAsRead, markAllAsRead } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

exports.getMine = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const filter = { user: req.user._id };
  if (unreadOnly === 'true') filter.isRead = false;

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Notification.countDocuments({ user: req.user._id, isRead: false }),
  ]);

  sendSuccess(res, 200, 'Notifications retrieved.', { notifications, unreadCount });
});

exports.markRead = asyncHandler(async (req, res) => {
  const notification = await markAsRead(req.params.id, req.user._id);
  sendSuccess(res, 200, 'Notification marked as read.', { notification });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await markAllAsRead(req.user._id);
  sendSuccess(res, 200, 'All notifications marked as read.');
});
