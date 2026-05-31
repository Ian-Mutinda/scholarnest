const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../../config/db');
const { auth, requireSeller, optionalAuth } = require('../middleware/auth');
const { processDocument, getPageImage, addWatermark } = require('../services/documentProcessor');
const { checkPlagiarism, shouldAutoReject } = require('../services/plagiarism');
const { validateAndBindCode, extractFingerprint } = require('../utils/accessCodes');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads/documents';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `doc_${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.pptx'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and PPTX files are allowed'));
    }
  },
});

// List documents (marketplace)
router.get('/', optionalAuth, async (req, res) => {
  const { university_id, department_id, search, doc_type, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let where = `d.status = 'approved' AND d.is_active = true`;
    const params = [];

    if (university_id) { params.push(university_id); where += ` AND d.university_id = $${params.length}`; }
    if (department_id) { params.push(department_id); where += ` AND d.department_id = $${params.length}`; }
    if (doc_type) { params.push(doc_type); where += ` AND d.doc_type = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (d.title ILIKE $${params.length} OR d.course_code ILIKE $${params.length} OR d.description ILIKE $${params.length})`;
    }

    params.push(parseInt(limit), offset);
    const { rows } = await db.query(`
      SELECT d.id, d.title, d.course_code, d.doc_type, d.price_individual,
             d.total_pages, d.avg_rating, d.total_ratings, d.total_purchases,
             d.is_premium, d.created_at,
             u.full_name as seller_name, u.trust_score as seller_trust,
             un.short_name as university_short,
             dep.name as department_name
      FROM documents d
      JOIN users u ON u.id = d.seller_id
      JOIN universities un ON un.id = d.university_id
      JOIN departments dep ON dep.id = d.department_id
      WHERE ${where}
      ORDER BY d.total_purchases DESC, d.avg_rating DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ documents: rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get single document (public info + preview)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT d.*, u.full_name as seller_name, u.trust_score,
             u.avatar_url as seller_avatar,
             un.name as university_name, un.short_name,
             dep.name as department_name
      FROM documents d
      JOIN users u ON u.id = d.seller_id
      JOIN universities un ON un.id = d.university_id
      JOIN departments dep ON dep.id = d.department_id
      WHERE d.id = $1 AND d.status = 'approved' AND d.is_active = true
    `, [req.params.id]);

    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

    // Don't expose file path to public
    const { file_path, ...doc } = rows[0];
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Preview page (page 1, no auth needed, no watermark)
router.get('/:id/preview', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, total_pages FROM documents WHERE id = $1 AND status = $2',
      [req.params.id, 'approved']
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const imagePath = await getPageImage(req.params.id, 1);
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Preview not available' });
    }

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex',
    });
    res.sendFile(path.resolve(imagePath));
  } catch (err) {
    res.status(500).json({ error: 'Preview failed' });
  }
});

// Serve a document page (requires valid access code)
router.get('/:id/page/:pageNum', async (req, res) => {
  const { id, pageNum } = req.params;
  const { code } = req.query;

  // Admins bypass access code check
const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
if (token) {
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query(
      'SELECT u.role, d.seller_id FROM users u, documents d WHERE u.id = $1 AND d.id = $2',
      [decoded.id, id]
    );
    const isAdmin = rows[0]?.role === 'admin';
    const isOwnDocument = rows[0]?.seller_id === decoded.id;

    if (isAdmin || isOwnDocument) {
      const pageNumber = parseInt(pageNum);
      const { rows: docRows } = await db.query(
        'SELECT file_path, total_pages FROM documents WHERE id = $1', [id]
      );
      if (!docRows[0]) return res.status(404).json({ error: 'Document not found' });
      const imagePath = await getPageImage(id, pageNumber);
      if (!imagePath || !fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'Page not available' });
      }
      const label = isAdmin ? 'ADMIN PREVIEW' : 'SELLER PREVIEW';
      const watermarkedBuffer = await addWatermark(imagePath, label);
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.send(watermarkedBuffer);
    }
  } catch {}
}

  if (!code) return res.status(401).json({ error: 'Access code required' });

  const fingerprint = extractFingerprint(req);
  const { valid, reason, record } = await validateAndBindCode(code, fingerprint, id);

  if (!valid) return res.status(403).json({ error: reason });

  try {
    const { rows } = await db.query(
      'SELECT id, total_pages, seller_id FROM documents WHERE id = $1',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });

    const pageNumber = parseInt(pageNum);
    if (pageNumber < 1 || pageNumber > rows[0].total_pages) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    const imagePath = await getPageImage(id, pageNumber);
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Page not available' });
    }

    // Get buyer info for watermark
    const { rows: buyerRows } = await db.query(
      'SELECT email FROM users WHERE id = $1', [record.buyer_id]
    );
    const watermarkText = buyerRows[0]?.email || code;

    const watermarkedBuffer = await addWatermark(imagePath, watermarkText);

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex',
      'Content-Disposition': 'inline',
    });
    res.send(watermarkedBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Page load failed' });
  }
});

