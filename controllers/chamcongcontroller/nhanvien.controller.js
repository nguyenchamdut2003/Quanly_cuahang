const {
  NhanVien,
  ChucDanh,
  CauHinhLuongNhanVien
} = require('../../models/chamcong.model');

function getCurrentStoreId(req, res) {
  if (res.locals.currentStore && res.locals.currentStore._id) {
    return String(res.locals.currentStore._id);
  }

  if (req.session && req.session.cua_hang_id) {
    return String(req.session.cua_hang_id);
  }

  if (req.user && req.user.cua_hang_id) {
    return String(req.user.cua_hang_id._id || req.user.cua_hang_id);
  }

  return '';
}

function isValidObjectId(value) {
  return NhanVien.db.base.Types.ObjectId.isValid(String(value || ''));
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateInput(value) {
  if (!value) return '';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function parseDateInput(value) {
  var raw = String(value || '').trim();
  if (!raw) return undefined;
  var date = new Date(raw + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseMoney(value) {
  var number = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function normalizeUiStatus(value) {
  return value === 'inactive' || value === 'da_nghi' ? 'da_nghi' : 'dang_lam_viec';
}

function toUiStatus(value) {
  return value === 'da_nghi' ? 'inactive' : 'active';
}

function buildEmployeeLabel(employee) {
  return (employee.ma_nhan_vien ? employee.ma_nhan_vien + ' - ' : '') + (employee.ten_nhan_vien || '');
}

function normalizePayload(body) {
  return {
    ten_nhan_vien: String(body.ten_nhan_vien || '').trim(),
    sdt: String(body.sdt || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    cccd: String(body.cccd || '').trim(),
    ngay_sinh: parseDateInput(body.ngay_sinh),
    gioi_tinh: ['nam', 'nu', 'khac'].includes(body.gioi_tinh) ? body.gioi_tinh : undefined,
    chuc_vu: String(body.chuc_vu || '').trim(),
    ngay_bat_dau_lam_viec: parseDateInput(body.ngay_bat_dau_lam_viec),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: normalizeUiStatus(body.trang_thai),
    luong_theo_thang: parseMoney(body.luong_theo_thang),
    luong_theo_ngay: parseMoney(body.luong_theo_ngay),
    loai_luong: body.loai_luong === 'ngay' ? 'ngay' : 'thang'
  };
}

async function makeEmployeeCode(storeId) {
  for (var index = 1; index < 10000; index += 1) {
    var code = 'NV' + String(index).padStart(3, '0');
    var exists = await NhanVien.exists({ cua_hang_id: storeId, ma_nhan_vien: code });
    if (!exists) return code;
  }

  return 'NV' + Date.now();
}

async function makePositionCode(storeId) {
  for (var index = 1; index < 10000; index += 1) {
    var code = 'CD' + String(index).padStart(3, '0');
    var exists = await ChucDanh.exists({ cua_hang_id: storeId, ma_chuc_danh: code });
    if (!exists) return code;
  }

  return 'CD' + Date.now();
}

async function findOrCreateChucDanh(storeId, name) {
  var title = String(name || '').trim();
  if (!title) return null;

  var regex = new RegExp('^' + escapeRegex(title) + '$', 'i');
  var existing = await ChucDanh.findOne({
    cua_hang_id: storeId,
    $or: [
      { ten_chuc_danh: regex },
      { ma_chuc_danh: title.toUpperCase() }
    ]
  });

  if (existing) return existing;

  return ChucDanh.create({
    cua_hang_id: storeId,
    ma_chuc_danh: await makePositionCode(storeId),
    ten_chuc_danh: title,
    trang_thai: 'active'
  });
}

async function upsertSalaryConfig(storeId, employeeId, payload) {
  var salary = payload.loai_luong === 'thang' ? payload.luong_theo_thang : 0;
  var config = await CauHinhLuongNhanVien.findOne({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    trang_thai: 'active'
  }).sort({ tu_ngay: -1, created_at: -1 });

  if (!salary) {
    if (config) {
      config.trang_thai = 'inactive';
      await config.save();
    }
    return null;
  }

  var fromDate = payload.ngay_bat_dau_lam_viec || new Date();

  if (config) {
    config.luong_thang = salary;
    config.tu_ngay = config.tu_ngay || fromDate;
    await config.save();
    return config;
  }

  return CauHinhLuongNhanVien.create({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    luong_thang: salary,
    tu_ngay: fromDate,
    trang_thai: 'active'
  });
}

async function getSalaryMap(storeId, employeeIds) {
  if (!employeeIds.length) return {};

  var rows = await CauHinhLuongNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: { $in: employeeIds },
    trang_thai: 'active'
  })
    .sort({ nhan_vien_id: 1, tu_ngay: -1, created_at: -1 })
    .lean();

  var map = {};
  rows.forEach(function(row) {
    var key = String(row.nhan_vien_id);
    if (!map[key]) map[key] = row;
  });
  return map;
}

function serializeEmployee(employee, salaryConfig) {
  var doc = employee.toObject ? employee.toObject() : employee;
  var chucDanh = doc.chuc_danh_id && typeof doc.chuc_danh_id === 'object' ? doc.chuc_danh_id : null;
  var monthlySalary = salaryConfig ? Number(salaryConfig.luong_thang || 0) : 0;

  return {
    _id: String(doc._id),
    ma_nhan_vien: doc.ma_nhan_vien || '',
    ten_nhan_vien: doc.ten_nhan_vien || '',
    label: buildEmployeeLabel(doc),
    sdt: doc.sdt || '',
    email: doc.email || '',
    cccd: doc.cccd || '',
    ngay_sinh_input: formatDateInput(doc.ngay_sinh),
    gioi_tinh: doc.gioi_tinh || '',
    chuc_vu: chucDanh ? (chucDanh.ten_chuc_danh || '') : '',
    ngay_bat_dau_lam_viec_input: formatDateInput(doc.ngay_bat_dau_lam_viec),
    luong_theo_ngay: 0,
    luong_theo_thang: monthlySalary,
    loai_luong: monthlySalary > 0 ? 'thang' : 'ngay',
    co_luong_theo_thang: monthlySalary > 0,
    co_luong_theo_ngay: monthlySalary <= 0,
    trang_thai: toUiStatus(doc.trang_thai),
    ghi_chu: doc.ghi_chu || ''
  };
}

exports.listNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chua chon cua hang.' });
    }

    var includeInactive = String(req.query.include_inactive || '') === '1';
    var keyword = String(req.query.keyword || '').trim();
    var query = { cua_hang_id: storeId };
    if (!includeInactive) query.trang_thai = 'dang_lam_viec';

    if (keyword) {
      var regex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { ma_nhan_vien: regex },
        { ten_nhan_vien: regex },
        { sdt: regex },
        { email: regex },
        { cccd: regex },
        { ghi_chu: regex }
      ];
    }

    var employees = await NhanVien.find(query)
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .sort({ trang_thai: 1, ma_nhan_vien: 1, ten_nhan_vien: 1 })
      .lean();
    var salaryMap = await getSalaryMap(storeId, employees.map(function(item) { return item._id; }));

    res.json({
      success: true,
      items: employees.map(function(item) {
        return serializeEmployee(item, salaryMap[String(item._id)]);
      })
    });
  } catch (error) {
    next(error);
  }
};

