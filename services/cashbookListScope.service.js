const { SoQuy, PhieuThuChi } = require('../models/kiot.model');

function isObjectId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

function parseMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getObjectIdStr(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function resolveCashBookFilterScope(query = {}) {
  const soQuyId = String(query.so_quy_id || 'all').trim() || 'all';
  if (!soQuyId || soQuyId === 'all') return { mode: 'all' };
  if (soQuyId === 'unassigned') return { mode: 'unassigned' };
  if (soQuyId === 'tien_mat') return { mode: 'tien_mat' };
  if (soQuyId === 'chuyen_khoan') return { mode: 'chuyen_khoan' };
  if (isObjectId(soQuyId)) return { mode: 'specific', bookId: soQuyId };
  return { mode: 'all' };
}

function hasSplitPaymentDetail(detail) {
  if (!detail || typeof detail !== 'object') return false;
  return parseMoney(detail.tien_mat) > 0
    || parseMoney(detail.chuyen_khoan) > 0
    || parseMoney(detail.tien_tra_khach) > 0;
}

function legacyAmountForScope(receipt, scope) {
  const giaTri = parseMoney(receipt?.gia_tri);
  const method = String(receipt?.phuong_thuc_thanh_toan || '').trim();
  const legacyBook = receipt?.so_quy_id && typeof receipt.so_quy_id === 'object' ? receipt.so_quy_id : null;
  const legacyLoai = legacyBook?.loai_so_quy || 'tien_mat';

  if (scope.mode === 'tien_mat') {
    if (method === 'tien_mat' || (method !== 'chuyen_khoan' && legacyLoai !== 'chuyen_khoan' && legacyBook)) {
      return giaTri;
    }
    return 0;
  }
  if (scope.mode === 'chuyen_khoan') {
    if (method === 'chuyen_khoan' || legacyLoai === 'chuyen_khoan') {
      return giaTri;
    }
    return 0;
  }
  return giaTri;
}

function resolveReceiptScopedAmount(receipt, scope, bookMeta = {}) {
  const giaTri = parseMoney(receipt?.gia_tri);
  if (!scope || scope.mode === 'all' || scope.mode === 'unassigned') return giaTri;

  const detail = receipt?.chi_tiet_thanh_toan || {};
  const tienMat = parseMoney(detail.tien_mat);
  const chuyenKhoan = parseMoney(detail.chuyen_khoan);

  if (scope.mode === 'tien_mat') {
    if (hasSplitPaymentDetail(detail)) return tienMat;
    return legacyAmountForScope(receipt, scope);
  }

  if (scope.mode === 'chuyen_khoan') {
    if (hasSplitPaymentDetail(detail)) return chuyenKhoan;
    return legacyAmountForScope(receipt, scope);
  }

  if (scope.mode === 'specific' && scope.bookId) {
    const bookId = String(scope.bookId);
    const cashBookId = getObjectIdStr(detail.so_quy_tien_mat_id);
    const bankBookId = getObjectIdStr(detail.so_quy_chuyen_khoan_id);
    const legacyBookId = getObjectIdStr(receipt?.so_quy_id);
    const bookLoai = bookMeta.loai_so_quy || 'tien_mat';

    if (hasSplitPaymentDetail(detail)) {
      if (bookLoai === 'chuyen_khoan') return bankBookId === bookId ? chuyenKhoan : 0;
      return cashBookId === bookId ? tienMat : 0;
    }

    return legacyBookId === bookId ? giaTri : 0;
  }

  return giaTri;
}

async function buildCashBookMeta(scope) {
  if (!scope || scope.mode !== 'specific' || !scope.bookId) return {};
  if (!isObjectId(scope.bookId)) return {};
  const book = await SoQuy.findById(scope.bookId).select('loai_so_quy ten_so_quy').lean();
  if (!book) return {};
  return {
    loai_so_quy: book.loai_so_quy || 'tien_mat',
    ten_so_quy: book.ten_so_quy || ''
  };
}

const SCOPED_RECEIPT_SELECT = 'loai_phieu gia_tri phuong_thuc_thanh_toan so_quy_id chi_tiet_thanh_toan trang_thai';

async function computeScopedTotals(matchFilter, scope, bookMeta = {}) {
  if (!scope || scope.mode === 'all' || scope.mode === 'unassigned') {
    const rows = await PhieuThuChi.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$loai_phieu', total: { $sum: { $ifNull: ['$gia_tri', 0] } } } }
    ]);
    const totalMap = new Map(rows.map(row => [row._id, row.total || 0]));
    return {
      totalThu: totalMap.get('thu') || 0,
      totalChi: totalMap.get('chi') || 0
    };
  }

  const rows = await PhieuThuChi.find(matchFilter)
    .select(SCOPED_RECEIPT_SELECT)
    .populate('so_quy_id', 'loai_so_quy')
    .populate('chi_tiet_thanh_toan.so_quy_tien_mat_id', 'loai_so_quy')
    .populate('chi_tiet_thanh_toan.so_quy_chuyen_khoan_id', 'loai_so_quy')
    .lean();

  let totalThu = 0;
  let totalChi = 0;
  rows.forEach((row) => {
    const amount = resolveReceiptScopedAmount(row, scope, bookMeta);
    if (row.loai_phieu === 'thu') totalThu += amount;
    if (row.loai_phieu === 'chi') totalChi += amount;
  });
  return { totalThu, totalChi };
}

function attachScopedAmounts(list, scope, bookMeta = {}) {
  if (!Array.isArray(list) || !list.length) return list;
  list.forEach((item) => {
    const doc = item && typeof item.toObject === 'function' ? item.toObject() : item;
    const scoped = resolveReceiptScopedAmount(doc, scope, bookMeta);
    if (item && typeof item.set === 'function') {
      item.set('_scoped_gia_tri', scoped, { strict: false });
    } else if (item && typeof item === 'object') {
      item._scoped_gia_tri = scoped;
    }
  });
  return list;
}

function displayReceiptAmount(item, scope) {
  if (!item) return 0;
  if (scope && scope.mode !== 'all' && scope.mode !== 'unassigned') {
    if (item._scoped_gia_tri != null) return parseMoney(item._scoped_gia_tri);
  }
  return parseMoney(item.gia_tri);
}

module.exports = {
  resolveCashBookFilterScope,
  resolveReceiptScopedAmount,
  buildCashBookMeta,
  computeScopedTotals,
  attachScopedAmounts,
  displayReceiptAmount
};
