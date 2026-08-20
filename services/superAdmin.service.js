var bcrypt = require('bcrypt');
var { NguoiDung } = require('../models/kiot.model');

var SUPER_ADMIN_USERNAME = 'tuananhadmin';
var SUPER_ADMIN_LOGIN = 'Tuananhadmin';
var SUPER_ADMIN_PASSWORD = 'admin';
var SALT_ROUNDS = 12;

async function ensureSuperAdminAccount() {
  var user = await NguoiDung.findOne({ email: SUPER_ADMIN_USERNAME }).select('+password_hash');
  if (user) {
    var changed = false;
    if (user.vai_tro !== 'super_admin') {
      user.vai_tro = 'super_admin';
      changed = true;
    }
    if (user.trang_thai !== 'active') {
      user.trang_thai = 'active';
      changed = true;
    }
    if (!user.password_hash) {
      user.password_hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
      user.must_change_password = true;
      changed = true;
    }
    if (changed) await user.save();
    return user;
  }

  var passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
  return NguoiDung.create({
    cua_hang_id: null,
    email: SUPER_ADMIN_USERNAME,
    password_hash: passwordHash,
    ho_ten: SUPER_ADMIN_LOGIN,
    vai_tro: 'super_admin',
    trang_thai: 'active',
    must_change_password: true
  });
}

function isSuperAdminLogin(value) {
  return String(value || '').trim().toLowerCase() === SUPER_ADMIN_USERNAME;
}

module.exports = {
  SUPER_ADMIN_LOGIN: SUPER_ADMIN_LOGIN,
  SUPER_ADMIN_PASSWORD: SUPER_ADMIN_PASSWORD,
  ensureSuperAdminAccount: ensureSuperAdminAccount,
  isSuperAdminLogin: isSuperAdminLogin
};
