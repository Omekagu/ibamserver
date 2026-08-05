const mongoose = require('mongoose');

const fieldAgentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    licenseNumber: { type: String },
    assignedLab: { type: mongoose.Schema.Types.ObjectId, ref: 'LabPartner' },
    status: { type: String, enum: ['available', 'busy', 'offline'], default: 'available' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FieldAgent', fieldAgentSchema);
