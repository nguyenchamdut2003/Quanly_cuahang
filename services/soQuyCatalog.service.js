const mongoose = require('mongoose');
const {
  SoQuy,
  PhieuThuChi,
  PhieuTraHangNhap
} = require('../models/kiot.model');

const CASH_BOOK_TYPES = ['tien_mat', 'chuyen_khoan'];
const CASH_BOOK_STATUSES = ['active', 'inactive'];
const CASH_BOOK_CASH_NAME = 'Tiền mặt';
const EMPTY_BANK_INFO = {
  ten_ngan_hang: '',
  so_tai_khoan: '',
  chu_tai_khoan: '',
  chi_nhanh_ngan_hang: ''
};

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function toObjectId(value) {
  return isObjectId(value) ? new mongoose.Types.ObjectId(String(value).trim()) : null;
}

function normalizeString(value) {
  var raw = String(value == null ? '' : value).trim();
  if (raw === 'undefined' || raw === 'null') return '';
  return raw;
}

function normalizeBankAccountNumber(value) {
  return normalizeString(value).replace(/\s+/g, '');
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeCashBookType(value) {
  var type = normalizeString(value || 'tien_mat');
  if (CASH_BOOK_TYPES.indexOf(type) < 0) {
    var error = new Error('Loại sổ quỹ không hợp lệ.');
    error.statusCode = 400;
    throw error;
  }
  return type;
}

function normalizeCashBookStatus(value) {
  return normalizeString(value) === 'inactive' ? 'inactive' : 'active';
}

function normalizeBankInfo(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    ten_ngan_hang: normalizeString(raw.ten_ngan_hang),
    so_tai_khoan: normalizeBankAccountNumber(raw.so_tai_khoan),
    chu_tai_khoan: normalizeString(raw.chu_tai_khoan),
    chi_nhanh_ngan_hang: normalizeString(raw.chi_nhanh_ngan_hang)
  };
}

function buildCashBookDisplayName(payload) {
  if (payload.loai_so_quy === 'chuyen_khoan') {
    return payload.thong_tin_ngan_hang.ten_ngan_hang + ' - ' + payload.thong_tin_ngan_hang.so_tai_khoan;
  }
  return CASH_BOOK_CASH_NAME;
}

function normalizeCashBookPayload(body) {
  body = body || {};
  var type = normalizeCashBookType(body.loai_so_quy || 'tien_mat');
  var status = normalizeCashBookStatus(body.trang_thai);
  var bankInfo = type === 'chuyen_khoan' ? normalizeBankInfo(body.thong_tin_ngan_hang) : Object.assign({}, EMPTY_BANK_INFO);

  if (type === 'chuyen_khoan') {
    if (!bankInfo.ten_ngan_hang) {
      var bankNameError = new Error('Vui lòng nhập tên ngân hàng.');
      bankNameError.statusCode = 400;
      throw bankNameError;
    }
    if (!bankInfo.so_tai_khoan) {
      var bankAccountError = new Error('Vui lòng nhập số tài khoản.');
      bankAccountError.statusCode = 400;
      throw bankAccountError;
    }
    if (!bankInfo.chu_tai_khoan) {
      var accountOwnerError = new Error('Vui lòng nhập chủ tài khoản.');
      accountOwnerError.statusCode = 400;
      throw accountOwnerError;
    }
  }

  var payload = {
    loai_so_quy: type,
    mac_dinh: status === 'inactive' ? false : normalizeBoolean(body.mac_dinh),
    thong_tin_ngan_hang: bankInfo,
    trang_thai: status
  };
  payload.ten_so_quy = buildCashBookDisplayName(payload);
  return payload;
}

function scopeFilter(loaiSoQuy) {
  return { loai_so_quy: loaiSoQuy };
}

