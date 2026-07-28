var {
  NhanVien,
  CaLamViec,
  LichLamViec,
  ChamCong,
  BangLuong,
  NgayLamViecCuaHang
} = require('../../models/hr.model');
var { resolveStoreId } = require('../../utils/storeScope');

function action(href, label) {
  return { href: href, label: label };
}

function buildStep(key, title, description, done, blocked, actionData, detailHref) {
  return {
    key: key,
    title: title,
    description: description,
    done: !!done,
    blocked: !!blocked,
    action: actionData,
    detailHref: detailHref || ''
  };
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');

    var [
      employeeCount,
      activeEmployeeCount,
      shiftCount,
      scheduleCount,
      attendanceCount,
      salaryConfiguredCount,
      payrollCount,
      workDayConfigCount
    ] = await Promise.all([
      NhanVien.countDocuments({ cua_hang_id: storeId }),
      NhanVien.countDocuments({ cua_hang_id: storeId, trang_thai: 'dang_lam_viec' }),
      CaLamViec.countDocuments({ cua_hang_id: storeId, trang_thai: 'active' }),
      LichLamViec.countDocuments({ cua_hang_id: storeId, trang_thai: 'scheduled' }),
      ChamCong.countDocuments({ cua_hang_id: storeId }),
      NhanVien.countDocuments({ cua_hang_id: storeId, 'salary_setup.enabled': true }),
      BangLuong.countDocuments({ cua_hang_id: storeId }),
      NgayLamViecCuaHang.countDocuments({ cua_hang_id: storeId, trang_thai: 'active' })
    ]);

    var hasEmployee = activeEmployeeCount > 0;
    var hasShift = shiftCount > 0;
    var hasScheduleBase = hasEmployee && hasShift;
    var hasSchedule = scheduleCount > 0;
    var hasAttendance = attendanceCount > 0;
    var hasSalary = salaryConfiguredCount > 0;
    var hasPayrollBase = hasEmployee && hasSalary;

    var quickSteps = [
      buildStep(
        'employees',
        'Thêm nhân viên',
        hasEmployee
          ? 'Cửa hàng đang có ' + activeEmployeeCount + ' nhân viên đang làm việc.'
          : 'Tạo nhân viên trước để có dữ liệu xếp ca, chấm công và tính lương.',
        hasEmployee,
        false,
        action('/nhan-vien', hasEmployee ? 'Thêm nhân viên' : 'Thêm nhân viên'),
        '/nhan-vien'
      ),
      buildStep(
        'shifts',
        'Tạo ca làm việc',
        hasShift
          ? 'Cửa hàng đang có ' + shiftCount + ' ca làm việc đang hoạt động.'
          : 'Tạo ca sáng, chiều, tối hoặc ca riêng của cửa hàng.',
        hasShift,
        false,
        action('/ca-lam-viec', hasShift ? 'Tạo ca' : 'Tạo ca'),
        '/ca-lam-viec'
      ),
      buildStep(
        'schedules',
        'Xếp lịch làm việc',
        hasSchedule
          ? 'Đã xếp lịch ' + scheduleCount + ' ca làm cho nhân viên.'
          : (hasScheduleBase ? 'Xếp ca cho nhân viên theo ngày/tuần.' : 'Cần có nhân viên và ca làm việc trước khi xếp lịch.'),
        hasSchedule,
        !hasScheduleBase,
        action('/lich-lam-viec', 'Xếp lịch'),
        '/lich-lam-viec'
      ),
      buildStep(
        'attendance',
        'Hình thức chấm công',
        hasAttendance
          ? 'Đã có ' + attendanceCount + ' bản chấm công trong hệ thống.'
          : (hasSchedule ? 'Có thể tạo/chấm công từ lịch đã xếp. Chưa có bảng cấu hình hình thức chấm công riêng trong DB.' : 'Cần xếp lịch làm việc trước khi chấm công.'),
        hasAttendance,
        !hasSchedule,
        action('/cham-cong', hasAttendance ? 'Xem chi tiết' : 'Thiết lập'),
        '/cham-cong'
      ),
      buildStep(
        'salary',
        'Thiết lập lương',
        hasSalary
          ? 'Đã thiết lập lương cho ' + salaryConfiguredCount + '/' + Math.max(employeeCount, 1) + ' nhân viên.'
          : (hasEmployee ? 'Thiết lập loại lương, mức lương, phụ cấp và giảm trừ cho nhân viên.' : 'Cần có nhân viên trước khi thiết lập lương.'),
        hasSalary,
        !hasEmployee,
        action('/nhan-vien', 'Thiết lập'),
        '/nhan-vien'
      ),
      buildStep(
        'payroll',
        'Thiết lập bảng lương',
        payrollCount > 0
          ? 'Cửa hàng đang có ' + payrollCount + ' bảng lương.'
          : (hasPayrollBase ? 'Tạo bảng lương để theo dõi và thanh toán lương nhân viên.' : 'Cần có nhân viên và thiết lập lương trước khi tạo bảng lương.'),
        payrollCount > 0,
        !hasPayrollBase,
        action('/bang-luong', payrollCount > 0 ? 'Tạo bảng lương' : 'Tạo bảng lương'),
        '/bang-luong'
      )
    ];

    var sideGroups = [
      {
        title: 'Thiết lập',
        items: [
          { key: 'init', label: 'Khởi tạo', icon: 'fa-gear', active: true, href: '/thiet-lap-nhan-vien' },
          { key: 'attendance', label: 'Chấm công', icon: 'fa-calendar-check', active: false, href: '/cham-cong', disabled: !hasSchedule },
          { key: 'payroll', label: 'Tính lương', icon: 'fa-circle-dollar-to-slot', active: false, href: '/bang-luong', disabled: !hasPayrollBase },
          { key: 'workdays', label: 'Ngày làm & Nghỉ', icon: 'fa-calendar-day', active: false, href: '/ngay-lam-nghi', done: workDayConfigCount > 0 }
        ]
      },
      {
        title: 'Tiện ích',
        items: [
          { key: 'zalo', label: 'Zalo mini app', icon: 'fa-user', active: false, href: '#', disabled: true },
          { key: 'device', label: 'Máy chấm công', icon: 'fa-fingerprint', active: false, href: '#', disabled: true }
        ]
      }
    ];

    res.render('thiet-lap-nhan-vien/index', {
      title: 'Thiết lập nhân viên',
      activeMenu: 'nhan-vien',
      activeHrPage: 'thiet-lap-nhan-vien',
      user: req.user,
      quickSteps: quickSteps,
      sideGroups: sideGroups,
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};
