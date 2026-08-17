const router = require('express').Router();
const ctrl = require('../controllers/pharmacy.controller');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/role');
const upload = require('../middleware/upload');

router.post('/onboard', ctrl.onboard);
router.get('/partners', ctrl.listPartners);
router.get('/drugs/search', ctrl.searchDrugs);
router.get('/:id/catalog', ctrl.getPublicCatalog);

router.use(protect);

router.get('/profile', restrictTo('pharmacy_partner'), ctrl.getPharmacyProfile);
router.put('/profile', restrictTo('pharmacy_partner'), ctrl.updatePharmacyProfile);
router.post('/profile/logo', restrictTo('pharmacy_partner'), upload.single('logo'), ctrl.uploadPharmacyLogo);
router.get('/catalog', restrictTo('pharmacy_partner'), ctrl.getOwnCatalog);
router.put('/catalog', restrictTo('pharmacy_partner'), ctrl.updateCatalog);

router.post('/order', restrictTo('patient'), ctrl.placeOrder);
router.post('/order/direct', restrictTo('patient'), upload.single('prescription'), ctrl.placeDirectOrder);
router.patch('/orders/:id/cancel', restrictTo('patient'), ctrl.cancelMyOrder);
router.get('/orders/mine', restrictTo('patient'), ctrl.getMyOrders);
router.get('/orders/partner', restrictTo('pharmacy_partner'), ctrl.getPartnerOrders);
router.get('/earnings', restrictTo('pharmacy_partner'), ctrl.getPharmacyEarnings);
router.post('/earnings/request-payout', restrictTo('pharmacy_partner'), ctrl.requestPharmacyPayout);
router.put('/order/:id/status', restrictTo('pharmacy_partner', 'admin'), ctrl.updateOrderStatus);

module.exports = router;
