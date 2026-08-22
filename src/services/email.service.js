// Unified email service — tries Nodemailer (SMTP) → Resend → SendGrid in order.
// Whichever provider has env vars set is used; the rest are skipped.

const FROM_NAME = 'iBam Health';
const FROM_ADDR = process.env.EMAIL_FROM || 'noreply@ibamhealth.com';
const FROM      = `${FROM_NAME} <${FROM_ADDR}>`;

// ─── Base template ────────────────────────────────
const base = (body) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>iBam Health</title>
</head>
<body style="margin:0;padding:0;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.12)">
    <!-- Header -->
    <div style="background:#0D1B2A;padding:28px 36px;border-bottom:4px solid #22C55E">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle">
          <img src="${APP_URL}/Ibam%20Logo%20Png.png" alt="" width="36" height="36" style="border-radius:8px;vertical-align:middle;display:inline-block;margin-right:10px">
          <span style="font-size:20px;font-weight:800;color:#ffffff;vertical-align:middle;letter-spacing:-0.3px">iBam&nbsp;<span style="color:#22C55E">Health</span></span>
        </td>
      </tr></table>
    </div>
    <!-- Body -->
    <div style="background:#ffffff;padding:36px 36px 32px">${body}</div>
    <!-- Footer -->
    <div style="background:#0D1B2A;padding:24px 36px;text-align:center">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.02em">Quality Healthcare, Delivered</p>
      <p style="margin:0 0 14px;font-size:11px;color:#5A7A96;line-height:1.6">© 2025 iBam Health &nbsp;·&nbsp; This is an automated message — please do not reply.</p>
      <p style="margin:0;font-size:11px">
        <a href="mailto:support@ibamhealth.com" style="color:#22C55E;text-decoration:none;font-weight:600">support@ibamhealth.com</a>
        &nbsp;&nbsp;·&nbsp;&nbsp;
        <a href="${APP_URL}" style="color:#22C55E;text-decoration:none;font-weight:600">ibamhealth.com</a>
      </p>
    </div>
  </div>
</body></html>`;

const btn = (href, label) =>
  `<a href="${href}" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#22C55E;color:#0D1B2A;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:0.01em">${label}</a>`;

const pill = (label, color = '#22C55E') =>
  `<span style="display:inline-block;padding:4px 14px;background:${color}22;color:${color};border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.03em">${label}</span>`;

const h2   = (t) => `<h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0D1B2A;line-height:1.25">${t}</h2>`;
const para = (t) => `<p style="margin:12px 0;font-size:14px;color:#4B5563;line-height:1.65">${t}</p>`;
const info = (label, value) =>
  `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #F3F4F6"><span style="font-size:13px;color:#9CA3AF;font-weight:500">${label}</span><span style="font-size:13px;color:#0D1B2A;font-weight:700">${value}</span></div>`;
const numberedList = (items) =>
  `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0">
    ${items.map((text, i) =>
      `<tr>
        <td width="40" style="vertical-align:top;padding-bottom:16px">
          <div style="width:28px;height:28px;border-radius:50%;background:#F1F5F9;font-size:12px;font-weight:800;color:#374151;text-align:center;line-height:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${i + 1}</div>
        </td>
        <td style="vertical-align:top;padding-bottom:16px;padding-left:4px">
          <p style="margin:4px 0 0;font-size:14px;color:#4B5563;line-height:1.65">${text}</p>
        </td>
      </tr>`
    ).join('')}
  </table>`;

const APP_URL = process.env.CLIENT_URL || 'https://ibamhealth.com';

// ─── Transport ───────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const nodemailer = require('nodemailer');
    const port   = Number(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port,
      secure,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls:    { rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === 'true' },
    });
    try {
      await transporter.sendMail({ from: FROM, to, subject, html, text });
      console.log(`[Email] Sent "${subject}" → ${to}`);
    } catch (err) {
      console.error(`[Email] SMTP failed for "${subject}" → ${to}:`, err.message);
      throw err;
    }
    return;
  }
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) throw new Error(`Resend error: ${error.message}`);
    console.log(`[Email] Sent via Resend "${subject}" → ${to}`);
    return;
  }
  if (process.env.SENDGRID_API_KEY) {
    const { sendEmail: sgSend } = require('./sendgrid.service');
    await sgSend({ to, subject, html, text });
    return;
  }
  console.warn(`[Email] No provider configured — skipping "${subject}" → ${to}`);
};

