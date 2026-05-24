var mongoose = require('mongoose');
var {
  ChamCong,
  LichLamViec,
  CaLamViec,
  NhanVien,
  PhongBan
} = require('../models/hr.model');
var { resolveStoreId } = require('../utils/storeScope');
var { normalizeWorkDate, formatDateInputVN } = require('../utils/hrWorkDay');
var {
  calculateChamCong,
  combineDayAndTime,
  parseDateTimeInput,
  getSoGioNgayCongChuan,
  buildCaSnapshotFromShift,
  buildCaSnapshotFromSchedule,
  trangThaiLabel
} = require('../utils/hrChamCong');

var DUPLICATE_LICH_MSG = 'Lịch này đã có bản chấm công.';
var APPROVED_EDIT_MSG = 'Bản chấm công đã duyệt, không thể sửa';
var APPROVED_DELETE_MSG = 'Bản chấm công đã duyệt, không thể hủy.';

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
    ma_nhan_vien: employee.ma_nhan_vien,
    ten_nhan_vien: employee.ten_nhan_vien,
    phong_ban_id: employee.phong_ban_id,
    chuc_danh_id: employee.chuc_danh_id
  };
}

function buildListQuery(storeId, query) {
  var filter = { cua_hang_id: storeId };
  var tuNgay = normalizeWorkDate(query.tu_ngay);
  var denNgay = normalizeWorkDate(query.den_ngay);

  if (tuNgay || denNgay) {
    filter.ngay_cham_cong = {};
    if (tuNgay) filter.ngay_cham_cong.$gte = tuNgay;
    if (denNgay) filter.ngay_cham_cong.$lte = denNgay;
  }

  var nhanVienId = pickObjectId(query.nhan_vien_id);
  if (nhanVienId) filter.nhan_vien_id = nhanVienId;

  var phongBanId = pickObjectId(query.phong_ban_id);
  if (phongBanId) filter.phong_ban_id = phongBanId;

  var caId = pickObjectId(query.ca_lam_viec_id);
  if (caId) filter.ca_lam_viec_id = caId;

  var trangThai = String(query.trang_thai || '').trim();
  if (trangThai) filter.trang_thai = trangThai;

  var daDuyet = String(query.da_duyet || '').trim();
  if (daDuyet === 'true' || daDuyet === '1') filter.da_duyet = true;
  if (daDuyet === 'false' || daDuyet === '0') filter.da_duyet = false;

  return filter;
}

