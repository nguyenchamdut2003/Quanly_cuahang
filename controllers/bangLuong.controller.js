var mongoose = require('mongoose');
var {
  BangLuong,
  ChiTietBangLuong,
  ChamCong,
  NhanVien,
  NgayLeTet
} = require('../models/hr.model');
var {
  PhieuThuChi,
  SoQuy
} = require('../models/kiot.model');
var { taoPhieuThuChi } = require('../services/soQuy.service');
var { resolveStoreId } = require('../utils/storeScope');
var {
  normalizeWorkDate,
  formatDateInputVN,
  getWorkDaysConfig,
  getThuTrongTuan
} = require('../utils/hrWorkDay');
var { makeBangLuongCode, makePayrollPaymentCode } = require('../utils/hrCode');
var hrLog = require('../utils/hrPayrollLogger');

var PAY_DETAIL_OVERPAY_MSG = 'So tien tra vuot qua so tien con can tra hoac dong luong khong con hop le.';
var PAY_CASHBOOK_INVALID_MSG = 'So quy khong hop le hoac da ngung su dung.';
var PAY_RECEIPT_CANCEL_INVALID_MSG = 'Phieu luong khong hop le hoac da duoc huy.';

var PAYROLL_STATUSES = ['draft', 'calculated', 'locked', 'cancelled'];
var PAYMENT_METHODS = ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'];
var PAYROLL_VALID_CHAM_CONG_STATUSES = [
  'dung_gio',
  'di_muon',
  've_som',
  'di_muon_ve_som',
  'cham_cong_thieu'
];
var PAYROLL_LOAI_LUONG_VALID = ['theo_ca', 'theo_ngay', 'theo_gio', 'theo_thang'];
var PAYROLL_RECALC_BLOCK_MSG =
  'Bảng lương đã có thanh toán, không thể tính lại. Vui lòng hủy thanh toán trước hoặc tạo bảng lương điều chỉnh.';

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function pickObjectId(value) {
  value = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
}

function toNumber(value, fallback) {
  var num = Number(value);
  if (!Number.isFinite(num)) return fallback || 0;
  return num;
}

function money(value) {
  var num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

function formatDateVN(value) {
  if (!value) return '';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getDate()).padStart(2, '0') + '/' +
    String(date.getMonth() + 1).padStart(2, '0') + '/' +
    date.getFullYear();
}

function payrollStatusLabel(status) {
  if (status === 'calculated') return 'Đã tính';
  if (status === 'locked') return 'Đã chốt';
  if (status === 'cancelled') return 'Đã hủy';
  return 'Tạm tính';
}

function buildPayrollSlipCode(detail, payroll) {
  payroll = payroll || {};
  if (payroll.ma_bang_luong) return String(payroll.ma_bang_luong).replace(/^BL/, 'PL');
  var raw = String(detail && detail._id ? detail._id : '');
  return raw ? ('PL' + raw.slice(-6).toUpperCase()) : '---';
}

function buildPayrollSlipRow(detail) {
  var payroll = detail && detail.bang_luong_id && typeof detail.bang_luong_id === 'object'
    ? detail.bang_luong_id
    : {};
  var status = detail.trang_thai || payroll.trang_thai || 'draft';
  return {
    _id: detail._id,
    bang_luong_id: payroll._id || detail.bang_luong_id,
    ma_phieu: buildPayrollSlipCode(detail, payroll),
    ky_lam_viec: formatDateVN(detail.tu_ngay || payroll.tu_ngay) + ' - ' + formatDateVN(detail.den_ngay || payroll.den_ngay),
    tu_ngay: detail.tu_ngay || payroll.tu_ngay,
    den_ngay: detail.den_ngay || payroll.den_ngay,
    tong_luong: money(detail.tong_luong),
    da_tra: money(detail.da_tra),
    con_can_tra: money(detail.con_can_tra),
    trang_thai: status,
    trang_thai_label: payrollStatusLabel(status),
    ten_bang_luong: payroll.ten_bang_luong || '',
    ma_bang_luong: payroll.ma_bang_luong || ''
  };
}

function csvCell(value) {
  var text = String(value == null ? '' : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function parseMoney(value) {
  return money(String(value || '').replace(/\./g, '').replace(/,/g, ''));
}

function clonePlain(value) {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value));
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

async function countStandardWorkDays(storeId, tuNgay, denNgay) {
  var workDays = await getWorkDaysConfig(storeId);
  var holidays = await NgayLeTet.find({
    cua_hang_id: storeId,
    trang_thai: 'active',
    tu_ngay: { $lte: denNgay },
    den_ngay: { $gte: tuNgay }
  }).select('tu_ngay den_ngay').lean();
  var holidayDates = {};
  holidays.forEach(function(holiday) {
    var cursor = normalizeWorkDate(holiday.tu_ngay);
    var end = normalizeWorkDate(holiday.den_ngay);
    if (!cursor || !end) return;
    if (cursor.getTime() < tuNgay.getTime()) cursor = normalizeWorkDate(tuNgay);
    if (end.getTime() > denNgay.getTime()) end = normalizeWorkDate(denNgay);
    for (; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
      holidayDates[formatDateInputVN(cursor)] = true;
    }
  });
  var count = 0;
  for (var cursor = new Date(tuNgay); cursor.getTime() <= denNgay.getTime(); cursor = addDays(cursor, 1)) {
    if (holidayDates[formatDateInputVN(cursor)]) continue;
    if (workDays.indexOf(getThuTrongTuan(cursor)) >= 0) count += 1;
  }
  return count || 26;
}

function defaultDateRange() {
  var nowText = formatDateInputVN(new Date());
  var parts = nowText.split('-').map(Number);
  var year = parts[0];
  var month = parts[1];
  var start = year + '-' + String(month).padStart(2, '0') + '-01';
  var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  var end = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  return { tu_ngay: normalizeWorkDate(start), den_ngay: normalizeWorkDate(end) };
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ma_bang_luong: regex }, { ten_bang_luong: regex }, { ghi_chu: regex }];
  }
  var tuNgay = normalizeWorkDate(query.tu_ngay);
  var denNgay = normalizeWorkDate(query.den_ngay);
  if (tuNgay) filter.den_ngay = { $gte: tuNgay };
  if (denNgay) filter.tu_ngay = { $lte: denNgay };
  var trangThai = String(query.trang_thai || '').trim();
  if (PAYROLL_STATUSES.indexOf(trangThai) >= 0) filter.trang_thai = trangThai;
  return filter;
}

