var passwordResetService = require('../services/passwordReset.service');

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function renderForgotPassword(res, options) {
  var data = options || {};
  return res.status(data.status || 200).render('auth/forgot-password', {
    title: 'Quên mật khẩu',
    email: data.email || '',
    error: data.error || '',
    success: data.success || ''
  });
}

function renderVerifyResetCode(req, res, options) {
  var data = options || {};
  var state = req.session && req.session.passwordReset || {};
  return res.status(data.status || 200).render('auth/verify-reset-code', {
    title: 'Xác nhận mã OTP',
    emailMasked: data.emailMasked || state.emailMasked || '',
    error: data.error || '',
    success: data.success || '',
    resendAfter: data.resendAfter || state.resendAfter || null
  });
}

function renderResetPassword(res, options) {
  var data = options || {};
  return res.status(data.status || 200).render('auth/reset-password', {
    title: 'Đặt lại mật khẩu',
    error: data.error || ''
  });
}

function clearPasswordResetSession(req) {
  if (req.session && req.session.passwordReset) delete req.session.passwordReset;
}

function hasResetRequest(req) {
  return !!(req.session && req.session.passwordReset && req.session.passwordReset.requestId);
}

function hasVerifiedResetRequest(req) {
  var state = req.session && req.session.passwordReset;
  return !!(state && state.requestId && state.userId && state.verified === true);
}

exports.getForgotPassword = function(req, res) {
  return renderForgotPassword(res);
};

exports.postForgotPassword = async function(req, res, next) {
  try {
    var email = String(req.body && req.body.email || '').trim();
    if (!isValidEmail(email)) {
      return renderForgotPassword(res, {
        status: 400,
        email: email,
        error: 'Email không hợp lệ.'
      });
    }

    var result = await passwordResetService.requestResetCode(email);
    req.session.passwordReset = {
      requestId: result.requestId,
      emailMasked: result.emailMasked,
      expiresAt: result.expiresAt,
      resendAfter: result.resendAfter
    };
    return res.redirect('/verify-reset-code?sent=1');
  } catch (error) {
    if (error && error.message === 'Missing PASSWORD_RESET_PEPPER') {
      return renderForgotPassword(res, {
        status: 500,
        email: email,
        error: 'Chức năng đặt lại mật khẩu chưa được cấu hình đầy đủ. Vui lòng thử lại sau.'
      });
    }
    next(error);
  }
};

exports.getVerifyResetCode = function(req, res) {
  if (!hasResetRequest(req)) return res.redirect('/forgot-password');
  return renderVerifyResetCode(req, res, {
    success: req.query && req.query.sent ? passwordResetService.GENERIC_REQUEST_MESSAGE : ''
  });
};

exports.postVerifyResetCode = async function(req, res) {
  if (!hasResetRequest(req)) return res.redirect('/forgot-password');
  try {
    var state = req.session.passwordReset;
    var result = await passwordResetService.verifyResetCode(state.requestId, req.body && req.body.code);
    req.session.passwordReset = {
      requestId: result.requestId,
      userId: result.userId,
      verified: true,
      verifiedAt: result.verifiedAt,
      expiresAt: result.expiresAt
    };
    return res.redirect('/reset-password');
  } catch (error) {
    return renderVerifyResetCode(req, res, {
      status: 400,
      error: error.message || 'Không xác minh được mã OTP.'
    });
  }
};

exports.postResendResetCode = async function(req, res) {
  if (!hasResetRequest(req)) return res.redirect('/forgot-password');
  try {
    var result = await passwordResetService.resendResetCode(req.session.passwordReset.requestId);
    req.session.passwordReset = {
      requestId: result.requestId,
      emailMasked: result.emailMasked,
      expiresAt: result.expiresAt,
      resendAfter: result.resendAfter
    };
    return renderVerifyResetCode(req, res, {
      success: passwordResetService.GENERIC_REQUEST_MESSAGE,
      resendAfter: result.resendAfter
    });
  } catch (error) {
    var status = error.code === 'RESEND_COOLDOWN' ? 429 : 400;
    return renderVerifyResetCode(req, res, {
      status: status,
      error: error.message || 'Không gửi lại được mã OTP.',
      resendAfter: req.session.passwordReset.resendAfter
    });
  }
};

exports.getResetPassword = function(req, res) {
  if (!hasVerifiedResetRequest(req)) return res.redirect('/forgot-password');
  return renderResetPassword(res);
};

exports.postResetPassword = async function(req, res) {
  if (!hasVerifiedResetRequest(req)) return res.redirect('/forgot-password');
  try {
    var state = req.session.passwordReset;
    await passwordResetService.resetPassword({
      requestId: state.requestId,
      userId: state.userId,
      password: req.body && req.body.password,
      confirmPassword: req.body && req.body.confirm_password
    });
    clearPasswordResetSession(req);
    return res.redirect('/login?success=password_reset');
  } catch (error) {
    return renderResetPassword(res, {
      status: 400,
      error: error.message || 'Không đặt lại được mật khẩu.'
    });
  }
};
