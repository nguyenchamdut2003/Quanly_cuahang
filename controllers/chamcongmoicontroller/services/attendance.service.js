const { ChamCongMoiNhanVien, ChamCongMoiBanGhi, ChamCongMoiThang } = require('../../../models/chamcongmoi.model');
const {
  pad2, normalizeDate, formatDate, addDays, todayUtc, minDate, formatMonth, normalizeMonth, addMonths, monthLabel
} = require('../helpers/date.helper');
const { uniqueValues, cleanTime, toBoolean } = require('../helpers/common.helper');
const { serializeEmployee } = require('../helpers/employee.helper');
const { getPayrollMap, rebuildPayrolls } = require('./payroll.service');

async function getEmployeeAttendanceView(storeId, employeeId, query) {

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) throw Object.assign(new Error('Không tìm thấy nhân viên'), { status: 404 });
    employee = serializeEmployee(employee);

    var hasMonthSalary = employee.co_luong_theo_thang === true;
    var hasDaySalary = employee.co_luong_theo_ngay === true;
    var mode = hasMonthSalary && hasDaySalary
      ? 'ca_hai'
      : (hasMonthSalary ? 'thang' : 'ngay');

    var response = {
      success: true,
      mode: mode,
      employee: employee,
      has_day_salary: hasDaySalary,
      has_month_salary: hasMonthSalary
    };

    if (hasMonthSalary) {
      var currentMonth = new Date(Date.UTC(todayUtc().getUTCFullYear(), todayUtc().getUTCMonth(), 1));
      var monthStartDate = normalizeMonth(query.month_start) || addMonths(currentMonth, -6);
      var latestStart = addMonths(currentMonth, -6);
      if (monthStartDate.getTime() > latestStart.getTime()) monthStartDate = latestStart;
      var monthKeys = [];
      for (var mi = 0; mi < 7; mi += 1) {
        var monthDate = addMonths(monthStartDate, mi);
        if (monthDate.getTime() > currentMonth.getTime()) break;
        monthKeys.push(formatMonth(monthDate));
      }

      var monthRecords = await ChamCongMoiThang.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        thang_cham_cong: { $in: monthKeys }
      }).lean();
      var byMonth = {};
      monthRecords.forEach(function(item) {
        byMonth[item.thang_cham_cong] = item;
      });
      var payrollByMonth = await getPayrollMap(storeId, employeeId, monthKeys);

      response.month_range = {
        tu_thang: monthKeys[0] || formatMonth(monthStartDate),
        den_thang: monthKeys[monthKeys.length - 1] || formatMonth(currentMonth)
      };
      response.months = monthKeys.map(function(key) {
        var record = byMonth[key] || {};
        var hasAttendance = !!(record._id || record.dong_y);
        return {
          key: key,
          label: monthLabel(key),
          is_current: key === formatMonth(currentMonth),
          dong_y: hasAttendance,
          ghi_chu: record.ghi_chu || '',
          payroll: hasAttendance ? (payrollByMonth[key + ':thang'] || null) : null
        };
      });
    }

    if (hasDaySalary || !hasMonthSalary) {
      var today = todayUtc();
      var weekStartDate = normalizeDate(query.week_start) || addDays(today, -6);
      var latestWeekStart = addDays(today, -6);
      if (weekStartDate.getTime() > latestWeekStart.getTime()) weekStartDate = latestWeekStart;
      var weekEndDate = minDate(addDays(weekStartDate, 6), today);
      var dayRecords = await ChamCongMoiBanGhi.find({
        cua_hang_id: storeId,
        nhan_vien_id: employeeId,
        ngay_cham_cong: { $gte: weekStartDate, $lte: weekEndDate }
      }).lean();

      var byDate = {};
      dayRecords.forEach(function(item) {
        byDate[formatDate(item.ngay_cham_cong)] = item;
      });

      var days = [];
      var labels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
      var todayKey = formatDate(today);
      var totalDays = Math.floor((weekEndDate.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      var dayMonthKeys = [];
      for (var pm = 0; pm < totalDays; pm += 1) {
        dayMonthKeys.push(formatMonth(addDays(weekStartDate, pm)));
      }
      var payrollByDayMonth = await getPayrollMap(storeId, employeeId, dayMonthKeys);
      for (var i = 0; i < totalDays; i += 1) {
        var date = addDays(weekStartDate, i);
        var key = formatDate(date);
        var record = byDate[key] || {};
        var dayIndex = date.getUTCDay();
        var labelIndex = dayIndex === 0 ? 6 : dayIndex - 1;
        var hasAttendance = !!(record._id || record.dong_y);
        days.push({
          key: key,
          label: labels[labelIndex],
          day: pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1),
          is_today: key === todayKey,
          gio_vao: record.gio_vao || '08:00',
          gio_ra: record.gio_ra || '17:30',
          dong_y: hasAttendance,
          ghi_chu: record.ghi_chu || '',
          payroll: hasAttendance ? (payrollByDayMonth[formatMonth(date) + ':ngay'] || null) : null
        });
      }

      response.week = {
        tu_ngay: formatDate(weekStartDate),
        den_ngay: formatDate(weekEndDate)
      };
      response.days = days;
    }

    return response;
}

