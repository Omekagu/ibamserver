const axios = require('axios');

const BASE = 'https://api.dojah.io';
// Set DOJAH_BYPASS=true in .env to skip real API calls during development.
const BYPASS = process.env.DOJAH_BYPASS === 'true';

function client() {
  const appId  = process.env.DOJAH_APP_ID;
  const secret = process.env.DOJAH_PRIVATE_KEY;
  if (!appId || !secret) throw new Error('Dojah credentials not configured.');
  return axios.create({
    baseURL: BASE,
    headers: { AppId: appId, Authorization: secret, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

/** Extract a human-readable message from a Dojah API error response. */
function dojahMsg(err, fallback) {
  const d = err?.response?.data;
  return d?.error || d?.message || d?.detail || fallback;
}

/**
 * Lookup a NIN and return the entity object from Dojah.
 * Throws with a clean message if NIN is not found or Dojah rejects the request.
 */
async function lookupNIN(nin) {
  if (BYPASS) {
    // Dev bypass: return a mock entity so the NIN step can be tested locally.
    // Name tokens are intentionally generic so any account name passes matching.
    return { firstname: 'Test', lastname: 'User', middlename: '', photo: null };
  }
  try {
    const { data } = await client().get('/api/v1/kyc/nin', { params: { nin } });
    const entity = data?.entity;
    if (!entity) throw new Error(data?.error || data?.message || 'NIN not found or not registered.');
    return entity;
  } catch (err) {
    if (err?.response) {
      throw new Error(dojahMsg(err, `NIN lookup failed (${err.response.status}). Check the number and try again.`));
    }
    throw err;
  }
}

/**
 * Compare a selfie (base64 string) against an ID image (base64 or URL).
 * Returns { match: boolean, confidence: number (0–100) }
 */
async function faceMatch(selfieBase64, idImageBase64) {
  if (BYPASS) {
    return { match: true, confidence: 99 };
  }
  try {
    const { data } = await client().post('/api/v1/kyc/selfie', {
      selfie_image: selfieBase64,
      government_id_image: idImageBase64,
    });
    const result = data?.entity;
    const confidence = result?.confidence_value ?? 0;
    return { match: confidence >= 70, confidence };
  } catch (err) {
    if (err?.response) {
      throw new Error(dojahMsg(err, 'Face match request failed. Please try again.'));
    }
    throw err;
  }
}

/**
 * Lookup a CAC (Corporate Affairs Commission) registration number.
 * Returns the entity object with company name, status, etc.
 */
async function lookupCAC(rcNumber) {
  if (BYPASS) {
    return { company_name: 'Test Business Ltd', rc_number: rcNumber, status: 'ACTIVE' };
  }
  try {
    const { data } = await client().get('/api/v1/kyc/cac/basic', {
      params: { rc_number: rcNumber },
    });
    const entity = data?.entity;
    if (!entity) throw new Error(data?.error || data?.message || 'CAC number not found.');
    return entity;
  } catch (err) {
    if (err?.response) {
      throw new Error(dojahMsg(err, `CAC lookup failed (${err.response.status}). Check the RC number and try again.`));
    }
    throw err;
  }
}

module.exports = { lookupNIN, faceMatch, lookupCAC };
