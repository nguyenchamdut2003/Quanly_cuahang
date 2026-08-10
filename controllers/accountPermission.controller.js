var { NguoiDung } = require('../models/kiot.model');

var ROLE_OPTIONS = [
  { value: 'admin', label: 'Quản lý' },
  { value: 'user', label: 'Khách' }
];

exports.index = async function(req, res, next) {
  try {
    var users = await NguoiDung.find({ vai_tro: { $ne: 'super_admin' } })
      .select('email ho_ten sdt vai_tro trang_thai must_change_password created_at')
      .sort({ vai_tro: 1, email: 1 })
      .lean();

    res.render('phan-quyen/index', {
      users: users,
      roleOptions: ROLE_OPTIONS,
      success: req.query && req.query.success,
      error: req.query && req.query.error
    });
  } catch (error) {
    next(error);
  }
};

exports.updateRole = async function(req, res, next) {
  try {
    var userId = String(req.params && req.params.id || '').trim();
    var role = String(req.body && req.body.vai_tro || '').trim();
    var allowed = ROLE_OPTIONS.some(function(item) { return item.value === role; });
    if (!allowed) return res.redirect('/phan-quyen-tai-khoan?error=invalid_role');

    var targetUser = await NguoiDung.findById(userId).select('vai_tro').lean();
    if (!targetUser) return res.redirect('/phan-quyen-tai-khoan?error=user_not_found');
    if (targetUser.vai_tro === 'super_admin') {
      return res.redirect('/phan-quyen-tai-khoan?error=super_admin_locked');
    }

    await NguoiDung.findByIdAndUpdate(userId, { vai_tro: role });
    res.redirect('/phan-quyen-tai-khoan?success=updated');
  } catch (error) {
    next(error);
  }
};
