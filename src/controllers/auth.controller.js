const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const GooglePending = require('../models/GooglePending');
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

const MAX_ATTEMPTS    = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const GOOGLE_PENDING_TTL_MS = 10 * 60 * 1000;

// ── Google pending-signup store (DB-backed, survives server restarts) ──────
async function storePendingGoogle (profile) {
  const token = crypto.randomBytes(16).toString('hex');
  await GooglePending.create({ token, ...profile, expiresAt: new Date(Date.now() + GOOGLE_PENDING_TTL_MS) });
  return token;
}

async function consumePendingGoogle (token) {
  const entry = await GooglePending.findOneAndDelete({ token, expiresAt: { $gt: new Date() } });
  return entry ? entry.toObject() : null;
}

async function peekPendingGoogle (token) {
  const entry = await GooglePending.findOne({ token, expiresAt: { $gt: new Date() } }).lean();
  return entry;
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

  const query = email ? { email } : { phone };
  const user = await User.findOne(query).select('+password +loginAttemptCount +loginLockedUntil');
  if (!user) return next(new AppError('Invalid credentials.', 401));

  // Check if account is locked
  if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
    const mins = Math.ceil((user.loginLockedUntil - Date.now()) / 60_000);
    return next(new AppError(`Account temporarily locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`, 429));
  }

  if (!(await user.comparePassword(password))) {
    const newCount = (user.loginAttemptCount || 0) + 1;
    const update = newCount >= MAX_ATTEMPTS
      ? { loginAttemptCount: 0, loginLockedUntil: new Date(Date.now() + LOCK_DURATION_MS) }
      : { loginAttemptCount: newCount, loginLockedUntil: null };
    await User.findByIdAndUpdate(user._id, update);
    return next(new AppError('Invalid credentials.', 401));
  }

  // Successful login — clear lock
  if (user.loginAttemptCount || user.loginLockedUntil) {
    await User.findByIdAndUpdate(user._id, { loginAttemptCount: 0, loginLockedUntil: null });
  }

  if (!user.isActive) return next(new AppError('Account deactivated. Contact support.', 403));
  if (!user.isVerified) return next(new AppError('Please verify your email before logging in.', 403));

  // Admin accounts require a one-time OTP before tokens are issued
  if (user.role === 'admin') {
    const otp = generateOTP();
    storeOTP(`admin_login:${user._id}`, otp);
    sendOTPEmail(user.email, otp).catch(() => {});
    return sendSuccess(res, 200, 'OTP sent to your admin email.', {
      requiresAdminOtp: true,
      adminUserId: user._id.toString(),
    });
  }

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, 200, 'Login successful.', { user, ...tokens });
});