// ─── Auth emails ─────────────────────────────────
const sendOTPEmail = (email, otp) =>
  sendEmail({
    to: email,
    subject: 'iBam Health — Email Verification Code',
    html: base(`
      ${h2('Verify your email address')}
      ${para('Enter the code below to confirm your email. It expires in 10 minutes.')}
      <div style="background:#F3F4F6;border-radius:14px;padding:28px;text-align:center;margin:24px 0;letter-spacing:0.3em;font-size:2.25rem;font-weight:900;color:#0D1B2A;font-family:monospace">${otp}</div>
      ${para("If you didn't request this, you can safely ignore this email.")}
    `),
    text: `Your iBam Health verification code is: ${otp}. Valid for 10 minutes.`,
  });

const sendWelcomeEmail = (user) =>
  sendEmail({
    to: user.email,
    subject: `Welcome to iBam Health, ${user.name.split(' ')[0]}!`,
    html: base(`
      <div style="background:#F0FDF4;border-radius:10px;padding:20px 24px;margin-bottom:24px;border-left:4px solid #22C55E">
        <p style="margin:0;font-size:13px;font-weight:700;color:#15803D;text-transform:uppercase;letter-spacing:0.06em">Account Activated</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#0D1B2A;line-height:1.25">Welcome, ${user.name.split(' ')[0]}!</p>
      </div>
      <p style="margin:0 0 6px;font-size:15px;color:#111827;line-height:1.65">Your <strong>iBam Health</strong> account is set up and ready to use.</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6B7280;line-height:1.65">Here is everything you can do from day one:</p>
      ${numberedList([
        '<strong>Video, audio &amp; chat consultations</strong> — book with verified doctors at any time',
        '<strong>Lab test requests</strong> — home visit or walk-in sample collection',
        '<strong>Pharmacy orders</strong> — prescription and OTC medications delivered to you',
        '<strong>Health records</strong> — access your full medical history anytime',
      ])}
      ${btn(`${APP_URL}/patient`, 'Open My Dashboard →')}
      <p style="margin:28px 0 0;font-size:12px;color:#9CA3AF;line-height:1.7;border-top:1px solid #F3F4F6;padding-top:20px">
        Questions? We are here to help — reach us at
        <a href="mailto:support@ibamhealth.com" style="color:#22C55E;text-decoration:none;font-weight:600">support@ibamhealth.com</a>
      </p>
    `),
    text: `Welcome to iBam Health, ${user.name}! Your account is ready. Visit ${APP_URL}/patient to get started.`,
  });

const sendPasswordResetEmail = (user, resetUrl) =>
  sendEmail({
    to: user.email,
    subject: 'iBam Health — Password Reset Request',
    html: base(`
      ${h2('Reset your password')}
      ${para('We received a request to reset your password. Click the button below — the link expires in 10 minutes.')}
      ${btn(resetUrl, 'Reset Password')}
      ${para("If you didn't request a password reset, you can safely ignore this email. Your password won't change.")}
    `),
    text: `Reset your iBam Health password at: ${resetUrl}`,
  });

