const router = require('express').Router();
const ctrl = require('../controllers/diagnostics.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const upload = require('../middleware/upload');

router.post('/labs/onboard', ctrl.onboardLab);

router.use(protect);

router.get('/labs', ctrl.listLabs);
router.get('/labs/profile', restrictTo('lab_partner'), ctrl.getLabProfile);
router.put('/labs/profile', restrictTo('lab_partner'), ctrl.updateLabProfile);
router.put('/labs/tests', restrictTo('lab_partner'), ctrl.updateLabTests);
router.get('/labs/requests', restrictTo('lab_partner'), ctrl.getLabRequests);
router.post('/labs/requests/:id/claim', restrictTo('lab_partner'), ctrl.claimRequest);
router.get('/labs/earnings', restrictTo('lab_partner'), ctrl.getLabEarnings);
router.post('/labs/earnings/request-payout', restrictTo('lab_partner'), ctrl.requestLabPayout);
router.put('/labs/requests/:id/status', restrictTo('lab_partner'), ctrl.updateLabRequestStatus);

router.post('/request', upload.single('referral'), ctrl.requestTests);
router.get('/results/mine', ctrl.getMyResults);
router.get('/field-agent/schedule', restrictTo('field_agent'), ctrl.getAgentSchedule);
router.put('/:id/assign-lab', restrictTo('admin', 'lab_partner'), ctrl.assignLab);
router.post('/:id/upload-result', restrictTo('lab_partner', 'admin'), upload.single('result'), ctrl.uploadResult);
router.post('/:id/schedule-home-visit', restrictTo('admin', 'lab_partner'), ctrl.scheduleHomeVisit);
router.put('/:id/mark-collected', restrictTo('field_agent'), ctrl.markSampleCollected);

module.exports = router;
