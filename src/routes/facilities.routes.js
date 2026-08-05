const router = require('express').Router();
const ctrl = require('../controllers/facilities.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');

router.get('/', ctrl.list);
router.get('/nearby', ctrl.getNearby);
router.get('/emergency', ctrl.getEmergency);
router.get('/:id', ctrl.getOne);

router.use(protect, restrictTo('admin'));

router.post('/', ctrl.create);
router.put('/:id', ctrl.update);

module.exports = router;
