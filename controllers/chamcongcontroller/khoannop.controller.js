const {
  DanhMucKhoanNop,
  NoiNopKhoanNop
} = require('../../models/chamcong.model');

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

function normalizeStatus(value) {
  return TRANG_THAI_VALUES.includes(value) ? value : 'active';
}

function normalizeRate(value) {
  var number = Number(String(value == null ? '' : value).replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) return 0;
  return number;
}

function removeVietnameseTone(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function makeBaseCodeFromName(name, fallback) {
  var words = removeVietnameseTone(name)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  var code = words.map(function(word) { return word.charAt(0); }).join('');
  if (!code && words[0]) code = words[0].slice(0, 6);
  return code || fallback;
}

async function makeUniqueCode(Model, storeId, field, name, fallback) {
  var base = makeBaseCodeFromName(name, fallback);
  var code = base;
  var index = 1;

  while (await Model.exists({ cua_hang_id: storeId, [field]: code })) {
    index += 1;
    code = base + index;
  }

  return code;
}

function normalizeDanhMucPayload(body) {
  var tiLeNld = body.ti_le_nld != null ? body.ti_le_nld : body.ti_le;
  return {
    ten_khoan: String(body.ten_khoan || '').trim(),
    noi_nop_id: String(body.noi_nop_id || '').trim(),
    ti_le_nld: normalizeRate(tiLeNld),
    ti_le_nsdld: normalizeRate(body.ti_le_nsdld),
    ti_le: normalizeRate(tiLeNld),
    trang_thai: normalizeStatus(body.trang_thai)
  };
}

function normalizeNoiNopPayload(body) {
  return {
    ma_noi_nop: String(body.ma_noi_nop || '').trim().toUpperCase(),
    ten_noi_nop: String(body.ten_noi_nop || '').trim(),
    trang_thai: normalizeStatus(body.trang_thai)
  };
}

async function loadNoiNops(storeId) {
  return NoiNopKhoanNop.find({ cua_hang_id: storeId })
    .sort({ trang_thai: 1, ma_noi_nop: 1, ten_noi_nop: 1 })
    .lean();
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
        { ten_khoan: regex }
      ];
    }

    var danhMucKhoanNops = await DanhMucKhoanNop.find(query)
      .populate('noi_nop_id', 'ma_noi_nop ten_noi_nop trang_thai')
      .sort({ ma_khoan: 1, ten_khoan: 1 })
      .lean();

    res.render('Chamcong/khoan-nop/danh-muc/index', {
      pageTitle: 'Danh mục khoản nộp',
      activeMenu: 'cham-cong',
      user: req.user,
      flash: req.query || {},
      filter: { keyword: keyword },
      danhMucKhoanNops: danhMucKhoanNops,
      noiNops: await loadNoiNops(storeId)
    });
  } catch (error) {
    next(error);
  }
};

exports.createDanhMucKhoanNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });
    }

    var payload = normalizeDanhMucPayload(req.body || {});
    if (!payload.ten_khoan) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khoản.' });
    }
    if (!payload.noi_nop_id || !isValidObjectId(payload.noi_nop_id)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nơi nộp.' });
    }

    var noiNop = await NoiNopKhoanNop.findOne({
      _id: payload.noi_nop_id,
      cua_hang_id: storeId
    }).lean();
    if (!noiNop) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nơi nộp.' });
    }

    payload.cua_hang_id = storeId;
    payload.ma_khoan = await makeUniqueCode(DanhMucKhoanNop, storeId, 'ma_khoan', payload.ten_khoan, 'KN');

    var danhMuc = await DanhMucKhoanNop.create(payload);
    danhMuc = await DanhMucKhoanNop.findById(danhMuc._id)
      .populate('noi_nop_id', 'ma_noi_nop ten_noi_nop trang_thai')
      .lean();

    res.json({
      success: true,
      message: 'Đã thêm danh mục khoản nộp.',
      data: danhMuc
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Mã khoản đã tồn tại trong cửa hàng hiện tại.' });
    }
    next(error);
  }
};

exports.updateDanhMucKhoanNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var payload = normalizeDanhMucPayload(req.body || {});
    if (!payload.ten_khoan) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khoản.' });
    }
    if (!payload.noi_nop_id || !isValidObjectId(payload.noi_nop_id)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nơi nộp.' });
    }

    var noiNop = await NoiNopKhoanNop.findOne({
      _id: payload.noi_nop_id,
      cua_hang_id: storeId
    }).lean();
    if (!noiNop) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nơi nộp.' });
    }

    var oldDoc = await DanhMucKhoanNop.findOne({ _id: id, cua_hang_id: storeId }).lean();
    if (!oldDoc) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy danh mục khoản nộp.' });
    }

    if (String(oldDoc.ten_khoan || '').trim() !== payload.ten_khoan) {
      payload.ma_khoan = await makeUniqueCode(DanhMucKhoanNop, storeId, 'ma_khoan', payload.ten_khoan, 'KN');
    }

    var danhMuc = await DanhMucKhoanNop.findOneAndUpdate(
      { _id: id, cua_hang_id: storeId },
      { $set: payload },
      { new: true, runValidators: true }
    )
      .populate('noi_nop_id', 'ma_noi_nop ten_noi_nop trang_thai');

    res.json({
      success: true,
      message: 'Đã cập nhật danh mục khoản nộp.',
      data: danhMuc
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Mã khoản đã tồn tại trong cửa hàng hiện tại.' });
    }
    next(error);
  }
};

exports.updateTrangThaiDanhMuc = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    var id = String(req.params.id || '').trim();
    if (!storeId || !id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    }

    var danhMuc = await DanhMucKhoanNop.findOne({ _id: id, cua_hang_id: storeId });
    if (!danhMuc) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy danh mục khoản nộp.' });
    }

    var nextStatus = normalizeStatus(req.body && req.body.trang_thai);
    danhMuc.trang_thai = nextStatus;
    await danhMuc.save();

    res.json({
      success: true,
      message: nextStatus === 'active'
        ? 'Đã kích hoạt danh mục khoản nộp.'
        : 'Đã ngừng sử dụng danh mục khoản nộp.',
      data: danhMuc
    });
  } catch (error) {
    next(error);
  }
};

exports.createNoiNop = async function(req, res, next) {
  try {
    var storeId = getCurrentStoreId(req, res);
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng.' });
    }

    var payload = normalizeNoiNopPayload(req.body || {});
    if (!payload.ten_noi_nop) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên nơi nộp.' });
    }
    if (!payload.ma_noi_nop) {
      payload.ma_noi_nop = await makeUniqueCode(NoiNopKhoanNop, storeId, 'ma_noi_nop', payload.ten_noi_nop, 'NN');
    }

    payload.cua_hang_id = storeId;
    var noiNop = await NoiNopKhoanNop.create(payload);
    res.json({
      success: true,
      message: 'Đã thêm nơi nộp.',
      data: noiNop
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Mã nơi nộp đã tồn tại trong cửa hàng hiện tại.' });
    }
    next(error);
  }
};
