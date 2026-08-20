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

async function handleBangLuongThanhToanPreview(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }
    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' }).populate('cham_cong_ids').lean();
    if (!payroll) return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương.' });
    payroll = await normalizeUnpaidPayrollAdvances(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await enrichPayrollEmployerRates(storeId, payroll, req.user && (req.user._id || req.user.id));
    var due = Math.max(0, Number(payroll.con_phai_tra != null ? payroll.con_phai_tra : Number(payroll.thuc_nhan || 0) - Number(payroll.da_thanh_toan || 0)));
    var employerSummary = buildEmployerContributionSummary(payroll);
    var employerPaidRows = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      loai_thanh_toan: 'nsdld',
      trang_thai: 'completed',
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('so_tien').lean();
    var paidEmployer = employerPaidRows.reduce(function(sum, row) {
      return sum + Number(row.so_tien || 0);
    }, 0);
    var remainingEmployer = Math.max(0, employerSummary.tong - paidEmployer);
    return res.json({
      success: true,
      bang_luong_id: String(payroll._id),
      ma_bang_luong: payroll.ma_bang_luong || '',
      tong_luong: Number(payroll.thuc_nhan || 0),
      da_thanh_toan: payroll.trang_thai_thanh_toan === 'da_thanh_toan',
      da_tra: Number(payroll.da_thanh_toan || 0),
      con_thanh_toan: due,
      tong_nsdld: employerSummary.tong,
      da_tra_nsdld: paidEmployer,
      con_nsdld: remainingEmployer,
      payroll_lines: buildPayrollFormulaLines(payroll),
      employer_lines: employerSummary.lines
    });
  } catch (error) {
    return next(error);
  }
}