function defaultDateRange() {
  var parts = formatDateInputVN(new Date()).split('-').map(Number);
  var year = parts[0];
  var month = parts[1];
  var tu = normalizeWorkDate(year + '-' + String(month).padStart(2, '0') + '-01');
  var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  var den = normalizeWorkDate(year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0'));
  return { tu_ngay: tu, den_ngay: den };
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfWeek(date) {
  date = normalizeWorkDate(date) || normalizeWorkDate(new Date());
  var day = date.getDay() || 7;
  return addDays(date, 1 - day);
}

function dateKey(date) {
  return formatDateInputVN(date);
}

function timeText(value) {
  if (!value) return '---';
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return '---';
  var vn = new Date(date.getTime() + 7 * 60 * 60000);
  return String(vn.getUTCHours()).padStart(2, '0') + ':' + String(vn.getUTCMinutes()).padStart(2, '0');
}

function attendanceBoardStatus(attendance) {
  if (!attendance) return { code: 'chua_cham_cong', label: 'Chưa chấm công', checked: false };
  return {
    code: attendance.trang_thai || 'chua_cham_cong',
    label: trangThaiLabel(attendance.trang_thai || 'chua_cham_cong'),
    checked: true
  };
}

async function loadSchedule(storeId, lichId) {
  return LichLamViec.findOne({
    _id: lichId,
    cua_hang_id: storeId,
    trang_thai: 'scheduled'
  }).lean();
}

async function loadShift(storeId, caId) {
  return CaLamViec.findOne({
    _id: caId,
    cua_hang_id: storeId
  }).lean();
}

async function assertNoDuplicateLich(storeId, lichId, excludeId) {
  if (!lichId) return null;
  var filter = {
    cua_hang_id: storeId,
    lich_lam_viec_id: lichId
  };
  if (excludeId) filter._id = { $ne: excludeId };
  var exists = await ChamCong.findOne(filter).select('_id').lean();
  return exists ? DUPLICATE_LICH_MSG : null;
}

function applyMetrics(doc, metrics) {
  doc.trang_thai = metrics.trang_thai;
  doc.so_phut_lam_viec = metrics.so_phut_lam_viec;
  doc.so_phut_di_muon = metrics.so_phut_di_muon;
  doc.so_phut_ve_som = metrics.so_phut_ve_som;
  doc.so_phut_tang_ca_truoc_ca = metrics.so_phut_tang_ca_truoc_ca;
  doc.so_phut_tang_ca_sau_ca = metrics.so_phut_tang_ca_sau_ca;
  doc.so_phut_tang_ca = metrics.so_phut_tang_ca;
  doc.cong_quy_doi = metrics.cong_quy_doi;
}

function resetNonWorkingMetrics(doc, status) {
  doc.trang_thai = status;
  doc.so_phut_lam_viec = 0;
  doc.so_phut_di_muon = 0;
  doc.so_phut_ve_som = 0;
  doc.so_phut_tang_ca_truoc_ca = 0;
  doc.so_phut_tang_ca_sau_ca = 0;
  doc.so_phut_tang_ca = 0;
  doc.cong_quy_doi = 0;
}

var APPROVABLE_STATUSES = [
  'dung_gio',
  'di_muon',
  've_som',
  'di_muon_ve_som',
  'cham_cong_thieu'
];

var NON_APPROVABLE_STATUSES = [
  'chua_cham_cong',
  'nghi_lam',
  'nghi_phep',
  'dang_lam'
];

function buildWeeklyCell(row, employee, attendance) {
  var status = attendanceBoardStatus(attendance);
  return {
    schedule_id: row._id,
    attendance_id: attendance && attendance._id,
    nhan_vien_id: row.nhan_vien_id,
    ca_lam_viec_id: row.ca_lam_viec_id,
    ngay_lam_viec: row.ngay_lam_viec,
    ten_nhan_vien: row.ten_nhan_vien || employee.ten_nhan_vien,
    gio_bat_dau: row.gio_bat_dau || '',
    gio_ket_thuc: row.gio_ket_thuc || '',
    gio_vao: attendance ? timeText(attendance.gio_vao) : '',
    gio_ra: attendance ? timeText(attendance.gio_ra) : '',
    gio_vao_raw: attendance && attendance.gio_vao ? attendance.gio_vao : null,
    gio_ra_raw: attendance && attendance.gio_ra ? attendance.gio_ra : null,
    trang_thai: status.code,
    trang_thai_label: status.label,
    da_cham_cong: status.checked,
    da_duyet: !!(attendance && attendance.da_duyet),
    ghi_chu: attendance ? (attendance.ghi_chu || '') : '',
    so_phut_lam_viec: attendance ? Number(attendance.so_phut_lam_viec || 0) : 0,
    so_phut_di_muon: attendance ? Number(attendance.so_phut_di_muon || 0) : 0,
    so_phut_ve_som: attendance ? Number(attendance.so_phut_ve_som || 0) : 0,
    so_phut_tang_ca: attendance ? Number(attendance.so_phut_tang_ca || 0) : 0,
    cong_quy_doi: attendance ? Number(attendance.cong_quy_doi || 0) : 0
  };
}

async function createAttendanceFromSchedule(storeId, schedule, shift, options, userId) {
  options = options || {};
  var built = await buildFromSchedule(storeId, schedule, shift, options);
  var doc = await ChamCong.create({
    cua_hang_id: storeId,
    lich_lam_viec_id: built.lich_lam_viec_id,
    nhan_vien_id: built.nhan_vien_id,
    ca_lam_viec_id: built.ca_lam_viec_id,
    ngay_cham_cong: built.ngay_cham_cong,
    gio_vao: built.gio_vao,
    gio_ra: built.gio_ra,
    ma_nhan_vien: built.ma_nhan_vien,
    ten_nhan_vien: built.ten_nhan_vien,
    phong_ban_id: built.phong_ban_id,
    chuc_danh_id: built.chuc_danh_id,
    ma_ca: built.ma_ca,
    ten_ca: built.ten_ca,
    gio_bat_dau: built.gio_bat_dau,
    gio_ket_thuc: built.gio_ket_thuc,
    nghi_giua_ca_phut: built.nghi_giua_ca_phut,
    cho_phep_di_muon_phut: built.cho_phep_di_muon_phut,
    cho_phep_ve_som_phut: built.cho_phep_ve_som_phut,
    tinh_lam_them_truoc_ca: built.tinh_lam_them_truoc_ca,
    tinh_lam_them_sau_ca: built.tinh_lam_them_sau_ca,
    loai_ngay: built.loai_ngay,
    ten_ngay_le: built.ten_ngay_le,
    he_so_luong_ngay: built.he_so_luong_ngay,
    nguon_cham_cong: options.nguon_cham_cong || 'thu_cong',
    ghi_chu: built.ghi_chu,
    nguoi_tao_id: userId || undefined,
    da_duyet: false
  });
  applyMetrics(doc, built.metrics);
  await doc.save();
  return doc;
}

async function buildFromSchedule(storeId, schedule, shift, options) {
  options = options || {};
  var caSnapshot = buildCaSnapshotFromSchedule(schedule, shift);
  var soGioChuan = await getSoGioNgayCongChuan(storeId);
  var gioVao = options.gio_vao || null;
  var gioRa = options.gio_ra || null;

  var metrics = calculateChamCong({
    ngay_cham_cong: schedule.ngay_lam_viec,
    gio_vao: gioVao,
    gio_ra: gioRa,
    ca_lam_viec_snapshot: caSnapshot,
    so_gio_ngay_cong_chuan: soGioChuan
  });

  return {
    cua_hang_id: storeId,
    lich_lam_viec_id: schedule._id,
    nhan_vien_id: schedule.nhan_vien_id,
    ca_lam_viec_id: schedule.ca_lam_viec_id,
    ngay_cham_cong: normalizeWorkDate(schedule.ngay_lam_viec),
    gio_vao: gioVao || undefined,
    gio_ra: gioRa || undefined,
    ma_nhan_vien: schedule.ma_nhan_vien,
    ten_nhan_vien: schedule.ten_nhan_vien,
    phong_ban_id: schedule.phong_ban_id,
    chuc_danh_id: schedule.chuc_danh_id,
    ma_ca: caSnapshot.ma_ca,
    ten_ca: caSnapshot.ten_ca,
    gio_bat_dau: caSnapshot.gio_bat_dau,
    gio_ket_thuc: caSnapshot.gio_ket_thuc,
    nghi_giua_ca_phut: caSnapshot.nghi_giua_ca_phut,
    cho_phep_di_muon_phut: caSnapshot.cho_phep_di_muon_phut,
    cho_phep_ve_som_phut: caSnapshot.cho_phep_ve_som_phut,
    tinh_lam_them_truoc_ca: caSnapshot.tinh_lam_them_truoc_ca,
    tinh_lam_them_sau_ca: caSnapshot.tinh_lam_them_sau_ca,
    loai_ngay: schedule.loai_ngay || 'ngay_thuong',
    ten_ngay_le: schedule.ten_ngay_le || undefined,
    he_so_luong_ngay: Number(schedule.he_so_luong_ngay || 100),
    nguon_cham_cong: options.nguon_cham_cong || 'thu_cong',
    ghi_chu: options.ghi_chu || undefined,
    metrics: metrics
  };
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var range = defaultDateRange();
    res.render('cham-cong/index', {
      title: 'Chấm công',
      activeMenu: 'nhan-vien',
      activeHrPage: 'cham-cong',
      user: req.user,
      filterDefaults: {
        tu_ngay: formatDateInputVN(range.tu_ngay),
        den_ngay: formatDateInputVN(range.den_ngay)
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
    var items = await ChamCong.find(buildListQuery(storeId, req.query))
      .populate('phong_ban_id', 'ten_phong_ban')
      .populate('chuc_danh_id', 'ten_chuc_danh')
      .populate('nguoi_duyet_id', 'ten_dang_nhap ho_ten username email')
      .sort({ ngay_cham_cong: -1, gio_bat_dau: 1, ten_nhan_vien: 1 })
      .lean();
    return res.json({ success: true, items: items });
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
        .select('ma_nhan_vien ten_nhan_vien phong_ban_id')
        .sort({ ten_nhan_vien: 1 })
        .lean(),
      CaLamViec.find({ cua_hang_id: storeId, trang_thai: 'active' })
        .select('ma_ca ten_ca gio_bat_dau gio_ket_thuc')
        .sort({ gio_bat_dau: 1 })
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

exports.apiWeeklyBoard = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');

    var employeeId = pickObjectId(req.query.nhan_vien_id);
    if (!employeeId) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await NhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId
    }).select('ma_nhan_vien ten_nhan_vien').lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');

    var weekStart = startOfWeek(req.query.tuan || req.query.tu_ngay || new Date());
    var weekEnd = addDays(weekStart, 6);
    var schedules = await LichLamViec.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      trang_thai: { $in: ['scheduled', 'completed'] },
      ngay_lam_viec: { $gte: weekStart, $lte: weekEnd }
    }).sort({ gio_bat_dau: 1, ten_ca: 1, ngay_lam_viec: 1 }).lean();

    var scheduleIds = schedules.map(function(row) { return row._id; });
    var attendances = scheduleIds.length ? await ChamCong.find({
      cua_hang_id: storeId,
      lich_lam_viec_id: { $in: scheduleIds }
    }).lean() : [];

    var attendanceBySchedule = {};
    attendances.forEach(function(row) {
      if (row.lich_lam_viec_id) attendanceBySchedule[String(row.lich_lam_viec_id)] = row;
    });

    var shiftMap = {};
    schedules.forEach(function(row) {
      var key = String(row.ca_lam_viec_id || row.ten_ca || row._id);
      if (!shiftMap[key]) {
        shiftMap[key] = {
          key: key,
          ca_lam_viec_id: row.ca_lam_viec_id,
          ma_ca: row.ma_ca,
          ten_ca: row.ten_ca || 'Ca làm việc',
          gio_bat_dau: row.gio_bat_dau || '',
          gio_ket_thuc: row.gio_ket_thuc || '',
          cells: {}
        };
      }
      var attendance = attendanceBySchedule[String(row._id)] || null;
      shiftMap[key].cells[dateKey(row.ngay_lam_viec)] = buildWeeklyCell(row, employee, attendance);
    });

    var days = [];
    for (var i = 0; i < 7; i += 1) {
      var day = addDays(weekStart, i);
      days.push({
        key: dateKey(day),
        date: day,
        day_of_month: day.getDate(),
        weekday: i + 2 > 7 ? 'Chủ nhật' : 'Thứ ' + (i + 2),
        is_today: dateKey(day) === dateKey(new Date())
      });
    }

    var shifts = Object.keys(shiftMap).map(function(key) { return shiftMap[key]; }).sort(function(a, b) {
      return String(a.gio_bat_dau || '').localeCompare(String(b.gio_bat_dau || '')) ||
        String(a.ten_ca || '').localeCompare(String(b.ten_ca || ''));
    });

    return res.json({
      success: true,
      employee: employee,
      week: {
        tu_ngay: dateKey(weekStart),
        den_ngay: dateKey(weekEnd)
      },
      days: days,
      shifts: shifts
    });
  } catch (error) {
    next(error);
  }
};

