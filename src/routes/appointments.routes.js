const router = require('express').Router();
const ctrl = require('../controllers/appointments.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');

router.use(protect);

router.post('/book', restrictTo('patient'), ctrl.book);
router.get('/mine', restrictTo('patient'), ctrl.getMyAppointments);
router.get('/follow-ups', restrictTo('patient'), ctrl.getFollowUps);
router.put('/:id/cancel', ctrl.cancel);
router.put('/:id/reschedule', restrictTo('patient'), ctrl.reschedule);
router.put('/:id/doctor-reschedule', restrictTo('doctor'), ctrl.doctorReschedule);
router.post('/:id/follow-up', restrictTo('doctor'), ctrl.scheduleFollowUp);

module.exports = router;
