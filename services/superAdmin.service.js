var bcrypt = require('bcrypt');
var { NguoiDung } = require('../models/kiot.model');

var SUPER_ADMIN_USERNAME = 'tuananhadmin';
var SUPER_ADMIN_LOGIN = 'Tuananhadmin';
var SUPER_ADMIN_PASSWORD = 'admin';
var SALT_ROUNDS = 12;

async function ensureSuperAdminAccount() {
  // The login name is editable. Finding by the old default name would create
  // another privileged account after a rename, or promote its new owner.
  var user = await NguoiDung.findOne({ vai_tro: 'super_admin' })
    .sort({ created_at: 1, _id: 1 }).select('+password_hash');
  if (user) return user;

  // Bootstrap is only for a new installation. A public login request must not
  // restore a revoked role, reactivate an account, or reset its credentials.
  if (await NguoiDung.exists({})) return null;

  var passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
  try {
    return await NguoiDung.create({
      cua_hang_id: null,
      email: SUPER_ADMIN_USERNAME,
      password_hash: passwordHash,
      ho_ten: SUPER_ADMIN_LOGIN,
      vai_tro: 'super_admin',
      trang_thai: 'active',
      must_change_password: true
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Concurrent first logins share the account created by the winning request.
    return NguoiDung.findOne({ vai_tro: 'super_admin' }).sort({ created_at: 1, _id: 1 }).select('+password_hash');
  }
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
