const {
  NhanVien,
  ChamCong,
  CauHinhLuongNhanVien,
  PhongBan,
  ChucDanh,
  DanhMucKhoanNop,
  NoiNopKhoanNop,
  DanhMucPhuCap,
  PhuCapNhanVien,
  TamUngNhanVien,
  BangLuong,
  ThanhToanLuong
} = require('../../models/chamcong.model');
const { taoPhieuThuChi } = require('../../services/soQuy.service');
const { PhieuThuChi } = require('../../models/kiot.model');
const db = require('../../models/db.model');
const ExcelJS = require('exceljs');

const mongoose = db.mongoose;

function getCurrentStoreId(req, res) {
  if (res.locals.currentStore && res.locals.currentStore._id) {
    return String(res.locals.currentStore._id);
  }

  if (req.session && req.session.cua_hang_id) {
    return String(req.session.cua_hang_id);
  }

  if (req.user && req.user.cua_hang_id) {
    return String(req.user.cua_hang_id._id || req.user.cua_hang_id);
  }

  return '';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateKey(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatMonthKey(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  return year + '-' + month;
}

function formatDateText(date) {
  var day = String(date.getDate()).padStart(2, '0');
  var month = String(date.getMonth() + 1).padStart(2, '0');
  return day + '/' + month + '/' + date.getFullYear();
}

function attendanceWorkUnits(row) {
  return attendanceRegularWorkUnits(row) + attendanceOvertimeWorkUnits(row);
}

function attendanceShiftWorkUnits(row) {
  return (row && row.ca_sang ? 0.5 : 0) + (row && row.ca_chieu ? 0.5 : 0);
}

function attendanceRegularWorkUnits(row) {
  if (row && row.tick_tang_ca) return 0;
  return attendanceShiftWorkUnits(row);
}

function attendanceOvertimeWorkUnits(row) {
  var shiftOvertime = row && row.tick_tang_ca ? attendanceShiftWorkUnits(row) : 0;
  return shiftOvertime + Number(row && row.cong_tang_ca || 0);
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  var digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function parseDateKey(value) {
  var raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  var date = new Date(raw + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMonthKey(value) {
  var raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  var start = new Date(raw + '-01T00:00:00.000Z');
  if (Number.isNaN(start.getTime())) return null;
  var end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start: start, end: end };
}

function normalizeAttendanceRow(row) {
  row = row || {};
  var date = parseDateKey(row.ngay_cham_cong);
  if (!date) return null;

  var caSang = row.ca_sang === true || row.ca_sang === 'true' || row.ca_sang === '1';
  var caChieu = row.ca_chieu === true || row.ca_chieu === 'true' || row.ca_chieu === '1';
  var tickTangCa = row.tick_tang_ca === true || row.tick_tang_ca === 'true' || row.tick_tang_ca === '1';
  var congTangCa = Math.max(0, Number(row.tang_ca_cong != null ? row.tang_ca_cong : row.cong_tang_ca) || 0);
  var ghiChu = String(row.ghi_chu || '').trim();

  return {
    ngay_cham_cong: date,
    ngay_key: formatDateKey(date),
    ca_sang: caSang,
    ca_chieu: caChieu,
    tick_tang_ca: tickTangCa,
    cong_tang_ca: congTangCa,
    ghi_chu: ghiChu,
    should_save: caSang || caChieu || tickTangCa || congTangCa > 0 || !!ghiChu
  };
}

function serializeAttendance(doc, payrollMap) {
  var caSang = !!doc.ca_sang;
  var caChieu = !!doc.ca_chieu;
  var tangCa = Number(doc.cong_tang_ca || 0);
  var soCong = attendanceWorkUnits(doc);
  var payroll = payrollMap && doc._id ? payrollMap[String(doc._id)] : null;
  return {
    _id: String(doc._id),
    ngay_cham_cong: formatDateKey(new Date(doc.ngay_cham_cong)),
    ca_sang: caSang,
    ca_chieu: caChieu,
    tick_tang_ca: !!doc.tick_tang_ca,
    tang_ca_cong: tangCa,
    cong_tang_ca: tangCa,
    ghi_chu: doc.ghi_chu || '',
    dong_y: soCong > 0,
    so_cong: soCong,
    payroll: payroll
  };
}

function serializePayrollAttendanceGroup(group, salaryMap) {
  var employee = group.employee || {};
  var salary = salaryMap[String(group.employeeId)] || {};
  var salaryMonth = Number(salary.luong_thang || 0);
  var workDaysInMonth = Number(salary.so_ngay_cong_trong_thang || 0);
  var daySalary = workDaysInMonth > 0 ? Math.round(salaryMonth / workDaysInMonth) : 0;
  var totalWork = group.rows.reduce(function(sum, row) {
    return sum + attendanceRegularWorkUnits(row);
  }, 0);
  var totalMoney = daySalary > 0 ? Math.round(totalWork * daySalary) : 0;
  var codeEmployee = employee.ma_nhan_vien || String(group.employeeId).slice(-6).toUpperCase();
  var codeMonth = String(group.month || '').replace('-', '');

  return {
    _id: String(group.employeeId) + '_' + group.month,
    ma_bang_luong: 'CC-' + codeMonth + '-' + codeEmployee,
    nhan_vien_id: String(group.employeeId),
    ma_nhan_vien: employee.ma_nhan_vien || '',
    ten_nhan_vien: employee.ten_nhan_vien || '',
    thang_bang_luong: group.month,
    thang_text: group.month,
    loai_luong: 'ngay',
    so_ngay_cong: totalWork,
    so_thang_cong: 0,
    luong_theo_ngay: daySalary,
    luong_theo_thang: salaryMonth,
    tong_tien: totalMoney,
    da_thanh_toan: false,
    co_the_thanh_toan: totalMoney > 0,
    canh_bao_luong: daySalary > 0 ? '' : 'Chưa cấu hình lương tháng hoặc số ngày công chuẩn.',
    chi_tiet_ngay_cong: group.rows.map(function(row) {
      var date = new Date(row.ngay_cham_cong);
      return {
        ngay: formatDateKey(date),
        ngay_hien_thi: formatDateText(date),
        ca_sang: !!row.ca_sang,
        ca_chieu: !!row.ca_chieu,
        tick_tang_ca: !!row.tick_tang_ca,
        tang_ca_cong: Number(row.cong_tang_ca || 0),
        so_cong: attendanceWorkUnits(row),
        ghi_chu: row.ghi_chu || ''
      };
    })
  };
}

function contributionRate(row) {
  var source = row && row.ti_le_nld != null
    ? row.ti_le_nld
    : (row && row.ti_le != null ? row.ti_le : (row && row.ti_le_snapshot != null ? row.ti_le_snapshot : 0));
  return Math.max(0, Number(source || 0));
}

function contributionFactor(khoanTrus) {
  var count = (khoanTrus || []).filter(function(row) {
    return row && (row.danh_muc_khoan_nop_id || row._id || row.ma_khoan || row.ma_khoan_snapshot || row.ten_khoan || row.ten_khoan_snapshot);
  }).length;
  return count > 0 ? count : 1;
}

function buildContributionRows(salary, salaryBase) {
  var ids = Array.isArray(salary && salary.khoan_nop_ids) ? salary.khoan_nop_ids : [];
  return ids.map(function(item) {
    var doc = item && typeof item === 'object' ? item : {};
    var rate = contributionRate(doc);
    var place = doc.noi_nop_id && typeof doc.noi_nop_id === 'object' ? doc.noi_nop_id : {};
    return {
      danh_muc_khoan_nop_id: doc._id || item,
      ma_khoan_snapshot: doc.ma_khoan || '',
      ten_khoan_snapshot: doc.ten_khoan || '',
      noi_nop_id: place._id || doc.noi_nop_id,
      ma_noi_nop_snapshot: place.ma_noi_nop || '',
      ten_noi_nop_snapshot: place.ten_noi_nop || '',
      ti_le_snapshot: rate,
      ti_le_nld_snapshot: rate,
      ti_le_nsdld_snapshot: Number(doc.ti_le_nsdld || 0),
      muc_tinh: salaryBase,
      so_tien: Math.round(Number(salaryBase || 0) * rate / 100)
    };
  }).filter(function(row) {
    return row.danh_muc_khoan_nop_id;
  });
}

function buildAllowanceRows(rows, workDays, workUnits) {
  return (rows || []).map(function(row) {
    var catalog = row.danh_muc_phu_cap_id && typeof row.danh_muc_phu_cap_id === 'object' ? row.danh_muc_phu_cap_id : {};
    var type = row.kieu_tinh || 'co_dinh_thang';
    var quantity = type === 'theo_ngay_di_lam' ? workDays : (type === 'theo_cong' ? workUnits : 1);
    var amount = Math.round(Number(row.muc_phu_cap || 0) * quantity);
    return {
      danh_muc_phu_cap_id: catalog._id || row.danh_muc_phu_cap_id,
      ma_phu_cap_snapshot: catalog.ma_phu_cap || '',
      ten_phu_cap_snapshot: catalog.ten_phu_cap || '',
      kieu_tinh_snapshot: type,
      muc_phu_cap_snapshot: Number(row.muc_phu_cap || 0),
      so_luong: quantity,
      so_tien: amount
    };
  }).filter(function(row) {
    return row.danh_muc_phu_cap_id && row.so_tien > 0;
  });
}

function buildPayrollPayloadFromGroup(group, salaryMap, allowanceMap, advanceMap, storeId, userId) {
  var item = serializePayrollAttendanceGroup(group, salaryMap);
  var employee = group.employee || {};
  var monthParts = String(group.month || '').split('-').map(Number);
  var salary = salaryMap[String(group.employeeId)] || {};
  var workDaysInMonth = Number(salary.so_ngay_cong_trong_thang || 0);
  var overtimeWork = group.rows.reduce(function(sum, row) { return sum + attendanceOvertimeWorkUnits(row); }, 0);
  var contributionBaseRows = buildContributionRows(salary, item.luong_theo_thang);
  var overtimeSalary = workDaysInMonth > 0
    ? Math.round((overtimeWork / workDaysInMonth) * contributionFactor(contributionBaseRows) * item.luong_theo_thang)
    : 0;
  var allowanceRows = buildAllowanceRows(allowanceMap[String(group.employeeId)] || [], item.so_ngay_cong, item.so_ngay_cong);
  var advances = advanceMap[String(group.employeeId) + '_' + group.month] || [];
  var allowanceTotal = allowanceRows.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
  var advanceTotal = advances.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
  var gross = item.tong_tien + overtimeSalary + allowanceTotal;
  var contributionRows = buildContributionRows(salary, gross);
  var contributionTotal = contributionRows.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
  var net = Math.max(0, gross - contributionTotal - advanceTotal);
  return {
    cua_hang_id: storeId,
    nhan_vien_id: group.employeeId,
    ma_bang_luong: item.ma_bang_luong,
    thang: monthParts[1],
    nam: monthParts[0],
    ma_nhan_vien_snapshot: employee.ma_nhan_vien || '',
    ten_nhan_vien_snapshot: employee.ten_nhan_vien || '',
    phong_ban_id: employee.phong_ban_id && employee.phong_ban_id._id ? employee.phong_ban_id._id : employee.phong_ban_id,
    ten_phong_ban_snapshot: employee.phong_ban_id && employee.phong_ban_id.ten_phong_ban ? employee.phong_ban_id.ten_phong_ban : '',
    chuc_danh_id: employee.chuc_danh_id && employee.chuc_danh_id._id ? employee.chuc_danh_id._id : employee.chuc_danh_id,
    ten_chuc_danh_snapshot: employee.chuc_danh_id && employee.chuc_danh_id.ten_chuc_danh ? employee.chuc_danh_id.ten_chuc_danh : '',
    luong_thang: item.luong_theo_thang,
    so_ngay_cong_trong_thang: workDaysInMonth,
    cham_cong_ids: group.rows.map(function(row) { return row._id; }),
    ngay_cong_thuc_te: item.so_ngay_cong,
    so_ngay_di_lam: item.so_ngay_cong,
    luong_thuc_te: item.tong_tien,
    cong_tang_ca: overtimeWork,
    luong_tang_ca: overtimeSalary,
    phu_caps: allowanceRows,
    tong_phu_cap: allowanceTotal,
    tong_luong: gross,
    khoan_trus: contributionRows,
    tong_khoan_tru: contributionTotal,
    tam_ung_ids: advances.map(function(row) { return row._id; }),
    tong_tam_ung: advanceTotal,
    thuc_nhan: net,
    con_phai_tra: net,
    nguoi_tao_id: userId,
    nguoi_cap_nhat_id: userId,
    ghi_chu: ''
  };
}

async function normalizeUnpaidPayrollAdvances(storeId, payroll, userId) {
  if (!payroll || payroll.trang_thai_thanh_toan === 'da_thanh_toan') return payroll;
  var advanceIds = (payroll.tam_ung_ids || []).map(function(id) { return String(id); }).filter(Boolean);
  if (!advanceIds.length) return payroll;

  var usedRows = await BangLuong.find({
    _id: { $ne: payroll._id },
    cua_hang_id: storeId,
    nhan_vien_id: payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id,
    trang_thai_du_lieu: 'active',
    tam_ung_ids: { $in: advanceIds },
    $or: [
      { trang_thai_thanh_toan: { $in: ['da_thanh_toan', 'thanh_toan_mot_phan'] } },
      { da_thanh_toan: { $gt: 0 } }
    ]
  }).select('tam_ung_ids').lean();
  if (!usedRows.length) return payroll;

  var usedMap = {};
  usedRows.forEach(function(row) {
    (row.tam_ung_ids || []).forEach(function(id) {
      usedMap[String(id)] = true;
    });
  });
  var nextAdvanceIds = (payroll.tam_ung_ids || []).filter(function(id) {
    return !usedMap[String(id)];
  });
  if (nextAdvanceIds.length === (payroll.tam_ung_ids || []).length) return payroll;

  var advanceRows = nextAdvanceIds.length ? await TamUngNhanVien.find({
    _id: { $in: nextAdvanceIds },
    cua_hang_id: storeId,
    trang_thai: 'active'
  }).select('so_tien').lean() : [];
  var nextAdvanceTotal = advanceRows.reduce(function(sum, row) {
    return sum + Number(row.so_tien || 0);
  }, 0);
  var nextNet = Math.max(0, Number(payroll.tong_luong || 0) - Number(payroll.tong_khoan_tru || 0) - nextAdvanceTotal);
  var paid = Number(payroll.da_thanh_toan || 0);
  var nextDue = Math.max(0, nextNet - paid);
  var nextStatus = nextDue <= 0 && paid > 0 ? 'da_thanh_toan' : (paid > 0 ? 'thanh_toan_mot_phan' : 'chua_thanh_toan');

  await BangLuong.updateOne(
    { _id: payroll._id, cua_hang_id: storeId },
    {
      $set: {
        tam_ung_ids: nextAdvanceIds,
        tong_tam_ung: nextAdvanceTotal,
        thuc_nhan: nextNet,
        con_phai_tra: nextDue,
        trang_thai_thanh_toan: nextStatus,
        nguoi_cap_nhat_id: userId
      }
    },
    { runValidators: true }
  );

  return Object.assign({}, payroll, {
    tam_ung_ids: nextAdvanceIds,
    tong_tam_ung: nextAdvanceTotal,
    thuc_nhan: nextNet,
    con_phai_tra: nextDue,
    trang_thai_thanh_toan: nextStatus
  });
}

async function normalizeMissingPayrollSalary(storeId, payroll, userId) {
  if (!payroll || Number(payroll.luong_thang || 0) > 0 || Number(payroll.da_thanh_toan || 0) > 0) return payroll;
  var attendanceRows = (payroll.cham_cong_ids || []).filter(function(row) {
    return row && row.ngay_cham_cong;
  });
  if (!attendanceRows.length && (payroll.cham_cong_ids || []).length) {
    attendanceRows = await ChamCong.find({
      _id: { $in: payroll.cham_cong_ids },
      cua_hang_id: storeId
    }).lean();
  }
  if (!attendanceRows.length) return payroll;

  var employeeId = String(payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id);
  var maxDate = attendanceRows.reduce(function(max, row) {
    var value = new Date(row.ngay_cham_cong);
    return value > max ? value : max;
  }, new Date(0));
  var salaryMap = await getSalaryMap(storeId, [employeeId], maxDate);
  var salary = salaryMap[employeeId] || {};
  if (!(Number(salary.luong_thang || 0) > 0)) return payroll;

  var allowanceRows = await PhuCapNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    trang_thai: 'active'
  }).populate('danh_muc_phu_cap_id', 'ma_phu_cap ten_phu_cap').lean();
  var allowanceMap = {};
  allowanceMap[employeeId] = allowanceRows;

  var advanceRows = (payroll.tam_ung_ids || []).length ? await TamUngNhanVien.find({
    _id: { $in: payroll.tam_ung_ids },
    cua_hang_id: storeId,
    trang_thai: 'active'
  }).lean() : [];
  var month = payrollMonthKey(payroll) || formatMonthKey(maxDate);
  var advanceMap = {};
  advanceMap[employeeId + '_' + month] = advanceRows;

  var payload = buildPayrollPayloadFromGroup({
    employeeId: employeeId,
    employee: {
      ma_nhan_vien: payroll.ma_nhan_vien_snapshot || '',
      ten_nhan_vien: payroll.ten_nhan_vien_snapshot || '',
      phong_ban_id: payroll.phong_ban_id,
      chuc_danh_id: payroll.chuc_danh_id
    },
    month: month,
    rows: attendanceRows
  }, salaryMap, allowanceMap, advanceMap, storeId, userId);

  var paid = Number(payroll.da_thanh_toan || 0);
  var nextDue = Math.max(0, Number(payload.thuc_nhan || 0) - paid);
  var nextStatus = nextDue <= 0 && paid > 0 ? 'da_thanh_toan' : (paid > 0 ? 'thanh_toan_mot_phan' : 'chua_thanh_toan');
  var setPayload = {
    luong_thang: payload.luong_thang,
    so_ngay_cong_trong_thang: payload.so_ngay_cong_trong_thang,
    ngay_cong_thuc_te: payload.ngay_cong_thuc_te,
    so_ngay_di_lam: payload.so_ngay_di_lam,
    luong_thuc_te: payload.luong_thuc_te,
    cong_tang_ca: payload.cong_tang_ca,
    luong_tang_ca: payload.luong_tang_ca,
    phu_caps: payload.phu_caps,
    tong_phu_cap: payload.tong_phu_cap,
    tong_luong: payload.tong_luong,
    khoan_trus: payload.khoan_trus,
    tong_khoan_tru: payload.tong_khoan_tru,
    tong_tam_ung: payload.tong_tam_ung,
    thuc_nhan: payload.thuc_nhan,
    con_phai_tra: nextDue,
    trang_thai_thanh_toan: nextStatus,
    nguoi_cap_nhat_id: userId
  };

  await BangLuong.updateOne(
    { _id: payroll._id, cua_hang_id: storeId },
    { $set: setPayload },
    { runValidators: true }
  );
  return Object.assign({}, payroll, setPayload);
}

async function nextPayrollCode(storeId, baseCode) {
  baseCode = String(baseCode || '').trim().toUpperCase();
  if (!baseCode) return '';
  var pattern = '^' + escapeRegex(baseCode) + '(?:-(\\d+))?$';
  var rows = await BangLuong.find({
    cua_hang_id: storeId,
    ma_bang_luong: { $regex: pattern }
  }).select('ma_bang_luong').lean();
  var maxNo = 0;
  rows.forEach(function(row) {
    var code = String(row.ma_bang_luong || '').toUpperCase();
    if (code === baseCode) {
      maxNo = Math.max(maxNo, 1);
      return;
    }
    var match = code.match(new RegExp(pattern));
    if (match && match[1]) maxNo = Math.max(maxNo, Number(match[1]) || 0);
  });
  if (maxNo <= 0) return baseCode;
  return baseCode + '-' + String(maxNo + 1).padStart(3, '0');
}

function payrollMonthKey(row) {
  return String(row.nam) + '-' + String(row.thang).padStart(2, '0');
}

function formatFormulaNumber(value, fractionDigits) {
  return Number(value || 0).toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits || 0
  });
}

