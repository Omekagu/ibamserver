const AppError = require('../utils/AppError');

/**
 * Permission sets per admin role.
 * 'super_admin' bypasses all checks.
 */
const ROLE_PERMISSIONS = {
  lab_admin:     ['labs', 'diagnostics', 'walk_in', 'lab_tests', 'doctors', 'kyc'],
  finance_admin: ['payments', 'payouts', 'earnings'],
  support_admin: ['users', 'monitoring', 'appointments', 'audit', 'broadcast'],
  ops_admin:     ['approvals', 'orders', 'pharmacy', 'drugs'],
};

/**
 * requirePermission('labs') — attach after protect + restrictTo('admin').
 * super_admin always passes; other roles must have the permission listed.
 */
const requirePermission = (permission) => (req, res, next) => {
  const adminRole = req.user?.adminRole || 'super_admin';
  if (adminRole === 'super_admin') return next();
  const allowed = ROLE_PERMISSIONS[adminRole] || [];
  if (allowed.includes(permission)) return next();
  return next(new AppError('You do not have permission to perform this action.', 403));
};

module.exports = { requirePermission, ROLE_PERMISSIONS };
