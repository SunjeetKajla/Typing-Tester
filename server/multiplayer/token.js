const crypto = require('node:crypto');

const TOKEN_LIFETIME_SECONDS = 5 * 60;

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signatureFor(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSocketToken(userId, secret, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('A valid session secret is required.');
  const payload = encode(JSON.stringify({
    sub: userId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS,
    nonce: crypto.randomBytes(12).toString('base64url'),
  }));
  return `${payload}.${signatureFor(payload, secret)}`;
}

function verifySocketToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret || secret.length < 32) return null;
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = signatureFor(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const currentSeconds = Math.floor(now / 1000);
    if (
      typeof claims.sub !== 'string' ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= currentSeconds ||
      claims.iat > currentSeconds + 30 ||
      claims.exp - claims.iat > TOKEN_LIFETIME_SECONDS
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

module.exports = { TOKEN_LIFETIME_SECONDS, createSocketToken, verifySocketToken };
