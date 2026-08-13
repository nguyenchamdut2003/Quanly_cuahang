const { PhongBan, ChucDanh } = require('../../models/chamcong.model');

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
  return PhongBan.db.base.Types.ObjectId.isValid(String(value || ''));
}

function normalizeStatus(value) {
  return value === 'inactive' ? 'inactive' : 'active';
}

function normalizePhongBanPayload(body) {
  var payload = {
    ten_phong_ban: String(body.ten_phong_ban || '').trim(),
    mo_ta: String(body.mo_ta || '').trim(),
    trang_thai: normalizeStatus(body.trang_thai)
  };

  var code = String(body.ma_phong_ban || '').trim().toUpperCase();
  if (code) payload.ma_phong_ban = code;

  return payload;
}

function normalizeChucDanhPayload(body) {
  var payload = {
    ten_chuc_danh: String(body.ten_chuc_danh || '').trim(),
    mo_ta: String(body.mo_ta || '').trim(),
    trang_thai: normalizeStatus(body.trang_thai)
  };

  var code = String(body.ma_chuc_danh || '').trim().toUpperCase();
  if (code) payload.ma_chuc_danh = code;

  return payload;
}

async function makeCatalogCode(Model, storeId, codeField, prefix) {
  for (var index = 1; index < 10000; index += 1) {
    var code = prefix + String(index).padStart(3, '0');
    var exists = await Model.exists({
      cua_hang_id: storeId,
      [codeField]: code
    });

    if (!exists) return code;
  }

  return prefix + Date.now();
}

function duplicateCodeResponse(res, message) {
  return res.status(409).json({
    success: false,
    message: message
  });
}

exports.phongBanIndex = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var keyword = String(req.query.keyword || '').trim();
    var query = { cua_hang_id: storeId };

    if (keyword) {
      var regex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { ma_phong_ban: regex },
        { ten_phong_ban: regex },
        { mo_ta: regex }
      ];
    }

    var phongBans = await PhongBan.find(query)
      .sort({ trang_thai: 1, ma_phong_ban: 1, ten_phong_ban: 1 })
      .lean();

    res.render('Chamcong/phong-ban/index', {
      pageTitle: 'Phong ban',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      phongBans: phongBans
    });
  } catch (error) {
    next(error);
  }
};

exports.createPhongBan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chua chon cua hang.' });
    }

    var payload = normalizePhongBanPayload(req.body || {});
    if (!payload.ten_phong_ban) {
      return res.status(400).json({ success: false, message: 'Vui long nhap ten phong ban.' });
    }

    payload.cua_hang_id = storeId;
    if (!payload.ma_phong_ban) {
      payload.ma_phong_ban = await makeCatalogCode(PhongBan, storeId, 'ma_phong_ban', 'PB');
    }

    var phongBan = await PhongBan.create(payload);
    res.json({ success: true, message: 'Da them phong ban.', data: phongBan });
  } catch (error) {
    if (error && error.code === 11000) {
      return duplicateCodeResponse(res, 'Ma phong ban da ton tai.');
    }

    next(error);
  }
};

exports.updatePhongBan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var payload = normalizePhongBanPayload(req.body || {});
    if (!payload.ten_phong_ban) {
      return res.status(400).json({ success: false, message: 'Vui long nhap ten phong ban.' });
    }

    var update = {
      $set: {
        ten_phong_ban: payload.ten_phong_ban,
        mo_ta: payload.mo_ta,
        trang_thai: payload.trang_thai
      }
    };

    if (payload.ma_phong_ban) update.$set.ma_phong_ban = payload.ma_phong_ban;
    else update.$unset = { ma_phong_ban: '' };

    var phongBan = await PhongBan.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      update,
      { new: true, runValidators: true }
    );

    if (!phongBan) {
      return res.status(404).json({ success: false, message: 'Khong tim thay phong ban.' });
    }

    res.json({ success: true, message: 'Da cap nhat phong ban.', data: phongBan });
  } catch (error) {
    if (error && error.code === 11000) {
      return duplicateCodeResponse(res, 'Ma phong ban da ton tai.');
    }

    next(error);
  }
};

