// expo-server-sdk v6+ is ESM-only; use dynamic import() so this CJS module can load it.
let _expo = null;
async function getExpo() {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}

/**
 * Send Expo push notifications to one or more tokens.
 * Silently skips invalid tokens; logs any delivery errors.
 */
async function sendPushNotifications({ tokens, title, body, data = {}, sound = 'default' }) {
  if (!tokens?.length) return;

  const { Expo } = await import('expo-server-sdk');
  const expo = await getExpo();

  const messages = tokens
    .filter(t => t && Expo.isExpoPushToken(t))
    .map(to => ({ to, sound, title, body, data }));

  if (!messages.length) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      receipts.forEach(r => {
        if (r.status === 'error') {
          console.error('[Push] delivery error:', r.message, r.details);
        }
      });
    } catch (err) {
      console.error('[Push] chunk send error:', err.message);
    }
  }
}

module.exports = { sendPushNotifications };