function validatePayrollPayload(body) {
  body = body || {};
  var tenBangLuong = String(body.ten_bang_luong || '').trim();
  var tuNgay = normalizeWorkDate(body.tu_ngay);
  var denNgay = normalizeWorkDate(body.den_ngay);
  if (!tenBangLuong) return { error: 'Tên bảng lương là bắt buộc' };
  if (!tuNgay) return { error: 'Từ ngày không hợp lệ' };
  if (!denNgay) return { error: 'Đến ngày không hợp lệ' };
  if (denNgay.getTime() < tuNgay.getTime()) return { error: 'Đến ngày không được nhỏ hơn từ ngày' };
  return {
    payload: {
      ten_bang_luong: tenBangLuong,
      tu_ngay: tuNgay,
      den_ngay: denNgay,
      ghi_chu: String(body.ghi_chu || '').trim() || undefined
    }
  };
}

function countByStatus(items, statuses) {
  return items.filter(function(item) {
    return statuses.indexOf(item.trang_thai) >= 0;
  }).length;
}

function normalizeCaId(value) {
  if (!value) return '';
  if (value && typeof value === 'object' && value._id) value = value._id;
  return String(value);
}

function getAdvancedSalarySetup(salarySetup, chamCongRow) {
  var advanced = salarySetup.muc_luong_nang_cao || {};
  var rows = Array.isArray(advanced.dieu_kien) ? advanced.dieu_kien : [];
  var caText = normalizeCaId(chamCongRow && chamCongRow.ca_lam_viec_id);
  if (caText) {
    var byId = rows.find(function(row) {
      return row && row.ca_lam_viec_id && normalizeCaId(row.ca_lam_viec_id) === caText;
    });
    if (byId) return byId;
  }
  var tenCa = String((chamCongRow && chamCongRow.ten_ca) || '').trim().toLowerCase();
  if (!tenCa) return null;
  return rows.find(function(row) {
    var rowName = String(row.ten_ca || row.ten_dieu_kien || '').trim().toLowerCase();
    return rowName && rowName === tenCa;
  }) || null;
}

function dayPayForBase(basePay, source, chamCong) {
  source = source || {};
  var loaiNgay = chamCong.loai_ngay || 'ngay_thuong';
  var value = Number(source[loaiNgay]);
  var kind = source[loaiNgay + '_kieu'];
  if (loaiNgay === 'ngay_le_tet' && (!Number.isFinite(value) || value <= 0)) {
    value = Number(chamCong.he_so_luong_ngay || 100);
    kind = 'phan_tram';
  }
  if (kind === 'vnd') {
    if (Number.isFinite(value) && value > 0) return money(value);
    kind = 'phan_tram';
    value = 100;
  }
  if (!Number.isFinite(value) || value <= 0) value = 100;
  return money(basePay * Number(value || 100) / 100);
}

function calcShiftSalary(salarySetup, chamCongs) {
  return chamCongs.reduce(function(total, row) {
    if (row.trang_thai === 'nghi_lam') return total;
    var condition = getAdvancedSalarySetup(salarySetup, row);
    var basePay = toNumber(condition && condition.muc_luong, 0) || toNumber(salarySetup.muc_luong, 0);
    var daySource = condition || (salarySetup.muc_luong_nang_cao || {});
    // Luong theo ca tra theo so ca hop le; di muon/ve som xu ly bang giam tru, khong prorate theo cong_quy_doi.
    return total + dayPayForBase(basePay, daySource, row);
  }, 0);
}

function calcAllowances(salarySetup, stats) {
  var phuCap = salarySetup.phu_cap || {};
  if (!phuCap.enabled || !Array.isArray(phuCap.items)) return 0;
  return money(phuCap.items.reduce(function(total, item) {
    var amount = toNumber(item && item.so_tien, 0);
    if (!amount) return total;
    if (item.loai_phu_cap === 'theo_ngay_cong') return total + amount * stats.tong_cong_quy_doi;
    if (item.loai_phu_cap === 'theo_ca') return total + amount * stats.tong_ca;
    if (item.loai_phu_cap === 'theo_gio') return total + amount * stats.tong_phut_lam_viec / 60;
    return total + amount;
  }, 0));
}

function calcDeductions(salarySetup, stats) {
  var giamTru = salarySetup.giam_tru || {};
  if (!giamTru.enabled || !Array.isArray(giamTru.items)) return 0;
  return money(giamTru.items.reduce(function(total, item) {
    var amount = toNumber(item && item.gia_tri, 0);
    if (!amount) return total;
    if (item.kieu_tinh === 'so_tien_co_dinh') return total + amount;
    if (item.kieu_tinh !== 'theo_so_lan') return total;
    if (item.loai_giam_tru === 'di_muon') return total + amount * stats.so_lan_di_muon;
    if (item.loai_giam_tru === 've_som') return total + amount * stats.so_lan_ve_som;
    if (item.loai_giam_tru === 'nghi_khong_phep' || item.loai_giam_tru === 'nghi_lam') {
      return total + amount * stats.so_lan_nghi_lam;
    }
    return total;
  }, 0));
}

function isPayrollWorkRow(row) {
  return Number(row.cong_quy_doi || 0) > 0 || Number(row.so_phut_lam_viec || 0) > 0;
}

