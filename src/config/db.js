const mongoose = require('mongoose');

// Tracks whether we're already attempting a reconnect to avoid parallel attempts
let reconnecting = false;

const OPTS = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS:          45000,
  connectTimeoutMS:         10000,
  heartbeatFrequencyMS:     10000, // ping Atlas every 10s so idle connections stay alive
  family: 4,                       // force IPv4 — avoids IPv6/TLS issues on Windows with SRV records
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, OPTS);
    reconnecting = false;
    console.log(`[MongoDB] Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('[MongoDB] Initial connection failed:', err.message);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  if (reconnecting) return;
  reconnecting = true;
  console.warn('[MongoDB] Disconnected — reconnecting in 3s...');
  setTimeout(async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI, OPTS);
      reconnecting = false;
      console.log('[MongoDB] Reconnected.');
    } catch (err) {
      console.error('[MongoDB] Reconnection failed:', err.message);
      reconnecting = false;
    }
  }, 3000);
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Error:', err.message);
});

module.exports = connectDB;
