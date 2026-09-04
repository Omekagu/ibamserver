const router = require('express').Router();
const ctrl = require('../controllers/diagnostics.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const { audit } = require('../middleware/audit');
const upload = require('../middleware/upload');
const AppError = require('../utils/AppError');

// lab_partner OR lab_admin — operations that create/claim/manage requests
function restrictToLabAccess(req, res, next) {
  if (req.user?.role === 'lab_partner') return next();
  if (req.user?.role === 'admin' && req.user?.adminRole === 'lab_admin') return next();
  return next(new AppError('Access denied.', 403));
}

// All lab users: lab_partner, lab_admin, lab_scientist (read-only portal access)
function restrictToAnyLabUser(req, res, next) {
  if (req.user?.role === 'lab_partner') return next();
  if (req.user?.role === 'admin' && req.user?.adminRole === 'lab_admin') return next();
  if (req.user?.role === 'lab_scientist') return next();
  return next(new AppError('Access denied.', 403));
}

// Only lab_scientist
function restrictToScientist(req, res, next) {
  if (req.user?.role === 'lab_scientist') return next();
  return next(new AppError('Access denied. Lab scientists only.', 403));
}

router.post('/labs/onboard', ctrl.onboardLab);
router.get('/lab-tests', ctrl.listLabTests);

router.use(protect);

router.get('/labs', ctrl.listLabs);
router.get('/labs/profile', restrictToAnyLabUser, ctrl.getLabProfile);
router.put('/labs/profile', restrictToLabAccess, ctrl.updateLabProfile);
router.put('/labs/tests', restrictToLabAccess, ctrl.updateLabTests);
router.get('/labs/requests', restrictToLabAccess, ctrl.getLabRequests);
router.post('/labs/requests/:id/claim', restrictToLabAccess, audit('lab_request_claimed', 'DiagnosticsRequest'), ctrl.claimRequest);
router.get('/labs/earnings', restrictToLabAccess, ctrl.getLabEarnings);
router.post('/labs/earnings/request-payout', restrictToLabAccess, audit('lab_payout_requested', 'LabPartner'), ctrl.requestLabPayout);
router.put('/labs/requests/:id/status', restrictToLabAccess, audit('lab_request_status_updated', 'DiagnosticsRequest'), ctrl.updateLabRequestStatus);
router.get('/labs/test-catalog', restrictToAnyLabUser, ctrl.getLabTestCatalog);
router.get('/labs/wellness-packages', restrictToAnyLabUser, ctrl.getWellnessPackagesForLab);
router.post('/labs/walk-in', restrictToLabAccess, ctrl.createLabWalkIn);

// Scientist management (lab admin/partner only)
router.get('/labs/scientists', restrictToLabAccess, ctrl.getLabScientists);
router.post('/labs/scientists', restrictToLabAccess, ctrl.createLabScientist);
router.post('/labs/requests/:id/assign-scientist', restrictToLabAccess, ctrl.assignScientist);

// Scientist portal routes
router.get('/scientist/requests', restrictToScientist, ctrl.getScientistRequests);
router.put('/scientist/requests/:id/status', restrictToScientist, ctrl.updateScientistStatus);

router.post('/doctor-order', restrictTo('doctor'), ctrl.requestTestsForPatient)
router.post('/request', upload.single('referral'), ctrl.requestTests);
router.delete('/request/:id', ctrl.cancelMyRequest);
router.get('/results/mine', ctrl.getMyResults);
router.get('/field-agent/schedule', restrictTo('field_agent'), ctrl.getAgentSchedule);
router.put('/:id/assign-lab', restrictTo('admin', 'lab_partner'), ctrl.assignLab);
router.post('/:id/upload-result', restrictTo('lab_partner', 'admin', 'lab_scientist'), audit('lab_result_uploaded', 'DiagnosticsRequest'), upload.single('result'), ctrl.uploadResult);
router.post('/:id/schedule-home-visit', restrictTo('admin', 'lab_partner'), ctrl.scheduleHomeVisit);
router.put('/:id/mark-collected', restrictTo('field_agent'), ctrl.markSampleCollected);

module.exports = router;
