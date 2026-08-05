const NodeCache = require('node-cache');

const otpCache = new NodeCache({ stdTTL: 600 }); // 10 minutes

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const storeOTP = (key, otp) => otpCache.set(key, otp);

const verifyOTP = (key, otp) => {
  const stored = otpCache.get(key);
  if (!stored || stored !== otp) return false;
  otpCache.del(key);
  return true;
};

module.exports = { generateOTP, storeOTP, verifyOTP };
