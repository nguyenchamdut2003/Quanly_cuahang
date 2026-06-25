var mongoose = require('mongoose');
var {
  ChamCongMoiNhanVien,
  ChamCongMoiBanGhi,
  ChamCongMoiThang,
  ChamCongMoiBangLuong
} = require('../models/chamcongmoi.model');
var { PhieuThuChi } = require('../models/kiot.model');
var { taoPhieuThuChi } = require('../services/soQuy.service');
var { extractPaymentDetail } = require('../services/paymentCashBook.service');
var { resolveStoreId } = require('../utils/storeScope');
var { getNextCode } = require('../utils/hrCode');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeDate(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var parts = raw.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function parseDateInput(value) {
  return normalizeDate(value) || undefined;
}

function formatDate(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfWeek(value) {
  var date = normalizeDate(value) || new Date();
  date = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function todayUtc() {
  var now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function formatMonth(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1);
}

function normalizeMonth(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var parts = raw.split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, 1));
}

function addMonths(date, months) {
  date = new Date(date);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthLabel(monthKey) {
  var parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return '';
  return 'Tháng ' + parts[1] + '/' + parts[0];
}

function monthShortLabel(monthKey) {
  var parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return '';
  return parts[1] + '/' + parts[0];
}

function uniqueValues(items) {
  var seen = {};
  return items.filter(function(item) {
    if (!item || seen[item]) return false;
    seen[item] = true;
    return true;
  });
}

function monthBounds(monthKey) {
  var start = normalizeMonth(monthKey);
  if (!start) return null;
  return {
    start: start,
    end: addMonths(start, 1)
  };
}

function formatAttendanceDayDisplay(date) {
  if (!date) return '';
  date = new Date(date);
  if (Number.isNaN(date.getTime())) return '';
  return pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1) + '/' + date.getUTCFullYear();
}

function serializeAttendanceDays(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    return {
      ngay: formatDate(row.ngay_cham_cong),
      ngay_hien_thi: formatAttendanceDayDisplay(row.ngay_cham_cong),
      gio_vao: row.gio_vao || '',
      gio_ra: row.gio_ra || '',
      ghi_chu: row.ghi_chu || ''
    };
  });
}

async function loadAttendanceDaysForMonth(storeId, employeeId, monthKey) {
  var bounds = monthBounds(monthKey);
  if (!bounds) return [];
  return ChamCongMoiBanGhi.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    ngay_cham_cong: { $gte: bounds.start, $lt: bounds.end },
    dong_y: true
  }).sort({ ngay_cham_cong: 1 }).lean();
}

async function collectAttendanceMonthKeys(storeId, employeeId) {
  var monthKeys = [];
  var dayRecords = await ChamCongMoiBanGhi.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    dong_y: true
  }).select('ngay_cham_cong').lean();
  dayRecords.forEach(function(row) {
    monthKeys.push(formatMonth(row.ngay_cham_cong));
  });
  var monthRecords = await ChamCongMoiThang.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    dong_y: true
  }).select('thang_cham_cong').lean();
  monthRecords.forEach(function(row) {
    monthKeys.push(row.thang_cham_cong);
  });
  return uniqueValues(monthKeys);
}

async function rebuildEmployeePayrollsFromAttendance(storeId, employeeId) {
  if (!storeId || !employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) return;
  var employee = await ChamCongMoiNhanVien.findOne({
    _id: employeeId,
    cua_hang_id: storeId
  }).lean();
  if (!employee) return;
  var monthKeys = await collectAttendanceMonthKeys(storeId, employeeId);
  if (!monthKeys.length) return;
  await rebuildPayrolls(storeId, employee, monthKeys);
}

async function loadPayrollPhieuChi(storeId, payrollId) {
  if (!storeId || !payrollId) return null;
  return PhieuThuChi.findOne({
    cua_hang_id: storeId,
    chamcongmoi_bang_luong_id: payrollId,
    loai_phieu: 'chi',
    trang_thai: { $ne: 'cancelled' }
  })
    .sort({ ngay_lap: -1 })
    .select('_id ma_phieu gia_tri ngay_lap trang_thai')
    .lean();
}

