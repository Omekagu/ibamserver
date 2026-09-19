const router = require('express').Router();
const ctrl = require('../controllers/payments.controller');
const { protect } = require('../middleware/auth');
const PlatformSettings = require('../models/PlatformSettings');
const { sendSuccess } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// Webhook routes — raw body, no auth
router.post('/webhook',         ctrl.webhook);
router.post('/monnify-webhook', ctrl.monnifyWebhook);

// Public: payment method settings (so patients know which provider is active + direct transfer info)
router.get('/settings', asyncHandler(async (req, res) => {
  let s = await PlatformSettings.findOne().select(
    'paymentProvider paystackEnabled paystackPublicKey monnifyEnabled monnifyApiKey directPaymentEnabled companyBankName companyAccountNumber companyAccountName directPaymentNote'
  );
  if (!s) s = { directPaymentEnabled: false, paymentProvider: 'paystack', paystackEnabled: true };
  const out = {
    paymentProvider:        s.paymentProvider || 'paystack',
    paystackEnabled:        s.paystackEnabled,
    paystackPublicKey:      s.paystackPublicKey || process.env.PAYSTACK_PUBLIC_KEY || '',
    monnifyEnabled:         s.monnifyEnabled,
    monnifyPublicKey:       s.monnifyApiKey    || process.env.MONNIFY_API_KEY      || '',
    directPaymentEnabled:   s.directPaymentEnabled,
    companyBankName:        s.companyBankName,
    companyAccountNumber:   s.companyAccountNumber,
    companyAccountName:     s.companyAccountName,
    directPaymentNote:      s.directPaymentNote,
  };
  sendSuccess(res, 200, 'Payment settings retrieved.', { settings: out });
}));

router.use(protect);

router.post('/initiate', ctrl.initiate);
router.post('/submit-transfer', ctrl.submitTransfer);
router.post('/refund-request', ctrl.requestRefund);
router.get('/verify/:reference', ctrl.verify);
router.get('/mine', ctrl.getMine);

module.exports = router;
