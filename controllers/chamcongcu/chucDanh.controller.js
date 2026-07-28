var mongoose = require('mongoose');
var { ChucDanh, NhanVien } = require('../../models/hr.model');
var { resolveStoreId } = require('../../utils/storeScope');
var { makeChucDanhCode } = require('../../utils/hrCode');

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

function isDuplicateKeyError(error) {
  return error && error.code === 11000;
}

async function createChucDanh(storeId, payload, options) {
  options = options || {};
  var autoCode = !payload.ma_chuc_danh;
  var lastError = null;
  var attempts = autoCode ? 5 : 1;

  for (var i = 0; i < attempts; i += 1) {
    var code = autoCode ? await makeChucDanhCode(storeId) : payload.ma_chuc_danh;
    try {
      return await ChucDanh.create({
        cua_hang_id: storeId,
        ma_chuc_danh: code,
        ten_chuc_danh: payload.ten_chuc_danh,
        mo_ta: payload.mo_ta || undefined,
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
    filter.$or = [{ ma_chuc_danh: regex }, { ten_chuc_danh: regex }, { mo_ta: regex }];
  }
  var trangThai = String(query.trang_thai || '').trim();
  if (trangThai === 'active' || trangThai === 'inactive') filter.trang_thai = trangThai;
  return filter;
}

async function loadActiveChucDanhs(storeId) {
  return ChucDanh.find({ cua_hang_id: storeId, trang_thai: 'active' })
    .sort({ ten_chuc_danh: 1 })
    .lean();
}

function ajaxJson(res, payload) {
  return res.json(Object.assign({ success: true }, payload));
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var filter = buildListQuery(storeId, req.query);
    var items = await ChucDanh.find(filter).sort({ ten_chuc_danh: 1 }).lean();
    res.render('chuc-danh/index', {
      title: 'Chức danh',
      activeMenu: 'nhan-vien',
      user: req.user,
      chucDanhs: items,
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
    var items = await ChucDanh.find(buildListQuery(storeId, req.query))
      .sort({ ten_chuc_danh: 1 })
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
    if (!payload.ten_chuc_danh) return jsonError(res, 400, 'Tên chức danh là bắt buộc');
    var doc = await createChucDanh(storeId, payload);
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, 'Mã chức danh đã tồn tại');
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chức danh không hợp lệ');
    var payload = normalizePayload(req.body);
    if (!payload.ten_chuc_danh) return jsonError(res, 400, 'Tên chức danh là bắt buộc');
    var doc = await ChucDanh.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      {
        $set: {
          ten_chuc_danh: payload.ten_chuc_danh,
          mo_ta: payload.mo_ta || undefined,
          trang_thai: payload.trang_thai,
          ...(payload.ma_chuc_danh ? { ma_chuc_danh: payload.ma_chuc_danh } : {})
        }
      },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chức danh');
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, 'Mã chức danh đã tồn tại');
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
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
    doc.trang_thai = 'inactive';
    await doc.save();
    var message = employeeCount > 0
      ? 'Chức danh đang có nhân viên đang làm việc — đã chuyển sang ngừng hoạt động.'
      : 'Đã ngừng hoạt động chức danh.';
    return res.json({ success: true, softDeleted: true, message: message });
  } catch (error) {
    next(error);
  }
};

exports.ajaxAdd = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizePayload(req.body);
    if (!payload.ten_chuc_danh) return jsonError(res, 400, 'Tên chức danh là bắt buộc');
    var doc = await createChucDanh(storeId, payload);
    return ajaxJson(res, {
      message: 'Đã thêm chức danh.',
      data: doc,
      selectedId: String(doc._id),
      items: await loadActiveChucDanhs(storeId)
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, 'Mã chức danh đã tồn tại');
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
      {
        $set: {
          ten_chuc_danh: payload.ten_chuc_danh,
          mo_ta: payload.mo_ta || undefined,
          trang_thai: payload.trang_thai
        }
      },
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