exports.inactivePhongBan = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var phongBan = await PhongBan.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { trang_thai: 'inactive' } },
      { new: true, runValidators: true }
    );

    if (!phongBan) {
      return res.status(404).json({ success: false, message: 'Khong tim thay phong ban.' });
    }

    res.json({ success: true, message: 'Da ngung su dung phong ban.', data: phongBan });
  } catch (error) {
    next(error);
  }
};

exports.chucDanhIndex = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) return res.redirect('/cua-hang?error=missing_store');

    var keyword = String(req.query.keyword || '').trim();
    var query = { cua_hang_id: storeId };

    if (keyword) {
      var regex = new RegExp(escapeRegex(keyword), 'i');
      query.$or = [
        { ma_chuc_danh: regex },
        { ten_chuc_danh: regex },
        { mo_ta: regex }
      ];
    }

    var chucDanhs = await ChucDanh.find(query)
      .sort({ trang_thai: 1, ma_chuc_danh: 1, ten_chuc_danh: 1 })
      .lean();

    res.render('Chamcong/chuc-danh/index', {
      pageTitle: 'Chuc danh',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      chucDanhs: chucDanhs
    });
  } catch (error) {
    next(error);
  }
};

exports.createChucDanh = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chua chon cua hang.' });
    }

    var payload = normalizeChucDanhPayload(req.body || {});
    if (!payload.ten_chuc_danh) {
      return res.status(400).json({ success: false, message: 'Vui long nhap ten chuc danh.' });
    }

    payload.cua_hang_id = storeId;
    if (!payload.ma_chuc_danh) {
      payload.ma_chuc_danh = await makeCatalogCode(ChucDanh, storeId, 'ma_chuc_danh', 'CD');
    }

    var chucDanh = await ChucDanh.create(payload);
    res.json({ success: true, message: 'Da them chuc danh.', data: chucDanh });
  } catch (error) {
    if (error && error.code === 11000) {
      return duplicateCodeResponse(res, 'Ma chuc danh da ton tai.');
    }

    next(error);
  }
};

exports.updateChucDanh = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var payload = normalizeChucDanhPayload(req.body || {});
    if (!payload.ten_chuc_danh) {
      return res.status(400).json({ success: false, message: 'Vui long nhap ten chuc danh.' });
    }

    var update = {
      $set: {
        ten_chuc_danh: payload.ten_chuc_danh,
        mo_ta: payload.mo_ta,
        trang_thai: payload.trang_thai
      }
    };

    if (payload.ma_chuc_danh) update.$set.ma_chuc_danh = payload.ma_chuc_danh;
    else update.$unset = { ma_chuc_danh: '' };

    var chucDanh = await ChucDanh.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      update,
      { new: true, runValidators: true }
    );

    if (!chucDanh) {
      return res.status(404).json({ success: false, message: 'Khong tim thay chuc danh.' });
    }

    res.json({ success: true, message: 'Da cap nhat chuc danh.', data: chucDanh });
  } catch (error) {
    if (error && error.code === 11000) {
      return duplicateCodeResponse(res, 'Ma chuc danh da ton tai.');
    }

    next(error);
  }
};

exports.inactiveChucDanh = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Du lieu khong hop le.' });
    }

    var chucDanh = await ChucDanh.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: { trang_thai: 'inactive' } },
      { new: true, runValidators: true }
    );

    if (!chucDanh) {
      return res.status(404).json({ success: false, message: 'Khong tim thay chuc danh.' });
    }

    res.json({ success: true, message: 'Da ngung su dung chuc danh.', data: chucDanh });
  } catch (error) {
    next(error);
  }
};
