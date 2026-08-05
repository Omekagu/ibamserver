const AuditLog = require('../models/AuditLog');

const audit = (action, targetModel) => async (req, res, next) => {
  res.on('finish', async () => {
    if (res.statusCode < 400 && req.user?.role === 'admin') {
      try {
        await AuditLog.create({
          admin: req.user._id,
          action,
          targetModel,
          targetId: req.params.id,
          details: req.body,
          ipAddress: req.ip,
        });
      } catch {
        // Non-fatal — audit failure should not break the request
      }
    }
  });
  next();
};

module.exports = { audit };
