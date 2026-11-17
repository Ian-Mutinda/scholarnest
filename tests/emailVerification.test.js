const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const {
  getMailConfiguration,
  sendVerificationEmail,
} = require('../src/services/emailVerification');

test('requires matching SMTP credentials and HTTPS in production', t => {
  const keys = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD',
    'EMAIL_FROM', 'APP_BASE_URL', 'NODE_ENV',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => keys.forEach(key => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }));

  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: '',
    EMAIL_FROM: 'no-reply@example.test',
    APP_BASE_URL: 'http://scholarnest.example.test',
    NODE_ENV: 'production',
  });
  assert.throws(() => getMailConfiguration(), /credentials must be provided together/);

  process.env.SMTP_PASSWORD = 'password';
  assert.throws(() => getMailConfiguration(), /HTTPS in production/);
  process.env.APP_BASE_URL = 'https://scholarnest.example.test';
  assert.equal(getMailConfiguration().secure, false);
});

test('sends an email with a client-confirmed verification link over SMTP', async t => {
  let receivedMessage = '';
  let collectingMessage = false;
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.write('220 test.local ESMTP\r\n');
    let buffer = '';

    socket.on('data', chunk => {
      buffer += chunk;
      let end = buffer.indexOf('\r\n');
      while (end !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (collectingMessage) {
          if (line === '.') {
            collectingMessage = false;
            socket.write('250 Message accepted\r\n');
          } else {
            receivedMessage += `${line}\r\n`;
          }
        } else if (/^EHLO|^HELO/i.test(line)) {
          socket.write('250 test.local\r\n');
        } else if (/^MAIL FROM|^RCPT TO/i.test(line)) {
          socket.write('250 Accepted\r\n');
        } else if (/^DATA/i.test(line)) {
          collectingMessage = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 Accepted\r\n');
        }
        end = buffer.indexOf('\r\n');
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const previous = {};
  const config = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(server.address().port),
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    EMAIL_FROM: 'ScholarNest <no-reply@example.test>',
    APP_BASE_URL: 'https://scholarnest.example.test',
    NODE_ENV: 'test',
  };
  Object.keys(config).forEach(key => {
    previous[key] = process.env[key];
    process.env[key] = config[key];
  });
  t.after(() => {
    Object.keys(config).forEach(key => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  });

  const token = 'a'.repeat(64);
  await sendVerificationEmail({
    email: 'student@university.ac.ke',
    fullName: 'Test Student',
    token,
  });

  assert.match(receivedMessage, /Subject: Confirm your ScholarNest email/i);
  const unfoldedMessage = receivedMessage.replace(/=\r\n/g, '');
  assert.match(unfoldedMessage, new RegExp(`https://scholarnest\\.example\\.test/#verify-email/${token}`));
});
