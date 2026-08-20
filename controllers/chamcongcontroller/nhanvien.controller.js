const {
  NhanVien,
  PhongBan,
  ChucDanh,
  DanhMucKhoanNop,
  DanhMucPhuCap,
  ChamCong,
  CauHinhLuongNhanVien,
  PhuCapNhanVien,
  TamUngNhanVien,
  BangLuong
} = require('../../models/chamcong.model');
const { PhieuThuChi } = require('../../models/kiot.model');
const { taoPhieuThuChi } = require('../../services/soQuy.service');

function getCurrentStoreId(req, res) {
  if (res.locals.currentStore && res.locals.currentStore._id) return String(res.locals.currentStore._id);
  if (req.session && req.session.cua_hang_id) return String(req.session.cua_hang_id);
  if (req.user && req.user.cua_hang_id) return String(req.user.cua_hang_id._id || req.user.cua_hang_id);
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

function normalizeStatus(value) {
  return value === 'inactive' || value === 'da_nghi' ? 'inactive' : 'active';
}

function buildEmployeeLabel(employee) {
  return (employee.ma_nhan_vien ? employee.ma_nhan_vien + ' - ' : '') + (employee.ten_nhan_vien || '');
}

function formatDateText(value) {
  if (!value) return '';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getDate()).padStart(2, '0') + '/'
    + String(date.getMonth() + 1).padStart(2, '0') + '/'
    + date.getFullYear();
}

function formatMonthText(month, year) {
  if (!month || !year) return '';
  return String(month).padStart(2, '0') + '/' + String(year);
}

function attendanceWorkUnits(row) {
  return (row.ca_sang ? 0.5 : 0)
    + (row.ca_chieu ? 0.5 : 0)
    + Number(row.cong_tang_ca || 0);
}

function serializeAdvanceRow(row, receiptMap) {
  var code = String(row.ma_tam_ung || '');
  var receipt = receiptMap && code ? receiptMap[code] : null;
  var payroll = row._payroll || null;
  return {
    _id: String(row._id),
    ma_tam_ung: code,
    ngay_tam_ung: formatDateInput(row.ngay_tam_ung),
    ngay_tam_ung_text: formatDateText(row.ngay_tam_ung),
    so_tien: Number(row.so_tien || 0),
    ghi_chu: row.ghi_chu || '',
    trang_thai: row.trang_thai || 'active',
    phieu_chi: receipt ? {
      _id: String(receipt._id),
      ma_phieu: receipt.ma_phieu || '',
      ngay_lap: formatDateInput(receipt.ngay_lap),
      ngay_lap_text: formatDateText(receipt.ngay_lap),
      gia_tri: Number(receipt.gia_tri || 0),
      phuong_thuc_thanh_toan: receipt.phuong_thuc_thanh_toan || '',
      trang_thai: receipt.trang_thai || '',
      ghi_chu: receipt.ghi_chu || ''
    } : null,
    bang_luong: payroll ? {
      _id: String(payroll._id),
      ma_bang_luong: payroll.ma_bang_luong || '',
      trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || ''
    } : null
  };
}

async function listAdvanceRowsWithReceipts(storeId, employeeId, limit) {
  var advances = await TamUngNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    trang_thai: 'active'
  }).sort({ ngay_tam_ung: -1, created_at: -1 }).limit(limit || 120).lean();

  var codes = advances.map(function(row) {
    return String(row.ma_tam_ung || '').trim();
  }).filter(Boolean);
  var receiptMap = {};
  var payrollMap = {};
  if (codes.length) {
    var receipts = await PhieuThuChi.find({
      cua_hang_id: storeId,
      loai_phieu: 'chi',
      trang_thai_du_lieu: { $ne: 'inactive' },
      $or: [
        { ma_chung_tu_goc: { $in: codes } },
        { chung_tu_khac: { $in: codes } }
      ]
    }).select('_id ma_phieu ngay_lap gia_tri phuong_thuc_thanh_toan trang_thai ghi_chu ma_chung_tu_goc chung_tu_khac')
      .sort({ ngay_lap: -1, created_at: -1 })
      .lean();
    receipts.forEach(function(receipt) {
      var key = String(receipt.ma_chung_tu_goc || receipt.chung_tu_khac || '').trim();
      if (key && !receiptMap[key]) receiptMap[key] = receipt;
    });
  }

  var advanceIds = advances.map(function(row) { return row._id; });
  if (advanceIds.length) {
    var payrollRows = await BangLuong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      tam_ung_ids: { $in: advanceIds },
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('_id ma_bang_luong tam_ung_ids trang_thai_thanh_toan')
      .sort({ nam: -1, thang: -1, created_at: -1 })
      .lean();
    payrollRows.forEach(function(payroll) {
      (payroll.tam_ung_ids || []).forEach(function(advanceId) {
        var key = String(advanceId);
        if (!payrollMap[key]) payrollMap[key] = payroll;
      });
    });
  }

  return advances.map(function(row) {
    row._payroll = payrollMap[String(row._id)] || null;
    return serializeAdvanceRow(row, receiptMap);
  });
}

