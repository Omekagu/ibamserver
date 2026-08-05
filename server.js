// Polyfill Web Crypto for Node.js < 19 (needed by mongodb driver v6+ and expo-server-sdk)
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}

require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { initSocket } = require('./src/config/socket');
const seedAdmin = require('./src/seeds/admin.seed');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await seedAdmin();

  const httpServer = http.createServer(app);
  initSocket(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