exports.apiAvailableSchedules = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');

    var tuNgay = normalizeWorkDate(req.query.tu_ngay);
    var denNgay = normalizeWorkDate(req.query.den_ngay);
    if (!tuNgay || !denNgay) return jsonError(res, 400, 'Chọn từ ngày và đến ngày');

    var schedules = await LichLamViec.find({
      cua_hang_id: storeId,
      trang_thai: 'scheduled',
      ngay_lam_viec: { $gte: tuNgay, $lte: denNgay }
    }).sort({ ngay_lam_viec: 1, gio_bat_dau: 1 }).lean();

    var existing = await ChamCong.find({
      cua_hang_id: storeId,
      lich_lam_viec_id: { $in: schedules.map(function(s) { return s._id; }) }
    }).select('lich_lam_viec_id').lean();

    var used = {};
    existing.forEach(function(row) {
      if (row.lich_lam_viec_id) used[String(row.lich_lam_viec_id)] = true;
    });

    var items = schedules.filter(function(s) {
      return !used[String(s._id)];
    });

    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiCreate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');

    var body = req.body || {};
    var lichId = pickObjectId(body.lich_lam_viec_id);
    if (!lichId) return jsonError(res, 400, 'Chọn lịch làm việc');

    var dup = await assertNoDuplicateLich(storeId, lichId);
    if (dup) return jsonError(res, 400, dup);

    var schedule = await loadSchedule(storeId, lichId);
    if (!schedule) return jsonError(res, 404, 'Không tìm thấy lịch làm việc đã xếp ca');

    var shift = await loadShift(storeId, schedule.ca_lam_viec_id);
    if (!shift) return jsonError(res, 400, 'Ca làm việc không tồn tại');

    var gioVao = parseDateTimeInput(body.gio_vao) || combineDayAndTime(schedule.ngay_lam_viec, body.gio_vao_time);
    var gioRa = parseDateTimeInput(body.gio_ra) || combineDayAndTime(schedule.ngay_lam_viec, body.gio_ra_time);

    var doc = await createAttendanceFromSchedule(storeId, schedule, shift, {
      gio_vao: gioVao,
      gio_ra: gioRa,
      ghi_chu: String(body.ghi_chu || '').trim(),
      nguon_cham_cong: 'thu_cong'
    }, req.user && req.user._id);

    return res.json({ success: true, item: doc });
  } catch (error) {
    if (isDuplicateKeyError(error)) return jsonError(res, 400, DUPLICATE_LICH_MSG);
    next(error);
  }
};