function normalizeEmployeePayload(body) {
  return {
    ten_nhan_vien: String(body.ten_nhan_vien || '').trim(),
    sdt: String(body.sdt || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    cccd: String(body.cccd || '').trim(),
    ngay_sinh: parseDateInput(body.ngay_sinh),
    gioi_tinh: ['nam', 'nu', 'khac'].includes(body.gioi_tinh) ? body.gioi_tinh : undefined,
    phong_ban_id: String(body.phong_ban_id || '').trim(),
    chuc_danh_id: String(body.chuc_danh_id || '').trim(),
    chuc_vu: String(body.chuc_vu || '').trim(),
    ngay_bat_dau_lam_viec: parseDateInput(body.ngay_bat_dau_lam_viec),
    ghi_chu: String(body.ghi_chu || '').trim(),
    trang_thai: normalizeStatus(body.trang_thai)
  };
}

function normalizeSalaryPayload(body, employeePayload) {
  var luong = body && typeof body.luong === 'object' ? body.luong : {};
  var fromDate = parseDateInput(luong.tu_ngay) || employeePayload.ngay_bat_dau_lam_viec || new Date();
  var contributionIds = Array.isArray(luong.khoan_nop_ids) ? luong.khoan_nop_ids : [];

  return {
    luong_thang: parseMoney(luong.luong_thang != null ? luong.luong_thang : body.luong_theo_thang),
    so_ngay_cong_trong_thang: Number(luong.so_ngay_cong_trong_thang || 0),
    khoan_nop_ids: contributionIds.map(function(id) { return String(id || '').trim(); }).filter(Boolean),
    tu_ngay: fromDate,
    ghi_chu: String(luong.ghi_chu || '').trim(),
    trang_thai: 'active'
  };
}

function normalizeAllowancePayload(body) {
  var rows = Array.isArray(body.phu_caps) ? body.phu_caps : [];
  return rows.map(function(row) {
    return {
      danh_muc_phu_cap_id: String(row.danh_muc_phu_cap_id || '').trim(),
      kieu_tinh: ['co_dinh_thang', 'theo_ngay_di_lam', 'theo_cong'].includes(row.kieu_tinh) ? row.kieu_tinh : '',
      muc_phu_cap: parseMoney(row.muc_phu_cap),
      ghi_chu: String(row.ghi_chu || '').trim()
    };
  }).filter(function(row) {
    return row.danh_muc_phu_cap_id;
  });
}

async function makeEmployeeCode(storeId, session) {
  for (var index = 1; index < 10000; index += 1) {
    var code = 'NV' + String(index).padStart(3, '0');
    var query = NhanVien.exists({ cua_hang_id: storeId, ma_nhan_vien: code });
    if (session) query = query.session(session);
    var exists = await query;
    if (!exists) return code;
  }
  return 'NV' + Date.now();
}

async function makeAdvanceCode(storeId, session) {
  var regex = /^TA(\d+)$/;
  var query = TamUngNhanVien.findOne({
    cua_hang_id: storeId,
    ma_tam_ung: { $regex: /^TA\d+$/ }
  }).sort({ ma_tam_ung: -1 }).select('ma_tam_ung');
  if (session) query = query.session(session);
  var last = await query.lean();
  var match = last && String(last.ma_tam_ung || '').match(regex);
  var next = match ? Number(match[1]) + 1 : 1;

  for (var index = 0; index < 10000; index += 1) {
    var code = 'TA' + String(next + index).padStart(4, '0');
    var existsQuery = TamUngNhanVien.exists({ cua_hang_id: storeId, ma_tam_ung: code });
    if (session) existsQuery = existsQuery.session(session);
    var exists = await existsQuery;
    if (!exists) return code;
  }

  return 'TA' + Date.now();
}

async function validateReference(Model, storeId, id, label, session) {
  if (!id) return null;
  if (!isValidObjectId(id)) {
    var error = new Error(label + ' không hợp lệ.');
    error.status = 400;
    throw error;
  }
  var query = Model.findOne({ _id: id, cua_hang_id: storeId });
  if (session) query = query.session(session);
  var doc = await query;
  if (!doc) {
    var notFound = new Error(label + ' không thuộc cửa hàng hiện tại.');
    notFound.status = 400;
    throw notFound;
  }
  return doc;
}

function salaryChanged(current, nextSalary) {
  if (!current) return true;
  var currentContributionIds = (current.khoan_nop_ids || []).map(function(id) { return String(id); }).sort().join('|');
  var nextContributionIds = (nextSalary.khoan_nop_ids || []).map(function(id) { return String(id); }).sort().join('|');
  return Number(current.luong_thang || 0) !== Number(nextSalary.luong_thang || 0)
    || Number(current.so_ngay_cong_trong_thang || 0) !== Number(nextSalary.so_ngay_cong_trong_thang || 0)
    || currentContributionIds !== nextContributionIds;
}

async function saveSalaryConfig(storeId, employeeId, salary, session) {
  var current = await CauHinhLuongNhanVien.findOne({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    trang_thai: 'active'
  }).sort({ tu_ngay: -1, created_at: -1 }).session(session || null);

  if (!current) {
    return CauHinhLuongNhanVien.create([Object.assign({}, salary, {
      cua_hang_id: storeId,
      nhan_vien_id: employeeId
    })], session ? { session: session, ordered: true } : undefined).then(function(rows) { return rows[0]; });
  }

  var sameStart = formatDateInput(current.tu_ngay) === formatDateInput(salary.tu_ngay);
  if (!salaryChanged(current, salary)) return current;

  if (sameStart) {
    Object.assign(current, salary);
    await current.save(session ? { session: session } : undefined);
    return current;
  }

  current.den_ngay = salary.tu_ngay;
  current.trang_thai = 'inactive';
  await current.save(session ? { session: session } : undefined);
  return CauHinhLuongNhanVien.create([Object.assign({}, salary, {
    cua_hang_id: storeId,
    nhan_vien_id: employeeId
  })], session ? { session: session, ordered: true } : undefined).then(function(rows) { return rows[0]; });
}

async function validateSalaryContributionIds(storeId, salary, session) {
  var ids = salary.khoan_nop_ids || [];
  var uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length !== ids.length) {
    var duplicate = new Error('Không được chọn trùng một khoản nộp.');
    duplicate.status = 400;
    throw duplicate;
  }

  for (var i = 0; i < uniqueIds.length; i += 1) {
    var id = uniqueIds[i];
    if (!isValidObjectId(id)) {
      var invalid = new Error('Khoản nộp không hợp lệ.');
      invalid.status = 400;
      throw invalid;
    }
    var query = DanhMucKhoanNop.findOne({
      _id: id,
      cua_hang_id: storeId,
      trang_thai: 'active'
    });
    if (session) query = query.session(session);
    var exists = await query;
    if (!exists) {
      var notFound = new Error('Khoản nộp không thuộc cửa hàng hiện tại hoặc đã ngừng sử dụng.');
      notFound.status = 400;
      throw notFound;
    }
  }
}