function buildStats(chamCongs) {
  var validWorkRows = chamCongs.filter(isPayrollWorkRow);
  return {
    tong_ca: validWorkRows.length,
    tong_cong_quy_doi: validWorkRows.reduce(function(sum, row) { return sum + Number(row.cong_quy_doi || 0); }, 0),
    tong_phut_lam_viec: validWorkRows.reduce(function(sum, row) { return sum + Number(row.so_phut_lam_viec || 0); }, 0),
    tong_phut_tang_ca: validWorkRows.reduce(function(sum, row) { return sum + Number(row.so_phut_tang_ca || 0); }, 0),
    tong_phut_tang_ca_truoc_ca: validWorkRows.reduce(function(sum, row) { return sum + Number(row.so_phut_tang_ca_truoc_ca || 0); }, 0),
    tong_phut_tang_ca_sau_ca: validWorkRows.reduce(function(sum, row) { return sum + Number(row.so_phut_tang_ca_sau_ca || 0); }, 0),
    so_lan_di_muon: countByStatus(chamCongs, ['di_muon', 'di_muon_ve_som']),
    so_lan_ve_som: countByStatus(chamCongs, ['ve_som', 'di_muon_ve_som']),
    so_lan_nghi_lam: 0
  };
}

function countShiftSalaryRules(setup) {
  var advanced = setup.muc_luong_nang_cao || {};
  var conditions = Array.isArray(advanced.dieu_kien) ? advanced.dieu_kien : [];
  return conditions.filter(function(row) {
    if (!row || toNumber(row.muc_luong, 0) <= 0) return false;
    return !!pickObjectId(row.ca_lam_viec_id) || !!(row.ten_ca || row.ten_dieu_kien);
  }).length;
}

function validateEmployeeSalarySetup(employee) {
  var setup = employee.salary_setup || {};
  if (!setup.enabled) {
    return { ok: false, reason: 'salary_setup chưa bật (enabled=false)' };
  }
  var loaiLuong = String(setup.loai_luong || '').trim();
  if (PAYROLL_LOAI_LUONG_VALID.indexOf(loaiLuong) < 0) {
    return { ok: false, reason: 'loai_luong không hợp lệ: ' + (loaiLuong || '(trống)') };
  }
  var mucLuong = toNumber(setup.muc_luong, 0);
  if (loaiLuong === 'theo_ca') {
    var shiftRuleCount = countShiftSalaryRules(setup);
    if (mucLuong > 0 || shiftRuleCount > 0) {
      return { ok: true, loaiLuong: loaiLuong };
    }
    return { ok: false, reason: 'theo_ca: muc_luong <= 0 và không có rule ca riêng' };
  }
  if (mucLuong <= 0) {
    return { ok: false, reason: 'muc_luong <= 0' };
  }
  return { ok: true, loaiLuong: loaiLuong };
}

function payrollRecalcBlockedError() {
  var err = new Error(PAYROLL_RECALC_BLOCK_MSG);
  err.code = 'PAYROLL_RECALC_BLOCKED';
  return err;
}

async function resolvePayrollCashBook(storeId, paymentMethod, cashBookId, session) {
  if (!cashBookId) return null;
  return SoQuy.findOne({
    _id: cashBookId,
    cua_hang_id: storeId,
    trang_thai: 'active'
  }).session(session || null);
}

async function assertPayrollCanRecalculate(storeId, payroll) {
  if (money(payroll.da_tra_nhan_vien) > 0) {
    throw payrollRecalcBlockedError();
  }
  var paidDetailCount = await ChiTietBangLuong.countDocuments({
    bang_luong_id: payroll._id,
    cua_hang_id: storeId,
    da_tra: { $gt: 0 }
  });
  if (paidDetailCount > 0) {
    throw payrollRecalcBlockedError();
  }
  var paidReceiptCount = await PhieuThuChi.countDocuments({
    cua_hang_id: storeId,
    bang_luong_id: payroll._id,
    loai_phieu: 'chi',
    loai_thu_chi: 'tra_luong_nhan_vien',
    trang_thai: 'paid'
  });
  if (paidReceiptCount > 0) {
    throw payrollRecalcBlockedError();
  }
}

function calcMainSalary(salarySetup, stats, chamCongs, standardDays) {
  var loaiLuong = salarySetup.loai_luong || 'theo_ca';
  var base = toNumber(salarySetup.muc_luong, 0);
  if (loaiLuong === 'theo_thang') {
    return money(base * stats.tong_cong_quy_doi / Math.max(standardDays || 26, 1));
  }
  if (loaiLuong === 'theo_gio') {
    return money(base * stats.tong_phut_lam_viec / 60);
  }
  if (loaiLuong === 'theo_ngay') {
    return money(base * stats.tong_cong_quy_doi);
  }
  return money(calcShiftSalary(salarySetup, chamCongs));
}

async function buildPayrollDetail(storeId, payroll, employee, chamCongs, standardDays) {
  var salarySetup = clonePlain(employee.salary_setup || {});
  var stats = buildStats(chamCongs);
  var luongChinh = calcMainSalary(salarySetup, stats, chamCongs, standardDays);
  var tienTangCa = 0;
  var tienThuong = 0;
  var tienHoaHong = 0;
  var tienPhuCap = calcAllowances(salarySetup, stats);
  var tienGiamTru = calcDeductions(salarySetup, stats);
  var tongLuong = money(luongChinh + tienTangCa + tienThuong + tienHoaHong + tienPhuCap - tienGiamTru);
  var daTra = 0;

  return Object.assign({
    cua_hang_id: storeId,
    bang_luong_id: payroll._id,
    nhan_vien_id: employee._id,
    ma_nhan_vien: employee.ma_nhan_vien,
    ten_nhan_vien: employee.ten_nhan_vien,
    phong_ban_id: employee.phong_ban_id,
    chuc_danh_id: employee.chuc_danh_id,
    tu_ngay: payroll.tu_ngay,
    den_ngay: payroll.den_ngay,
    luong_chinh: luongChinh,
    tien_tang_ca: tienTangCa,
    tien_thuong: tienThuong,
    tien_hoa_hong: tienHoaHong,
    tien_phu_cap: tienPhuCap,
    tien_giam_tru: tienGiamTru,
    tong_luong: tongLuong,
    da_tra: daTra,
    con_can_tra: tongLuong - daTra,
    snapshot_salary_setup: salarySetup,
    snapshot_cham_cong_ids: chamCongs.map(function(row) { return row._id; }),
    trang_thai: 'calculated'
  }, stats);
}

