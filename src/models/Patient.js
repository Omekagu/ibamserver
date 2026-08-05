const mongoose = require('mongoose');

const medicalHistorySchema = new mongoose.Schema(
  {
    condition: { type: String, required: true },
    diagnosedDate: { type: Date },
    notes: { type: String },
  },
  { _id: false }
);

const patientSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    allergies: [{ type: String }],
    medicalHistory: [medicalHistorySchema],
    emergencyContact: {
      name: { type: String },
      phone: { type: String },
      relationship: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Patient', patientSchema);