async function saveEmployeeAllowances(storeId, employeeId, allowanceRows, startDate, session) {
  var ids = allowanceRows.map(function(row) { return row.danh_muc_phu_cap_id; });
  var uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length !== ids.length) {
    var duplicate = new Error('Không được chọn trùng một phụ cấp.');
    duplicate.status = 400;
    throw duplicate;
  }

  for (var i = 0; i < allowanceRows.length; i += 1) {
    var row = allowanceRows[i];
    if (!row.kieu_tinh) {
      var typeError = new Error('Vui lòng chọn cách tính phụ cấp.');
      typeError.status = 400;
      throw typeError;
    }
    var allowanceQuery = DanhMucPhuCap.findOne({
      _id: row.danh_muc_phu_cap_id,
      cua_hang_id: storeId,
      trang_thai: 'active'
    });
    if (session) allowanceQuery = allowanceQuery.session(session);
    var allowance = await allowanceQuery;
    if (!allowance) {
      var allowanceError = new Error('Phụ cấp không thuộc cửa hàng hiện tại hoặc đã ngừng sử dụng.');
      allowanceError.status = 400;
      throw allowanceError;
    }
  }

  var activeRows = await PhuCapNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    trang_thai: 'active'
  }).session(session || null);
  var incomingMap = {};
  allowanceRows.forEach(function(row) {
    incomingMap[row.danh_muc_phu_cap_id] = row;
  });

  for (var a = 0; a < activeRows.length; a += 1) {
    var active = activeRows[a];
    var key = String(active.danh_muc_phu_cap_id);
    var incoming = incomingMap[key];
    if (!incoming) {
      active.trang_thai = 'inactive';
      active.den_ngay = startDate;
      await active.save(session ? { session: session } : undefined);
      continue;
    }
    active.kieu_tinh = incoming.kieu_tinh;
    active.muc_phu_cap = incoming.muc_phu_cap;
    active.ghi_chu = incoming.ghi_chu;
    await active.save(session ? { session: session } : undefined);
    delete incomingMap[key];
  }

  var creates = Object.keys(incomingMap).map(function(id) {
    var row = incomingMap[id];
    return {
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      danh_muc_phu_cap_id: row.danh_muc_phu_cap_id,
      kieu_tinh: row.kieu_tinh,
      muc_phu_cap: row.muc_phu_cap,
      tu_ngay: startDate,
      ghi_chu: row.ghi_chu,
      trang_thai: 'active'
    };
  });
  if (creates.length) await PhuCapNhanVien.create(creates, session ? { session: session, ordered: true } : undefined);
}