exports.verifyAdminLoginOtp = asyncHandler(async (req, res, next) => {
  const { adminUserId, otp } = req.body;
  if (!adminUserId || !otp) return next(new AppError('adminUserId and otp are required.', 400));

  const user = await User.findById(adminUserId);
  if (!user || user.role !== 'admin') return next(new AppError('Invalid request.', 400));
  if (!user.isActive) return next(new AppError('Account deactivated. Contact support.', 403));

  const valid = verifyOTP(`admin_login:${adminUserId}`, otp);
  if (!valid) return next(new AppError('Invalid or expired OTP. Please log in again to receive a new code.', 400));

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
  if (!user.isActive) {
    return next(new AppError('Account deactivated.', 403));
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
    if (parsed.redirectUrl) {
      try {
        const dest = new URL(parsed.redirectUrl);
        const allowed = new URL(process.env.CLIENT_URL);
        if (dest.origin === allowed.origin) redirectUrl = parsed.redirectUrl;
      } catch { /* invalid URL — keep default */ }
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

  const CLIENT = process.env.CLIENT_URL || 'https://ibamhealth.com';

  const errorDest = (msg) => platform === 'mobile'
    ? `ibam://auth/error?message=${encodeURIComponent(msg)}`
    : `${CLIENT}/login?error=${encodeURIComponent(msg)}`;

  // Reject unverified Google accounts
  if (!verified_email) {
    return res.redirect(errorDest('Your Google account email is not verified. Please verify it with Google and try again.'));
  }

  // Find existing user by googleId or email
  const user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (!user) {
    const pendingToken = await storePendingGoogle({ googleId, name, email, picture });
    if (platform === 'mobile') {
      return res.redirect(`ibam://auth/google/pending?token=${encodeURIComponent(pendingToken)}`);
    }
    // Web: redirect to signup for role selection
    return res.redirect(`${CLIENT}/signup?googleToken=${encodeURIComponent(pendingToken)}`);
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

  // Link Google ID on first sign-in for existing email/password accounts
  const isNewGoogleLink = !user.googleId;
  if (isNewGoogleLink) {
    user.googleId = googleId;
    if (picture && !user.avatar) user.avatar = picture;
    if (!user.isVerified) user.isVerified = true;
    await user.save({ validateBeforeSave: false });
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

// GET /api/auth/google/pending?token=...
exports.getGooglePending = asyncHandler(async (req, res, next) => {
  const { token } = req.query;
  if (!token) return next(new AppError('token is required.', 400));
  const profile = await peekPendingGoogle(token);
  if (!profile) return next(new AppError('Link expired or invalid. Please try Google sign-in again.', 410));
  sendSuccess(res, 200, 'Pending profile retrieved.', {
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
  });
});

// POST /api/auth/google/complete
exports.completeGoogleSignup = asyncHandler(async (req, res, next) => {
  const { token, role, phone, specialization, licenseNumber } = req.body;
  if (!token) return next(new AppError('token is required.', 400));

  const pending = await consumePendingGoogle(token);
  if (!pending) return next(new AppError('Link expired. Please try Google sign-in again.', 410));

  const allowedRoles = ['patient', 'doctor'];
  if (!allowedRoles.includes(role)) return next(new AppError('Invalid role.', 400));

  if (role === 'doctor') {
    if (!specialization || !licenseNumber) {
      return next(new AppError('Doctors must provide specialization and license number.', 400));
    }
    const licenseExists = await Doctor.findOne({ licenseNumber });
    if (licenseExists) return next(new AppError('A doctor with that licence number is already registered.', 409));
  }

  const existing = await User.findOne({ $or: [{ googleId: pending.googleId }, { email: pending.email }] });
  if (existing) return next(new AppError('An account with this email already exists. Please log in instead.', 409));

  let user;
  try {
    user = await User.create({
      name: pending.name || pending.email.split('@')[0],
      email: pending.email,
      googleId: pending.googleId,
      avatar: pending.picture || undefined,
      role,
      isVerified: true,
      password: crypto.randomBytes(32).toString('hex'),
      ...(phone && { phone }),
    });
  } catch (err) {
    return next(new AppError(err.code === 11000 ? 'An account with this email already exists.' : 'Registration failed. Please try again.', 409));
  }

  try {
    if (role === 'patient') {
      await Patient.create({ user: user._id });
    } else if (role === 'doctor') {
      await Doctor.create({ user: user._id, specialization, licenseNumber, employmentType: 'freelancer' });
    }
  } catch (profileErr) {
    await User.findByIdAndDelete(user._id);
    return next(new AppError(profileErr.code === 11000 ? 'A doctor with that licence number is already registered.' : 'Registration failed. Please try again.', 409));
  }

  sendWelcomeEmail(user).catch(() => {});
  const roleLabel = role === 'doctor' ? 'Doctor' : 'Patient';
  notifyAdmins({
    type: 'new_registration',
    title: `New ${roleLabel} Registered (Google)`,
    message: `${user.name} created a ${roleLabel.toLowerCase()} account via Google.`,
    metadata: { userId: user._id, role, email: user.email },
  }).catch(() => {});
  sendAdminAlertEmail({
    subject: `New ${roleLabel} registered via Google — ${user.name}`,
    headline: `New ${roleLabel} Registration (Google)`,
    body: `${user.name} (${user.email}) created a new ${roleLabel.toLowerCase()} account via Google OAuth.`,
    ctaLabel: `View ${roleLabel}s`,
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/users`,
  }).catch(() => {});

  const tokens = issueTokens(user);
  user.refreshToken = tokens.refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, 201, 'Account created successfully.', { user, ...tokens });
});
