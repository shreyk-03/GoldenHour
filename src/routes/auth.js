const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { validate, loginSchema } = require('../middleware/validation');
const { requireAuth, signToken } = require('../middleware/auth');
const { getDB } = require('../db/store');

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { success: false, error: 'Too many login attempts, try again in a minute' },
});

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  hospital_id: user.hospital_id || null,
});

/**
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const db = getDB();
  const email = req.body.email.trim().toLowerCase();
  const user = await db.collection('users').findOne({ email });

  const invalid = () => res.status(401).json({ success: false, error: 'Invalid email or password' });
  if (!user || !user.is_active) return invalid();

  const passwordOk = await bcrypt.compare(req.body.password, user.password_hash || '');
  if (!passwordOk) return invalid();

  const token = signToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hospital_id: user.hospital_id || null,
  });

  res.json({ success: true, data: { token, user: publicUser(user) } });
}));

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, (req, res) => {
  const { sub, email, name, role, hospital_id } = req.user;
  res.json({
    success: true,
    data: { id: sub, email, name, role, hospital_id: hospital_id || null },
  });
});

module.exports = router;
