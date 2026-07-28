const { ChamCongMoiNhanVien } = require('../../models/chamcongmoi.model');
const { resolveStoreId } = require('../../utils/storeScope');
const { addDays, todayUtc, formatDate } = require('./helpers/date.helper');
const { serializeEmployee } = require('./helpers/employee.helper');

const index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.redirect('/cua-hang?error=no_store');
    var weekStart = addDays(todayUtc(), -6);
    var employees = await ChamCongMoiNhanVien.find({
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).sort({ ten_nhan_vien: 1 }).lean();

    res.render('chamcong/index', {
      title: 'Chấm công mới',
      activeMenu: 'nhan-vien',
      user: req.user,
      employees: employees.map(serializeEmployee),
      selectedEmployeeId: String(req.query.nhan_vien_id || (employees[0] && employees[0]._id) || ''),
      weekStart: formatDate(weekStart),
      flash: req.query || {}
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { index };
