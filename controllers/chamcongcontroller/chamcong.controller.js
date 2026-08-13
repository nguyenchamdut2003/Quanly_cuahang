const {
  NhanVien,
  PhongBan,
  ChucDanh,
  DanhMucKhoanNop
} = require('../../models/chamcong.model');

function getCurrentStoreId(req, res) {
  if (res.locals.currentStore && res.locals.currentStore._id) {
    return String(res.locals.currentStore._id);
  }

  if (req.session && req.session.cua_hang_id) {
    return String(req.session.cua_hang_id);
  }

  if (req.user && req.user.cua_hang_id) {
    return String(req.user.cua_hang_id._id || req.user.cua_hang_id);
  }

  return '';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateKey(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

exports.index = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var activeTab = String(req.query.tab || '').trim();
    var keyword = String(req.query.keyword || '').trim();
    var keywordRegex = keyword ? new RegExp(escapeRegex(keyword), 'i') : null;

    var employeeQuery = {
      cua_hang_id: storeId,
      trang_thai: 'dang_lam_viec'
    };
    var phongBanQuery = { cua_hang_id: storeId };
    var chucDanhQuery = { cua_hang_id: storeId };
    var khoanNopQuery = { cua_hang_id: storeId };

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
        { ten_khoan: keywordRegex },
        { nhom_khoan: keywordRegex },
        { loai_khoan: keywordRegex },
        { noi_nop: keywordRegex },
        { mo_ta: keywordRegex }
      ];
    }

    var employees = await NhanVien.find(employeeQuery)
      .select('ma_nhan_vien ten_nhan_vien')
      .sort({ ma_nhan_vien: 1, ten_nhan_vien: 1 })
      .lean();

    var phongBans = await PhongBan.find(phongBanQuery)
      .sort({ trang_thai: 1, ma_phong_ban: 1, ten_phong_ban: 1 })
      .lean();

    var chucDanhs = await ChucDanh.find(chucDanhQuery)
      .sort({ trang_thai: 1, ma_chuc_danh: 1, ten_chuc_danh: 1 })
      .lean();

    var danhMucKhoanNops = await DanhMucKhoanNop.find(khoanNopQuery)
      .sort({ thu_tu_hien_thi: 1, ma_khoan: 1, ten_khoan: 1 })
      .lean();

    var selectedEmployeeId = String(req.query.nhan_vien_id || req.query.employee || '');
    if (!selectedEmployeeId && employees.length) {
      selectedEmployeeId = String(employees[0]._id);
    }

    res.render('Chamcong/chamcong/index', {
      pageTitle: 'Cham cong',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      employees: employees,
      phongBans: phongBans,
      chucDanhs: chucDanhs,
      danhMucKhoanNops: danhMucKhoanNops,
      selectedEmployeeId: selectedEmployeeId,
      weekStart: formatDateKey(new Date())
    });
  } catch (error) {
    next(error);
  }
};
