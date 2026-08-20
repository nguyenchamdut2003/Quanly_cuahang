const {
  NhanVien,
  ChamCong,
  CauHinhLuongNhanVien,
  PhongBan,
  ChucDanh,
  DanhMucKhoanNop,
  NoiNopKhoanNop,
  DanhMucPhuCap,
  PhuCapNhanVien,
  TamUngNhanVien,
  BangLuong,
  ThanhToanLuong
} = require('../../models/chamcong.model');
const { taoPhieuThuChi } = require('../../services/soQuy.service');
const { PhieuThuChi } = require('../../models/kiot.model');
const db = require('../../models/db.model');
const ExcelJS = require('exceljs');

const mongoose = db.mongoose;

const {
  getCurrentStoreId,
  escapeRegex,
  formatDateKey,
  formatMonthKey,
  formatDateText,
  attendanceWorkUnits,
  attendanceShiftWorkUnits,
  attendanceRegularWorkUnits,
  attendanceOvertimeWorkUnits,
  isValidObjectId,
  parseMoney,
  parseDateKey,
  parseMonthKey,
  normalizeAttendanceRow,
  serializeAttendance,
  serializePayrollAttendanceGroup,
  contributionRate,
  contributionFactor,
  buildContributionRows,
  buildAllowanceRows,
  buildPayrollPayloadFromGroup,
  normalizeUnpaidPayrollAdvances,
  normalizeMissingPayrollSalary,
  nextPayrollCode,
  payrollMonthKey,
  formatFormulaNumber,
  formatFormulaMoney,
  buildPayrollFormulaLines,
  employerContributionAmount,
  buildEmployerContributionSummary,
  enrichPayrollEmployerRates,
  calcEmployerPaymentShare,
  isEmployeeSalaryPayment,
  serializeBangLuong,
  buildAttendancePayrollWarnings,
  normalizeExportKey,
  findPayrollAmount,
  findPayrollRate,
  payrollExportFilename,
  setPayrollExportCellStyle,
  buildPayrollExportWorkbook,
  pickBetterSalary,
  getSalaryMap
} = require('./chamcong.helpers');

