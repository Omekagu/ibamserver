const router = require('express').Router();
const ctrl = require('../controllers/users.controller');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/profile', ctrl.getProfile);
router.put('/profile', ctrl.updateProfile);
router.post('/avatar', upload.single('avatar'), ctrl.uploadAvatar);
router.post('/medical-history', ctrl.addMedicalHistory);

module.exports = router;
