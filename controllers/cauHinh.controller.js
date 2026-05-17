var { DoanhNghiep } = require('../models/kiot.model');

function normalizeBusinessPayload(body) {
  body = body || {};
  var status = String(body.trang_thai || 'active').trim();
  if (['active', 'inactive'].indexOf(status) < 0) status = 'active';
  return {
    ten_doanh_nghiep: String(body.ten_doanh_nghiep || '').trim(),
    ma_so_thue: String(body.ma_so_thue || '').trim(),
    dia_chi: String(body.dia_chi || '').trim(),
    so_dien_thoai: String(body.so_dien_thoai || '').trim(),
    email: String(body.email || '').trim(),
    nguoi_dai_dien: String(body.nguoi_dai_dien || '').trim(),
    chuc_vu_nguoi_dai_dien: String(body.chuc_vu_nguoi_dai_dien || '').trim(),
    trang_thai: status
  };
}

async function loadBusiness() {
  var business = await DoanhNghiep.findOne({ trang_thai: 'active' }).sort({ updated_at: -1, created_at: -1 }).lean();
  if (business) return business;
  return DoanhNghiep.findOne({}).sort({ updated_at: -1, created_at: -1 }).lean();
}

exports.businessPage = async function(req, res, next) {
  try {
    var business = await loadBusiness();
    res.render('cau-hinh/doanh-nghiep', {
      title: 'Cấu hình doanh nghiệp',
      pageTitle: 'Cấu hình doanh nghiệp',
      activeMenu: 'cau-hinh',
      user: req.user,
      flash: req.query || {},
      business: business || {}
    });
  } catch (error) {
    next(error);
  }
};

exports.saveBusiness = async function(req, res, next) {
  try {
    var payload = normalizeBusinessPayload(req.body);
    var id = String(req.body && req.body.id || '').trim();
    if (id) {
      await DoanhNghiep.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
    } else {
      await DoanhNghiep.create(payload);
    }
    res.redirect('/cau-hinh/doanh-nghiep?success=saved');
  } catch (error) {
    next(error);
  }
};