async function clearOtherDefaultCashBooks(params) {
  var filter = Object.assign({}, scopeFilter(params.loaiSoQuy), {
    mac_dinh: true
  });
  if (params.excludeId) filter._id = { $ne: params.excludeId };
  var update = SoQuy.updateMany(filter, { $set: { mac_dinh: false } });
  if (params.session) update = update.session(params.session);
  return update;
}

async function ensureNoDuplicateBankAccount(payload, excludeId) {
  if (payload.loai_so_quy !== 'chuyen_khoan') return;
  var query = {
    loai_so_quy: 'chuyen_khoan',
    'thong_tin_ngan_hang.so_tai_khoan': payload.thong_tin_ngan_hang.so_tai_khoan
  };
  if (excludeId) query._id = { $ne: excludeId };
  var exists = await SoQuy.exists(query);
  if (exists) {
    var error = new Error('Số tài khoản này đã tồn tại trong hệ thống.');
    error.statusCode = 400;
    throw error;
  }
}

async function ensureNoDuplicateCashBookName(payload, excludeId) {
  var query = Object.assign({}, scopeFilter(payload.loai_so_quy), {
    ten_so_quy: payload.ten_so_quy
  });
  if (excludeId) query._id = { $ne: excludeId };
  var exists = await SoQuy.exists(query);
  if (exists) {
    var error = new Error(payload.loai_so_quy === 'tien_mat'
      ? 'Sổ tiền mặt đã tồn tại trong hệ thống.'
      : 'Sổ quỹ này đã tồn tại trong hệ thống.');
    error.statusCode = 400;
    throw error;
  }
}

