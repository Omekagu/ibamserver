const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  token:    { type: String, required: true, unique: true, index: true },
  googleId: { type: String },
  name:     { type: String },
  email:    { type: String },
  picture:  { type: String },
  expiresAt:{ type: Date, required: true },
});

// MongoDB TTL: auto-delete once expiresAt is reached
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GooglePending', schema);
