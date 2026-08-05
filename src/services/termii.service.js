const axios = require('axios');

const TERMII_BASE = 'https://v3.api.termii.com/api';

const sendSMS = async (to, message) => {
  const payload = {
    to,
    from: process.env.TERMII_SENDER_ID || 'IBamHealth',
    sms: message,
    type: 'plain',
    channel: 'generic',
    api_key: process.env.TERMII_API_KEY,
  };
  const { data } = await axios.post(`${TERMII_BASE}/sms/send`, payload);
  return data;
};

const sendOTP = async (to) => {
  const payload = {
    api_key: process.env.TERMII_API_KEY,
    message_type: 'NUMERIC',
    to,
    from: process.env.TERMII_SENDER_ID || 'IBamHealth',
    channel: 'generic',
    pin_attempts: 3,
    pin_time_to_live: 10,
    pin_length: 6,
    pin_placeholder: '< 1234 >',
    message_text: 'Your iBam Health verification code is < 1234 >. Valid for 10 minutes.',
    pin_type: 'NUMERIC',
  };
  const { data } = await axios.post(`${TERMII_BASE}/sms/otp/send`, payload);
  return data;
};

const verifyTermiiOTP = async (pinId, pin) => {
  const payload = { api_key: process.env.TERMII_API_KEY, pin_id: pinId, pin };
  const { data } = await axios.post(`${TERMII_BASE}/sms/otp/verify`, payload);
  return data;
};

module.exports = { sendSMS, sendOTP, verifyTermiiOTP };