async function calculatePayroll(storeId, payroll) {
  await assertPayrollCanRecalculate(storeId, payroll);

  hrLog.logPayrollDebug('payroll.calculate.fetch_cham_cong', {
    bang_luong_id: hrLog.idStr(payroll._id),
    cua_hang_id: hrLog.idStr(storeId),
    tu_ngay: payroll.tu_ngay,
    den_ngay: payroll.den_ngay,
    trang_thai_hop_le: PAYROLL_VALID_CHAM_CONG_STATUSES
  });

  var chamCongs = await ChamCong.find({
    cua_hang_id: storeId,
    da_duyet: true,
    ngay_cham_cong: { $gte: payroll.tu_ngay, $lte: payroll.den_ngay },
    trang_thai: { $in: PAYROLL_VALID_CHAM_CONG_STATUSES }
  }).sort({ nhan_vien_id: 1, ngay_cham_cong: 1 }).lean();

  hrLog.logPayrollInfo('payroll.calculate.fetch_cham_cong', {
    bang_luong_id: hrLog.idStr(payroll._id),
    cham_cong_hop_le: chamCongs.length
  });

  var groups = {};
  chamCongs.forEach(function(row) {
    var key = String(row.nhan_vien_id || '');
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  var employeeIds = Object.keys(groups).map(function(id) { return new mongoose.Types.ObjectId(id); });
  var employees = await NhanVien.find({ _id: { $in: employeeIds }, cua_hang_id: storeId }).lean();
  var employeeMap = {};
  employees.forEach(function(emp) {
    employeeMap[String(emp._id)] = emp;
  });

  hrLog.logPayrollInfo('payroll.calculate.employee_group', {
    bang_luong_id: hrLog.idStr(payroll._id),
    so_nhom_nhan_vien: employeeIds.length,
    so_nhan_vien_tim_thay: employees.length
  });

  var standardDays = await countStandardWorkDays(storeId, payroll.tu_ngay, payroll.den_ngay);
  var details = [];
  var skippedEmployees = 0;
  for (var i = 0; i < employeeIds.length; i += 1) {
    var empId = String(employeeIds[i]);
    var employee = employeeMap[empId];
    if (!employee) {
      hrLog.logPayrollWarn('payroll.calculate.skip_employee', {
        bang_luong_id: hrLog.idStr(payroll._id),
        nhan_vien_id: empId,
        reason: 'Không tìm thấy nhân viên cùng cửa hàng'
      });
      skippedEmployees += 1;
      continue;
    }
    var salaryCheck = validateEmployeeSalarySetup(employee);
    if (!salaryCheck.ok) {
      skippedEmployees += 1;
      var salarySetup = employee.salary_setup || {};
      hrLog.logPayrollWarn('payroll.calculate.skip_employee', {
        bang_luong_id: hrLog.idStr(payroll._id),
        nhan_vien_id: hrLog.idStr(employee._id),
        ma_nhan_vien: employee.ma_nhan_vien,
        ten_nhan_vien: employee.ten_nhan_vien,
        reason: salaryCheck.reason,
        salary_enabled: !!salarySetup.enabled,
        loai_luong: salarySetup.loai_luong || '',
        muc_luong: toNumber(salarySetup.muc_luong, 0),
        so_rule_ca_rieng: countShiftSalaryRules(salarySetup)
      });
      continue;
    }
    var detailRow = await buildPayrollDetail(storeId, payroll, employee, groups[empId], standardDays);
    details.push(detailRow);
    hrLog.logPayrollDebug('payroll.calculate.detail_created', hrLog.logEmployeeDetail(detailRow));
  }

  if (skippedEmployees) {
    hrLog.logPayrollInfo('payroll.calculate.skipped_summary', {
      bang_luong_id: hrLog.idStr(payroll._id),
      skipped_count: skippedEmployees
    });
  }

  await ChiTietBangLuong.deleteMany({ bang_luong_id: payroll._id, cua_hang_id: storeId });
  if (details.length) await ChiTietBangLuong.insertMany(details);

  var totals = details.reduce(function(sum, row) {
    sum.tong_nhan_vien += 1;
    sum.tong_cong += Number(row.tong_cong_quy_doi || 0);
    sum.tong_phut_lam_viec += Number(row.tong_phut_lam_viec || 0);
    sum.tong_phut_tang_ca += Number(row.tong_phut_tang_ca || 0);
    sum.tong_luong_chinh += Number(row.luong_chinh || 0);
    sum.tong_tien_tang_ca += Number(row.tien_tang_ca || 0);
    sum.tong_thuong += Number(row.tien_thuong || 0);
    sum.tong_hoa_hong += Number(row.tien_hoa_hong || 0);
    sum.tong_phu_cap += Number(row.tien_phu_cap || 0);
    sum.tong_giam_tru += Number(row.tien_giam_tru || 0);
    sum.tong_luong += Number(row.tong_luong || 0);
    sum.da_tra_nhan_vien += Number(row.da_tra || 0);
    sum.con_can_tra += Number(row.con_can_tra || 0);
    return sum;
  }, {
    tong_nhan_vien: 0,
    tong_cong: 0,
    tong_phut_lam_viec: 0,
    tong_phut_tang_ca: 0,
    tong_luong_chinh: 0,
    tong_tien_tang_ca: 0,
    tong_thuong: 0,
    tong_hoa_hong: 0,
    tong_phu_cap: 0,
    tong_giam_tru: 0,
    tong_luong: 0,
    da_tra_nhan_vien: 0,
    con_can_tra: 0
  });

  Object.assign(payroll, totals);
  payroll.trang_thai = 'calculated';
  await payroll.save();

  hrLog.logPayrollInfo('payroll.calculate.summary', Object.assign({
    so_chi_tiet: details.length
  }, hrLog.logPayrollSummary(payroll)));

  return { payroll: payroll, details: details };
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var range = defaultDateRange();
    res.render('bang-luong/index', {
      title: 'Bảng lương',
      activeMenu: 'nhan-vien',
      activeHrPage: 'bang-luong',
      user: req.user,
      filterDefaults: {
        tu_ngay: formatDateInputVN(range.tu_ngay),
        den_ngay: formatDateInputVN(range.den_ngay)
      },
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.detail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    res.render('bang-luong/detail', {
      title: 'Chi tiết bảng lương',
      activeMenu: 'nhan-vien',
      activeHrPage: 'bang-luong',
      user: req.user,
      payrollId: req.params.id,
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.apiList = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var items = await BangLuong.find(buildListQuery(storeId, req.query))
      .sort({ tu_ngay: -1, created_at: -1 })
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

async function loadEmployeePayrollSlips(storeId, employeeId, query) {
  var filter = {
    cua_hang_id: storeId,
    nhan_vien_id: employeeId
  };
  var trangThai = String((query || {}).trang_thai || '').trim();
  if (PAYROLL_STATUSES.indexOf(trangThai) >= 0) filter.trang_thai = trangThai;
  var details = await ChiTietBangLuong.find(filter)
    .populate('bang_luong_id', 'ma_bang_luong ten_bang_luong tu_ngay den_ngay trang_thai')
    .sort({ tu_ngay: -1, created_at: -1 })
    .lean();
  return details.map(buildPayrollSlipRow);
}

exports.apiEmployeePayrollSlips = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = pickObjectId(req.params.employeeId);
    if (!employeeId) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var employee = await NhanVien.findOne({ _id: employeeId, cua_hang_id: storeId }).select('_id').lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    var items = await loadEmployeePayrollSlips(storeId, employeeId, req.query || {});
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiExportEmployeePayrollSlips = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = pickObjectId(req.params.employeeId);
    if (!employeeId) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var employee = await NhanVien.findOne({ _id: employeeId, cua_hang_id: storeId })
      .select('ma_nhan_vien ten_nhan_vien')
      .lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    var items = await loadEmployeePayrollSlips(storeId, employeeId, req.query || {});
    var lines = [
      ['Mã phiếu', 'Kỳ làm việc', 'Tổng lương', 'Đã trả', 'Còn cần trả', 'Trạng thái'].map(csvCell).join(',')
    ];
    items.forEach(function(item) {
      lines.push([
        item.ma_phieu,
        item.ky_lam_viec,
        item.tong_luong,
        item.da_tra,
        item.con_can_tra,
        item.trang_thai_label
      ].map(csvCell).join(','));
    });
    var filename = 'phieu-luong-' + String(employee.ma_nhan_vien || employee._id) + '.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '') + '"');
    return res.send('\ufeff' + lines.join('\r\n'));
  } catch (error) {
    next(error);
  }
};

exports.apiDetail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = pickObjectId(req.params.id);
    if (!id) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');
    var item = await BangLuong.findOne({ _id: id, cua_hang_id: storeId })
      .populate('nguoi_chot_id', 'ten_dang_nhap ho_ten username email')
      .lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy bảng lương');
    var details = await ChiTietBangLuong.find({ bang_luong_id: id, cua_hang_id: storeId })
      .populate('phong_ban_id', 'ten_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh')
      .sort({ ten_nhan_vien: 1 })
      .lean();
    var payments = await PhieuThuChi.find({
      cua_hang_id: storeId,
      bang_luong_id: id,
      loai_phieu: 'chi',
      loai_thu_chi: 'tra_luong_nhan_vien'
    })
      .populate('so_quy_id', 'ten_so_quy')
      .populate('nhan_vien_id', 'ma_nhan_vien ten_nhan_vien')
      .sort({ ngay_lap: -1, created_at: -1 })
      .lean();
    return res.json({ success: true, item: item, details: details, payments: payments });
  } catch (error) {
    next(error);
  }
};

exports.apiCreate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    hrLog.logPayrollInfo('payroll.create.start', Object.assign({}, hrLog.buildRequestContext(req), {
      cua_hang_id: hrLog.idStr(storeId)
    }));
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var built = validatePayrollPayload(req.body);
    if (built.error) {
      hrLog.logPayrollWarn('payroll.create.error', { message: built.error, cua_hang_id: hrLog.idStr(storeId) });
      return jsonError(res, 400, built.error);
    }
    var maBangLuong = await makeBangLuongCode(storeId);
    var doc = await BangLuong.create(Object.assign({
      cua_hang_id: storeId,
      ma_bang_luong: maBangLuong,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      trang_thai: 'draft'
    }, built.payload));
    hrLog.logPayrollInfo('payroll.create.success', {
      cua_hang_id: hrLog.idStr(storeId),
      bang_luong_id: hrLog.idStr(doc._id),
      ma_bang_luong: doc.ma_bang_luong,
      ten_bang_luong: doc.ten_bang_luong,
      tu_ngay: doc.tu_ngay,
      den_ngay: doc.den_ngay
    });
    return res.json({ success: true, item: doc });
  } catch (error) {
    hrLog.logPayrollError('payroll.create.error', error, hrLog.buildRequestContext(req));
    next(error);
  }
};

exports.apiCalculate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var id = pickObjectId(req.params.id);
    hrLog.logPayrollInfo('payroll.calculate.start', Object.assign({}, hrLog.buildRequestContext(req), {
      cua_hang_id: hrLog.idStr(storeId),
      bang_luong_id: hrLog.idStr(id)
    }));
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    if (!id) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');
    var doc = await BangLuong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy bảng lương');
    if (doc.trang_thai === 'locked') return jsonError(res, 400, 'Bảng lương đã chốt, không thể tính lại');
    if (doc.trang_thai === 'cancelled') return jsonError(res, 400, 'Bảng lương đã hủy, không thể tính lương');
    var result = await calculatePayroll(storeId, doc);
    hrLog.logPayrollInfo('payroll.calculate.success', Object.assign({
      detail_count: result.details.length
    }, hrLog.logPayrollSummary(result.payroll)));
    return res.json({ success: true, item: result.payroll, detailCount: result.details.length });
  } catch (error) {
    if (error && error.code === 'PAYROLL_RECALC_BLOCKED') {
      hrLog.logPayrollWarn('payroll.calculate.blocked', {
        bang_luong_id: hrLog.idStr(id),
        message: error.message
      });
      return jsonError(res, 400, error.message);
    }
    hrLog.logPayrollError('payroll.calculate.error', error, hrLog.buildRequestContext(req));
    next(error);
  }
};

