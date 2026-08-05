const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    consultation: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String },
    type: { type: String, enum: ['text', 'image', 'file', 'audio'], default: 'text' },
    fileUrl: { type: String },
    fileName: { type: String },
    readAt: { type: Date },
  },
  { timestamps: true }
);

messageSchema.index({ consultation: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