async function attachPayrollPaymentInfo(storeId, item) {
  var phieuChi = await loadPayrollPhieuChi(storeId, item._id);
  if (phieuChi && item.trang_thai !== 'da_thanh_toan') {
    await ChamCongMoiBangLuong.updateOne(
      { _id: item._id, cua_hang_id: storeId },
      { $set: { trang_thai: 'da_thanh_toan' } }
    );
    item.trang_thai = 'da_thanh_toan';
  }
  item.da_thanh_toan = item.trang_thai === 'da_thanh_toan' || !!phieuChi;
  item.phieu_chi = phieuChi
    ? {
      _id: String(phieuChi._id),
      ma_phieu: phieuChi.ma_phieu || '',
      gia_tri: Number(phieuChi.gia_tri || 0),
      ngay_lap_text: phieuChi.ngay_lap ? formatAttendanceDayDisplay(phieuChi.ngay_lap) : ''
    }
    : null;
  item.trang_thai_thanh_toan = item.da_thanh_toan ? 'da_thanh_toan' : 'chua_thanh_toan';
  item.trang_thai_thanh_toan_text = item.da_thanh_toan ? 'Đã thanh toán' : 'Chưa thanh toán';
  item.co_the_thanh_toan = !item.da_thanh_toan && Number(item.tong_tien || 0) > 0;
  return item;
}

async function enrichPayrollItem(storeId, item) {
  item.tong_tien = Number(item.tong_tien || 0);
  item.so_ngay_cong = Number(item.so_ngay_cong || 0);
  item.so_thang_cong = Number(item.so_thang_cong || 0);
  item.luong_theo_ngay = Number(item.luong_theo_ngay || 0);
  item.luong_theo_thang = Number(item.luong_theo_thang || 0);
  item.loai_luong_text = item.loai_luong === 'thang' ? 'Theo tháng' : 'Theo ngày';
  item.thang_text = monthShortLabel(item.thang_bang_luong);
  item.chi_tiet_ngay_cong = [];
  item.chi_tiet_text = '---';
  item.canh_bao_luong = '';

  if (item.loai_luong === 'ngay') {
    var days = await loadAttendanceDaysForMonth(storeId, item.nhan_vien_id, item.thang_bang_luong);
    item.chi_tiet_ngay_cong = serializeAttendanceDays(days);
    item.chi_tiet_text = item.chi_tiet_ngay_cong.map(function(day) {
      var timeText = (day.gio_vao || day.gio_ra)
        ? (' ' + (day.gio_vao || '--:--') + '-' + (day.gio_ra || '--:--'))
        : '';
      return day.ngay_hien_thi + timeText;
    }).join('; ');
    if (!item.luong_theo_ngay) {
      item.canh_bao_luong = 'Chưa cấu hình lương/ngày';
    }
  } else if (item.loai_luong === 'thang') {
    item.chi_tiet_text = item.so_thang_cong ? 'Đồng ý chấm công cả tháng' : '---';
    if (!item.luong_theo_thang) {
      item.canh_bao_luong = 'Chưa cấu hình lương/tháng';
    }
  }

  await attachPayrollPaymentInfo(storeId, item);
  return item;
}

async function rebuildPayrolls(storeId, employee, monthKeys) {
  employee = serializeEmployee(employee);
  monthKeys = uniqueValues(monthKeys);
  for (var i = 0; i < monthKeys.length; i += 1) {
    var monthKey = monthKeys[i];
    var bounds = monthBounds(monthKey);
    if (!bounds) continue;

    var basePayload = {
      cua_hang_id: storeId,
      nhan_vien_id: employee._id,
      ma_nhan_vien: employee.ma_nhan_vien || '',
      ten_nhan_vien: employee.ten_nhan_vien || '',
      thang_bang_luong: monthKey,
      trang_thai: 'can_thanh_toan'
    };

    if (employee.co_luong_theo_thang) {
      var monthRecord = await ChamCongMoiThang.findOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_cham_cong: monthKey,
        dong_y: true
      }).lean();
      if (!monthRecord) {
        await ChamCongMoiBangLuong.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employee._id,
          thang_bang_luong: monthKey,
          loai_luong: 'thang'
        });
      } else {
        var luongThang = Number(employee.luong_theo_thang || 0);
        await upsertPayrollRecord(storeId, employee._id, monthKey, 'thang', Object.assign({}, basePayload, {
          loai_luong: 'thang',
          so_ngay_cong: 0,
          so_thang_cong: 1,
          luong_theo_ngay: 0,
          luong_theo_thang: luongThang,
          tong_tien: luongThang
        }));
      }
    } else {
      await ChamCongMoiBangLuong.deleteOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_bang_luong: monthKey,
        loai_luong: 'thang'
      });
    }

    if (employee.co_luong_theo_ngay || !employee.co_luong_theo_thang) {
      var dayCount = await ChamCongMoiBanGhi.countDocuments({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        ngay_cham_cong: { $gte: bounds.start, $lt: bounds.end },
        dong_y: true
      });
      if (!dayCount) {
        await ChamCongMoiBangLuong.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employee._id,
          thang_bang_luong: monthKey,
          loai_luong: 'ngay'
        });
      } else {
        var luongNgay = Number(employee.luong_theo_ngay || 0);
        await upsertPayrollRecord(storeId, employee._id, monthKey, 'ngay', Object.assign({}, basePayload, {
          loai_luong: 'ngay',
          so_ngay_cong: dayCount,
          so_thang_cong: 0,
          luong_theo_ngay: luongNgay,
          luong_theo_thang: 0,
          tong_tien: dayCount * luongNgay
        }));
      }
    } else {
      await ChamCongMoiBangLuong.deleteOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_bang_luong: monthKey,
        loai_luong: 'ngay'
      });
    }
  }
}

