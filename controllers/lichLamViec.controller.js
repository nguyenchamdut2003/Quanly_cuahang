var mongoose = require('mongoose');
var {
  LichLamViec,
  NhanVien,
  CaLamViec,
  PhongBan
} = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var {
  normalizeWorkDate,
  getLoaiNgayLamViec,
  loaiNgayLabel
} = require('../utils/hrWorkDay');

var DUPLICATE_MSG = 'Nhân viên đã được xếp ca này trong ngày đã chọn';
var SCHEDULE_STATUSES = ['scheduled', 'cancelled', 'completed'];

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function pickObjectId(value) {
  value = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
}

function isDuplicateKeyError(error) {
  return error && error.code === 11000;
}

function buildEmployeeSnapshot(employee) {
  if (!employee) return {};
  return {
    ma_nhan_vien: employee.ma_nhan_vien || undefined,
    ten_nhan_vien: employee.ten_nhan_vien || undefined,
    phong_ban_id: employee.phong_ban_id || undefined,
    chuc_danh_id: employee.chuc_danh_id || undefined
  };
}

function buildShiftSnapshot(shift) {
  if (!shift) return {};
  return {
    ma_ca: shift.ma_ca || undefined,
    ten_ca: shift.ten_ca || undefined,
    gio_bat_dau: shift.gio_bat_dau || undefined,
    gio_ket_thuc: shift.gio_ket_thuc || undefined,
    nghi_giua_ca_phut: Number(shift.nghi_giua_ca_phut || 0)
  };
}

async function loadEmployee(storeId, nhanVienId) {
  return NhanVien.findOne({
    _id: nhanVienId,
    cua_hang_id: storeId,
    trang_thai: 'dang_lam_viec'
  }).lean();
}

async function loadShift(storeId, caId) {
  return CaLamViec.findOne({
    _id: caId,
    cua_hang_id: storeId,
    trang_thai: 'active'
  }).lean();
}

async function assertNoDuplicateSchedule(storeId, nhanVienId, ngay, caId, excludeId) {
  var filter = {
    cua_hang_id: storeId,
    nhan_vien_id: nhanVienId,
    ngay_lam_viec: ngay,
    ca_lam_viec_id: caId,
    trang_thai: 'scheduled'
  };
  if (excludeId) filter._id = { $ne: excludeId };
  var exists = await LichLamViec.findOne(filter).select('_id').lean();
  return exists ? DUPLICATE_MSG : null;
}

async function buildSchedulePayload(storeId, body, options) {
  options = options || {};
  body = body || {};

  var nhanVienId = pickObjectId(body.nhan_vien_id);
  var caId = pickObjectId(body.ca_lam_viec_id);
  var ngay = normalizeWorkDate(body.ngay_lam_viec);

  if (!nhanVienId) return { error: 'Nhân viên không hợp lệ' };
  if (!caId) return { error: 'Ca làm việc không hợp lệ' };
  if (!ngay) return { error: 'Ngày làm việc không hợp lệ' };

  var employee = await loadEmployee(storeId, nhanVienId);
  if (!employee) return { error: 'Nhân viên không tồn tại hoặc không còn đang làm việc' };

  var shift = await loadShift(storeId, caId);
  if (!shift) return { error: 'Ca làm việc không tồn tại hoặc không còn hoạt động' };

  var trangThai = String(body.trang_thai || 'scheduled').trim();
  if (SCHEDULE_STATUSES.indexOf(trangThai) < 0) trangThai = 'scheduled';

  if (trangThai === 'scheduled') {
    var dupError = await assertNoDuplicateSchedule(
      storeId,
      nhanVienId,
      ngay,
      caId,
      options.excludeId
    );
    if (dupError) return { error: dupError };
  }

  var loaiNgay = await getLoaiNgayLamViec(storeId, ngay);
  var payload = {
    nhan_vien_id: nhanVienId,
    ca_lam_viec_id: caId,
    ngay_lam_viec: ngay,
    loai_ngay: loaiNgay.loai_ngay,
    ten_ngay_le: loaiNgay.ten_ngay_le || undefined,
    he_so_luong_ngay: loaiNgay.he_so_luong_ngay,
    trang_thai: trangThai,
    ghi_chu: String(body.ghi_chu || '').trim() || undefined
  };

  Object.assign(payload, buildEmployeeSnapshot(employee));
  Object.assign(payload, buildShiftSnapshot(shift));

  return { payload: payload };
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var tuNgay = normalizeWorkDate(query.tu_ngay);
  var denNgay = normalizeWorkDate(query.den_ngay);

  if (tuNgay || denNgay) {
    filter.ngay_lam_viec = {};
    if (tuNgay) filter.ngay_lam_viec.$gte = tuNgay;
    if (denNgay) filter.ngay_lam_viec.$lte = denNgay;
  }

  var nhanVienId = pickObjectId(query.nhan_vien_id);
  if (nhanVienId) filter.nhan_vien_id = nhanVienId;

  var phongBanId = pickObjectId(query.phong_ban_id);
  if (phongBanId) filter.phong_ban_id = phongBanId;

  var caId = pickObjectId(query.ca_lam_viec_id);
  if (caId) filter.ca_lam_viec_id = caId;

  var trangThai = String(query.trang_thai || '').trim();
  if (trangThai === 'all') {
    // no status filter
  } else if (SCHEDULE_STATUSES.indexOf(trangThai) >= 0) {
    filter.trang_thai = trangThai;
  } else {
    filter.trang_thai = { $in: ['scheduled', 'completed'] };
  }

  return filter;
}