async function cashBookHasTransactions(soQuyId) {
  var id = toObjectId(soQuyId);
  if (!id) return false;
  var [receipt, supplierReturn] = await Promise.all([
    PhieuThuChi.exists({
      $or: [
        { so_quy_id: id },
        { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': id },
        { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': id }
      ]
    }),
    PhieuTraHangNhap.exists({
      $or: [
        { so_quy_id: id },
        { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': id },
        { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': id }
      ]
    })
  ]);
  return Boolean(receipt || supplierReturn);
}

function formatCashBook(row, balances) {
  row = row && row.toObject ? row.toObject() : (row || {});
  var id = String(row._id || '');
  var balance = balances && balances[id] ? balances[id] : { tong_thu: 0, tong_chi: 0, so_du_tinh_toan: 0 };
  return {
    _id: row._id,
    ten_so_quy: row.ten_so_quy || '',
    loai_so_quy: row.loai_so_quy || 'tien_mat',
    mac_dinh: Boolean(row.mac_dinh),
    thong_tin_ngan_hang: Object.assign({}, EMPTY_BANK_INFO, row.thong_tin_ngan_hang || {}),
    trang_thai: row.trang_thai || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
    tong_thu: balance.tong_thu || 0,
    tong_chi: balance.tong_chi || 0,
    so_du_tinh_toan: balance.so_du_tinh_toan || 0
  };
}

function buildListFilter(query) {
  query = query || {};
  var filter = {};
  var status = normalizeString(query.trang_thai || (query.activeOnly ? 'active' : 'all'));
  if (status && status !== 'all') {
    if (CASH_BOOK_STATUSES.indexOf(status) < 0) {
      var statusError = new Error('Trạng thái sổ quỹ không hợp lệ.');
      statusError.statusCode = 400;
      throw statusError;
    }
    filter.trang_thai = status;
  }
  var type = normalizeString(query.loai_so_quy);
  if (type) filter.loai_so_quy = normalizeCashBookType(type);
  if (query.mac_dinh !== undefined && query.mac_dinh !== 'all') filter.mac_dinh = normalizeBoolean(query.mac_dinh);
  return filter;
}

async function listCashBooks(params) {
  var filter = buildListFilter(params && params.query);
  var rows = await SoQuy.find(filter)
    .select('ten_so_quy loai_so_quy mac_dinh thong_tin_ngan_hang trang_thai created_at updated_at')
    .sort({ mac_dinh: -1, loai_so_quy: 1, ten_so_quy: 1 })
    .lean();
  return rows;
}

async function createCashBook(params) {
  var payload = normalizeCashBookPayload(params.body);

  await ensureNoDuplicateCashBookName(payload);
  await ensureNoDuplicateBankAccount(payload);
  if (payload.mac_dinh) {
    await clearOtherDefaultCashBooks({
      loaiSoQuy: payload.loai_so_quy
    });
  }

  var row = await SoQuy.create(payload);
  return row;
}

async function updateCashBook(params) {
  var id = params.id;
  if (!isObjectId(id)) {
    var idError = new Error('Id sổ quỹ không hợp lệ.');
    idError.statusCode = 400;
    throw idError;
  }

  var current = await SoQuy.findById(id);
  if (!current) {
    var notFound = new Error('Không tìm thấy sổ quỹ.');
    notFound.statusCode = 404;
    throw notFound;
  }

  var body = params.body || {};
  var currentBankInfo = current.thong_tin_ngan_hang && current.thong_tin_ngan_hang.toObject
    ? current.thong_tin_ngan_hang.toObject()
    : (current.thong_tin_ngan_hang || {});
  var updateInput = Object.assign({}, body, {
    loai_so_quy: Object.prototype.hasOwnProperty.call(body, 'loai_so_quy') ? body.loai_so_quy : current.loai_so_quy,
    mac_dinh: Object.prototype.hasOwnProperty.call(body, 'mac_dinh') ? body.mac_dinh : current.mac_dinh,
    trang_thai: Object.prototype.hasOwnProperty.call(body, 'trang_thai') ? body.trang_thai : current.trang_thai,
    thong_tin_ngan_hang: Object.assign(
      {},
      currentBankInfo,
      body.thong_tin_ngan_hang && typeof body.thong_tin_ngan_hang === 'object' ? body.thong_tin_ngan_hang : {}
    )
  });
  var payload = normalizeCashBookPayload(updateInput);

  if (String(current.loai_so_quy || 'tien_mat') !== payload.loai_so_quy && await cashBookHasTransactions(current._id)) {
    var typeError = new Error('Sổ quỹ đã có phát sinh, không thể thay đổi loại sổ.');
    typeError.statusCode = 400;
    throw typeError;
  }

  await ensureNoDuplicateCashBookName(payload, current._id);
  await ensureNoDuplicateBankAccount(payload, current._id);
  if (payload.mac_dinh) {
    await clearOtherDefaultCashBooks({
      loaiSoQuy: payload.loai_so_quy,
      excludeId: current._id
    });
  }

  Object.assign(current, payload);
  await current.save();
  return current;
}

function userMessageFromMongoError(error) {
  if (!error) return 'Không xử lý được sổ quỹ.';
  if (error.statusCode) return error.message;
  if (error.code === 11000) {
    var key = error.keyPattern || {};
    if (key['thong_tin_ngan_hang.so_tai_khoan']) return 'Số tài khoản này đã tồn tại trong hệ thống.';
    if (key.mac_dinh || key.loai_so_quy) return 'Mỗi loại sổ chỉ được có một sổ mặc định trong hệ thống.';
    return 'Sổ quỹ này đã tồn tại trong hệ thống.';
  }
  if (error.name === 'CastError') return 'Id sổ quỹ không hợp lệ.';
  if (error.name === 'ValidationError') return 'Dữ liệu sổ quỹ không hợp lệ.';
  return error.message || 'Không xử lý được sổ quỹ.';
}

module.exports = {
  CASH_BOOK_CASH_NAME,
  EMPTY_BANK_INFO,
  normalizeCashBookPayload,
  buildCashBookDisplayName,
  normalizeBankAccountNumber,
  clearOtherDefaultCashBooks,
  cashBookHasTransactions,
  formatCashBook,
  listCashBooks,
  createCashBook,
  updateCashBook,
  userMessageFromMongoError,
  isObjectId
};
