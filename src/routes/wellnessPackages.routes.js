const router = require('express').Router();
const ctrl   = require('../controllers/wellnessPackages.controller');
const { protect } = require('../middleware/auth');

router.get('/', ctrl.listPackages);

router.use(protect);
router.post('/:id/book', ctrl.bookPackage);

module.exports = router;