async function runInTransaction(work) {
  var session = await NhanVien.db.startSession();
  try {
    var result;
    try {
      await session.withTransaction(async function() {
        result = await work(session);
      });
    } catch (error) {
      var message = String(error && error.message || '');
      if (!/Transaction numbers are only allowed|replica set member|Transaction/.test(message)) throw error;
      result = await work(null);
    }
    return result;
  } finally {
    await session.endSession();
  }
}

async function getSalaryMap(storeId, employeeIds) {
  if (!employeeIds.length) return {};
  var rows = await CauHinhLuongNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: { $in: employeeIds },
    trang_thai: 'active'
  }).sort({ nhan_vien_id: 1, tu_ngay: -1, created_at: -1 }).lean();
  var map = {};
  rows.forEach(function(row) {
    var key = String(row.nhan_vien_id);
    if (!map[key]) map[key] = row;
  });
  return map;
}

async function getAllowanceMap(storeId, employeeIds) {
  if (!employeeIds.length) return {};
  var rows = await PhuCapNhanVien.find({
    cua_hang_id: storeId,
    nhan_vien_id: { $in: employeeIds },
    trang_thai: 'active'
  }).populate('danh_muc_phu_cap_id', 'ma_phu_cap ten_phu_cap trang_thai').lean();
  var map = {};
  rows.forEach(function(row) {
    var key = String(row.nhan_vien_id);
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });
  return map;
}

function serializeSalary(salaryConfig) {
  var salary = salaryConfig || {};
  return {
    luong_thang: Number(salary.luong_thang || 0),
    so_ngay_cong_trong_thang: Number(salary.so_ngay_cong_trong_thang || 0),
    khoan_nop_ids: (salary.khoan_nop_ids || []).map(function(id) { return String(id); }),
    tu_ngay: formatDateInput(salary.tu_ngay)
  };
}

function serializeAllowance(row) {
  var danhMuc = row.danh_muc_phu_cap_id && typeof row.danh_muc_phu_cap_id === 'object' ? row.danh_muc_phu_cap_id : null;
  return {
    _id: String(row._id),
    danh_muc_phu_cap_id: danhMuc ? String(danhMuc._id) : String(row.danh_muc_phu_cap_id || ''),
    ten_phu_cap: danhMuc ? (danhMuc.ten_phu_cap || '') : '',
    kieu_tinh: row.kieu_tinh || '',
    muc_phu_cap: Number(row.muc_phu_cap || 0),
    tu_ngay: formatDateInput(row.tu_ngay),
    ghi_chu: row.ghi_chu || ''
  };
}

