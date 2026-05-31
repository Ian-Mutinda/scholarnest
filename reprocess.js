require('dotenv').config();
const { processDocument } = require('./src/services/documentProcessor');
const db = require('./config/db');

async function reprocess() {
  const { rows } = await db.query('SELECT id, file_path FROM documents');
  for (const doc of rows) {
    console.log(`Processing document ${doc.id}: ${doc.file_path}`);
    try {
      await processDocument(doc.id, doc.file_path);
      console.log(`✅ Document ${doc.id} done`);
    } catch (err) {
      console.error(`❌ Document ${doc.id} failed:`, err.message);
    }
  }
  await db.pool.end();
}

reprocess();