exports.apiLock = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var id = pickObjectId(req.params.id);
    hrLog.logPayrollInfo('payroll.lock.start', Object.assign({}, hrLog.buildRequestContext(req), {
      bang_luong_id: hrLog.idStr(id)
    }));
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    if (!id) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');
    var doc = await BangLuong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy bảng lương');
    if (doc.trang_thai !== 'calculated') return jsonError(res, 400, 'Chỉ chốt bảng lương đã tính');
    var oldStatus = doc.trang_thai;
    doc.trang_thai = 'locked';
    doc.ngay_chot = new Date();
    doc.nguoi_chot_id = req.user && req.user._id ? req.user._id : undefined;
    await doc.save();
    var lockResult = await ChiTietBangLuong.updateMany(
      { bang_luong_id: doc._id, cua_hang_id: storeId },
      { $set: { trang_thai: 'locked' } }
    );
    hrLog.logPayrollInfo('payroll.lock.success', {
      bang_luong_id: hrLog.idStr(doc._id),
      old_status: oldStatus,
      new_status: doc.trang_thai,
      chi_tiet_locked: lockResult.modifiedCount || lockResult.nModified || 0
    });
    return res.json({ success: true, item: doc });
  } catch (error) {
    hrLog.logPayrollError('payroll.lock.error', error, hrLog.buildRequestContext(req));
    next(error);
  }
};

