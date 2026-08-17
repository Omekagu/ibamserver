const router = require('express').Router();
const ctrl = require('../controllers/doctors.controller');
const earningsCtrl = require('../controllers/earnings.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const upload = require('../middleware/upload');

// Public routes
router.get('/', ctrl.listDoctors);
router.get('/available-slots', ctrl.getAvailableSlots);

// Doctor-only routes — must come before /:id routes so "my" is not captured as an id param
router.get('/my/profile',        protect, restrictTo('doctor'), ctrl.getMyProfile);
router.put('/my/profile',        protect, restrictTo('doctor'), ctrl.updateMyProfile);
router.post('/my/avatar',        protect, restrictTo('doctor'), upload.single('avatar'),  ctrl.uploadAvatar);
router.post('/license',          protect, restrictTo('doctor'), upload.single('license'), ctrl.uploadLicense);
router.post('/availability',          protect, restrictTo('doctor'), ctrl.setAvailability);
router.delete('/availability/:id',    protect, restrictTo('doctor'), ctrl.deleteAvailability);
router.get('/my/appointments',        protect, restrictTo('doctor'), ctrl.getDoctorAppointments);
router.get('/my/availability',        protect, restrictTo('doctor'), ctrl.getMyAvailability);
router.get('/my/earnings',       protect, restrictTo('doctor'), earningsCtrl.getEarnings);
router.post('/my/payouts/request', protect, restrictTo('doctor'), earningsCtrl.requestPayout);

// Parameterised routes — must come after /my/* routes
router.get('/:id/profile',       ctrl.getDoctorProfile);
router.get('/:id/appointments',  protect, ctrl.getDoctorAppointments);

module.exports = router;
