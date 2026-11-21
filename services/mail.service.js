var nodemailer = require('nodemailer');

function requiredEnv(name) {
  var value = String(process.env[name] || '').trim();
  if (!value) throw new Error('Missing mail environment variable: ' + name);
  return value;
}

function smtpPort() {
  var port = Number(process.env.BREVO_SMTP_PORT || 587);
  return Number.isFinite(port) && port > 0 ? port : 587;
}

function createTransporter() {
  var port = smtpPort();
  return nodemailer.createTransport({
    host: requiredEnv('BREVO_SMTP_HOST'),
    port: port,
    secure: port === 465,
    auth: {
      user: requiredEnv('BREVO_SMTP_USER'),
      pass: requiredEnv('BREVO_SMTP_KEY')
    }
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

async function sendPasswordResetCode(options) {
  var to = String(options && options.to || '').trim();
  var name = String(options && options.name || '').trim();
  var code = String(options && options.code || '').trim();
  var expiresInMinutes = Number(options && options.expiresInMinutes || 10);
  var fromName = process.env.MAIL_FROM_NAME || 'Quản lý cửa hàng';
  var fromEmail = requiredEnv('MAIL_FROM_EMAIL');
  var greeting = name ? 'Xin chào ' + name + ',' : 'Xin chào,';
  var safeCode = escapeHtml(code);
  var safeMinutes = Number.isFinite(expiresInMinutes) && expiresInMinutes > 0 ? Math.floor(expiresInMinutes) : 10;

  if (!to) throw new Error('Missing password reset recipient');
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid password reset code');

  var text = [
    greeting,
    '',
    'Mã xác nhận đặt lại mật khẩu của bạn là: ' + code,
    'Mã này sẽ hết hạn sau ' + safeMinutes + ' phút.',
    '',
    'Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.'
  ].join('\n');

  var html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">',
    '<p>' + escapeHtml(greeting) + '</p>',
    '<p>Mã xác nhận đặt lại mật khẩu của bạn là:</p>',
    '<div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 18px;border:1px solid #d9e2ee;border-radius:8px;display:inline-block;color:#0b7af3">' + safeCode + '</div>',
    '<p>Mã này sẽ hết hạn sau <strong>' + safeMinutes + ' phút</strong>.</p>',
    '<p style="color:#607088">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>',
    '</div>'
  ].join('');

  return createTransporter().sendMail({
    from: '"' + String(fromName).replace(/"/g, '\\"') + '" <' + fromEmail + '>',
    to: to,
    subject: 'Mã xác nhận đặt lại mật khẩu',
    text: text,
    html: html
  });
}

module.exports = {
  sendPasswordResetCode: sendPasswordResetCode
};
