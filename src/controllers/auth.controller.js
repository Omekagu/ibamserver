const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { generateOTP, storeOTP, verifyOTP } = require('../utils/otp');
const { sendSMS } = require('../services/termii.service');
const { sendWelcomeEmail, sendPasswordResetEmail, sendOTPEmail, sendPasswordChangedEmail, sendAdminAlertEmail } = require('../services/email.service');
const { notifyAdmins } = require('../services/notification.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const issueTokens = (user) => ({
  accessToken: signAccessToken({ id: user._id, role: user.role }),
  refreshToken: signRefreshToken({ id: user._id }),
});

// ── In-memory login attempt tracker (per email) ────────────────────────────
const loginAttempts = new Map(); // email → { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function checkLoginLock(email) {
  const record = loginAttempts.get(email);
  if (!record) return null;
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60_000);
    return `Account temporarily locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`;
  }
  return null;
}

function recordFailedLogin(email) {
  const record = loginAttempts.get(email) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_DURATION_MS;
    record.count = 0;
  }
  loginAttempts.set(email, record);
}

function clearLoginLock(email) {
  loginAttempts.delete(email);
}

exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, phone, password, role, specialization, licenseNumber, employmentType } = req.body;

  const allowedRoles = ['patient', 'doctor'];
  if (role && !allowedRoles.includes(role)) {
    return next(new AppError('Invalid role for registration.', 400));
  }

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) return next(new AppError('Email or phone already registered.', 409));

  if (role === 'doctor') {
    if (!specialization || !licenseNumber) {
      return next(new AppError('Doctors must provide specialization and license number.', 400));
    }
    const licenseExists = await Doctor.findOne({ licenseNumber });
    if (licenseExists) return next(new AppError('A doctor with that licence number is already registered.', 409));
  }

  const user = await User.create({ name, email, phone, password, role: role || 'patient' });

  try {
    if (user.role === 'patient') {
      await Patient.create({ user: user._id });
    } else if (user.role === 'doctor') {
      await Doctor.create({ user: user._id, specialization, licenseNumber, employmentType: employmentType || 'freelancer' });
    }
  } catch (profileErr) {
    await User.findByIdAndDelete(user._id);
    return next(new AppError(profileErr.code === 11000 ? 'A doctor with that licence number is already registered.' : 'Registration failed. Please try again.', 409));
  }

  // Send OTP for verification + welcome email (both non-fatal)
  try {
    const otp = generateOTP();
    storeOTP(`email:${user.email}`, otp);
    await sendOTPEmail(user.email, otp);
  } catch { /* non-fatal */ }
  sendWelcomeEmail(user).catch(() => {});

  const roleLabel = user.role === 'doctor' ? 'Doctor' : 'Patient';
  notifyAdmins({
    type: 'new_registration',
    title: `New ${roleLabel} Registered`,
    message: `${user.name} signed up as a ${roleLabel.toLowerCase()}.`,
    metadata: { userId: user._id, role: user.role, email: user.email },
  }).catch(() => {});
  sendAdminAlertEmail({
    subject: `New ${roleLabel} registered — ${user.name}`,
    headline: `New ${roleLabel} Registration`,
    body: `${user.name} (${user.email}) has just registered as a ${roleLabel.toLowerCase()} on iBam Health.`,
    ctaLabel: `View ${roleLabel}s`,
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/users`,
  }).catch(() => {});

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, 201, 'Registration successful.', { user, ...tokens });
});

exports.login = asyncHandler(async (req, res, next) => {
  const { email, phone, password } = req.body;
  if ((!email && !phone) || !password) {
    return next(new AppError('Please provide email or phone and password.', 400));
  }

  const lockKey = (email || phone).toLowerCase().trim();
  const lockMsg = checkLoginLock(lockKey);
  if (lockMsg) return next(new AppError(lockMsg, 429));

  const query = email ? { email } : { phone };
  const user = await User.findOne(query).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    recordFailedLogin(lockKey);
    return next(new AppError('Invalid credentials.', 401));
  }

  clearLoginLock(lockKey);

  if (!user.isActive) return next(new AppError('Account deactivated. Contact support.', 403));
  if (!user.isVerified) return next(new AppError('Please verify your email before logging in.', 403));

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, 200, 'Login successful.', { user, ...tokens });
});

exports.sendOTP = asyncHandler(async (req, res, next) => {
  const { phone } = req.body;
  if (!phone) return next(new AppError('Phone number required.', 400));

  const otp = generateOTP();
  storeOTP(phone, otp);

  try {
    await sendSMS(phone, `Your iBam Health OTP is: ${otp}. Valid for 10 minutes.`);
  } catch {
    return next(new AppError('Failed to send OTP. Try again.', 502));
  }

  sendSuccess(res, 200, 'OTP sent successfully.');
});

exports.verifyOTP = asyncHandler(async (req, res, next) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return next(new AppError('Phone and OTP required.', 400));

  const valid = verifyOTP(phone, otp);
  if (!valid) return next(new AppError('Invalid or expired OTP.', 400));

  await User.findOneAndUpdate({ phone }, { isVerified: true });
  sendSuccess(res, 200, 'Phone verified successfully.');
});

exports.sendEmailOTP = asyncHandler(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return next(new AppError('Email required.', 400));

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return next(new AppError('No account with that email.', 404));

  const otp = generateOTP();
  storeOTP(`email:${email.toLowerCase().trim()}`, otp);

  try {
    await sendOTPEmail(email, otp);
  } catch {
    return next(new AppError('Failed to send OTP. Try again.', 502));
  }

  sendSuccess(res, 200, 'Verification code sent to your email.');
});

exports.verifyEmailOTP = asyncHandler(async (req, res, next) => {
  const { email, otp } = req.body;
  if (!email || !otp) return next(new AppError('Email and OTP required.', 400));

  const key = `email:${email.toLowerCase().trim()}`;
  const valid = verifyOTP(key, otp);
  if (!valid) return next(new AppError('Invalid or expired code.', 400));

  await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { isVerified: true }
  );
  sendSuccess(res, 200, 'Email verified successfully.');
});

exports.refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return next(new AppError('Refresh token required.', 400));

  const decoded = verifyRefreshToken(refreshToken);
  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || user.refreshToken !== refreshToken) {
    return next(new AppError('Invalid refresh token.', 401));
  }

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, 200, 'Tokens refreshed.', tokens);
});

exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return next(new AppError('No account with that email.', 404));

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = Date.now() + 60 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
  sendPasswordResetEmail(user, resetUrl).catch(err =>
    console.error('[ForgotPassword] Email delivery failed:', err.message)
  );
  sendSuccess(res, 200, 'If an account with that email exists, a reset link has been sent.');
});

exports.resetPassword = asyncHandler(async (req, res, next) => {
  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) return next(new AppError('Token is invalid or has expired.', 400));

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  sendPasswordChangedEmail(user).catch(() => {});

  const tokens = issueTokens(user);
  sendSuccess(res, 200, 'Password reset successful.', tokens);
});

exports.logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
  sendSuccess(res, 200, 'Logged out successfully.');
});

exports.registerPushToken = asyncHandler(async (req, res, next) => {
  const { token } = req.body;
  if (!token) return next(new AppError('Push token required.', 400));
  await User.findByIdAndUpdate(req.user._id, { expoPushToken: token });
  sendSuccess(res, 200, 'Push token registered.');
});

exports.clearPushToken = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { expoPushToken: null });
  sendSuccess(res, 200, 'Push token cleared.');
});

// ── Google OAuth ───────────────────────────────────────────────────────────

exports.googleRedirect = asyncHandler(async (req, res) => {
  const { platform = 'web', redirectUrl } = req.query;

  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect(`${process.env.CLIENT_URL}/login?error=Google+OAuth+not+configured`);
  }

  const state = Buffer.from(JSON.stringify({ platform, redirectUrl })).toString('base64');
  const callbackUrl = `${process.env.SERVER_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

exports.googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  let platform = 'web';
  let redirectUrl = process.env.CLIENT_URL;

  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    platform = parsed.platform || 'web';
    if (parsed.redirectUrl && parsed.redirectUrl.startsWith(process.env.CLIENT_URL)) {
      redirectUrl = parsed.redirectUrl;
    }
  } catch { /* use defaults */ }

  if (error) {
    const dest = platform === 'mobile'
      ? `ibam://auth/error?message=${encodeURIComponent(error)}`
      : `${redirectUrl}?error=${encodeURIComponent(error)}`;
    return res.redirect(dest);
  }

  const callbackUrl = `${process.env.SERVER_URL}/api/auth/google/callback`;

  // Exchange code for Google tokens
  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
  });

  const { access_token } = tokenRes.data;

  // Fetch Google profile
  const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  const { id: googleId, email, name, picture, verified_email } = profileRes.data;

  const errorDest = (msg) => platform === 'mobile'
    ? `ibam://auth/error?message=${encodeURIComponent(msg)}`
    : `/login?error=${encodeURIComponent(msg)}`;

  // Reject unverified Google accounts
  if (!verified_email) {
    return res.redirect(errorDest('Your Google account email is not verified. Please verify it with Google and try again.'));
  }

  // Find existing user by googleId or email
  const user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (!user) {
    const dest = platform === 'mobile'
      ? `ibam://auth/error?message=${encodeURIComponent('No account found. Please sign up first.')}`
      : `/signup?error=${encodeURIComponent('No iBam account found for this Google address. Please sign up first.')}`;
    return res.redirect(dest);
  }

  // Partner and admin accounts must use email/password
  const restricted = ['pharmacy_partner', 'lab_partner', 'admin', 'field_agent'];
  if (restricted.includes(user.role)) {
    return res.redirect(errorDest('This account type does not support Google sign-in. Please log in with your email and password.'));
  }

  // Reject deactivated accounts
  if (!user.isActive) {
    return res.redirect(errorDest('Your account has been deactivated. Please contact support.'));
  }

  const isNewGoogleLink = !user.googleId;

  // Link Google ID on first Google sign-in
  if (isNewGoogleLink) {
    user.googleId = googleId;
    if (picture && !user.avatar) user.avatar = picture;
    // Mark email verified since Google has confirmed it
    if (!user.isVerified) user.isVerified = true;
    await user.save({ validateBeforeSave: false });
    // Send welcome email only on first-time Google link
    sendWelcomeEmail(user).catch(() => {});
  }

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  const userJSON = user.toJSON();
  const tokenParam = encodeURIComponent(tokens.accessToken);
  const refreshParam = encodeURIComponent(tokens.refreshToken);
  const userParam = encodeURIComponent(JSON.stringify(userJSON));

  if (platform === 'mobile') {
    return res.redirect(
      `ibam://auth/google?token=${tokenParam}&refreshToken=${refreshParam}&user=${userParam}`
    );
  }

  return res.redirect(
    `${redirectUrl}?token=${tokenParam}&refreshToken=${refreshParam}&user=${userParam}`
  );
});