function formatFormulaMoney(value) {
  return formatFormulaNumber(Math.round(Number(value || 0)), 0);
}

function buildPayrollFormulaLines(row) {
  var workDays = Number(row.ngay_cong_thuc_te || 0);
  var standardDays = Number(row.so_ngay_cong_trong_thang || 0);
  var salaryMonth = Number(row.luong_thang || 0);
  var daySalary = standardDays > 0 ? Math.round(salaryMonth / standardDays) : 0;
  var deductionFactor = contributionFactor(row.khoan_trus || []);
  var deductionCount = Math.max(0, Array.isArray(row.khoan_trus) ? row.khoan_trus.length : 0);
  var grossSalary = Number(row.tong_luong || 0);
  var lines = [
    {
      type: 'plus',
      label: 'Lương ngày công',
      amount: Number(row.luong_thuc_te || 0),
      formula: standardDays > 0
        ? 'Lương/ngày = ' + formatFormulaMoney(salaryMonth) + ' / ' + formatFormulaNumber(standardDays, 2) + ' = ' + formatFormulaMoney(daySalary) + '; ' + formatFormulaNumber(workDays, 2) + ' công x ' + formatFormulaMoney(daySalary) + ' = ' + formatFormulaMoney(row.luong_thuc_te)
        : formatFormulaNumber(workDays, 2) + ' công'
    },
    {
      type: 'plus',
      label: 'Lương tăng ca',
      amount: Number(row.luong_tang_ca || 0),
      formula: standardDays > 0
        ? '(' + formatFormulaNumber(row.cong_tang_ca || 0, 2) + ' / ' + formatFormulaNumber(standardDays, 2) + ') x hệ số ' + formatFormulaNumber(deductionFactor, 0) + ' (' + formatFormulaNumber(deductionCount, 0) + ' khoản trừ) x ' + formatFormulaMoney(salaryMonth) + ' = ' + formatFormulaMoney(row.luong_tang_ca)
        : formatFormulaNumber(row.cong_tang_ca || 0, 2) + ' công tăng ca'
    }
  ];
  (row.phu_caps || []).forEach(function(item) {
    lines.push({
      type: 'plus',
      label: item.ten_phu_cap_snapshot || item.ma_phu_cap_snapshot || 'Phụ cấp',
      amount: Number(item.so_tien || 0),
      formula: formatFormulaNumber(item.so_luong || 0, 2) + ' x ' + formatFormulaMoney(item.muc_phu_cap_snapshot || 0) + ' = ' + formatFormulaMoney(item.so_tien)
    });
  });
  lines.push({
    type: 'subtotal',
    label: 'Tổng lương',
    amount: grossSalary,
    formula: 'Lương ngày công + lương tăng ca + phụ cấp'
  });
  (row.khoan_trus || []).forEach(function(item) {
    var rate = Number(item.ti_le_snapshot || 0);
    lines.push({
      type: 'minus',
      label: item.ten_khoan_snapshot || item.ma_khoan_snapshot || 'Khoản trừ',
      amount: Number(item.so_tien || 0),
      formula: formatFormulaMoney(item.so_tien || 0) + ' = Tổng lương ' + formatFormulaMoney(item.muc_tinh || grossSalary) + ' x ' + formatFormulaNumber(rate, 2) + '%'
    });
  });
  if (Number(row.tong_tam_ung || 0) > 0) {
    lines.push({
      type: 'minus',
      label: 'Tạm ứng',
      amount: Number(row.tong_tam_ung || 0),
      formula: 'Tổng tạm ứng trong tháng'
    });
  }
  lines.push({
    type: 'total',
    label: 'Thực nhận',
    amount: Number(row.thuc_nhan || 0),
    formula: 'Tổng lương - khoản trừ - tạm ứng'
  });
  var employer = buildEmployerContributionSummary(row);
  employer.lines.forEach(function(line) {
    lines.push(line);
  });
  return lines;
}