async function upsertPayrollRecord(storeId, employeeId, monthKey, loaiLuong, payload) {
  var payrollCode = await getPayrollCode(storeId, employeeId, monthKey, loaiLuong);
  payload.ma_bang_luong = payrollCode;
  payload.loai_luong = loaiLuong;
  await ChamCongMoiBangLuong.findOneAndUpdate(
    {
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      thang_bang_luong: monthKey,
      loai_luong: loaiLuong
    },
    { $set: payload },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

async function getPayrollCode(storeId, employeeId, monthKey, loaiLuong) {
  var existingPayroll = await ChamCongMoiBangLuong.findOne({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    thang_bang_luong: monthKey,
    loai_luong: loaiLuong
  }).select('ma_bang_luong').lean();
  if (existingPayroll && existingPayroll.ma_bang_luong) return existingPayroll.ma_bang_luong;

  for (var i = 0; i < 10; i += 1) {
    var code = await getNextCode('chamcongmoi_bang_luong_' + String(storeId), 'BL', 6);
    var exists = await ChamCongMoiBangLuong.exists({
      cua_hang_id: storeId,
      ma_bang_luong: code
    });
    if (!exists) return code;
  }
  return 'BL' + String(Date.now()).slice(-10);
}

async function getPayrollMap(storeId, employeeId, monthKeys) {
  monthKeys = uniqueValues(monthKeys);
  if (!monthKeys.length) return {};
  var payrolls = await ChamCongMoiBangLuong.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    thang_bang_luong: { $in: monthKeys },
    trang_thai: 'can_thanh_toan'
  }).select('_id ma_bang_luong thang_bang_luong tong_tien').lean();
  var map = {};
  payrolls.forEach(function(item) {
    var mapKey = item.thang_bang_luong + ':' + (item.loai_luong || 'ngay');
    map[mapKey] = {
      id: String(item._id),
      ma_bang_luong: item.ma_bang_luong || '',
      thang_bang_luong: item.thang_bang_luong,
      loai_luong: item.loai_luong || 'ngay',
      tong_tien: Number(item.tong_tien || 0),
      message: 'Đã có bảng lương ' + (item.ma_bang_luong || '') + ' cho tháng ' + item.thang_bang_luong
    };
  });
  return map;
}

function cleanTime(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var match24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (match24) {
    return pad2(Number(match24[1])) + ':' + match24[2];
  }
  var match12 = raw.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (match12) {
    var hour = Number(match12[1]) % 12;
    if (/pm/i.test(match12[3])) hour += 12;
    return pad2(hour) + ':' + match12[2];
  }
  return null;
}