function serializeEmployee(employee, salaryConfig, allowanceRows) {
  var doc = employee.toObject ? employee.toObject() : employee;
  var phongBan = doc.phong_ban_id && typeof doc.phong_ban_id === 'object' ? doc.phong_ban_id : null;
  var chucDanh = doc.chuc_danh_id && typeof doc.chuc_danh_id === 'object' ? doc.chuc_danh_id : null;
  var salary = serializeSalary(salaryConfig);

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
    phong_ban_id: phongBan ? String(phongBan._id) : String(doc.phong_ban_id || ''),
    phong_ban: phongBan ? (phongBan.ten_phong_ban || '') : '',
    chuc_danh_id: chucDanh ? String(chucDanh._id) : String(doc.chuc_danh_id || ''),
    chuc_vu: chucDanh ? (chucDanh.ten_chuc_danh || '') : '',
    ngay_bat_dau_lam_viec_input: formatDateInput(doc.ngay_bat_dau_lam_viec),
    luong_theo_ngay: 0,
    luong_theo_thang: salary.luong_thang,
    loai_luong: 'thang',
    co_luong_theo_thang: true,
    co_luong_theo_ngay: false,
    luong: salary,
    phu_caps: (allowanceRows || []).map(serializeAllowance),
    trang_thai: doc.trang_thai || 'active',
    ghi_chu: doc.ghi_chu || ''
  };
}

function handleErrorResponse(res, error, next) {
  if (error && error.status) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (error && error.code === 11000) {
    return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại.' });
  }
  return next(error);
}

exports.listNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });

    var includeInactive = String(req.query.include_inactive || '') === '1';
    var keyword = String(req.query.keyword || '').trim();
    var departmentId = String(req.query.phong_ban_id || '').trim();
    var positionId = String(req.query.chuc_danh_id || '').trim();
    var query = { cua_hang_id: storeId };
    if (!includeInactive) query.trang_thai = 'active';
    if (departmentId && isValidObjectId(departmentId)) query.phong_ban_id = departmentId;
    if (positionId && isValidObjectId(positionId)) query.chuc_danh_id = positionId;

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
      .populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .sort({ trang_thai: 1, ma_nhan_vien: 1, ten_nhan_vien: 1 })
      .lean();
    var employeeIds = employees.map(function(item) { return item._id; });
    var salaryMap = await getSalaryMap(storeId, employeeIds);
    var allowanceMap = await getAllowanceMap(storeId, employeeIds);

    res.json({
      success: true,
      items: employees.map(function(item) {
        return serializeEmployee(item, salaryMap[String(item._id)], allowanceMap[String(item._id)]);
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
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId })
      .populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    if (!employee) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });

    var salaryMap = await getSalaryMap(storeId, [employee._id]);
    var allowanceMap = await getAllowanceMap(storeId, [employee._id]);
    res.json({
      success: true,
      item: serializeEmployee(employee, salaryMap[String(employee._id)], allowanceMap[String(employee._id)])
    });
  } catch (error) {
    next(error);
  }
};

