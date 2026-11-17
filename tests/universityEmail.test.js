const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { matchesUniversityEmail } = require('../src/utils/universityEmail');
const { createVerificationToken } = require('../src/services/emailVerification');

test('matches the exact official university domain case-insensitively', () => {
  assert.equal(matchesUniversityEmail('student@students.ku.ac.ke', 'students.ku.ac.ke'), true);
  assert.equal(matchesUniversityEmail('student@STUDENTS.KU.AC.KE', 'students.ku.ac.ke'), true);
  assert.equal(matchesUniversityEmail('student@campus.students.ku.ac.ke', 'students.ku.ac.ke'), false);
});

test('rejects lookalike domains and email addresses without a domain', () => {
  assert.equal(matchesUniversityEmail('student@notku.ac.ke', 'ku.ac.ke'), false);
  assert.equal(matchesUniversityEmail('student@ku.ac.ke.evil.test', 'ku.ac.ke'), false);
  assert.equal(matchesUniversityEmail('student', 'ku.ac.ke'), false);
});

test('supports a list of official domains without accepting unrelated suffixes', () => {
  assert.equal(
    matchesUniversityEmail('student@example.edu', ['school.ac.ke', 'example.edu']),
    true
  );
  assert.equal(matchesUniversityEmail('student@example.edu.evil.test', 'example.edu'), false);
});

test('creates a high-entropy verification token and stores only its hash', () => {
  const { token, tokenHash } = createVerificationToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenHash);
  assert.equal(crypto.createHash('sha256').update(token).digest('hex'), tokenHash);
});
