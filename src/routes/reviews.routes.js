const router = require('express').Router();
const ctrl = require('../controllers/reviews.controller');
const { protect } = require('../middleware/auth');

router.post('/', protect, ctrl.create);
router.get('/mine/:targetId', protect, ctrl.myReviewFor);
router.get('/:targetType/:targetId', ctrl.getForTarget);

module.exports = router;
