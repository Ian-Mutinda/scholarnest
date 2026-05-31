const express = require('express');
const router = express.Router();
const db = require('../../config/db');
const { auth } = require('../middleware/auth');
const { initiateSTKPush, processCallback } = require('../services/mpesa');

// Initiate M-Pesa STK Push
router.post('/initiate', auth, async (req, res) => {
  const { phone, document_id, pass_id, purchase_type } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  if (!purchase_type) return res.status(400).json({ error: 'Purchase type required' });

  try {
    let amount;

    if (purchase_type === 'individual' && document_id) {
      const { rows } = await db.query(
        'SELECT price_individual, title FROM documents WHERE id = $1 AND status = $2',
        [document_id, 'approved']
      );
      if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
      if (!rows[0].price_individual) return res.status(400).json({ error: 'Document has no individual price' });
      amount = parseFloat(rows[0].price_individual);

    } else if (purchase_type === 'dept_pass' && pass_id) {
      const { rows } = await db.query(
        'SELECT price, name FROM department_passes WHERE id = $1 AND is_active = true',
        [pass_id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Pass not found' });
      amount = parseFloat(rows[0].price);

    } else {
      return res.status(400).json({ error: 'Invalid purchase parameters' });
    }

    const result = await initiateSTKPush({
      phone,
      amount,
      buyerId: req.user.id,
      documentId: document_id,
      passId: pass_id,
      purchaseType: purchase_type,
    });

    res.json({
      message: 'STK Push sent. Enter your M-Pesa PIN to complete payment.',
      requestId: result.requestId,
      checkoutRequestId: result.checkoutRequestId,
      customerMessage: result.customerMessage,
      amount,
    });
  } catch (err) {
    console.error('STK Push error:', err.message);
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});

// M-Pesa callback (called by Safaricom servers)
router.post('/mpesa/callback', async (req, res) => {
  // Always respond 200 immediately to Safaricom
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  // Process async
  processCallback(req.body).catch(err =>
    console.error('Callback processing error:', err.message)
  );
});

// Poll payment status (buyer polls this after STK push)
router.get('/status/:requestId', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT pr.status, pr.amount, ac.code, ac.expires_at
      FROM payment_requests pr
      LEFT JOIN purchases p ON p.buyer_id = pr.buyer_id
        AND p.mpesa_transaction_id IS NOT NULL
        AND p.created_at > pr.created_at - INTERVAL '1 minute'
      LEFT JOIN access_codes ac ON ac.id = p.access_code_id
      WHERE pr.id = $1 AND pr.buyer_id = $2
      ORDER BY p.created_at DESC
      LIMIT 1
    `, [req.params.requestId, req.user.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Request not found' });

    res.json({
      status: rows[0].status,
      amount: rows[0].amount,
      code: rows[0].code || null,
      expiresAt: rows[0].expires_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

// Get buyer's purchased codes
router.get('/my-codes', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ac.code, ac.code_type, ac.expires_at, ac.device_bound_at,
             ac.access_count, ac.is_active,
             d.title as document_title, d.course_code,
             dp.name as pass_name,
             un.short_name as university
      FROM access_codes ac
      LEFT JOIN documents d ON d.id = ac.document_id
      LEFT JOIN department_passes dp ON dp.id = ac.pass_id
      LEFT JOIN universities un ON un.id = COALESCE(d.university_id,
        (SELECT university_id FROM department_passes WHERE id = ac.pass_id))
      WHERE ac.buyer_id = $1
      ORDER BY ac.created_at DESC
    `, [req.user.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch codes' });
  }
});

// Validate a code (before purchase, check if it works for a document)
router.post('/validate-code', async (req, res) => {
  const { code, document_id } = req.body;
  const { extractFingerprint, validateAndBindCode } = require('../utils/accessCodes');
  const fingerprint = extractFingerprint(req);

  const result = await validateAndBindCode(code, fingerprint, document_id);
  if (!result.valid) return res.status(403).json({ error: result.reason });

  res.json({
    valid: true,
    firstBind: result.firstBind,
    documentId: result.record?.document_id,
    documentTitle: result.record?.title,
    totalPages: result.record?.total_pages,
    expiresAt: result.record?.expires_at,
  });
});

module.exports = router;
