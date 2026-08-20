const { CauHinhLuongNhanVien } = require('../../models/chamcong.model');

function pickBetterSalary(current, next) {
  if (!next) return current;
  if (!current) return next;
  if (!(Number(current.luong_thang || 0) > 0) && Number(next.luong_thang || 0) > 0) return next;
  return current;
}

async function getSalaryMap(storeId, employeeIds, beforeDate) {
  if (!employeeIds.length) return {};
  var query = {
    cua_hang_id: storeId,
    nhan_vien_id: { $in: employeeIds },
    trang_thai: 'active'
  };
  if (beforeDate) query.tu_ngay = { $lte: beforeDate };
  var rows = await CauHinhLuongNhanVien.find(query).populate({
    path: 'khoan_nop_ids',
    select: 'ma_khoan ten_khoan ti_le ti_le_nld ti_le_nsdld noi_nop_id',
    populate: { path: 'noi_nop_id', select: 'ma_noi_nop ten_noi_nop' }
  }).sort({ tu_ngay: -1 }).lean();
  var map = {};
  rows.forEach(function(row) {
    var key = String(row.nhan_vien_id);
    map[key] = pickBetterSalary(map[key], row);
  });
  var missingIds = employeeIds.filter(function(id) {
    var current = map[String(id)];
    return !current || !(Number(current.luong_thang || 0) > 0);
  });
  if (missingIds.length) {
    var fallbackRows = await CauHinhLuongNhanVien.find({
      cua_hang_id: storeId,
      nhan_vien_id: { $in: missingIds },
      trang_thai: 'active'
    }).populate({
      path: 'khoan_nop_ids',
      select: 'ma_khoan ten_khoan ti_le ti_le_nld ti_le_nsdld noi_nop_id',
      populate: { path: 'noi_nop_id', select: 'ma_noi_nop ten_noi_nop' }
    }).sort({ tu_ngay: -1 }).lean();
    fallbackRows.forEach(function(row) {
      var key = String(row.nhan_vien_id);
      map[key] = pickBetterSalary(map[key], row);
    });
  }
  return map;
}

exports.pickBetterSalary = pickBetterSalary;
exports.getSalaryMap = getSalaryMap;
