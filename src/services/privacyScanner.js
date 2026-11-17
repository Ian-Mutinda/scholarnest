const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const MAX_EXTRACTED_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_SCAN_PAGES = 1000;
const PHONE_REGEX = /(?<!\d)(?:\+?254[\s().-]?|0)(?:7|1)(?:[\s().-]?\d){8}(?!\d)/i;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LABELED_IDENTIFIER_REGEX = /\b(?:national\s+id|id\s*(?:no|number)|passport(?:\s*(?:no|number))?|student\s*(?:id|number)|admission\s*(?:no|number)|registration\s*(?:no|number)|reg\s*(?:no|number)|date\s+of\s+birth|dob|medical\s+record)\b\s*[:#-]?\s*\S+/i;
const LABELED_NAME_REGEX = /\b(?:full\s+name|student\s+name|patient\s+name|name)\s*[:#-]\s*[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,3}/iu;
const LABELED_PHONE_REGEX = /\b(?:phone|mobile|telephone|contact)\s*(?:number|no\.?)?\s*[:#-]\s*\+?[\d\s().-]{7,}/i;
const CARD_NUMBER_REGEX = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

function passesLuhn(number) {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function detectSensitiveContent(pageText) {
  const findings = [];
  if (EMAIL_REGEX.test(pageText)) findings.push('email_address');
  if (PHONE_REGEX.test(pageText) || LABELED_PHONE_REGEX.test(pageText)) findings.push('phone_number');
  if (LABELED_IDENTIFIER_REGEX.test(pageText)) findings.push('labeled_identifier');
  if (LABELED_NAME_REGEX.test(pageText)) findings.push('labeled_personal_name');

  const cardNumbers = pageText.match(CARD_NUMBER_REGEX) || [];
  if (cardNumbers.some(passesLuhn)) findings.push('possible_payment_card');
  return findings;
}

async function scanPdfForPrivacy(filePath, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return {
      status: 'scan_failed',
      findings: [{ type: 'page_count_unavailable', page: null }],
    };
  }
  if (pageCount > MAX_SCAN_PAGES) {
    return {
      status: 'scan_failed',
      findings: [{ type: 'document_too_many_pages', page: null }],
    };
  }

  let extractedText;
  try {
    const result = await execFileAsync(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', filePath, '-'],
      {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: MAX_EXTRACTED_TEXT_BYTES,
        windowsHide: true,
      }
    );
    extractedText = result.stdout;
  } catch (err) {
    console.error('Privacy text extraction failed:', err.message);
    return {
      status: 'scan_failed',
      findings: [{ type: 'text_extraction_failed', page: null }],
    };
  }

  const pages = extractedText.split('\f');
  while (pages.length > pageCount && !pages[pages.length - 1].trim()) pages.pop();

  const findings = [];
  for (let index = 0; index < pageCount; index++) {
    const page = index + 1;
    const pageText = pages[index] || '';
    const compactText = pageText.replace(/\s/g, '');
    if (compactText.length < 8) findings.push({ type: 'page_not_text_searchable', page });

    for (const type of detectSensitiveContent(pageText)) {
      findings.push({ type, page });
    }
  }

  return {
    status: findings.length ? 'review_required' : 'clear',
    findings,
  };
}

module.exports = { scanPdfForPrivacy, detectSensitiveContent };