function toMoneyNumber(value) {
  var num = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

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

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var weekStart = addDays(todayUtc(), -6);
    var employees = await ChamCongMoiNhanVien.find({
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).sort({ ten_nhan_vien: 1 }).lean();

    res.render('chamcong/index', {
      title: 'Chấm công mới',
      activeMenu: 'nhan-vien',
      user: req.user,
      employees: employees.map(serializeEmployee),
      selectedEmployeeId: String(req.query.nhan_vien_id || (employees[0] && employees[0]._id) || ''),
      weekStart: formatDate(weekStart),
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.apiEmployees = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employees = await ChamCongMoiNhanVien.find(buildEmployeeFilter(storeId, req.query))
      .sort({ created_at: -1 })
      .lean();
    return res.json({ success: true, items: employees.map(serializeEmployee) });
  } catch (error) {
    next(error);
  }
};

exports.apiCreateEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizeEmployeePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    if (!payload.ma_nhan_vien) {
      payload.ma_nhan_vien = await getNextCode('chamcongmoi_nhan_vien_' + String(storeId), 'NVM', 6);
    }
    var doc = await ChamCongMoiNhanVien.create(Object.assign({ cua_hang_id: storeId }, payload));
    return res.json({ success: true, item: serializeEmployee(doc.toObject()) });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

exports.apiGetEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var item = await ChamCongMoiNhanVien.findOne({ _id: id, cua_hang_id: storeId }).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    next(error);
  }
};

exports.apiUpdateEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var payload = normalizeEmployeePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    delete payload.ma_nhan_vien;
    var item = await ChamCongMoiNhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: payload },
      { new: true }
    ).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

exports.apiDeleteEmployee = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var item = await ChamCongMoiNhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { trang_thai: 'inactive' } },
      { new: true }
    ).lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: serializeEmployee(item) });
  } catch (error) {
    next(error);
  }
};

exports.apiWeek = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    employee = serializeEmployee(employee);

    var hasMonthSalary = employee.co_luong_theo_thang === true;
    var hasDaySalary = employee.co_luong_theo_ngay === true;
    var mode = hasMonthSalary && hasDaySalary
      ? 'ca_hai'
      : (hasMonthSalary ? 'thang' : 'ngay');

    var response = {
      success: true,
      mode: mode,
      employee: employee,
      has_day_salary: hasDaySalary,
      has_month_salary: hasMonthSalary
    };

    if (hasMonthSalary) {
      var currentMonth = new Date(Date.UTC(todayUtc().getUTCFullYear(), todayUtc().getUTCMonth(), 1));
      var monthStartDate = normalizeMonth(req.query.month_start) || addMonths(currentMonth, -6);
      var latestStart = addMonths(currentMonth, -6);
      if (monthStartDate.getTime() > latestStart.getTime()) monthStartDate = latestStart;
      var monthKeys = [];
      for (var mi = 0; mi < 7; mi += 1) {
        var monthDate = addMonths(monthStartDate, mi);
        if (monthDate.getTime() > currentMonth.getTime()) break;
        monthKeys.push(formatMonth(monthDate));
      }

      var monthRecords = await ChamCongMoiThang.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        thang_cham_cong: { $in: monthKeys }
      }).lean();
      var byMonth = {};
      monthRecords.forEach(function(item) {
        byMonth[item.thang_cham_cong] = item;
      });
      var payrollByMonth = await getPayrollMap(storeId, employeeId, monthKeys);

      response.month_range = {
        tu_thang: monthKeys[0] || formatMonth(monthStartDate),
        den_thang: monthKeys[monthKeys.length - 1] || formatMonth(currentMonth)
      };
      response.months = monthKeys.map(function(key) {
        var record = byMonth[key] || {};
        var hasAttendance = !!(record._id || record.dong_y);
        return {
          key: key,
          label: monthLabel(key),
          is_current: key === formatMonth(currentMonth),
          dong_y: hasAttendance,
          ghi_chu: record.ghi_chu || '',
          payroll: hasAttendance ? (payrollByMonth[key + ':thang'] || null) : null
        };
      });
    }

    if (hasDaySalary || !hasMonthSalary) {
      var today = todayUtc();
      var weekStartDate = normalizeDate(req.query.week_start) || addDays(today, -6);
      var latestWeekStart = addDays(today, -6);
      if (weekStartDate.getTime() > latestWeekStart.getTime()) weekStartDate = latestWeekStart;
      var weekEndDate = minDate(addDays(weekStartDate, 6), today);
      var dayRecords = await ChamCongMoiBanGhi.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: { $gte: weekStartDate, $lte: weekEndDate }
      }).lean();

      var byDate = {};
      dayRecords.forEach(function(item) {
        byDate[formatDate(item.ngay_cham_cong)] = item;
      });

      var days = [];
      var labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
      var todayKey = formatDate(today);
      var totalDays = Math.floor((weekEndDate.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      var dayMonthKeys = [];
      for (var pm = 0; pm < totalDays; pm += 1) {
        dayMonthKeys.push(formatMonth(addDays(weekStartDate, pm)));
      }
      var payrollByDayMonth = await getPayrollMap(storeId, employeeId, dayMonthKeys);
      for (var i = 0; i < totalDays; i += 1) {
        var date = addDays(weekStartDate, i);
        var key = formatDate(date);
        var record = byDate[key] || {};
        var dayIndex = date.getUTCDay();
        var labelIndex = dayIndex === 0 ? 6 : dayIndex - 1;
        var hasAttendance = !!(record._id || record.dong_y);
        days.push({
          key: key,
          label: labels[labelIndex],
          day: pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1),
          is_today: key === todayKey,
          gio_vao: record.gio_vao || '08:00',
          gio_ra: record.gio_ra || '17:30',
          dong_y: hasAttendance,
          ghi_chu: record.ghi_chu || '',
          payroll: hasAttendance ? (payrollByDayMonth[formatMonth(date) + ':ngay'] || null) : null
        });
      }

      response.week = {
        tu_ngay: formatDate(weekStartDate),
        den_ngay: formatDate(weekEndDate)
      };
      response.days = days;
    }

    return res.json(response);
  } catch (error) {
    next(error);
  }
};

