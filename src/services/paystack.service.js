const axios = require('axios');

async function getClient () {
  let key = process.env.PAYSTACK_SECRET_KEY || '';
  try {
    const PlatformSettings = require('../models/PlatformSettings');
    const s = await PlatformSettings.findOne().select('paystackSecretKey').lean();
    if (s?.paystackSecretKey) key = s.paystackSecretKey;
  } catch { /* use env fallback */ }
  return axios.create({
    baseURL: 'https://api.paystack.co',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
}

const initializeTransaction = async ({ email, amount, reference, metadata = {} }) => {
  const client = await getClient();
  const { data } = await client.post('/transaction/initialize', {
    email,
    amount: amount * 100,
    reference,
    metadata,
    callback_url: process.env.PAYSTACK_CALLBACK_URL,
  });
  return data.data;
};

const verifyTransaction = async (reference) => {
  const client = await getClient();
  const { data } = await client.get(`/transaction/verify/${reference}`);
  return data.data;
};

const createPlan = async ({ name, amount, interval }) => {
  const client = await getClient();
  const { data } = await client.post('/plan', { name, amount: amount * 100, interval });
  return data.data;
};

const createSubscription = async ({ customer, plan, startDate }) => {
  const client = await getClient();
  const { data } = await client.post('/subscription', { customer, plan, start_date: startDate });
  return data.data;
};

const cancelSubscription = async ({ code, token }) => {
  const client = await getClient();
  const { data } = await client.post('/subscription/disable', { code, token });
  return data;
};

const createTransferRecipient = async ({ type = 'nuban', name, accountNumber, bankCode, currency = 'NGN' }) => {
  const client = await getClient();
  const { data } = await client.post('/transferrecipient', {
    type,
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency,
  });
  return data.data;
};

const initiateTransfer = async ({ amount, recipient, reason = '' }) => {
  const client = await getClient();
  const { data } = await client.post('/transfer', {
    source: 'balance',
    amount: Math.round(amount * 100),
    recipient,
    reason,
  });
  return data.data;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createPlan,
  createSubscription,
  cancelSubscription,
  createTransferRecipient,
  initiateTransfer,
};
