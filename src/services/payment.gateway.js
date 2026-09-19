/**
 * Returns the active payment service module based on admin-configured provider.
 * Falls back to PAYMENT_PROVIDER env var, then defaults to Paystack.
 */
async function getPaymentGateway () {
  try {
    const PlatformSettings = require('../models/PlatformSettings');
    const s = await PlatformSettings.findOne().select('paymentProvider').lean();
    if (s?.paymentProvider === 'monnify') return require('./monnify.service');
  } catch { /* DB not ready — fall through to env */ }
  if (process.env.PAYMENT_PROVIDER === 'monnify') return require('./monnify.service');
  return require('./paystack.service');
}

/**
 * Returns just the provider name string ('paystack' | 'monnify').
 */
async function getProviderName () {
  try {
    const PlatformSettings = require('../models/PlatformSettings');
    const s = await PlatformSettings.findOne().select('paymentProvider').lean();
    if (s?.paymentProvider === 'monnify') return 'monnify';
  } catch { /* fall through */ }
  return process.env.PAYMENT_PROVIDER === 'monnify' ? 'monnify' : 'paystack';
}

module.exports = { getPaymentGateway, getProviderName };
