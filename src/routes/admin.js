const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { auth, requireRole } = require('../middleware/auth');

// All admin routes require admin role
router.use(auth, requireRole('admin'));

// ─── Dashboard stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [users, docs, purchases, revenue, pendingDocs, pendingSellers] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users WHERE role != $1', ['admin']),
      db.query('SELECT COUNT(*) FROM documents WHERE status = $1', ['approved']),
      db.query('SELECT COUNT(*) FROM purchases WHERE payment_status = $1', ['completed']),
      db.query('SELECT SUM(platform_cut) as total FROM purchases WHERE payment_status = $1', ['completed']),
      db.query('SELECT COUNT(*) FROM documents WHERE status = $1', ['pending']),
      db.query('SELECT COUNT(*) FROM users WHERE seller_status = $1', ['pending']),
    ]);

    res.json({
      totalUsers: parseInt(users.rows[0].count),
      approvedDocuments: parseInt(docs.rows[0].count),
      totalPurchases: parseInt(purchases.rows[0].count),
      platformRevenue: parseFloat(revenue.rows[0].total) || 0,
      pendingDocuments: parseInt(pendingDocs.rows[0].count),
      pendingSellers: parseInt(pendingSellers.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Stats failed' });
  }
});

// ─── Seller management ─────────────────────────────────────────────────────
router.get('/sellers/pending', async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.id, u.email, u.full_name, u.phone, u.seller_bio, u.created_at,
           un.name as university_name
    FROM users u
    LEFT JOIN universities un ON un.id = u.university_id
    WHERE u.seller_status = 'pending'
    ORDER BY u.created_at ASC
  `);
  res.json(rows);
});

router.post('/sellers/:id/approve', async (req, res) => {
  await db.query(
    `UPDATE users SET seller_status = 'approved', role = 'seller' WHERE id = $1`,
    [req.params.id]
  );
  await db.query(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES ($1, 'seller_approved', 'Seller application approved!',
      'Congratulations! Your seller account is now active. You can start uploading notes.')
  `, [req.params.id]);
  await db.query('INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES ($1, $2, $3, $4)',
    [req.user.id, 'approve_seller', 'user', req.params.id]);
  res.json({ message: 'Seller approved' });
});

router.post('/sellers/:id/reject', async (req, res) => {
  const { reason } = req.body;
  await db.query(
    `UPDATE users SET seller_status = 'suspended' WHERE id = $1`, [req.params.id]
  );
  await db.query(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES ($1, 'seller_rejected', 'Seller application update', $2)
  `, [req.params.id, reason || 'Your seller application was not approved at this time.']);
  res.json({ message: 'Seller rejected' });
});

// ─── Document review ────────────────────────────────────────────────────────
router.get('/documents/pending', async (req, res) => {
  const { rows } = await db.query(`
    SELECT d.id, d.title, d.course_code, d.doc_type, d.plagiarism_score,
           d.file_size_bytes, d.total_pages, d.created_at,
           u.full_name as seller_name, u.email as seller_email,
           un.short_name, dep.name as department
    FROM documents d
    JOIN users u ON u.id = d.seller_id
    JOIN universities un ON un.id = d.university_id
    JOIN departments dep ON dep.id = d.department_id
    WHERE d.status = 'pending'
    ORDER BY d.created_at ASC
  `);
  res.json(rows);
});

router.post('/documents/:id/approve', async (req, res) => {
  const { rows } = await db.query(
    `UPDATE documents SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING seller_id, title`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

  await db.query(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES ($1, 'document_approved', 'Document approved!', $2)
  `, [rows[0].seller_id, `"${rows[0].title}" is now live on the marketplace.`]);

  await db.query('INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES ($1, $2, $3, $4)',
    [req.user.id, 'approve_document', 'document', req.params.id]);

  res.json({ message: 'Document approved and live' });
});

router.post('/documents/:id/reject', async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });

  const { rows } = await db.query(`
    UPDATE documents SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
    WHERE id = $2 RETURNING seller_id, title
  `, [reason, req.params.id]);

  await db.query(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES ($1, 'document_rejected', 'Document not approved', $2)
  `, [rows[0].seller_id, `"${rows[0].title}" was rejected: ${reason}`]);

  res.json({ message: 'Document rejected' });
});

// ─── Payout management ──────────────────────────────────────────────────────
router.get('/payouts/pending', async (req, res) => {
  const { rows } = await db.query(`
    SELECT p.id, p.buyer_id, p.seller_amount, p.payout_at,
           u.full_name as seller_name, u.phone as seller_phone,
           d.title as document_title
    FROM purchases p
    JOIN documents d ON d.id = p.document_id
    JOIN users u ON u.id = d.seller_id
    WHERE p.payout_status = 'scheduled'
      AND p.payout_at <= NOW()
      AND p.payment_status = 'completed'
    ORDER BY p.payout_at ASC
  `);
  res.json(rows);
});

router.post('/payouts/process/:purchaseId', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT p.*, u.phone as seller_phone, u.id as seller_id
      FROM purchases p
      JOIN documents d ON d.id = p.document_id
      JOIN users u ON u.id = d.seller_id
      WHERE p.id = $1 AND p.payout_status = 'scheduled'
    `, [req.params.purchaseId]);

    if (!rows[0]) return res.status(404).json({ error: 'Purchase not found or already paid' });
    const purchase = rows[0];

    // In production: trigger M-Pesa B2C payout here
    // For now, mark as paid manually
    await client.query(
      `UPDATE purchases SET payout_status = 'paid' WHERE id = $1`, [purchase.id]
    );
    await client.query(`
      UPDATE users
      SET total_earnings = total_earnings + $1,
          pending_earnings = GREATEST(0, pending_earnings - $1)
      WHERE id = $2
    `, [purchase.seller_amount, purchase.seller_id]);

    await client.query(`
      INSERT INTO payouts (seller_id, amount, mpesa_phone, status, purchases_included)
      VALUES ($1, $2, $3, 'completed', ARRAY[$4])
    `, [purchase.seller_id, purchase.seller_amount, purchase.seller_phone, purchase.id]);

    await client.query('COMMIT');
    res.json({ message: `KSh ${purchase.seller_amount} payout processed` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Payout failed' });
  } finally {
    client.release();
  }
});

// ─── Platform universities & departments ────────────────────────────────────
router.get('/universities', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM universities ORDER BY name');
  res.json(rows);
});

router.post('/universities', async (req, res) => {
  const { name, slug, short_name, domain } = req.body;
  const { rows } = await db.query(
    'INSERT INTO universities (name, slug, short_name, domain) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, slug, short_name, domain]
  );
  res.status(201).json(rows[0]);
});

router.post('/departments', async (req, res) => {
  const { university_id, name, slug } = req.body;
  const { rows } = await db.query(
    'INSERT INTO departments (university_id, name, slug) VALUES ($1, $2, $3) RETURNING *',
    [university_id, name, slug]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
