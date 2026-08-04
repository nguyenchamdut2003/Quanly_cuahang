const mongoose = require('mongoose');
const {
  ChamCongMoiNhanVien,
  ChamCongMoiBanGhi,
  ChamCongMoiThang,
  ChamCongMoiBangLuong
} = require('../../../models/chamcongmoi.model');
const { PhieuThuChi } = require('../../../models/kiot.model');
const { getNextCode } = require('../../../utils/hrCode');
const { formatMonth, monthBounds, formatAttendanceDayDisplay, monthShortLabel } = require('../helpers/date.helper');
const { serializeEmployee } = require('../helpers/employee.helper');
const { serializeAttendanceDays } = require('../helpers/attendance.helper');
const { uniqueValues } = require('../helpers/common.helper');

async function loadAttendanceDaysForMonth(storeId, employeeId, monthKey) {
  var bounds = monthBounds(monthKey);
  if (!bounds) return [];
  return ChamCongMoiBanGhi.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    ngay_cham_cong: { $gte: bounds.start, $lt: bounds.end },
    dong_y: true
  }).sort({ ngay_cham_cong: 1 }).lean();
}

async function collectAttendanceMonthKeys(storeId, employeeId) {
  var monthKeys = [];
  var dayRecords = await ChamCongMoiBanGhi.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    dong_y: true
  }).select('ngay_cham_cong').lean();
  dayRecords.forEach(function(row) {
    monthKeys.push(formatMonth(row.ngay_cham_cong));
  });
  var monthRecords = await ChamCongMoiThang.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    dong_y: true
  }).select('thang_cham_cong').lean();
  monthRecords.forEach(function(row) {
    monthKeys.push(row.thang_cham_cong);
  });
  return uniqueValues(monthKeys);
}

async function rebuildEmployeePayrollsFromAttendance(storeId, employeeId) {
  if (!storeId || !employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) return;
  var employee = await ChamCongMoiNhanVien.findOne({
    _id: employeeId,
    cua_hang_id: storeId
  }).lean();
  if (!employee) return;
  var monthKeys = await collectAttendanceMonthKeys(storeId, employeeId);
  if (!monthKeys.length) return;
  await rebuildPayrolls(storeId, employee, monthKeys);
}

async function loadPayrollPhieuChi(storeId, payrollId) {
  if (!storeId || !payrollId) return null;
  return PhieuThuChi.findOne({
    cua_hang_id: storeId,
    chamcongmoi_bang_luong_id: payrollId,
    loai_phieu: 'chi',
    trang_thai: { $ne: 'cancelled' }
  })
    .sort({ ngay_lap: -1 })
    .select('_id ma_phieu gia_tri ngay_lap trang_thai')
    .lean();
}

async function attachPayrollPaymentInfo(storeId, item) {
  var phieuChi = await loadPayrollPhieuChi(storeId, item._id);
  if (phieuChi && item.trang_thai !== 'da_thanh_toan') {
    await ChamCongMoiBangLuong.updateOne(
      { _id: item._id, cua_hang_id: storeId },
      { $set: { trang_thai: 'da_thanh_toan' } }
    );
    item.trang_thai = 'da_thanh_toan';
  }
  item.da_thanh_toan = item.trang_thai === 'da_thanh_toan' || !!phieuChi;
  item.phieu_chi = phieuChi
    ? {
      _id: String(phieuChi._id),
      ma_phieu: phieuChi.ma_phieu || '',
      gia_tri: Number(phieuChi.gia_tri || 0),
      ngay_lap_text: phieuChi.ngay_lap ? formatAttendanceDayDisplay(phieuChi.ngay_lap) : ''
    }
    : null;
  item.trang_thai_thanh_toan = item.da_thanh_toan ? 'da_thanh_toan' : 'chua_thanh_toan';
  item.trang_thai_thanh_toan_text = item.da_thanh_toan ? 'Đã thanh toán' : 'Chưa thanh toán';
  item.co_the_thanh_toan = !item.da_thanh_toan && Number(item.tong_tien || 0) > 0;
  return item;
}

async function enrichPayrollItem(storeId, item) {
  item.tong_tien = Number(item.tong_tien || 0);
  item.so_ngay_cong = Number(item.so_ngay_cong || 0);
  item.so_thang_cong = Number(item.so_thang_cong || 0);
  item.luong_theo_ngay = Number(item.luong_theo_ngay || 0);
  item.luong_theo_thang = Number(item.luong_theo_thang || 0);
  item.loai_luong_text = item.loai_luong === 'thang' ? 'Theo tháng' : 'Theo ngày';
  item.thang_text = monthShortLabel(item.thang_bang_luong);
  item.chi_tiet_ngay_cong = [];
  item.chi_tiet_text = '---';
  item.canh_bao_luong = '';

  if (item.loai_luong === 'ngay') {
    var days = await loadAttendanceDaysForMonth(storeId, item.nhan_vien_id, item.thang_bang_luong);
    item.chi_tiet_ngay_cong = serializeAttendanceDays(days);
    item.chi_tiet_text = item.chi_tiet_ngay_cong.map(function(day) {
      var timeText = (day.gio_vao || day.gio_ra)
        ? (' ' + (day.gio_vao || '--:--') + '-' + (day.gio_ra || '--:--'))
        : '';
      return day.ngay_hien_thi + timeText;
    }).join('; ');
    if (!item.luong_theo_ngay) {
      item.canh_bao_luong = 'Chưa cấu hình lương/ngày';
    }
  } else if (item.loai_luong === 'thang') {
    item.chi_tiet_text = item.so_thang_cong ? 'Đồng ý chấm công cả tháng' : '---';
    if (!item.luong_theo_thang) {
      item.canh_bao_luong = 'Chưa cấu hình lương/tháng';
    }
  }

  await attachPayrollPaymentInfo(storeId, item);
  return item;
}