exports.detailNhanVienPanel = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Dữ liệu không hợp lệ.</p></div>');
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId })
      .populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    if (!employee) {
      return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy nhân viên.</p></div>');
    }

    var salaryMap = await getSalaryMap(storeId, [employee._id]);
    var allowanceMap = await getAllowanceMap(storeId, [employee._id]);
    var attendanceRows = await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: id
    }).sort({ ngay_cham_cong: -1 }).limit(120).lean();
    var payrollRows = await BangLuong.find({
      cua_hang_id: storeId,
      nhan_vien_id: id
    }).sort({ nam: -1, thang: -1, created_at: -1 }).lean();
    var advanceRows = await listAdvanceRowsWithReceipts(storeId, id, 120);

    res.render('Chamcong/nhan-vien/_detail-panel', {
      item: serializeEmployee(employee, salaryMap[String(employee._id)], allowanceMap[String(employee._id)]),
      attendanceRows: attendanceRows.map(function(row) {
        return {
          ngay_cham_cong: formatDateInput(row.ngay_cham_cong),
          ngay_hien_thi: formatDateText(row.ngay_cham_cong),
          ca_sang: !!row.ca_sang,
          ca_chieu: !!row.ca_chieu,
          tang_ca_cong: Number(row.cong_tang_ca || 0),
          so_cong: attendanceWorkUnits(row),
          ghi_chu: row.ghi_chu || ''
        };
      }),
      payrollRows: payrollRows.map(function(row) {
        var paid = Number(row.da_thanh_toan || 0);
        var due = Math.max(0, Number(row.con_phai_tra != null ? row.con_phai_tra : Number(row.thuc_nhan || 0) - paid));
        var status = row.trang_thai_thanh_toan || (due <= 0 && paid > 0 ? 'da_thanh_toan' : 'chua_thanh_toan');
        return {
          _id: String(row._id),
          ma_bang_luong: row.ma_bang_luong || '',
          thang_hien_thi: formatMonthText(row.thang, row.nam),
          ngay_cong_thuc_te: Number(row.ngay_cong_thuc_te || 0),
          luong_thang: Number(row.luong_thang || 0),
          thuc_nhan: Number(row.thuc_nhan || 0),
          da_thanh_toan: paid,
          con_phai_tra: due,
          trang_thai_thanh_toan: status,
          trang_thai_text: status === 'da_thanh_toan'
            ? 'Đã thanh toán'
            : (status === 'thanh_toan_mot_phan' ? 'Thanh toán một phần' : 'Chưa thanh toán')
        };
      }),
      advanceRows: advanceRows
    });
  } catch (error) {
    next(error);
  }
};

exports.listTamUngNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dá»¯ liá»‡u khÃ´ng há»£p lá»‡.' });
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId }).select('_id').lean();
    if (!employee) return res.status(404).json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y nhÃ¢n viÃªn.' });

    res.json({
      success: true,
      items: await listAdvanceRowsWithReceipts(storeId, id, 120)
    });
  } catch (error) {
    next(error);
  }
};

exports.listNgayCongNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId }).select('_id').lean();
    if (!employee) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });

    var rows = await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: id
    }).sort({ ngay_cham_cong: -1 }).limit(120).lean();

    res.json({
      success: true,
      items: rows.map(function(row) {
        return {
          _id: String(row._id),
          ngay_cham_cong: formatDateInput(row.ngay_cham_cong),
          ngay_hien_thi: formatDateText(row.ngay_cham_cong),
          ca_sang: !!row.ca_sang,
          ca_chieu: !!row.ca_chieu,
          tang_ca_cong: Number(row.cong_tang_ca || 0),
          so_cong: attendanceWorkUnits(row),
          ghi_chu: row.ghi_chu || ''
        };
      })
    });
  } catch (error) {
    next(error);
  }
};

