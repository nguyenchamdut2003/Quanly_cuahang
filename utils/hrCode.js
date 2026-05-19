var { Counter } = require('../models/kiot.model');

async function getNextCode(counterName, prefix, width) {
  var counter = await Counter.findOneAndUpdate(
    { _id: counterName },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  return prefix + String(counter.seq || 1).padStart(width, '0');
}

async function makePhongBanCode(storeId) {
  return getNextCode('phong_ban_' + String(storeId), 'PB', 6);
}

async function makeNhanVienCode(storeId) {
  return getNextCode('nhan_vien_' + String(storeId), 'NV', 6);
}

async function makeChucDanhCode(storeId) {
  return getNextCode('chuc_danh_' + String(storeId), 'CD', 6);
}

module.exports = {
  getNextCode,
  makePhongBanCode,
  makeNhanVienCode,
  makeChucDanhCode
};