// Upload new document (sellers only)
router.post('/', auth, requireSeller, upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

 const { title, description, course_code, year, department_id, doc_type, price_individual, lecturer_name, semester } = req.body;
  try {
    // Get seller's university
    const { rows: userRows } = await db.query(
      'SELECT university_id FROM users WHERE id = $1', [req.user.id]
    );
    const universityId = userRows[0]?.university_id;

    const { rows } = await db.query(`
      INSERT INTO documents
        (seller_id, university_id, department_id, title, description,
       course_code, year, file_path, doc_type, price_individual, file_size_bytes, lecturer_name, semester)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      req.user.id, universityId, department_id, title, description,
      course_code, year, req.file.path, doc_type || 'notes',
      price_individual || null, req.file.size, lecturer_name || null, semester || null,
    ]);

    const docId = rows[0].id;

    // Process async: extract pages, run plagiarism check
    processDocument(docId, req.file.path).then(async () => {
      const { score, matchedId } = await checkPlagiarism(docId, req.file.path);
      if (shouldAutoReject(score)) {
        await db.query(
          `UPDATE documents SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
          [`High similarity detected (${score}%) with document #${matchedId}`, docId]
        );
        await db.query(`
          INSERT INTO notifications (user_id, type, title, message)
          VALUES ($1, 'document_rejected', 'Document rejected', $2)
        `, [req.user.id, `"${title}" was rejected due to high similarity with existing content (${score}%).`]);
      } else {
        // Notify admin to review
        await db.query(`
          INSERT INTO notifications (user_id, type, title, message)
          SELECT id, 'new_document_review', 'New document for review', $1
          FROM users WHERE role = 'admin' LIMIT 1
        `, [`New document "${title}" submitted for review. Plagiarism score: ${score}%`]);
      }
    }).catch(err => console.error('Async processing error:', err));

    res.status(201).json({
      id: docId,
      message: 'Document uploaded and pending review. We\'ll notify you once approved.',
    });
  } catch (err) {
    // Clean up uploaded file on error
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Record engagement event (for dept pass revenue distribution)
router.post('/:id/engage', auth, async (req, res) => {
  const { event_type, session_id, code } = req.body;

  try {
    const { rows: weightRows } = await db.query(
      'SELECT points FROM engagement_weights WHERE event_type = $1', [event_type]
    );
    if (!weightRows[0]) return res.status(400).json({ error: 'Invalid event type' });

    const { rows: codeRows } = await db.query(
      'SELECT id FROM access_codes WHERE code = $1 AND buyer_id = $2',
      [code, req.user.id]
    );
    if (!codeRows[0]) return res.status(403).json({ error: 'Invalid code' });

    const { rows: docRows } = await db.query(
      'SELECT seller_id FROM documents WHERE id = $1', [req.params.id]
    );
    if (!docRows[0]) return res.status(404).json({ error: 'Document not found' });

    await db.query(`
      INSERT INTO engagement_events (access_code_id, document_id, seller_id, event_type, points, session_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [codeRows[0].id, req.params.id, docRows[0].seller_id, event_type, weightRows[0].points, session_id]);

    // Update document engagement total
    await db.query(
      'UPDATE documents SET engagement_points_total = engagement_points_total + $1 WHERE id = $2',
      [weightRows[0].points, req.params.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record engagement' });
  }
});

module.exports = router;
