const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');

// Generate a readable code like SN24-K9TW-7VX2
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SN${segment(2)}-${segment(4)}-${segment(4)}`;
}

// Generate device fingerprint from request headers
function extractFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  const ip = req.ip || req.connection?.remoteAddress || '';
  // Combine identifiers into a fingerprint hash
  const raw = `${ua}|${lang}|${ip}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
}

// Expiry: 7 days from now
function getExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

// Create one or more codes for a purchase
async function createCodesForPurchase({ buyerId, documentId, passId, codeType, count = 1 }) {
  const codes = [];
  const expiry = getExpiry();

  for (let i = 0; i < count; i++) {
    let code;
    let attempts = 0;
    // Ensure uniqueness
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) throw new Error('Failed to generate unique code');
      const existing = await db.query('SELECT id FROM access_codes WHERE code = $1', [code]);
      if (existing.rows.length === 0) break;
    } while (true);

    const { rows } = await db.query(`
      INSERT INTO access_codes (code, buyer_id, document_id, pass_id, code_type, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [code, buyerId, documentId || null, passId || null, codeType, expiry]);

    codes.push(rows[0]);
  }

  return codes;
}

// Validate and bind a code to a device
async function validateAndBindCode(code, fingerprint, documentId) {
  const { rows } = await db.query(`
    SELECT ac.*, d.title, d.file_path, d.total_pages, d.seller_id
    FROM access_codes ac
    LEFT JOIN documents d ON d.id = ac.document_id
    WHERE ac.code = $1 AND ac.is_active = true
  `, [code]);

  if (!rows[0]) return { valid: false, reason: 'Code not found' };
  const record = rows[0];

  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, reason: 'Code has expired' };
  }

  // Check document match if specified
  if (documentId && record.document_id && record.document_id !== parseInt(documentId)) {
    return { valid: false, reason: 'Code not valid for this document' };
  }

  // First use — bind to device
  if (!record.device_fingerprint) {
    await db.query(`
      UPDATE access_codes
      SET device_fingerprint = $1, device_bound_at = NOW(), last_accessed = NOW(), access_count = access_count + 1
      WHERE id = $2
    `, [fingerprint, record.id]);
    return { valid: true, firstBind: true, record };
  }

  // Subsequent use — verify device
  if (record.device_fingerprint !== fingerprint) {
    return { valid: false, reason: 'This code is bound to a different device' };
  }

  await db.query(`
    UPDATE access_codes SET last_accessed = NOW(), access_count = access_count + 1 WHERE id = $1
  `, [record.id]);

  return { valid: true, firstBind: false, record };
}

module.exports = { generateCode, extractFingerprint, createCodesForPurchase, validateAndBindCode };
