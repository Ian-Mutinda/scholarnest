const fs = require('fs');
const path = require('path');
const db = require('../../config/db');

// Simple text extraction from file (works for text-based content)
function extractTextFromBuffer(buffer, mimeType) {
  if (mimeType === 'text/plain') return buffer.toString('utf8');
  // For PDFs/DOCX we extract what we can as raw text (basic approach)
  return buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Jaccard similarity between two strings
function jaccardSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const shingle = (s, k = 5) => {
    const set = new Set();
    for (let i = 0; i <= s.length - k; i++) set.add(s.slice(i, i + k).toLowerCase());
    return set;
  };
  const s1 = shingle(str1);
  const s2 = shingle(str2);
  if (s1.size === 0 || s2.size === 0) return 0;
  const intersection = new Set([...s1].filter(x => s2.has(x)));
  const union = new Set([...s1, ...s2]);
  return intersection.size / union.size;
}

// Check new document against all existing approved docs
async function checkPlagiarism(newDocumentId, newFilePath) {
  try {
    const newBuffer = fs.readFileSync(newFilePath);
    const newText = extractTextFromBuffer(newBuffer);
    if (newText.length < 100) return { score: 0, matchedId: null };

    // Get all other approved docs in same department
    const { rows: docs } = await db.query(`
      SELECT d.id, d.file_path
      FROM documents d
      WHERE d.id != $1
        AND d.status = 'approved'
        AND d.is_active = true
      LIMIT 200
    `, [newDocumentId]);

    let highestScore = 0;
    let matchedDocId = null;

    for (const doc of docs) {
      try {
        if (!fs.existsSync(doc.file_path)) continue;
        const existingBuffer = fs.readFileSync(doc.file_path);
        const existingText = extractTextFromBuffer(existingBuffer);
        if (existingText.length < 100) continue;

        const score = jaccardSimilarity(newText.slice(0, 5000), existingText.slice(0, 5000));
        if (score > highestScore) {
          highestScore = score;
          matchedDocId = doc.id;
        }
      } catch {}
    }

    const percentScore = Math.round(highestScore * 100);

    // Log result
    await db.query(`
      INSERT INTO plagiarism_checks (document_id, similarity_score, matched_document_id)
      VALUES ($1, $2, $3)
    `, [newDocumentId, percentScore, matchedDocId]);

    // Update document
    await db.query(`
      UPDATE documents SET plagiarism_score = $1, duplicate_of = $2 WHERE id = $3
    `, [percentScore, matchedDocId, newDocumentId]);

    return { score: percentScore, matchedId: matchedDocId };
  } catch (err) {
    console.error('Plagiarism check error:', err.message);
    return { score: 0, matchedId: null };
  }
}

// Determine if document should be auto-rejected based on plagiarism
function shouldAutoReject(plagiarismScore) {
  return plagiarismScore >= 80;
}

module.exports = { checkPlagiarism, shouldAutoReject };
