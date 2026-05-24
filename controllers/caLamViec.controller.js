var mongoose = require('mongoose');
var { CaLamViec } = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var { makeCaLamViecCode } = require('../utils/hrCode');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function isDuplicateKeyError(error) {
  return error && error.code === 11000;
}

function toNumber(value, fallback) {
  var num = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return fallback || 0;
  return Math.max(0, Math.floor(num));
}

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeTime(value) {
  var raw = String(value || '').trim();
  var match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  var hour = Number(match[1]);
  var minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function normalizePayload(body) {
  body = body || {};
  return {
    ma_ca: String(body.ma_ca || '').trim(),
    ten_ca: String(body.ten_ca || '').trim(),
    gio_bat_dau: normalizeTime(body.gio_bat_dau),
    gio_ket_thuc: normalizeTime(body.gio_ket_thuc),
    nghi_giua_ca_phut: toNumber(body.nghi_giua_ca_phut, 0),
    cho_phep_di_muon_phut: toNumber(body.cho_phep_di_muon_phut, 0),
    cho_phep_ve_som_phut: toNumber(body.cho_phep_ve_som_phut, 0),
    tinh_lam_them_truoc_ca: toBool(body.tinh_lam_them_truoc_ca),
    tinh_lam_them_sau_ca: body.tinh_lam_them_sau_ca === undefined || body.tinh_lam_them_sau_ca === null || body.tinh_lam_them_sau_ca === ''
      ? true
      : toBool(body.tinh_lam_them_sau_ca),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

function validatePayload(payload) {
  if (!payload.ten_ca) return 'Tên ca là bắt buộc';
  if (!payload.gio_bat_dau) return 'Giờ bắt đầu không hợp lệ (định dạng HH:mm)';
  if (!payload.gio_ket_thuc) return 'Giờ kết thúc không hợp lệ (định dạng HH:mm)';
  return null;
}

async function createCaLamViec(storeId, payload, options) {
  options = options || {};
  var autoCode = !payload.ma_ca;
  var lastError = null;
  var attempts = autoCode ? 5 : 1;

  for (var i = 0; i < attempts; i += 1) {
    var code = autoCode ? await makeCaLamViecCode(storeId) : payload.ma_ca;
    try {
      return await CaLamViec.create({
        cua_hang_id: storeId,
        ma_ca: code,
        ten_ca: payload.ten_ca,
        gio_bat_dau: payload.gio_bat_dau,
        gio_ket_thuc: payload.gio_ket_thuc,
        nghi_giua_ca_phut: payload.nghi_giua_ca_phut,
        cho_phep_di_muon_phut: payload.cho_phep_di_muon_phut,
        cho_phep_ve_som_phut: payload.cho_phep_ve_som_phut,
        tinh_lam_them_truoc_ca: payload.tinh_lam_them_truoc_ca,
        tinh_lam_them_sau_ca: payload.tinh_lam_them_sau_ca,
        ghi_chu: payload.ghi_chu || undefined,
        trang_thai: options.forceActive ? 'active' : payload.trang_thai
      });
    } catch (error) {
      if (!autoCode || !isDuplicateKeyError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ma_ca: regex }, { ten_ca: regex }, { ghi_chu: regex }];
  }
  var trangThai = String(query.trang_thai || '').trim();
  if (trangThai === 'active' || trangThai === 'inactive') filter.trang_thai = trangThai;
  return filter;
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var filter = buildListQuery(storeId, req.query);
    var items = await CaLamViec.find(filter)
      .sort({ gio_bat_dau: 1, ten_ca: 1 })
      .lean();
    res.render('ca-lam-viec/index', {
      title: 'Ca làm việc',
      activeMenu: 'nhan-vien',
      activeHrPage: 'ca-lam-viec',
      user: req.user,
      caLamViecs: items,
      filter: {
        keyword: String(req.query.keyword || ''),
        trang_thai: String(req.query.trang_thai || '')
      },
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
    var items = await CaLamViec.find(buildListQuery(storeId, req.query))
      .sort({ gio_bat_dau: 1, ten_ca: 1 })
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiCreate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizePayload(req.body);
    var validationError = validatePayload(payload);
    if (validationError) return jsonError(res, 400, validationError);
    var doc = await createCaLamViec(storeId, payload);
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, 'Mã ca đã tồn tại');
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã ca không hợp lệ');
    var payload = normalizePayload(req.body);
    var validationError = validatePayload(payload);
    if (validationError) return jsonError(res, 400, validationError);
    var update = {
      ten_ca: payload.ten_ca,
      gio_bat_dau: payload.gio_bat_dau,
      gio_ket_thuc: payload.gio_ket_thuc,
      nghi_giua_ca_phut: payload.nghi_giua_ca_phut,
      cho_phep_di_muon_phut: payload.cho_phep_di_muon_phut,
      cho_phep_ve_som_phut: payload.cho_phep_ve_som_phut,
      tinh_lam_them_truoc_ca: payload.tinh_lam_them_truoc_ca,
      tinh_lam_them_sau_ca: payload.tinh_lam_them_sau_ca,
      ghi_chu: payload.ghi_chu || undefined,
      trang_thai: payload.trang_thai
    };
    if (payload.ma_ca) update.ma_ca = payload.ma_ca;
    var doc = await CaLamViec.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: update },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy ca làm việc');
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, 'Mã ca đã tồn tại');
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã ca không hợp lệ');
    var doc = await CaLamViec.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy ca làm việc');
    doc.trang_thai = 'inactive';
    await doc.save();
    return res.json({
      success: true,
      softDeleted: true,
      message: 'Đã chuyển ca làm việc sang ngừng hoạt động'
    });
  } catch (error) {
    next(error);
  }
};