exports.apiCancel = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var id = pickObjectId(req.params.id);
    hrLog.logPayrollInfo('payroll.cancel.start', Object.assign({}, hrLog.buildRequestContext(req), {
      bang_luong_id: hrLog.idStr(id)
    }));
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    if (!id) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');
    var doc = await BangLuong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy bảng lương');
    if (doc.trang_thai === 'locked') return jsonError(res, 400, 'Bảng lương đã chốt, không thể hủy');
    var oldStatus = doc.trang_thai;
    doc.trang_thai = 'cancelled';
    await doc.save();
    await ChiTietBangLuong.updateMany({ bang_luong_id: doc._id, cua_hang_id: storeId }, { $set: { trang_thai: 'cancelled' } });
    hrLog.logPayrollInfo('payroll.cancel.success', {
      bang_luong_id: hrLog.idStr(doc._id),
      old_status: oldStatus,
      new_status: doc.trang_thai
    });
    return res.json({ success: true, item: doc });
  } catch (error) {
    hrLog.logPayrollError('payroll.cancel.error', error, hrLog.buildRequestContext(req));
    next(error);
  }
};

exports.apiDelete = exports.apiCancel;

exports.apiPayDetail = async function(req, res, next) {
  var session;
  var payCtx = {};
  try {
    var storeId = await resolveStoreId(req);
    var detailId = pickObjectId(req.params.id);
    var amount = parseMoney(req.body && (req.body.so_tien != null ? req.body.so_tien : req.body.gia_tri));
    var cashBookId = pickObjectId(req.body && req.body.so_quy_id);
    var paymentMethod = String(req.body && req.body.phuong_thuc_thanh_toan || 'tien_mat').trim();
    var note = String(req.body && req.body.ghi_chu || '').trim();
    var userId = req.user && req.user._id ? req.user._id : undefined;

    payCtx = {
      ct_bang_luong_id: hrLog.idStr(detailId),
      so_tien: amount,
      so_quy_id: hrLog.idStr(cashBookId),
      phuong_thuc_thanh_toan: paymentMethod
    };
    hrLog.logPayrollInfo('payroll.payment.start', Object.assign({}, hrLog.buildRequestContext(req), payCtx));

    if (!storeId) return jsonError(res, 400, 'Chua chon cua hang');
    if (!detailId) return jsonError(res, 400, 'Ma chi tiet bang luong khong hop le');
    if (amount <= 0) return jsonError(res, 400, 'So tien thanh toan phai lon hon 0');
    if (PAYMENT_METHODS.indexOf(paymentMethod) < 0) return jsonError(res, 400, 'Phuong thuc thanh toan khong hop le');
    if (!cashBookId) return jsonError(res, 400, 'Vui lòng chọn sổ quỹ để chi lương.');

    var detailPreview = await ChiTietBangLuong.findOne({ _id: detailId, cua_hang_id: storeId }).lean();
    var cashPreview = await SoQuy.findOne({ _id: cashBookId, cua_hang_id: storeId }).lean();
    hrLog.logPayrollInfo('payroll.payment.validate', Object.assign({}, payCtx, {
      bang_luong_id: detailPreview ? hrLog.idStr(detailPreview.bang_luong_id) : undefined,
      nhan_vien_id: detailPreview ? hrLog.idStr(detailPreview.nhan_vien_id) : undefined,
      ct_trang_thai: detailPreview && detailPreview.trang_thai,
      con_can_tra_before: detailPreview && detailPreview.con_can_tra,
      da_tra_before: detailPreview && detailPreview.da_tra,
      so_quy_active: !!(cashPreview && cashPreview.trang_thai === 'active')
    }));

    session = await mongoose.startSession();
    var result;
    hrLog.logPayrollInfo('payroll.payment.transaction.start', payCtx);
    await session.withTransaction(async function() {
      var detail = await ChiTietBangLuong.findOne({ _id: detailId, cua_hang_id: storeId }).session(session);
      if (!detail) throw new Error('Khong tim thay chi tiet bang luong');

      var payroll = await BangLuong.findOne({ _id: detail.bang_luong_id, cua_hang_id: storeId }).session(session);
      if (!payroll) throw new Error('Khong tim thay bang luong');
      if (payroll.trang_thai !== 'locked') throw new Error('Chi thanh toan khi bang luong da chot');
      if (detail.trang_thai !== 'locked') throw new Error('Chi tiet bang luong chua duoc chot');
      if (money(detail.con_can_tra) <= 0) throw new Error('Dong luong nay da thanh toan du');

      payCtx.bang_luong_id = hrLog.idStr(payroll._id);
      payCtx.nhan_vien_id = hrLog.idStr(detail.nhan_vien_id);

      var cashBook = await resolvePayrollCashBook(storeId, paymentMethod, cashBookId, session);
      if (!cashBook) throw new Error(PAY_CASHBOOK_INVALID_MSG);
      payCtx.so_quy_id = hrLog.idStr(cashBook._id);
      payCtx.so_quy_auto_resolved = false;
      hrLog.logPayrollInfo('payroll.payment.cash.resolved', Object.assign({}, payCtx, {
        ten_so_quy: cashBook.ten_so_quy
      }));

      var updatedDetail = await ChiTietBangLuong.findOneAndUpdate(
        {
          _id: detailId,
          cua_hang_id: storeId,
          trang_thai: 'locked',
          con_can_tra: { $gte: amount }
        },
        { $inc: { da_tra: amount } },
        { session: session, new: true }
      );
      if (!updatedDetail) throw new Error(PAY_DETAIL_OVERPAY_MSG);
      updatedDetail.con_can_tra = Math.max(0, money(updatedDetail.tong_luong) - money(updatedDetail.da_tra));
      await updatedDetail.save({ session: session });
      hrLog.logPayrollInfo('payroll.payment.ct.updated', {
        ct_bang_luong_id: hrLog.idStr(updatedDetail._id),
        da_tra_after: updatedDetail.da_tra,
        con_can_tra_after: updatedDetail.con_can_tra
      });

      hrLog.logPayrollInfo('payroll.payment.cash.validated', {
        so_quy_id: hrLog.idStr(cashBook._id)
      });

      var updatedPayroll = await BangLuong.findOneAndUpdate(
        {
          _id: payroll._id,
          cua_hang_id: storeId,
          trang_thai: 'locked'
        },
        { $inc: { da_tra_nhan_vien: amount } },
        { session: session, new: true }
      );
      if (!updatedPayroll) throw new Error('Khong cap nhat duoc bang luong');
      updatedPayroll.con_can_tra = Math.max(0, money(updatedPayroll.tong_luong) - money(updatedPayroll.da_tra_nhan_vien));
      await updatedPayroll.save({ session: session });
      hrLog.logPayrollInfo('payroll.payment.payroll.updated', hrLog.logPayrollSummary(updatedPayroll));

      var receiptCode = await makePayrollPaymentCode(storeId);
      var receipt = await taoPhieuThuChi({
        ma_phieu: receiptCode,
        ngay_lap: new Date(),
        loai_phieu: 'chi',
        loai_thu_chi: 'tra_luong_nhan_vien',
        gia_tri: amount,
        doi_tuong: updatedDetail.ten_nhan_vien || updatedDetail.ma_nhan_vien || 'Nhan vien',
        nhom_doi_tuong: 'nhan_vien',
        phuong_thuc_thanh_toan: paymentMethod,
        trang_thai: 'paid',
        hach_toan: false,
        cua_hang_id: storeId,
        so_quy_id: cashBook._id,
        nguoi_tao_id: userId,
        nhan_vien_id: updatedDetail.nhan_vien_id,
        bang_luong_id: updatedPayroll._id,
        ct_bang_luong_id: updatedDetail._id,
        ma_chung_tu_goc: updatedPayroll.ma_bang_luong,
        ghi_chu: note || ('Thanh toan luong ' + (updatedPayroll.ma_bang_luong || '') + ' - ' +
          (updatedDetail.ma_nhan_vien || '') + ' - ' +
          (updatedDetail.ten_nhan_vien || 'nhan vien')),
        session: session
      });

      hrLog.logPayrollInfo('payroll.payment.receipt.created', {
        phieu_thu_chi_id: hrLog.idStr(receipt._id),
        ma_phieu: receipt.ma_phieu,
        gia_tri: receipt.gia_tri
      });

      result = {
        receipt: receipt,
        detail: updatedDetail,
        payroll: updatedPayroll
      };
    });

    hrLog.logPayrollInfo('payroll.payment.transaction.commit', payCtx);
    hrLog.logPayrollInfo('payroll.payment.success', Object.assign({}, payCtx, {
      ma_phieu: result.receipt.ma_phieu,
      phieu_thu_chi_id: hrLog.idStr(result.receipt._id)
    }));

    return res.json({
      success: true,
      message: 'Da thanh toan luong',
      receipt: result.receipt,
      detail: result.detail,
      payroll: result.payroll
    });
  } catch (error) {
    if (session && session.inTransaction()) {
      try { await session.abortTransaction(); } catch (abortError) {}
    }
    hrLog.logPayrollError('payroll.payment.transaction.rollback', error, payCtx);
    hrLog.logPayrollError('payroll.payment.error', error, Object.assign({}, hrLog.buildRequestContext(req), payCtx));
    var unsupported = /Transaction numbers|replica set|sharded cluster|Transaction.*not supported/i.test(error.message || '');
    return jsonError(res, unsupported ? 500 : 400, unsupported
      ? 'MongoDB hien tai khong ho tro transaction, khong the thanh toan luong an toan'
      : (error.message || 'Khong thanh toan duoc luong'));
  } finally {
    if (session) session.endSession();
  }
};

