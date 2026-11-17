function normalizeDomains(domains) {
  const values = Array.isArray(domains) ? domains : [domains];
  return values
    .flatMap(value => String(value || '').split(/[,\s]+/))
    .map(domain => domain.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, ''))
    .filter(Boolean);
}

function matchesUniversityEmail(email, domains) {
  const address = String(email || '').trim().toLowerCase();
  const separator = address.lastIndexOf('@');
  if (separator <= 0 || separator === address.length - 1) return false;

  const emailDomain = address.slice(separator + 1);
  return normalizeDomains(domains).includes(emailDomain);
}

module.exports = { matchesUniversityEmail };
