const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cfg = cloudinary.config();
console.log('[Cloudinary] cloud_name:', cfg.cloud_name || 'NOT SET');
console.log('[Cloudinary] api_key:', cfg.api_key ? cfg.api_key.toString().slice(0, 6) + '...' : 'NOT SET');

module.exports = cloudinary;
