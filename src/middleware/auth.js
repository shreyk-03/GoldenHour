const jwt = require('jsonwebtoken');

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const err = new Error('JWT_SECRET is not configured');
    err.statusCode = 500;
    throw err;
  }
  return secret;
};

const signToken = (payload) =>
  jwt.sign(payload, getSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, getSecret());
    return next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired, please sign in again' : 'Invalid or expired token';
    return res.status(401).json({ success: false, error: message });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions for this action' });
  }
  next();
};

// Hospital-role users may only modify their own hospital's records
const requireHospitalScope = (param = 'id') => (req, res, next) => {
  if (req.user?.role !== 'hospital') return next();
  if (req.user.hospital_id !== req.params[param]) {
    return res.status(403).json({ success: false, error: 'Access restricted to your own hospital' });
  }
  next();
};

module.exports = { requireAuth, requireRole, requireHospitalScope, signToken, getSecret };
