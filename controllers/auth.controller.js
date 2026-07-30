var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var passport = require('../config/passport');
var { CuaHang, NguoiDung } = require('../models/kiot.model');
var superAdminService = require('../services/superAdmin.service');

var SALT_ROUNDS = 12;

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function isSafeReturnUrl(value) {
  var url = String(value || '').trim();
  if (!url || url[0] !== '/') return false;
  if (url.indexOf('//') === 0) return false;
  if (/^\/(?:login|register|logout|auth\/logout|auth\/google|auth\/google\/callback)(?:[/?#]|$)/i.test(url)) return false;
  return true;
}

function resolveReturnUrl(req) {
  var requested = req.body && req.body.returnUrl || req.query && req.query.returnUrl || req.session && req.session.returnUrl;
  return isSafeReturnUrl(requested) ? String(requested).trim() : '';
}

function defaultRedirectForUser(user) {
  if (user && user.trang_thai === 'active' && !['super_admin', 'admin'].includes(user.vai_tro)) {
    return '/cho-phan-quyen';
  }
  return user && user.cua_hang_id ? '/' : '/';
}

function renderLogin(res, options) {
  var data = options || {};
  return res.status(data.status || 200).render('auth/login', {
    title: 'Đăng nhập',
    email: data.email || '',
    error: data.error || '',
    success: data.success || '',
    returnUrl: data.returnUrl || ''
  });
}

function renderRegister(res, options) {
  var data = options || {};
  return res.status(data.status || 200).render('auth/register', {
    title: 'Đăng ký',
    ho_ten: data.ho_ten || '',
    sdt: data.sdt || '',
    email: data.email || '',
    error: data.error || '',
    returnUrl: data.returnUrl || ''
  });
}

function regenerateSession(req) {
  return new Promise(function(resolve, reject) {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    req.session.regenerate(function(error) {
      if (error) return reject(error);
      resolve();
    });
  });
}

function loginWithFreshSession(req, user) {
  return regenerateSession(req).then(function() {
    return new Promise(function(resolve, reject) {
      req.login(user, function(error) {
        if (error) return reject(error);
        if (req.session && user.cua_hang_id) {
          req.session.cua_hang_id = String(user.cua_hang_id._id || user.cua_hang_id);
        }
        resolve();
      });
    });
  });
}

function logoutRequest(req) {
  return new Promise(function(resolve, reject) {
    if (!req.logout) return resolve();
    req.logout(function(error) {
      if (error) return reject(error);
      resolve();
    });
  });
}

function destroySession(req) {
  return new Promise(function(resolve) {
    if (!req.session || typeof req.session.destroy !== 'function') return resolve();
    req.session.destroy(function() {
      resolve();
    });
  });
}

exports.getLogin = function(req, res) {
  return renderLogin(res, {
    error: req.query && req.query.error ? String(req.query.error) : '',
    success: req.query && req.query.success ? String(req.query.success) : '',
    returnUrl: isSafeReturnUrl(req.query && req.query.returnUrl) ? req.query.returnUrl : ''
  });
};

exports.postLogin = async function(req, res, next) {
  var email = normalizeEmail(req.body && req.body.email);
  var returnUrl = resolveReturnUrl(req);

  try {
    if (superAdminService.isSuperAdminLogin(email)) {
      await superAdminService.ensureSuperAdminAccount();
    }
  } catch (error) {
    return next(error);
  }

  passport.authenticate('local', function(error, user, info) {
    if (error) return next(error);
    if (!user) {
      return renderLogin(res, {
        status: 401,
        email: email,
        returnUrl: returnUrl,
        error: info && info.message || 'Email hoặc mật khẩu không chính xác.'
      });
    }

    loginWithFreshSession(req, user)
      .then(function() {
        if (req.session && req.session.returnUrl) delete req.session.returnUrl;
        res.redirect(returnUrl || defaultRedirectForUser(user));
      })
      .catch(next);
  })(req, res, next);
};

exports.getRegister = function(req, res) {
  return renderRegister(res, {
    returnUrl: isSafeReturnUrl(req.query && req.query.returnUrl) ? req.query.returnUrl : ''
  });
};

exports.postRegister = async function(req, res, next) {
  try {
    var hoTen = String(req.body && req.body.ho_ten || '').trim();
    var sdt = String(req.body && req.body.sdt || '').trim();
    var email = normalizeEmail(req.body && req.body.email);
    var password = String(req.body && req.body.password || '');
    var confirmPassword = String(req.body && req.body.confirm_password || '');
    var returnUrl = resolveReturnUrl(req);

    if (!hoTen) {
      return renderRegister(res, { status: 400, ho_ten: hoTen, sdt: sdt, email: email, returnUrl: returnUrl, error: 'Vui lòng nhập họ tên.' });
    }
    if (!isValidEmail(email)) {
      return renderRegister(res, { status: 400, ho_ten: hoTen, sdt: sdt, email: email, returnUrl: returnUrl, error: 'Email không hợp lệ.' });
    }
    if (password.length < 8) {
      return renderRegister(res, { status: 400, ho_ten: hoTen, sdt: sdt, email: email, returnUrl: returnUrl, error: 'Mật khẩu phải có ít nhất 8 ký tự.' });
    }
    if (password !== confirmPassword) {
      return renderRegister(res, { status: 400, ho_ten: hoTen, sdt: sdt, email: email, returnUrl: returnUrl, error: 'Xác nhận mật khẩu không khớp.' });
    }

    var existed = await NguoiDung.findOne({ email: email }).select('+password_hash');
    if (existed && existed.password_hash) {
      return renderRegister(res, { status: 409, ho_ten: hoTen, sdt: sdt, email: email, returnUrl: returnUrl, error: 'Email này đã được sử dụng.' });
    }

    var passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    var user;
    if (existed) {
      existed.password_hash = passwordHash;
      existed.ho_ten = hoTen || existed.ho_ten;
      existed.sdt = sdt || existed.sdt || '';
      existed.vai_tro = existed.vai_tro || 'user';
      existed.trang_thai = existed.trang_thai || 'active';
      existed.lan_dang_nhap_cuoi = new Date();
      await existed.save();
      user = existed;
    } else {
      user = await NguoiDung.create({
        cua_hang_id: null,
        email: email,
        password_hash: passwordHash,
        ho_ten: hoTen,
        sdt: sdt,
        vai_tro: 'user',
        trang_thai: 'active',
        lan_dang_nhap_cuoi: new Date()
      });
    }

    await loginWithFreshSession(req, user);
    if (req.session && req.session.returnUrl) delete req.session.returnUrl;
    res.redirect(returnUrl || defaultRedirectForUser(user));
  } catch (error) {
    if (error && error.code === 11000) {
      return renderRegister(res, {
        status: 409,
        ho_ten: req.body && req.body.ho_ten,
        sdt: req.body && req.body.sdt,
        email: normalizeEmail(req.body && req.body.email),
        returnUrl: resolveReturnUrl(req),
        error: 'Email này đã được sử dụng.'
      });
    }
    next(error);
  }
};

exports.postCurrentStore = async function(req, res, next) {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated() || !req.user) {
      return res.redirect('/login?error=login_required');
    }
    if (!['super_admin', 'admin'].includes(req.user.vai_tro)) {
      return res.redirect('/cho-phan-quyen');
    }

    var storeId = String(req.body && req.body.cua_hang_id || '').trim();
    if (!isObjectId(storeId)) {
      return res.status(400).redirect('/?error=invalid_store');
    }

    var store = await CuaHang.findOne({ _id: storeId, trang_thai: 'active' }).lean();
    if (!store) {
      return res.status(400).redirect('/?error=invalid_store');
    }

    await NguoiDung.findByIdAndUpdate(req.user._id, { cua_hang_id: storeId }, { new: false });

    if (req.session) req.session.cua_hang_id = storeId;
    req.user.cua_hang_id = storeId;

    var back = String((req.body && req.body.returnTo) || req.get('referer') || '/');
    if (!isSafeReturnUrl(back)) back = '/';
    res.redirect(back);
  } catch (error) {
    next(error);
  }
};

exports.getGoogleCallback = async function(req, res, next) {
  try {
    var user = req.user;
    if (!user) return res.redirect('/login?error=user_not_found');
    if (req.session && user.cua_hang_id) {
      req.session.cua_hang_id = String(user.cua_hang_id._id || user.cua_hang_id);
    }
    var returnUrl = resolveReturnUrl(req);
    if (req.session && req.session.returnUrl) delete req.session.returnUrl;
    return res.redirect(returnUrl || defaultRedirectForUser(user));
  } catch (error) {
    next(error);
  }
};

exports.getPendingPermission = function(req, res) {
  res.render('auth/pending-permission', {
    title: 'Cho phan quyen',
    user: req.user || null
  });
};

exports.postLogout = async function(req, res, next) {
  try {
    if (req.session) delete req.session.cua_hang_id;
    await logoutRequest(req);
    await destroySession(req);
    res.clearCookie('connect.sid');
    res.redirect('/login?success=logged_out');
  } catch (error) {
    next(error);
  }
};

exports.getLogout = exports.postLogout;