function employerContributionAmount(item) {
  var rate = Number(item && item.ti_le_nsdld_snapshot || 0);
  if (!(rate > 0)) return 0;
  var base = Number(item && item.muc_tinh != null ? item.muc_tinh : 0);
  return Math.round(base * rate / 100);
}

function buildEmployerContributionSummary(row) {
  var grossSalary = Number(row && row.tong_luong || 0);
  var lines = [];
  var total = 0;
  (row && row.khoan_trus || []).forEach(function(item) {
    var rate = Number(item.ti_le_nsdld_snapshot || 0);
    var amount = employerContributionAmount(item);
    if (!(amount > 0)) return;
    total += amount;
    lines.push({
      type: 'plus',
      label: (item.ten_khoan_snapshot || item.ma_khoan_snapshot || 'Khoản nộp') + ' (NSDLĐ)',
      amount: amount,
      formula: formatFormulaMoney(amount) + ' = Tổng lương ' + formatFormulaMoney(item.muc_tinh || grossSalary) + ' x ' + formatFormulaNumber(rate, 2) + '%'
    });
  });
  if (lines.length) {
    lines.push({
      type: 'total',
      label: 'Tổng chi NSDLĐ',
      amount: total,
      formula: 'Tổng các khoản người sử dụng lao động'
    });
  }
  return { lines: lines, tong: total };
}

async function enrichPayrollEmployerRates(storeId, payroll, userId) {
  if (!payroll || !Array.isArray(payroll.khoan_trus) || !payroll.khoan_trus.length) return payroll;
  var missingIds = payroll.khoan_trus.map(function(item) {
    if (Number(item.ti_le_nsdld_snapshot || 0) > 0) return '';
    return String(item.danh_muc_khoan_nop_id || '');
  }).filter(Boolean);
  if (!missingIds.length) return payroll;

  var catalogRows = await DanhMucKhoanNop.find({
    cua_hang_id: storeId,
    _id: { $in: missingIds }
  }).select('_id ti_le_nsdld').lean();
  if (!catalogRows.length) return payroll;

  var rateMap = {};
  catalogRows.forEach(function(row) {
    rateMap[String(row._id)] = Number(row.ti_le_nsdld || 0);
  });

  var changed = false;
  var nextKhoanTrus = payroll.khoan_trus.map(function(item) {
    if (Number(item.ti_le_nsdld_snapshot || 0) > 0) return item;
    var rate = rateMap[String(item.danh_muc_khoan_nop_id || '')];
    if (!(rate > 0)) return item;
    changed = true;
    return Object.assign({}, item, { ti_le_nsdld_snapshot: rate });
  });
  if (!changed) return payroll;

  payroll = Object.assign({}, payroll, { khoan_trus: nextKhoanTrus });
  if (Number(payroll.da_thanh_toan || 0) <= 0) {
    await BangLuong.updateOne(
      { _id: payroll._id, cua_hang_id: storeId },
      {
        $set: {
          khoan_trus: nextKhoanTrus,
          nguoi_cap_nhat_id: userId
        }
      },
      { runValidators: true }
    );
  }
  return payroll;
}

