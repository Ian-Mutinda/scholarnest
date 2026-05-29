const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const db = require('../../config/db');

const THUMBNAIL_DIR = process.env.THUMBNAIL_DIR || './public/thumbnails';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads/documents';

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
    execSync(
      `pdftoppm -jpeg -r 150 -f ${pageNumber} -l ${pageNumber} "${filePath}" "${outputBase}"`,
      { timeout: 30000 }
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
    const result = execSync(`pdfinfo "${filePath}" 2>/dev/null | grep Pages`, { timeout: 10000 }).toString();
    const match = result.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1]) : 1;
  } catch {
    return 1;
  }
}

// Process uploaded document
async function processDocument(documentId, filePath) {
  try {
    const pageCount = getPdfPageCount(filePath);

    await db.query('UPDATE documents SET total_pages = $1 WHERE id = $2', [pageCount, documentId]);

    // Generate preview (page 1 only)
    await convertPageToImage(filePath, 1, documentId);

    console.log(`✅ Document ${documentId} processed: ${pageCount} pages`);
    return { pageCount };
  } catch (err) {
    console.error(`Document processing failed for ${documentId}:`, err.message);
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

    // Create watermark SVG overlay
    const svg = `
      <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <style>text { font-family: Arial; font-size: 18px; fill: rgba(0,0,0,0.12); }</style>
        <g transform="rotate(-30, ${w/2}, ${h/2})">
          ${Array.from({ length: 6 }, (_, row) =>
            Array.from({ length: 3 }, (_, col) =>
              `<text x="${col * 280 - 100}" y="${row * 180 - 50}" transform="rotate(-15)">${watermarkText}</text>`
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
    return fs.readFileSync(imagePath);
  }
}

module.exports = { processDocument, getPageImage, addWatermark, getPdfPageCount };
