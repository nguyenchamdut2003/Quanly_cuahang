const mongoose = require('mongoose');
const { ChamCongMoiNhanVien, ChamCongMoiBanGhi } = require('../../models/chamcongmoi.model');
const { resolveStoreId } = require('../../utils/storeScope');
const { jsonError } = require('./helpers/response.helper');
const { pad2, normalizeDate, formatDate, addDays, startOfWeek } = require('./helpers/date.helper');
const { cleanTime } = require('./helpers/common.helper');
const { serializeEmployee } = require('./helpers/employee.helper');

const apiWeekOld = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var employeeId = String(req.query.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');

    var weekStart = startOfWeek(req.query.week_start || new Date());
    var weekEnd = addDays(weekStart, 6);
    var records = await ChamCongMoiBanGhi.find({
      cua_hang_id: storeId,
      nhan_vien_id: employeeId,
      ngay_cham_cong: { $gte: weekStart, $lte: weekEnd }
    }).lean();

    var byDate = {};
    records.forEach(function(item) {
      byDate[formatDate(item.ngay_cham_cong)] = item;
    });

    var days = [];
    var labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    var today = formatDate(new Date());
    for (var i = 0; i < 7; i += 1) {
      var date = addDays(weekStart, i);
      var key = formatDate(date);
      var record = byDate[key] || {};
      days.push({
        key: key,
        label: labels[i],
        day: pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1),
        is_today: key === today,
        gio_vao: record.gio_vao || '08:00',
        gio_ra: record.gio_ra || '17:30',
        dong_y: !!(record._id || record.dong_y),
        ghi_chu: record.ghi_chu || ''
      });
    }

    return res.json({
      success: true,
      employee: serializeEmployee(employee),
      week: {
        tu_ngay: formatDate(weekStart),
        den_ngay: formatDate(weekEnd)
      },
      days: days
    });
  } catch (error) {
    next(error);
  }
};

const apiSaveWeekOld = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return jsonError(res, 400, 'Chưa chọn cửa hàng');
    var body = req.body || {};
    var employeeId = String(body.nhan_vien_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) return jsonError(res, 400, 'Chọn nhân viên');

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).select('_id').lean();
    if (!employee) return jsonError(res, 404, 'Không tìm thấy nhân viên');

    var days = Array.isArray(body.days) ? body.days : [];
    var saved = 0;
    for (var i = 0; i < days.length; i += 1) {
      var item = days[i] || {};
      var date = normalizeDate(item.ngay_cham_cong);
      if (!date) continue;
      var dongY = item.dong_y === true || item.dong_y === 'true' || item.dong_y === 1 || item.dong_y === '1';
      if (!dongY) {
        await ChamCongMoiBanGhi.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        });
        continue;
      }
      var gioVao = cleanTime(item.gio_vao);
      var gioRa = cleanTime(item.gio_ra);
      if (gioVao === null || gioRa === null) {
        return jsonError(res, 400, 'Giờ chấm công không hợp lệ. Dùng định dạng HH:mm');
      }
      var ghiChu = String(item.ghi_chu || '').trim();
      if (!gioVao && !gioRa && !ghiChu) {
        await ChamCongMoiBanGhi.deleteOne({
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        });
        continue;
      }
      await ChamCongMoiBanGhi.findOneAndUpdate(
        {
          cua_hang_id: storeId,
          nhan_vien_id: employeeId,
          ngay_cham_cong: date
        },
        {
          $set: {
            gio_vao: gioVao,
            gio_ra: gioRa,
            dong_y: true,
            ghi_chu: ghiChu
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      saved += 1;
    }

    return res.json({ success: true, saved: saved });
  } catch (error) {
    next(error);
  }
};

module.exports = { apiWeekOld, apiSaveWeekOld };