function calcEmployerPaymentShare(totalEmployer, paidEmployer, salaryDue, salaryPayAmount) {
  var remainingEmployer = Math.max(0, Number(totalEmployer || 0) - Number(paidEmployer || 0));
  var due = Math.max(0, Number(salaryDue || 0));
  var pay = Math.max(0, Number(salaryPayAmount || 0));
  if (!(remainingEmployer > 0) || !(due > 0) || !(pay > 0)) return 0;
  if (pay >= due) return remainingEmployer;
  return Math.round(remainingEmployer * pay / due);
}

function isEmployeeSalaryPayment(payment) {
  return !payment || payment.loai_thanh_toan !== 'nsdld';
}

function serializeBangLuong(row, paymentMap) {
  var paid = Number(row.da_thanh_toan || 0);
  var due = Number(row.con_phai_tra != null ? row.con_phai_tra : (Number(row.thuc_nhan || 0) - paid));
  var payments = paymentMap[String(row._id)] || [];
  var employeePayments = payments.filter(isEmployeeSalaryPayment);
  var employerPayments = payments.filter(function(payment) { return !isEmployeeSalaryPayment(payment); });
  var lastPayment = employeePayments[0] || null;
  var lastEmployerPayment = employerPayments[0] || null;
  var receipt = lastPayment && lastPayment.phieu_chi_id && typeof lastPayment.phieu_chi_id === 'object'
    ? lastPayment.phieu_chi_id
    : null;
  var employerReceipt = lastEmployerPayment && lastEmployerPayment.phieu_chi_id && typeof lastEmployerPayment.phieu_chi_id === 'object'
    ? lastEmployerPayment.phieu_chi_id
    : null;
  var employerSummary = buildEmployerContributionSummary(row);
  var paidEmployer = employerPayments.reduce(function(sum, payment) {
    return sum + Number(payment.so_tien || 0);
  }, 0);
  return {
    _id: String(row._id),
    ma_bang_luong: row.ma_bang_luong || '',
    nhan_vien_id: String(row.nhan_vien_id && row.nhan_vien_id._id ? row.nhan_vien_id._id : row.nhan_vien_id),
    ma_nhan_vien: row.ma_nhan_vien_snapshot || '',
    ten_nhan_vien: row.ten_nhan_vien_snapshot || '',
    thang_bang_luong: payrollMonthKey(row),
    thang_text: payrollMonthKey(row),
    loai_luong: 'ngay',
    so_ngay_cong: Number(row.ngay_cong_thuc_te || 0),
    tong_cong_hien_thi: Number(row.ngay_cong_thuc_te || 0) + Number(row.cong_tang_ca || 0),
    so_thang_cong: 0,
    luong_theo_ngay: Number(row.so_ngay_cong_trong_thang || 0) > 0 ? Math.round(Number(row.luong_thang || 0) / Number(row.so_ngay_cong_trong_thang || 0)) : 0,
    luong_theo_thang: Number(row.luong_thang || 0),
    tong_tien: Math.max(0, due),
    tong_luong: Number(row.tong_luong || 0),
    thuc_nhan: Number(row.thuc_nhan || 0),
    da_tra: paid,
    con_can_tra: Math.max(0, due),
    da_thanh_toan: row.trang_thai_thanh_toan === 'da_thanh_toan',
    co_the_thanh_toan: due > 0,
    trang_thai_thanh_toan: row.trang_thai_thanh_toan || 'chua_thanh_toan',
    trang_thai_du_lieu: row.trang_thai_du_lieu || 'active',
    luong_tang_ca: Number(row.luong_tang_ca || 0),
    tong_phu_cap: Number(row.tong_phu_cap || 0),
    tong_khoan_tru: Number(row.tong_khoan_tru || 0),
    tong_tam_ung: Number(row.tong_tam_ung || 0),
    tong_nsdld: employerSummary.tong,
    da_tra_nsdld: paidEmployer,
    con_nsdld: Math.max(0, employerSummary.tong - paidEmployer),
    payroll_lines: buildPayrollFormulaLines(row),
    employer_lines: employerSummary.lines,
    phieu_chi: receipt ? {
      _id: String(receipt._id),
      ma_phieu: receipt.ma_phieu || '',
      gia_tri: Number(receipt.gia_tri || 0),
      ngay_lap_text: receipt.ngay_lap ? formatDateText(new Date(receipt.ngay_lap)) : ''
    } : null,
    phieu_chi_nsdld: employerReceipt ? {
      _id: String(employerReceipt._id),
      ma_phieu: employerReceipt.ma_phieu || '',
      gia_tri: Number(employerReceipt.gia_tri || 0),
      ngay_lap_text: employerReceipt.ngay_lap ? formatDateText(new Date(employerReceipt.ngay_lap)) : ''
    } : null,
    thanh_toans: employeePayments.map(function(payment) {
      var payReceipt = payment.phieu_chi_id && typeof payment.phieu_chi_id === 'object' ? payment.phieu_chi_id : null;
      return {
        _id: String(payment._id),
        so_tien: Number(payment.so_tien || 0),
        ma_phieu: payReceipt ? (payReceipt.ma_phieu || '') : (payment.ma_tham_chieu || ''),
        phieu_chi_id: payReceipt ? String(payReceipt._id) : '',
        ngay_thanh_toan_text: payment.ngay_thanh_toan ? formatDateText(new Date(payment.ngay_thanh_toan)) : ''
      };
    }),
    thanh_toans_nsdld: employerPayments.map(function(payment) {
      var payReceipt = payment.phieu_chi_id && typeof payment.phieu_chi_id === 'object' ? payment.phieu_chi_id : null;
      return {
        _id: String(payment._id),
        so_tien: Number(payment.so_tien || 0),
        ma_phieu: payReceipt ? (payReceipt.ma_phieu || '') : (payment.ma_tham_chieu || ''),
        phieu_chi_id: payReceipt ? String(payReceipt._id) : '',
        ngay_thanh_toan_text: payment.ngay_thanh_toan ? formatDateText(new Date(payment.ngay_thanh_toan)) : ''
      };
    }),
    chi_tiet_ngay_cong: (row.cham_cong_ids || []).map(function(chamCong) {
      var date = new Date(chamCong.ngay_cham_cong);
      return {
        ngay: formatDateKey(date),
        ngay_hien_thi: formatDateText(date),
        ca_sang: !!chamCong.ca_sang,
        ca_chieu: !!chamCong.ca_chieu,
        tick_tang_ca: !!chamCong.tick_tang_ca,
        tang_ca_cong: Number(chamCong.cong_tang_ca || 0),
        so_cong: attendanceWorkUnits(chamCong),
        ghi_chu: chamCong.ghi_chu || ''
      };
    })
  };
}

function buildAttendancePayrollWarnings(payrollRows, paymentMap, affectedDateKeys, attendanceById) {
  var warnings = [];
  var seen = {};
  affectedDateKeys = affectedDateKeys || {};
  attendanceById = attendanceById || {};
  (payrollRows || []).forEach(function(payroll) {
    var payrollId = String(payroll._id);
    var payments = paymentMap[payrollId] || [];
    var receipts = payments.map(function(payment) {
      var receipt = payment.phieu_chi_id && typeof payment.phieu_chi_id === 'object' ? payment.phieu_chi_id : null;
      if (!receipt) return null;
      return {
        _id: String(receipt._id),
        ma_phieu: receipt.ma_phieu || '',
        gia_tri: Number(receipt.gia_tri || 0),
        ngay_lap_text: receipt.ngay_lap ? formatDateText(new Date(receipt.ngay_lap)) : ''
      };
    }).filter(Boolean);

    (payroll.cham_cong_ids || []).forEach(function(attendance) {
      var attendanceId = attendance && attendance._id ? String(attendance._id) : String(attendance || '');
      var attendanceDoc = attendance && attendance.ngay_cham_cong ? attendance : attendanceById[attendanceId];
      if (!attendanceDoc || !attendanceDoc.ngay_cham_cong) return;
      var date = new Date(attendanceDoc.ngay_cham_cong);
      var dateKey = formatDateKey(date);
      if (!affectedDateKeys[dateKey]) return;
      var key = payrollId + '_' + dateKey;
      if (seen[key]) return;
      seen[key] = true;
      warnings.push({
        type: 'payroll_locked_attendance',
        message: 'Ngày ' + formatDateText(date) + ' đã có bảng lương ' + (payroll.ma_bang_luong || ''),
        ngay: dateKey,
        ngay_text: formatDateText(date),
        bang_luong_id: payrollId,
        ma_bang_luong: payroll.ma_bang_luong || '',
        trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || 'chua_thanh_toan',
        phieu_chis: receipts
      });
    });
  });
  return warnings;
}

function normalizeExportKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findPayrollAmount(rows, matchers) {
  rows = Array.isArray(rows) ? rows : [];
  matchers = Array.isArray(matchers) ? matchers : [];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i] || {};
    var key = normalizeExportKey([
      row.ten_phu_cap_snapshot,
      row.ma_phu_cap_snapshot,
      row.ten_khoan_snapshot,
      row.ma_khoan_snapshot
    ].filter(Boolean).join(' '));
    for (var m = 0; m < matchers.length; m += 1) {
      if (key.indexOf(matchers[m]) >= 0) return Number(row.so_tien || 0);
    }
  }
  return 0;
}

function findPayrollRate(rows, matchers) {
  rows = Array.isArray(rows) ? rows : [];
  matchers = Array.isArray(matchers) ? matchers : [];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i] || {};
    var key = normalizeExportKey([row.ten_khoan_snapshot, row.ma_khoan_snapshot].filter(Boolean).join(' '));
    for (var m = 0; m < matchers.length; m += 1) {
      if (key.indexOf(matchers[m]) >= 0) return Number(row.ti_le_snapshot || row.ti_le_nld_snapshot || 0);
    }
  }
  return 0;
}

function payrollExportFilename(payroll) {
  var code = String((payroll && payroll.ma_bang_luong) || 'bang-luong')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return code + '.xlsx';
}

function setPayrollExportCellStyle(cell, options) {
  options = options || {};
  cell.alignment = {
    vertical: 'middle',
    horizontal: options.horizontal || 'center',
    wrapText: true
  };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
  };
  if (options.bold) cell.font = Object.assign({}, cell.font || {}, { bold: true });
}

function buildPayrollExportWorkbook(payroll, employee) {
  var workbook = new ExcelJS.Workbook();
  workbook.creator = 'Quan ly cua hang';
  workbook.created = new Date();
  var sheet = workbook.addWorksheet('Bang luong', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  var headers = [
    'STT',
    'MÃ NV',
    'TÊN NHÂN VIÊN',
    'CHỨC VỤ',
    'LƯƠNG CƠ BẢN',
    'NGÀY CÔNG\nTHỰC TẾ',
    'LƯƠNG THỰC\nTẾ',
    'Công tăng ca',
    'LƯƠNG TĂNG CA',
    'ĂN TRƯA',
    'ĐIỆN THOẠI',
    'XĂNG XE',
    'TRÁCH NHIỆM',
    'TỔNG\nLƯƠNG',
    'BHXH (%)',
    'BHYT (%)',
    'CÔNG ĐOÀN',
    'ĐÃ TẠM\nỨNG',
    'THỰC\nNHẬN'
  ];
  sheet.addRow(headers);
  var employeeDoc = employee || {};
  var allowanceRows = payroll.phu_caps || [];
  var deductionRows = payroll.khoan_trus || [];
  var rowValues = [
    1,
    payroll.ma_nhan_vien_snapshot || (employeeDoc.ma_nhan_vien || ''),
    payroll.ten_nhan_vien_snapshot || (employeeDoc.ten_nhan_vien || ''),
    payroll.ten_chuc_danh_snapshot || employeeDoc.chuc_vu || employeeDoc.chuc_danh || '',
    Number(payroll.luong_thang || 0),
    Number(payroll.ngay_cong_thuc_te || 0),
    Number(payroll.luong_thuc_te || 0),
    Number(payroll.cong_tang_ca || 0),
    Number(payroll.luong_tang_ca || 0),
    findPayrollAmount(allowanceRows, ['an trua']),
    findPayrollAmount(allowanceRows, ['dien thoai']),
    findPayrollAmount(allowanceRows, ['xang xe']),
    findPayrollAmount(allowanceRows, ['trach nhiem']),
    Number(payroll.tong_luong || 0),
    findPayrollRate(deductionRows, ['bhxh', 'bao hiem xa hoi']),
    findPayrollRate(deductionRows, ['bhyt', 'bao hiem y te']),
    findPayrollRate(deductionRows, ['cong doan']),
    Number(payroll.tong_tam_ung || 0),
    Number(payroll.thuc_nhan || 0)
  ];
  sheet.addRow(rowValues);

  sheet.columns = [
    { width: 5 },
    { width: 12 },
    { width: 22 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 14 }
  ];

  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 24;
  sheet.eachRow(function(row, rowNumber) {
    row.eachCell(function(cell, colNumber) {
      setPayrollExportCellStyle(cell, {
        bold: rowNumber === 1,
        horizontal: colNumber === 3 || colNumber === 4 ? 'left' : 'center'
      });
      if (rowNumber === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      }
      if (rowNumber === 2 && [5, 7, 9, 10, 11, 12, 13, 14, 17, 18, 19].indexOf(colNumber) >= 0) {
        cell.numFmt = '#,##0';
      }
      if (rowNumber === 2 && [6, 8, 15, 16].indexOf(colNumber) >= 0) {
        cell.numFmt = '0.##';
      }
    });
  });

  sheet.autoFilter = { from: 'A1', to: 'S1' };
  return workbook;
}

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

exports.index = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var activeTab = String(req.query.tab || '').trim();
    var keyword = String(req.query.keyword || '').trim();
    var keywordRegex = keyword ? new RegExp(escapeRegex(keyword), 'i') : null;

    var employeeQuery = {
      cua_hang_id: storeId,
      trang_thai: 'active'
    };
    var phongBanQuery = { cua_hang_id: storeId };
    var chucDanhQuery = { cua_hang_id: storeId };
    var khoanNopQuery = { cua_hang_id: storeId };
    var phuCapQuery = { cua_hang_id: storeId };

    if (keywordRegex && activeTab === 'departments') {
      phongBanQuery.$or = [
        { ma_phong_ban: keywordRegex },
        { ten_phong_ban: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'positions') {
      chucDanhQuery.$or = [
        { ma_chuc_danh: keywordRegex },
        { ten_chuc_danh: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'contributions') {
      khoanNopQuery.$or = [
        { ma_khoan: keywordRegex },
        { ten_khoan: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'allowances') {
      phuCapQuery.$or = [
        { ma_phu_cap: keywordRegex },
        { ten_phu_cap: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    var employees = await NhanVien.find(employeeQuery)
      .select('ma_nhan_vien ten_nhan_vien')
      .sort({ ma_nhan_vien: 1, ten_nhan_vien: 1 })
      .lean();
    var employeeIds = employees.map(function(item) { return item._id; });
    var employeeSalaryMap = await getSalaryMap(storeId, employeeIds);
    employees.forEach(function(item) {
      item.luong = employeeSalaryMap[String(item._id)] || {};
    });

    var phongBans = await PhongBan.find(phongBanQuery)
      .sort({ trang_thai: 1, ma_phong_ban: 1, ten_phong_ban: 1 })
      .lean();

    var chucDanhs = await ChucDanh.find(chucDanhQuery)
      .sort({ trang_thai: 1, ma_chuc_danh: 1, ten_chuc_danh: 1 })
      .lean();

    var danhMucKhoanNops = await DanhMucKhoanNop.find(khoanNopQuery)
      .populate('noi_nop_id', 'ma_noi_nop ten_noi_nop trang_thai')
      .sort({ ma_khoan: 1, ten_khoan: 1 })
      .lean();

    var noiNops = await NoiNopKhoanNop.find({ cua_hang_id: storeId })
      .sort({ trang_thai: 1, ma_noi_nop: 1, ten_noi_nop: 1 })
      .lean();

    var danhMucPhuCaps = await DanhMucPhuCap.find(phuCapQuery)
      .sort({ trang_thai: 1, ma_phu_cap: 1, ten_phu_cap: 1 })
      .lean();

    var selectedEmployeeId = String(req.query.nhan_vien_id || req.query.employee || '');
    if (!selectedEmployeeId && employees.length) {
      selectedEmployeeId = String(employees[0]._id);
    }

    res.render('Chamcong/chamcong/index', {
      pageTitle: 'Chấm công',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      employees: employees,
      phongBans: phongBans,
      chucDanhs: chucDanhs,
      danhMucKhoanNops: danhMucKhoanNops,
      noiNops: noiNops,
      danhMucPhuCaps: danhMucPhuCaps,
      selectedEmployeeId: selectedEmployeeId,
      weekStart: formatDateKey(new Date())
    });
  } catch (error) {
    next(error);
  }
};

exports.getTuan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var employeeId = String(req.query.nhan_vien_id || req.query.employee || '').trim();
    var monthRange = parseMonthKey(req.query.thang || req.query.month);

    if (!storeId || !employeeId || !isValidObjectId(employeeId) || !monthRange) {
      return res.status(400).json({ success: false, message: 'Dữ liệu chấm công không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId
    }).select('_id').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });
    }

    var rows = await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: {
        $gte: monthRange.start,
        $lt: monthRange.end
      }
    }).sort({ ngay_cham_cong: 1 }).lean();
    var attendanceIds = rows.map(function(row) { return row._id; });
    var payrollMap = {};
    if (attendanceIds.length) {
      var payrollRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: attendanceIds }
      }).select('_id ma_bang_luong cham_cong_ids trang_thai_thanh_toan').sort({ created_at: -1 }).lean();
      payrollRows.forEach(function(payroll) {
        (payroll.cham_cong_ids || []).forEach(function(attendanceId) {
          var key = String(attendanceId);
          if (!payrollMap[key]) {
            payrollMap[key] = {
              id: String(payroll._id),
              ma_bang_luong: payroll.ma_bang_luong || '',
              trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || 'chua_thanh_toan',
              message: 'Đã có bảng chấm công'
            };
          }
        });
      });
    }

    res.json({
      success: true,
      mode: 'ngay',
      days: rows.map(function(row) { return serializeAttendance(row, payrollMap); })
    });
  } catch (error) {
    next(error);
  }
};

