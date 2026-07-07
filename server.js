require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');

const {
  PORT = 3000,
  API_KEY,
  SMTP_HOST,
  SMTP_PORT = 587,
  SMTP_USERNAME,
  SMTP_PASSWORD,
  SMTP_ENCRYPTION = 'tls', // tls = STARTTLS (587), ssl = SMTPS (465)
  SMTP_FROM_EMAIL,
  SMTP_FROM_NAME,
  SMTP_DEBUG = '0',
} = process.env;

const missing = ['API_KEY', 'SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD'].filter(
  (k) => !process.env[k]
);
if (missing.length) {
  console.error(`Missing required env variables: ${missing.join(', ')}`);
  process.exit(1);
}

const debugEnabled = Number(SMTP_DEBUG) > 0;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_ENCRYPTION === 'ssl',
  auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
  logger: debugEnabled,
  debug: debugEnabled,
});

const fromEmail = SMTP_FROM_EMAIL || SMTP_USERNAME;
const defaultFrom = SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${fromEmail}>` : fromEmail;

const app = express();
app.use(express.json({ limit: '10mb' }));

// API key check on everything except health check
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.get('x-api-key') || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/send', async (req, res) => {
  const { to, subject, text, html, cc, bcc, replyTo, attachments } = req.body || {};

  if (!to) {
    return res.status(400).json({ success: false, error: 'Field "to" is required' });
  }
  if (!subject) {
    return res.status(400).json({ success: false, error: 'Field "subject" is required' });
  }
  if (!text && !html) {
    return res.status(400).json({ success: false, error: 'Either "text" or "html" is required' });
  }

  try {
    const info = await transporter.sendMail({
      from: defaultFrom,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html,
      attachments, // optional: [{ filename, content (base64), encoding: 'base64' }]
    });

    res.json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (err) {
    console.error('Send failed:', err.message);
    res.status(502).json({
      success: false,
      error: err.message,
      code: err.code || null,
      smtpResponse: err.response || null,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found. Use POST /send' });
});

app.listen(Number(PORT), () => {
  console.log(`Mail relay listening on port ${PORT}`);
  // Verify SMTP connection at startup so config errors surface immediately
  transporter.verify((err) => {
    if (err) {
      console.error('SMTP verify failed:', err.message);
    } else {
      console.log(`SMTP connection to ${SMTP_HOST}:${SMTP_PORT} OK`);
    }
  });
});
