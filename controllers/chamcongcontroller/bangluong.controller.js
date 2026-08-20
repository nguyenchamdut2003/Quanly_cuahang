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

exports.listBangLuong = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });

    var employeeId = String(req.query.nhan_vien_id || '').trim();
    var statusFilter = String(req.query.trang_thai || '').trim();
    var query = { cua_hang_id: storeId };
    if (employeeId) {
      if (!isValidObjectId(employeeId)) {
        return res.status(400).json({ success: false, message: 'Nhân viên không hợp lệ.' });
      }
      query.nhan_vien_id = employeeId;
    }

    var payrollQuery = { cua_hang_id: storeId, trang_thai_du_lieu: 'active' };
    if (employeeId) payrollQuery.nhan_vien_id = employeeId;
    if (!statusFilter || statusFilter === 'all') {
      // keep all payment statuses
    } else if (statusFilter === 'da_thanh_toan') payrollQuery.trang_thai_thanh_toan = 'da_thanh_toan';
    else payrollQuery.trang_thai_thanh_toan = { $ne: 'da_thanh_toan' };

    var payrollRows = await BangLuong.find(payrollQuery)
      .populate('cham_cong_ids')
      .sort({ nam: -1, thang: -1, ma_nhan_vien_snapshot: 1 })
      .lean();
    for (var p = 0; p < payrollRows.length; p += 1) {
      payrollRows[p] = await normalizeUnpaidPayrollAdvances(storeId, payrollRows[p], req.user && (req.user._id || req.user.id));
      payrollRows[p] = await normalizeMissingPayrollSalary(storeId, payrollRows[p], req.user && (req.user._id || req.user.id));
    }
    var payrollIds = payrollRows.map(function(row) { return row._id; });
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

    res.json({
      success: true,
      items: payrollRows.map(function(row) { return serializeBangLuong(row, paymentMap); })
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteBangLuong = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }

    var relatedPayments = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: id,
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('_id phieu_chi_id').lean();
    var relatedPaymentIds = relatedPayments.map(function(row) { return row._id; });
    var relatedReceiptIds = relatedPayments.map(function(row) { return row.phieu_chi_id; }).filter(Boolean);

    var updated = await BangLuong.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId, trang_thai_du_lieu: { $ne: 'inactive' } },
      {
        $set: {
          trang_thai_du_lieu: 'inactive',
          nguoi_cap_nhat_id: req.user && (req.user._id || req.user.id)
        }
      },
      { new: true }
    ).lean();
    if (updated) {
      if (relatedPaymentIds.length) {
        await ThanhToanLuong.updateMany(
          { _id: { $in: relatedPaymentIds }, cua_hang_id: storeId },
          {
            $set: {
              trang_thai_du_lieu: 'inactive'
            }
          },
          { runValidators: true }
        );
      }

      if (relatedReceiptIds.length) {
        await PhieuThuChi.updateMany(
          { _id: { $in: relatedReceiptIds }, cua_hang_id: storeId },
          {
            $set: {
              trang_thai_du_lieu: 'inactive',
              nguoi_huy_id: req.user && (req.user._id || req.user.id),
              ngay_huy: new Date(),
              ly_do_huy: 'Xoa bang luong ' + (updated.ma_bang_luong || '')
            }
          },
          { runValidators: true }
        );
      }
    }
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương active.' });
    }

    return res.json({
      success: true,
      message: 'Đã xóa bảng lương.',
      item: {
        _id: String(updated._id),
        ma_bang_luong: updated.ma_bang_luong || '',
        trang_thai_du_lieu: updated.trang_thai_du_lieu || 'inactive',
        so_thanh_toan_inactive: relatedPaymentIds.length,
        so_phieu_chi_inactive: relatedReceiptIds.length
      }
    });
  } catch (error) {
    return next(error);
  }
};

exports.exportBangLuongExcel = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).send('Dữ liệu không hợp lệ.');
    }

    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' })
      .populate('cham_cong_ids')
      .lean();
    if (!payroll) {
      return res.status(404).send('Không tìm thấy bảng lương.');
    }
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));

    var employee = await NhanVien.findOne({ _id: payroll.nhan_vien_id, cua_hang_id: storeId })
      .populate('chuc_danh_id', 'ten_chuc_danh ma_chuc_danh')
      .lean();
    if (employee && employee.chuc_danh_id && typeof employee.chuc_danh_id === 'object') {
      employee.chuc_danh = employee.chuc_danh_id.ten_chuc_danh || '';
    }

    var workbook = buildPayrollExportWorkbook(payroll, employee || {});
    var filename = payrollExportFilename(payroll);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
};