exports.saveTuan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var userId = req.user && (req.user._id || req.user.id);
    var employeeId = String((req.body && req.body.nhan_vien_id) || '').trim();
    var rows = Array.isArray(req.body && req.body.days) ? req.body.days : [];

    if (!storeId || !employeeId || !isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu chấm công không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId
    }).select('_id').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });
    }

    var normalizedRows = rows.map(normalizeAttendanceRow).filter(Boolean);
    var seen = {};
    var saved = 0;
    var removed = 0;
    var affectedDateKeys = {};
    var affectedDateValues = [];

    normalizedRows.forEach(function(row) {
      if (!affectedDateKeys[row.ngay_key]) {
        affectedDateKeys[row.ngay_key] = true;
        affectedDateValues.push(row.ngay_cham_cong);
      }
    });

    var attendanceById = {};
    var existingRows = affectedDateValues.length ? await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $in: affectedDateValues }
    }).lean() : [];
    existingRows.forEach(function(row) {
      attendanceById[String(row._id)] = row;
    });
    var existingAttendanceIds = existingRows.map(function(row) { return row._id; });
    var usedAttendanceMap = {};
    if (existingAttendanceIds.length) {
      var usedAttendancePayrolls = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: existingAttendanceIds }
      }).select('_id ma_bang_luong cham_cong_ids trang_thai_thanh_toan').lean();
      usedAttendancePayrolls.forEach(function(payroll) {
        (payroll.cham_cong_ids || []).forEach(function(attendanceId) {
          var key = String(attendanceId);
          if (!usedAttendanceMap[key]) {
            usedAttendanceMap[key] = {
              _id: String(payroll._id),
              ma_bang_luong: payroll.ma_bang_luong || '',
              trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || ''
            };
          }
        });
      });
    }

    for (var i = 0; i < normalizedRows.length; i += 1) {
      var row = normalizedRows[i];
      if (seen[row.ngay_key]) continue;
      seen[row.ngay_key] = true;

      var query = {
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: row.ngay_cham_cong
      };
      var existingRow = existingRows.find(function(item) {
        return formatDateKey(new Date(item.ngay_cham_cong)) === row.ngay_key;
      });
      if (existingRow && usedAttendanceMap[String(existingRow._id)]) {
        continue;
      }

      if (!row.should_save) {
        var deleteResult = await ChamCong.deleteOne(query);
        removed += Number(deleteResult.deletedCount || 0);
        continue;
      }

      var setPayload = {
        ca_sang: row.ca_sang,
        ca_chieu: row.ca_chieu,
        tick_tang_ca: row.tick_tang_ca,
        cong_tang_ca: row.cong_tang_ca,
        ghi_chu: row.ghi_chu
      };
      var insertPayload = {
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: row.ngay_cham_cong
      };
      if (userId) {
        setPayload.nguoi_cap_nhat_id = userId;
        insertPayload.nguoi_tao_id = userId;
      }

      await ChamCong.updateOne(
        query,
        {
          $set: setPayload,
          $setOnInsert: insertPayload
        },
        { upsert: true, runValidators: true }
      );
      saved += 1;
    }

    var currentRows = affectedDateValues.length ? await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $in: affectedDateValues }
    }).lean() : [];
    currentRows.forEach(function(row) {
      attendanceById[String(row._id)] = row;
    });
    var payrollCreated = [];
    var payrollSourceRows = currentRows.filter(function(row) {
      if (usedAttendanceMap[String(row._id)]) return false;
      return attendanceWorkUnits(row) > 0 || String(row.ghi_chu || '').trim();
    });
    if (payrollSourceRows.length) {
      var payrollEmployee = await NhanVien.findOne({
        _id: employeeId,
        cua_hang_id: storeId
      }).populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
        .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
        .lean();
      var groupedRows = {};
      payrollSourceRows.forEach(function(row) {
        var month = formatMonthKey(new Date(row.ngay_cham_cong));
        var key = employeeId + '_' + month;
        if (!groupedRows[key]) {
          groupedRows[key] = {
            employeeId: employeeId,
            employee: payrollEmployee || {},
            month: month,
            rows: []
          };
        }
        groupedRows[key].rows.push(row);
      });
      var maxDate = payrollSourceRows.reduce(function(max, row) {
        var value = new Date(row.ngay_cham_cong);
        return value > max ? value : max;
      }, new Date(0));
      var salaryByMonth = {};
      var groupMonths = Object.keys(groupedRows);
      for (var sm = 0; sm < groupMonths.length; sm += 1) {
        var groupMonth = groupedRows[groupMonths[sm]].month;
        var monthRange = parseMonthKey(groupMonth);
        var salaryAsOf = monthRange ? new Date(monthRange.end.getTime() - 1) : maxDate;
        salaryByMonth[groupMonth] = await getSalaryMap(storeId, [employeeId], salaryAsOf);
      }
      var allowanceRows = await PhuCapNhanVien.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai: 'active'
      }).populate('danh_muc_phu_cap_id', 'ma_phu_cap ten_phu_cap').lean();
      var allowanceMap = {};
      allowanceMap[employeeId] = allowanceRows;
      var advanceRows = await TamUngNhanVien.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_tam_ung: { $gte: new Date(Date.UTC(maxDate.getUTCFullYear(), 0, 1)), $lt: new Date(Date.UTC(maxDate.getUTCFullYear() + 1, 0, 1)) },
        trang_thai: 'active'
      }).lean();
      var usedAdvanceRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        tam_ung_ids: { $exists: true, $ne: [] }
      }).select('tam_ung_ids').lean();
      var usedAdvanceMap = {};
      usedAdvanceRows.forEach(function(payroll) {
        (payroll.tam_ung_ids || []).forEach(function(advanceId) {
          usedAdvanceMap[String(advanceId)] = true;
        });
      });
      var advanceMap = {};
      advanceRows.forEach(function(row) {
        if (usedAdvanceMap[String(row._id)]) return;
        var key = String(row.nhan_vien_id) + '_' + formatMonthKey(new Date(row.ngay_tam_ung));
        if (!advanceMap[key]) advanceMap[key] = [];
        advanceMap[key].push(row);
      });

      var groupKeys = Object.keys(groupedRows);
      for (var g = 0; g < groupKeys.length; g += 1) {
        groupedRows[groupKeys[g]].rows.sort(function(a, b) {
          return new Date(a.ngay_cham_cong) - new Date(b.ngay_cham_cong);
        });
        var salaryMap = salaryByMonth[groupedRows[groupKeys[g]].month] || {};
        var payload = buildPayrollPayloadFromGroup(groupedRows[groupKeys[g]], salaryMap, allowanceMap, advanceMap, storeId, userId);
        payload.ma_bang_luong = await nextPayrollCode(storeId, payload.ma_bang_luong);
        payload.da_thanh_toan = 0;
        payload.con_phai_tra = Number(payload.thuc_nhan || 0);
        payload.trang_thai_thanh_toan = 'chua_thanh_toan';
        payload.trang_thai_du_lieu = 'active';
        var created = await BangLuong.create(payload);
        payrollCreated.push({
          _id: String(created._id),
          ma_bang_luong: created.ma_bang_luong || ''
        });
      }
    }
    var affectedAttendanceIds = Object.keys(attendanceById);
    var payrollWarnings = [];
    if (affectedAttendanceIds.length) {
      var relatedPayrollRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: affectedAttendanceIds }
      }).populate('cham_cong_ids').sort({ nam: -1, thang: -1 }).lean();
      for (var rp = 0; rp < relatedPayrollRows.length; rp += 1) {
        relatedPayrollRows[rp] = await normalizeMissingPayrollSalary(storeId, relatedPayrollRows[rp], userId);
      }
      var payrollIds = relatedPayrollRows.map(function(row) { return row._id; });
      var payments = payrollIds.length ? await ThanhToanLuong.find({
        cua_hang_id: storeId,
        bang_luong_id: { $in: payrollIds },
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' }
      }).populate('phieu_chi_id', 'ma_phieu gia_tri ngay_lap').sort({ ngay_thanh_toan: -1, created_at: -1 }).lean() : [];
      var paymentMap = {};
      payments.forEach(function(payment) {
        var key = String(payment.bang_luong_id);
        if (!paymentMap[key]) paymentMap[key] = [];
        paymentMap[key].push(payment);
      });
      payrollWarnings = buildAttendancePayrollWarnings(relatedPayrollRows, paymentMap, affectedDateKeys, attendanceById);
    }

    res.json({
      success: true,
      message: 'Đã lưu chấm công.',
      saved: saved,
      removed: removed,
      payrolls: payrollCreated,
      warnings: payrollWarnings
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Dữ liệu bị trùng, vui lòng tải lại trang và lưu lại.' });
    }
    next(error);
  }
};

