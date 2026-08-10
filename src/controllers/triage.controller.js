const { randomUUID } = require('crypto');
const Triage = require('../models/Triage');
const User = require('../models/User');
const questions = require('../data/triageQuestions.json');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification } = require('../services/notification.service');
const { sendEmergencyTriageEmail } = require('../services/email.service');
const { sendSMS } = require('../services/termii.service');

const classify = (score) => {
  if (score >= 30) return { classification: 'red', recommendedAction: 'Seek emergency care immediately or call an ambulance.' };
  if (score >= 12) return { classification: 'yellow', recommendedAction: 'Book an urgent consultation with a doctor today.' };
  return { classification: 'green', recommendedAction: 'Your symptoms appear mild. You can schedule a routine consultation.' };
};

exports.getQuestions = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, 'Triage questions retrieved.', { questions });
});

exports.startTriage = asyncHandler(async (req, res) => {
  const session = await Triage.create({
    user: req.user._id,
    sessionId: randomUUID(),
  });
  sendSuccess(res, 201, 'Triage session started.', { sessionId: session.sessionId, questions });
});

exports.submitAnswers = asyncHandler(async (req, res, next) => {
  const { sessionId, answers } = req.body;
  if (!sessionId || !Array.isArray(answers)) {
    return next(new AppError('sessionId and answers array required.', 400));
  }

  const session = await Triage.findOne({ sessionId, user: req.user._id });
  if (!session) return next(new AppError('Triage session not found.', 404));

  let totalScore = 0;
  const processedAnswers = answers.map((a) => {
    const question = questions.find((q) => q.id === a.questionId);
    if (!question) return a;
    const option = question.options.find((o) => o.value === a.answer);
    const weight = option?.weight || 0;
    totalScore += weight;
    return { questionId: a.questionId, question: question.question, answer: a.answer, severityWeight: weight };
  });

  const { classification, recommendedAction } = classify(totalScore);

  session.answers = processedAnswers;
  session.totalScore = totalScore;
  session.classification = classification;
  session.recommendedAction = recommendedAction;
  session.completedAt = new Date();
  await session.save();

  // Emergency alert for red classification
  if (classification === 'red') {
    User.findById(req.user._id).select('name email phone').lean().then(user => {
      if (!user) return;
      createNotification({
        userId: req.user._id,
        type: 'triage_red',
        title: '⚠️ Emergency: Seek Care Immediately',
        message: 'Your symptom check result is RED. Please go to the nearest emergency room or call 199/112 now.',
        metadata: { triageId: session._id, classification: 'red' },
      }).catch(() => {});
      if (user.email) sendEmergencyTriageEmail({ email: user.email, name: user.name }).catch(() => {});
      if (user.phone) {
        sendSMS({
          to: user.phone,
          message: `iBam Health URGENT: ${user.name}, your symptom check is RED. Please seek emergency care immediately. Call 199 or 112.`,
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  sendSuccess(res, 200, 'Triage completed.', { session });
});

exports.getResult = asyncHandler(async (req, res, next) => {
  const session = await Triage.findById(req.params.id);
  if (!session) return next(new AppError('Triage result not found.', 404));
  if (session.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new AppError('Not authorised to view this result.', 403));
  }
  sendSuccess(res, 200, 'Triage result retrieved.', { session });
});

exports.getMyTriages = asyncHandler(async (req, res) => {
  const triages = await Triage.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20);
  sendSuccess(res, 200, 'Triage history retrieved.', { triages });
});