exports.apiWeekOld = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');

    var weekStart = startOfWeek(req.query.week_start || new Date());
    var weekEnd = addDays(weekStart, 6);
    var records = await ChamCongMoiBanGhi.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $gte: weekStart, $lte: weekEnd }
    }).lean();

    var byDate = {};
    records.forEach(function(item) {
      byDate[formatDate(item.ngay_cham_cong)] = item;
    });

    var days = [];
    var labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    var today = formatDate(new Date());
    for (var i = 0; i < 7; i += 1) {
      var date = addDays(weekStart, i);
      var key = formatDate(date);
      var record = byDate[key] || {};
      days.push({
        key: key,
        label: labels[i],
        day: pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1),
        is_today: key === today,
        gio_vao: record.gio_vao || '08:00',
        gio_ra: record.gio_ra || '17:30',
        dong_y: !!(record._id || record.dong_y),
        ghi_chu: record.ghi_chu || ''
      });
    }

    return res.json({
      success: true,
      employee: serializeEmployee(employee),
      week: {
        tu_ngay: formatDate(weekStart),
        den_ngay: formatDate(weekEnd)
      },
      days: days
    });
  } catch (error) {
    next(error);
  }
};

exports.apiSaveWeek = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var body = req.body || {};
    var employeeId = String(body.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    employee = serializeEmployee(employee);

    var warnings = [];
    var changedMonths = [];
    var savedDays = 0;
    var savedMonths = 0;

    if (employee.co_luong_theo_thang) {
      var months = Array.isArray(body.months) ? body.months : [];
      for (var mi = 0; mi < months.length; mi += 1) {
        var monthItem = months[mi] || {};
        var monthDate = normalizeMonth(monthItem.thang_cham_cong);
        if (!monthDate) continue;
        var monthKey = formatMonth(monthDate);
        changedMonths.push(monthKey);
        var dongYThang = toBoolean(monthItem.dong_y);
        if (!dongYThang) {
          await ChamCongMoiThang.deleteOne({
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            thang_cham_cong: monthKey
          });
          continue;
        }
        await ChamCongMoiThang.findOneAndUpdate(
          {
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            thang_cham_cong: monthKey
          },
          {
            $set: {
              dong_y: true,
              ghi_chu: String(monthItem.ghi_chu || '').trim()
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );
        savedMonths += 1;
      }
      if (!Number(employee.luong_theo_thang || 0)) {
        warnings.push({
          message: 'Đã lưu chấm công tháng. Vào tab Nhân viên → Sửa để cấu hình lương/tháng, sau đó bảng lương sẽ tự tính tiền.'
        });
      }
    }

    if (employee.co_luong_theo_ngay || !employee.co_luong_theo_thang) {
      var days = Array.isArray(body.days) ? body.days : [];
      var today = todayUtc();
      for (var i = 0; i < days.length; i += 1) {
        var item = days[i] || {};
        var date = normalizeDate(item.ngay_cham_cong);
        if (!date || date.getTime() > today.getTime()) continue;
        changedMonths.push(formatMonth(date));
        var dongY = toBoolean(item.dong_y);
        if (!dongY) {
          await ChamCongMoiBanGhi.deleteOne({
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            ngay_cham_cong: date
          });
          continue;
        }
        var gioVao = cleanTime(item.gio_vao);
        var gioRa = cleanTime(item.gio_ra);
        if (gioVao === null || gioRa === null) {
          return jsonError(res, 400, 'Giờ chấm công không hợp lệ ở ngày ' + formatDate(date) + '. Dùng định dạng HH:mm');
        }
        if (!gioVao) gioVao = '08:00';
        if (!gioRa) gioRa = '17:30';
        var ghiChu = String(item.ghi_chu || '').trim();
        await ChamCongMoiBanGhi.findOneAndUpdate(
          {
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            ngay_cham_cong: date
          },
          {
            $set: {
              gio_vao: gioVao,
              gio_ra: gioRa,
              dong_y: true,
              ghi_chu: ghiChu
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );
        savedDays += 1;
      }
      if (employee.co_luong_theo_ngay && !Number(employee.luong_theo_ngay || 0)) {
        warnings.push({
          message: 'Đã lưu ngày công. Vào tab Nhân viên → Sửa để cấu hình lương/ngày, sau đó bảng lương sẽ tự tính tiền.'
        });
      }
    }

    changedMonths = uniqueValues(changedMonths);
    var existingPayrolls = await getPayrollMap(storeId, employeeId, changedMonths);
    Object.keys(existingPayrolls).forEach(function(key) {
      warnings.push(existingPayrolls[key]);
    });
    await rebuildPayrolls(storeId, employee, changedMonths);
    return res.json({
      success: true,
      saved: savedDays + savedMonths,
      saved_days: savedDays,
      saved_months: savedMonths,
      warnings: warnings
    });
  } catch (error) {
    next(error);
  }
};

exports.apiPayrolls = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var filter = {
      cua_hang_id: storeId,
      trang_thai: String(req.query.trang_thai || 'can_thanh_toan').trim() === 'da_thanh_toan'
        ? 'da_thanh_toan'
        : 'can_thanh_toan'
    };
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (employeeId) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Nhân viên không hợp lệ');
      filter.nhan_vien_id = employeeId;
      if (filter.trang_thai === 'can_thanh_toan') {
        await rebuildEmployeePayrollsFromAttendance(storeId, employeeId);
      }
    }
    var items = await ChamCongMoiBangLuong.find(filter)
      .sort({ thang_bang_luong: -1, ten_nhan_vien: 1 })
      .lean();
    var enriched = [];
    for (var i = 0; i < items.length; i += 1) {
      enriched.push(await enrichPayrollItem(storeId, items[i]));
    }
    var attendanceCount = 0;
    if (employeeId) {
      attendanceCount = await ChamCongMoiBanGhi.countDocuments({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        dong_y: true
      });
    }
    return res.json({
      success: true,
      items: enriched,
      attendance_count: attendanceCount
    });
  } catch (error) {
    next(error);
  }
};

