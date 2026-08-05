const axios = require('axios');

const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

const initializeTransaction = async ({ email, amount, reference, metadata = {} }) => {
  const { data } = await paystackClient.post('/transaction/initialize', {
    email,
    amount: amount * 100, // kobo
    reference,
    metadata,
    callback_url: process.env.PAYSTACK_CALLBACK_URL,
  });
  return data.data;
};

const verifyTransaction = async (reference) => {
  const { data } = await paystackClient.get(`/transaction/verify/${reference}`);
  return data.data;
};

const createPlan = async ({ name, amount, interval }) => {
  const { data } = await paystackClient.post('/plan', {
    name,
    amount: amount * 100,
    interval,
  });
  return data.data;
};

const createSubscription = async ({ customer, plan, startDate }) => {
  const { data } = await paystackClient.post('/subscription', {
    customer,
    plan,
    start_date: startDate,
  });
  return data.data;
};

const cancelSubscription = async ({ code, token }) => {
  const { data } = await paystackClient.post('/subscription/disable', {
    code,
    token,
  });
  return data;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createPlan,
  createSubscription,
  cancelSubscription,
};
