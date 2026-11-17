require('dotenv').config();
const db = require('../config/db');
const { getPdfPageCount } = require('../src/services/documentProcessor');
const { scanPdfForPrivacy } = require('../src/services/privacyScanner');

async function scanExistingDocuments() {
  const { rows: documents } = await db.query(
    `SELECT id, file_path FROM documents
     WHERE privacy_scan_at IS NULL OR privacy_scan_status = 'scan_failed'
     ORDER BY id`
  );

  for (const document of documents) {
    try {
      const pageCount = getPdfPageCount(document.file_path);
      const scan = await scanPdfForPrivacy(document.file_path, pageCount);
      await db.query(
        `UPDATE documents
         SET total_pages = $1,
             privacy_scan_status = $2,
             privacy_scan_findings = $3::jsonb,
             privacy_scan_at = NOW(),
             privacy_reviewed = ($2::varchar = 'clear'),
             status = CASE
               WHEN status = 'approved' AND $2::varchar <> 'clear' THEN 'flagged'
               WHEN status = 'flagged' AND $2::varchar = 'clear' THEN 'approved'
               ELSE status
             END
         WHERE id = $4`,
        [pageCount, scan.status, JSON.stringify(scan.findings), document.id]
      );
      console.log(`Document ${document.id}: ${scan.status} (${scan.findings.length} findings)`);
    } catch (err) {
      await db.query(
        `UPDATE documents
         SET privacy_scan_status = 'scan_failed',
             privacy_scan_findings = $1::jsonb,
             privacy_scan_at = NOW(),
             privacy_reviewed = false,
             status = CASE WHEN status = 'approved' THEN 'flagged' ELSE status END
         WHERE id = $2`,
        [JSON.stringify([{ type: 'document_processing_failed', page: null }]), document.id]
      );
      console.error(`Document ${document.id}: scan failed (${err.message})`);
    }
  }

  console.log(`Privacy scan completed for ${documents.length} existing document(s).`);
}

scanExistingDocuments()
  .catch(err => {
    console.error('Existing document privacy scan failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
