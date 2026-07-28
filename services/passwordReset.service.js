var crypto = require('crypto');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var { NguoiDung } = require('../models/kiot.model');
var PasswordResetRequest = require('../models/passwordReset.model');
var mailService = require('./mail.service');

var SALT_ROUNDS = 12;
var DEFAULT_TTL_MINUTES = 10;
var DEFAULT_RESEND_SECONDS = 60;
var DEFAULT_MAX_ATTEMPTS = 5;
var GENERIC_REQUEST_MESSAGE = 'Nếu email tồn tại trong hệ thống, mã xác nhận đã được gửi.';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function maskEmail(email) {
  var normalized = normalizeEmail(email);
  var parts = normalized.split('@');
  if (parts.length !== 2) return '';
  var name = parts[0];
  var domain = parts[1];
  var maskedName = name.length <= 2
    ? name.charAt(0) + '*'
    : name.charAt(0) + new Array(Math.max(name.length - 1, 2)).join('*') + name.charAt(name.length - 1);
  return maskedName + '@' + domain;
}

function getTtlMinutes() {
  var value = Number(process.env.PASSWORD_RESET_CODE_TTL_MINUTES || DEFAULT_TTL_MINUTES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TTL_MINUTES;
}

function getResendSeconds() {
  var value = Number(process.env.PASSWORD_RESET_RESEND_SECONDS || DEFAULT_RESEND_SECONDS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_RESEND_SECONDS;
}

function getMaxAttempts() {
  var value = Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_ATTEMPTS;
}

function getPepper() {
  var pepper = String(process.env.PASSWORD_RESET_PEPPER || '').trim();
  if (!pepper) throw new Error('Missing PASSWORD_RESET_PEPPER');
  return pepper;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto.createHmac('sha256', getPepper()).update(String(code || '')).digest('hex');
}

function codesMatch(code, storedHash) {
  var candidate = Buffer.from(hashCode(code), 'hex');
  var stored = Buffer.from(String(storedHash || ''), 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function isValidPassword(password) {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(password || ''));
}

function publicRequestState(request, email) {
  return {
    requestId: String(request._id),
    emailMasked: maskEmail(email || request.email_normalized),
    expiresAt: request.expires_at,
    resendAfter: request.resend_after,
    mailSent: false,
    message: GENERIC_REQUEST_MESSAGE
  };
}

async function createRequestForEmail(emailNormalized, user) {
  var code = generateCode();
  var now = new Date();
  var ttlMinutes = getTtlMinutes();
  var request = await PasswordResetRequest.create({
    user_id: user ? user._id : null,
    email_normalized: emailNormalized,
    code_hash: hashCode(code),
    expires_at: new Date(now.getTime() + ttlMinutes * 60 * 1000),
    resend_after: new Date(now.getTime() + getResendSeconds() * 1000),
    attempts: 0,
    max_attempts: getMaxAttempts()
  });

  var state = publicRequestState(request, emailNormalized);
  if (!user) return state;

  try {
    await mailService.sendPasswordResetCode({
      to: user.email,
      name: user.ho_ten || user.username || '',
      code: code,
      expiresInMinutes: ttlMinutes
    });
    state.mailSent = true;
  } catch (_error) {
    state.mailSent = false;
  }

  return state;
}

async function requestResetCode(email) {
  var emailNormalized = normalizeEmail(email);
  var user = await NguoiDung.findOne({ email: emailNormalized }).select('_id email ho_ten username').lean();

  if (user) {
    await PasswordResetRequest.updateMany({
      user_id: user._id,
      used_at: null
    }, {
      $set: { used_at: new Date() }
    });
  }

  return createRequestForEmail(emailNormalized, user);
}

async function loadRequestWithHash(requestId) {
  if (!mongoose.Types.ObjectId.isValid(String(requestId || ''))) {
    var invalid = new Error('Mã xác nhận không hợp lệ hoặc đã hết hạn.');
    invalid.code = 'INVALID_RESET_REQUEST';
    throw invalid;
  }
  var request = await PasswordResetRequest.findById(requestId).select('+code_hash');
  if (!request || request.used_at || request.verified_at || request.expires_at <= new Date()) {
    var expired = new Error('Mã xác nhận không hợp lệ hoặc đã hết hạn.');
    expired.code = 'INVALID_RESET_REQUEST';
    throw expired;
  }
  if (request.attempts >= request.max_attempts) {
    var locked = new Error('Bạn đã nhập sai quá số lần cho phép. Vui lòng gửi lại mã mới.');
    locked.code = 'MAX_ATTEMPTS_REACHED';
    throw locked;
  }
  return request;
}

async function verifyResetCode(requestId, code) {
  var request = await loadRequestWithHash(requestId);
  var normalizedCode = String(code || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(normalizedCode) || !codesMatch(normalizedCode, request.code_hash)) {
    request.attempts += 1;
    await request.save();
    var error = new Error('Mã xác nhận không đúng.');
    error.code = 'INVALID_CODE';
    error.attemptsRemaining = Math.max(Number(request.max_attempts || 0) - Number(request.attempts || 0), 0);
    throw error;
  }
  if (!request.user_id) {
    request.attempts += 1;
    await request.save();
    var noUser = new Error('Mã xác nhận không đúng.');
    noUser.code = 'INVALID_CODE';
    throw noUser;
  }

  request.verified_at = new Date();
  await request.save();
  return {
    requestId: String(request._id),
    userId: String(request.user_id),
    verifiedAt: request.verified_at,
    expiresAt: request.expires_at
  };
}

async function resendResetCode(requestId) {
  if (!mongoose.Types.ObjectId.isValid(String(requestId || ''))) {
    var invalid = new Error('Yêu cầu đặt lại mật khẩu không hợp lệ.');
    invalid.code = 'INVALID_RESET_REQUEST';
    throw invalid;
  }
  var existing = await PasswordResetRequest.findById(requestId);
  if (!existing || existing.used_at || existing.expires_at <= new Date()) {
    var expired = new Error('Yêu cầu đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    expired.code = 'INVALID_RESET_REQUEST';
    throw expired;
  }
  var now = new Date();
  if (existing.resend_after && existing.resend_after > now) {
    var wait = Math.ceil((existing.resend_after.getTime() - now.getTime()) / 1000);
    var cooldown = new Error('Vui lòng chờ trước khi gửi lại mã.');
    cooldown.code = 'RESEND_COOLDOWN';
    cooldown.retryAfterSeconds = wait;
    throw cooldown;
  }

  existing.used_at = now;
  await existing.save();

  var user = existing.user_id
    ? await NguoiDung.findById(existing.user_id).select('_id email ho_ten username').lean()
    : null;

  return createRequestForEmail(existing.email_normalized, user);
}

async function resetPassword(options) {
  var requestId = options && options.requestId;
  var userId = options && options.userId;
  var password = String(options && options.password || '');
  var confirmPassword = String(options && options.confirmPassword || '');
  if (!password || password !== confirmPassword) {
    var mismatch = new Error('Xác nhận mật khẩu không khớp.');
    mismatch.code = 'PASSWORD_MISMATCH';
    throw mismatch;
  }
  if (!isValidPassword(password)) {
    var weak = new Error('Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ và số.');
    weak.code = 'WEAK_PASSWORD';
    throw weak;
  }
  if (!mongoose.Types.ObjectId.isValid(String(requestId || '')) || !mongoose.Types.ObjectId.isValid(String(userId || ''))) {
    var invalid = new Error('Phiên đặt lại mật khẩu không hợp lệ.');
    invalid.code = 'INVALID_RESET_REQUEST';
    throw invalid;
  }

  var request = await PasswordResetRequest.findOne({
    _id: requestId,
    user_id: userId,
    verified_at: { $ne: null },
    used_at: null,
    expires_at: { $gt: new Date() }
  });
  if (!request) {
    var expired = new Error('Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    expired.code = 'INVALID_RESET_REQUEST';
    throw expired;
  }

  var passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  var user = await NguoiDung.findById(userId).select('+password_hash');
  if (!user) {
    var notFound = new Error('Phiên đặt lại mật khẩu không hợp lệ.');
    notFound.code = 'INVALID_RESET_REQUEST';
    throw notFound;
  }
  user.password_hash = passwordHash;
  await user.save();

  var now = new Date();
  await PasswordResetRequest.updateMany({
    user_id: userId,
    used_at: null
  }, {
    $set: { used_at: now }
  });

  return { success: true };
}

module.exports = {
  GENERIC_REQUEST_MESSAGE: GENERIC_REQUEST_MESSAGE,
  getTtlMinutes: getTtlMinutes,
  getResendSeconds: getResendSeconds,
  isValidPassword: isValidPassword,
  maskEmail: maskEmail,
  requestResetCode: requestResetCode,
  verifyResetCode: verifyResetCode,
  resendResetCode: resendResetCode,
  resetPassword: resetPassword
};
