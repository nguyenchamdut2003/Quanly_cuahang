var mongoose = require('mongoose');
var { NhanVien, PhongBan, ChucDanh, CaLamViec } = require('../../models/hr.model');
var { NguoiDung } = require('../../models/kiot.model');
var { resolveStoreId, parseDateInput } = require('../../utils/storeScope');
var { makeNhanVienCode } = require('../../utils/hrCode');
var { normalizeAddress } = require('../../utils/address');

function jsonError(res, status, message) {
  return res.status(status).json({ success: false, message: message });
}

function toNumber(value, fallback) {
  var num = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(num)) return fallback || 0;
  return Math.max(0, num);
}

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function pickEnum(value, allowed, fallback) {
  value = String(value || '').trim();
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

function pickObjectId(value) {
  value = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function salaryUnitLabel(type) {
  if (type === 'theo_gio') return '/giờ';
  if (type === 'theo_ngay') return '/kỳ lương';
  if (type === 'theo_thang') return '/tháng';
  return '/ca';
}

function salaryTypeLabel(type) {
  if (type === 'theo_gio') return 'Theo giờ làm việc';
  if (type === 'theo_ngay') return 'Theo ngày công chuẩn';
  if (type === 'theo_thang') return 'Cố định';
  return 'Theo ca làm việc';
}

function formatSalaryRate(value, unit, fallback) {
  var num = Number(value || 0);
  if (!num && fallback != null) num = Number(fallback || 0);
  if (unit === 'vnd') return formatMoney(num);
  return formatMoney(num) + ' %';
}

function enabledText(section, text) {
  return section && section.enabled ? text : 'Không áp dụng';
}

function buildSalarySummary(employee) {
  employee = employee || {};
  var salary = employee.salary_setup || {};
  var type = salary.loai_luong || 'theo_ca';
  var advanced = salary.muc_luong_nang_cao || {};
  var rows = [];
  var conditions = Array.isArray(advanced.dieu_kien) ? advanced.dieu_kien : [];
  var showRows = salary.enabled || salary.muc_luong || salary.nang_cao;
  if (showRows && toNumber(salary.muc_luong, 0) > 0) {
    rows.push({
      muc_luong: 'Mặc định: ' + formatMoney(salary.muc_luong || 0) + salaryUnitLabel(type),
      thu_7: formatSalaryRate(advanced.thu_7, advanced.thu_7_kieu, 100),
      ngay_nghi: formatSalaryRate(advanced.ngay_nghi, advanced.ngay_nghi_kieu, 100),
      ngay_le_tet: formatSalaryRate(advanced.ngay_le_tet, advanced.ngay_le_tet_kieu, 100)
    });
  }
  if (salary.nang_cao && conditions.length) {
    conditions.forEach(function(row) {
      rows.push({
        muc_luong: (row.ten_dieu_kien || row.ten_ca || 'Ca') + ': ' + formatMoney(row.muc_luong || row.ngay_thuong || 0) + salaryUnitLabel(type),
        thu_7: formatSalaryRate(row.thu_7, row.thu_7_kieu, 100),
        ngay_nghi: formatSalaryRate(row.ngay_nghi, row.ngay_nghi_kieu, 100),
        ngay_le_tet: formatSalaryRate(row.ngay_le_tet, row.ngay_le_tet_kieu, 100)
      });
    });
  }
  return {
    mau_ap_dung: salary.mau_luong_id ? String(salary.mau_luong_id) : 'Không áp dụng',
    loai_luong: salaryTypeLabel(type),
    muc_luong_rows: salary.enabled || salary.muc_luong || salary.nang_cao ? rows : [],
    thuong: enabledText(salary.thuong, salary.thuong && salary.thuong.rules && salary.thuong.rules.length ? (salary.thuong.rules.length + ' mức thưởng') : 'Đã áp dụng'),
    hoa_hong: enabledText(salary.hoa_hong, salary.hoa_hong && salary.hoa_hong.rules && salary.hoa_hong.rules.length ? (salary.hoa_hong.rules.length + ' mức hoa hồng') : 'Đã áp dụng'),
    luong_lam_them_gio: enabledText(salary.lam_them_gio, 'Đã áp dụng'),
    phu_cap: enabledText(salary.phu_cap, salary.phu_cap && salary.phu_cap.items && salary.phu_cap.items.length ? (salary.phu_cap.items.length + ' khoản phụ cấp') : 'Đã áp dụng'),
    giam_tru: enabledText(salary.giam_tru, salary.giam_tru && salary.giam_tru.items && salary.giam_tru.items.length ? (salary.giam_tru.items.length + ' khoản giảm trừ') : 'Đã áp dụng')
  };
}

function attachSalarySummary(item) {
  if (!item) return item;
  item.salary_summary = buildSalarySummary(item);
  return item;
}

async function normalizeSalarySetup(input, storeId) {
  input = input && typeof input === 'object' ? input : {};
  var advanced = input.muc_luong_nang_cao && typeof input.muc_luong_nang_cao === 'object' ? input.muc_luong_nang_cao : {};
  var overtime = input.lam_them_gio && typeof input.lam_them_gio === 'object' ? input.lam_them_gio : {};
  var thuong = input.thuong && typeof input.thuong === 'object' ? input.thuong : {};
  var hoaHong = input.hoa_hong && typeof input.hoa_hong === 'object' ? input.hoa_hong : {};
  var phuCap = input.phu_cap && typeof input.phu_cap === 'object' ? input.phu_cap : {};
  var giamTru = input.giam_tru && typeof input.giam_tru === 'object' ? input.giam_tru : {};
  var salary = {
    enabled: toBool(input.enabled),
    loai_luong: pickEnum(input.loai_luong, ['theo_ca', 'theo_gio', 'theo_ngay', 'theo_thang'], 'theo_ca'),
    muc_luong: toNumber(input.muc_luong, 0),
    nang_cao: toBool(input.nang_cao),
    muc_luong_nang_cao: {
      ngay_thuong: toNumber(advanced.ngay_thuong, 0),
      ngay_thuong_kieu: pickEnum(advanced.ngay_thuong_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      thu_7: toNumber(advanced.thu_7, 0),
      thu_7_kieu: pickEnum(advanced.thu_7_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      chu_nhat: toNumber(advanced.chu_nhat, 0),
      chu_nhat_kieu: pickEnum(advanced.chu_nhat_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      ngay_nghi: toNumber(advanced.ngay_nghi, 0),
      ngay_nghi_kieu: pickEnum(advanced.ngay_nghi_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      ngay_le_tet: toNumber(advanced.ngay_le_tet, 0),
      ngay_le_tet_kieu: pickEnum(advanced.ngay_le_tet_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      dieu_kien: []
    },
    lam_them_gio: {
      enabled: toBool(overtime.enabled),
      he_so_ngay_thuong: toNumber(overtime.he_so_ngay_thuong, 150),
      he_so_ngay_thuong_kieu: pickEnum(overtime.he_so_ngay_thuong_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      he_so_thu_7: toNumber(overtime.he_so_thu_7, 200),
      he_so_thu_7_kieu: pickEnum(overtime.he_so_thu_7_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      he_so_chu_nhat: toNumber(overtime.he_so_chu_nhat, 200),
      he_so_chu_nhat_kieu: pickEnum(overtime.he_so_chu_nhat_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      he_so_ngay_nghi: toNumber(overtime.he_so_ngay_nghi, 200),
      he_so_ngay_nghi_kieu: pickEnum(overtime.he_so_ngay_nghi_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
      he_so_ngay_le_tet: toNumber(overtime.he_so_ngay_le_tet, 300),
      he_so_ngay_le_tet_kieu: pickEnum(overtime.he_so_ngay_le_tet_kieu, ['phan_tram', 'vnd'], 'phan_tram')
    },
    thuong: {
      enabled: toBool(thuong.enabled),
      loai_thuong: pickEnum(thuong.loai_thuong, ['doanh_thu_ca_nhan', 'doanh_thu_cua_hang', 'doanh_thu_phong_ban'], 'doanh_thu_ca_nhan'),
      hinh_thuc: pickEnum(thuong.hinh_thuc, ['phan_tram_doanh_thu', 'so_tien_co_dinh'], 'phan_tram_doanh_thu'),
      rules: []
    },
    hoa_hong: {
      enabled: toBool(hoaHong.enabled),
      rules: []
    },
    phu_cap: {
      enabled: toBool(phuCap.enabled),
      items: []
    },
    giam_tru: {
      enabled: toBool(giamTru.enabled),
      items: []
    },
    updated_at: new Date()
  };

  if (salary.loai_luong === 'theo_ca' && salary.muc_luong <= 0) {
    var legacyDefault = toNumber(advanced.ngay_thuong, 0);
    if (legacyDefault >= 1000) {
      salary.muc_luong = legacyDefault;
      salary.muc_luong_nang_cao.ngay_thuong = 0;
    }
  }

  if (Array.isArray(thuong.rules)) {
    salary.thuong.rules = thuong.rules.map(function(rule) {
      rule = rule || {};
      return {
        tu_doanh_thu: toNumber(rule.tu_doanh_thu, 0),
        gia_tri_thuong: toNumber(rule.gia_tri_thuong, 0)
      };
    }).filter(function(rule) {
      return rule.tu_doanh_thu > 0 || rule.gia_tri_thuong > 0;
    });
  }

  if (Array.isArray(advanced.dieu_kien)) {
    var caIds = [];
    advanced.dieu_kien.forEach(function(item) {
      item = item || {};
      var caId = pickObjectId(item.ca_lam_viec_id);
      if (caId) caIds.push(caId);
    });
    var caMap = {};
    if (storeId && caIds.length) {
      var cas = await CaLamViec.find({ _id: { $in: caIds }, cua_hang_id: storeId }).lean();
      cas.forEach(function(ca) {
        caMap[String(ca._id)] = ca;
      });
    }
    salary.muc_luong_nang_cao.dieu_kien = advanced.dieu_kien.map(function(item) {
      item = item || {};
      var rawCaId = String(item.ca_lam_viec_id || '').trim();
      if (rawCaId.indexOf('ca_tu_tao_') === 0) return null;
      var caId = pickObjectId(item.ca_lam_viec_id);
      var caDoc = caId ? caMap[String(caId)] : null;
      var tenCa = String(item.ten_ca || (caDoc && caDoc.ten_ca) || '').trim();
      var tenDieuKien = tenCa || String(item.ten_dieu_kien || '').trim();
      var mucLuong = toNumber(item.muc_luong, 0);
      var ngayThuong = toNumber(item.ngay_thuong, mucLuong);
      var row = {
        ten_ca: tenCa || undefined,
        ten_dieu_kien: tenDieuKien || undefined,
        muc_luong: mucLuong,
        ngay_thuong: ngayThuong,
        ngay_thuong_kieu: pickEnum(item.ngay_thuong_kieu, ['phan_tram', 'vnd'], mucLuong > 0 ? 'vnd' : 'phan_tram'),
        thu_7: toNumber(item.thu_7, 0),
        thu_7_kieu: pickEnum(item.thu_7_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
        chu_nhat: toNumber(item.chu_nhat, 0),
        chu_nhat_kieu: pickEnum(item.chu_nhat_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
        ngay_nghi: toNumber(item.ngay_nghi, 0),
        ngay_nghi_kieu: pickEnum(item.ngay_nghi_kieu, ['phan_tram', 'vnd'], 'phan_tram'),
        ngay_le_tet: toNumber(item.ngay_le_tet, 0),
        ngay_le_tet_kieu: pickEnum(item.ngay_le_tet_kieu, ['phan_tram', 'vnd'], 'phan_tram')
      };
      if (caId) row.ca_lam_viec_id = caId;
      return row;
    }).filter(function(item) {
      if (!item) return false;
      return !!item.ca_lam_viec_id || !!item.ten_dieu_kien || !!item.ten_ca || item.muc_luong > 0 || item.ngay_thuong > 0
        || item.thu_7 > 0 || item.chu_nhat > 0 || item.ngay_nghi > 0 || item.ngay_le_tet > 0;
    });
  }

  if (Array.isArray(hoaHong.rules)) {
    salary.hoa_hong.rules = hoaHong.rules.map(function(rule) {
      rule = rule || {};
      var bangHoaHongId = pickObjectId(rule.bang_hoa_hong_id);
      var row = {
        loai_hinh: pickEnum(rule.loai_hinh, ['tu_van_ban_hang', 'ban_hang', 'dich_vu', 'khac'], 'tu_van_ban_hang'),
        tu_doanh_thu: toNumber(rule.tu_doanh_thu, 0),
        kieu_hoa_hong: pickEnum(rule.kieu_hoa_hong, ['phan_tram', 'so_tien'], 'phan_tram'),
        gia_tri_hoa_hong: toNumber(rule.gia_tri_hoa_hong, 0)
      };
      if (bangHoaHongId) row.bang_hoa_hong_id = bangHoaHongId;
      return row;
    }).filter(function(rule) {
      return rule.tu_doanh_thu > 0 || rule.gia_tri_hoa_hong > 0 || !!rule.bang_hoa_hong_id;
    });
  }

  if (Array.isArray(phuCap.items)) {
    salary.phu_cap.items = phuCap.items.map(function(item) {
      item = item || {};
      return {
        ten_phu_cap: String(item.ten_phu_cap || '').trim(),
        loai_phu_cap: pickEnum(item.loai_phu_cap, ['co_dinh_theo_thang', 'theo_ngay_cong', 'theo_ca', 'theo_gio'], 'co_dinh_theo_thang'),
        so_tien: toNumber(item.so_tien, 0)
      };
    }).filter(function(item) {
      return !!item.ten_phu_cap || item.so_tien > 0;
    });
  }

  if (Array.isArray(giamTru.items)) {
    salary.giam_tru.items = giamTru.items.map(function(item) {
      item = item || {};
      return {
        ten_giam_tru: String(item.ten_giam_tru || '').trim(),
        loai_giam_tru: pickEnum(item.loai_giam_tru, ['di_muon', 've_som', 'nghi_khong_phep', 'vi_pham', 'tam_ung', 'khac'], 'khac'),
        kieu_tinh: pickEnum(item.kieu_tinh, ['so_tien_co_dinh', 'theo_so_lan', 'theo_phut', 'phan_tram_luong'], 'so_tien_co_dinh'),
        gia_tri: toNumber(item.gia_tri, 0)
      };
    }).filter(function(item) {
      return !!item.ten_giam_tru || item.gia_tri > 0;
    });
  }

  return salary;
}

async function normalizePayload(body, storeId) {
  body = body || {};
  var gioiTinh = String(body.gioi_tinh || '').trim();
  if (['nam', 'nu', 'khac'].indexOf(gioiTinh) < 0) gioiTinh = undefined;
  var phongBanId = String(body.phong_ban_id || '').trim();
  var chucDanhId = String(body.chuc_danh_id || '').trim();
  var nguoiDungId = String(body.nguoi_dung_id || '').trim();
  var address = normalizeAddress(body);
  var payload = {
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
    tinh_thanh_id: address.tinh_thanh_id,
    quan_huyen: address.quan_huyen,
    quan_huyen_id: address.quan_huyen_id,
    phuong_xa: address.phuong_xa,
    phuong_xa_code: address.phuong_xa_code,
    dia_chi_chi_tiet: address.dia_chi_chi_tiet,
    dia_chi_day_du: address.dia_chi_day_du,
    facebook: String(body.facebook || '').trim(),
    no_va_tam_ung: Math.floor(toNumber(body.no_va_tam_ung, 0)),
    ghi_chu: String(body.ghi_chu || '').trim()
  };
  if (Object.prototype.hasOwnProperty.call(body, 'salary_setup')) {
    payload.salary_setup = await normalizeSalarySetup(body.salary_setup, storeId);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'trang_thai')) {
    payload.trang_thai = body.trang_thai === 'da_nghi' ? 'da_nghi' : 'dang_lam_viec';
  }
  return payload;
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
  var chucDanhId = String(query.chuc_danh_id || '').trim();
  if (mongoose.Types.ObjectId.isValid(chucDanhId)) filter.chuc_danh_id = chucDanhId;
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

async function validateEmployeeRefs(storeId, payload, excludeId) {
  if (payload.phong_ban_id) {
    var pb = await PhongBan.findOne({ _id: payload.phong_ban_id, cua_hang_id: storeId }).lean();
    if (!pb) return 'Phòng ban không tồn tại hoặc không thuộc cửa hàng hiện tại';
  }
  if (payload.chuc_danh_id) {
    var cd = await ChucDanh.findOne({ _id: payload.chuc_danh_id, cua_hang_id: storeId }).lean();
    if (!cd) return 'Chức danh không tồn tại hoặc không thuộc cửa hàng hiện tại';
  }
  if (payload.nguoi_dung_id) {
    var user = await NguoiDung.findOne({ _id: payload.nguoi_dung_id }).lean();
    if (!user) return 'Tài khoản đăng nhập không tồn tại';
    if (user.trang_thai !== 'active') return 'Tài khoản đăng nhập không ở trạng thái hoạt động';
    if (user.cua_hang_id && String(user.cua_hang_id) !== String(storeId)) {
      return 'Tài khoản đăng nhập không thuộc cửa hàng hiện tại';
    }
    var dupFilter = {
      cua_hang_id: storeId,
      nguoi_dung_id: payload.nguoi_dung_id,
      trang_thai: 'dang_lam_viec'
    };
    if (excludeId) dupFilter._id = { $ne: excludeId };
    var dupCount = await NhanVien.countDocuments(dupFilter);
    if (dupCount > 0) return 'Tài khoản đăng nhập đã được gắn với nhân viên khác đang làm việc';
  }
  return null;
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
      activeMenu: 'nhan-vien',
      user: req.user,
      employees: employees,
      phongBans: refs.phongBans,
      chucDanhs: refs.chucDanhs,
      nguoiDungs: refs.nguoiDungs,
      filter: {
        keyword: String(req.query.keyword || ''),
        phong_ban_id: String(req.query.phong_ban_id || ''),
        chuc_danh_id: String(req.query.chuc_danh_id || ''),
        trang_thai: statuses
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
    attachSalarySummary(item);
    return res.json({ success: true, item: item });
  } catch (error) {
    next(error);
  }
};

exports.apiCreate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payload = await normalizePayload(req.body, storeId);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    var refError = await validateEmployeeRefs(storeId, payload, null);
    if (refError) return jsonError(res, 400, refError);
    if (!payload.ma_nhan_vien) payload.ma_nhan_vien = await makeNhanVienCode(storeId);
    var doc = await NhanVien.create(Object.assign({ cua_hang_id: storeId }, payload));
    var item = await NhanVien.findById(doc._id)
      .populate('phong_ban_id', 'ma_phong_ban ten_phong_ban')
      .populate('chuc_danh_id', 'ma_chuc_danh ten_chuc_danh')
      .lean();
    attachSalarySummary(item);
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
    var payload = await normalizePayload(req.body, storeId);
    if (!payload.ten_nhan_vien) return jsonError(res, 400, 'Tên nhân viên là bắt buộc');
    var refError = await validateEmployeeRefs(storeId, payload, id);
    if (refError) return jsonError(res, 400, refError);
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
    attachSalarySummary(item);
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
