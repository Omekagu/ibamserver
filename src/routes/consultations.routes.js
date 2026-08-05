const router = require('express').Router();
const ctrl = require('../controllers/consultations.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const upload = require('../middleware/upload');

router.use(protect);

router.post('/start', restrictTo('doctor'), ctrl.startConsultation);
router.post('/token', ctrl.generateAgoraToken);
router.get('/by-appointment/:appointmentId', ctrl.getByAppointment);
router.get('/:id/messages', ctrl.getMessages);
router.post('/:id/messages', ctrl.sendMessage);
router.put('/:id/end', restrictTo('doctor'), ctrl.endConsultation);
router.post('/:id/upload', upload.single('file'), ctrl.uploadChatFile);

module.exports = router;