function defaultDateRange() {
  var now = new Date();
  var tu = new Date(now.getFullYear(), now.getMonth(), 1);
  var den = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  tu.setHours(0, 0, 0, 0);
  den.setHours(0, 0, 0, 0);
  return { tu_ngay: tu, den_ngay: den };
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var range = defaultDateRange();
    res.render('lich-lam-viec/index', {
      title: 'Lịch làm việc',
      activeMenu: 'nhan-vien',
      activeHrPage: 'lich-lam-viec',
      user: req.user,
      filterDefaults: {
        tu_ngay: range.tu_ngay.toISOString().slice(0, 10),
        den_ngay: range.den_ngay.toISOString().slice(0, 10)
      },
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.apiPreviewLoaiNgay = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var ngay = normalizeWorkDate(req.query.ngay_lam_viec);
    if (!ngay) return jsonError(res, 400, 'Ngày làm việc không hợp lệ');
    var loai = await getLoaiNgayLamViec(storeId, ngay);
    return res.json({
      success: true,
      item: Object.assign({}, loai, { loai_ngay_label: loaiNgayLabel(loai.loai_ngay) })
    });
  } catch (error) {
    next(error);
  }
};

exports.apiList = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var items = await LichLamViec.find(buildListQuery(storeId, req.query))
      .populate('phong_ban_id', 'ten_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh')
      .sort({ ngay_lam_viec: -1, gio_bat_dau: 1, ten_nhan_vien: 1 })
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
    var built = await buildSchedulePayload(storeId, req.body);
    if (built.error) return jsonError(res, 400, built.error);

    var doc = await LichLamViec.create(Object.assign({
      cua_hang_id: storeId,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      trang_thai: 'scheduled'
    }, built.payload));
    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, DUPLICATE_MSG);
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã lịch không hợp lệ');

    var existing = await LichLamViec.findOne({ _id: id, cua_hang_id: storeId });
    if (!existing) return jsonError(res, 404, 'Không tìm thấy lịch làm việc');

    var body = req.body || {};
    var merged = {
      nhan_vien_id: pickObjectId(body.nhan_vien_id) || String(existing.nhan_vien_id),
      ca_lam_viec_id: pickObjectId(body.ca_lam_viec_id) || String(existing.ca_lam_viec_id),
      ngay_lam_viec: body.ngay_lam_viec != null && body.ngay_lam_viec !== ''
        ? body.ngay_lam_viec
        : existing.ngay_lam_viec,
      ghi_chu: Object.prototype.hasOwnProperty.call(body, 'ghi_chu')
        ? body.ghi_chu
        : existing.ghi_chu,
      trang_thai: Object.prototype.hasOwnProperty.call(body, 'trang_thai')
        ? body.trang_thai
        : existing.trang_thai
    };

    var built = await buildSchedulePayload(storeId, merged, { excludeId: id });
    if (built.error) return jsonError(res, 400, built.error);

    existing.nhan_vien_id = built.payload.nhan_vien_id;
    existing.ca_lam_viec_id = built.payload.ca_lam_viec_id;
    existing.ngay_lam_viec = built.payload.ngay_lam_viec;
    existing.ma_ca = built.payload.ma_ca;
    existing.ten_ca = built.payload.ten_ca;
    existing.gio_bat_dau = built.payload.gio_bat_dau;
    existing.gio_ket_thuc = built.payload.gio_ket_thuc;
    existing.nghi_giua_ca_phut = built.payload.nghi_giua_ca_phut;
    existing.ma_nhan_vien = built.payload.ma_nhan_vien;
    existing.ten_nhan_vien = built.payload.ten_nhan_vien;
    existing.phong_ban_id = built.payload.phong_ban_id;
    existing.chuc_danh_id = built.payload.chuc_danh_id;
    existing.loai_ngay = built.payload.loai_ngay;
    existing.ten_ngay_le = built.payload.ten_ngay_le;
    existing.he_so_luong_ngay = built.payload.he_so_luong_ngay;
    existing.trang_thai = built.payload.trang_thai;
    existing.ghi_chu = built.payload.ghi_chu;

    await existing.save();
    return res.json({ success: true, item: existing });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, DUPLICATE_MSG);
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã lịch không hợp lệ');

    var doc = await LichLamViec.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy lịch làm việc');

    doc.trang_thai = 'cancelled';
    await doc.save();
    return res.json({
      success: true,
      softDeleted: true,
      message: 'Đã hủy lịch làm việc'
    });
  } catch (error) {
    next(error);
  }
};

exports.apiLookupOptions = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');

    var [employees, shifts, departments] = await Promise.all([
      NhanVien.find({ cua_hang_id: storeId, trang_thai: 'dang_lam_viec' })
        .select('ma_nhan_vien ten_nhan_vien phong_ban_id chuc_danh_id')
        .populate('phong_ban_id', 'ten_phong_ban')
        .populate('chuc_danh_id', 'ten_chuc_danh')
        .sort({ ten_nhan_vien: 1 })
        .lean(),
      CaLamViec.find({ cua_hang_id: storeId, trang_thai: 'active' })
        .select('ma_ca ten_ca gio_bat_dau gio_ket_thuc nghi_giua_ca_phut')
        .sort({ gio_bat_dau: 1, ten_ca: 1 })
        .lean(),
      PhongBan.find({ cua_hang_id: storeId, trang_thai: 'active' })
        .select('ten_phong_ban')
        .sort({ ten_phong_ban: 1 })
        .lean()
    ]);

    return res.json({
      success: true,
      employees: employees,
      shifts: shifts,
      departments: departments
    });
  } catch (error) {
    next(error);
  }
};

exports.loaiNgayLabel = loaiNgayLabel;
