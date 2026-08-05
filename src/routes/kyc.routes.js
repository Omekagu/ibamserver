const router = require('express').Router();
const ctrl   = require('../controllers/kyc.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/status',       ctrl.getStatus);
router.post('/verify-nin',  ctrl.verifyNIN);
router.post('/verify-face', ctrl.verifyFace);
router.post('/verify-cac',  ctrl.verifyCAC);

module.exports = router;
