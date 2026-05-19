var mongoose = require('mongoose');
var { NhanVien, PhongBan, ChucDanh } = require('../models/hr.model');
var { NguoiDung } = require('../models/kiot.model');
var { resolveStoreId, parseDateInput } = require('../utils/storeScope');
var { makeNhanVienCode } = require('../utils/hrCode');
var { normalizeAddress } = require('../utils/address');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function normalizePayload(body) {
  body = body || {};
  var gioiTinh = String(body.gioi_tinh || '').trim();
  if (['nam', 'nu', 'khac'].indexOf(gioiTinh) < 0) gioiTinh = undefined;
  var phongBanId = String(body.phong_ban_id || '').trim();
  var chucDanhId = String(body.chuc_danh_id || '').trim();
  var nguoiDungId = String(body.nguoi_dung_id || '').trim();
  var address = normalizeAddress(body);
  return {
    ma_nhan_vien: String(body.ma_nhan_vien || '').trim(),
    ma_cham_cong: String(body.ma_cham_cong || '').trim(),
    ten_nhan_vien: String(body.ten_nhan_vien || '').trim(),
    anh_dai_dien: String(body.anh_dai_dien || '').trim(),
    sdt: String(body.sdt || '').trim(),
    email: String(body.email || '').trim(),
    cccd: String(body.cccd || '').trim(),
    ngay_sinh: parseDateInput(body.ngay_sinh),
    gioi_tinh: gioiTinh,
    phong_ban_id: mongoose.Types.ObjectId.isValid(phongBanId) ? phongBanId : undefined,
    chuc_danh_id: mongoose.Types.ObjectId.isValid(chucDanhId) ? chucDanhId : undefined,
    nguoi_dung_id: mongoose.Types.ObjectId.isValid(nguoiDungId) ? nguoiDungId : undefined,
    ngay_bat_dau_lam_viec: parseDateInput(body.ngay_bat_dau_lam_viec),
    tinh_thanh: address.tinh_thanh,
    phuong_xa: address.phuong_xa,
    dia_chi_chi_tiet: address.dia_chi_chi_tiet,
    dia_chi_day_du: address.dia_chi_day_du,
    facebook: String(body.facebook || '').trim(),
    no_va_tam_ung: Math.floor(Number(body.no_va_tam_ung || 0)),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: body.trang_thai === 'da_nghi' ? 'da_nghi' : 'dang_lam_viec'
  };
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var keyword = String(query.keyword || '').trim();
  if (keyword) {
    var regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { ma_nhan_vien: regex },
      { ma_cham_cong: regex },
      { ten_nhan_vien: regex },
      { sdt: regex },
      { cccd: regex },
      { email: regex }
    ];
  }
  var phongBanId = String(query.phong_ban_id || '').trim();
  if (mongoose.Types.ObjectId.isValid(phongBanId)) filter.phong_ban_id = phongBanId;
  var statuses = query.trang_thai;
  if (Array.isArray(statuses) && statuses.length) {
    filter.trang_thai = { $in: statuses };
  } else if (statuses === 'dang_lam_viec' || statuses === 'da_nghi') {
    filter.trang_thai = statuses;
  }
  return filter;
}

async function loadReferenceData(storeId) {
  var [phongBans, chucDanhs, nguoiDungs] = await Promise.all([
    PhongBan.find({ cua_hang_id: storeId, trang_thai: 'active' }).sort({ ten_phong_ban: 1 }).lean(),
    ChucDanh.find({ cua_hang_id: storeId, trang_thai: 'active' }).sort({ ten_chuc_danh: 1 }).lean(),
    NguoiDung.find({ cua_hang_id: storeId, trang_thai: 'active' }).select('ho_ten email anh_dai_dien').sort({ ho_ten: 1 }).lean()
  ]);
  return { phongBans, chucDanhs, nguoiDungs };
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var statuses = req.query.trang_thai;
    if (!statuses) statuses = ['dang_lam_viec'];
    if (typeof statuses === 'string') statuses = [statuses];
    var query = Object.assign({}, req.query, { trang_thai: statuses });
    var employees = await NhanVien.find(buildListQuery(storeId, query))
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .sort({ created_at: -1 })
      .lean();
    var refs = await loadReferenceData(storeId);
    res.render('nhan-vien/index', {
      title: 'Danh sách nhân viên',
      activeMenu: 'nhan-vien',
      user: req.user,
      employees: employees,
      phongBans: refs.phongBans,
      chucDanhs: refs.chucDanhs,
      nguoiDungs: refs.nguoiDungs,
      filter: {
        keyword: String(req.query.keyword || ''),
        phong_ban_id: String(req.query.phong_ban_id || ''),
        trang_thai: statuses
      },
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.chucDanhPlaceholder = function(req, res) {
  res.render('nhan-vien/chuc-danh-placeholder', {
    title: 'Chức danh',
    activeMenu: 'nhan-vien',
    user: req.user,
    flash: req.query || {}
  });
};

exports.apiList = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var items = await NhanVien.find(buildListQuery(storeId, req.query))
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .sort({ created_at: -1 })
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiGet = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var item = await NhanVien.findOne({ _id: id, cua_hang_id: storeId })
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .populate('nguoi_dung_id', 'ho_ten email')
      .lean();
    if (!item) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: item });
  } catch (error) {
    next(error);
  }
};

exports.apiCreate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = normalizePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    if (!payload.ma_nhan_vien) payload.ma_nhan_vien = await makeNhanVienCode(storeId);
    var doc = await NhanVien.create(Object.assign({ cua_hang_id: storeId }, payload));
    var item = await NhanVien.findById(doc._id)
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var payload = normalizePayload(req.body);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    var update = Object.assign({}, payload);
    if (payload.trang_thai === 'da_nghi' && !update.ngay_nghi_viec) {
      update.ngay_nghi_viec = new Date();
    }
    if (payload.trang_thai === 'dang_lam_viec') {
      update.ngay_nghi_viec = null;
    }
    var doc = await NhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: update },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    var item = await NhanVien.findById(doc._id)
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    if (error && error.code === 11000) return jsonError(res, 400, 'Mã nhân viên đã tồn tại');
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã nhân viên không hợp lệ');
    var doc = await NhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { trang_thai: 'da_nghi', ngay_nghi_viec: new Date() } },
      { new: true }
    );
    if (!doc) return jsonError(res, 404, 'Không tìm thấy nhân viên');
    return res.json({ success: true, item: doc, message: 'Đã chuyển nhân viên sang trạng thái đã nghỉ' });
  } catch (error) {
    next(error);
  }
};
