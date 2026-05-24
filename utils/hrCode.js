var { Counter, PhieuThuChi } = require('../models/kiot.model');

async function getNextCode(counterName, prefix, width) {
  var counter = await Counter.findOneAndUpdate(
    { _id: counterName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
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

async function makeCaLamViecCode(storeId) {
  return getNextCode('ca_lam_viec_' + String(storeId), 'CA', 6);
}

async function makeBangLuongCode(storeId) {
  return getNextCode('bang_luong_' + String(storeId), 'BL', 6);
}

async function makePhieuThuChiCode(storeId, prefix) {
  var safePrefix = prefix || 'PC';
  for (var i = 0; i < 20; i += 1) {
    var code = await getNextCode('phieu_thu_chi_' + safePrefix, safePrefix, 6);
    var existed = await PhieuThuChi.exists({ ma_phieu: code });
    if (!existed) return code;
  }
  return safePrefix + String(Date.now()).slice(-10);
}

async function makePayrollPaymentCode(storeId) {
  var safeStoreId = String(storeId || 'global');
  for (var i = 0; i < 20; i += 1) {
    var code = await getNextCode('phieu_thu_chi_PL_' + safeStoreId, 'PL', 6);
    var existed = await PhieuThuChi.exists({ ma_phieu: code });
    if (!existed) return code;
  }
  return 'PL' + String(Date.now()).slice(-10);
}

module.exports = {
  getNextCode,
  makePhongBanCode,
  makeNhanVienCode,
  makeChucDanhCode,
  makeCaLamViecCode,
  makeBangLuongCode,
  makePhieuThuChiCode,
  makePayrollPaymentCode
};
