const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const EXPIRY_SECONDS = 3600; // 1 hour

const generateRtcToken = (channelName, uid, role = 'publisher') => {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    throw new Error('Agora credentials not configured');
  }

  const agoraRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const expireTime = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    agoraRole,
    expireTime
  );
};

module.exports = { generateRtcToken };
