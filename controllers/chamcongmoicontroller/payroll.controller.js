const mongoose = require('mongoose');
const { ChamCongMoiBanGhi, ChamCongMoiBangLuong } = require('../../models/chamcongmoi.model');
const { resolveStoreId } = require('../../utils/storeScope');
const { jsonError } = require('./helpers/response.helper');
const { rebuildEmployeePayrollsFromAttendance, enrichPayrollItem } = require('./services/payroll.service');
const { createPayrollPayment } = require('./services/payrollPayment.service');

const apiPayrolls = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var filter = {
      cua_hang_id: storeId,
      trang_thai: String(req.query.trang_thai || 'can_thanh_toan').trim() === 'da_thanh_toan'
        ? 'da_thanh_toan'
        : 'can_thanh_toan'
    };
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (employeeId) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Nhân viên không hợp lệ');
      filter.nhan_vien_id = employeeId;
      if (filter.trang_thai === 'can_thanh_toan') {
        await rebuildEmployeePayrollsFromAttendance(storeId, employeeId);
      }
    }
    var items = await ChamCongMoiBangLuong.find(filter)
      .sort({ thang_bang_luong: -1, ten_nhan_vien: 1 })
      .lean();
    var enriched = [];
    for (var i = 0; i < items.length; i += 1) {
      enriched.push(await enrichPayrollItem(storeId, items[i]));
    }
    var attendanceCount = 0;
    if (employeeId) {
      attendanceCount = await ChamCongMoiBanGhi.countDocuments({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        dong_y: true
      });
    }
    return res.json({
      success: true,
      items: enriched,
      attendance_count: attendanceCount
    });
  } catch (error) {
    next(error);
  }
};

const apiPayrollPaymentPreview = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var payrollId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(payrollId)) return jsonError(res, 400, 'Mã bảng lương không hợp lệ');

    var payroll = await ChamCongMoiBangLuong.findOne({
      _id: payrollId,
      cua_hang_id: storeId
    }).lean();
    if (!payroll) return jsonError(res, 404, 'Không tìm thấy bảng lương');

    payroll = await enrichPayrollItem(storeId, payroll);
    return res.json({
      success: true,
      item: payroll,
      con_thanh_toan: Number(payroll.tong_tien || 0),
      da_thanh_toan: !!payroll.da_thanh_toan,
      phieu_chi: payroll.phieu_chi || null
    });
  } catch (error) {
    next(error);
  }
};

const apiPayrollCreatePhieuChi = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'ChÆ°a chá»n cá»­a hÃ ng');
    var payrollId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(payrollId)) return jsonError(res, 400, 'MÃ£ báº£ng lÆ°Æ¡ng khÃ´ng há»£p lá»‡');
    return res.json(await createPayrollPayment({ storeId, payrollId, body: req.body || {}, userId: req.user && req.user._id }));
  } catch (error) {
    if (error && error.message) return jsonError(res, error.status || 400, error.message);
    next(error);
  }
};

module.exports = { apiPayrolls, apiPayrollPaymentPreview, apiPayrollCreatePhieuChi };
