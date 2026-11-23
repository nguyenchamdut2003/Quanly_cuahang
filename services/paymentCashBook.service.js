const mongoose = require('mongoose');
const { SoQuy } = require('../models/kiot.model');

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function toObjectId(value) {
  return isObjectId(value) ? new mongoose.Types.ObjectId(String(value).trim()) : null;
}

function normalizeNonNegativeMoney(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(label || 'Số tiền không hợp lệ.');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(label || 'Số tiền không hợp lệ.');
    return value;
  }
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, '').replace(/[,.]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(label || 'Số tiền không hợp lệ.');
  }
  return amount;
}

function readNested(body) {
  return body && typeof body.chi_tiet_thanh_toan === 'object' && body.chi_tiet_thanh_toan
    ? body.chi_tiet_thanh_toan
    : {};
}

function readBodyValue(body, nestedKey, flatKey) {
  const nested = readNested(body);
  if (nested[nestedKey] !== undefined) return nested[nestedKey];
  const bracketKey = 'chi_tiet_thanh_toan[' + nestedKey + ']';
  if (body && body[bracketKey] !== undefined) return body[bracketKey];
  return body ? body[flatKey] : undefined;
}

function extractPaymentDetail(body) {
  body = body || {};
  return {
    tien_mat: normalizeNonNegativeMoney(
      readBodyValue(body, 'tien_mat', 'tien_mat'),
      'Số tiền mặt không hợp lệ.'
    ),
    so_quy_tien_mat_id: String(readBodyValue(body, 'so_quy_tien_mat_id', 'so_quy_tien_mat_id') || '').trim(),
    chuyen_khoan: normalizeNonNegativeMoney(
      readBodyValue(body, 'chuyen_khoan', 'chuyen_khoan'),
      'Số tiền chuyển khoản không hợp lệ.'
    ),
    so_quy_chuyen_khoan_id: String(readBodyValue(body, 'so_quy_chuyen_khoan_id', 'so_quy_chuyen_khoan_id') || '').trim(),
    tien_tra_khach: normalizeNonNegativeMoney(
      readBodyValue(body, 'tien_tra_khach', 'tien_tra_khach'),
      'Số tiền trả khách không hợp lệ.'
    )
  };
}

function hasNonEmptyBookId(value) {
  const id = String(value ?? '').trim();
  return id !== '' && isObjectId(id);
}

function hasV2PaymentPayload(body, options) {
  body = body || {};
  options = options || {};
  const nested = readNested(body);
  const directKeys = [
    'so_quy_tien_mat_id',
    'so_quy_chuyen_khoan_id',
    'chi_tiet_thanh_toan[so_quy_tien_mat_id]',
    'chi_tiet_thanh_toan[so_quy_chuyen_khoan_id]'
  ];
  if (directKeys.some(key => hasNonEmptyBookId(body[key]))) return true;
  if (hasNonEmptyBookId(nested.so_quy_tien_mat_id)) return true;
  if (hasNonEmptyBookId(nested.so_quy_chuyen_khoan_id)) return true;
  if (!options.includeNestedAmounts) return false;
  return ['tien_mat', 'chuyen_khoan', 'tien_tra_khach'].some(key => Object.prototype.hasOwnProperty.call(nested, key) && nested[key] !== undefined);
}

function friendlyName(loaiSoQuy) {
  return loaiSoQuy === 'chuyen_khoan' ? 'tài khoản chuyển khoản' : 'sổ tiền mặt';
}

function invalidMessage(loaiSoQuy) {
  return loaiSoQuy === 'chuyen_khoan'
    ? 'Tài khoản chuyển khoản không hợp lệ.'
    : 'Sổ tiền mặt không hợp lệ.';
}

function inactiveMessage(loaiSoQuy) {
  return loaiSoQuy === 'chuyen_khoan'
    ? 'Tài khoản chuyển khoản đang ngừng hoạt động.'
    : 'Sổ tiền mặt đang ngừng hoạt động.';
}