async function handleBangLuongCreatePayment(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Bảng lương không hợp lệ.' });
    }
    var payroll = await BangLuong.findOne({ _id: id, cua_hang_id: storeId, trang_thai_du_lieu: 'active' })
      .populate('nhan_vien_id', 'ma_nhan_vien ten_nhan_vien')
      .populate('cham_cong_ids')
      .lean();
    if (!payroll) return res.status(404).json({ success: false, message: 'Không tìm thấy bảng lương.' });
    payroll = await normalizeUnpaidPayrollAdvances(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await normalizeMissingPayrollSalary(storeId, payroll, req.user && (req.user._id || req.user.id));
    payroll = await enrichPayrollEmployerRates(storeId, payroll, req.user && (req.user._id || req.user.id));

    var cashAmount = parseMoney(req.body && req.body.tien_mat);
    var transferAmount = parseMoney(req.body && req.body.chuyen_khoan);
    var amount = cashAmount + transferAmount;
    var due = Math.max(0, Number(payroll.con_phai_tra != null ? payroll.con_phai_tra : Number(payroll.thuc_nhan || 0) - Number(payroll.da_thanh_toan || 0)));
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Số tiền thanh toán phải lớn hơn 0.' });
    if (amount > due) return res.status(400).json({ success: false, message: 'Số tiền thanh toán không được vượt số còn phải trả.' });

    var cashBookId = String(req.body && req.body.so_quy_tien_mat_id || '').trim();
    var transferBookId = String(req.body && req.body.so_quy_chuyen_khoan_id || '').trim();
    if (cashAmount > 0 && !cashBookId) return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ tiền mặt.' });
    if (transferAmount > 0 && !transferBookId) return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ chuyển khoản.' });

    var employerSummary = buildEmployerContributionSummary(payroll);
    var employerPaidRows = await ThanhToanLuong.find({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      loai_thanh_toan: 'nsdld',
      trang_thai: 'completed',
      trang_thai_du_lieu: { $ne: 'inactive' }
    }).select('so_tien').lean();
    var paidEmployer = employerPaidRows.reduce(function(sum, row) {
      return sum + Number(row.so_tien || 0);
    }, 0);
    var expectedEmployer = calcEmployerPaymentShare(employerSummary.tong, paidEmployer, due, amount);
    var employerCashAmount = parseMoney(req.body && req.body.nsdld_tien_mat);
    var employerTransferAmount = parseMoney(req.body && req.body.nsdld_chuyen_khoan);
    var employerAmount = employerCashAmount + employerTransferAmount;
    var employerCashBookId = String(req.body && req.body.nsdld_so_quy_tien_mat_id || '').trim();
    var employerTransferBookId = String(req.body && req.body.nsdld_so_quy_chuyen_khoan_id || '').trim();
    if (expectedEmployer > 0) {
      if (employerAmount !== expectedEmployer) {
        return res.status(400).json({
          success: false,
          message: 'Số tiền chi NSDLĐ phải bằng ' + expectedEmployer.toLocaleString('vi-VN') + ' (theo tỷ lệ lần thanh toán lương).'
        });
      }
      if (employerCashAmount > 0 && !employerCashBookId) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ tiền mặt cho chi NSDLĐ.' });
      }
      if (employerTransferAmount > 0 && !employerTransferBookId) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ chuyển khoản cho chi NSDLĐ.' });
      }
    } else if (employerAmount > 0) {
      return res.status(400).json({ success: false, message: 'Lần thanh toán này không phát sinh chi NSDLĐ.' });
    }

    var employee = payroll.nhan_vien_id && typeof payroll.nhan_vien_id === 'object' ? payroll.nhan_vien_id : null;
    var employeeLabel = (payroll.ma_nhan_vien_snapshot ? payroll.ma_nhan_vien_snapshot + ' - ' : '') + (payroll.ten_nhan_vien_snapshot || (employee && employee.ten_nhan_vien) || '');
    var userId = req.user && (req.user._id || req.user.id);
    var receipt = await taoPhieuThuChi({
      loai_phieu: 'chi',
      loai_thu_chi: 'Thanh toán lương nhân viên',
      ngay_lap: new Date(),
      gia_tri: amount,
      doi_tuong: employeeLabel,
      ghi_chu: 'Thanh toán lương ' + (payroll.ma_bang_luong || ''),
      cua_hang_id: storeId,
      chi_nhanh_id: req.session && req.session.chi_nhanh_id,
      nguoi_tao_id: userId,
      hach_toan: true,
      nhom_doi_tuong: 'nhan_vien',
      nhan_vien_id: payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id,
      document_type: 'khac',
      phuong_thuc_thanh_toan: transferAmount > 0 && cashAmount <= 0 ? 'chuyen_khoan' : 'tien_mat',
      payment_v2: true,
      so_quy_id: cashBookId || transferBookId,
      so_quy_tien_mat_id: cashBookId,
      so_quy_chuyen_khoan_id: transferBookId,
      chi_tiet_thanh_toan: {
        tien_mat: cashAmount,
        chuyen_khoan: transferAmount,
        tien_tra_khach: 0,
        so_quy_tien_mat_id: cashBookId || undefined,
        so_quy_chuyen_khoan_id: transferBookId || undefined
      },
      ma_chung_tu_goc: payroll.ma_bang_luong,
      chung_tu_khac: payroll.ma_bang_luong
    });

    var payment = await ThanhToanLuong.create({
      cua_hang_id: storeId,
      bang_luong_id: payroll._id,
      ngay_thanh_toan: new Date(),
      so_tien: amount,
      ma_tham_chieu: receipt.ma_phieu || '',
      phieu_chi_id: receipt._id,
      tien_mat: cashAmount,
      chuyen_khoan: transferAmount,
      so_quy_tien_mat_id: cashBookId || undefined,
      so_quy_chuyen_khoan_id: transferBookId || undefined,
      ghi_chu: 'Thanh toán lương ' + (payroll.ma_bang_luong || ''),
      nguoi_thanh_toan_id: userId,
      loai_thanh_toan: 'nhan_vien',
      trang_thai: 'completed',
      trang_thai_du_lieu: 'active'
    });

    var employerReceipt = null;
    var employerPayment = null;
    if (expectedEmployer > 0) {
      employerReceipt = await taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'Chi khoản nộp NSDLĐ',
        ngay_lap: new Date(),
        gia_tri: expectedEmployer,
        doi_tuong: 'Người sử dụng lao động - ' + employeeLabel,
        ghi_chu: 'Chi NSDLĐ theo bảng lương ' + (payroll.ma_bang_luong || ''),
        cua_hang_id: storeId,
        chi_nhanh_id: req.session && req.session.chi_nhanh_id,
        nguoi_tao_id: userId,
        hach_toan: true,
        nhom_doi_tuong: 'khac',
        nhan_vien_id: payroll.nhan_vien_id && payroll.nhan_vien_id._id ? payroll.nhan_vien_id._id : payroll.nhan_vien_id,
        document_type: 'khac',
        phuong_thuc_thanh_toan: employerTransferAmount > 0 && employerCashAmount <= 0 ? 'chuyen_khoan' : 'tien_mat',
        payment_v2: true,
        so_quy_id: employerCashBookId || employerTransferBookId,
        so_quy_tien_mat_id: employerCashBookId,
        so_quy_chuyen_khoan_id: employerTransferBookId,
        chi_tiet_thanh_toan: {
          tien_mat: employerCashAmount,
          chuyen_khoan: employerTransferAmount,
          tien_tra_khach: 0,
          so_quy_tien_mat_id: employerCashBookId || undefined,
          so_quy_chuyen_khoan_id: employerTransferBookId || undefined
        },
        ma_chung_tu_goc: payroll.ma_bang_luong,
        chung_tu_khac: payroll.ma_bang_luong
      });

      employerPayment = await ThanhToanLuong.create({
        cua_hang_id: storeId,
        bang_luong_id: payroll._id,
        ngay_thanh_toan: new Date(),
        so_tien: expectedEmployer,
        ma_tham_chieu: employerReceipt.ma_phieu || '',
        phieu_chi_id: employerReceipt._id,
        tien_mat: employerCashAmount,
        chuyen_khoan: employerTransferAmount,
        so_quy_tien_mat_id: employerCashBookId || undefined,
        so_quy_chuyen_khoan_id: employerTransferBookId || undefined,
        ghi_chu: 'Chi NSDLĐ theo bảng lương ' + (payroll.ma_bang_luong || ''),
        nguoi_thanh_toan_id: userId,
        loai_thanh_toan: 'nsdld',
        trang_thai: 'completed',
        trang_thai_du_lieu: 'active'
      });
    }

    var nextPaid = Number(payroll.da_thanh_toan || 0) + amount;
    var nextDue = Math.max(0, Number(payroll.thuc_nhan || 0) - nextPaid);
    var nextStatus = nextDue <= 0 ? 'da_thanh_toan' : 'thanh_toan_mot_phan';
    await BangLuong.updateOne(
      { _id: payroll._id, cua_hang_id: storeId },
      {
        $set: {
          da_thanh_toan: nextPaid,
          con_phai_tra: nextDue,
          trang_thai_thanh_toan: nextStatus,
          nguoi_cap_nhat_id: userId
        }
      },
      { runValidators: true }
    );

    return res.json({
      success: true,
      message: expectedEmployer > 0
        ? 'Đã thanh toán lương và tạo phiếu chi NSDLĐ.'
        : 'Đã thanh toán lương và tạo phiếu chi.',
      payment: { _id: String(payment._id), so_tien: Number(payment.so_tien || 0) },
      receipt: {
        _id: String(receipt._id),
        ma_phieu: receipt.ma_phieu || '',
        gia_tri: Number(receipt.gia_tri || 0),
        ma_chung_tu_goc: payroll.ma_bang_luong || ''
      },
      payment_nsdld: employerPayment ? {
        _id: String(employerPayment._id),
        so_tien: Number(employerPayment.so_tien || 0)
      } : null,
      receipt_nsdld: employerReceipt ? {
        _id: String(employerReceipt._id),
        ma_phieu: employerReceipt.ma_phieu || '',
        gia_tri: Number(employerReceipt.gia_tri || 0),
        ma_chung_tu_goc: payroll.ma_bang_luong || ''
      } : null,
      bang_luong: {
        _id: String(payroll._id),
        da_thanh_toan: nextPaid,
        con_phai_tra: nextDue,
        trang_thai_thanh_toan: nextStatus
      }
    });
  } catch (error) {
    return next(error);
  }
}

exports.getBangLuongThanhToan = async function(req, res, next) {
  return handleBangLuongThanhToanPreview(req, res, next);
  res.status(400).json({
    success: false,
    message: 'Bảng này đang được tổng hợp tạm từ chấm công. Chưa tạo thanh toán trực tiếp từ bảng tạm.'
  });
};

exports.createBangLuongPhieuChi = async function(req, res, next) {
  return handleBangLuongCreatePayment(req, res, next);
  res.status(400).json({
    success: false,
    message: 'Bảng này đang được tổng hợp tạm từ chấm công. Chưa tạo phiếu chi trực tiếp từ bảng tạm.'
  });
};
