const jwt = require('jsonwebtoken');

const DEVICE_JWT_SECRET = process.env.DEVICE_JWT_SECRET || process.env.JWT_SECRET || 'deviceSecretKey';

/**
 * Middleware that validates a device JWT from Authorization: Bearer <token>.
 * Populates req.device = { deviceId, carId, type }.
 */
const verifyDeviceToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'DEVICE_AUTH_MISSING', message: 'Device authorization token is required' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, DEVICE_JWT_SECRET);
    if (decoded.type !== 'device') {
      return res.status(403).json({
        error: { code: 'NOT_DEVICE_TOKEN', message: 'Token is not a device token' }
      });
    }
    req.device = decoded;
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'DEVICE_TOKEN_EXPIRED' : 'DEVICE_TOKEN_INVALID';
    return res.status(401).json({ error: { code, message: err.message } });
  }
};

module.exports = { verifyDeviceToken };