exports.createTamUngNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({ _id: id, cua_hang_id: storeId }).lean();
    if (!employee) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });

    var cashAmount = parseMoney(req.body && (req.body.tien_mat != null ? req.body.tien_mat : req.body.so_tien));
    var transferAmount = parseMoney(req.body && req.body.chuyen_khoan);
    var amount = cashAmount + transferAmount;
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Số tiền tạm ứng phải lớn hơn 0.' });

    var advanceDate = parseDateInput(req.body && req.body.ngay_tam_ung) || new Date();
    var note = String((req.body && req.body.ghi_chu) || '').trim();
    var paymentMethod = transferAmount > 0 && cashAmount <= 0 ? 'chuyen_khoan' : 'tien_mat';
    var cashBookId = String((req.body && (req.body.so_quy_tien_mat_id || req.body.so_quy_id)) || '').trim();
    var transferBookId = String((req.body && req.body.so_quy_chuyen_khoan_id) || '').trim();

    var result = await runInTransaction(async function(session) {
      var advanceRows = await TamUngNhanVien.create([{
        cua_hang_id: storeId,
        nhan_vien_id: id,
        ma_tam_ung: await makeAdvanceCode(storeId, session),
        ngay_tam_ung: advanceDate,
        so_tien: amount,
        ghi_chu: note,
        nguoi_tao_id: req.user && (req.user._id || req.user.id),
        trang_thai: 'active'
      }], session ? { session: session, ordered: true } : { ordered: true });
      var advance = advanceRows[0];
      var advanceCode = advance.ma_tam_ung || String(advance._id);

      var paymentDetail = {
        tien_mat: cashAmount,
        chuyen_khoan: transferAmount,
        tien_tra_khach: 0
      };
      if (cashBookId) paymentDetail.so_quy_tien_mat_id = cashBookId;
      if (transferBookId) paymentDetail.so_quy_chuyen_khoan_id = transferBookId;

      var receipt = await taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'Tạm ứng nhân viên',
        ngay_lap: advanceDate,
        gia_tri: amount,
        doi_tuong: buildEmployeeLabel(employee),
        ghi_chu: note || ('Tạm ứng nhân viên ' + buildEmployeeLabel(employee)),
        cua_hang_id: storeId,
        chi_nhanh_id: req.session && req.session.chi_nhanh_id,
        nguoi_tao_id: req.user && (req.user._id || req.user.id),
        hach_toan: false,
        nhom_doi_tuong: 'nhan_vien',
        nhan_vien_id: id,
        document_type: 'khac',
        phuong_thuc_thanh_toan: paymentMethod,
        payment_v2: true,
        so_quy_id: cashBookId || transferBookId,
        so_quy_tien_mat_id: cashBookId,
        so_quy_chuyen_khoan_id: transferBookId,
        chi_tiet_thanh_toan: paymentDetail,
        ma_chung_tu_goc: advanceCode,
        chung_tu_khac: advanceCode
      }, { session: session });

      return { advance: advance, receipt: receipt };
    });

    res.json({
      success: true,
      message: 'Đã tạo tạm ứng và phiếu chi.',
      item: {
        _id: String(result.advance._id),
        ma_tam_ung: result.advance.ma_tam_ung || '',
        ngay_tam_ung: formatDateInput(result.advance.ngay_tam_ung),
        so_tien: Number(result.advance.so_tien || 0),
        ghi_chu: result.advance.ghi_chu || '',
        phieu_chi: result.receipt ? {
          _id: String(result.receipt._id),
          ma_phieu: result.receipt.ma_phieu || '',
          gia_tri: Number(result.receipt.gia_tri || 0)
        } : null
      }
    });
  } catch (error) {
    return handleErrorResponse(res, error, next);
  }
};

exports.createNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });

    var employeePayload = normalizeEmployeePayload(req.body || {});
    if (!employeePayload.ten_nhan_vien) {
      return res.status(400).json({ success: false, message: 'Tên nhân viên là bắt buộc.' });
    }
    var salaryPayload = normalizeSalaryPayload(req.body || {}, employeePayload);
    if (!(salaryPayload.so_ngay_cong_trong_thang > 0)) {
      return res.status(400).json({ success: false, message: 'Số ngày công trong tháng phải lớn hơn 0.' });
    }
    var allowanceRows = normalizeAllowancePayload(req.body || {});

    var result = await runInTransaction(async function(session) {
      await validateReference(PhongBan, storeId, employeePayload.phong_ban_id, 'Phòng ban', session);
      await validateReference(ChucDanh, storeId, employeePayload.chuc_danh_id, 'Chức danh', session);
      await validateSalaryContributionIds(storeId, salaryPayload, session);

      var rows = await NhanVien.create([{
        cua_hang_id: storeId,
        ma_nhan_vien: await makeEmployeeCode(storeId, session),
        ten_nhan_vien: employeePayload.ten_nhan_vien,
        sdt: employeePayload.sdt,
        email: employeePayload.email,
        cccd: employeePayload.cccd,
        ngay_sinh: employeePayload.ngay_sinh,
        gioi_tinh: employeePayload.gioi_tinh,
        phong_ban_id: employeePayload.phong_ban_id || undefined,
        chuc_danh_id: employeePayload.chuc_danh_id || undefined,
        ngay_bat_dau_lam_viec: employeePayload.ngay_bat_dau_lam_viec,
        ghi_chu: employeePayload.ghi_chu,
        trang_thai: employeePayload.trang_thai
      }], { session: session, ordered: true });

      var employee = rows[0];
      var salaryConfig = await saveSalaryConfig(storeId, employee._id, salaryPayload, session);
      await saveEmployeeAllowances(storeId, employee._id, allowanceRows, salaryPayload.tu_ngay, session);
      return { employeeId: employee._id, salaryConfig: salaryConfig };
    });

    var employee = await NhanVien.findById(result.employeeId)
      .populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    var allowanceMap = await getAllowanceMap(storeId, [employee._id]);

    res.json({
      success: true,
      message: 'Đã thêm nhân viên.',
      item: serializeEmployee(employee, result.salaryConfig, allowanceMap[String(employee._id)])
    });
  } catch (error) {
    return handleErrorResponse(res, error, next);
  }
};