exports.index = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var activeTab = String(req.query.tab || '').trim();
    var keyword = String(req.query.keyword || '').trim();
    var keywordRegex = keyword ? new RegExp(escapeRegex(keyword), 'i') : null;

    var employeeQuery = {
      cua_hang_id: storeId,
      trang_thai: 'active'
    };
    var phongBanQuery = { cua_hang_id: storeId };
    var chucDanhQuery = { cua_hang_id: storeId };
    var khoanNopQuery = { cua_hang_id: storeId };
    var phuCapQuery = { cua_hang_id: storeId };

    if (keywordRegex && activeTab === 'departments') {
      phongBanQuery.$or = [
        { ma_phong_ban: keywordRegex },
        { ten_phong_ban: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'positions') {
      chucDanhQuery.$or = [
        { ma_chuc_danh: keywordRegex },
        { ten_chuc_danh: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'contributions') {
      khoanNopQuery.$or = [
        { ma_khoan: keywordRegex },
        { ten_khoan: keywordRegex }
      ];
    }

    if (keywordRegex && activeTab === 'allowances') {
      phuCapQuery.$or = [
        { ma_phu_cap: keywordRegex },
        { ten_phu_cap: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    var employees = await NhanVien.find(employeeQuery)
      .select('ma_nhan_vien ten_nhan_vien')
      .sort({ ma_nhan_vien: 1, ten_nhan_vien: 1 })
      .lean();
    var employeeIds = employees.map(function(item) { return item._id; });
    var employeeSalaryMap = await getSalaryMap(storeId, employeeIds);
    employees.forEach(function(item) {
      item.luong = employeeSalaryMap[String(item._id)] || {};
    });

    var phongBans = await PhongBan.find(phongBanQuery)
      .sort({ trang_thai: 1, ma_phong_ban: 1, ten_phong_ban: 1 })
      .lean();

    var chucDanhs = await ChucDanh.find(chucDanhQuery)
      .sort({ trang_thai: 1, ma_chuc_danh: 1, ten_chuc_danh: 1 })
      .lean();

    var danhMucKhoanNops = await DanhMucKhoanNop.find(khoanNopQuery)
      .populate('noi_nop_id', 'ma_noi_nop ten_noi_nop trang_thai')
      .sort({ ma_khoan: 1, ten_khoan: 1 })
      .lean();

    var noiNops = await NoiNopKhoanNop.find({ cua_hang_id: storeId })
      .sort({ trang_thai: 1, ma_noi_nop: 1, ten_noi_nop: 1 })
      .lean();

    var danhMucPhuCaps = await DanhMucPhuCap.find(phuCapQuery)
      .sort({ trang_thai: 1, ma_phu_cap: 1, ten_phu_cap: 1 })
      .lean();

    var selectedEmployeeId = String(req.query.nhan_vien_id || req.query.employee || '');
    if (!selectedEmployeeId && employees.length) {
      selectedEmployeeId = String(employees[0]._id);
    }

    res.render('Chamcong/chamcong/index', {
      pageTitle: 'Chấm công',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      employees: employees,
      phongBans: phongBans,
      chucDanhs: chucDanhs,
      danhMucKhoanNops: danhMucKhoanNops,
      noiNops: noiNops,
      danhMucPhuCaps: danhMucPhuCaps,
      selectedEmployeeId: selectedEmployeeId,
      weekStart: formatDateKey(new Date())
    });
  } catch (error) {
    next(error);
  }
};

exports.getTuan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var employeeId = String(req.query.nhan_vien_id || req.query.employee || '').trim();
    var monthRange = parseMonthKey(req.query.thang || req.query.month);

    if (!storeId || !employeeId || !isValidObjectId(employeeId) || !monthRange) {
      return res.status(400).json({ success: false, message: 'Dữ liệu chấm công không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId
    }).select('_id').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });
    }

    var rows = await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: {
        $gte: monthRange.start,
        $lt: monthRange.end
      }
    }).sort({ ngay_cham_cong: 1 }).lean();
    var attendanceIds = rows.map(function(row) { return row._id; });
    var payrollMap = {};
    if (attendanceIds.length) {
      var payrollRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: attendanceIds }
      }).select('_id ma_bang_luong cham_cong_ids trang_thai_thanh_toan').sort({ created_at: -1 }).lean();
      payrollRows.forEach(function(payroll) {
        (payroll.cham_cong_ids || []).forEach(function(attendanceId) {
          var key = String(attendanceId);
          if (!payrollMap[key]) {
            payrollMap[key] = {
              id: String(payroll._id),
              ma_bang_luong: payroll.ma_bang_luong || '',
              trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || 'chua_thanh_toan',
              message: 'Đã có bảng chấm công'
            };
          }
        });
      });
    }

    res.json({
      success: true,
      mode: 'ngay',
      days: rows.map(function(row) { return serializeAttendance(row, payrollMap); })
    });
  } catch (error) {
    next(error);
  }
};