// ─── Appointment emails ───────────────────────────
const sendAppointmentBookedEmail = ({ doctorEmail, doctorName, patientName, type, scheduledAt }) =>
  sendEmail({
    to: doctorEmail,
    subject: `New ${type} appointment booked — iBam Health`,
    html: base(`
      ${h2('New Appointment Request')}
      ${pill('Booked')}
      ${para(`<strong>${patientName}</strong> has booked an appointment with you.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Patient', patientName)}
        ${info('Type', type.charAt(0).toUpperCase() + type.slice(1))}
        ${info('Scheduled', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/doctor/appointments`, 'View Appointment')}
    `),
    text: `New ${type} appointment with ${patientName} on ${new Date(scheduledAt).toLocaleString()}.`,
  });

const sendAppointmentConfirmedEmail = ({ patientEmail, patientName, doctorName, type, scheduledAt }) =>
  sendEmail({
    to: patientEmail,
    subject: 'Your appointment is confirmed — iBam Health',
    html: base(`
      ${h2('Appointment Confirmed ✅')}
      ${para(`Hi ${patientName}, your appointment has been confirmed.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Doctor', `Dr. ${doctorName}`)}
        ${info('Type', type.charAt(0).toUpperCase() + type.slice(1))}
        ${info('Date & Time', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/patient/appointments`, 'View Appointment')}
    `),
    text: `Your appointment with Dr. ${doctorName} on ${new Date(scheduledAt).toLocaleString()} is confirmed.`,
  });

const sendAppointmentCancelledEmail = ({ email, name, doctorName, scheduledAt, reason }) =>
  sendEmail({
    to: email,
    subject: 'Appointment cancelled — iBam Health',
    html: base(`
      ${h2('Appointment Cancelled')}
      ${pill('Cancelled', '#EF4444')}
      ${para(`Hi ${name}, your appointment with Dr. ${doctorName} scheduled for <strong>${new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}</strong> has been cancelled.`)}
      ${reason ? para(`<strong>Reason:</strong> ${reason}`) : ''}
      ${para('You can book a new appointment at any time.')}
      ${btn(`${APP_URL}/patient/book`, 'Book New Appointment')}
    `),
    text: `Your appointment with Dr. ${doctorName} has been cancelled.`,
  });

// ─── Prescription ─────────────────────────────────
const sendPrescriptionReadyEmail = ({ email, name, doctorName, medications }) =>
  sendEmail({
    to: email,
    subject: 'Your prescription is ready — iBam Health',
    html: base(`
      ${h2('Prescription Ready 💊')}
      ${para(`Hi ${name}, Dr. ${doctorName} has issued a prescription for you.`)}
      ${medications?.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Medications</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${medications.map(m => `<li>${m}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${btn(`${APP_URL}/patient/records`, 'View Prescription')}
    `),
    text: `Your prescription from Dr. ${doctorName} is ready. View it at ${APP_URL}/patient/records`,
  });

// ─── Lab results ──────────────────────────────────
const sendLabResultReadyEmail = ({ email, name, tests }) =>
  sendEmail({
    to: email,
    subject: 'Your lab results are ready — iBam Health',
    html: base(`
      ${h2('Lab Results Ready 🔬')}
      ${para(`Hi ${name}, your lab results are now available for download.`)}
      ${tests?.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Tests completed</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${tests.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${btn(`${APP_URL}/patient/labs`, 'Download Results')}
    `),
    text: `Your lab results are ready. View them at ${APP_URL}/patient/labs`,
  });

// ─── Pharmacy order ───────────────────────────────
const sendPharmacyOrderUpdateEmail = ({ email, name, status, pharmacyName, items }) => {
  const statusLabels = { pending: 'Received', processing: 'Being Prepared', ready: 'Ready for Collection', dispatched: 'Out for Delivery', delivered: 'Delivered' };
  const statusColors = { ready: '#10B981', dispatched: '#3B82F6', delivered: '#6B7280', processing: '#F59E0B' };
  const label = statusLabels[status] || status;
  const color = statusColors[status] || '#0A8F6C';
  return sendEmail({
    to: email,
    subject: `Order update: ${label} — iBam Health`,
    html: base(`
      ${h2('Pharmacy Order Update 📦')}
      ${pill(label, color)}
      ${para(`Hi ${name}, your order from <strong>${pharmacyName}</strong> is now: <strong>${label}</strong>.`)}
      ${items?.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          ${items.map(i => info(i.name, `×${i.qty ?? i.quantity ?? 1}`)).join('')}
        </div>` : ''}
      ${btn(`${APP_URL}/patient/pharmacy`, 'Track Order')}
    `),
    text: `Your pharmacy order is ${label}.`,
  });
};

// ─── Payment ──────────────────────────────────────
const sendPaymentSuccessEmail = ({ email, name, amount, description }) =>
  sendEmail({
    to: email,
    subject: 'Payment confirmed — iBam Health',
    html: base(`
      ${h2('Payment Successful 💳')}
      ${pill('Paid', '#10B981')}
      ${para(`Hi ${name}, your payment has been received.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Description', description || 'iBam Health Service')}
        ${info('Amount', `₦${Number(amount).toLocaleString()}`)}
        ${info('Date', new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/patient`, 'View Dashboard')}
    `),
    text: `Payment of ₦${Number(amount).toLocaleString()} confirmed. Thank you!`,
  });

// ─── Subscription ────────────────────────────────
const sendSubscriptionEmail = ({ email, name, planName, status }) => {
  const activated = status === 'activated';
  return sendEmail({
    to: email,
    subject: `Subscription ${activated ? 'activated' : 'cancelled'} — iBam Health`,
    html: base(`
      ${h2(activated ? `Subscription Activated ⭐` : 'Subscription Cancelled')}
      ${pill(activated ? 'Active' : 'Cancelled', activated ? '#10B981' : '#EF4444')}
      ${para(`Hi ${name}, your <strong>${planName}</strong> subscription has been ${status}.`)}
      ${activated ? para('You now have access to all features included in your plan.') : para('You can re-subscribe at any time from the subscriptions page.')}
      ${btn(`${APP_URL}/patient/subscriptions`, 'Manage Subscriptions')}
    `),
    text: `Your ${planName} subscription has been ${status}.`,
  });
};

// ─── Doctor / partner approval ────────────────────
const sendDoctorApprovedEmail = ({ email, name }) =>
  sendEmail({
    to: email,
    subject: 'Your iBam Health doctor account is approved!',
    html: base(`
      ${h2(`Congratulations, Dr. ${name}! 🎉`)}
      ${pill('Approved', '#10B981')}
      ${para('Your iBam Health doctor account has been reviewed and approved. You can now start accepting patient appointments.')}
      ${btn(`${APP_URL}/doctor`, 'Open Doctor Portal')}
    `),
    text: `Dr. ${name}, your iBam Health doctor account has been approved!`,
  });

const sendPartnerApprovedEmail = ({ email, name, partnerType }) => {
  const isLab = (partnerType || '').toLowerCase().includes('lab');
  const portalUrl = isLab ? `${APP_URL}/lab` : `${APP_URL}/pharmacy`;
  return sendEmail({
    to: email,
    subject: 'Your iBam Health partner account is approved!',
    html: base(`
      ${h2(`Welcome to the Network, ${name}! 🤝`)}
      ${pill('Approved', '#10B981')}
      ${para(`Your ${partnerType || 'partner'} account on iBam Health has been approved. You can now manage your services and accept orders.`)}
      ${btn(portalUrl, 'Open Partner Portal')}
    `),
    text: `${name}, your iBam Health partner account has been approved! Log in at ${portalUrl}`,
  });
};

// ─── Appointment booked (patient confirmation) ───
const sendAppointmentBookedPatientEmail = ({ patientEmail, patientName, doctorName, type, scheduledAt }) =>
  sendEmail({
    to: patientEmail,
    subject: 'Appointment booked — iBam Health',
    html: base(`
      ${h2('Appointment Booked ✅')}
      ${pill('Pending Confirmation')}
      ${para(`Hi ${patientName}, your appointment has been submitted and is awaiting confirmation from the doctor.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Doctor', `Dr. ${doctorName}`)}
        ${info('Type', type.charAt(0).toUpperCase() + type.slice(1))}
        ${info('Requested Time', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${para("You'll receive another notification once the doctor confirms your appointment.")}
      ${btn(`${APP_URL}/patient/appointments`, 'View My Appointments')}
    `),
    text: `Hi ${patientName}, your ${type} appointment with Dr. ${doctorName} has been booked for ${new Date(scheduledAt).toLocaleString()}.`,
  });

// ─── Follow-up scheduled ─────────────────────────
const sendFollowUpEmail = ({ email, name, doctorName, scheduledAt, type }) =>
  sendEmail({
    to: email,
    subject: 'Follow-up appointment scheduled — iBam Health',
    html: base(`
      ${h2('Follow-Up Appointment Scheduled 📅')}
      ${pill('Follow-Up', '#3B82F6')}
      ${para(`Hi ${name}, Dr. ${doctorName} has scheduled a follow-up appointment for you.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Doctor', `Dr. ${doctorName}`)}
        ${info('Type', (type || 'consultation').charAt(0).toUpperCase() + (type || 'consultation').slice(1))}
        ${info('Date & Time', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/patient/appointments`, 'View Appointment')}
    `),
    text: `Dr. ${doctorName} has scheduled a follow-up appointment for ${new Date(scheduledAt).toLocaleString()}.`,
  });

// ─── Consultation started ─────────────────────────
const sendConsultationStartedEmail = ({ email, name, doctorName, type }) =>
  sendEmail({
    to: email,
    subject: 'Your consultation has started — iBam Health',
    html: base(`
      ${h2('Consultation Started 🟢')}
      ${pill('Live', '#10B981')}
      ${para(`Hi ${name}, Dr. ${doctorName} is ready for your ${type || 'consultation'} session.`)}
      ${para('Open the iBam Health app now to join your consultation.')}
      ${btn(`${APP_URL}/patient/appointments`, 'Open App')}
    `),
    text: `Dr. ${doctorName} is ready for your consultation. Open iBam Health to join.`,
  });

// ─── Consultation summary ─────────────────────────
const sendConsultationSummaryEmail = ({ email, name, doctorName, duration, summary }) =>
  sendEmail({
    to: email,
    subject: 'Consultation summary — iBam Health',
    html: base(`
      ${h2('Consultation Completed ✅')}
      ${para(`Hi ${name}, your consultation with Dr. ${doctorName} has ended.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Doctor', `Dr. ${doctorName}`)}
        ${duration ? info('Duration', `${duration} min`) : ''}
        ${info('Date', new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }))}
      </div>
      ${summary ? `<div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0"><p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Doctor's Notes</p><p style="margin:0;font-size:14px;color:#0D1B2A;line-height:1.6">${summary}</p></div>` : ''}
      ${para('A prescription or lab request may follow shortly. Check your health records.')}
      ${btn(`${APP_URL}/patient/records`, 'View Health Records')}
    `),
    text: `Your consultation with Dr. ${doctorName} has ended.${summary ? ` Notes: ${summary}` : ''}`,
  });

// ─── Password changed confirmation ───────────────
const sendPasswordChangedEmail = (user) =>
  sendEmail({
    to: user.email,
    subject: 'Password changed — iBam Health',
    html: base(`
      ${h2('Password Changed')}
      ${pill('Security Alert', '#F59E0B')}
      ${para(`Hi ${user.name}, your iBam Health account password was changed successfully.`)}
      ${para('If you did not make this change, please contact support immediately or reset your password.')}
      ${btn(`${APP_URL}/forgot-password`, 'Reset Password')}
    `),
    text: `Hi ${user.name}, your iBam Health password was changed. If this wasn't you, please reset your password immediately.`,
  });

// ─── Broadcast email (admin → user) ──────────────
const sendBroadcastEmail = ({ to, name, title, message }) =>
  sendEmail({
    to,
    subject: `${title} — iBam Health`,
    html: base(`
      ${h2(title)}
      ${para(`Hi ${name || 'there'},`)}
      ${para(message)}
      ${btn(`${APP_URL}`, 'Open iBam Health')}
    `),
    text: `${title}\n\n${message}`,
  });

// ─── Lab request confirmed (patient) ────────────
const sendLabRequestConfirmedEmail = ({ email, name, tests = [], collectionType }) =>
  sendEmail({
    to: email,
    subject: 'Lab test request received — iBam Health',
    html: base(`
      ${h2('Lab Test Request Submitted 🔬')}
      ${pill('Submitted', '#3B82F6')}
      ${para(`Hi ${name}, your lab test request has been received.`)}
      ${tests.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Tests requested</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${tests.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${para(`Collection method: <strong>${collectionType === 'home_visit' ? 'Home Visit' : 'Walk-In'}</strong>`)}
      ${para("A lab professional will follow up with you shortly.")}
      ${btn(`${APP_URL}/patient/labs`, 'View My Tests')}
    `),
    text: `Hi ${name}, your lab test request has been received. Tests: ${tests.join(', ')}.`,
  });

// ─── Pharmacy order confirmed (patient) ──────────
const sendPharmacyOrderConfirmedEmail = ({ email, name, pharmacyName = 'Pharmacy', items = [] }) =>
  sendEmail({
    to: email,
    subject: 'Pharmacy order placed — iBam Health',
    html: base(`
      ${h2('Order Placed Successfully 📦')}
      ${pill('Pending', '#F59E0B')}
      ${para(`Hi ${name}, your order from <strong>${pharmacyName}</strong> has been placed and is being reviewed.`)}
      ${items.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Items ordered</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${items.map(i => `<li>${i.name}${i.qty ? ` ×${i.qty}` : ''}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${para("You will receive an update when the pharmacy confirms your order.")}
      ${btn(`${APP_URL}/patient/pharmacy`, 'Track Order')}
    `),
    text: `Hi ${name}, your pharmacy order from ${pharmacyName} has been placed.`,
  });

// ─── KYC / account rejected ───────────────────────
const sendKYCRejectedEmail = ({ email, name }) =>
  sendEmail({
    to: email,
    subject: 'Doctor account application update — iBam Health',
    html: base(`
      ${h2('Application Not Approved')}
      ${pill('Not Approved', '#EF4444')}
      ${para(`Hi Dr. ${name}, we've reviewed your application and are unable to approve your account at this time.`)}
      ${para('Common reasons include incomplete documentation, an unverifiable licence, or information that could not be confirmed.')}
      ${para('Please contact our support team if you believe this was an error or if you would like to provide additional information.')}
      ${btn(`mailto:support@ibamhealth.com`, 'Contact Support')}
    `),
    text: `Dr. ${name}, your iBam Health doctor account application was not approved. Please contact support for assistance.`,
  });

const sendPartnerRejectedEmail = ({ email, name, partnerType = 'partner' }) =>
  sendEmail({
    to: email,
    subject: `${partnerType} account update — iBam Health`,
    html: base(`
      ${h2('Account Status Update')}
      ${pill('Account Changed', '#F59E0B')}
      ${para(`Hi ${name}, there has been a change to your ${partnerType.toLowerCase()} account status on iBam Health.`)}
      ${para('If you have questions about this change, please reach out to our support team.')}
      ${btn(`mailto:support@ibamhealth.com`, 'Contact Support')}
    `),
    text: `${name}, your iBam Health ${partnerType} account status has changed. Please contact support for assistance.`,
  });

// ─── Order approval (admin → patient) ────────────
const sendOrderApprovalEmail = ({ email, name, approved, note }) =>
  sendEmail({
    to: email,
    subject: `Pharmacy order ${approved ? 'approved' : 'rejected'} — iBam Health`,
    html: base(`
      ${h2(approved ? 'Order Approved ✅' : 'Order Rejected')}
      ${pill(approved ? 'Approved' : 'Rejected', approved ? '#10B981' : '#EF4444')}
      ${para(`Hi ${name}, your pharmacy order has been ${approved ? 'approved and is now being processed by the pharmacy' : 'rejected'}.`)}
      ${note ? para(`<strong>Note:</strong> ${note}`) : ''}
      ${btn(`${APP_URL}/patient/pharmacy`, approved ? 'Track Order' : 'View Orders')}
    `),
    text: `Your pharmacy order has been ${approved ? 'approved' : 'rejected'}.${note ? ` ${note}` : ''}`,
  });

// ─── Test request approval (admin → patient) ─────
const sendTestApprovalEmail = ({ email, name, approved, tests = [], note }) =>
  sendEmail({
    to: email,
    subject: `Lab test request ${approved ? 'approved' : 'rejected'} — iBam Health`,
    html: base(`
      ${h2(approved ? 'Test Request Approved ✅' : 'Test Request Rejected')}
      ${pill(approved ? 'Approved' : 'Rejected', approved ? '#10B981' : '#EF4444')}
      ${para(`Hi ${name}, your lab test request has been ${approved ? 'approved. You can now proceed with your test' : 'rejected'}.`)}
      ${tests.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Tests</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${tests.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${note ? para(`<strong>Note:</strong> ${note}`) : ''}
      ${btn(`${APP_URL}/patient/labs`, 'View Lab Tests')}
    `),
    text: `Your lab test request has been ${approved ? 'approved' : 'rejected'}.${note ? ` ${note}` : ''}`,
  });

// ─── Sample collected (field agent → patient) ────
const sendSampleCollectedEmail = ({ email, name, tests = [] }) =>
  sendEmail({
    to: email,
    subject: 'Sample collected — iBam Health',
    html: base(`
      ${h2('Sample Collected 🧪')}
      ${pill('In Progress', '#3B82F6')}
      ${para(`Hi ${name}, our field agent has successfully collected your sample. Your tests are now being processed in the lab.`)}
      ${tests.length ? `
        <div style="background:#F8FAFC;border-radius:10px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em">Tests being processed</p>
          <ul style="margin:0;padding-left:18px;color:#0D1B2A;font-size:14px;line-height:1.8">
            ${tests.map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>` : ''}
      ${para("You'll be notified as soon as your results are ready.")}
      ${btn(`${APP_URL}/patient/labs`, 'View My Tests')}
    `),
    text: `Hi ${name}, your sample has been collected and is being processed in the lab.`,
  });

// ─── Home visit scheduled (admin/lab → patient) ──
const sendHomeVisitScheduledEmail = ({ email, name, scheduledAt }) =>
  sendEmail({
    to: email,
    subject: 'Home visit scheduled — iBam Health',
    html: base(`
      ${h2('Home Visit Scheduled 🏠')}
      ${pill('Scheduled', '#3B82F6')}
      ${para(`Hi ${name}, a lab professional has been assigned to collect your sample at home.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Date & Time', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${para('Please ensure someone is available at your collection address at the scheduled time.')}
      ${btn(`${APP_URL}/patient/labs`, 'View My Tests')}
    `),
    text: `Hi ${name}, a home visit has been scheduled for ${new Date(scheduledAt).toLocaleString()}.`,
  });

// ─── Account created by admin ─────────────────────
const sendAccountCreatedEmail = ({ email, name, password, role }) => {
  const roleLabels = { doctor: 'Doctor', lab_partner: 'Diagnostic Lab', pharmacy_partner: 'Pharmacy Partner' };
  const portals = { doctor: `${APP_URL}/doctor`, lab_partner: `${APP_URL}/lab`, pharmacy_partner: `${APP_URL}/pharmacy` };
  const label = roleLabels[role] || 'Partner';
  const portal = portals[role] || APP_URL;
  return sendEmail({
    to: email,
    subject: 'Your iBam Health account has been created',
    html: base(`
      ${h2(`Welcome to iBam Health, ${name}!`)}
      ${pill(label, '#3B82F6')}
      ${para(`An admin has created a <strong>${label}</strong> account for you on iBam Health.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Email', email)}
        ${info('Temporary Password', password)}
      </div>
      ${para('<strong>Important:</strong> Please log in and change your password immediately.')}
      ${btn(portal, 'Access Your Account')}
    `),
    text: `Hi ${name}, your iBam Health ${label} account has been created. Login: ${email} / Password: ${password}. Please change your password after logging in.`,
  });
};

// ─── New lab request alert (→ all super/lab admins) ──
const sendNewLabRequestAdminEmail = ({ emails, patientName, tests = [], collectionType, requestId }) => {
  if (!emails?.length) return Promise.resolve();
  const typeLabel = collectionType === 'home_visit' ? 'Home Visit' : 'Walk-In';
  return sendEmail({
    to: emails,
    subject: `New Lab Test Request — ${patientName}`,
    html: base(`
      ${h2('New Lab Test Request 🔬')}
      ${pill('New Request', '#3B82F6')}
      ${para(`A patient has submitted a new lab test request and it is awaiting assignment.`)}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Patient', patientName)}
        ${info('Collection Type', typeLabel)}
        ${info('Tests', tests.slice(0, 3).join(', ') + (tests.length > 3 ? ` +${tests.length - 3} more` : ''))}
        ${info('Submitted', new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/admin/labs`, 'View in Admin Panel')}
    `),
    text: `New lab test request from ${patientName}. Tests: ${tests.join(', ')}. Collection: ${typeLabel}.`,
  });
};

// ─── Admin alert ─────────────────────────────────
const sendAdminAlertEmail = ({ subject: sub, headline, body: bodyText, ctaLabel, ctaUrl }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return Promise.resolve();
  return sendEmail({
    to: adminEmail,
    subject: `[iBam Admin] ${sub}`,
    html: base(`
      ${h2(headline || sub)}
      ${para(bodyText)}
      ${ctaLabel && ctaUrl ? btn(ctaUrl, ctaLabel) : ''}
    `),
    text: bodyText,
  });
};

const sendEmergencyTriageEmail = ({ email, name }) =>
  sendEmail({
    to: email,
    subject: '⚠️ URGENT: Seek Emergency Care Immediately — iBam Health',
    html: base(`
      ${h2('Emergency Alert ⚠️')}
      ${pill('RED — Seek Emergency Care Now', '#EF4444')}
      ${para(`Hi ${name}, your symptom check result is <strong>RED</strong>, indicating a potentially serious condition that requires <strong>immediate medical attention</strong>.`)}
      ${para('<strong>Please do one of the following right away:</strong>')}
      <ul style="margin:12px 0 16px 24px;color:#374151;font-size:15px;line-height:1.6">
        <li>Call emergency services: <strong>199 (NEMA) / 112 (General Emergency)</strong></li>
        <li>Go to the nearest hospital emergency room</li>
        <li>Ask someone to take you to a healthcare facility immediately</li>
      </ul>
      ${btn(`${APP_URL}/patient/facilities`, 'Find Nearest Emergency Facility')}
      ${para('Do not wait — please act now.', '#EF4444')}
    `),
    text: `URGENT: ${name}, your triage result is RED. Seek emergency care immediately. Call 199 or 112.`,
  });

const sendAppointmentReminderEmail = ({ email, name, doctorName, patientName, type, scheduledAt, windowLabel }) =>
  sendEmail({
    to: email,
    subject: `Reminder: Appointment ${windowLabel} — iBam Health`,
    html: base(`
      ${h2(`Your appointment is ${windowLabel}!`)}
      ${pill(windowLabel, windowLabel.includes('1') ? '#EF4444' : '#F59E0B')}
      <div style="margin:20px 0;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden">
        ${info('Doctor', `Dr. ${doctorName}`)}
        ${info('Patient', patientName)}
        ${info('Type', (type || '').charAt(0).toUpperCase() + (type || '').slice(1))}
        ${info('Time', new Date(scheduledAt).toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }))}
      </div>
      ${btn(`${APP_URL}/patient/appointments`, 'View Appointment')}
    `),
    text: `Reminder: Your appointment is ${windowLabel}. Doctor: ${doctorName} | Time: ${new Date(scheduledAt).toLocaleString()}`,
  });

module.exports = {
  sendEmail,
  sendNewLabRequestAdminEmail,
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendAppointmentBookedEmail,
  sendAppointmentBookedPatientEmail,
  sendAppointmentConfirmedEmail,
  sendAppointmentCancelledEmail,
  sendFollowUpEmail,
  sendConsultationStartedEmail,
  sendConsultationSummaryEmail,
  sendPrescriptionReadyEmail,
  sendLabResultReadyEmail,
  sendPharmacyOrderUpdateEmail,
  sendLabRequestConfirmedEmail,
  sendPharmacyOrderConfirmedEmail,
  sendKYCRejectedEmail,
  sendPartnerRejectedEmail,
  sendPaymentSuccessEmail,
  sendSubscriptionEmail,
  sendDoctorApprovedEmail,
  sendPartnerApprovedEmail,
  sendAdminAlertEmail,
  sendBroadcastEmail,
  sendPasswordChangedEmail,
  sendOrderApprovalEmail,
  sendTestApprovalEmail,
  sendSampleCollectedEmail,
  sendHomeVisitScheduledEmail,
  sendAccountCreatedEmail,
  sendAppointmentReminderEmail,
  sendEmergencyTriageEmail,
};