exports.listBangLuong = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });

    var employeeId = String(req.query.nhan_vien_id || '').trim();
    var statusFilter = String(req.query.trang_thai || '').trim();
    var query = { cua_hang_id: storeId };
    if (employeeId) {
      if (!isValidObjectId(employeeId)) {
        return res.status(400).json({ success: false, message: 'Nhân viên không hợp lệ.' });
      }
      query.nhan_vien_id = employeeId;
    }

    var payrollQuery = { cua_hang_id: storeId, trang_thai_du_lieu: 'active' };
    if (employeeId) payrollQuery.nhan_vien_id = employeeId;
    if (!statusFilter || statusFilter === 'all') {
      // keep all payment statuses
    } else if (statusFilter === 'da_thanh_toan') payrollQuery.trang_thai_thanh_toan = 'da_thanh_toan';
    else payrollQuery.trang_thai_thanh_toan = { $ne: 'da_thanh_toan' };

    var payrollRows = await BangLuong.find(payrollQuery)
      .populate('cham_cong_ids')
      .sort({ nam: -1, thang: -1, ma_nhan_vien_snapshot: 1 })
      .lean();
    for (var p = 0; p < payrollRows.length; p += 1) {
      payrollRows[p] = await normalizeUnpaidPayrollAdvances(storeId, payrollRows[p], req.user && (req.user._id || req.user.id));
      payrollRows[p] = await normalizeMissingPayrollSalary(storeId, payrollRows[p], req.user && (req.user._id || req.user.id));
    }
    var payrollIds = payrollRows.map(function(row) { return row._id; });
    var payments = payrollIds.length ? await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: { $in: payrollIds },
      trang_thai: 'completed',
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).populate('phieu_chi_id', 'ma_phieu gia_tri ngay_lap').sort({ ngay_thanh_toan: -1, created_at: -1 }).lean() : [];
    var paymentMap = {};
    payments.forEach(function(payment) {
      var key = String(payment.bang_luong_id);
      if (!paymentMap[key]) paymentMap[key] = [];
      paymentMap[key].push(payment);
    });

    res.json({
      success: true,
      items: payrollRows.map(function(row) { return serializeBangLuong(row, paymentMap); })
    });
  } catch (error) {
    next(error);
  }
};

async function handleBangLuongThanhToanPreview(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }
    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' }).populate('cham_cong_ids').lean();
    if (!payroll) return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương.' });
    payroll = await normalizeUnpaidPayrollAdvances(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await enrichPayrollEmployerRates(storeId, payroll, req.user && (req.user._id || req.user.id));
    var due = Math.max(0, Number(payroll.con_phai_tra != null ? payroll.con_phai_tra : Number(payroll.thuc_nhan || 0) - Number(payroll.da_thanh_toan || 0)));
    var employerSummary = buildEmployerContributionSummary(payroll);
    var employerPaidRows = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      loai_thanh_toan: 'nsdld',
      trang_thai: 'completed',
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('so_tien').lean();
    var paidEmployer = employerPaidRows.reduce(function(sum, row) {
      return sum + Number(row.so_tien || 0);
    }, 0);
    var remainingEmployer = Math.max(0, employerSummary.tong - paidEmployer);
    return res.json({
      success: true,
      bang_luong_id: String(payroll._id),
      ma_bang_luong: payroll.ma_bang_luong || '',
      tong_luong: Number(payroll.thuc_nhan || 0),
      da_thanh_toan: payroll.trang_thai_thanh_toan === 'da_thanh_toan',
      da_tra: Number(payroll.da_thanh_toan || 0),
      con_thanh_toan: due,
      tong_nsdld: employerSummary.tong,
      da_tra_nsdld: paidEmployer,
      con_nsdld: remainingEmployer,
      payroll_lines: buildPayrollFormulaLines(payroll),
      employer_lines: employerSummary.lines
    });
  } catch (error) {
    return next(error);
  }
}

