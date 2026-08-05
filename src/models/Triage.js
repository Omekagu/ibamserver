const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    severityWeight: { type: Number, default: 0 },
  },
  { _id: false }
);

const triageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true, unique: true },
    answers: [answerSchema],
    totalScore: { type: Number, default: 0 },
    classification: { type: String, enum: ['green', 'yellow', 'red'] },
    recommendedAction: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Triage', triageSchema);
