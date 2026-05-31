require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// ─── Security & middleware ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      styleSrcElem: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      scriptSrcElem: ["'self'", 'https://unpkg.com'],
      connectSrc: ["'self'"],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.BASE_URL
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate limiting ──────────────────────────────────────────────────────────
const generalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts. Try again later.' } });
const paymentLimit = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many payment requests. Wait a minute.' } });
const pageViewLimit = rateLimit({ windowMs: 60 * 1000, max: 120 });

app.use(generalLimit);
app.use('/api/auth', authLimit);
app.use('/api/payments/initiate', paymentLimit);
app.use('/api/documents/:id/page', pageViewLimit);

// ─── Static files ───────────────────────────────────────────────────────────
// Note: documents are NOT served as static files — only via the secure page route
app.use('/static', express.static(path.join(__dirname, '../public/static')));

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/seller', require('./routes/seller'));
app.use('/api/admin', require('./routes/admin'));

// Universities & departments (public)
app.get('/api/universities', async (req, res) => {
  const db = require('../config/db');
  const { rows } = await db.query('SELECT * FROM universities WHERE is_active = true ORDER BY name');
  res.json(rows);
});

app.get('/api/universities/:id/departments', async (req, res) => {
  const db = require('../config/db');
  const { rows } = await db.query(
    'SELECT * FROM departments WHERE university_id = $1 AND is_active = true ORDER BY name',
    [req.params.id]
  );
  res.json(rows);
});

app.get('/api/universities/:id/passes', async (req, res) => {
  const db = require('../config/db');
  const { rows } = await db.query(
    'SELECT * FROM department_passes WHERE university_id = $1 AND is_active = true ORDER BY price',
    [req.params.id]
  );
  res.json(rows);
});

// Notifications
app.get('/api/notifications', require('./middleware/auth').auth, async (req, res) => {
  const db = require('../config/db');
  const { rows } = await db.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.user.id]
  );
  res.json(rows);
});

app.put('/api/notifications/:id/read', require('./middleware/auth').auth, async (req, res) => {
  const db = require('../config/db');
  await db.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ─── Serve frontend for all other routes ───────────────────────────────────
const frontendPath = path.join(__dirname, '../public');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  res.status(500).json({ error: 'Something went wrong' });
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 ScholarNest running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Admin: ${process.env.ADMIN_EMAIL}\n`);

  // Start cron jobs
  require('./services/cron');
});

module.exports = app;