exports.apiUpdate = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chấm công không hợp lệ');

    var doc = await ChamCong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chấm công');

    if (doc.da_duyet) {
      return jsonError(res, 400, APPROVED_EDIT_MSG);
    }

    var body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'ghi_chu')) {
      doc.ghi_chu = String(body.ghi_chu || '').trim() || undefined;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'gio_vao_time')) {
      var gioVaoTime = String(body.gio_vao_time || '').trim();
      doc.gio_vao = gioVaoTime ? combineDayAndTime(doc.ngay_cham_cong, gioVaoTime) : undefined;
    } else if (body.gio_vao != null && body.gio_vao !== '') {
      doc.gio_vao = parseDateTimeInput(body.gio_vao) || combineDayAndTime(doc.ngay_cham_cong, body.gio_vao_time);
    } else if (body.gio_vao === null || body.gio_vao === '') {
      doc.gio_vao = undefined;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'gio_ra_time')) {
      var gioRaTime = String(body.gio_ra_time || '').trim();
      doc.gio_ra = gioRaTime ? combineDayAndTime(doc.ngay_cham_cong, gioRaTime) : undefined;
    } else if (body.gio_ra != null && body.gio_ra !== '') {
      doc.gio_ra = parseDateTimeInput(body.gio_ra) || combineDayAndTime(doc.ngay_cham_cong, body.gio_ra_time);
    } else if (body.gio_ra === null || body.gio_ra === '') {
      doc.gio_ra = undefined;
    }

    var manualStatus = Object.prototype.hasOwnProperty.call(body, 'trang_thai')
      ? String(body.trang_thai || '').trim()
      : '';

    if (manualStatus === 'nghi_lam' || manualStatus === 'nghi_phep') {
      resetNonWorkingMetrics(doc, manualStatus);
      await doc.save();
      return res.json({ success: true, item: doc });
    }

    if (manualStatus === 'chua_cham_cong') {
      doc.gio_vao = undefined;
      doc.gio_ra = undefined;
      resetNonWorkingMetrics(doc, 'chua_cham_cong');
      await doc.save();
      return res.json({ success: true, item: doc });
    }

    var caSnapshot = buildCaSnapshotFromShift({
      gio_bat_dau: doc.gio_bat_dau,
      gio_ket_thuc: doc.gio_ket_thuc,
      nghi_giua_ca_phut: doc.nghi_giua_ca_phut,
      cho_phep_di_muon_phut: doc.cho_phep_di_muon_phut,
      cho_phep_ve_som_phut: doc.cho_phep_ve_som_phut,
      tinh_lam_them_truoc_ca: doc.tinh_lam_them_truoc_ca,
      tinh_lam_them_sau_ca: doc.tinh_lam_them_sau_ca
    });

    var soGioChuan = await getSoGioNgayCongChuan(storeId);
    var metrics = calculateChamCong({
      ngay_cham_cong: doc.ngay_cham_cong,
      gio_vao: doc.gio_vao,
      gio_ra: doc.gio_ra,
      ca_lam_viec_snapshot: caSnapshot,
      so_gio_ngay_cong_chuan: soGioChuan
    });
    applyMetrics(doc, metrics);
    await doc.save();

    return res.json({ success: true, item: doc });
  } catch (error) {
    next(error);
  }
};

