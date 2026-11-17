
;const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../../config/db');
const { auth } = require('../middleware/auth');
const { createWatermarkCode } = require('../utils/watermarkCode');

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').trim().isLength({ min: 2 }),
  body('school_id').trim().isLength({ min: 1, max: 100 }),
  body('university_id').isInt({ min: 1 }),
  body('department_id').isInt({ min: 1 }),
  body('phone').optional().isMobilePhone(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, full_name, phone, university_id, department_id, school_id, role } = req.body;

  try {
    const { rows: departmentRows } = await db.query(
      'SELECT id FROM departments WHERE id = $1 AND university_id = $2 AND is_active = true',
      [department_id, university_id]
    );
    if (!departmentRows[0]) return res.status(400).json({ error: 'Select a department at your university' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const watermarkCode = createWatermarkCode();
    const userRole = role === 'seller' ? 'seller' : 'buyer';
    const sellerStatus = userRole === 'seller' ? 'pending' : 'none';

    const { rows } = await db.query(`
      INSERT INTO users
        (email, password_hash, full_name, phone, university_id, department_id,
         school_id, watermark_code, role, seller_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, email, full_name, role, seller_status, school_id, department_id, watermark_code
    `, [
      email, hash, full_name, phone, university_id, department_id,
      school_id.trim().toUpperCase(), watermarkCode, userRole, sellerStatus,
    ]);

    const user = rows[0];

    if (userRole === 'seller') {
      // Notify admin of new seller application
      await db.query(`
        INSERT INTO notifications (user_id, type, title, message)
        SELECT id, 'new_seller_application', 'New seller application', $1
        FROM users WHERE role = 'admin' LIMIT 1
      `, [`${full_name} has applied to become a seller.`]);
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.cookie('token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
});

    res.status(201).json({ user, token, message: userRole === 'seller' ? 'Application submitted for review' : 'Account created' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or School ID is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;

  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.email, u.full_name, u.phone, u.role, u.seller_status,
             u.trust_score, u.total_earnings, u.pending_earnings,
             u.avatar_url, u.seller_bio, u.university_id,
             un.name as university_name, un.short_name as university_short
      FROM users u
      LEFT JOIN universities un ON un.id = u.university_id
      WHERE u.id = $1
    `, [req.user.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
