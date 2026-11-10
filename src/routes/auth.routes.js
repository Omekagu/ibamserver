const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/auth.controller');
const usersCtrl = require('../controllers/users.controller');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// ─── Per-route rate limiters ───────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many accounts created from this IP. Please try again in an hour.' },
});

const otpSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many code requests. Please wait an hour before requesting again.' },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many verification attempts. Please wait 15 minutes.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many password reset requests. Please wait an hour.' },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many password reset attempts. Please wait an hour.' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many token refresh requests.' },
});

// ─── Routes ────────────────────────────────────────────────────────────────

router.post('/register',
  registerLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('phone').trim().notEmpty().withMessage('Phone required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate, ctrl.register
);

router.post('/login',
  loginLimiter,
  [body('password').notEmpty().withMessage('Password required')],
  validate, ctrl.login
);

router.post('/send-otp',
  otpSendLimiter,
  [body('phone').trim().notEmpty().withMessage('Phone required')],
  validate, ctrl.sendOTP
);

router.post('/verify-otp',
  otpVerifyLimiter,
  [
    body('phone').trim().notEmpty().withMessage('Phone required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate, ctrl.verifyOTP
);

router.post('/send-email-otp',
  otpSendLimiter,
  [body('email').isEmail().withMessage('Valid email required')],
  validate, ctrl.sendEmailOTP
);

router.post('/verify-email-otp',
  otpVerifyLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate, ctrl.verifyEmailOTP
);

router.post('/verify-admin-otp',
  otpVerifyLimiter,
  [
    body('adminUserId').notEmpty().withMessage('adminUserId required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate, ctrl.verifyAdminLoginOtp
);

router.post('/resend-admin-otp',
  otpVerifyLimiter,
  [body('adminUserId').notEmpty().withMessage('adminUserId required')],
  validate, ctrl.resendAdminLoginOtp
);

router.post('/refresh-token', refreshLimiter, ctrl.refreshToken);
router.post('/forgot-password', forgotPasswordLimiter, ctrl.forgotPassword);
router.patch('/reset-password/:token', resetPasswordLimiter, ctrl.resetPassword);
router.get('/me', protect, usersCtrl.getProfile);
router.patch('/me', protect, usersCtrl.updateProfile);
router.post('/logout', protect, ctrl.logout);
router.post('/push-token', protect, ctrl.registerPushToken);
router.delete('/push-token', protect, ctrl.clearPushToken);

// Google OAuth
router.get('/google', ctrl.googleRedirect);
router.get('/google/callback', ctrl.googleCallback);
router.get('/google/pending', ctrl.getGooglePending);
router.post('/google/complete', ctrl.completeGoogleSignup);

module.exports = router;