function missingActiveMessage(loaiSoQuy) {
  return loaiSoQuy === 'chuyen_khoan'
    ? 'Chưa có tài khoản chuyển khoản đang hoạt động.'
    : 'Chưa có sổ tiền mặt đang hoạt động.';
}

function manyActiveMessage(loaiSoQuy) {
  return loaiSoQuy === 'chuyen_khoan'
    ? 'Có nhiều tài khoản chuyển khoản, vui lòng chọn tài khoản.'
    : 'Có nhiều sổ tiền mặt, vui lòng chọn sổ.';
}


function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function resolveCashBookForPayment(params) {
  const loaiSoQuy = params && params.loaiSoQuy;
  const requestedId = String(params && params.requestedId || '').trim();
  const session = params && params.session;

  if (!['tien_mat', 'chuyen_khoan'].includes(loaiSoQuy)) throw new Error('Loại sổ quỹ không hợp lệ.');

  if (requestedId) {
    if (!isObjectId(requestedId)) throw new Error(invalidMessage(loaiSoQuy));
    const row = await withSession(SoQuy.findById(requestedId), session);
    if (!row) throw new Error(invalidMessage(loaiSoQuy));
    if ((row.loai_so_quy || 'tien_mat') !== loaiSoQuy) throw new Error(invalidMessage(loaiSoQuy));
    if (row.trang_thai !== 'active') throw new Error(inactiveMessage(loaiSoQuy));
    return row;
  }

  const filter = {
    loai_so_quy: loaiSoQuy,
    trang_thai: 'active'
  };
  const rows = await withSession(
    SoQuy.find(filter).sort({ mac_dinh: -1, ten_so_quy: 1 }),
    session
  );
  if (!rows.length) throw new Error(missingActiveMessage(loaiSoQuy));
  const defaults = rows.filter(row => row.mac_dinh);
  if (defaults.length) return defaults[0];
  if (rows.length === 1) return rows[0];
  throw new Error(manyActiveMessage(loaiSoQuy));
}

function inferPaymentMethod(detail) {
  if (detail.tien_mat > 0 && detail.chuyen_khoan === 0) return 'tien_mat';
  if (detail.chuyen_khoan > 0 && detail.tien_mat === 0 && detail.tien_tra_khach === 0) return 'chuyen_khoan';
  if (detail.tien_mat > 0 && detail.chuyen_khoan > 0) return 'khac';
  if (detail.chuyen_khoan > 0 && detail.tien_tra_khach > 0) return 'khac';
  return detail.chuyen_khoan > 0 ? 'chuyen_khoan' : 'tien_mat';
}

