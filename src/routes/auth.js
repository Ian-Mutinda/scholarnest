
;const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const db = require('../../config/db');
const { auth } = require('../middleware/auth');
const { createWatermarkCode } = require('../utils/watermarkCode');
const { matchesUniversityEmail } = require('../utils/universityEmail');
const {
  TOKEN_TTL_HOURS,
  createVerificationToken,
  getMailConfiguration,
  sendVerificationEmail,
} = require('../services/emailVerification');

const verificationEmailLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification email requests. Try again later.' },
});

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('full_name').trim().isLength({ min: 2 }),
  body('school_id').trim().isLength({ min: 1, max: 100 }),
  body('university_id').isInt({ min: 1 }),
  body('department_id').isInt({ min: 1 }),
  body('phone').optional({ values: 'falsy' }).isMobilePhone(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, full_name, phone, university_id, department_id, school_id, role } = req.body;

  try {
    try {
      getMailConfiguration();
    } catch (err) {
      console.error('Email verification configuration error:', err.message);
      return res.status(503).json({ error: 'Email verification is not configured. Please contact support.' });
    }

    const { rows: universityRows } = await db.query(
      'SELECT domain FROM universities WHERE id = $1 AND is_active = true',
      [university_id]
    );
    if (!universityRows[0]) return res.status(400).json({ error: 'Select an active university' });
    if (!universityRows[0].domain) {
      return res.status(503).json({ error: 'Email registration is not configured for this university yet' });
    }
    if (!matchesUniversityEmail(email, universityRows[0].domain)) {
      return res.status(400).json({ error: 'Use an email address provided by your selected university' });
    }

    const { rows: departmentRows } = await db.query(
      'SELECT id FROM departments WHERE id = $1 AND university_id = $2 AND is_active = true',
      [department_id, university_id]
    );
    if (!departmentRows[0]) return res.status(400).json({ error: 'Select a department at your university' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const watermarkCode = createWatermarkCode();
    const { token, tokenHash } = createVerificationToken();
    const userRole = role === 'seller' ? 'seller' : 'buyer';
    const sellerStatus = userRole === 'seller' ? 'pending' : 'none';

    const { rows } = await db.query(`
      INSERT INTO users
        (email, password_hash, full_name, phone, university_id, department_id,
         school_id, watermark_code, role, seller_status, email_verified,
         email_verification_token_hash, email_verification_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11,
              NOW() + ($12 * INTERVAL '1 hour'))
      RETURNING id, email, full_name, role, seller_status
    `, [
      email, hash, full_name, phone, university_id, department_id,
      school_id.trim().toUpperCase(), watermarkCode, userRole, sellerStatus,
      tokenHash, TOKEN_TTL_HOURS,
    ]);

    const user = rows[0];

    try {
      await sendVerificationEmail({ email: user.email, fullName: user.full_name, token });
      await db.query(
        'UPDATE users SET verification_email_sent_at = NOW() WHERE id = $1 AND email_verified = false',
        [user.id]
      );
    } catch (err) {
      console.error('Verification email delivery failed:', err.message);
      return res.status(503).json({
        error: 'Account created, but the verification email could not be sent. Please request another email.',
      });
    }

    res.status(201).json({
      message: 'Verification email sent. Confirm your email address before logging in.',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email or School ID is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/verify-email', [
  body('token').isHexadecimal().isLength({ min: 64, max: 64 }),
  body('password').custom(password =>
    typeof password === 'string' &&
    password.length >= 8 &&
    Buffer.byteLength(password, 'utf8') <= 72
  ),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Use a valid verification link and an 8–72 byte password' });

  const tokenHash = crypto.createHash('sha256').update(req.body.token.toLowerCase()).digest('hex');
  try {
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    const { rows } = await db.query(`
      UPDATE users
      SET password_hash = $1,
          email_verified = true,
          email_verification_token_hash = NULL,
          email_verification_expires_at = NULL,
          verification_email_sent_at = NULL
      WHERE email_verification_token_hash = $2
        AND email_verified = false
        AND email_verification_expires_at > NOW()
      RETURNING id, email, full_name, role
    `, [passwordHash, tokenHash]);
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });

    if (user.role === 'seller') {
      try {
        await db.query(`
          INSERT INTO notifications (user_id, type, title, message)
          SELECT id, 'new_seller_application', 'New seller application', $1
          FROM users WHERE role = 'admin' LIMIT 1
        `, [`${user.full_name} has applied to become a seller.`]);
      } catch (err) {
        console.error('Failed to notify admins about seller application:', err.message);
      }
    }

    res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That School ID is already registered for this university' });
    }
    console.error(err);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

router.post('/resend-verification', verificationEmailLimit, [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Enter a valid email address' });

  const genericResponse = {
    message: 'If this address needs verification, a confirmation email will be sent.',
  };
  try {
    const { rows } = await db.query(`
      SELECT id, email, full_name, email_verified, verification_email_sent_at
      FROM users
      WHERE email = $1 AND is_active = true
    `, [req.body.email]);
    const user = rows[0];
    if (!user || user.email_verified) return res.json(genericResponse);

    const sentAt = user.verification_email_sent_at && new Date(user.verification_email_sent_at).getTime();
    if (sentAt && Date.now() - sentAt < 60 * 1000) return res.json(genericResponse);

    getMailConfiguration();
    const { token, tokenHash } = createVerificationToken();
    await sendVerificationEmail({ email: user.email, fullName: user.full_name, token });
    await db.query(`
      UPDATE users
      SET email_verification_token_hash = $1,
          email_verification_expires_at = NOW() + ($2 * INTERVAL '1 hour'),
          verification_email_sent_at = NOW()
      WHERE id = $3 AND email_verified = false
    `, [tokenHash, TOKEN_TTL_HOURS, user.id]);
    res.json(genericResponse);
  } catch (err) {
    console.error('Verification email resend failed:', err.message);
    res.status(503).json({ error: 'Email delivery is temporarily unavailable. Try again later.' });
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
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Confirm your email address before logging in. You can request another verification email.' });
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