exports.apiPayrollPaymentPreview = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payrollId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(payrollId)) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');

    var payroll = await ChamCongMoiBangLuong.findOne({
      _id: payrollId,
      cua_hang_id: storeId
    }).lean();
    if (!payroll) return jsonError(res, 404, 'Không tìm thấy bảng lương');

    payroll = await enrichPayrollItem(storeId, payroll);
    return res.json({
      success: true,
      item: payroll,
      con_thanh_toan: Number(payroll.tong_tien || 0),
      da_thanh_toan: !!payroll.da_thanh_toan,
      phieu_chi: payroll.phieu_chi || null
    });
  } catch (error) {
    next(error);
  }
};

exports.apiPayrollCreatePhieuChi = async function(req, res, next) {
  var session;
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payrollId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(payrollId)) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');

    var payroll = await ChamCongMoiBangLuong.findOne({
      _id: payrollId,
      cua_hang_id: storeId
    }).lean();
    if (!payroll) return jsonError(res, 404, 'Không tìm thấy bảng lương');
    if (payroll.trang_thai === 'da_thanh_toan') return jsonError(res, 400, 'Bảng lương đã thanh toán');

    var existingReceipt = await loadPayrollPhieuChi(storeId, payrollId);
    if (existingReceipt) return jsonError(res, 400, 'Đã có phiếu chi cho bảng lương này');

    var tongTien = Number(payroll.tong_tien || 0);
    if (tongTien <= 0) return jsonError(res, 400, 'Bảng lương chưa có số tiền cần thanh toán');

    var body = req.body || {};
    var paymentDetail = extractPaymentDetail({
      tien_mat: body.tien_mat,
      chuyen_khoan: body.chuyen_khoan,
      so_quy_tien_mat_id: body.so_quy_tien_mat_id,
      so_quy_chuyen_khoan_id: body.so_quy_chuyen_khoan_id,
      chi_tiet_thanh_toan: body.chi_tiet_thanh_toan
    });
    var tongChi = paymentDetail.tien_mat + paymentDetail.chuyen_khoan;
    if (tongChi <= 0) return jsonError(res, 400, 'Vui lòng nhập số tiền thanh toán');
    if (tongChi !== tongTien) {
      return jsonError(res, 400, 'Số tiền thanh toán phải bằng ' + tongTien.toLocaleString('vi-VN') + ' đ');
    }

    var receipt;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var lockedPayroll = await ChamCongMoiBangLuong.findOne({
        _id: payrollId,
        cua_hang_id: storeId,
        trang_thai: 'can_thanh_toan'
      }).session(session);
      if (!lockedPayroll) throw new Error('Bảng lương không còn ở trạng thái cần thanh toán');

      receipt = await taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'tra_luong_nhan_vien',
        cua_hang_id: storeId,
        nguoi_tao_id: req.user && req.user._id,
        nhom_doi_tuong: 'nhan_vien',
        doi_tuong: lockedPayroll.ten_nhan_vien || lockedPayroll.ma_nhan_vien || 'Nhân viên',
        chamcongmoi_bang_luong_id: lockedPayroll._id,
        ma_chung_tu_goc: lockedPayroll.ma_bang_luong || '',
        hach_toan: false,
        payment_v2: true,
        tien_mat: paymentDetail.tien_mat,
        chuyen_khoan: paymentDetail.chuyen_khoan,
        so_quy_tien_mat_id: body.so_quy_tien_mat_id,
        so_quy_chuyen_khoan_id: body.so_quy_chuyen_khoan_id,
        ghi_chu: String(body.ghi_chu || '').trim() || (
          'Thanh toán lương ' + (lockedPayroll.ma_bang_luong || '') +
          ' - ' + (lockedPayroll.ten_nhan_vien || lockedPayroll.ma_nhan_vien || 'nhân viên')
        ),
        session: session
      });

      await ChamCongMoiBangLuong.updateOne(
        { _id: lockedPayroll._id, cua_hang_id: storeId },
        { $set: { trang_thai: 'da_thanh_toan' } },
        { session: session }
      );
    });
    await session.endSession();

    return res.json({
      success: true,
      message: 'Đã tạo phiếu chi',
      receipt: {
        _id: String(receipt._id),
        ma_phieu: receipt.ma_phieu || '',
        gia_tri: Number(receipt.gia_tri || 0)
      }
    });
  } catch (error) {
    if (session) {
      try { await session.endSession(); } catch (endError) { /* ignore */ }
    }
    if (error && error.message) return jsonError(res, 400, error.message);
    next(error);
  }
};

