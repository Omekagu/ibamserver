const mongoose = require('mongoose');

const soapNoteSchema = new mongoose.Schema(
  {
    subjective: { type: String },
    objective: { type: String },
    assessment: { type: String },
    plan: { type: String },
  },
  { _id: false }
);

const consultationSchema = new mongoose.Schema(
  {
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
    consultationType: { type: String, enum: ['chat', 'audio', 'video'], required: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    agoraChannel: { type: String },
    agoraToken: { type: String },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    duration: { type: Number }, // minutes
    soapNote: soapNoteSchema,
    summary: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Consultation', consultationSchema);
