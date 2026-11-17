const crypto = require('crypto');
const nodemailer = require('nodemailer');

const TOKEN_TTL_HOURS = 24;

function createVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

function getMailConfiguration() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE, EMAIL_FROM, APP_BASE_URL } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !EMAIL_FROM || !APP_BASE_URL || Boolean(SMTP_USER) !== Boolean(SMTP_PASSWORD)) {
    throw new Error('SMTP_HOST, SMTP_PORT, EMAIL_FROM, and APP_BASE_URL must be configured; SMTP credentials must be provided together');
  }

  let baseUrl;
  try {
    baseUrl = new URL(APP_BASE_URL);
  } catch {
    throw new Error('APP_BASE_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) ||
      baseUrl.username || baseUrl.password ||
      (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')) {
    throw new Error('APP_BASE_URL must use HTTP locally and HTTPS in production');
  }

  const secure = SMTP_SECURE === undefined ? port === 465 : SMTP_SECURE.toLowerCase() === 'true';
  if (SMTP_SECURE !== undefined && !['true', 'false'].includes(SMTP_SECURE.toLowerCase())) {
    throw new Error('SMTP_SECURE must be true or false');
  }

  return {
    host: SMTP_HOST,
    port,
    secure,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    from: EMAIL_FROM,
    baseUrl,
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function sendVerificationEmail({ email, fullName, token }) {
  const config = getMailConfiguration();
  const verificationUrl = new URL('/', config.baseUrl);
  verificationUrl.hash = `verify-email/${token}`;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  const safeName = escapeHtml(fullName);
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: 'Confirm your ScholarNest email',
    text: `Hello ${fullName},\n\nConfirm your email address and create a password to activate your ScholarNest account:\n${verificationUrl}\n\nThis link expires in ${TOKEN_TTL_HOURS} hours and can only be used once. If you did not request this account, ignore this email; no one can log in before completing confirmation.`,
    html: `<p>Hello ${safeName},</p><p>Confirm your email address and create a password to activate your ScholarNest account:</p><p><a href="${verificationUrl.toString()}">Confirm email address</a></p><p>This link expires in ${TOKEN_TTL_HOURS} hours and can only be used once. If you did not request this account, ignore this email; no one can log in before completing confirmation.</p>`,
  });
}

module.exports = {
  TOKEN_TTL_HOURS,
  createVerificationToken,
  getMailConfiguration,
  sendVerificationEmail,
};
