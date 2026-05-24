var mongoose = require('mongoose');
var { NgayLamViecCuaHang, NgayLeTet } = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var { parseVNDateOnly, formatDateInputVN } = require('../utils/hrWorkDay');

var ALLOWED_WEEKDAYS = [2, 3, 4, 5, 6, 7, 8];

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function toNumber(value, fallback) {
  var num = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return fallback || 0;
  return Math.max(0, num);
}

function startOfDay(date) {
  return parseVNDateOnly(date);
}

function calcDayCount(tuNgay, denNgay) {
  if (!tuNgay || !denNgay) return 1;
  var start = startOfDay(tuNgay);
  var end = startOfDay(denNgay);
  if (end < start) return 0;
  var diff = end.getTime() - start.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function defaultWorkDaysConfig() {
  return {
    thu_trong_tuan: [2, 3, 4, 5, 6, 7],
    so_gio_ngay_cong_chuan: 8,
    so_gio_nua_cong: 4,
    ghi_chu: '',
    trang_thai: 'active'
  };
}

function normalizeWeekdays(value) {
  var raw = Array.isArray(value) ? value : [];
  var seen = {};
  var list = [];
  raw.forEach(function(item) {
    var num = Number(item);
    if (!Number.isFinite(num)) return;
    num = Math.floor(num);
    if (ALLOWED_WEEKDAYS.indexOf(num) < 0) return;
    if (seen[num]) return;
    seen[num] = true;
    list.push(num);
  });
  list.sort(function(a, b) { return a - b; });
  return list;
}

function normalizeWorkDaysPayload(body) {
  body = body || {};
  return {
    thu_trong_tuan: normalizeWeekdays(body.thu_trong_tuan),
    so_gio_ngay_cong_chuan: toNumber(body.so_gio_ngay_cong_chuan, 8),
    so_gio_nua_cong: toNumber(body.so_gio_nua_cong, 4),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

function validateWorkDaysPayload(payload) {
  if (!payload.thu_trong_tuan.length) return 'Chọn ít nhất một ngày làm việc trong tuần';
  return null;
}

function normalizeHolidayPayload(body) {
  body = body || {};
  var tuNgay = parseVNDateOnly(body.tu_ngay);
  var denNgay = parseVNDateOnly(body.den_ngay);
  var soNgay = toNumber(body.so_ngay, 0);
  if (!soNgay && tuNgay && denNgay) soNgay = calcDayCount(tuNgay, denNgay);
  if (!soNgay) soNgay = 1;
  return {
    ten_ngay_le: String(body.ten_ngay_le || '').trim(),
    tu_ngay: tuNgay,
    den_ngay: denNgay,
    so_ngay: soNgay,
    he_so_luong: toNumber(body.he_so_luong, 300),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

function validateHolidayPayload(payload) {
  if (!payload.ten_ngay_le) return 'Tên ngày lễ là bắt buộc';
  if (!payload.tu_ngay) return 'Từ ngày không hợp lệ';
  if (!payload.den_ngay) return 'Đến ngày không hợp lệ';
  if (startOfDay(payload.den_ngay) < startOfDay(payload.tu_ngay)) {
    return 'Đến ngày không được nhỏ hơn từ ngày';
  }
  if (payload.so_ngay < 1) return 'Số ngày phải lớn hơn 0';
  return null;
}

function buildHolidayListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ten_ngay_le: regex }, { ghi_chu: regex }];
  }
  var trangThai = String(query.trang_thai || '').trim();
  if (trangThai === 'active' || trangThai === 'inactive') filter.trang_thai = trangThai;
  return filter;
}

function formatDateInput(date) {
  return formatDateInputVN(date);
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    res.render('ngay-lam-nghi/index', {
      title: 'Ngày làm & Nghỉ',
      activeMenu: 'nhan-vien',
      activeHrPage: 'ngay-lam-nghi',
      user: req.user,
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.apiGetWorkDays = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var doc = await NgayLamViecCuaHang.findOne({ cua_hang_id: storeId }).lean();
    if (!doc) {
      return res.json({
        success: true,
        item: defaultWorkDaysConfig(),
        isDefault: true
      });
    }
    return res.json({ success: true, item: doc, isDefault: false });
  } catch (error) {
    next(error);
  }
};

exports.apiUpsertWorkDays = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizeWorkDaysPayload(req.body);
    var validationError = validateWorkDaysPayload(payload);
    if (validationError) return jsonError(res, 400, validationError);
    var doc = await NgayLamViecCuaHang.findOneAndUpdate(
      { cua_hang_id: storeId },
      {
        $set: {
          thu_trong_tuan: payload.thu_trong_tuan,
          so_gio_ngay_cong_chuan: payload.so_gio_ngay_cong_chuan,
          so_gio_nua_cong: payload.so_gio_nua_cong,
          ghi_chu: payload.ghi_chu || undefined,
          trang_thai: payload.trang_thai
        },
        $setOnInsert: { cua_hang_id: storeId }
      },
      { new: true, upsert: true, runValidators: true }
    );
    return res.json({ success: true, item: doc });
  } catch (error) {
    next(error);
  }
};

exports.apiListHolidays = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var items = await NgayLeTet.find(buildHolidayListQuery(storeId, req.query))
      .sort({ tu_ngay: -1, ten_ngay_le: 1 })
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiCreateHoliday = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizeHolidayPayload(req.body);
    var validationError = validateHolidayPayload(payload);
    if (validationError) return jsonError(res, 400, validationError);
    var doc = await NgayLeTet.create({
      cua_hang_id: storeId,
      ten_ngay_le: payload.ten_ngay_le,
      tu_ngay: payload.tu_ngay,
      den_ngay: payload.den_ngay,
      so_ngay: payload.so_ngay,
      he_so_luong: payload.he_so_luong,
      ghi_chu: payload.ghi_chu || undefined,
      trang_thai: payload.trang_thai
    });
    return res.json({ success: true, item: doc });
  } catch (error) {
    next(error);
  }
};

exports.apiUpdateHoliday = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã ngày lễ không hợp lệ');
    var payload = normalizeHolidayPayload(req.body);
    var validationError = validateHolidayPayload(payload);
    if (validationError) return jsonError(res, 400, validationError);
    var doc = await NgayLeTet.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      {
        $set: {
          ten_ngay_le: payload.ten_ngay_le,
          tu_ngay: payload.tu_ngay,
          den_ngay: payload.den_ngay,
          so_ngay: payload.so_ngay,
          he_so_luong: payload.he_so_luong,
          ghi_chu: payload.ghi_chu || undefined,
          trang_thai: payload.trang_thai
        }
      },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy ngày lễ');
    return res.json({ success: true, item: doc });
  } catch (error) {
    next(error);
  }
};

exports.apiDeleteHoliday = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã ngày lễ không hợp lệ');
    var doc = await NgayLeTet.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy ngày lễ');
    doc.trang_thai = 'inactive';
    await doc.save();
    return res.json({
      success: true,
      softDeleted: true,
      message: 'Đã chuyển ngày lễ sang ngừng hoạt động'
    });
  } catch (error) {
    next(error);
  }
};

exports.formatDateInput = formatDateInput;
