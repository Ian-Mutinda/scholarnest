const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { auth, requireSeller } = require('../middleware/auth');

// Seller dashboard summary
router.get('/dashboard', auth, requireSeller, async (req, res) => {
  try {
    const [earnings, docs, ratings, recentSales] = await Promise.all([
      db.query(`
        SELECT total_earnings, pending_earnings FROM users WHERE id = $1
      `, [req.user.id]),
      db.query(`
        SELECT status, COUNT(*) as count FROM documents
        WHERE seller_id = $1 GROUP BY status
      `, [req.user.id]),
      db.query(`
        SELECT AVG(stars) as avg, COUNT(*) as total
        FROM ratings WHERE seller_id = $1
      `, [req.user.id]),
      db.query(`
        SELECT p.amount_paid, p.seller_amount, p.payout_status, p.created_at,
               d.title as document_title
        FROM purchases p
        JOIN documents d ON d.id = p.document_id
        WHERE d.seller_id = $1 AND p.payment_status = 'completed'
        ORDER BY p.created_at DESC LIMIT 10
      `, [req.user.id]),
    ]);

    const docStats = {};
    docs.rows.forEach(r => docStats[r.status] = parseInt(r.count));

    res.json({
      earnings: {
        total: parseFloat(earnings.rows[0]?.total_earnings) || 0,
        pending: parseFloat(earnings.rows[0]?.pending_earnings) || 0,
      },
      documents: {
        approved: docStats.approved || 0,
        pending: docStats.pending || 0,
        rejected: docStats.rejected || 0,
      },
      ratings: {
        average: parseFloat(ratings.rows[0]?.avg) || 0,
        total: parseInt(ratings.rows[0]?.total) || 0,
      },
      recentSales: recentSales.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Dashboard load failed' });
  }
});

// Seller's own documents
router.get('/documents', auth, requireSeller, async (req, res) => {
  const { rows } = await db.query(`
    SELECT d.id, d.title, d.course_code, d.status, d.plagiarism_score,
           d.rejection_reason, d.total_purchases, d.avg_rating,
           d.total_views, d.price_individual, d.created_at
    FROM documents d
    WHERE d.seller_id = $1
    ORDER BY d.created_at DESC
  `, [req.user.id]);
  res.json(rows);
});

// Engagement breakdown (for dept pass earnings transparency)
router.get('/engagement/:documentId', auth, requireSeller, async (req, res) => {
  const { rows } = await db.query(`
    SELECT event_type, COUNT(*) as count, SUM(points) as total_points,
           DATE_TRUNC('day', created_at) as day
    FROM engagement_events
    WHERE seller_id = $1 AND document_id = $2
    GROUP BY event_type, day
    ORDER BY day DESC
  `, [req.user.id, req.params.documentId]);
  res.json(rows);
});

// Payout history
router.get('/payouts', auth, requireSeller, async (req, res) => {
  const { rows } = await db.query(`
    SELECT id, amount, status, mpesa_phone, created_at, completed_at
    FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC
  `, [req.user.id]);
  res.json(rows);
});

// Update seller profile
router.put('/profile', auth, requireSeller, async (req, res) => {
  const { seller_bio, phone } = req.body;
  await db.query(
    'UPDATE users SET seller_bio = $1, phone = $2 WHERE id = $3',
    [seller_bio, phone, req.user.id]
  );
  res.json({ message: 'Profile updated' });
});

module.exports = router;
