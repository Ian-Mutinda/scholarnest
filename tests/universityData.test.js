const test = require('node:test');
const assert = require('node:assert/strict');
const universities = require('../scripts/universityData');

test('keeps the full requested university list without duplicate slugs', () => {
  assert.equal(universities.length, 70);
  assert.equal(new Set(universities.map(university => university.slug)).size, universities.length);
});

test('only enables email domains with an official source URL', () => {
  universities.filter(university => university.domain).forEach(university => {
    assert.match(university.domainSource, /^https:\/\/\S+$/);
  });
});
