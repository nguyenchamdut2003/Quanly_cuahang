var { NgayLamViecCuaHang } = require('../models/hr.model');
var {
  startOfDay,
  normalizeWorkDate,
  parseVNDateTime,
  buildVNShiftDateTime
} = require('./hrWorkDay');

var TRANG_THAI_LABELS = {
  chua_cham_cong: 'Chưa chấm công',
  dang_lam: 'Đang làm',
  dung_gio: 'Đúng giờ',
  di_muon: 'Đi muộn',
  ve_som: 'Về sớm',
  di_muon_ve_som: 'Đi muộn & về sớm',
  cham_cong_thieu: 'Chấm công thiếu',
  nghi_lam: 'Nghỉ làm',
  nghi_phep: 'Nghỉ phép'
};

function parseTimeOnDay(day, timeStr) {
  return buildVNShiftDateTime(day, timeStr);
}

function minutesOfDay(timeStr) {
  var parts = String(timeStr || '').trim().split(':');
  var hour = Number(parts[0]);
  var minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isOvernightCa(caSnapshot) {
  var start = minutesOfDay(caSnapshot && caSnapshot.gio_bat_dau);
  var end = minutesOfDay(caSnapshot && caSnapshot.gio_ket_thuc);
  return start != null && end != null && end <= start;
}

function buildShiftBounds(ngayChamCong, caSnapshot) {
  caSnapshot = caSnapshot || {};
  var day = startOfDay(ngayChamCong);
  if (!day) return { shiftStart: null, shiftEnd: null };

  var shiftStart = parseTimeOnDay(day, caSnapshot.gio_bat_dau);
  var shiftEnd = parseTimeOnDay(day, caSnapshot.gio_ket_thuc);
  if (!shiftStart || !shiftEnd || Number.isNaN(shiftStart.getTime()) || Number.isNaN(shiftEnd.getTime())) {
    return { shiftStart: null, shiftEnd: null };
  }
  if (shiftEnd.getTime() <= shiftStart.getTime()) {
    shiftEnd = new Date(shiftEnd);
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }
  return { shiftStart: shiftStart, shiftEnd: shiftEnd };
}

function parseDateTimeInput(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return parseVNDateTime(value);
}

function combineDayAndTime(ngayChamCong, timeValue) {
  var day = startOfDay(ngayChamCong);
  if (!day || !timeValue) return null;
  var raw = String(timeValue).trim();
  if (raw.indexOf('T') >= 0 || raw.indexOf(' ') >= 0) {
    return parseDateTimeInput(raw);
  }
  return parseTimeOnDay(day, raw);
}

async function getSoGioNgayCongChuan(storeId) {
  var doc = await NgayLamViecCuaHang.findOne({ cua_hang_id: storeId }).lean();
  var hours = doc ? Number(doc.so_gio_ngay_cong_chuan) : 8;
  return hours > 0 ? hours : 8;
}

function calculateChamCong(params) {
  params = params || {};
  var ngay = startOfDay(params.ngay_cham_cong);
  var gioVao = parseDateTimeInput(params.gio_vao);
  var gioRa = parseDateTimeInput(params.gio_ra);
  var ca = params.ca_lam_viec_snapshot || {};
  var soGioChuan = Number(params.so_gio_ngay_cong_chuan);
  if (!Number.isFinite(soGioChuan) || soGioChuan <= 0) soGioChuan = 8;

  var emptyMetrics = {
    so_phut_lam_viec: 0,
    so_phut_di_muon: 0,
    so_phut_ve_som: 0,
    so_phut_tang_ca_truoc_ca: 0,
    so_phut_tang_ca_sau_ca: 0,
    so_phut_tang_ca: 0,
    cong_quy_doi: 0
  };

  if (!gioVao && !gioRa) {
    return Object.assign({}, emptyMetrics, { trang_thai: 'chua_cham_cong' });
  }

  if (gioVao && !gioRa) {
    return Object.assign({}, emptyMetrics, { trang_thai: 'dang_lam' });
  }

  if (!gioVao || !gioRa) {
    return Object.assign({}, emptyMetrics, { trang_thai: 'cham_cong_thieu' });
  }

  var bounds = buildShiftBounds(ngay, ca);
  var isOvernightShift = !!(bounds.shiftStart && bounds.shiftEnd && isOvernightCa(ca));
  if (isOvernightShift && gioRa.getTime() < gioVao.getTime()) {
    gioRa = new Date(gioRa.getTime() + 24 * 60 * 60000);
  }
  var allowedLate = Number(ca.cho_phep_di_muon_phut || 0);
  var allowedEarly = Number(ca.cho_phep_ve_som_phut || 0);
  var soPhutDiMuon = 0;
  var soPhutVeSom = 0;

  if (bounds.shiftStart) {
    var lateMs = gioVao.getTime() - bounds.shiftStart.getTime() - allowedLate * 60000;
    soPhutDiMuon = Math.max(0, Math.round(lateMs / 60000));
  }

  if (bounds.shiftEnd) {
    var earlyMs = bounds.shiftEnd.getTime() - gioRa.getTime() - allowedEarly * 60000;
    soPhutVeSom = Math.max(0, Math.round(earlyMs / 60000));
  }

  var soPhutTangCaTruoc = 0;
  var soPhutTangCaSau = 0;
  if (ca.tinh_lam_them_truoc_ca && bounds.shiftStart) {
    soPhutTangCaTruoc = Math.max(0, Math.round((bounds.shiftStart.getTime() - gioVao.getTime()) / 60000));
  }
  if (ca.tinh_lam_them_sau_ca && bounds.shiftEnd) {
    soPhutTangCaSau = Math.max(0, Math.round((gioRa.getTime() - bounds.shiftEnd.getTime()) / 60000));
  }

  var regularMinutesRaw = 0;
  if (bounds.shiftStart && bounds.shiftEnd) {
    var regularStart = Math.max(gioVao.getTime(), bounds.shiftStart.getTime());
    var regularEnd = Math.min(gioRa.getTime(), bounds.shiftEnd.getTime());
    regularMinutesRaw = Math.max(0, Math.round((regularEnd - regularStart) / 60000));
  } else {
    regularMinutesRaw = Math.max(0, Math.round((gioRa.getTime() - gioVao.getTime()) / 60000));
  }

  var nghiGiua = Math.max(0, Number(ca.nghi_giua_ca_phut || 0));
  var breakMinutes = Math.min(nghiGiua, regularMinutesRaw);
  var soPhutLamViec = Math.max(0, regularMinutesRaw - breakMinutes);
  var soPhutTangCa = soPhutTangCaTruoc + soPhutTangCaSau;
  var congQuyDoi = Math.min(1, Math.round((soPhutLamViec / (soGioChuan * 60)) * 100) / 100);

  var trangThai = 'dung_gio';
  if (soPhutDiMuon > 0 && soPhutVeSom > 0) trangThai = 'di_muon_ve_som';
  else if (soPhutDiMuon > 0) trangThai = 'di_muon';
  else if (soPhutVeSom > 0) trangThai = 've_som';

  return {
    trang_thai: trangThai,
    so_phut_lam_viec: soPhutLamViec,
    so_phut_di_muon: soPhutDiMuon,
    so_phut_ve_som: soPhutVeSom,
    so_phut_tang_ca_truoc_ca: soPhutTangCaTruoc,
    so_phut_tang_ca_sau_ca: soPhutTangCaSau,
    so_phut_tang_ca: soPhutTangCa,
    cong_quy_doi: congQuyDoi
  };
}

function buildCaSnapshotFromShift(shift) {
  if (!shift) return {};
  return {
    ma_ca: shift.ma_ca,
    ten_ca: shift.ten_ca,
    gio_bat_dau: shift.gio_bat_dau,
    gio_ket_thuc: shift.gio_ket_thuc,
    nghi_giua_ca_phut: Number(shift.nghi_giua_ca_phut || 0),
    cho_phep_di_muon_phut: Number(shift.cho_phep_di_muon_phut || 0),
    cho_phep_ve_som_phut: Number(shift.cho_phep_ve_som_phut || 0),
    tinh_lam_them_truoc_ca: !!shift.tinh_lam_them_truoc_ca,
    tinh_lam_them_sau_ca: shift.tinh_lam_them_sau_ca !== false && shift.tinh_lam_them_sau_ca !== '0'
  };
}

function buildCaSnapshotFromSchedule(schedule, shift) {
  schedule = schedule || {};
  shift = shift || {};
  return {
    ma_ca: schedule.ma_ca || shift.ma_ca,
    ten_ca: schedule.ten_ca || shift.ten_ca,
    gio_bat_dau: schedule.gio_bat_dau || shift.gio_bat_dau,
    gio_ket_thuc: schedule.gio_ket_thuc || shift.gio_ket_thuc,
    nghi_giua_ca_phut: Number(schedule.nghi_giua_ca_phut != null ? schedule.nghi_giua_ca_phut : shift.nghi_giua_ca_phut || 0),
    cho_phep_di_muon_phut: Number(shift.cho_phep_di_muon_phut || 0),
    cho_phep_ve_som_phut: Number(shift.cho_phep_ve_som_phut || 0),
    tinh_lam_them_truoc_ca: !!shift.tinh_lam_them_truoc_ca,
    tinh_lam_them_sau_ca: shift.tinh_lam_them_sau_ca !== false && shift.tinh_lam_them_sau_ca !== '0'
  };
}

function trangThaiLabel(code) {
  return TRANG_THAI_LABELS[code] || code || '';
}

module.exports = {
  calculateChamCong,
  buildShiftBounds,
  combineDayAndTime,
  parseDateTimeInput,
  getSoGioNgayCongChuan,
  buildCaSnapshotFromShift,
  buildCaSnapshotFromSchedule,
  trangThaiLabel,
  TRANG_THAI_LABELS,
  normalizeWorkDate
};