exports.saveTuan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var userId = req.user && (req.user._id || req.user.id);
    var employeeId = String((req.body && req.body.nhan_vien_id) || '').trim();
    var rows = Array.isArray(req.body && req.body.days) ? req.body.days : [];

    if (!storeId || !employeeId || !isValidObjectId(employeeId)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu chấm công không hợp lệ.' });
    }

    var employee = await NhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId
    }).select('_id').lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên.' });
    }

    var normalizedRows = rows.map(normalizeAttendanceRow).filter(Boolean);
    var seen = {};
    var saved = 0;
    var removed = 0;
    var affectedDateKeys = {};
    var affectedDateValues = [];

    normalizedRows.forEach(function(row) {
      if (!affectedDateKeys[row.ngay_key]) {
        affectedDateKeys[row.ngay_key] = true;
        affectedDateValues.push(row.ngay_cham_cong);
      }
    });

    var attendanceById = {};
    var existingRows = affectedDateValues.length ? await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $in: affectedDateValues }
    }).lean() : [];
    existingRows.forEach(function(row) {
      attendanceById[String(row._id)] = row;
    });
    var existingAttendanceIds = existingRows.map(function(row) { return row._id; });
    var usedAttendanceMap = {};
    if (existingAttendanceIds.length) {
      var usedAttendancePayrolls = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: existingAttendanceIds }
      }).select('_id ma_bang_luong cham_cong_ids trang_thai_thanh_toan').lean();
      usedAttendancePayrolls.forEach(function(payroll) {
        (payroll.cham_cong_ids || []).forEach(function(attendanceId) {
          var key = String(attendanceId);
          if (!usedAttendanceMap[key]) {
            usedAttendanceMap[key] = {
              _id: String(payroll._id),
              ma_bang_luong: payroll.ma_bang_luong || '',
              trang_thai_thanh_toan: payroll.trang_thai_thanh_toan || ''
            };
          }
        });
      });
    }

    for (var i = 0; i < normalizedRows.length; i += 1) {
      var row = normalizedRows[i];
      if (seen[row.ngay_key]) continue;
      seen[row.ngay_key] = true;

      var query = {
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: row.ngay_cham_cong
      };
      var existingRow = existingRows.find(function(item) {
        return formatDateKey(new Date(item.ngay_cham_cong)) === row.ngay_key;
      });
      if (existingRow && usedAttendanceMap[String(existingRow._id)]) {
        continue;
      }

      if (!row.should_save) {
        var deleteResult = await ChamCong.deleteOne(query);
        removed += Number(deleteResult.deletedCount || 0);
        continue;
      }

      var setPayload = {
        ca_sang: row.ca_sang,
        ca_chieu: row.ca_chieu,
        tick_tang_ca: row.tick_tang_ca,
        cong_tang_ca: row.cong_tang_ca,
        ghi_chu: row.ghi_chu
      };
      var insertPayload = {
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: row.ngay_cham_cong
      };
      if (userId) {
        setPayload.nguoi_cap_nhat_id = userId;
        insertPayload.nguoi_tao_id = userId;
      }

      await ChamCong.updateOne(
        query,
        {
          $set: setPayload,
          $setOnInsert: insertPayload
        },
        { upsert: true, runValidators: true }
      );
      saved += 1;
    }

    var currentRows = affectedDateValues.length ? await ChamCong.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $in: affectedDateValues }
    }).lean() : [];
    currentRows.forEach(function(row) {
      attendanceById[String(row._id)] = row;
    });
    var payrollCreated = [];
    var payrollSourceRows = currentRows.filter(function(row) {
      if (usedAttendanceMap[String(row._id)]) return false;
      return attendanceWorkUnits(row) > 0 || String(row.ghi_chu || '').trim();
    });
    if (payrollSourceRows.length) {
      var payrollEmployee = await NhanVien.findOne({
        _id: employeeId,
        cua_hang_id: storeId
      }).populate('phong_ban_id', 'ten_phong_ban ma_phong_ban')
        .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
        .lean();
      var groupedRows = {};
      payrollSourceRows.forEach(function(row) {
        var month = formatMonthKey(new Date(row.ngay_cham_cong));
        var key = employeeId + '_' + month;
        if (!groupedRows[key]) {
          groupedRows[key] = {
            employeeId: employeeId,
            employee: payrollEmployee || {},
            month: month,
            rows: []
          };
        }
        groupedRows[key].rows.push(row);
      });
      var maxDate = payrollSourceRows.reduce(function(max, row) {
        var value = new Date(row.ngay_cham_cong);
        return value > max ? value : max;
      }, new Date(0));
      var salaryByMonth = {};
      var groupMonths = Object.keys(groupedRows);
      for (var sm = 0; sm < groupMonths.length; sm += 1) {
        var groupMonth = groupedRows[groupMonths[sm]].month;
        var monthRange = parseMonthKey(groupMonth);
        var salaryAsOf = monthRange ? new Date(monthRange.end.getTime() - 1) : maxDate;
        salaryByMonth[groupMonth] = await getSalaryMap(storeId, [employeeId], salaryAsOf);
      }
      var allowanceRows = await PhuCapNhanVien.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai: 'active'
      }).populate('danh_muc_phu_cap_id', 'ma_phu_cap ten_phu_cap').lean();
      var allowanceMap = {};
      allowanceMap[employeeId] = allowanceRows;
      var advanceRows = await TamUngNhanVien.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_tam_ung: { $gte: new Date(Date.UTC(maxDate.getUTCFullYear(), 0, 1)), $lt: new Date(Date.UTC(maxDate.getUTCFullYear() + 1, 0, 1)) },
        trang_thai: 'active'
      }).lean();
      var usedAdvanceRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        tam_ung_ids: { $exists: true, $ne: [] }
      }).select('tam_ung_ids').lean();
      var usedAdvanceMap = {};
      usedAdvanceRows.forEach(function(payroll) {
        (payroll.tam_ung_ids || []).forEach(function(advanceId) {
          usedAdvanceMap[String(advanceId)] = true;
        });
      });
      var advanceMap = {};
      advanceRows.forEach(function(row) {
        if (usedAdvanceMap[String(row._id)]) return;
        var key = String(row.nhan_vien_id) + '_' + formatMonthKey(new Date(row.ngay_tam_ung));
        if (!advanceMap[key]) advanceMap[key] = [];
        advanceMap[key].push(row);
      });

      var groupKeys = Object.keys(groupedRows);
      for (var g = 0; g < groupKeys.length; g += 1) {
        groupedRows[groupKeys[g]].rows.sort(function(a, b) {
          return new Date(a.ngay_cham_cong) - new Date(b.ngay_cham_cong);
        });
        var salaryMap = salaryByMonth[groupedRows[groupKeys[g]].month] || {};
        var payload = buildPayrollPayloadFromGroup(groupedRows[groupKeys[g]], salaryMap, allowanceMap, advanceMap, storeId, userId);
        payload.ma_bang_luong = await nextPayrollCode(storeId, payload.ma_bang_luong);
        payload.da_thanh_toan = 0;
        payload.con_phai_tra = Number(payload.thuc_nhan || 0);
        payload.trang_thai_thanh_toan = 'chua_thanh_toan';
        payload.trang_thai_du_lieu = 'active';
        var created = await BangLuong.create(payload);
        payrollCreated.push({
          _id: String(created._id),
          ma_bang_luong: created.ma_bang_luong || ''
        });
      }
    }
    var affectedAttendanceIds = Object.keys(attendanceById);
    var payrollWarnings = [];
    if (affectedAttendanceIds.length) {
      var relatedPayrollRows = await BangLuong.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        trang_thai_du_lieu: 'active',
        cham_cong_ids: { $in: affectedAttendanceIds }
      }).populate('cham_cong_ids').sort({ nam: -1, thang: -1 }).lean();
      for (var rp = 0; rp < relatedPayrollRows.length; rp += 1) {
        relatedPayrollRows[rp] = await normalizeMissingPayrollSalary(storeId, relatedPayrollRows[rp], userId);
      }
      var payrollIds = relatedPayrollRows.map(function(row) { return row._id; });
      var payments = payrollIds.length ? await ThanhToanLuong.find({
        cua_hang_id: storeId,
        bang_luong_id: { $in: payrollIds },
        trang_thai: 'completed',
        trang_thai_du_lieu: { $ne: 'inactive' }
      }).populate('phieu_chi_id', 'ma_phieu gia_tri ngay_lap').sort({ ngay_thanh_toan: -1, created_at: -1 }).lean() : [];
      var paymentMap = {};
      payments.forEach(function(payment) {
        var key = String(payment.bang_luong_id);
        if (!paymentMap[key]) paymentMap[key] = [];
        paymentMap[key].push(payment);
      });
      payrollWarnings = buildAttendancePayrollWarnings(relatedPayrollRows, paymentMap, affectedDateKeys, attendanceById);
    }

    res.json({
      success: true,
      message: 'Đã lưu chấm công.',
      saved: saved,
      removed: removed,
      payrolls: payrollCreated,
      warnings: payrollWarnings
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Dữ liệu bị trùng, vui lòng tải lại trang và lưu lại.' });
    }
    next(error);
  }
};
