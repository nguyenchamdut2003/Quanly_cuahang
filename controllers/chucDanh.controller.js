var mongoose = require('mongoose');
var { ChucDanh, NhanVien } = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var { makeChucDanhCode } = require('../utils/hrCode');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function normalizePayload(body) {
  body = body || {};
  return {
    ma_chuc_danh: String(body.ma_chuc_danh || '').trim(),
    ten_chuc_danh: String(body.ten_chuc_danh || '').trim(),
    mo_ta: String(body.mo_ta || '').trim(),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

async function loadActiveChucDanhs(storeId) {
  return ChucDanh.find({ cua_hang_id: storeId, trang_thai: 'active' })
    .sort({ ten_chuc_danh: 1 })
    .lean();
}

function ajaxJson(res, payload) {
  return res.json(Object.assign({ success: true }, payload));
}

exports.ajaxAdd = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizePayload(req.body);
    if (!payload.ten_chuc_danh) return jsonError(res, 400, 'Tên chức danh là bắt buộc');
    if (!payload.ma_chuc_danh) payload.ma_chuc_danh = await makeChucDanhCode(storeId);
    var doc = await ChucDanh.create({
      cua_hang_id: storeId,
      ma_chuc_danh: payload.ma_chuc_danh,
      ten_chuc_danh: payload.ten_chuc_danh,
      mo_ta: payload.mo_ta || undefined,
      trang_thai: 'active'
    });
    return ajaxJson(res, {
      message: 'Đã thêm chức danh.',
      data: doc,
      selectedId: String(doc._id),
      items: await loadActiveChucDanhs(storeId)
    });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã chức danh đã tồn tại');
    next(error);
  }
};

exports.ajaxUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chức danh không hợp lệ');
    var payload = normalizePayload(req.body);
    if (!payload.ten_chuc_danh) return jsonError(res, 400, 'Tên chức danh là bắt buộc');
    var doc = await ChucDanh.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { ten_chuc_danh: payload.ten_chuc_danh, mo_ta: payload.mo_ta || undefined } },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chức danh');
    return ajaxJson(res, {
      message: 'Đã cập nhật chức danh.',
      data: doc,
      selectedId: id,
      items: await loadActiveChucDanhs(storeId)
    });
  } catch (error) {
    next(error);
  }
};

exports.ajaxDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chức danh không hợp lệ');
    var doc = await ChucDanh.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chức danh');
    var employeeCount = await NhanVien.countDocuments({
      cua_hang_id: storeId,
      chuc_danh_id: id,
      trang_thai: 'dang_lam_viec'
    });
    var message = 'Đã ngừng hoạt động chức danh.';
    if (employeeCount > 0) message = 'Chức danh đang có nhân viên — đã chuyển sang ngừng hoạt động.';
    doc.trang_thai = 'inactive';
    await doc.save();
    return ajaxJson(res, {
      message: message,
      items: await loadActiveChucDanhs(storeId)
    });
  } catch (error) {
    next(error);
  }
};
