const router = require('express').Router();
const ctrl = require('../controllers/prescriptions.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');

router.use(protect);

router.post('/', restrictTo('doctor'), ctrl.create);
router.get('/mine', ctrl.getMine);
router.get('/by-consultation/:cid', ctrl.getByConsultation);
router.get('/:id', ctrl.getOne);
router.put('/:id/forward-pharmacy', restrictTo('patient'), ctrl.forwardToPharmacy);

module.exports = router;
