const AuditLog = require('../models/AuditLog');

const AUDITED_ROLES = ['admin', 'lab_partner'];

const audit = (action, targetModel) => async (req, res, next) => {
  res.on('finish', async () => {
    if (res.statusCode < 400 && req.user && AUDITED_ROLES.includes(req.user.role)) {
      try {
        await AuditLog.create({
          admin: req.user._id,
          actorRole: req.user.adminRole || req.user.role,
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