async function saveEmployeeAttendance(storeId, employeeId, body) {

    var employee = await ChamCongMoiNhanVien.findOne({
      _id: employeeId,
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).lean();
    if (!employee) throw Object.assign(new Error('Không tìm thấy nhân viên'), { status: 404 });
    employee = serializeEmployee(employee);

    var warnings = [];
    var changedMonths = [];
    var savedDays = 0;
    var savedMonths = 0;

    if (employee.co_luong_theo_thang) {
      var months = Array.isArray(body.months) ? body.months : [];
      for (var mi = 0; mi < months.length; mi += 1) {
        var monthItem = months[mi] || {};
        var monthDate = normalizeMonth(monthItem.thang_cham_cong);
        if (!monthDate) continue;
        var monthKey = formatMonth(monthDate);
        changedMonths.push(monthKey);
        var dongYThang = toBoolean(monthItem.dong_y);
        if (!dongYThang) {
          await ChamCongMoiThang.deleteOne({
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            thang_cham_cong: monthKey
          });
          continue;
        }
        await ChamCongMoiThang.findOneAndUpdate(
          {
            cua_hang_id: storeId,
            nhan_vien_id: employeeId,
            thang_cham_cong: monthKey
          },
          {
            $set: {
              dong_y: true,
              ghi_chu: String(monthItem.ghi_chu || '').trim()
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );
        savedMonths += 1;
      }
      if (!Number(employee.luong_theo_thang || 0)) {
        warnings.push({
          message: 'Đã lưu chấm công tháng. Vào tab Nhân viên → Sửa để cấu hình lương/tháng, sau đó bảng lương sẽ tự tính tiền.'
        });
      }
    }

    if (employee.co_luong_theo_ngay || !employee.co_luong_theo_thang) {
      var days = Array.isArray(body.days) ? body.days : [];
      var today = todayUtc();
      for (var i = 0; i < days.length; i += 1) {
        var item = days[i] || {};
        var date = normalizeDate(item.ngay_cham_cong);
        if (!date || date.getTime() > today.getTime()) continue;
        changedMonths.push(formatMonth(date));
        var dongY = toBoolean(item.dong_y);
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
          throw Object.assign(new Error('Giờ chấm công không hợp lệ ở ngày ' + formatDate(date) + '. Dùng định dạng HH:mm'), { status: 400 });
        }
        if (!gioVao) gioVao = '08:00';
        if (!gioRa) gioRa = '17:30';
        var ghiChu = String(item.ghi_chu || '').trim();
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
        savedDays += 1;
      }
      if (employee.co_luong_theo_ngay && !Number(employee.luong_theo_ngay || 0)) {
        warnings.push({
          message: 'Đã lưu ngày công. Vào tab Nhân viên → Sửa để cấu hình lương/ngày, sau đó bảng lương sẽ tự tính tiền.'
        });
      }
    }

    changedMonths = uniqueValues(changedMonths);
    var existingPayrolls = await getPayrollMap(storeId, employeeId, changedMonths);
    Object.keys(existingPayrolls).forEach(function(key) {
      warnings.push(existingPayrolls[key]);
    });
    await rebuildPayrolls(storeId, employee, changedMonths);
    return {
      success: true,
      saved: savedDays + savedMonths,
      saved_days: savedDays,
      saved_months: savedMonths,
      warnings: warnings
    };
}

module.exports = { getEmployeeAttendanceView, saveEmployeeAttendance };
