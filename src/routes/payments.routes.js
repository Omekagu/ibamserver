const router = require('express').Router();
const ctrl = require('../controllers/payments.controller');
const { protect } = require('../middleware/auth');
const PlatformSettings = require('../models/PlatformSettings');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// Paystack webhook — must be raw body, no auth
router.post('/webhook', ctrl.webhook);

// Public: payment method settings (so patients know if direct transfer is on)
router.get('/settings', asyncHandler(async (req, res) => {
  let s = await PlatformSettings.findOne().select('directPaymentEnabled companyBankName companyAccountNumber companyAccountName directPaymentNote');
  if (!s) s = { directPaymentEnabled: false };
  sendSuccess(res, 200, 'Payment settings retrieved.', { settings: s });
}));

router.use(protect);

router.post('/initiate', ctrl.initiate);
router.post('/submit-transfer', ctrl.submitTransfer);
router.get('/verify/:reference', ctrl.verify);
router.get('/mine', ctrl.getMine);

module.exports = router;
