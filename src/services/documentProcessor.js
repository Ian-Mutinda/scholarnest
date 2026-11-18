const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const db = require('../../config/db');
const { scanPdfForPrivacy } = require('./privacyScanner');

const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || path.resolve(__dirname, '../../storage/thumbnails');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../storage/documents');

// Ensure dirs exist
[THUMBNAIL_DIR, UPLOAD_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Convert PDF page to image using pdftoppm (poppler-utils)
async function convertPageToImage(filePath, pageNumber, documentId) {
  const outputDir = path.join(THUMBNAIL_DIR, String(documentId));
  fs.mkdirSync(outputDir, { recursive: true });

  const outputBase = path.join(outputDir, `page_${pageNumber}`);
  const outputFile = `${outputBase}-1.jpg`;

  try {
    // pdftoppm is installed via poppler-utils (apt-get install poppler-utils)
    execFileSync(
      'pdftoppm',
      ['-jpeg', '-r', '150', '-f', String(pageNumber), '-l', String(pageNumber), filePath, outputBase],
      { timeout: 30000, windowsHide: true }
    );

    if (fs.existsSync(outputFile)) {
      return outputFile;
    }
    // Try alternate naming
    const files = fs.readdirSync(outputDir).filter(f => f.startsWith(`page_${pageNumber}`));
    return files.length ? path.join(outputDir, files[0]) : null;
  } catch (err) {
    console.error(`Page conversion error (page ${pageNumber}):`, err.message);
    return null;
  }
}

// Get total page count
function getPdfPageCount(filePath) {
  try {
    const result = execFileSync('pdfinfo', [filePath], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    const match = result.match(/^Pages:\s+(\d+)/m);
    if (!match) throw new Error('Page count missing from pdfinfo output');
    const pageCount = parseInt(match[1], 10);
    if (pageCount < 1) throw new Error('Invalid PDF page count');
    return pageCount;
  } catch (err) {
    throw new Error(`Unable to determine PDF page count: ${err.message}`);
  }
}

// Process uploaded document
async function processDocument(documentId, filePath) {
  try {
    const pageCount = getPdfPageCount(filePath);

    await db.query('UPDATE documents SET total_pages = $1 WHERE id = $2', [pageCount, documentId]);

    // Generate preview (page 1 only)
    await convertPageToImage(filePath, 1, documentId);

    const privacyScan = await scanPdfForPrivacy(filePath, pageCount);
    await db.query(
      `UPDATE documents
       SET privacy_scan_status = $1,
           privacy_scan_findings = $2::jsonb,
           privacy_scan_at = NOW(),
           privacy_reviewed = ($1::varchar = 'clear')
       WHERE id = $3`,
      [privacyScan.status, JSON.stringify(privacyScan.findings), documentId]
    );

    console.log(`✅ Document ${documentId} processed: ${pageCount} pages; privacy scan ${privacyScan.status}`);
    return { pageCount, privacyScan };
  } catch (err) {
    console.error(`Document processing failed for ${documentId}:`, err.message);
    await db.query(
      `UPDATE documents
       SET privacy_scan_status = 'scan_failed',
           privacy_scan_findings = $1::jsonb,
           privacy_scan_at = NOW(),
           privacy_reviewed = false
       WHERE id = $2`,
      [JSON.stringify([{ type: 'document_processing_failed', page: null }]), documentId]
    );
    await db.query(`
      INSERT INTO notifications (user_id, type, title, message, target_page, target_param)
      SELECT id, 'document_review_failed', 'Document needs manual review', $1, 'admin', $2
      FROM users WHERE role = 'admin' LIMIT 1
    `, [`Document #${documentId} could not be fully processed and must be reviewed or rejected.`, `documents/${documentId}`]);
    throw err;
  }
}

// Stream a specific page as image (for the viewer)
async function getPageImage(documentId, pageNumber) {
  const outputDir = path.join(THUMBNAIL_DIR, String(documentId));
  const possibleFiles = [
    path.join(outputDir, `page_${pageNumber}-1.jpg`),
    path.join(outputDir, `page_${pageNumber}.jpg`),
    path.join(outputDir, `page_${String(pageNumber).padStart(2, '0')}.jpg`),
  ];

  // Return cached version if exists
  for (const f of possibleFiles) {
    if (fs.existsSync(f)) return f;
  }

  // Generate on demand
  const { rows } = await db.query('SELECT file_path FROM documents WHERE id = $1', [documentId]);
  if (!rows[0]) return null;

  return await convertPageToImage(rows[0].file_path, pageNumber, documentId);
}

// Add dynamic watermark text to image
async function addWatermark(imagePath, watermarkText) {
  try {
    const sharp = require('sharp');
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const w = metadata.width || 800;
    const h = metadata.height || 1000;
    const escapedText = String(watermarkText).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    })[character]);

    const svg = `
      <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <style>text { font-family: Arial; font-size: 18px; font-weight: 700; fill: rgba(0,0,0,0.34); stroke: rgba(255,255,255,0.42); stroke-width: 1px; paint-order: stroke; }</style>
        <g transform="rotate(-30, ${w/2}, ${h/2})">
          ${Array.from({ length: Math.ceil(h / 220) + 2 }, (_, row) =>
            Array.from({ length: Math.ceil(w / 360) + 2 }, (_, col) =>
              `<text x="${col * 360 - 200}" y="${row * 220 - 50}">${escapedText}</text>`
            ).join('')
          ).join('')}
        </g>
      </svg>
    `;

    const watermarkedBuffer = await image
      .composite([{ input: Buffer.from(svg), blend: 'over' }])
      .jpeg({ quality: 85 })
      .toBuffer();

    return watermarkedBuffer;
  } catch (err) {
    console.error('Watermark error:', err.message);
    throw err;
  }
}

module.exports = { processDocument, getPageImage, addWatermark, getPdfPageCount };
