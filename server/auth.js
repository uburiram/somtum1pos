'use strict';

const jwt = require('jsonwebtoken');
const { verifyPassword } = require('./password');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'somtum1pos-change-me-in-production-2026';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

function signToken(staff) {
  return jwt.sign(
    { sub: staff.id, username: staff.username, role: staff.role, name: staff.display_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบ' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }
    next();
  });
}

function login(username, password) {
  const staff = db.prepare(
    'SELECT * FROM staff WHERE username = ? AND is_active = 1'
  ).get(username);
  if (!staff) return null;
  if (!verifyPassword(password, staff.password_hash)) return null;
  return {
    token: signToken(staff),
    user: {
      id: staff.id,
      username: staff.username,
      displayName: staff.display_name,
      role: staff.role
    }
  };
}

module.exports = { authRequired, adminRequired, login, JWT_SECRET };