exports.getNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId })
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Khong tim thay nhan vien.' });
    }

    var salaryMap = await getSalaryMap(storeId, [employee._id]);
    res.json({
      success: true,
      item: serializeEmployee(employee, salaryMap[String(employee._id)])
    });
  } catch (error) {
    next(error);
  }
};

exports.createNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chua chon cua hang.' });
    }

    var payload = normalizePayload(req.body || {});
    if (!payload.ten_nhan_vien) {
      return res.status(400).json({ success: false, message: 'Ten nhan vien la bat buoc.' });
    }

    var chucDanh = await findOrCreateChucDanh(storeId, payload.chuc_vu);
    var employee = await NhanVien.create({
      cua_hang_id: storeId,
      ma_nhan_vien: await makeEmployeeCode(storeId),
      ten_nhan_vien: payload.ten_nhan_vien,
      sdt: payload.sdt,
      email: payload.email,
      cccd: payload.cccd,
      ngay_sinh: payload.ngay_sinh,
      gioi_tinh: payload.gioi_tinh,
      chuc_danh_id: chucDanh ? chucDanh._id : undefined,
      ngay_bat_dau_lam_viec: payload.ngay_bat_dau_lam_viec,
      ghi_chu: payload.ghi_chu,
      trang_thai: payload.trang_thai
    });

    var salaryConfig = await upsertSalaryConfig(storeId, employee._id, payload);
    employee = await NhanVien.findById(employee._id)
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();

    res.json({
      success: true,
      message: 'Da them nhan vien.',
      item: serializeEmployee(employee, salaryConfig)
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Ma nhan vien da ton tai.' });
    }
    next(error);
  }
};

exports.updateNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var payload = normalizePayload(req.body || {});
    if (!payload.ten_nhan_vien) {
      return res.status(400).json({ success: false, message: 'Ten nhan vien la bat buoc.' });
    }

    var chucDanh = await findOrCreateChucDanh(storeId, payload.chuc_vu);
    var update = {
      ten_nhan_vien: payload.ten_nhan_vien,
      sdt: payload.sdt,
      email: payload.email,
      cccd: payload.cccd,
      ngay_sinh: payload.ngay_sinh,
      gioi_tinh: payload.gioi_tinh,
      ngay_bat_dau_lam_viec: payload.ngay_bat_dau_lam_viec,
      ghi_chu: payload.ghi_chu,
      trang_thai: payload.trang_thai
    };
    var updateQuery = { $set: update };
    if (chucDanh) update.chuc_danh_id = chucDanh._id;
    else updateQuery.$unset = { chuc_danh_id: '' };

    var employee = await NhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      updateQuery,
      { new: true, runValidators: true }
    )
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh');

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Khong tim thay nhan vien.' });
    }

    var salaryConfig = await upsertSalaryConfig(storeId, employee._id, payload);
    res.json({
      success: true,
      message: 'Da cap nhat nhan vien.',
      item: serializeEmployee(employee, salaryConfig)
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Ma nhan vien da ton tai.' });
    }
    next(error);
  }
};

exports.updateTrangThaiNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var nextStatus = normalizeUiStatus((req.body && req.body.trang_thai) || 'inactive');
    var update = { trang_thai: nextStatus };
    if (nextStatus === 'da_nghi') update.ngay_nghi_viec = new Date();

    var employee = await NhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: update },
      { new: true, runValidators: true }
    )
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh');

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Khong tim thay nhan vien.' });
    }

    var salaryMap = await getSalaryMap(storeId, [employee._id]);
    res.json({
      success: true,
      message: nextStatus === 'da_nghi' ? 'Da chuyen nhan vien sang da nghi.' : 'Da kich hoat nhan vien.',
      item: serializeEmployee(employee, salaryMap[String(employee._id)])
    });
  } catch (error) {
    next(error);
  }
};
