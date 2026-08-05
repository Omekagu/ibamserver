const router = require('express').Router();
const ctrl = require('../controllers/notifications.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', ctrl.getMine);
router.put('/read-all', ctrl.markAllRead);
router.put('/:id/read', ctrl.markRead);

module.exports = router;
