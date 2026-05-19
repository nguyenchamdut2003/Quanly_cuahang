var mongoose = require('mongoose');
var { CuaHang } = require('../models/kiot.model');

async function resolveStoreId(req) {
  var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
  if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
  var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
  if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
  var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  return activeStore ? String(activeStore._id) : '';
}

function parseDateInput(value) {
  var raw = String(value || '').trim();
  if (!raw) return undefined;
  var d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

module.exports = {
  resolveStoreId,
  parseDateInput
};
