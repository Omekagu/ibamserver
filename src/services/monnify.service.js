const axios = require('axios');

// In-memory token cache — refreshed 60 s before expiry
let _tokenCache = null; // { token, baseUrl, contractCode, expiresAt }

async function getCredentials () {
  let apiKey       = process.env.MONNIFY_API_KEY        || '';
  let secretKey    = process.env.MONNIFY_SECRET_KEY     || '';
  let contractCode = process.env.MONNIFY_CONTRACT_CODE  || '';
  let baseUrl      = process.env.MONNIFY_BASE_URL       || 'https://sandbox.monnify.com';
  let sourceAccount = process.env.MONNIFY_SOURCE_ACCOUNT || '';
  try {
    const PlatformSettings = require('../models/PlatformSettings');
    const s = await PlatformSettings.findOne()
      .select('monnifyApiKey monnifySecretKey monnifyContractCode monnifyBaseUrl monnifySourceAccountNumber')
      .lean();
    if (s?.monnifyApiKey)              apiKey        = s.monnifyApiKey;
    if (s?.monnifySecretKey)           secretKey     = s.monnifySecretKey;
    if (s?.monnifyContractCode)        contractCode  = s.monnifyContractCode;
    if (s?.monnifyBaseUrl)             baseUrl       = s.monnifyBaseUrl;
    if (s?.monnifySourceAccountNumber) sourceAccount = s.monnifySourceAccountNumber;
  } catch { /* use env fallback */ }
  return { apiKey, secretKey, contractCode, baseUrl, sourceAccount };
}

async function getAccessToken () {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache;
  }
  const { apiKey, secretKey, baseUrl, contractCode, sourceAccount } = await getCredentials();
  const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const { data } = await axios.post(
    `${baseUrl}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' } }
  );
  const { accessToken, expiresIn } = data.responseBody;
  _tokenCache = {
    token: accessToken,
    baseUrl,
    contractCode,
    sourceAccount,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return _tokenCache;
}

async function getClient () {
  const cache = await getAccessToken();
  return {
    http: axios.create({
      baseURL: cache.baseUrl,
      headers: { Authorization: `Bearer ${cache.token}`, 'Content-Type': 'application/json' },
    }),
    contractCode:  cache.contractCode,
    sourceAccount: cache.sourceAccount,
  };
}

const initializeTransaction = async ({ email, amount, reference, metadata = {}, subaccount }) => {
  const { http, contractCode } = await getClient();
  const redirectUrl =
    process.env.MONNIFY_REDIRECT_URL ||
    process.env.PAYSTACK_CALLBACK_URL ||
    'https://www.ibamhealth.com/payment/verify';

  const body = {
    amount,
    customerName:       metadata.userName || email,
    customerEmail:      email,
    paymentReference:   reference,
    paymentDescription: `iBam Health – ${metadata.type || 'payment'}`,
    currencyCode:       'NGN',
    contractCode,
    redirectUrl,
    paymentMethods:     ['CARD', 'ACCOUNT_TRANSFER'],
  };

  if (subaccount) {
    const platformCut = Number(process.env.PLATFORM_CUT_PERCENT) || 10;
    body.incomeSplitConfig = [{
      subAccountCode:  subaccount,
      splitPercentage: 100 - platformCut,
      feeBearer:       false,
      feePercentage:   0,
    }];
  }

  const { data } = await http.post('/api/v1/merchant/transactions/init-transaction', body);
  const rb = data.responseBody;
  // Normalise to Paystack-compatible shape so callers don't need to branch
  return {
    authorization_url: rb.checkoutUrl,
    access_code:       rb.transactionReference,
    reference:         rb.paymentReference,
    monnify_ref:       rb.transactionReference,
  };
};

const verifyTransaction = async (reference) => {
  const { http } = await getClient();
  const { data } = await http.get(
    `/api/v1/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`
  );
  const rb = data.responseBody;
  return {
    status:        rb.paymentStatus === 'PAID' ? 'success' : 'failed',
    reference:     rb.paymentReference,
    amount:        rb.amount,
    monnify_status: rb.paymentStatus,
  };
};

// Not natively supported by Monnify — throw so callers can guard appropriately
const createPlan = async () => {
  throw new Error('Subscription plans are not supported by Monnify. Switch to Paystack for subscriptions.');
};
const createSubscription = async () => {
  throw new Error('Subscriptions are not supported by Monnify. Switch to Paystack for subscriptions.');
};
const cancelSubscription = async () => {
  throw new Error('Subscriptions are not supported by Monnify. Switch to Paystack for subscriptions.');
};

const createTransferRecipient = async ({ name, accountNumber, bankCode }) => {
  // Monnify has no separate "recipient" object — bank details are used directly in disbursement.
  // Encode as a JSON string so initiateTransfer can parse it back without a DB round-trip.
  return { recipient_code: JSON.stringify({ accountNumber, bankCode, name }), accountNumber, bankCode, name };
};

const initiateTransfer = async ({ amount, recipient, reason = '' }) => {
  const { http, sourceAccount } = await getClient();
  let dest = {};
  try { dest = JSON.parse(recipient); } catch { dest = { accountNumber: recipient, bankCode: '' }; }

  const reference = `ibam_payout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data } = await http.post('/api/v2/disbursements/single', {
    amount,
    reference,
    narration:                  reason || 'iBam Health partner payout',
    destinationBankCode:        dest.bankCode,
    destinationAccountNumber:   dest.accountNumber,
    currency:                   'NGN',
    sourceAccountNumber:        sourceAccount,
  });
  return data.responseBody;
};

const resolveAccount = async ({ accountNumber, bankCode }) => {
  const { http } = await getClient();
  const { data } = await http.get(
    `/api/v1/disbursements/account/validate?accountNumber=${accountNumber}&bankCode=${bankCode}`
  );
  const rb = data.responseBody;
  return { account_number: rb.accountNumber, account_name: rb.accountName };
};

// percentageCharge is the platform's share (e.g. 10 means platform keeps 10%, partner gets 90%)
const createSubaccount = async ({ businessName, bankCode, accountNumber, percentageCharge = 10, description }) => {
  const { http } = await getClient();
  const { data } = await http.post('/api/v1/sub-accounts', {
    currencyCode:            'NGN',
    bankCode,
    accountNumber,
    email:                   description || businessName,
    defaultSplitPercentage:  100 - percentageCharge,
  });
  const rb = data.responseBody;
  return { subaccount_code: rb.subAccountCode, ...rb };
};

const updateSubaccount = async (subaccountCode, updates) => {
  const { http } = await getClient();
  const { data } = await http.put(`/api/v1/sub-accounts/${subaccountCode}`, updates);
  return data.responseBody;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createPlan,
  createSubscription,
  cancelSubscription,
  createTransferRecipient,
  initiateTransfer,
  resolveAccount,
  createSubaccount,
  updateSubaccount,
};
