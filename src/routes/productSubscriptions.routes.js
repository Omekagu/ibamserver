const router = require('express').Router();
const ctrl = require('../controllers/productSubscriptions.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');

router.use(protect);

router.get('/mine', ctrl.getMine);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);

router.get('/all', restrictTo('admin'), ctrl.getAll);

module.exports = router;
