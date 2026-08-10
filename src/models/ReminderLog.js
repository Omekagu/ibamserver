const mongoose = require('mongoose');

// Tracks which appointment reminders have been sent so we don't duplicate on restart
const schema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Appointment' },
  window:        { type: String, required: true, enum: ['24h', '1h'] },
  sentAt:        { type: Date, default: Date.now },
});

schema.index({ appointmentId: 1, window: 1 }, { unique: true });
// Auto-delete log entries 2 days after they were created
schema.index({ sentAt: 1 }, { expireAfterSeconds: 172800 });

module.exports = mongoose.model('ReminderLog', schema);
