const router = require('express').Router();
const ctrl = require('../controllers/subscriptions.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');

router.get('/plans', ctrl.listPlans);

router.use(protect, restrictTo('patient'));

router.post('/subscribe', ctrl.subscribe);
router.put('/cancel', ctrl.cancel);
router.get('/mine', ctrl.getMine);

module.exports = router;
