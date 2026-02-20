const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const router = express.Router();
router.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '15m';
const JWT_REFRESH_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION || '7d';

const ADMIN_SERVICE = 'http://localhost:6000/admins';
const USER_SERVICE  = 'http://localhost:6004/users';

// ── Token Generators ───────────────────────────────────────
// Tokens now include role claim for RBAC across all services.

const generateAccessToken = (identity) => {
  return jwt.sign(
    { id: identity._id, email: identity.email, role: identity.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );
};

const generateRefreshToken = (identity) => {
  return jwt.sign(
    { id: identity._id, email: identity.email, role: identity.role },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRATION }
  );
};

// ── Authenticate User via User Microservice ────────────────
async function authenticateUser(email, password) {
  try {
    const response = await axios.get(`${USER_SERVICE}/email?email=${email}`, { timeout: 5000 });
    const user = response.data;

    if (!user || !user.password) {
      throw new Error('User not found');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    // Attach role for JWT claim
    user.role = 'USER';
    return user;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error('Invalid credentials');
    }
    throw new Error(error.message || 'User authentication failed');
  }
}

// ── Authenticate Admin via Admin Microservice ──────────────
async function authenticateAdmin(email, password) {
  try {
    const response = await axios.get(`${ADMIN_SERVICE}/email?email=${email}`, { timeout: 5000 });
    const admin = response.data;

    if (!admin || !admin.password) {
      throw new Error('Admin not found');
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    // role comes from admin record (ADMIN or SUPER_ADMIN)
    return admin;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error('Invalid credentials');
    }
    throw new Error(error.message || 'Admin authentication failed');
  }
}

// ── User Login ─────────────────────────────────────────────
router.post('/user/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'Email and password are required' } });
    }

    const user = await authenticateUser(email, password);
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: false, sameSite: 'Strict' });
    res.json({ accessToken, role: user.role });
  } catch (error) {
    res.status(401).json({ error: { code: 'AUTH_FAILED', message: error.message } });
  }
});

// ── Admin Login ────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'Email and password are required' } });
    }

    const admin = await authenticateAdmin(email, password);
    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: false, sameSite: 'Strict' });
    res.json({ accessToken, role: admin.role });
  } catch (error) {
    res.status(401).json({ error: { code: 'AUTH_FAILED', message: error.message } });
  }
});

// ── Refresh Token ──────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) {
    return res.status(403).json({ error: { code: 'REFRESH_TOKEN_REQUIRED', message: 'Refresh token is required' } });
  }

  jwt.verify(refreshToken, JWT_REFRESH_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: { code: 'REFRESH_TOKEN_INVALID', message: 'Invalid refresh token' } });
    }

    const accessToken = generateAccessToken(decoded);
    res.json({ accessToken });
  });
});

// ── Logout ─────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'Strict' });
  res.json({ message: 'Logged out successfully' });
});

// ── Protected Route (Test) ─────────────────────────────────
router.get('/protected', verifyToken, (req, res) => {
  res.json({ message: 'Access granted!', user: req.user });
});

// ── Middleware: Verify JWT ──────────────────────────────────
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(403).json({ error: { code: 'TOKEN_REQUIRED', message: 'Token required' } });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid token' } });
    req.user = decoded;
    next();
  });
}

module.exports = { authRouter: router, verifyToken };