exports.apiCancelPayrollReceipt = async function(req, res, next) {
  var session;
  var cancelCtx = {};
  try {
    var storeId = await resolveStoreId(req);
    var receiptId = pickObjectId(req.params.id);
    var cancelReason = String(req.body && req.body.ly_do_huy || '').trim();
    var userId = req.user && req.user._id ? req.user._id : undefined;

    cancelCtx = {
      phieu_thu_chi_id: hrLog.idStr(receiptId),
      ly_do_huy: cancelReason
    };
    hrLog.logPayrollInfo('payroll.receipt_cancel.start', Object.assign({}, hrLog.buildRequestContext(req), cancelCtx));

    if (!storeId) return jsonError(res, 400, 'Chua chon cua hang');
    if (!receiptId) return jsonError(res, 400, 'Ma phieu luong khong hop le');
    if (!cancelReason) return jsonError(res, 400, 'Ly do huy khong duoc de trong');

    var receipt = await PhieuThuChi.findOne({
      _id: receiptId,
      cua_hang_id: storeId,
      loai_phieu: 'chi',
      loai_thu_chi: 'tra_luong_nhan_vien'
    }).lean();
    if (!receipt) return jsonError(res, 400, PAY_RECEIPT_CANCEL_INVALID_MSG);
    if (receipt.trang_thai !== 'paid') return jsonError(res, 400, PAY_RECEIPT_CANCEL_INVALID_MSG);

    var amount = money(receipt.gia_tri);
    if (amount <= 0) return jsonError(res, 400, PAY_RECEIPT_CANCEL_INVALID_MSG);

    if (!receipt.nhan_vien_id || !receipt.bang_luong_id || !receipt.ct_bang_luong_id) {
      return jsonError(res, 400, PAY_RECEIPT_CANCEL_INVALID_MSG);
    }

    var payroll = await BangLuong.findOne({ _id: receipt.bang_luong_id, cua_hang_id: storeId }).lean();
    if (!payroll) return jsonError(res, 404, 'Khong tim thay bang luong');
    if (payroll.trang_thai === 'cancelled') return jsonError(res, 400, 'Bang luong da huy, khong the huy phieu luong');

    var detailPreview = await ChiTietBangLuong.findOne({
      _id: receipt.ct_bang_luong_id,
      cua_hang_id: storeId
    }).lean();
    if (!detailPreview) return jsonError(res, 404, 'Khong tim thay chi tiet bang luong');

    var cashPreview = receipt.so_quy_id
      ? await SoQuy.findOne({ _id: receipt.so_quy_id, cua_hang_id: storeId }).lean()
      : null;
    hrLog.logPayrollInfo('payroll.receipt_cancel.validate', Object.assign({}, cancelCtx, {
      ma_phieu: receipt.ma_phieu,
      gia_tri: amount,
      bang_luong_id: hrLog.idStr(receipt.bang_luong_id),
      ct_bang_luong_id: hrLog.idStr(receipt.ct_bang_luong_id),
      nhan_vien_id: hrLog.idStr(receipt.nhan_vien_id),
      so_quy_id: hrLog.idStr(receipt.so_quy_id),
      da_tra_before: detailPreview.da_tra,
      con_can_tra_before: detailPreview.con_can_tra,
      so_quy_found: !!cashPreview
    }));

    session = await mongoose.startSession();
    var result;
    hrLog.logPayrollInfo('payroll.receipt_cancel.transaction.start', cancelCtx);
    await session.withTransaction(async function() {
      var cancelledReceipt = await PhieuThuChi.findOneAndUpdate(
        {
          _id: receiptId,
          cua_hang_id: storeId,
          loai_phieu: 'chi',
          loai_thu_chi: 'tra_luong_nhan_vien',
          trang_thai: 'paid'
        },
        {
          $set: {
            trang_thai: 'cancelled',
            ngay_huy: new Date(),
            nguoi_huy_id: userId,
            ly_do_huy: cancelReason
          }
        },
        { session: session, new: true }
      );
      if (!cancelledReceipt) throw new Error(PAY_RECEIPT_CANCEL_INVALID_MSG);
      hrLog.logPayrollInfo('payroll.receipt_cancel.receipt.cancelled', {
        phieu_thu_chi_id: hrLog.idStr(cancelledReceipt._id),
        ma_phieu: cancelledReceipt.ma_phieu
      });

      hrLog.logPayrollInfo('payroll.receipt_cancel.cash.cache.skipped', {
        phieu_thu_chi_id: hrLog.idStr(receiptId),
        so_quy_id: hrLog.idStr(receipt.so_quy_id)
      });

      var updatedDetail = await ChiTietBangLuong.findOneAndUpdate(
        {
          _id: receipt.ct_bang_luong_id,
          cua_hang_id: storeId,
          da_tra: { $gte: amount }
        },
        { $inc: { da_tra: -amount } },
        { session: session, new: true }
      );
      if (!updatedDetail) throw new Error('Khong cap nhat duoc chi tiet bang luong');
      updatedDetail.con_can_tra = Math.max(0, money(updatedDetail.tong_luong) - money(updatedDetail.da_tra));
      await updatedDetail.save({ session: session });
      hrLog.logPayrollInfo('payroll.receipt_cancel.ct.updated', {
        ct_bang_luong_id: hrLog.idStr(updatedDetail._id),
        da_tra_after: updatedDetail.da_tra,
        con_can_tra_after: updatedDetail.con_can_tra
      });

      var updatedPayroll = await BangLuong.findOneAndUpdate(
        {
          _id: receipt.bang_luong_id,
          cua_hang_id: storeId,
          da_tra_nhan_vien: { $gte: amount }
        },
        { $inc: { da_tra_nhan_vien: -amount } },
        { session: session, new: true }
      );
      if (!updatedPayroll) throw new Error('Khong cap nhat duoc bang luong');
      updatedPayroll.con_can_tra = Math.max(0, money(updatedPayroll.tong_luong) - money(updatedPayroll.da_tra_nhan_vien));
      await updatedPayroll.save({ session: session });
      hrLog.logPayrollInfo('payroll.receipt_cancel.payroll.updated', hrLog.logPayrollSummary(updatedPayroll));

      result = {
        receipt: cancelledReceipt,
        detail: updatedDetail,
        payroll: updatedPayroll
      };
    });

    hrLog.logPayrollInfo('payroll.receipt_cancel.transaction.commit', cancelCtx);
    hrLog.logPayrollInfo('payroll.receipt_cancel.success', cancelCtx);

    return res.json({
      success: true,
      message: 'Da huy phieu chi luong',
      receipt: result.receipt,
      detail: result.detail,
      payroll: result.payroll
    });
  } catch (error) {
    if (session && session.inTransaction()) {
      try { await session.abortTransaction(); } catch (abortError) {}
    }
    hrLog.logPayrollError('payroll.receipt_cancel.transaction.rollback', error, cancelCtx);
    hrLog.logPayrollError('payroll.receipt_cancel.error', error, Object.assign({}, hrLog.buildRequestContext(req), cancelCtx));
    var unsupported = /Transaction numbers|replica set|sharded cluster|Transaction.*not supported/i.test(error.message || '');
    return jsonError(res, unsupported ? 500 : 400, unsupported
      ? 'MongoDB hien tai khong ho tro transaction, khong the huy phieu luong an toan'
      : (error.message || 'Khong huy duoc phieu luong'));
  } finally {
    if (session) session.endSession();
  }
};
