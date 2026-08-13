const { DanhMucKhoanNop } = require('../../models/chamcong.model');

const NHOM_KHOAN_VALUES = ['thue', 'bao_hiem', 'cong_doan', 'khac'];
const LOAI_KHOAN_VALUES = ['thue_tncn', 'bhxh', 'bhyt', 'bhtn', 'cong_doan', 'khac'];
const NOI_NOP_VALUES = ['co_quan_thue', 'co_quan_bhxh', 'lien_doan_lao_dong', 'khac'];
const TRANG_THAI_VALUES = ['active', 'inactive'];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function isValidObjectId(value) {
  return DanhMucKhoanNop.db.base.Types.ObjectId.isValid(String(value || ''));
}

function normalizeEnum(value, allowedValues, fallback) {
  var normalized = String(value || '').trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function normalizeOrder(value) {
  var number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizePayload(body) {
  return {
    ma_khoan: String(body.ma_khoan || '').trim().toUpperCase(),
    ten_khoan: String(body.ten_khoan || '').trim(),
    nhom_khoan: normalizeEnum(body.nhom_khoan, NHOM_KHOAN_VALUES, ''),
    loai_khoan: normalizeEnum(body.loai_khoan, LOAI_KHOAN_VALUES, ''),
    noi_nop: normalizeEnum(body.noi_nop, NOI_NOP_VALUES, ''),
    mo_ta: String(body.mo_ta || '').trim(),
    thu_tu_hien_thi: normalizeOrder(body.thu_tu_hien_thi),
    trang_thai: normalizeEnum(body.trang_thai, TRANG_THAI_VALUES, 'active')
  };
}

function validatePayload(payload) {
  if (!payload.ma_khoan) return 'Vui long nhap ma khoan.';
  if (!payload.ten_khoan) return 'Vui long nhap ten khoan.';
  if (!payload.nhom_khoan) return 'Vui long chon nhom khoan.';
  if (!payload.loai_khoan) return 'Vui long chon loai khoan.';
  if (!payload.noi_nop) return 'Vui long chon noi nop.';
  return '';
}

function handleDuplicateCode(res) {
  return res.status(409).json({
    success: false,
    message: 'Ma khoan da ton tai trong cua hang hien tai.'
  });
}

exports.getDanhMucKhoanNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var keyword = String(req.query.keyword || '').trim();
    var query = { cua_hang_id: storeId };

    if (keyword) {
      var regex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { ma_khoan: regex },
        { ten_khoan: regex },
        { nhom_khoan: regex },
        { loai_khoan: regex },
        { noi_nop: regex },
        { mo_ta: regex }
      ];
    }

    var danhMucKhoanNops = await DanhMucKhoanNop.find(query)
      .sort({ thu_tu_hien_thi: 1, ma_khoan: 1, ten_khoan: 1 })
      .lean();

    res.render('Chamcong/khoan-nop/danh-muc/index', {
      pageTitle: 'Danh muc khoan nop',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      danhMucKhoanNops: danhMucKhoanNops
    });
  } catch (error) {
    next(error);
  }
};

exports.createDanhMucKhoanNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chua chon cua hang.' });
    }

    var payload = normalizePayload(req.body || {});
    var validationMessage = validatePayload(payload);
    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    payload.cua_hang_id = storeId;

    var danhMuc = await DanhMucKhoanNop.create(payload);
    res.json({
      success: true,
      message: 'Da them danh muc khoan nop.',
      data: danhMuc
    });
  } catch (error) {
    if (error && error.code === 11000) return handleDuplicateCode(res);
    next(error);
  }
};

exports.updateDanhMucKhoanNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var payload = normalizePayload(req.body || {});
    var validationMessage = validatePayload(payload);
    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }

    var danhMuc = await DanhMucKhoanNop.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!danhMuc) {
      return res.status(404).json({ success: false, message: 'Khong tim thay danh muc khoan nop.' });
    }

    res.json({
      success: true,
      message: 'Da cap nhat danh muc khoan nop.',
      data: danhMuc
    });
  } catch (error) {
    if (error && error.code === 11000) return handleDuplicateCode(res);
    next(error);
  }
};

exports.updateTrangThaiDanhMuc = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var danhMuc = await DanhMucKhoanNop.findOne({ _id: id, cua_hang_id: storeId });
    if (!danhMuc) {
      return res.status(404).json({ success: false, message: 'Khong tim thay danh muc khoan nop.' });
    }

    var nextStatus = normalizeEnum(req.body && req.body.trang_thai, TRANG_THAI_VALUES, '');
    if (!nextStatus) {
      nextStatus = danhMuc.trang_thai === 'active' ? 'inactive' : 'active';
    }

    danhMuc.trang_thai = nextStatus;
    await danhMuc.save();

    res.json({
      success: true,
      message: nextStatus === 'active'
        ? 'Da kich hoat danh muc khoan nop.'
        : 'Da ngung su dung danh muc khoan nop.',
      data: danhMuc
    });
  } catch (error) {
    next(error);
  }
};