exports.apiDelete = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chấm công không hợp lệ');

    var doc = await ChamCong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chấm công');

    if (doc.da_duyet) {
      return jsonError(res, 400, APPROVED_DELETE_MSG);
    }

    resetNonWorkingMetrics(doc, 'nghi_lam');
    var note = String(doc.ghi_chu || '').trim();
    doc.ghi_chu = note ? note + ' | Đã hủy chấm công' : 'Đã hủy chấm công';
    await doc.save();

    return res.json({
      success: true,
      message: 'Đã hủy bản chấm công',
      item: doc
    });
  } catch (error) {
    next(error);
  }
};

exports.apiCreateFromSchedule = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');

    var singleLichId = pickObjectId(req.body.lich_lam_viec_id);
    if (singleLichId) {
      var dupSingle = await assertNoDuplicateLich(storeId, singleLichId);
      if (dupSingle) return jsonError(res, 400, dupSingle);

      var scheduleSingle = await LichLamViec.findOne({
        _id: singleLichId,
        cua_hang_id: storeId,
        trang_thai: { $in: ['scheduled', 'completed'] }
      }).lean();
      if (!scheduleSingle) return jsonError(res, 404, 'Không tìm thấy lịch làm việc');

      var shiftSingle = await loadShift(storeId, scheduleSingle.ca_lam_viec_id);
      if (!shiftSingle) return jsonError(res, 400, 'Ca làm việc không tồn tại');

      var bodySingle = req.body || {};
      var gioVaoSingle = parseDateTimeInput(bodySingle.gio_vao) ||
        combineDayAndTime(scheduleSingle.ngay_lam_viec, bodySingle.gio_vao_time);
      var gioRaSingle = parseDateTimeInput(bodySingle.gio_ra) ||
        combineDayAndTime(scheduleSingle.ngay_lam_viec, bodySingle.gio_ra_time);

      var docSingle = await createAttendanceFromSchedule(storeId, scheduleSingle, shiftSingle, {
        gio_vao: gioVaoSingle,
        gio_ra: gioRaSingle,
        ghi_chu: String(bodySingle.ghi_chu || '').trim(),
        nguon_cham_cong: 'thu_cong'
      }, req.user && req.user._id);

      return res.json({ success: true, item: docSingle });
    }

    var tuNgay = normalizeWorkDate(req.body.tu_ngay);
    var denNgay = normalizeWorkDate(req.body.den_ngay);
    if (!tuNgay || !denNgay) return jsonError(res, 400, 'Chọn từ ngày và đến ngày');

    var schedules = await LichLamViec.find({
      cua_hang_id: storeId,
      trang_thai: 'scheduled',
      ngay_lam_viec: { $gte: tuNgay, $lte: denNgay }
    }).lean();

    var existing = await ChamCong.find({
      cua_hang_id: storeId,
      lich_lam_viec_id: { $in: schedules.map(function(s) { return s._id; }) }
    }).select('lich_lam_viec_id').lean();

    var used = {};
    existing.forEach(function(row) {
      if (row.lich_lam_viec_id) used[String(row.lich_lam_viec_id)] = true;
    });

    var created = 0;
    var skipped = 0;

    for (var i = 0; i < schedules.length; i += 1) {
      var schedule = schedules[i];
      if (used[String(schedule._id)]) {
        skipped += 1;
        continue;
      }

      var shift = await loadShift(storeId, schedule.ca_lam_viec_id);
      if (!shift) {
        skipped += 1;
        continue;
      }

      var built = await buildFromSchedule(storeId, schedule, shift, {
        nguon_cham_cong: 'tu_dong'
      });

      try {
        var doc = await ChamCong.create({
          cua_hang_id: storeId,
          lich_lam_viec_id: built.lich_lam_viec_id,
          nhan_vien_id: built.nhan_vien_id,
          ca_lam_viec_id: built.ca_lam_viec_id,
          ngay_cham_cong: built.ngay_cham_cong,
          ma_nhan_vien: built.ma_nhan_vien,
          ten_nhan_vien: built.ten_nhan_vien,
          phong_ban_id: built.phong_ban_id,
          chuc_danh_id: built.chuc_danh_id,
          ma_ca: built.ma_ca,
          ten_ca: built.ten_ca,
          gio_bat_dau: built.gio_bat_dau,
          gio_ket_thuc: built.gio_ket_thuc,
          nghi_giua_ca_phut: built.nghi_giua_ca_phut,
          cho_phep_di_muon_phut: built.cho_phep_di_muon_phut,
          cho_phep_ve_som_phut: built.cho_phep_ve_som_phut,
          tinh_lam_them_truoc_ca: built.tinh_lam_them_truoc_ca,
          tinh_lam_them_sau_ca: built.tinh_lam_them_sau_ca,
          loai_ngay: built.loai_ngay,
          ten_ngay_le: built.ten_ngay_le,
          he_so_luong_ngay: built.he_so_luong_ngay,
          nguon_cham_cong: 'tu_dong',
          nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
          trang_thai: 'chua_cham_cong',
          da_duyet: false
        });
        applyMetrics(doc, built.metrics);
        await doc.save();
        created += 1;
      } catch (err) {
        if (isDuplicateKeyError(err)) skipped += 1;
        else throw err;
      }
    }

    return res.json({
      success: true,
      created: created,
      skipped: skipped,
      totalSchedules: schedules.length
    });
  } catch (error) {
    next(error);
  }
};

exports.apiApprove = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return jsonError(res, 400, 'Mã chấm công không hợp lệ');

    var doc = await ChamCong.findOne({ _id: id, cua_hang_id: storeId });
    if (!doc) return jsonError(res, 404, 'Không tìm thấy chấm công');
    if (doc.da_duyet) {
      return jsonError(res, 400, 'Bản chấm công đã được duyệt');
    }
    if (NON_APPROVABLE_STATUSES.indexOf(doc.trang_thai) >= 0) {
      return jsonError(res, 400, 'Không thể duyệt trạng thái: ' + trangThaiLabel(doc.trang_thai));
    }
    if (APPROVABLE_STATUSES.indexOf(doc.trang_thai) < 0) {
      return jsonError(res, 400, 'Chỉ duyệt bản chấm công có công hợp lệ');
    }

    doc.da_duyet = true;
    doc.nguoi_duyet_id = req.user && req.user._id ? req.user._id : undefined;
    doc.ngay_duyet = new Date();
    await doc.save();

    return res.json({ success: true, item: doc });
  } catch (error) {
    next(error);
  }
};

exports.trangThaiLabel = trangThaiLabel;