exports.apiSaveWeekOld = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var body = req.body || {};
    var employeeId = String(body.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).select('_id').lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');

    var days = Array.isArray(body.days) ? body.days : [];
    var saved = 0;
    for (var i = 0; i < days.length; i += 1) {
      var item = days[i] || {};
      var date = normalizeDate(item.ngay_cham_cong);
      if (!date) continue;
      var dongY = item.dong_y === true || item.dong_y === 'true' || item.dong_y === 1 || item.dong_y === '1';
      if (!dongY) {
        await ChamCongMoiBanGhi.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        });
        continue;
      }
      var gioVao = cleanTime(item.gio_vao);
      var gioRa = cleanTime(item.gio_ra);
      if (gioVao === null || gioRa === null) {
        return jsonError(res, 400, 'Giờ chấm công không hợp lệ. Dùng định dạng HH:mm');
      }
      var ghiChu = String(item.ghi_chu || '').trim();
      if (!gioVao && !gioRa && !ghiChu) {
        await ChamCongMoiBanGhi.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        });
        continue;
      }
      await ChamCongMoiBanGhi.findOneAndUpdate(
        {
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        },
        {
          $set: {
            gio_vao: gioVao,
            gio_ra: gioRa,
            dong_y: true,
            ghi_chu: ghiChu
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      saved += 1;
    }

    return res.json({ success: true, saved: saved });
  } catch (error) {
    next(error);
  }
};