async function handleBangLuongCreatePayment(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }
    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' })
      .populate('nhan_vien_id', 'ma_nhan_vien ten_nhan_vien')
      .populate('cham_cong_ids')
      .lean();
    if (!payroll) return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương.' });
    payroll = await normalizeUnpaidPayrollAdvances(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await enrichPayrollEmployerRates(storeId, payroll, req.user && (req.user._id || req.user.id));

    var cashAmount = parseMoney(req.body && req.body.tien_mat);
    var transferAmount = parseMoney(req.body && req.body.chuyen_khoan);
    var amount = cashAmount + transferAmount;
    var due = Math.max(0, Number(payroll.con_phai_tra != null ? payroll.con_phai_tra : Number(payroll.thuc_nhan || 0) - Number(payroll.da_thanh_toan || 0)));
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Số tiền thanh toán phải lớn hơn 0.' });
    if (amount > due) return res.status(400).json({ success: false, message: 'Số tiền thanh toán không được vượt số còn phải trả.' });

    var cashBookId = String(req.body && req.body.so_quy_tien_mat_id || '').trim();
    var transferBookId = String(req.body && req.body.so_quy_chuyen_khoan_id || '').trim();
    if (cashAmount > 0 && !cashBookId) return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ tiền mặt.' });
    if (transferAmount > 0 && !transferBookId) return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ chuyển khoản.' });

    var employerSummary = buildEmployerContributionSummary(payroll);
    var employerPaidRows = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      loai_thanh_toan: 'nsdld',
      trang_thai: 'completed',
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('so_tien').lean();
    var paidEmployer = employerPaidRows.reduce(function(sum, row) {
      return sum + Number(row.so_tien || 0);
    }, 0);
    var expectedEmployer = calcEmployerPaymentShare(employerSummary.tong, paidEmployer, due, amount);
    var employerCashAmount = parseMoney(req.body && req.body.nsdld_tien_mat);
    var employerTransferAmount = parseMoney(req.body && req.body.nsdld_chuyen_khoan);
    var employerAmount = employerCashAmount + employerTransferAmount;
    var employerCashBookId = String(req.body && req.body.nsdld_so_quy_tien_mat_id || '').trim();
    var employerTransferBookId = String(req.body && req.body.nsdld_so_quy_chuyen_khoan_id || '').trim();
    if (expectedEmployer > 0) {
      if (employerAmount !== expectedEmployer) {
        return res.status(400).json({
          success: false,
          message: 'Số tiền chi NSDLĐ phải bằng ' + expectedEmployer.toLocaleString('vi-VN') + ' (theo tỷ lệ lần thanh toán lương).'
        });
      }
      if (employerCashAmount > 0 && !employerCashBookId) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ tiền mặt cho chi NSDLĐ.' });
      }
      if (employerTransferAmount > 0 && !employerTransferBookId) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ chuyển khoản cho chi NSDLĐ.' });
      }
    } else if (employerAmount > 0) {
      return res.status(400).json({ success: false, message: 'Lần thanh toán này không phát sinh chi NSDLĐ.' });
    }

    var employee = payroll.nhan_vien_id && typeof payroll.nhan_vien_id === 'object' ? payroll.nhan_vien_id : null;
    var employeeLabel = (payroll.ma_nhan_vien_snapshot ? payroll.ma_nhan_vien_snapshot + ' - ' : '') + (payroll.ten_nhan_vien_snapshot || (employee && employee.ten_nhan_vien) || '');
    var userId = req.user && (req.user._id || req.user.id);
    var receipt = await taoPhieuThuChi({
      loai_phieu: 'chi',
      loai_thu_chi: 'Thanh toán lương nhân viên',
      ngay_lap: new Date(),
      gia_tri: amount,
      doi_tuong: employeeLabel,
      ghi_chu: 'Thanh toán lương ' + (payroll.ma_bang_luong || ''),
      cua_hang_id: storeId,
      chi_nhanh_id: req.session && req.session.chi_nhanh_id,
      nguoi_tao_id: userId,
      hach_toan: true,
      nhom_doi_tuong: 'nhan_vien',
      nhan_vien_id: payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id,
      document_type: 'khac',
      phuong_thuc_thanh_toan: transferAmount > 0 && cashAmount <= 0 ? 'chuyen_khoan' : 'tien_mat',
      payment_v2: true,
      so_quy_id: cashBookId || transferBookId,
      so_quy_tien_mat_id: cashBookId,
      so_quy_chuyen_khoan_id: transferBookId,
      chi_tiet_thanh_toan: {
        tien_mat: cashAmount,
        chuyen_khoan: transferAmount,
        tien_tra_khach: 0,
        so_quy_tien_mat_id: cashBookId || undefined,
        so_quy_chuyen_khoan_id: transferBookId || undefined
      },
      ma_chung_tu_goc: payroll.ma_bang_luong,
      chung_tu_khac: payroll.ma_bang_luong
    });

    var payment = await ThanhToanLuong.create({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      ngay_thanh_toan: new Date(),
      so_tien: amount,
      ma_tham_chieu: receipt.ma_phieu || '',
      phieu_chi_id: receipt._id,
      tien_mat: cashAmount,
      chuyen_khoan: transferAmount,
      so_quy_tien_mat_id: cashBookId || undefined,
      so_quy_chuyen_khoan_id: transferBookId || undefined,
      ghi_chu: 'Thanh toán lương ' + (payroll.ma_bang_luong || ''),
      nguoi_thanh_toan_id: userId,
      loai_thanh_toan: 'nhan_vien',
      trang_thai: 'completed',
      trang_thai_du_lieu: 'active'
    });

    var employerReceipt = null;
    var employerPayment = null;
    if (expectedEmployer > 0) {
      employerReceipt = await taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'Chi khoản nộp NSDLĐ',
        ngay_lap: new Date(),
        gia_tri: expectedEmployer,
        doi_tuong: 'Người sử dụng lao động - ' + employeeLabel,
        ghi_chu: 'Chi NSDLĐ theo bảng lương ' + (payroll.ma_bang_luong || ''),
        cua_hang_id: storeId,
        chi_nhanh_id: req.session && req.session.chi_nhanh_id,
        nguoi_tao_id: userId,
        hach_toan: true,
        nhom_doi_tuong: 'khac',
        nhan_vien_id: payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id,
        document_type: 'khac',
        phuong_thuc_thanh_toan: employerTransferAmount > 0 && employerCashAmount <= 0 ? 'chuyen_khoan' : 'tien_mat',
        payment_v2: true,
        so_quy_id: employerCashBookId || employerTransferBookId,
        so_quy_tien_mat_id: employerCashBookId,
        so_quy_chuyen_khoan_id: employerTransferBookId,
        chi_tiet_thanh_toan: {
          tien_mat: employerCashAmount,
          chuyen_khoan: employerTransferAmount,
          tien_tra_khach: 0,
          so_quy_tien_mat_id: employerCashBookId || undefined,
          so_quy_chuyen_khoan_id: employerTransferBookId || undefined
        },
        ma_chung_tu_goc: payroll.ma_bang_luong,
        chung_tu_khac: payroll.ma_bang_luong
      });

      employerPayment = await ThanhToanLuong.create({
        cua_hang_id: storeId,
        bang_luong_id: payroll._id,
        ngay_thanh_toan: new Date(),
        so_tien: expectedEmployer,
        ma_tham_chieu: employerReceipt.ma_phieu || '',
        phieu_chi_id: employerReceipt._id,
        tien_mat: employerCashAmount,
        chuyen_khoan: employerTransferAmount,
        so_quy_tien_mat_id: employerCashBookId || undefined,
        so_quy_chuyen_khoan_id: employerTransferBookId || undefined,
        ghi_chu: 'Chi NSDLĐ theo bảng lương ' + (payroll.ma_bang_luong || ''),
        nguoi_thanh_toan_id: userId,
        loai_thanh_toan: 'nsdld',
        trang_thai: 'completed',
        trang_thai_du_lieu: 'active'
      });
    }

    var nextPaid = Number(payroll.da_thanh_toan || 0) + amount;
    var nextDue = Math.max(0, Number(payroll.thuc_nhan || 0) - nextPaid);
    var nextStatus = nextDue <= 0 ? 'da_thanh_toan' : 'thanh_toan_mot_phan';
    await BangLuong.updateOne(
      { _id: payroll._id, cua_hang_id: storeId },
      {
        $set: {
          da_thanh_toan: nextPaid,
          con_phai_tra: nextDue,
          trang_thai_thanh_toan: nextStatus,
          nguoi_cap_nhat_id: userId
        }
      },
      { runValidators: true }
    );

    return res.json({
      success: true,
      message: expectedEmployer > 0
        ? 'Đã thanh toán lương và tạo phiếu chi NSDLĐ.'
        : 'Đã thanh toán lương và tạo phiếu chi.',
      payment: { _id: String(payment._id), so_tien: Number(payment.so_tien || 0) },
      receipt: {
        _id: String(receipt._id),
        ma_phieu: receipt.ma_phieu || '',
        gia_tri: Number(receipt.gia_tri || 0),
        ma_chung_tu_goc: payroll.ma_bang_luong || ''
      },
      payment_nsdld: employerPayment ? {
        _id: String(employerPayment._id),
        so_tien: Number(employerPayment.so_tien || 0)
      } : null,
      receipt_nsdld: employerReceipt ? {
        _id: String(employerReceipt._id),
        ma_phieu: employerReceipt.ma_phieu || '',
        gia_tri: Number(employerReceipt.gia_tri || 0),
        ma_chung_tu_goc: payroll.ma_bang_luong || ''
      } : null,
      bang_luong: {
        _id: String(payroll._id),
        da_thanh_toan: nextPaid,
        con_phai_tra: nextDue,
        trang_thai_thanh_toan: nextStatus
      }
    });
  } catch (error) {
    return next(error);
  }
}

exports.getBangLuongThanhToan = async function(req, res, next) {
  return handleBangLuongThanhToanPreview(req, res, next);
  res.status(400).json({
    success: false,
    message: 'Bảng này đang được tổng hợp tạm từ chấm công. Chưa tạo thanh toán trực tiếp từ bảng tạm.'
  });
};

exports.deleteBangLuong = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }

    var relatedPayments = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: id,
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('_id phieu_chi_id').lean();
    var relatedPaymentIds = relatedPayments.map(function(row) { return row._id; });
    var relatedReceiptIds = relatedPayments.map(function(row) { return row.phieu_chi_id; }).filter(Boolean);

    var updated = await BangLuong.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId, trang_thai_du_lieu: { $ne: 'inactive' } },
      {
        $set: {
          trang_thai_du_lieu: 'inactive',
          nguoi_cap_nhat_id: req.user && (req.user._id || req.user.id)
        }
      },
      { new: true }
    ).lean();
    if (updated) {
      if (relatedPaymentIds.length) {
        await ThanhToanLuong.updateMany(
          { _id: { $in: relatedPaymentIds }, cua_hang_id: storeId },
          {
            $set: {
              trang_thai_du_lieu: 'inactive'
            }
          },
          { runValidators: true }
        );
      }

      if (relatedReceiptIds.length) {
        await PhieuThuChi.updateMany(
          { _id: { $in: relatedReceiptIds }, cua_hang_id: storeId },
          {
            $set: {
              trang_thai_du_lieu: 'inactive',
              nguoi_huy_id: req.user && (req.user._id || req.user.id),
              ngay_huy: new Date(),
              ly_do_huy: 'Xoa bang luong ' + (updated.ma_bang_luong || '')
            }
          },
          { runValidators: true }
        );
      }
    }
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương active.' });
    }

    return res.json({
      success: true,
      message: 'Đã xóa bảng lương.',
      item: {
        _id: String(updated._id),
        ma_bang_luong: updated.ma_bang_luong || '',
        trang_thai_du_lieu: updated.trang_thai_du_lieu || 'inactive',
        so_thanh_toan_inactive: relatedPaymentIds.length,
        so_phieu_chi_inactive: relatedReceiptIds.length
      }
    });
  } catch (error) {
    return next(error);
  }
};

exports.exportBangLuongExcel = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).send('Dữ liệu không hợp lệ.');
    }

    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' })
      .populate('cham_cong_ids')
      .lean();
    if (!payroll) {
      return res.status(404).send('Không tìm thấy bảng lương.');
    }
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));

    var employee = await NhanVien.findOne({ _id: payroll.nhan_vien_id, cua_hang_id: storeId })
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    if (employee && employee.chuc_danh_id && typeof employee.chuc_danh_id === 'object') {
      employee.chuc_danh = employee.chuc_danh_id.ten_chuc_danh || '';
    }

    var workbook = buildPayrollExportWorkbook(payroll, employee || {});
    var filename = payrollExportFilename(payroll);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
};

exports.createBangLuongPhieuChi = async function(req, res, next) {
  return handleBangLuongCreatePayment(req, res, next);
  res.status(400).json({
    success: false,
    message: 'Bảng này đang được tổng hợp tạm từ chấm công. Chưa tạo phiếu chi trực tiếp từ bảng tạm.'
  });
};