async function rebuildPayrolls(storeId, employee, monthKeys) {
  employee = serializeEmployee(employee);
  monthKeys = uniqueValues(monthKeys);
  for (var i = 0; i < monthKeys.length; i += 1) {
    var monthKey = monthKeys[i];
    var bounds = monthBounds(monthKey);
    if (!bounds) continue;

    var basePayload = {
      cua_hang_id: storeId,
      nhan_vien_id: employee._id,
      ma_nhan_vien: employee.ma_nhan_vien || '',
      ten_nhan_vien: employee.ten_nhan_vien || '',
      thang_bang_luong: monthKey,
      trang_thai: 'can_thanh_toan'
    };

    if (employee.co_luong_theo_thang) {
      var monthRecord = await ChamCongMoiThang.findOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_cham_cong: monthKey,
        dong_y: true
      }).lean();
      if (!monthRecord) {
        await ChamCongMoiBangLuong.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employee._id,
          thang_bang_luong: monthKey,
          loai_luong: 'thang'
        });
      } else {
        var luongThang = Number(employee.luong_theo_thang || 0);
        await upsertPayrollRecord(storeId, employee._id, monthKey, 'thang', Object.assign({}, basePayload, {
          loai_luong: 'thang',
          so_ngay_cong: 0,
          so_thang_cong: 1,
          luong_theo_ngay: 0,
          luong_theo_thang: luongThang,
          tong_tien: luongThang
        }));
      }
    } else {
      await ChamCongMoiBangLuong.deleteOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_bang_luong: monthKey,
        loai_luong: 'thang'
      });
    }

    if (employee.co_luong_theo_ngay || !employee.co_luong_theo_thang) {
      var dayCount = await ChamCongMoiBanGhi.countDocuments({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        ngay_cham_cong: { $gte: bounds.start, $lt: bounds.end },
        dong_y: true
      });
      if (!dayCount) {
        await ChamCongMoiBangLuong.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employee._id,
          thang_bang_luong: monthKey,
          loai_luong: 'ngay'
        });
      } else {
        var luongNgay = Number(employee.luong_theo_ngay || 0);
        await upsertPayrollRecord(storeId, employee._id, monthKey, 'ngay', Object.assign({}, basePayload, {
          loai_luong: 'ngay',
          so_ngay_cong: dayCount,
          so_thang_cong: 0,
          luong_theo_ngay: luongNgay,
          luong_theo_thang: 0,
          tong_tien: dayCount * luongNgay
        }));
      }
    } else {
      await ChamCongMoiBangLuong.deleteOne({
        cua_hang_id: storeId,
        nhan_vien_id: employee._id,
        thang_bang_luong: monthKey,
        loai_luong: 'ngay'
      });
    }
  }
}

async function upsertPayrollRecord(storeId, employeeId, monthKey, loaiLuong, payload) {
  var payrollCode = await getPayrollCode(storeId, employeeId, monthKey, loaiLuong);
  payload.ma_bang_luong = payrollCode;
  payload.loai_luong = loaiLuong;
  await ChamCongMoiBangLuong.findOneAndUpdate(
    {
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      thang_bang_luong: monthKey,
      loai_luong: loaiLuong
    },
    { $set: payload },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

async function getPayrollCode(storeId, employeeId, monthKey, loaiLuong) {
  var existingPayroll = await ChamCongMoiBangLuong.findOne({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    thang_bang_luong: monthKey,
    loai_luong: loaiLuong
  }).select('ma_bang_luong').lean();
  if (existingPayroll && existingPayroll.ma_bang_luong) return existingPayroll.ma_bang_luong;

  for (var i = 0; i < 10; i += 1) {
    var code = await getNextCode('chamcongmoi_bang_luong_' + String(storeId), 'BL', 6);
    var exists = await ChamCongMoiBangLuong.exists({
      cua_hang_id: storeId,
      ma_bang_luong: code
    });
    if (!exists) return code;
  }
  return 'BL' + String(Date.now()).slice(-10);
}

async function getPayrollMap(storeId, employeeId, monthKeys) {
  monthKeys = uniqueValues(monthKeys);
  if (!monthKeys.length) return {};
  var payrolls = await ChamCongMoiBangLuong.find({
    cua_hang_id: storeId,
    nhan_vien_id: employeeId,
    thang_bang_luong: { $in: monthKeys },
    trang_thai: 'can_thanh_toan'
  }).select('_id ma_bang_luong thang_bang_luong loai_luong tong_tien').lean();
  var map = {};
  payrolls.forEach(function(item) {
    var mapKey = item.thang_bang_luong + ':' + (item.loai_luong || 'ngay');
    map[mapKey] = {
      id: String(item._id),
      ma_bang_luong: item.ma_bang_luong || '',
      thang_bang_luong: item.thang_bang_luong,
      loai_luong: item.loai_luong || 'ngay',
      tong_tien: Number(item.tong_tien || 0),
      message: 'Đã có bảng lương ' + (item.ma_bang_luong || '') + ' cho tháng ' + item.thang_bang_luong
    };
  });
  return map;
}

module.exports = {
  loadAttendanceDaysForMonth, collectAttendanceMonthKeys, rebuildEmployeePayrollsFromAttendance,
  loadPayrollPhieuChi, attachPayrollPaymentInfo, enrichPayrollItem, rebuildPayrolls, upsertPayrollRecord,
  getPayrollCode, getPayrollMap
};
