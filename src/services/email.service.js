import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? {user: process.env.SMTP_USER, pass: process.env.SMTP_PASS}
      : undefined
  });
  return transporter;
}

export async function sendPasswordResetEmail({to, token}) {
  const baseUrl = process.env.PASSWORD_RESET_URL || 'http://localhost:3000/reset-password';
  const resetUrl = new URL(baseUrl);
  resetUrl.searchParams.set('token', token);

  const activeTransporter = getTransporter();
  if (!activeTransporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is required in production');
    }
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[development email] Password reset for ${to}: ${resetUrl}`);
    }
    return;
  }

  await activeTransporter.sendMail({
    from: process.env.EMAIL_FROM || 'Notes API <no-reply@example.com>',
    to,
    subject: 'Reset your Notes API password',
    text: `Use this link within 15 minutes to reset your password: ${resetUrl}`,
    html: `<p>Use the link below within 15 minutes to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  });
}
