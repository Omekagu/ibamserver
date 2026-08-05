const sgMail = require('@sendgrid/mail');

const FROM = process.env.SENDGRID_FROM_EMAIL || 'noreply@ibamhealth.com';

const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[SendGrid] SENDGRID_API_KEY not set — skipping email.');
    return;
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const msg = { to, from: FROM, subject, html, text };
  await sgMail.send(msg);
};

const sendWelcomeEmail = (user) =>
  sendEmail({
    to: user.email,
    subject: 'Welcome to iBam Health',
    html: `<h1>Welcome, ${user.name}!</h1><p>Your account has been created successfully.</p>`,
  });

const sendPasswordResetEmail = (user, resetUrl) =>
  sendEmail({
    to: user.email,
    subject: 'iBam Health — Password Reset',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 10 minutes.</p>`,
  });

const sendAppointmentReminderEmail = (user, appointment) =>
  sendEmail({
    to: user.email,
    subject: 'iBam Health — Appointment Reminder',
    html: `<p>Reminder: You have an appointment scheduled for ${new Date(appointment.scheduledAt).toLocaleString()}.</p>`,
  });

module.exports = { sendEmail, sendWelcomeEmail, sendPasswordResetEmail, sendAppointmentReminderEmail };
