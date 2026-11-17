const { createHmac, randomBytes, timingSafeEqual } = require('crypto');

function createWatermarkCode() {
  return `SN-${randomBytes(10).toString('hex').toUpperCase()}`;
}

function createWatermarkSignature(watermarkCode, documentId, pageNumber) {
  const secret = process.env.WATERMARK_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('WATERMARK_SECRET or JWT_SECRET must be configured');

  return createHmac('sha256', secret)
    .update(`v1\n${watermarkCode}\n${documentId}\n${pageNumber}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
}

function createWatermarkLabel(watermarkCode, documentId, pageNumber) {
  return `${watermarkCode} | V-${createWatermarkSignature(watermarkCode, documentId, pageNumber)}`;
}

function verifyWatermarkSignature(watermarkCode, documentId, pageNumber, signature) {
  if (!/^[A-F0-9]{24}$/i.test(signature || '')) return false;
  const expected = Buffer.from(
    createWatermarkSignature(watermarkCode, documentId, pageNumber),
    'hex'
  );
  const supplied = Buffer.from(signature, 'hex');
  return timingSafeEqual(expected, supplied);
}

module.exports = {
  createWatermarkCode,
  createWatermarkLabel,
  createWatermarkSignature,
  verifyWatermarkSignature,
};