function legacyPaymentMethod(data, cashBook) {
  const explicit = String(data.phuong_thuc_thanh_toan || '').trim();
  if (['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(explicit)) return explicit;
  return (cashBook.loai_so_quy || 'tien_mat') === 'chuyen_khoan' ? 'chuyen_khoan' : 'tien_mat';
}

function legacyDetail(amount, cashBook) {
  if ((cashBook.loai_so_quy || 'tien_mat') === 'chuyen_khoan') {
    return {
      tien_mat: 0,
      so_quy_tien_mat_id: null,
      chuyen_khoan: amount,
      so_quy_chuyen_khoan_id: cashBook._id,
      tien_tra_khach: 0
    };
  }
  return {
    tien_mat: amount,
    so_quy_tien_mat_id: cashBook._id,
    chuyen_khoan: 0,
    so_quy_chuyen_khoan_id: null,
    tien_tra_khach: 0
  };
}

function legacySoQuyId(detail) {
  const touchesCash = detail.tien_mat > 0 || detail.tien_tra_khach > 0;
  const touchesBank = detail.chuyen_khoan > 0;
  if (touchesCash && !touchesBank) return detail.so_quy_tien_mat_id || null;
  if (touchesBank && !touchesCash) return detail.so_quy_chuyen_khoan_id || null;
  return null;
}

async function buildLegacyPaymentInfo(data, options) {
  const amount = normalizeNonNegativeMoney(data.gia_tri ?? data.so_tien, 'Giá trị phiếu không hợp lệ.');
  if (amount <= 0) throw new Error('gia_tri phải lớn hơn 0');
  if (!data.so_quy_id || !isObjectId(data.so_quy_id)) throw new Error('Vui lòng chọn sổ quỹ.');
  const row = await withSession(SoQuy.findById(data.so_quy_id), options.session);
  if (!row) throw new Error('Sổ quỹ không tồn tại hoặc đã ngừng sử dụng.');
  if (row.trang_thai !== 'active') throw new Error('Sổ quỹ không tồn tại hoặc đã ngừng sử dụng.');
  const cashBook = row;
  const detail = legacyDetail(amount, cashBook);
  return {
    isV2: false,
    gia_tri: amount,
    chi_tiet_thanh_toan: detail,
    phuong_thuc_thanh_toan: legacyPaymentMethod(data, cashBook),
    so_quy_id: legacySoQuyId(detail),
    cashBook
  };
}

async function buildV2PaymentInfo(data, options) {
  const loaiPhieu = data.loai_phieu;
  const raw = extractPaymentDetail(data);
  const totalReceived = raw.tien_mat + raw.chuyen_khoan;
  let giaTri = 0;

  if (loaiPhieu === 'thu') {
    if (totalReceived <= 0) throw new Error('Tổng số tiền nhận phải lớn hơn 0.');
    if (raw.tien_tra_khach > totalReceived) throw new Error('Tiền trả khách không được lớn hơn tổng số tiền nhận.');
    giaTri = totalReceived - raw.tien_tra_khach;
    if (giaTri <= 0) throw new Error('Giá trị phiếu sau trả khách phải lớn hơn 0.');
  } else if (loaiPhieu === 'chi') {
    if (raw.tien_tra_khach > 0) throw new Error('Tiền trả khách chỉ áp dụng cho phiếu thu.');
    giaTri = totalReceived;
    if (giaTri <= 0) throw new Error('Tổng tiền chi phải lớn hơn 0.');
  } else {
    throw new Error('Loại phiếu không hợp lệ');
  }

  const needCashBook = raw.tien_mat > 0 || raw.tien_tra_khach > 0;
  const needBankBook = raw.chuyen_khoan > 0;
  const cashBook = needCashBook
    ? await resolveCashBookForPayment({
      cuaHangId: options.cuaHangId,
      chiNhanhId: options.chiNhanhId,
      loaiSoQuy: 'tien_mat',
      requestedId: raw.so_quy_tien_mat_id,
      session: options.session
    })
    : null;
  const bankBook = needBankBook
    ? await resolveCashBookForPayment({
      cuaHangId: options.cuaHangId,
      chiNhanhId: options.chiNhanhId,
      loaiSoQuy: 'chuyen_khoan',
      requestedId: raw.so_quy_chuyen_khoan_id,
      session: options.session
    })
    : null;

  const detail = {
    tien_mat: raw.tien_mat,
    so_quy_tien_mat_id: cashBook ? cashBook._id : null,
    chuyen_khoan: raw.chuyen_khoan,
    so_quy_chuyen_khoan_id: bankBook ? bankBook._id : null,
    tien_tra_khach: raw.tien_tra_khach
  };

  return {
    isV2: true,
    gia_tri: giaTri,
    chi_tiet_thanh_toan: detail,
    phuong_thuc_thanh_toan: inferPaymentMethod(detail),
    so_quy_id: legacySoQuyId(detail),
    cashBook,
    bankBook
  };
}

async function buildReceiptPaymentInfo(data, options) {
  data = data || {};
  options = options || {};
  const enabledV2 = data.payment_v2 === true || data.payment_v2 === 'true' || hasV2PaymentPayload(data);
  if (enabledV2) return buildV2PaymentInfo(data, options);
  return buildLegacyPaymentInfo(data, options);
}

module.exports = {
  normalizeNonNegativeMoney,
  extractPaymentDetail,
  hasV2PaymentPayload,
  resolveCashBookForPayment,
  inferPaymentMethod,
  buildReceiptPaymentInfo
};
