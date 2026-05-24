var { NgayLamViecCuaHang, NgayLeTet } = require('../models/hr.model');

var DEFAULT_WORK_WEEKDAYS = [2, 3, 4, 5, 6, 7];
var VN_OFFSET_MINUTES = 7 * 60;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDateParts(raw) {
  var match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function parseTimeParts(raw) {
  var match = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function dateFromVNParts(parts) {
  if (!parts) return null;
  var year = Number(parts.year);
  var month = Number(parts.month);
  var day = Number(parts.day);
  var hour = Number(parts.hour || 0);
  var minute = Number(parts.minute || 0);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
    !Number.isInteger(hour) || !Number.isInteger(minute) ||
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) {
    return null;
  }
  var d = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - VN_OFFSET_MINUTES * 60000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateInputVN(date) {
  var d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  var vn = new Date(d.getTime() + VN_OFFSET_MINUTES * 60000);
  return vn.getUTCFullYear() + '-' + pad2(vn.getUTCMonth() + 1) + '-' + pad2(vn.getUTCDate());
}

function parseVNDateOnly(dateStr) {
  if (dateStr instanceof Date) {
    return parseVNDateOnly(formatDateInputVN(dateStr));
  }
  var parts = parseDateParts(dateStr);
  return parts ? dateFromVNParts(parts) : null;
}

function parseVNDateTime(dateTimeStr) {
  if (dateTimeStr instanceof Date) {
    return Number.isNaN(dateTimeStr.getTime()) ? null : dateTimeStr;
  }
  var raw = String(dateTimeStr || '').trim();
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    var instant = new Date(raw);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  var normalized = raw.replace(' ', 'T');
  var parts = parseDateParts(normalized);
  var timeRaw = normalized.split('T')[1] || '00:00';
  var time = parseTimeParts(timeRaw);
  if (!parts || !time) return null;
  return dateFromVNParts(Object.assign(parts, time));
}

function buildVNShiftDateTime(ngayDate, timeHHmm) {
  var dateText = formatDateInputVN(ngayDate);
  var time = parseTimeParts(timeHHmm);
  if (!dateText || !time) return null;
  return parseVNDateTime(dateText + 'T' + pad2(time.hour) + ':' + pad2(time.minute));
}

function startOfDay(date) {
  return parseVNDateOnly(date);
}

function getThuTrongTuan(ngay) {
  var d = startOfDay(ngay);
  if (!d) return null;
  var vn = new Date(d.getTime() + VN_OFFSET_MINUTES * 60000);
  var js = vn.getUTCDay();
  return js === 0 ? 8 : js + 1;
}

function normalizeWorkDate(value) {
  return parseVNDateOnly(value);
}

function parseDateInput(value) {
  return parseVNDateOnly(value);
}

async function getWorkDaysConfig(storeId) {
  var doc = await NgayLamViecCuaHang.findOne({ cua_hang_id: storeId }).lean();
  if (!doc || !Array.isArray(doc.thu_trong_tuan) || !doc.thu_trong_tuan.length) {
    return DEFAULT_WORK_WEEKDAYS;
  }
  return doc.thu_trong_tuan.map(Number).filter(function(n) {
    return Number.isFinite(n);
  });
}

async function getLoaiNgayLamViec(storeId, ngay) {
  var day = normalizeWorkDate(ngay);
  if (!day) {
    return {
      loai_ngay: 'ngay_thuong',
      ten_ngay_le: '',
      he_so_luong_ngay: 100
    };
  }

  var holiday = await NgayLeTet.findOne({
    cua_hang_id: storeId,
    trang_thai: 'active',
    tu_ngay: { $lte: day },
    den_ngay: { $gte: day }
  }).sort({ tu_ngay: -1 }).lean();

  if (holiday) {
    return {
      loai_ngay: 'ngay_le_tet',
      ten_ngay_le: holiday.ten_ngay_le || '',
      he_so_luong_ngay: Number(holiday.he_so_luong || 300)
    };
  }

  var thu = getThuTrongTuan(day);
  if (thu === 8) {
    return { loai_ngay: 'chu_nhat', ten_ngay_le: '', he_so_luong_ngay: 100 };
  }
  if (thu === 7) {
    return { loai_ngay: 'thu_7', ten_ngay_le: '', he_so_luong_ngay: 100 };
  }

  var allowed = await getWorkDaysConfig(storeId);
  if (allowed.indexOf(thu) < 0) {
    return { loai_ngay: 'ngay_nghi', ten_ngay_le: '', he_so_luong_ngay: 100 };
  }

  return { loai_ngay: 'ngay_thuong', ten_ngay_le: '', he_so_luong_ngay: 100 };
}

var LOAI_NGAY_LABELS = {
  ngay_thuong: 'Ngày thường',
  thu_7: 'Thứ 7',
  chu_nhat: 'Chủ nhật',
  ngay_nghi: 'Ngày nghỉ',
  ngay_le_tet: 'Ngày lễ tết'
};

function loaiNgayLabel(code) {
  return LOAI_NGAY_LABELS[code] || code || '';
}

module.exports = {
  startOfDay,
  parseVNDateOnly,
  parseVNDateTime,
  formatDateInputVN,
  buildVNShiftDateTime,
  getThuTrongTuan,
  normalizeWorkDate,
  parseDateInput,
  getWorkDaysConfig,
  getLoaiNgayLamViec,
  loaiNgayLabel,
  LOAI_NGAY_LABELS,
  DEFAULT_WORK_WEEKDAYS
};
