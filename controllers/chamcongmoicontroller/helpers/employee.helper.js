function normalizeEmployeePayload(body) {
  body = body || {};
  var status = String(body.trang_thai || '').trim();
  var gioiTinh = String(body.gioi_tinh || '').trim();
  var coLuongTheoNgay = toBoolean(body.co_luong_theo_ngay);
  var coLuongTheoThang = toBoolean(body.co_luong_theo_thang);
  return {
    ma_nhan_vien: String(body.ma_nhan_vien || '').trim(),
    ten_nhan_vien: String(body.ten_nhan_vien || '').trim(),
    sdt: String(body.sdt || '').trim(),
    email: String(body.email || '').trim(),
    cccd: String(body.cccd || '').trim(),
    ngay_sinh: parseDateInput(body.ngay_sinh),
    gioi_tinh: ['nam', 'nu', 'khac'].indexOf(gioiTinh) >= 0 ? gioiTinh : '',
    chuc_vu: String(body.chuc_vu || '').trim(),
    co_luong_theo_ngay: coLuongTheoNgay,
    luong_theo_ngay: coLuongTheoNgay ? toMoneyNumber(body.luong_theo_ngay) : 0,
    co_luong_theo_thang: coLuongTheoThang,
    luong_theo_thang: coLuongTheoThang ? toMoneyNumber(body.luong_theo_thang) : 0,
    ngay_bat_dau_lam_viec: parseDateInput(body.ngay_bat_dau_lam_viec),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: status === 'inactive' ? 'inactive' : 'active'
  };
}

function employeeLabel(item) {
  var code = item.ma_nhan_vien ? item.ma_nhan_vien + ' - ' : '';
  return code + item.ten_nhan_vien;
}

function serializeEmployee(item) {
  item = item || {};
  item.label = employeeLabel(item);
  item.ngay_sinh_input = formatDate(item.ngay_sinh);
  item.ngay_bat_dau_lam_viec_input = formatDate(item.ngay_bat_dau_lam_viec);
  item.luong_theo_ngay = Number(item.luong_theo_ngay || 0);
  item.luong_theo_thang = Number(item.luong_theo_thang || 0);
  item.co_luong_theo_ngay = item.co_luong_theo_ngay === true || item.luong_theo_ngay > 0;
  item.co_luong_theo_thang = item.co_luong_theo_thang === true || item.luong_theo_thang > 0;
  return item;
}

function buildEmployeeFilter(storeId, query) {
  var filter = { cua_hang_id: storeId };
  if (String(query.include_inactive || '') !== '1') filter.trang_thai = 'active';
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { ma_nhan_vien: regex },
      { ten_nhan_vien: regex },
      { sdt: regex },
      { email: regex },
      { cccd: regex },
      { chuc_vu: regex }
    ];
  }
  return filter;
}

module.exports = { normalizeEmployeePayload, employeeLabel, serializeEmployee, buildEmployeeFilter };