exports.updateNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var employeePayload = normalizeEmployeePayload(req.body || {});
    if (!employeePayload.ten_nhan_vien) {
      return res.status(400).json({ success: false, message: 'Tên nhân viên là bắt buộc.' });
    }
    var salaryPayload = normalizeSalaryPayload(req.body || {}, employeePayload);
    if (!(salaryPayload.so_ngay_cong_trong_thang > 0)) {
      return res.status(400).json({ success: false, message: 'Số ngày công trong tháng phải lớn hơn 0.' });
    }
    var allowanceRows = normalizeAllowancePayload(req.body || {});

    var result = await runInTransaction(async function(session) {
      await validateReference(PhongBan, storeId, employeePayload.phong_ban_id, 'Phòng ban', session);
      await validateReference(ChucDanh, storeId, employeePayload.chuc_danh_id, 'Chức danh', session);
      await validateSalaryContributionIds(storeId, salaryPayload, session);

      var employee = await NhanVien.findOneAndUpdate(
        { _id: id, cua_hang_id: storeId },
        {
          $set: {
            ten_nhan_vien: employeePayload.ten_nhan_vien,
            sdt: employeePayload.sdt,
            email: employeePayload.email,
            cccd: employeePayload.cccd,
            ngay_sinh: employeePayload.ngay_sinh,
            gioi_tinh: employeePayload.gioi_tinh,
            phong_ban_id: employeePayload.phong_ban_id || undefined,
            chuc_danh_id: employeePayload.chuc_danh_id || undefined,
            ngay_bat_dau_lam_viec: employeePayload.ngay_bat_dau_lam_viec,
            ghi_chu: employeePayload.ghi_chu,
            trang_thai: employeePayload.trang_thai
          }
        },
        { new: true, runValidators: true, session: session }
      );

      if (!employee) {
        var notFound = new Error('Không tìm thấy nhân viên.');
        notFound.status = 404;
        throw notFound;
      }

      var salaryConfig = await saveSalaryConfig(storeId, employee._id, salaryPayload, session);
      await saveEmployeeAllowances(storeId, employee._id, allowanceRows, salaryPayload.tu_ngay, session);
      return { employeeId: employee._id, salaryConfig: salaryConfig };
    });

    var employee = await NhanVien.findById(result.employeeId)
      .populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    var allowanceMap = await getAllowanceMap(storeId, [employee._id]);

    res.json({
      success: true,
      message: 'Đã cập nhật nhân viên.',
      item: serializeEmployee(employee, result.salaryConfig, allowanceMap[String(employee._id)])
    });
  } catch (error) {
    return handleErrorResponse(res, error, next);
  }
};

exports.updateTrangThaiNhanVien = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var nextStatus = normalizeStatus((req.body && req.body.trang_thai) || 'inactive');
    var update = { trang_thai: nextStatus };
    if (nextStatus === 'inactive') update.ngay_nghi_viec = new Date();
    var updateQuery = nextStatus === 'inactive'
      ? { $set: update }
      : { $set: update, $unset: { ngay_nghi_viec: '' } };

    var employee = await NhanVien.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      updateQuery,
      { new: true, runValidators: true }
    ).populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh');

    if (!employee) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });

    var salaryMap = await getSalaryMap(storeId, [employee._id]);
    var allowanceMap = await getAllowanceMap(storeId, [employee._id]);
    res.json({
      success: true,
      message: nextStatus === 'inactive' ? 'Đã chuyển nhân viên sang ngừng làm việc.' : 'Đã kích hoạt nhân viên.',
      item: serializeEmployee(employee, salaryMap[String(employee._id)], allowanceMap[String(employee._id)])
    });
  } catch (error) {
    next(error);
  }
};
