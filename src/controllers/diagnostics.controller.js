const DiagnosticsRequest = require('../models/DiagnosticsRequest');
const LabPartner = require('../models/LabPartner');
const LabResult = require('../models/LabResult');
const FieldAgent = require('../models/FieldAgent');
const HomeVisitSchedule = require('../models/HomeVisitSchedule');
const User = require('../models/User');
const { uploadBuffer } = require('../services/cloudinary.service');
const { createNotification, notifyAdmins } = require('../services/notification.service');
const { sendAdminAlertEmail } = require('../services/email.service');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.onboardLab = asyncHandler(async (req, res, next) => {
  const { name, address, phone, email, password, testsOffered, coverageAreas, licenseNumber } = req.body;
  if (!name || !address || !phone || !email || !password) {
    return next(new AppError('Name, address, phone, email and password are required.', 400));
  }
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return next(new AppError('An account with this email already exists.', 409));

  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    password,
    role: 'lab_partner',
    isVerified: false,
  });

  const lab = await LabPartner.create({
    name,
    address,
    phone,
    email,
    licenseNumber,
    testsOffered: testsOffered || [],
    coverageAreas: coverageAreas || [],
    status: 'pending',
    user: user._id,
  });

  sendAdminAlertEmail({
    subject: 'New lab partner application',
    headline: 'New Lab Application',
    body: `${name} (${email}) has applied to join as a laboratory partner and is awaiting approval.`,
    ctaLabel: 'Review Partners',
    ctaUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/partners`,
  }).catch(err => console.error('[Email] Admin lab alert failed:', err.message));

  notifyAdmins({
    type: 'partner_onboarded',
    title: 'New Lab Partner Application',
    message: `${name} applied to join as a lab partner and is awaiting review.`,
    metadata: { labId: lab._id, email },
  }).catch(() => {});

  sendSuccess(res, 201, 'Lab application submitted. You will be notified once approved.', { lab });
});

exports.getLabProfile = asyncHandler(async (req, res, next) => {
  const lab = await LabPartner.findOne({ user: req.user._id });
  if (!lab) return next(new AppError('Lab partner record not found.', 404));
  sendSuccess(res, 200, 'Lab profile retrieved.', { lab });
});

exports.updateLabTests = asyncHandler(async (req, res, next) => {
  const { testsOffered } = req.body;
  if (!Array.isArray(testsOffered)) return next(new AppError('testsOffered must be an array.', 400));

  const lab = await LabPartner.findOneAndUpdate(
    { user: req.user._id },
    { testsOffered },
    { new: true, runValidators: true }
  );
  if (!lab) return next(new AppError('Lab partner record not found.', 404));
  sendSuccess(res, 200, 'Tests updated.', { lab });
});

exports.requestTests = asyncHandler(async (req, res, next) => {
  // Support both JSON body (tests: [...]) and FormData (tests[]: ...)
  const rawTests = req.body['tests[]'] || req.body.tests;
  const tests = Array.isArray(rawTests) ? rawTests : rawTests ? [rawTests] : [];
  const { labId, collectionType, notes, doctorId } = req.body;
  if (!tests.length || !collectionType) {
    return next(new AppError('tests array and collectionType are required.', 400));
  }

  let totalAmount = 0;
  let externalReferralUrl;
  let selectedLab = null;
  const fromDoctor = req.user.role === 'doctor' ? req.user._id : doctorId;
  const requiresApproval = !fromDoctor;

  if (labId) {
    selectedLab = await LabPartner.findById(labId);
    if (selectedLab?.testsOffered?.length) {
      for (const testName of tests) {
        const found = selectedLab.testsOffered.find(t => t.name === testName);
        if (found) totalAmount += found.price;
      }
    }
  }

  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, 'referrals', 'auto');
    externalReferralUrl = uploaded.secure_url;
  }

  let pickupLocation;
  if (collectionType === 'walk_in') {
    try { pickupLocation = req.body.pickupLocation ? JSON.parse(req.body.pickupLocation) : undefined; } catch { /* ignore */ }
  }

  const request = await DiagnosticsRequest.create({
    patient: req.user._id,
    doctor: fromDoctor || undefined,
    tests,
    lab: labId || undefined,
    collectionType,
    notes,
    totalAmount,
    requiresApproval,
    adminApprovalStatus: requiresApproval ? 'pending' : 'na',
    externalReferralUrl,
    pickupLocation,
  });

  createNotification({
    userId: req.user._id,
    type: 'lab_request_placed',
    title: 'Lab Test Request Submitted',
    message: requiresApproval
      ? `Your request for ${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''} is awaiting admin approval.`
      : `Your lab test request has been submitted. We will process it shortly.`,
    metadata: { requestId: request._id },
    emailData: { tests, collectionType },
  }).catch(err => console.error('[Notification] Lab request placed:', err.message));

  // Notify admin (email + in-app) about the new lab test request
  sendAdminAlertEmail({
    subject: requiresApproval ? 'New lab test request awaiting approval' : 'New lab test request submitted',
    headline: 'New Lab Test Request',
    body: `${req.user.name || 'A patient'} submitted a lab test request for: ${tests.slice(0, 3).join(', ')}${tests.length > 3 ? ` +${tests.length - 3} more` : ''}.${requiresApproval ? ' This request requires admin approval before processing.' : ''}`,
    ctaLabel: requiresApproval ? 'Review Approvals' : 'View Requests',
    ctaUrl: `${process.env.CLIENT_URL || 'https://ibamhealth.com'}/admin/diagnostics`,
  }).catch(err => console.error('[Email] Admin lab test alert:', err.message));

  notifyAdmins({
    type: 'lab_request_placed',
    title: requiresApproval ? 'Lab Request Awaiting Approval' : 'New Lab Test Request',
    message: `${req.user.name || 'A patient'} requested: ${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''}.${requiresApproval ? ' Requires admin approval.' : ''}`,
    metadata: { requestId: request._id, patientId: req.user._id, requiresApproval },
  }).catch(() => {});

  // Notify lab partner if one was selected
  if (selectedLab?.user) {
    createNotification({
      userId: selectedLab.user,
      type: 'lab_request_placed',
      title: 'New Test Request',
      message: `A patient has requested: ${tests.slice(0, 2).join(', ')}${tests.length > 2 ? ` +${tests.length - 2} more` : ''}.`,
      metadata: { requestId: request._id },
    }).catch(err => console.error('[Notification] Lab partner notification:', err.message));
  }

  sendSuccess(res, 201, 'Diagnostics request submitted.', { request, requiresApproval });
});

exports.listLabs = asyncHandler(async (req, res) => {
  const labs = await LabPartner.find({ status: 'active' });
  sendSuccess(res, 200, 'Labs retrieved.', { labs });
});

exports.getLabRequests = asyncHandler(async (req, res) => {
  const lab = await LabPartner.findOne({ user: req.user._id });
  if (!lab) return sendSuccess(res, 200, 'No requests.', { requests: [] });

  const requests = await DiagnosticsRequest.find({ lab: lab._id })
    .populate('patient', 'name phone email')
    .sort({ createdAt: -1 });
  sendSuccess(res, 200, 'Lab requests retrieved.', { requests });
});

exports.assignLab = asyncHandler(async (req, res, next) => {
  const { labId } = req.body;
  const request = await DiagnosticsRequest.findById(req.params.id);
  if (!request) return next(new AppError('Request not found.', 404));

  request.lab = labId;
  request.status = 'assigned';
  await request.save();
  sendSuccess(res, 200, 'Lab assigned.', { request });
});

exports.uploadResult = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new AppError('No file uploaded.', 400));
  const request = await DiagnosticsRequest.findById(req.params.id);
  if (!request) return next(new AppError('Request not found.', 404));

  const result_file = await uploadBuffer(req.file.buffer, 'lab_results', 'auto');
  const result = await LabResult.create({
    request: req.params.id,
    fileUrl: result_file.secure_url,
    uploadedBy: req.user._id,
    notes: req.body.notes,
  });

  request.status = 'completed';
  await request.save();

  await createNotification({
    userId: request.patient,
    type: 'lab_result_ready',
    title: 'Lab Result Ready',
    message: 'Your lab test results are now available.',
    metadata: { requestId: request._id, resultId: result._id },
    emailData: { tests: (request.tests || []).map(t => t.name || String(t)) },
  });

  sendSuccess(res, 201, 'Result uploaded.', { result });
});

exports.getMyResults = asyncHandler(async (req, res) => {
  const requests = await DiagnosticsRequest.find({ patient: req.user._id })
    .populate('lab', 'name')
    .sort({ createdAt: -1 });

  const requestIds = requests.map((r) => r._id);
  const results = await LabResult.find({ request: { $in: requestIds } });
  sendSuccess(res, 200, 'Results retrieved.', { requests, results });
});

exports.scheduleHomeVisit = asyncHandler(async (req, res, next) => {
  const { agentId, scheduledAt, address, coordinates } = req.body;
  const request = await DiagnosticsRequest.findById(req.params.id);
  if (!request) return next(new AppError('Request not found.', 404));
  if (request.collectionType !== 'home_visit') {
    return next(new AppError('This request is not a home visit.', 400));
  }

  const agent = await FieldAgent.findById(agentId);
  if (!agent || agent.status !== 'available') {
    return next(new AppError('Field agent not available.', 400));
  }

  const visit = await HomeVisitSchedule.create({
    request: request._id,
    agent: agentId,
    patient: request.patient,
    address,
    coordinates,
    scheduledAt: new Date(scheduledAt),
  });

  agent.status = 'busy';
  request.fieldAgent = agentId;
  request.status = 'assigned';
  await Promise.all([agent.save(), request.save()]);

  await createNotification({
    userId: request.patient,
    type: 'home_visit_scheduled',
    title: 'Home Visit Scheduled',
    message: `A lab professional will visit you on ${new Date(scheduledAt).toDateString()}.`,
    metadata: { visitId: visit._id },
    emailData: { scheduledAt },
  });

  sendSuccess(res, 201, 'Home visit scheduled.', { visit });
});

exports.markSampleCollected = asyncHandler(async (req, res, next) => {
  const visit = await HomeVisitSchedule.findOne({ request: req.params.id });
  if (!visit) return next(new AppError('Home visit not found.', 404));

  const agent = await FieldAgent.findById(visit.agent);
  if (agent.user.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the assigned field agent can mark collection.', 403));
  }

  visit.status = 'collected';
  await visit.save();

  const request = await DiagnosticsRequest.findById(req.params.id);
  request.status = 'sample_collected';
  await request.save();

  if (agent) { agent.status = 'available'; await agent.save(); }

  createNotification({
    userId: request.patient,
    type: 'sample_collected',
    title: 'Sample Collected',
    message: 'Your sample has been collected and is being processed in the lab.',
    metadata: { requestId: request._id },
    emailData: { tests: request.tests || [] },
  }).catch(err => console.error('[Notification] Sample collected:', err.message));

  sendSuccess(res, 200, 'Sample collection confirmed.', { visit });
});

exports.updateLabRequestStatus = asyncHandler(async (req, res, next) => {
  const { status, resultNotes } = req.body;
  const lab = await LabPartner.findOne({ user: req.user._id });
  if (!lab) return next(new AppError('Lab partner record not found.', 404));

  const request = await DiagnosticsRequest.findOne({ _id: req.params.id, lab: lab._id });
  if (!request) return next(new AppError('Request not found.', 404));

  const allowed = ['assigned', 'collected', 'completed'];
  if (!allowed.includes(status)) return next(new AppError(`Status must be one of: ${allowed.join(', ')}.`, 400));

  request.status = status;
  if (resultNotes) request.resultNotes = resultNotes;
  await request.save();

  if (status === 'completed') {
    await createNotification({
      userId: request.patient,
      type: 'lab_result_ready',
      title: 'Lab Result Ready',
      message: 'Your lab test results are now available.',
      metadata: { requestId: request._id },
      emailData: { tests: request.tests || [] },
    });
  }

  sendSuccess(res, 200, 'Request status updated.', { request });
});

exports.getAgentSchedule = asyncHandler(async (req, res) => {
  const agent = await FieldAgent.findOne({ user: req.user._id });
  if (!agent) return sendSuccess(res, 200, 'No schedule found.', { visits: [] });

  const visits = await HomeVisitSchedule.find({ agent: agent._id, status: { $in: ['scheduled', 'en_route', 'arrived'] } })
    .populate('patient', 'name phone')
    .sort({ scheduledAt: 1 });
  sendSuccess(res, 200, 'Agent schedule retrieved.', { visits });
});
