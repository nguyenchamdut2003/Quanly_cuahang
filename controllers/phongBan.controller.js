var mongoose = require('mongoose');
var { PhongBan, NhanVien } = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var { makePhongBanCode } = require('../utils/hrCode');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function normalizePayload(body) {
  body = body || {};
  return {
    ma_phong_ban: String(body.ma_phong_ban || '').trim(),
    ten_phong_ban: String(body.ten_phong_ban || '').trim(),
    mo_ta: String(body.mo_ta || '').trim(),
    trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ma_phong_ban: regex }, { ten_phong_ban: regex }, { mo_ta: regex }];
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
    var items = await PhongBan.find(filter).sort({ ten_phong_ban: 1 }).lean();
    res.render('phong-ban/index', {
      title: 'Phòng ban',
      activeMenu: 'nhan-vien',
      user: req.user,
      phongBans: items,
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
    var items = await PhongBan.find(buildListQuery(storeId, req.query))
      .sort({ ten_phong_ban: 1 })
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
    if (!payload.ten_phong_ban) return jsonError(res, 400, 'Tên phòng ban là bắt buộc');
    if (!payload.ma_phong_ban) payload.ma_phong_ban = await makePhongBanCode(storeId);
    var doc = await PhongBan.create({
      cua_hang_id: storeId,
      ma_phong_ban: payload.ma_phong_ban,
      ten_phong_ban: payload.ten_phong_ban,
      mo_ta: payload.mo_ta || undefined,
      trang_thai: payload.trang_thai
    });
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã phòng ban đã tồn tại');
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã phòng ban không hợp lệ');
    var payload = normalizePayload(req.body);
    if (!payload.ten_phong_ban) return jsonError(res, 400, 'Tên phòng ban là bắt buộc');
    var doc = await PhongBan.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      {
        $set: {
          ten_phong_ban: payload.ten_phong_ban,
          mo_ta: payload.mo_ta || undefined,
          trang_thai: payload.trang_thai,
          ...(payload.ma_phong_ban ? { ma_phong_ban: payload.ma_phong_ban } : {})
        }
      },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy phòng ban');
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã phòng ban đã tồn tại');
    next(error);
  }
};

async function loadActivePhongBans(storeId) {
  return PhongBan.find({ cua_hang_id: storeId, trang_thai: 'active' })
    .sort({ ten_phong_ban: 1 })
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
    if (!payload.ten_phong_ban) return jsonError(res, 400, 'Tên phòng ban là bắt buộc');
    if (!payload.ma_phong_ban) payload.ma_phong_ban = await makePhongBanCode(storeId);
    var doc = await PhongBan.create({
      cua_hang_id: storeId,
      ma_phong_ban: payload.ma_phong_ban,
      ten_phong_ban: payload.ten_phong_ban,
      mo_ta: payload.mo_ta || undefined,
      trang_thai: 'active'
    });
    return ajaxJson(res, {
      message: 'Đã thêm phòng ban.',
      data: doc,
      selectedId: String(doc._id),
      items: await loadActivePhongBans(storeId)
    });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã phòng ban đã tồn tại');
    next(error);
  }
};

exports.ajaxUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã phòng ban không hợp lệ');
    var payload = normalizePayload(req.body);
    if (!payload.ten_phong_ban) return jsonError(res, 400, 'Tên phòng ban là bắt buộc');
    var doc = await PhongBan.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { ten_phong_ban: payload.ten_phong_ban, mo_ta: payload.mo_ta || undefined } },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy phòng ban');
    return ajaxJson(res, {
      message: 'Đã cập nhật phòng ban.',
      data: doc,
      selectedId: id,
      items: await loadActivePhongBans(storeId)
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
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã phòng ban không hợp lệ');
    var doc = await PhongBan.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy phòng ban');
    var employeeCount = await NhanVien.countDocuments({
      cua_hang_id: storeId,
      phong_ban_id: id,
      trang_thai: 'dang_lam_viec'
    });
    var message = 'Đã ngừng hoạt động phòng ban.';
    if (employeeCount > 0) message = 'Phòng ban đang có nhân viên — đã chuyển sang ngừng hoạt động.';
    doc.trang_thai = 'inactive';
    await doc.save();
    return ajaxJson(res, {
      message: message,
      items: await loadActivePhongBans(storeId)
    });
  } catch (error) {
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã phòng ban không hợp lệ');
    var doc = await PhongBan.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy phòng ban');
    var employeeCount = await NhanVien.countDocuments({
      cua_hang_id: storeId,
      phong_ban_id: id,
      trang_thai: 'dang_lam_viec'
    });
    if (employeeCount > 0) {
      doc.trang_thai = 'inactive';
      await doc.save();
      return res.json({
        success: true,
        softDeleted: true,
        message: 'Phòng ban đang có nhân viên — đã chuyển sang ngừng hoạt động'
      });
    }
    doc.trang_thai = 'inactive';
    await doc.save();
    return res.json({ success: true, softDeleted: true, message: 'Đã ngừng hoạt động phòng ban' });
  } catch (error) {
    next(error);
  }
};
