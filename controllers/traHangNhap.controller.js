const path = require('path');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const pdfService = require('../services/pdf.service');
const {
  CuaHang,
  Kho,
  NguoiDung,
  NhaCungCap,
  HangHoa,
  DonViTinh,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LoHang,
  PhieuNhap,
  CTPhieuNhap,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  CongNoNhaCungCap,
  SoQuy,
  PhieuThuChi,
  VatChua
} = require('../models/kiot.model');
const { normalizeQuyCachItems } = require('../services/purchase.service');
const { parseVatChuaImportInput, assertVatChuaImportInput } = require('../services/vatChuaImport.service');
const { exportVatChuaWithPurchaseReturn } = require('../services/vatChuaExport.service');
const { loadReturnsLinkedVatChuaMap } = require('../services/vatChuaDetail.service');
const { truTonKho } = require('../services/kho.service');
const { taoPhieuThuChi } = require('../services/soQuy.service');
const { buildReceiptPaymentInfo } = require('../services/paymentCashBook.service');
const { acquirePurchaseGroupMutationLock } = require('../services/purchaseGroup.service');

function disabledTrashOperation() {
  const error = new Error('Chức năng xóa/đưa vào thùng rác đã được tắt.');
  error.statusCode = 410;
  throw error;
}

const previewReturnImportTrash = disabledTrashOperation;
const moveReturnImportToTrash = disabledTrashOperation;
const cancelReturnImport = disabledTrashOperation;

/** Số ngày được trả hàng nhập kể từ ngày nhập (khi phiếu không có hạn riêng). Có thể ghi đè bằng biến môi trường SO_NGAY_TRA_HANG_NHAP. */
const DEFAULT_SO_NGAY_TRA_HANG_NHAP = (() => {
  const n = parseInt(String(process.env.SO_NGAY_TRA_HANG_NHAP || '30'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 30;
})();

const RETURN_IMPORT_STATUS_MAP = {
  draft: 'Phiếu tạm',
  completed: 'Đã trả hàng',
  cancelled: 'Đã hủy'
};
const RETURN_IMPORT_PAGE_SIZE = 10;

function activePurchaseDataFilter(extra) {
  const base = extra || {};
  return {
    $and: [
      base,
      {
        $or: [
          { trang_thai_du_lieu: 'active' },
          { trang_thai_du_lieu: { $exists: false } },
          { trang_thai_du_lieu: null },
          { trang_thai_du_lieu: '' }
        ]
      }
    ]
  };
}

function activeReturnImportDataFilter(extra) {
  const base = extra || {};
  return {
    $and: [
      base,
      {
        $or: [
          { trang_thai_du_lieu: 'active' },
          { trang_thai_du_lieu: { $exists: false } },
          { trang_thai_du_lieu: null },
          { trang_thai_du_lieu: '' }
        ]
      }
    ]
  };
}

const RETURN_IMPORT_EXPORT_COLUMNS = [
  { header: 'Mã trả hàng nhập', key: 'ma_phieu_tra_nhap' },
  { header: 'Thời gian trả', key: 'thoi_gian_tra' },
  { header: 'Nhà cung cấp', key: 'nha_cung_cap' },
  { header: 'Mã phiếu nhập', key: 'ma_phieu_nhap' },
  { header: 'Kho', key: 'kho' },
  { header: 'Người tạo', key: 'nguoi_tao' },
  { header: 'Người trả', key: 'nguoi_tra' },
  { header: 'Tổng tiền hàng', key: 'tong_tien_hang', style: { numFmt: '#,##0' } },
  { header: 'Giảm giá', key: 'giam_gia', style: { numFmt: '#,##0.##' } },
  { header: 'NCC cần trả', key: 'ncc_can_tra', style: { numFmt: '#,##0' } },
  { header: 'NCC đã trả', key: 'ncc_da_tra', style: { numFmt: '#,##0' } },
  { header: 'NCC còn phải trả', key: 'ncc_con_phai_tra', style: { numFmt: '#,##0' } },
  { header: 'Tính vào công nợ', key: 'tinh_vao_cong_no' },
  { header: 'Tổng tiền trả', key: 'tong_tien_tra', style: { numFmt: '#,##0' } },
  { header: 'Lý do', key: 'ly_do' },
  { header: 'Ghi chú', key: 'ghi_chu' },
  { header: 'Trạng thái', key: 'trang_thai' },
  { header: 'Mã hàng', key: 'ma_hang' },
  { header: 'Tên hàng', key: 'ten_hang' },
  { header: 'Thương hiệu', key: 'thuong_hieu' },
  { header: 'Đơn vị tính', key: 'don_vi_tinh' },
  { header: 'Lô hàng', key: 'lo_hang' },
  { header: 'Số lượng trả', key: 'so_luong_tra', style: { numFmt: '#,##0.##' } },
  { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
  { header: 'Giá nhập', key: 'gia_nhap', style: { numFmt: '#,##0' } },
  { header: 'Giá trả lại', key: 'gia_tra_lai', style: { numFmt: '#,##0' } },
  { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } },
  { header: 'Ghi chú dòng', key: 'ghi_chu_dong' }
];

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function parseReturnImportPage(query) {
  const page = parseInt(query && query.page, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildReturnImportListQueryString(query, overrides) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (key === 'page' || key === 'page_size') return;
    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, item));
    } else if (value !== undefined && value !== null && String(value) !== '') {
      params.append(key, value);
    }
  });
  const page = Number(overrides && overrides.page);
  if (Number.isFinite(page) && page > 1) params.set('page', String(Math.floor(page)));
  return params.toString();
}

function resolveCashBookIdFromBody(body = {}) {
  const value = body.so_quy_id || body.cashBookId || '';
  return String(value || '').trim();
}

function normalizePaymentMethod(value) {
  const method = String(value || '').trim();
  return ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(method) ? method : 'tien_mat';
}

function paymentMethodFromDetail(detail) {
  const tienMat = Number(detail && detail.tien_mat || 0);
  const chuyenKhoan = Number(detail && detail.chuyen_khoan || 0);
  if (tienMat > 0 && chuyenKhoan > 0) return 'khac';
  if (chuyenKhoan > 0) return 'chuyen_khoan';
  return 'tien_mat';
}

function returnPaymentReadValue(body, key) {
  const raw = body && body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object'
    ? body.chi_tiet_thanh_toan
    : {};
  if (raw[key] !== undefined) return raw[key];
  const bracketKey = 'chi_tiet_thanh_toan[' + key + ']';
  if (body && body[bracketKey] !== undefined) return body[bracketKey];
  return body ? body[key] : undefined;
}

function returnPaymentIsV2(body = {}) {
  const flag = body.payment_v2;
  return flag === true
    || flag === 'true'
    || flag === '1'
    || String(returnPaymentReadValue(body, 'so_quy_tien_mat_id') || '').trim() !== ''
    || String(returnPaymentReadValue(body, 'so_quy_chuyen_khoan_id') || '').trim() !== '';
}

function withSessionOption(session) {
  return session ? { session } : {};
}

function isEffectiveReturnHeader(header) {
  return Boolean(header && header.trang_thai !== 'cancelled'
    && header.trang_thai_du_lieu !== 'inactive' && !header.deleted_at);
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizePaymentDetail(body = {}, maxAmount) {
  const isV2 = returnPaymentIsV2(body);
  let tienMat = parseMoney(returnPaymentReadValue(body, 'tien_mat'));
  let chuyenKhoan = parseMoney(returnPaymentReadValue(body, 'chuyen_khoan'));
  const tienTraKhach = parseMoney(returnPaymentReadValue(body, 'tien_tra_khach'));
  if (isV2 && tienTraKhach > 0) throw new Error('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
  let amount = tienMat + chuyenKhoan;
  if (amount <= 0) {
    amount = parseMoney(body.ncc_da_tra || 0);
    tienMat = amount;
    chuyenKhoan = 0;
  }
  const limit = Math.max(0, parseMoney(maxAmount));
  if (amount > limit) {
    throw new Error('Số tiền NCC hoàn không được vượt số NCC cần trả.');
  }
  return {
    isV2,
    amount,
    detail: {
      tien_mat: tienMat,
      so_quy_tien_mat_id: String(returnPaymentReadValue(body, 'so_quy_tien_mat_id') || '').trim() || null,
      chuyen_khoan: chuyenKhoan,
      so_quy_chuyen_khoan_id: String(returnPaymentReadValue(body, 'so_quy_chuyen_khoan_id') || '').trim() || null,
      tien_tra_khach: 0
    }
  };
}

async function resolveSupplierRefundCashBookId(returnDoc, requestedId, paymentDetail) {
  if (isObjectId(requestedId)) return String(requestedId);
  const savedId = getObjectIdValue(returnDoc && returnDoc.so_quy_id);
  if (isObjectId(savedId)) return savedId;
  const storeId = getObjectIdValue(returnDoc && returnDoc.cua_hang_id);
  if (!isObjectId(storeId)) return '';
  const cashBooks = await SoQuy.find({ trang_thai: 'active' })
    .sort({ ten_so_quy: 1 })
    .lean();
  if (!cashBooks.length) return '';
  const detail = paymentDetail || returnDoc.chi_tiet_thanh_toan || {};
  const tienMat = Number(detail.tien_mat || 0);
  const chuyenKhoan = Number(detail.chuyen_khoan || 0);
  const terms = chuyenKhoan > 0 && tienMat <= 0
    ? ['chuyen khoan', 'ngan hang', 'bank']
    : ['tien mat', 'cash'];
  const matched = cashBooks.find(book => {
    const name = normalizeSearchText(book.ten_so_quy);
    return terms.some(term => name.includes(term));
  });
  return String((matched || cashBooks[0])._id);
}

/** Chuẩn hóa ref có thể là ObjectId, string, hoặc document populate { _id } */
function getObjectIdValue(value) {
  if (!value) return '';
  if (value._id != null) return String(value._id).trim();
  return String(value).trim();
}

/** Khóa ảo: chi tiết phiếu nhập + quy cách (gia_tri_thuoc_tinh hoặc ten_quy_cach hoặc base). */
function purchaseReturnSlotSuffix(opts = {}) {
  const tid = opts.gia_tri_thuoc_tinh_id ? String(opts.gia_tri_thuoc_tinh_id).trim() : '';
  const tn = String(opts.ten_quy_cach || '').trim();
  if (tid) return `gtt:${tid}`;
  if (tn) return `qc:${tn}`;
  return 'base';
}

function purchaseReturnSlotKey(ctId, opts = {}) {
  return `${String(ctId)}|${purchaseReturnSlotSuffix(opts)}`;
}

function ctPhieuNhapGttId(ctRow) {
  const g = ctRow.gia_tri_thuoc_tinh_id;
  return g && (g._id || g) ? String(g._id || g).trim() : '';
}

function expandCtPhieuNhapReturnSlots(ctRow) {
  const qcList = normalizeQuyCachItems(ctRow.lot_info && ctRow.lot_info.quy_cach_items);
  const lotRef = ctRow.lo_hang_id;
  const lotId = lotRef && lotRef._id ? String(lotRef._id) : (lotRef ? String(lotRef) : '');
  const hangRef = ctRow.hang_hoa_id;
  const managesLot = Boolean(hangRef && hangRef.quan_ly_theo_lo);
  const ctId = String(ctRow._id);
  const baseImported = Number(ctRow.so_luong || 0);
  const basePrice = Number(ctRow.don_gia_nhap || 0);
  const gtt = ctPhieuNhapGttId(ctRow);

  if (!managesLot || !lotId) {
    const suffixOpts = gtt ? { gia_tri_thuoc_tinh_id: gtt } : {};
    return [{
      ctId,
      lotId: '',
      ten_quy_cach: '',
      gia_tri_thuoc_tinh_id: gtt,
      importedQty: baseImported,
      gia_nhap: basePrice,
      slotKey: purchaseReturnSlotKey(ctId, suffixOpts),
      multi_quy_cach: false
    }];
  }

  if (!qcList.length) {
    const suffixOpts = gtt ? { gia_tri_thuoc_tinh_id: gtt } : {};
    return [{
      ctId,
      lotId,
      ten_quy_cach: '',
      gia_tri_thuoc_tinh_id: gtt,
      importedQty: baseImported,
      gia_nhap: basePrice,
      slotKey: purchaseReturnSlotKey(ctId, suffixOpts),
      multi_quy_cach: false
    }];
  }

  const multi = qcList.length > 1;
  return qcList.map(qc => {
    const tn = String(qc.ten_quy_cach || '').trim();
    const imported = Number(qc.so_luong || 0);
    const price = Number(qc.don_gia_nhap || qc.gia_von || basePrice || 0);
    return {
      ctId,
      lotId,
      ten_quy_cach: tn,
      gia_tri_thuoc_tinh_id: '',
      importedQty: imported,
      gia_nhap: price,
      slotKey: purchaseReturnSlotKey(ctId, { ten_quy_cach: tn }),
      multi_quy_cach: multi
    };
  });
}

function parseReturnLineSlotSuffix(row) {
  const gttRaw = row.gia_tri_thuoc_tinh_id;
  const tid = gttRaw && (gttRaw._id || gttRaw) ? String(gttRaw._id || gttRaw).trim() : '';
  const tn = String(row.ten_quy_cach || '').trim();
  return purchaseReturnSlotSuffix({ gia_tri_thuoc_tinh_id: tid, ten_quy_cach: tn });
}

function parseReturnLineSlotKey(ctId, row) {
  return `${String(ctId)}|${parseReturnLineSlotSuffix(row)}`;
}

async function resolveReturnTenQuyCachFromPayload(item, khoId, hangId, loHangId) {
  let tn = String(item.ten_quy_cach || '').trim();
  if (tn) return tn;
  if (isObjectId(item.ton_kho_lo_quy_cach_id)) {
    const qc = await TonKhoLoQuyCach.findById(item.ton_kho_lo_quy_cach_id).lean();
    if (!qc) throw new Error('Không tìm thấy tồn quy cách trong lô');
    if (String(qc.kho_id) !== String(khoId)) throw new Error('Tồn quy cách không thuộc kho trả');
    if (String(qc.hang_hoa_id) !== String(hangId)) throw new Error('Tồn quy cách không khớp hàng hóa');
    if (loHangId && String(qc.lo_hang_id) !== String(loHangId)) throw new Error('Tồn quy cách không khớp lô hàng');
    return String(qc.ten_quy_cach || qc.ten_thuoc_tinh || '').trim();
  }
  return '';
}

async function resolveStoreId(req) {
  const sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
  if (isObjectId(sessionStoreId)) return sessionStoreId;
  const userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
  if (isObjectId(userStoreId)) return userStoreId;
  const activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  return activeStore ? String(activeStore._id) : '';
}

function parseMoney(raw) {
  if (raw == null) return 0;
  const value = Number(String(raw).replace(/\./g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function resolveSupplierReturnRemaining(ticket) {
  if (!ticket) return 0;
  if (ticket.ncc_con_phai_tra != null && ticket.ncc_con_phai_tra !== '') {
    return Math.max(0, Number(ticket.ncc_con_phai_tra || 0));
  }
  return Math.max(0, Number(ticket.ncc_can_tra || 0) - Number(ticket.ncc_da_tra || 0));
}

function parseItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => ({
    hang_hoa_id: String(item.hang_hoa_id || '').trim(),
    lo_hang_id: String(item.lo_hang_id || '').trim(),
    phieu_nhap_id: String(item.phieu_nhap_id || '').trim(),
    ct_phieu_nhap_id: String(item.ct_phieu_nhap_id || '').trim(),
    gia_tri_thuoc_tinh_id: String(item.gia_tri_thuoc_tinh_id || '').trim(),
    ten_quy_cach: String(item.ten_quy_cach || '').trim(),
    ton_kho_lo_quy_cach_id: String(item.ton_kho_lo_quy_cach_id || '').trim(),
    so_luong: Number(item.so_luong || 0),
    gia_nhap: parseMoney(item.gia_nhap || item.don_gia || item.don_gia_nhap || 0),
    gia_tra_lai: parseMoney(item.gia_tra_lai || item.don_gia || item.don_gia_nhap || 0),
    ghi_chu: String(item.ghi_chu || '').trim()
  })).filter(item => isObjectId(item.hang_hoa_id));
}

function computeTotals(items, discountValue, discountType) {
  const tongTienHang = items.reduce((sum, item) => {
    const line = Math.max(0, Number(item.so_luong || 0) * Number(item.gia_tra_lai || 0));
    return sum + line;
  }, 0);
  let giamGia = Number(discountValue || 0);
  if (!Number.isFinite(giamGia) || giamGia < 0) giamGia = 0;
  if (discountType === 'percent') giamGia = Math.min(100, giamGia);
  const discountAmount = discountType === 'percent'
    ? Math.floor(tongTienHang * giamGia / 100)
    : Math.min(Math.floor(giamGia), tongTienHang);
  const nccCanTra = Math.max(0, Math.floor(tongTienHang - discountAmount));
  return {
    tong_tien_hang: Math.floor(tongTienHang),
    giam_gia: Math.floor(giamGia),
    ncc_can_tra: nccCanTra,
    tong_tien_tra: nccCanTra
  };
}

async function makeReturnCode() {
  const last = await PhieuTraHangNhap.findOne({ ma_phieu_tra_nhap: /^THN\d+$/ })
    .sort({ ma_phieu_tra_nhap: -1 })
    .lean();
  const next = last && last.ma_phieu_tra_nhap
    ? Number(String(last.ma_phieu_tra_nhap).replace(/\D/g, '')) + 1
    : 1;
  return 'THN' + String(next).padStart(6, '0');
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function endOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function getPurchaseReturnDeadlineEnd(purchase) {
  if (!purchase) return null;
  if (purchase.han_tra_hang_nhap) return endOfDay(purchase.han_tra_hang_nhap);
  const base = purchase.ngay_nhap || purchase.created_at;
  if (!base) return null;
  const customDays = purchase.so_ngay_duoc_tra_hang_nhap;
  const days = Number.isFinite(Number(customDays)) && Number(customDays) >= 0
    ? Number(customDays)
    : DEFAULT_SO_NGAY_TRA_HANG_NHAP;
  const t = new Date(base);
  t.setDate(t.getDate() + days);
  return endOfDay(t);
}

function isPurchaseWithinReturnWindow(purchase, at = new Date()) {
  const end = getPurchaseReturnDeadlineEnd(purchase);
  if (!end) return false;
  return at.getTime() <= end.getTime();
}

function assertPurchaseEligibleForReturnImport(purchase, params = {}) {
  if (!purchase) throw new Error('Phiếu nhập gốc không hợp lệ');
  if (String(purchase.trang_thai || '') === 'cancelled') {
    throw new Error('Phiếu nhập đã hủy, không được trả hàng nhập');
  }
  if (String(purchase.trang_thai || '') !== 'completed') {
    throw new Error('Phiếu nhập chưa hoàn thành, không được trả hàng nhập');
  }
  const khoId = params.khoId != null ? String(params.khoId).trim() : '';
  const purchaseKhoId = getObjectIdValue(purchase.kho_id);
  if (khoId && isObjectId(khoId) && purchaseKhoId !== khoId) {
    throw new Error('Kho trả không khớp với phiếu nhập gốc');
  }
  if (!isPurchaseWithinReturnWindow(purchase, params.at || new Date())) {
    throw new Error('Phiếu nhập đã hết hạn trả hàng nhập');
  }
}

/**
 * Phiếu nhập hiển thị khi trả hàng nhập: completed, chưa hủy, còn hạn trả,
 * và còn ít nhất một dòng CT có (sl nhập − sl đã trả theo ct) > 0.
 * Không lọc theo tồn kho.
 */
async function listEligiblePurchasesForReturnImport(storeId, khoId, options = {}) {
  if (!isObjectId(khoId)) return [];
  const now = options.at || new Date();
  const filter = { kho_id: khoId, trang_thai: 'completed' };
  if (isObjectId(storeId)) filter.cua_hang_id = storeId;

  const purchases = await PhieuNhap.find(activePurchaseDataFilter(filter))
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .select('ma_phieu_nhap ngay_nhap created_at kho_id nha_cung_cap_id cua_hang_id trang_thai han_tra_hang_nhap so_ngay_duoc_tra_hang_nhap')
    .sort({ ngay_nhap: -1, created_at: -1 })
    .lean();

  const inWindow = purchases.filter(p => isPurchaseWithinReturnWindow(p, now));
  if (!inWindow.length) return [];

  const ids = inWindow.map(p => p._id);
  const [details, returnRows] = await Promise.all([
    CTPhieuNhap.find({ phieu_nhap_id: { $in: ids } })
      .populate({ path: 'hang_hoa_id', select: 'quan_ly_theo_lo' })
      .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo' })
      .select('phieu_nhap_id so_luong hang_hoa_id lo_hang_id lot_info don_gia_nhap gia_tri_thuoc_tinh_id')
      .lean(),
    CTPhieuTraHangNhap.find({ phieu_nhap_id: { $in: ids } })
      .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai trang_thai_du_lieu deleted_at' })
      .select('phieu_nhap_id ct_phieu_nhap_id so_luong phieu_tra_nhap_id ten_quy_cach gia_tri_thuoc_tinh_id')
      .lean()
  ]);

  const returnedByPurchaseSlot = {};
  returnRows.forEach(row => {
    if (!isEffectiveReturnHeader(row.phieu_tra_nhap_id)) return;
    const pid = String(row.phieu_nhap_id);
    if (!row.ct_phieu_nhap_id) return;
    const ctId = String(row.ct_phieu_nhap_id);
    const key = parseReturnLineSlotKey(ctId, row);
    if (!returnedByPurchaseSlot[pid]) returnedByPurchaseSlot[pid] = {};
    returnedByPurchaseSlot[pid][key] = (returnedByPurchaseSlot[pid][key] || 0) + Number(row.so_luong || 0);
  });

  const detailsByPurchase = {};
  details.forEach(d => {
    const pid = String(d.phieu_nhap_id);
    if (!detailsByPurchase[pid]) detailsByPurchase[pid] = [];
    detailsByPurchase[pid].push(d);
  });

  const eligible = [];
  for (const p of inWindow) {
    const pid = String(p._id);
    const rows = detailsByPurchase[pid] || [];
    const retMap = returnedByPurchaseSlot[pid] || {};
    let hasReturnable = false;
    for (const ct of rows) {
      const slots = expandCtPhieuNhapReturnSlots(ct);
      for (const slot of slots) {
        const imported = Number(slot.importedQty || 0);
        const returned = Number(retMap[slot.slotKey] || 0);
        if (imported - returned > 0) {
          hasReturnable = true;
          break;
        }
      }
      if (hasReturnable) break;
    }
    if (hasReturnable) {
      const lotNames = [...new Set(rows.map(row => {
        const lot = row.lo_hang_id;
        return lot && typeof lot === 'object'
          ? String(lot.ten_lo || lot.ma_lo || '').trim()
          : '';
      }).filter(Boolean))];
      p.lot_names = lotNames;
      eligible.push(p);
    }
  }
  return eligible;
}

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function statusLabel(value) {
  if (value === 'draft') return 'Phiếu tạm';
  if (value === 'cancelled') return 'Đã hủy';
  return 'Đã trả hàng';
}

function formatExportDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function getUserName(user) {
  return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function getLotName(lot) {
  return lot ? (lot.ten_lo || lot.ma_lo || '') : '';
}

function buildExportRow(ticket, detail) {
  const product = detail && detail.hang_hoa_id ? detail.hang_hoa_id : {};
  const detailUnit = detail && detail.don_vi_tinh_id ? detail.don_vi_tinh_id : null;
  const productUnit = product.don_vi_tinh_id || null;
  return {
    ma_phieu_tra_nhap: ticket.ma_phieu_tra_nhap || '',
    thoi_gian_tra: formatExportDate(ticket.ngay_tra || ticket.created_at),
    nha_cung_cap: ticket.nha_cung_cap_id ? (ticket.nha_cung_cap_id.ten_ncc || ticket.nha_cung_cap_id.ma_ncc || '') : '',
    ma_phieu_nhap: ticket.phieu_nhap_id ? (ticket.phieu_nhap_id.ma_phieu_nhap || '') : '',
    kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
    nguoi_tao: getUserName(ticket.nguoi_tao_id),
    nguoi_tra: getUserName(ticket.nguoi_tra_id),
    tong_tien_hang: Number(ticket.tong_tien_hang || 0),
    giam_gia: Number(ticket.giam_gia || 0),
    ncc_can_tra: Number(ticket.ncc_can_tra || 0),
    ncc_da_tra: Number(ticket.ncc_da_tra || 0),
    ncc_con_phai_tra: resolveSupplierReturnRemaining(ticket),
    tinh_vao_cong_no: ticket.tinh_vao_cong_no ? 'Có' : 'Không',
    tong_tien_tra: Number(ticket.tong_tien_tra || 0),
    ly_do: ticket.ly_do || '',
    ghi_chu: ticket.ghi_chu || '',
    trang_thai: RETURN_IMPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '',
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '',
    don_vi_tinh: detailUnit
      ? (detailUnit.ten_don_vi || detailUnit.ma_don_vi || '')
      : (productUnit ? (productUnit.ten_don_vi || productUnit.ma_don_vi || '') : ''),
    lo_hang: getLotName(detail && detail.lo_hang_id),
    so_luong_tra: detail ? Number(detail.so_luong || 0) : 0,
    don_gia: detail ? Number(detail.don_gia || 0) : 0,
    gia_nhap: detail ? Number(detail.gia_nhap || 0) : 0,
    gia_tra_lai: detail ? Number(detail.gia_tra_lai || 0) : 0,
    thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0,
    ghi_chu_dong: detail ? (detail.ghi_chu || '') : ''
  };
}

function applyWorksheetFormat(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF111827' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
    };
  });
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: RETURN_IMPORT_EXPORT_COLUMNS.length }
  };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      cell.alignment = { vertical: 'middle' };
    });
  });
  worksheet.columns.forEach(column => {
    let maxLength = String(column.header || '').length;
    column.eachCell({ includeEmpty: true }, cell => {
      const value = cell.value == null ? '' : String(cell.value);
      maxLength = Math.max(maxLength, value.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 12), 36);
  });
}

async function buildListFilter(req, storeId) {
  const query = {};
  if (isObjectId(storeId)) query.cua_hang_id = storeId;
  const q = String(req.query.q || '').trim();
  if (q) query.ma_phieu_tra_nhap = { $regex: q, $options: 'i' };

  const statuses = Array.isArray(req.query.trang_thai)
    ? req.query.trang_thai
    : (req.query.trang_thai ? [req.query.trang_thai] : []);
  const cleanStatuses = statuses.filter(x => ['draft', 'completed', 'cancelled'].includes(x));
  if (cleanStatuses.length) query.trang_thai = { $in: cleanStatuses };

  const timeType = String(req.query.time_type || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  if (timeType === 'this_month') {
    query.ngay_tra = { $gte: startOfMonth(), $lte: endOfDay(new Date()) };
  } else if (dateFrom || dateTo) {
    query.ngay_tra = {};
    if (dateFrom) query.ngay_tra.$gte = new Date(dateFrom + 'T00:00:00');
    if (dateTo) query.ngay_tra.$lte = endOfDay(dateTo + 'T00:00:00');
  }

  if (isObjectId(req.query.nguoi_tao)) query.nguoi_tao_id = req.query.nguoi_tao;
  if (isObjectId(req.query.nguoi_tra)) query.nguoi_tra_id = req.query.nguoi_tra;
  return activeReturnImportDataFilter(query);
}

async function loadExportReturns(filter) {
  const returns = await PhieuTraHangNhap.find(filter)
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
    .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
    .populate({ path: 'nguoi_tra_id', select: 'ho_ten username email' })
    .sort({ ngay_tra: -1, created_at: -1 });
  const returnIds = returns.map(row => row._id);
  const details = returnIds.length
    ? await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: { $in: returnIds } })
      .populate({
        path: 'hang_hoa_id',
        populate: [
          { path: 'thuong_hieu_id' },
          { path: 'don_vi_tinh_id' }
        ]
      })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
      .sort({ created_at: 1 })
    : [];
  const detailMap = details.reduce((map, detail) => {
    const key = String(detail.phieu_tra_nhap_id);
    if (!map[key]) map[key] = [];
    map[key].push(detail);
    return map;
  }, {});
  return { returns, detailMap };
}

async function sendReturnImportWorkbook(res, filename, returns, detailMap) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Trả hàng nhập');
  worksheet.columns = RETURN_IMPORT_EXPORT_COLUMNS;

  returns.forEach(ticket => {
    const details = detailMap[String(ticket._id)] || [];
    if (!details.length) {
      worksheet.addRow(buildExportRow(ticket, null));
      return;
    }
    details.forEach(detail => worksheet.addRow(buildExportRow(ticket, detail)));
  });

  applyWorksheetFormat(worksheet);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  await workbook.xlsx.write(res);
  res.end();
}

async function loadCreateData(storeId) {
  const storeFilter = isObjectId(storeId) ? { cua_hang_id: storeId } : {};
  let [warehouses, suppliers, users, units, products, lots, inventories, lotInventories, cashBooks] = await Promise.all([
    Kho.find(storeFilter).sort({ ten_kho: 1, ma_kho: 1 }).lean(),
    NhaCungCap.find(storeFilter).sort({ ten_ncc: 1, ma_ncc: 1 }).lean(),
    NguoiDung.find(storeFilter).sort({ ho_ten: 1, email: 1 }).lean(),
    DonViTinh.find(Object.assign({}, storeFilter, { trang_thai: 'active' })).sort({ ten_don_vi: 1 }).lean(),
    HangHoa.find(Object.assign({}, storeFilter, { trang_thai: 'active' }))
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .sort({ ma_hang: 1, ten_hang: 1 })
      .lean(),
    LoHang.find(Object.assign({}, storeFilter, { trang_thai: { $ne: 'huy' }, so_luong_con_lai: { $gt: 0 } }))
      .sort({ han_su_dung: 1, ngay_nhap: 1 })
      .lean(),
    TonKho.find(storeFilter).lean(),
    TonKhoLo.find(Object.assign({}, storeFilter, { so_luong: { $gt: 0 } })).lean(),
    SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }).lean()
  ]);

  if (!products.length && isObjectId(storeId)) {
    products = await HangHoa.find({ trang_thai: 'active' })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .sort({ ma_hang: 1, ten_hang: 1 })
      .lean();
  }

  const unitMap = units.reduce((map, unit) => {
    map[String(unit._id)] = unit.ten_don_vi || unit.ma_don_vi || '';
    return map;
  }, {});
  const invMap = inventories.reduce((map, row) => {
    map[String(row.kho_id) + ':' + String(row.hang_hoa_id)] = Number(row.so_luong || 0);
    return map;
  }, {});
  const lotInvMap = lotInventories.reduce((map, row) => {
    map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
    return map;
  }, {});
  const lotMapByProduct = lots.reduce((map, lot) => {
    const key = String(lot.hang_hoa_id);
    if (!map[key]) map[key] = [];
    map[key].push({
      _id: String(lot._id),
      ma_lo: lot.ma_lo || '',
      ten_lo: lot.ten_lo || '',
      kho_id: String(lot.kho_id || ''),
      so_luong: lotInvMap[String(lot._id)] || Number(lot.so_luong_con_lai || 0),
      han_su_dung: lot.han_su_dung || null
    });
    return map;
  }, {});

  const productOptions = products.map(product => ({
    _id: String(product._id),
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    don_vi_tinh_id: product.don_vi_tinh_id ? String(product.don_vi_tinh_id) : '',
    don_vi_tinh: unitMap[String(product.don_vi_tinh_id)] || '',
    nha_cung_cap_id: product.nha_cung_cap_id ? String(product.nha_cung_cap_id) : '',
    gia_nhap: Number(product.gia_nhap_cuoi || product.gia_von || 0),
    quan_ly_theo_lo: Boolean(product.quan_ly_theo_lo),
    ton_kho_by_kho: warehouses.reduce((map, warehouse) => {
      map[String(warehouse._id)] = invMap[String(warehouse._id) + ':' + String(product._id)] || 0;
      return map;
    }, {}),
    lots: lotMapByProduct[String(product._id)] || []
  }));

  let vatChuaList = [];
  if (isObjectId(storeId)) {
    vatChuaList = await VatChua.find({ cua_hang_id: storeId, trang_thai: 'active' })
      .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
      .select('ma_vat_chua ten_vat_chua so_luong_ton')
      .lean();
  }

  return { warehouses, suppliers, users, productOptions, cashBooks, receipts: [], vatChuaList };
}

/**
 * Khớp dòng trả với dòng nhập đã bung theo quy cách/lô (expandCtPhieuNhapReturnSlots).
 */
async function matchPurchaseReturnSlot(detail, item, khoId, session) {
  const slots = expandCtPhieuNhapReturnSlots(detail);
  let resolvedTenQc = String(item.ten_quy_cach || '').trim();
  let tonKhoLoQcId = isObjectId(item.ton_kho_lo_quy_cach_id) ? item.ton_kho_lo_quy_cach_id : null;
  if (tonKhoLoQcId) {
    const qc = await TonKhoLoQuyCach.findById(tonKhoLoQcId).session(session || null).lean();
    if (!qc) throw new Error('Không tìm thấy tồn quy cách trong lô');
    if (String(qc.kho_id) !== String(khoId)) throw new Error('Tồn quy cách không thuộc kho trả');
    if (String(qc.hang_hoa_id) !== String(item.hang_hoa_id)) throw new Error('Tồn quy cách không khớp hàng hóa');
    resolvedTenQc = String(qc.ten_quy_cach || qc.ten_thuoc_tinh || '').trim();
  }
  const itemGtt = isObjectId(item.gia_tri_thuoc_tinh_id) ? String(item.gia_tri_thuoc_tinh_id) : '';

  let slotDef = null;
  if (resolvedTenQc) {
    slotDef = slots.find(s => String(s.ten_quy_cach || '').trim() === resolvedTenQc) || null;
  }
  if (!slotDef && itemGtt) {
    slotDef = slots.find(s => String(s.gia_tri_thuoc_tinh_id || '') === itemGtt && !String(s.ten_quy_cach || '').trim()) || null;
  }
  if (!slotDef) {
    slotDef = slots.find(s => purchaseReturnSlotSuffix({
      gia_tri_thuoc_tinh_id: s.gia_tri_thuoc_tinh_id,
      ten_quy_cach: s.ten_quy_cach
    }) === 'base') || null;
  }
  if (!slotDef && slots.length === 1) slotDef = slots[0];
  if (!slotDef) throw new Error('Dòng trả không khớp quy cách hoặc thuộc tính trên phiếu nhập');

  let lotId = isObjectId(item.lo_hang_id) ? item.lo_hang_id : '';
  if (slotDef.lotId) {
    if (lotId && String(lotId) !== String(slotDef.lotId)) {
      throw new Error('Lô hàng trả không khớp với phiếu nhập gốc');
    }
    lotId = slotDef.lotId;
  } else {
    lotId = '';
  }

  if (!tonKhoLoQcId && resolvedTenQc && lotId) {
    const qd = await TonKhoLoQuyCach.findOne({
      kho_id: khoId,
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId,
      $or: [{ ten_quy_cach: resolvedTenQc }, { ten_thuoc_tinh: resolvedTenQc }]
    }).select('_id').session(session || null).lean();
    if (qd) tonKhoLoQcId = qd._id;
  }

  return {
    slotDef,
    resolvedTenQc,
    lotId,
    ton_kho_lo_quy_cach_id: tonKhoLoQcId || undefined,
    slotKey: slotDef.slotKey,
    gia_tri_thuoc_tinh_id: (() => {
      const rawGtt = slotDef.gia_tri_thuoc_tinh_id ? String(slotDef.gia_tri_thuoc_tinh_id).trim() : '';
      const cand = rawGtt || itemGtt || '';
      return cand && isObjectId(cand) ? cand : undefined;
    })()
  };
}

async function validateReturnItems(params) {
  const { items, storeId, khoId, phieuNhapId, returnId, ignorePhieuTraNhapIds, session } = params;
  const ignoreSet = new Set((ignorePhieuTraNhapIds || []).filter(id => isObjectId(id)).map(id => String(id)));
  if (!items.length) throw new Error('Vui lòng chọn ít nhất một hàng hóa cần trả');
  if (!isObjectId(khoId)) throw new Error('Vui lòng chọn kho trả hàng');

  const purchase = isObjectId(phieuNhapId)
    ? await PhieuNhap.findOne(activePurchaseDataFilter({ _id: phieuNhapId })).select(
      '_id cua_hang_id nha_cung_cap_id kho_id trang_thai ngay_nhap created_at han_tra_hang_nhap so_ngay_duoc_tra_hang_nhap'
    ).session(session || null).lean()
    : null;
  if (isObjectId(phieuNhapId) && !purchase) {
    throw new Error('Phiếu nhập gốc không hợp lệ');
  }
  if (isObjectId(phieuNhapId) && purchase) {
    if (isObjectId(storeId) && getObjectIdValue(purchase.cua_hang_id) !== String(storeId).trim()) {
      throw new Error('Phiếu nhập không thuộc cửa hàng hiện tại');
    }
    assertPurchaseEligibleForReturnImport(purchase, { khoId });
  }

  let slotImportedMap = {};
  let returnedSlotMap = {};
  let purchaseDetailsPopulated = [];

  if (isObjectId(phieuNhapId)) {
    purchaseDetailsPopulated = await CTPhieuNhap.find({ phieu_nhap_id: phieuNhapId })
      .populate({ path: 'hang_hoa_id', select: 'quan_ly_theo_lo ma_hang ten_hang' })
      .populate({ path: 'gia_tri_thuoc_tinh_id', select: 'ten_gia_tri ma_gia_tri' })
      .session(session || null)
      .lean();

    purchaseDetailsPopulated.forEach(ct => {
      expandCtPhieuNhapReturnSlots(ct).forEach(slot => {
        slotImportedMap[slot.slotKey] = Number(slot.importedQty || 0);
      });
    });

    const currentReturnFilter = { phieu_nhap_id: phieuNhapId };
    if (ignoreSet.size) {
      currentReturnFilter.phieu_tra_nhap_id = { $nin: Array.from(ignoreSet) };
    } else if (returnId && isObjectId(returnId)) {
      currentReturnFilter.phieu_tra_nhap_id = { $ne: returnId };
    }
    const completedReturns = await CTPhieuTraHangNhap.find(currentReturnFilter)
      .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai trang_thai_du_lieu deleted_at' })
      .session(session || null)
      .lean();

    completedReturns.forEach(row => {
      const ptId0 = row.phieu_tra_nhap_id && (row.phieu_tra_nhap_id._id || row.phieu_tra_nhap_id);
      if (ptId0 && ignoreSet.has(String(ptId0))) return;
      if (!isEffectiveReturnHeader(row.phieu_tra_nhap_id)) return;
      if (!row.ct_phieu_nhap_id) return;
      const ctId = String(row.ct_phieu_nhap_id);
      const key = parseReturnLineSlotKey(ctId, row);
      returnedSlotMap[key] = (returnedSlotMap[key] || 0) + Number(row.so_luong || 0);
    });
  }

  const detailById = purchaseDetailsPopulated.reduce((map, row) => {
    map[String(row._id)] = row;
    return map;
  }, {});

  const productIds = items.map(item => item.hang_hoa_id);
  const products = await HangHoa.find({ _id: { $in: productIds } })
    .select('_id ten_hang don_vi_tinh_id quan_ly_theo_lo')
    .session(session || null)
    .lean();
  const productMap = products.reduce((map, product) => {
    map[String(product._id)] = product;
    return map;
  }, {});

  const normalized = [];
  const requestedSlotTotals = {};

  for (const item of items) {
    if (isObjectId(phieuNhapId)) {
      if (item.phieu_nhap_id && String(item.phieu_nhap_id) !== String(phieuNhapId)) {
        throw new Error('Dòng trả hàng không khớp với phiếu nhập gốc đã chọn');
      }
    } else if (item.phieu_nhap_id || item.ct_phieu_nhap_id) {
      throw new Error('Vui lòng chọn phiếu nhập gốc để trả theo chi tiết nguồn');
    }
    const product = productMap[item.hang_hoa_id];
    if (!product) throw new Error('Hàng hóa không hợp lệ');
    if (!Number.isFinite(item.so_luong) || item.so_luong <= 0) {
      throw new Error('Số lượng trả phải lớn hơn 0');
    }
    item.so_luong = Math.floor(item.so_luong);
    if (item.so_luong <= 0) throw new Error('Số lượng trả phải lớn hơn 0');
    if (!Number.isFinite(item.gia_tra_lai) || item.gia_tra_lai < 0) item.gia_tra_lai = 0;
    if (!Number.isFinite(item.gia_nhap) || item.gia_nhap < 0) item.gia_nhap = item.gia_tra_lai;

    const inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id }).session(session || null).lean();
    if (!inventory || Number(inventory.so_luong || 0) < item.so_luong) {
      throw new Error('Không cho trả vượt tồn kho hiện tại');
    }

    let lotId = isObjectId(item.lo_hang_id) ? item.lo_hang_id : '';
    let resolvedTenQc = '';
    let tonKhoLoQcIdOut = undefined;
    let slotKeyTracked = '';
    let gttOut = undefined;

    if (isObjectId(phieuNhapId)) {
      if (!isObjectId(item.ct_phieu_nhap_id)) throw new Error('Dòng trả hàng thiếu chi tiết phiếu nhập gốc');
      const detail = detailById[String(item.ct_phieu_nhap_id)];
      if (!detail) throw new Error('Chi tiết phiếu nhập gốc không hợp lệ');
      const hangRefId = detail.hang_hoa_id && detail.hang_hoa_id._id ? String(detail.hang_hoa_id._id) : String(detail.hang_hoa_id || '');
      if (hangRefId !== String(item.hang_hoa_id)) {
        throw new Error('Hàng trả không khớp với phiếu nhập gốc');
      }

      const matched = await matchPurchaseReturnSlot(detail, item, khoId, session);
      resolvedTenQc = matched.resolvedTenQc || '';
      lotId = matched.lotId ? matched.lotId : '';
      tonKhoLoQcIdOut = matched.ton_kho_lo_quy_cach_id;
      slotKeyTracked = matched.slotKey;
      gttOut = matched.gia_tri_thuoc_tinh_id;

      requestedSlotTotals[slotKeyTracked] = (requestedSlotTotals[slotKeyTracked] || 0) + item.so_luong;

      if (product.quan_ly_theo_lo && resolvedTenQc && lotId) {
        const qcInv = await TonKhoLoQuyCach.findOne({
          kho_id: khoId,
          hang_hoa_id: item.hang_hoa_id,
          lo_hang_id: lotId,
          $or: [{ ten_quy_cach: resolvedTenQc }, { ten_thuoc_tinh: resolvedTenQc }]
        }).session(session || null).lean();
        if (!qcInv || Number(qcInv.so_luong || 0) < item.so_luong) {
          throw new Error('Tồn quy cách trong lô không đủ để trả');
        }
        const lot = await LoHang.findById(lotId).session(session || null).lean();
        if (!lot || Number(lot.so_luong_con_lai || 0) < item.so_luong) {
          throw new Error('Không cho tồn kho/lô âm');
        }
      } else if (product.quan_ly_theo_lo) {
        if (lotId) {
          const lotInventory = await TonKhoLo.findOne({
            kho_id: khoId,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: lotId,
            $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
          }).session(session || null).lean();
          const lot = await LoHang.findById(lotId).session(session || null).lean();
          if (!lotInventory || Number(lotInventory.so_luong || 0) < item.so_luong || !lot || Number(lot.so_luong_con_lai || 0) < item.so_luong) {
            throw new Error('Không cho tồn kho/lô âm');
          }
        } else {
          const availableLots = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, so_luong: { $gt: 0 } })
            .populate('lo_hang_id')
            .session(session || null)
            .lean();
          const availableQty = availableLots.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
          if (availableQty < item.so_luong) throw new Error('Tồn kho theo lô không đủ để tự chọn FEFO');
        }
      } else {
        lotId = '';
      }
    } else {
      if (product.quan_ly_theo_lo) {
        if (lotId) {
          const lotInventory = await TonKhoLo.findOne({
            kho_id: khoId,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: lotId,
            $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
          }).session(session || null).lean();
          const lot = await LoHang.findById(lotId).session(session || null).lean();
          if (!lotInventory || Number(lotInventory.so_luong || 0) < item.so_luong || !lot || Number(lot.so_luong_con_lai || 0) < item.so_luong) {
            throw new Error('Không cho tồn kho/lô âm');
          }
        } else {
          const availableLots = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, so_luong: { $gt: 0 } })
            .populate('lo_hang_id')
            .session(session || null)
            .lean();
          const availableQty = availableLots.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
          if (availableQty < item.so_luong) throw new Error('Tồn kho theo lô không đủ để tự chọn FEFO');
        }
      } else {
        lotId = '';
      }
    }

    normalized.push({
      phieu_nhap_id: isObjectId(phieuNhapId) ? phieuNhapId : undefined,
      ct_phieu_nhap_id: isObjectId(item.ct_phieu_nhap_id) ? item.ct_phieu_nhap_id : undefined,
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId || undefined,
      ten_quy_cach: resolvedTenQc || undefined,
      ton_kho_lo_quy_cach_id: tonKhoLoQcIdOut,
      gia_tri_thuoc_tinh_id: gttOut,
      don_vi_tinh_id: product.don_vi_tinh_id || undefined,
      so_luong: item.so_luong,
      don_gia: item.gia_tra_lai,
      gia_nhap: item.gia_nhap,
      gia_tra_lai: item.gia_tra_lai,
      thanh_tien: Math.floor(item.so_luong * item.gia_tra_lai),
      ghi_chu: item.ghi_chu || ''
    });
  }

  if (isObjectId(phieuNhapId)) {
    Object.keys(requestedSlotTotals).forEach(key => {
      const imported = Number(slotImportedMap[key] || 0);
      const returned = Number(returnedSlotMap[key] || 0);
      const canReturn = Math.max(0, imported - returned);
      if (requestedSlotTotals[key] > canReturn) {
        throw new Error('Không cho trả vượt số lượng còn có thể trả của dòng phiếu nhập');
      }
    });
  }

  return normalized;
}

async function persistDetails(returnId, rows, options = {}) {
  const session = options.session;
  await CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: returnId }, withSessionOption(session));
  if (!rows.length) return [];
  return CTPhieuTraHangNhap.insertMany(
    rows.map(row => Object.assign({}, row, { phieu_tra_nhap_id: returnId })),
    withSessionOption(session)
  );
}

async function completeInventory(returnDoc, rows, userId, options = {}) {
  for (const row of rows) {
    const tenQc = String(row.ten_quy_cach || '').trim();
    await truTonKho({
      kho_id: returnDoc.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_tra_lai || row.gia_nhap || row.don_gia || 0,
      nguoi_tao_id: userId,
      loai_phieu: 'tra_hang_nhap',
      ma_phieu: returnDoc.ma_phieu_tra_nhap,
      ghi_chu: returnDoc.ghi_chu || 'Trả hàng nhập',
      ten_quy_cach: tenQc || undefined,
      ton_kho_lo_quy_cach_id: row.ton_kho_lo_quy_cach_id || undefined,
      gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || undefined,
      sync_quy_cach: Boolean(row.lo_hang_id && (tenQc || row.ton_kho_lo_quy_cach_id || row.gia_tri_thuoc_tinh_id)),
      session: options.session
    });
  }
}

async function applySupplierDebt(returnDoc, options = {}) {
  if (!returnDoc.tinh_vao_cong_no || !returnDoc.nha_cung_cap_id) return;
  const session = options.session;
  const returnValue = Math.max(0, Number(returnDoc.ncc_can_tra || 0));
  const amount = Math.max(0, Number(returnDoc.ncc_da_tra || 0));
  if (returnValue <= 0) return;
  await CongNoNhaCungCap.create([{
    cua_hang_id: returnDoc.cua_hang_id,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_nhap_id: returnDoc.phieu_nhap_id || undefined,
    phieu_tra_nhap_id: returnDoc._id,
    so_tien: amount,
    loai: 'giam_no',
    ghi_chu: 'Giảm nợ từ phiếu trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    ngay: returnDoc.ngay_tra || new Date()
  }], withSessionOption(session));
  const supplier = amount > 0
    ? await NhaCungCap.findById(returnDoc.nha_cung_cap_id).select('tong_no').session(session || null).lean()
    : null;
  if (supplier && typeof supplier.tong_no === 'number') {
    await NhaCungCap.updateOne(
      { _id: returnDoc.nha_cung_cap_id },
      { $inc: { tong_no: -amount } },
      withSessionOption(session)
    );
  }
}

async function createSupplierRefundReceipt(returnDoc, userId, options = {}) {
  if (!returnDoc.nha_cung_cap_id) return;
  const amount = Number(returnDoc.ncc_da_tra || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const paymentDetail = options.chi_tiet_thanh_toan
    || returnDoc.chi_tiet_thanh_toan
    || { tien_mat: amount, chuyen_khoan: 0, tien_tra_khach: 0 };
  const cashBookId = await resolveSupplierRefundCashBookId(returnDoc, String(options.so_quy_id || '').trim(), paymentDetail);
  if (!isObjectId(cashBookId)) {
    throw new Error('Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.');
  }
  const existed = await mongoose.models.PhieuThuChi.findOne({
    phieu_tra_hang_nhap_id: returnDoc._id,
    loai_phieu: 'thu'
  }).lean();
  if (existed) return existed;
  return taoPhieuThuChi({
    loai_phieu: 'thu',
    loai_thu_chi: 'NCC hoan tien tra hang nhap',
    gia_tri: amount,
    ngay_lap: returnDoc.ngay_tra || new Date(),
    so_quy_id: cashBookId,
    cua_hang_id: returnDoc.cua_hang_id,
    nguoi_tao_id: userId,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_tra_hang_nhap_id: returnDoc._id,
    ma_chung_tu_goc: returnDoc.ma_phieu_tra_nhap,
    nhom_doi_tuong: 'nha_cung_cap',
    phuong_thuc_thanh_toan: normalizePaymentMethod(options.phuong_thuc_thanh_toan || paymentMethodFromDetail(paymentDetail)),
    chi_tiet_thanh_toan: paymentDetail,
    ghi_chu: 'Trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    hach_toan: false
  });
}

async function requireSupplierRefundReceipt(returnDoc, userId, options = {}) {
  const amount = Number(returnDoc && returnDoc.ncc_da_tra || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const receipt = await createSupplierRefundReceipt(returnDoc, userId, options);
  if (!receipt) throw new Error('Không tạo được phiếu thu cho số tiền nhà cung cấp đã trả.');
  return receipt;
}

async function createSupplierRefundPaymentReceipt(returnDoc, userId, payment, cashBookId) {
  const amount = Number(payment && payment.amount || 0);
  if (!returnDoc || !returnDoc.nha_cung_cap_id || !Number.isFinite(amount) || amount <= 0) return null;
  const paymentDetail = payment.detail || { tien_mat: amount, chuyen_khoan: 0, tien_tra_khach: 0 };
  return taoPhieuThuChi({
    loai_phieu: 'thu',
    loai_thu_chi: 'NCC hoan tien tra hang nhap',
    gia_tri: amount,
    ngay_lap: new Date(),
    so_quy_id: cashBookId,
    cua_hang_id: returnDoc.cua_hang_id,
    nguoi_tao_id: userId,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_tra_hang_nhap_id: returnDoc._id,
    ma_chung_tu_goc: returnDoc.ma_phieu_tra_nhap,
    nhom_doi_tuong: 'nha_cung_cap',
    phuong_thuc_thanh_toan: normalizePaymentMethod(paymentMethodFromDetail(paymentDetail)),
    chi_tiet_thanh_toan: paymentDetail,
    ghi_chu: 'Nhận tiền trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    hach_toan: false
  });
}

async function createSupplierRefundReceipt(returnDoc, userId, options = {}) {
  if (!returnDoc.nha_cung_cap_id) return;
  const amount = Number(returnDoc.ncc_da_tra || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const paymentDetail = options.chi_tiet_thanh_toan
    || returnDoc.chi_tiet_thanh_toan
    || { tien_mat: amount, chuyen_khoan: 0, tien_tra_khach: 0 };
  paymentDetail.tien_tra_khach = 0;
  const isV2 = options.payment_v2 === true
    || options.payment_v2 === 'true'
    || options.payment_v2 === '1'
    || String(paymentDetail.so_quy_tien_mat_id || '').trim() !== ''
    || String(paymentDetail.so_quy_chuyen_khoan_id || '').trim() !== '';
  const cashBookId = isV2 ? '' : await resolveSupplierRefundCashBookId(returnDoc, String(options.so_quy_id || '').trim(), paymentDetail);
  if (!isV2 && !isObjectId(cashBookId)) {
    throw new Error('Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.');
  }
  const existed = await mongoose.models.PhieuThuChi.findOne({
    phieu_tra_hang_nhap_id: returnDoc._id,
    loai_phieu: 'thu'
  }).session(options.session || null).lean();
  if (existed) return existed;
  const payload = {
    loai_phieu: 'thu',
    loai_thu_chi: 'NCC hoan tien tra hang nhap',
    gia_tri: amount,
    ngay_lap: returnDoc.ngay_tra || new Date(),
    so_quy_id: cashBookId || undefined,
    cua_hang_id: returnDoc.cua_hang_id,
    nguoi_tao_id: userId,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_tra_hang_nhap_id: returnDoc._id,
    ma_chung_tu_goc: returnDoc.ma_phieu_tra_nhap,
    nhom_doi_tuong: 'nha_cung_cap',
    phuong_thuc_thanh_toan: normalizePaymentMethod(options.phuong_thuc_thanh_toan || paymentMethodFromDetail(paymentDetail)),
    chi_tiet_thanh_toan: paymentDetail,
    ghi_chu: 'Trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    hach_toan: false
  };
  if (isV2) {
    Object.assign(payload, {
      payment_v2: true,
      tien_mat: Number(paymentDetail.tien_mat || 0),
      so_quy_tien_mat_id: paymentDetail.so_quy_tien_mat_id || '',
      chuyen_khoan: Number(paymentDetail.chuyen_khoan || 0),
      so_quy_chuyen_khoan_id: paymentDetail.so_quy_chuyen_khoan_id || '',
      tien_tra_khach: 0
    });
    payload._paymentInfo = await buildReceiptPaymentInfo(payload, {
      cuaHangId: returnDoc.cua_hang_id,
      chiNhanhId: returnDoc.chi_nhanh_id,
      session: options.session
    });
  }
  return taoPhieuThuChi(payload, { session: options.session });
}

async function createSupplierRefundPaymentReceipt(returnDoc, userId, payment, cashBookId, options = {}) {
  const amount = Number(payment && payment.amount || 0);
  if (!returnDoc || !returnDoc.nha_cung_cap_id || !Number.isFinite(amount) || amount <= 0) return null;
  const paymentDetail = payment.detail || { tien_mat: amount, chuyen_khoan: 0, tien_tra_khach: 0 };
  paymentDetail.tien_tra_khach = 0;
  const isV2 = payment.isV2
    || String(paymentDetail.so_quy_tien_mat_id || '').trim() !== ''
    || String(paymentDetail.so_quy_chuyen_khoan_id || '').trim() !== '';
  if (!isV2 && !isObjectId(cashBookId)) throw new Error('Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.');
  const payload = {
    loai_phieu: 'thu',
    loai_thu_chi: 'NCC hoan tien tra hang nhap',
    gia_tri: amount,
    ngay_lap: new Date(),
    so_quy_id: isV2 ? undefined : cashBookId,
    cua_hang_id: returnDoc.cua_hang_id,
    nguoi_tao_id: userId,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_tra_hang_nhap_id: returnDoc._id,
    ma_chung_tu_goc: returnDoc.ma_phieu_tra_nhap,
    nhom_doi_tuong: 'nha_cung_cap',
    phuong_thuc_thanh_toan: normalizePaymentMethod(paymentMethodFromDetail(paymentDetail)),
    chi_tiet_thanh_toan: paymentDetail,
    ghi_chu: 'Nhận tiền trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    hach_toan: false
  };
  if (isV2) {
    Object.assign(payload, {
      payment_v2: true,
      tien_mat: Number(paymentDetail.tien_mat || 0),
      so_quy_tien_mat_id: paymentDetail.so_quy_tien_mat_id || '',
      chuyen_khoan: Number(paymentDetail.chuyen_khoan || 0),
      so_quy_chuyen_khoan_id: paymentDetail.so_quy_chuyen_khoan_id || '',
      tien_tra_khach: 0
    });
    payload._paymentInfo = await buildReceiptPaymentInfo(payload, {
      cuaHangId: returnDoc.cua_hang_id,
      chiNhanhId: returnDoc.chi_nhanh_id,
      session: options.session
    });
  }
  return taoPhieuThuChi(payload, { session: options.session });
}

async function repairMissingSupplierRefundReceipts(returns, userId) {
  const candidates = (Array.isArray(returns) ? returns : []).filter(row => (
    row
    && String(row.trang_thai || '') === 'completed'
    && Number(row.ncc_da_tra || 0) > 0
    && row.nha_cung_cap_id
  ));
  if (!candidates.length) return;
  const ids = candidates.map(row => row._id).filter(Boolean);
  const existing = await PhieuThuChi.find({
    phieu_tra_hang_nhap_id: { $in: ids },
    loai_phieu: 'thu',
    trang_thai: { $ne: 'cancelled' }
  }).select('phieu_tra_hang_nhap_id').lean();
  const existingSet = new Set(existing.map(row => String(row.phieu_tra_hang_nhap_id)));
  for (const row of candidates) {
    if (existingSet.has(String(row._id))) continue;
    await createSupplierRefundReceipt(row, userId, { hach_toan: false });
  }
}

function slugReturnExportFilename(ma) {
  var s = String(ma || 'phieu').trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'phieu';
}

async function sendSingleReturnDetailWorkbook(res, ticket, details) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Chi tiết');
  var rowIdx = 1;
  function addPair(label, value) {
    ws.getCell(rowIdx, 1).value = label;
    ws.getCell(rowIdx, 2).value = value == null ? '' : value;
    rowIdx += 1;
  }
  addPair('Mã phiếu trả hàng nhập', ticket.ma_phieu_tra_nhap || '');
  addPair('Trạng thái', RETURN_IMPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '');
  addPair('Ngày trả', formatExportDate(ticket.ngay_tra || ticket.created_at));
  addPair('Nhà cung cấp', ticket.nha_cung_cap_id ? (ticket.nha_cung_cap_id.ten_ncc || ticket.nha_cung_cap_id.ma_ncc || '') : '');
  addPair('Kho', ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '');
  addPair('Phiếu nhập gốc', ticket.phieu_nhap_id ? (ticket.phieu_nhap_id.ma_phieu_nhap || '') : '');
  addPair('Người tạo', getUserName(ticket.nguoi_tao_id));
  addPair('Người trả', getUserName(ticket.nguoi_tra_id));
  addPair('Lý do', ticket.ly_do || '');
  addPair('Ghi chú', ticket.ghi_chu || '');
  rowIdx += 1;
  addPair('--- Chi tiết hàng ---', '');
  var hdr = ['Mã hàng', 'Tên hàng', 'Lô', 'Số lượng', 'Đơn giá', 'Giá nhập', 'Giá trả lại', 'Thành tiền', 'Ghi chú dòng'];
  hdr.forEach(function(h, i) {
    ws.getCell(rowIdx, i + 1).value = h;
  });
  rowIdx += 1;
  (details || []).forEach(function(d) {
    var p = d.hang_hoa_id || {};
    var lot = d.lo_hang_id || {};
    ws.getCell(rowIdx, 1).value = p.ma_hang || '';
    ws.getCell(rowIdx, 2).value = p.ten_hang || '';
    ws.getCell(rowIdx, 3).value = getLotName(lot);
    ws.getCell(rowIdx, 4).value = Number(d.so_luong || 0);
    ws.getCell(rowIdx, 5).value = Number(d.don_gia || 0);
    ws.getCell(rowIdx, 6).value = Number(d.gia_nhap || 0);
    ws.getCell(rowIdx, 7).value = Number(d.gia_tra_lai || 0);
    ws.getCell(rowIdx, 8).value = Number(d.thanh_tien || 0);
    ws.getCell(rowIdx, 9).value = d.ghi_chu || '';
    rowIdx += 1;
  });
  rowIdx += 1;
  addPair('Số lượng mặt hàng', details ? details.length : 0);
  addPair('Tổng tiền hàng', Number(ticket.tong_tien_hang || 0));
  addPair('Giảm giá', ticket.kieu_giam_gia === 'percent' ? String(ticket.giam_gia || 0) + '%' : Number(ticket.giam_gia || 0));
  addPair('NCC cần trả', Number(ticket.ncc_can_tra || 0));
  addPair('NCC đã trả', Number(ticket.ncc_da_tra || 0));
  addPair('Tổng tiền trả', Number(ticket.tong_tien_tra || 0));

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 36;
  for (var c = 1; c <= 9; c++) {
    ws.getColumn(c).width = Math.max(ws.getColumn(c).width || 12, 14);
  }

  var fname = 'phieu-tra-hang-nhap-' + slugReturnExportFilename(ticket.ma_phieu_tra_nhap) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
  await workbook.xlsx.write(res);
  res.end();
}

exports.index = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    let page = parseReturnImportPage(req.query);
    const pageSize = RETURN_IMPORT_PAGE_SIZE;
    const [total, users, cashBooks] = await Promise.all([
      PhieuTraHangNhap.countDocuments(query),
      NguoiDung.find(isObjectId(storeId) ? { cua_hang_id: storeId } : {}).sort({ ho_ten: 1, email: 1 }).lean(),
      SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }).lean()
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    const skip = (page - 1) * pageSize;
    const returns = await PhieuTraHangNhap.find(query)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
      .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
      .populate({ path: 'nguoi_tra_id', select: 'ho_ten email' })
      .sort({ ngay_tra: -1, created_at: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();
    await repairMissingSupplierRefundReceipts(returns, req.user?._id);

    const returnIds = returns.map(row => row._id);
    let detailRows = [];
    if (returnIds.length) {
      detailRows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: { $in: returnIds } })
        .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang quan_ly_theo_lo' })
        .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
        .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
        .sort({ created_at: 1 })
        .lean();
    }
    const detailsByReturn = detailRows.reduce((map, row) => {
      const key = String(row.phieu_tra_nhap_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});
    const vatChuaByReturn = await loadReturnsLinkedVatChuaMap(returnIds, storeId);
    returns.forEach(row => {
      row.detail_rows = detailsByReturn[String(row._id)] || [];
      row.vat_chua_lines = vatChuaByReturn[String(row._id)] || [];
      const detailList = row.detail_rows || [];
      const uniqueProducts = new Set();
      detailList.forEach(item => {
        const p = item && item.hang_hoa_id;
        const id = p && p._id ? String(p._id) : String(item.hang_hoa_id || '');
        if (id && id !== 'undefined') uniqueProducts.add(id);
      });
      row.detail_summary = {
        tong_mat_hang: uniqueProducts.size || detailList.length,
        tong_so_luong: detailList.reduce((sum, item) => sum + Number(item.so_luong || 0), 0)
      };
    });

    res.render('tra-hang-nhap/index', {
      activeMenu: 'mua-hang',
      user: req.user,
      returns,
      users,
      cashBooks,
      filters: req.query || {},
      formatDate,
      statusLabel,
      pagination: {
        total,
        page,
        limit: pageSize,
        totalPages,
        from: total === 0 ? 0 : skip + 1,
        to: Math.min(skip + pageSize, total)
      },
      qs: function(overrides) {
        return buildReturnImportListQueryString(req.query || {}, overrides || {});
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.previewTrash = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const ids = req.body && (req.body.phieu_tra_hang_nhap_ids || req.body.ids);
    const data = await previewReturnImportTrash(ids, storeId);
    return res.json({ success: true, data: data });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không xem trước được dữ liệu xóa.' });
  }
};

exports.moveToTrash = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const ids = req.body && (req.body.phieu_tra_hang_nhap_ids || req.body.ids);
    const userId = req.user && req.user._id ? req.user._id : null;
    const data = await moveReturnImportToTrash(ids, storeId, userId);
    return res.json({
      success: true,
      message: 'Đã đưa ' + data.moved_count + ' phiếu trả hàng nhập vào thùng rác.',
      data: data
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không đưa vào thùng rác được.' });
  }
};

exports.deactivateSelected = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    let ids = req.body && (req.body.phieu_tra_hang_nhap_ids || req.body.ids);
    ids = Array.isArray(ids) ? ids : [];
    ids = ids.map(id => String(id || '').trim()).filter(isObjectId);
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một phiếu trả hàng nhập.' });
    }
    const filter = { _id: { $in: ids } };
    if (isObjectId(storeId)) filter.cua_hang_id = storeId;
    const result = await PhieuTraHangNhap.updateMany(
      activeReturnImportDataFilter(filter),
      { $set: { trang_thai_du_lieu: 'inactive', updated_at: new Date() } }
    );
    return res.json({
      success: true,
      message: 'Đã xóa phiếu trả hàng nhập đã chọn.',
      data: { modified_count: result.modifiedCount || result.nModified || 0 }
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không xóa được phiếu trả hàng nhập.' });
  }
};

exports.createPage = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const data = await loadCreateData(storeId);
    const nextCode = await makeReturnCode();
    const copyFromId = String(req.query?.copy_from || '').trim();
    let copyDraft = null;
    let copyFromError = '';
    if (isObjectId(copyFromId)) {
      copyDraft = await loadReturnCopyDraft(req, storeId, copyFromId);
      if (!copyDraft) {
        copyFromError = 'Không tải được phiếu để sao chép, phiếu không có chi tiết, hoặc thiếu kho.';
      }
    }
    const selectedPurchaseId = copyDraft && copyDraft.phieu_nhap_id
      ? String(copyDraft.phieu_nhap_id)
      : String(req.query?.phieu_nhap_id || '').trim();
    const selectedPurchase = !copyDraft && isObjectId(selectedPurchaseId)
      ? await PhieuNhap.findOne(activePurchaseDataFilter({ _id: selectedPurchaseId })).select('_id kho_id nha_cung_cap_id').lean()
      : null;
    const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
    res.render('tra-hang-nhap/create', {
      activeMenu: 'mua-hang',
      user: req.user,
      nextCode,
      todayValue: new Date().toISOString().slice(0, 16),
      warehouses: data.warehouses,
      suppliers: data.suppliers,
      users: data.users,
      cashBooks: data.cashBooks || [],
      vatChuaList: data.vatChuaList || [],
      productsJson: JSON.stringify(data.productOptions),
      receipts: data.receipts,
      selectedPurchaseId: copyDraft && copyDraft.phieu_nhap_id ? String(copyDraft.phieu_nhap_id) : (selectedPurchase ? String(selectedPurchase._id) : ''),
      selectedPurchaseKhoId: copyDraft && copyDraft.kho_id ? String(copyDraft.kho_id) : (selectedPurchase ? getObjectIdValue(selectedPurchase.kho_id) : ''),
      selectedPurchaseSupplierId: copyDraft && copyDraft.nha_cung_cap && copyDraft.nha_cung_cap._id
        ? String(copyDraft.nha_cung_cap._id)
        : (selectedPurchase ? getObjectIdValue(selectedPurchase.nha_cung_cap_id) : ''),
      copyDraftJson,
      copyFromError
    });
  } catch (error) {
    next(error);
  }
};

async function buildPurchaseReturnGridItems(purchase, storeId, requestedKhoId, options = {}) {
  void storeId;
  void requestedKhoId;
  const ignoreReturnIds = new Set((options.ignorePhieuTraNhapIds || []).filter(id => isObjectId(id)).map(id => String(id)));
  const details = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo' })
    .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
    .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo so_luong_con_lai han_su_dung ngay_nhap' })
    .populate({ path: 'gia_tri_thuoc_tinh_id', select: 'ten_gia_tri ma_gia_tri' })
    .sort({ created_at: 1 })
    .lean();

  const returnRows = await CTPhieuTraHangNhap.find({ phieu_nhap_id: purchase._id })
    .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai trang_thai_du_lieu deleted_at' })
    .lean();

  const returnedBySlot = {};
  returnRows.forEach(row => {
    if (!isEffectiveReturnHeader(row.phieu_tra_nhap_id)) return;
    const retId = row.phieu_tra_nhap_id && (row.phieu_tra_nhap_id._id || row.phieu_tra_nhap_id);
    if (retId && ignoreReturnIds.has(String(retId))) return;
    if (!row.ct_phieu_nhap_id) return;
    const ctId = String(row.ct_phieu_nhap_id);
    const key = parseReturnLineSlotKey(ctId, row);
    returnedBySlot[key] = (returnedBySlot[key] || 0) + Number(row.so_luong || 0);
  });

  const khoRef = getObjectIdValue(purchase.kho_id) || purchase.kho_id;
  const productIds = [...new Set(details.map(r => {
    const h = r.hang_hoa_id;
    return h && h._id ? String(h._id) : String(r.hang_hoa_id || '');
  }).filter(isObjectId))];

  const inventoryRows = productIds.length
    ? await TonKho.find({ kho_id: khoRef, hang_hoa_id: { $in: productIds } }).lean()
    : [];
  const inventoryByProduct = inventoryRows.reduce((map, row) => {
    map[String(row.hang_hoa_id)] = Number(row.so_luong || 0);
    return map;
  }, {});

  const lotIds = [...new Set(details.map(row => row.lo_hang_id && row.lo_hang_id._id).filter(Boolean).map(id => String(id)))];
  const lotInventoryRows = lotIds.length
    ? await TonKhoLo.find({
      kho_id: khoRef,
      lo_hang_id: { $in: lotIds },
      $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
    }).lean()
    : [];
  const inventoryByLot = lotInventoryRows.reduce((map, row) => {
    map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
    return map;
  }, {});

  const out = [];

  for (const row of details) {
    const slots = expandCtPhieuNhapReturnSlots(row);
    const productId = row.hang_hoa_id && row.hang_hoa_id._id ? String(row.hang_hoa_id._id) : String(row.hang_hoa_id || '');
    const maHang = row.hang_hoa_id ? (row.hang_hoa_id.ma_hang || '') : '';
    const tenHangBase = row.hang_hoa_id ? (row.hang_hoa_id.ten_hang || '') : '';

    for (const slot of slots) {
      const importedQty = Number(slot.importedQty || 0);
      const returnedQty = Number(returnedBySlot[slot.slotKey] || 0);
      const canReturnByPurchase = Math.max(0, importedQty - returnedQty);

      const lotId = slot.lotId || '';
      let qcDoc = null;
      if (lotId && slot.ten_quy_cach) {
        qcDoc = await TonKhoLoQuyCach.findOne({
          kho_id: khoRef,
          hang_hoa_id: productId,
          lo_hang_id: lotId,
          $or: [{ ten_quy_cach: slot.ten_quy_cach }, { ten_thuoc_tinh: slot.ten_quy_cach }]
        }).lean();
      }

      let giaNhapLine = Number(slot.gia_nhap || 0);
      if (qcDoc) {
        const fromQc = Number(qcDoc.don_gia_nhap || qcDoc.gia_von || 0);
        if (fromQc > 0) giaNhapLine = fromQc;
      }

      const tonQc = qcDoc ? Number(qcDoc.so_luong || 0) : 0;
      const tonProduct = Number(inventoryByProduct[productId] || 0);
      const tonLotAgg = lotId ? Number(inventoryByLot[lotId] || 0) : 0;
      const currentStock = slot.ten_quy_cach && qcDoc ? tonQc : (lotId ? tonLotAgg : tonProduct);

      const maxTra = Math.min(canReturnByPurchase, currentStock);

      const gttOut = slot.gia_tri_thuoc_tinh_id ? String(slot.gia_tri_thuoc_tinh_id) : '';
      const tenQcDisp = slot.ten_quy_cach ? slot.ten_quy_cach : '--';

      const gridRow = {
        ct_phieu_nhap_id: slot.ctId,
        phieu_nhap_id: String(purchase._id),
        hang_hoa_id: productId,
        ma_hang: maHang,
        ten_hang: tenHangBase,
        ten_quy_cach: slot.ten_quy_cach || '',
        ten_thuoc_tinh: slot.ten_quy_cach || '',
        thuoc_tinh_label: tenQcDisp,
        gia_tri_thuoc_tinh_id: gttOut,
        ton_kho_lo_quy_cach_id: qcDoc ? String(qcDoc._id) : '',
        don_vi_tinh_id: row.don_vi_tinh_id ? String(row.don_vi_tinh_id._id || row.don_vi_tinh_id) : '',
        don_vi_tinh: row.don_vi_tinh_id ? (row.don_vi_tinh_id.ten_don_vi || row.don_vi_tinh_id.ma_don_vi || '') : '',
        quan_ly_theo_lo: Boolean(row.hang_hoa_id && row.hang_hoa_id.quan_ly_theo_lo),
        lo_hang_id: lotId,
        ma_lo: row.lo_hang_id ? (row.lo_hang_id.ma_lo || '') : '',
        ten_lo: row.lo_hang_id ? (row.lo_hang_id.ten_lo || '') : '',
        ngay_nhap_lo: row.lo_hang_id && row.lo_hang_id.ngay_nhap ? row.lo_hang_id.ngay_nhap : null,
        han_su_dung: row.lo_hang_id && row.lo_hang_id.han_su_dung ? row.lo_hang_id.han_su_dung : null,
        so_luong_nhap: importedQty,
        tong_so_luong_da_tra: returnedQty,
        so_luong_con_co_the_tra: canReturnByPurchase,
        ton_kho_hien_tai: currentStock,
        so_luong_toi_da_tra: maxTra,
        so_luong: 0,
        gia_nhap: giaNhapLine,
        gia_tra_lai: giaNhapLine,
        thanh_tien: 0,
        ghi_chu: '',
        multi_quy_cach_trong_lo: Boolean(slot.multi_quy_cach),
        so_luong_da_nhap: importedQty,
        so_luong_da_tra: returnedQty,
        con_co_the_tra: canReturnByPurchase
      };

      if (canReturnByPurchase > 0) out.push(gridRow);
    }
  }

  return out;
}

async function buildGridItemFromReturnLine(line, khoId, storeId) {
  void storeId;
  const hangId = line.hang_hoa_id && line.hang_hoa_id._id ? String(line.hang_hoa_id._id) : String(line.hang_hoa_id || '');
  if (!isObjectId(hangId) || !isObjectId(khoId)) return null;
  const product = line.hang_hoa_id && line.hang_hoa_id._id
    ? line.hang_hoa_id
    : await HangHoa.findById(hangId).select('ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo').lean();
  if (!product) return null;

  let tenHang = product.ten_hang || '';
  let giaTriId = '';
  const tenQcLine = String(line.ten_quy_cach || '').trim();
  if (line.ct_phieu_nhap_id) {
    const ctPn = await CTPhieuNhap.findById(line.ct_phieu_nhap_id)
      .populate({ path: 'gia_tri_thuoc_tinh_id', select: 'ten_gia_tri ma_gia_tri' })
      .lean();
    if (ctPn && ctPn.gia_tri_thuoc_tinh_id && !tenQcLine) {
      const g = ctPn.gia_tri_thuoc_tinh_id;
      giaTriId = g._id ? String(g._id) : String(ctPn.gia_tri_thuoc_tinh_id);
      const gl = (g.ten_gia_tri || g.ma_gia_tri || '').trim();
      if (gl) tenHang = tenHang ? `${tenHang} · ${gl}` : gl;
    }
  }

  const lotId = line.lo_hang_id && line.lo_hang_id._id ? String(line.lo_hang_id._id) : (line.lo_hang_id ? String(line.lo_hang_id) : '');
  const inv = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangId }).lean();
  const ton = Number(inv && inv.so_luong || 0);
  let tonLo = ton;
  let tonKhoLoQcIdStr = '';
  if (product.quan_ly_theo_lo && lotId && tenQcLine) {
    const qc = await TonKhoLoQuyCach.findOne({
      kho_id: khoId,
      hang_hoa_id: hangId,
      lo_hang_id: lotId,
      $or: [{ ten_quy_cach: tenQcLine }, { ten_thuoc_tinh: tenQcLine }]
    }).lean();
    tonLo = qc ? Number(qc.so_luong || 0) : 0;
    if (qc) tonKhoLoQcIdStr = String(qc._id);
  } else if (product.quan_ly_theo_lo && lotId) {
    const tl = await TonKhoLo.findOne({
      kho_id: khoId,
      hang_hoa_id: hangId,
      lo_hang_id: lotId,
      $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
    }).lean();
    tonLo = Number(tl && tl.so_luong || 0);
  }

  let donViTinh = '';
  let donViId = '';
  if (line.don_vi_tinh_id && line.don_vi_tinh_id._id) {
    donViId = String(line.don_vi_tinh_id._id);
    donViTinh = line.don_vi_tinh_id.ten_don_vi || line.don_vi_tinh_id.ma_don_vi || '';
  } else if (product.don_vi_tinh_id) {
    donViId = String(product.don_vi_tinh_id);
    const u = await DonViTinh.findById(product.don_vi_tinh_id).select('ma_don_vi ten_don_vi').lean();
    if (u) donViTinh = u.ten_don_vi || u.ma_don_vi || '';
  }

  const gttLine = line.gia_tri_thuoc_tinh_id && (line.gia_tri_thuoc_tinh_id._id || line.gia_tri_thuoc_tinh_id)
    ? String(line.gia_tri_thuoc_tinh_id._id || line.gia_tri_thuoc_tinh_id)
    : (giaTriId || '');
  const tonKhoLoQcFromLine = line.ton_kho_lo_quy_cach_id && (line.ton_kho_lo_quy_cach_id._id || line.ton_kho_lo_quy_cach_id)
    ? String(line.ton_kho_lo_quy_cach_id._id || line.ton_kho_lo_quy_cach_id)
    : '';

  return {
    ct_phieu_nhap_id: line.ct_phieu_nhap_id ? String(line.ct_phieu_nhap_id) : '',
    phieu_nhap_id: line.phieu_nhap_id ? String(line.phieu_nhap_id) : '',
    hang_hoa_id: hangId,
    ma_hang: product.ma_hang || '',
    ten_hang: tenHang,
    ten_quy_cach: tenQcLine,
    ten_thuoc_tinh: tenQcLine,
    thuoc_tinh_label: tenQcLine ? tenQcLine : '--',
    don_vi_tinh_id: donViId,
    don_vi_tinh: donViTinh,
    quan_ly_theo_lo: Boolean(product.quan_ly_theo_lo),
    lo_hang_id: lotId,
    ma_lo: line.lo_hang_id ? (line.lo_hang_id.ma_lo || '') : '',
    ten_lo: line.lo_hang_id ? (line.lo_hang_id.ten_lo || '') : '',
    ngay_nhap_lo: line.lo_hang_id && line.lo_hang_id.ngay_nhap ? line.lo_hang_id.ngay_nhap : null,
    gia_tri_thuoc_tinh_id: gttLine,
    ton_kho_lo_quy_cach_id: tonKhoLoQcFromLine || tonKhoLoQcIdStr,
    so_luong_nhap: 0,
    tong_so_luong_da_tra: 0,
    so_luong_con_co_the_tra: tonLo,
    ton_kho_hien_tai: tonLo,
    so_luong_toi_da_tra: tonLo,
    so_luong: 0,
    gia_nhap: Number(line.gia_nhap || 0),
    gia_tra_lai: Number(line.gia_tra_lai || line.don_gia || 0),
    ghi_chu: String(line.ghi_chu || '').trim(),
    thanh_tien: 0
  };
}

async function buildReturnLinesOnlyGridItems(lines, khoId) {
  if (!isObjectId(khoId)) return [];
  const out = [];
  for (const line of lines) {
    const row = await buildGridItemFromReturnLine(line, khoId, '');
    if (!row) continue;
    const copiedQty = Math.floor(Number(line.so_luong || 0));
    const maxTra = Number(row.so_luong_toi_da_tra != null ? row.so_luong_toi_da_tra : row.so_luong_con_co_the_tra || 0);
    row.so_luong = Math.min(Math.max(0, copiedQty), Math.max(0, maxTra));
    row.gia_nhap = Number(line.gia_nhap || row.gia_nhap || 0);
    row.gia_tra_lai = Number(line.gia_tra_lai || line.don_gia || row.gia_tra_lai || 0);
    row.ghi_chu = String(line.ghi_chu || '').trim();
    out.push(row);
  }
  return out;
}

async function loadReturnCopyDraft(req, storeId, copyFromId) {
  if (!isObjectId(copyFromId) || !isObjectId(storeId)) return null;
  const source = await PhieuTraHangNhap.findOne(activeReturnImportDataFilter({ _id: copyFromId, cua_hang_id: storeId }))
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .lean();
  if (!source) return null;

  const lines = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: source._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo' })
    .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
    .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
    .sort({ created_at: 1 })
    .lean();

  if (!lines.length) return null;

  const khoId = getObjectIdValue(source.kho_id);
  const phieuNhapId = getObjectIdValue(source.phieu_nhap_id);

  let gridItems = [];

  if (isObjectId(phieuNhapId) && isObjectId(khoId)) {
    const purchaseFilter = { _id: phieuNhapId, kho_id: khoId };
    if (isObjectId(storeId)) purchaseFilter.cua_hang_id = storeId;
    const purchase = await PhieuNhap.findOne(activePurchaseDataFilter(purchaseFilter))
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .lean();
    if (purchase) {
      const baseItems = await buildPurchaseReturnGridItems(purchase, storeId, khoId, {
        ignorePhieuTraNhapIds: [String(copyFromId)]
      });
      const bySlot = {};
      baseItems.forEach(row => {
        if (!row.ct_phieu_nhap_id) return;
        const k = parseReturnLineSlotKey(String(row.ct_phieu_nhap_id), row);
        bySlot[k] = row;
      });
      for (const line of lines) {
        const ctId = line.ct_phieu_nhap_id ? String(line.ct_phieu_nhap_id) : '';
        const slotK = ctId ? parseReturnLineSlotKey(ctId, line) : '';
        let row = slotK && bySlot[slotK] ? Object.assign({}, bySlot[slotK]) : await buildGridItemFromReturnLine(line, khoId, storeId);
        if (!row) continue;
        const copiedQty = Math.floor(Number(line.so_luong || 0));
        const maxTra = Number(row.so_luong_toi_da_tra != null ? row.so_luong_toi_da_tra : row.so_luong_con_co_the_tra || 0);
        row.so_luong = Math.min(Math.max(0, copiedQty), Math.max(0, maxTra));
        row.gia_nhap = Number(line.gia_nhap || row.gia_nhap || 0);
        row.gia_tra_lai = Number(line.gia_tra_lai || line.don_gia || row.gia_tra_lai || 0);
        row.ghi_chu = String(line.ghi_chu || '').trim();
        gridItems.push(row);
      }
    } else {
      gridItems = await buildReturnLinesOnlyGridItems(lines, khoId);
    }
  } else if (isObjectId(khoId)) {
    gridItems = await buildReturnLinesOnlyGridItems(lines, khoId);
  } else {
    return null;
  }

  const supplier = source.nha_cung_cap_id && source.nha_cung_cap_id._id
    ? {
      _id: String(source.nha_cung_cap_id._id),
      ma_ncc: source.nha_cung_cap_id.ma_ncc || '',
      ten_ncc: source.nha_cung_cap_id.ten_ncc || ''
    }
    : null;

  return {
    kho_id: khoId,
    phieu_nhap_id: phieuNhapId,
    nha_cung_cap: supplier,
    giam_gia: Number(source.giam_gia || 0),
    kieu_giam_gia: source.kieu_giam_gia === 'percent' ? 'percent' : 'vnd',
    ghi_chu: String(source.ghi_chu || ''),
    tinh_vao_cong_no: source.tinh_vao_cong_no !== false,
    require_phieu_nhap: Boolean(phieuNhapId),
    items: gridItems
  };
}

exports.apiPurchaseReturnDetail = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const purchaseId = String(req.params.id || '').trim();
    if (!isObjectId(purchaseId)) {
      return res.status(400).json({ success: false, message: 'Phiếu nhập không hợp lệ' });
    }

    const purchaseFilter = { _id: purchaseId };
    if (isObjectId(storeId)) purchaseFilter.cua_hang_id = storeId;
    const requestedKhoId = String(req.query.kho_id || '').trim();
    if (isObjectId(requestedKhoId)) purchaseFilter.kho_id = requestedKhoId;
    const purchase = await PhieuNhap.findOne(activePurchaseDataFilter(purchaseFilter))
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .lean();
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    }

    try {
      assertPurchaseEligibleForReturnImport(purchase, { khoId: requestedKhoId });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : 'Phiếu nhập không được phép trả hàng nhập';
      return res.status(400).json({ success: false, message: msg });
    }

    const items = await buildPurchaseReturnGridItems(purchase, storeId, requestedKhoId, {});
    const deadlineEnd = getPurchaseReturnDeadlineEnd(purchase);

    const supplier = purchase.nha_cung_cap_id
      ? {
        _id: getObjectIdValue(purchase.nha_cung_cap_id),
        ma_ncc: purchase.nha_cung_cap_id.ma_ncc || '',
        ten_ncc: purchase.nha_cung_cap_id.ten_ncc || ''
      }
      : null;

    return res.json({
      success: true,
      data: {
        phieu_nhap: {
          _id: String(purchase._id),
          ma_phieu_nhap: purchase.ma_phieu_nhap || '',
          ngay_nhap: purchase.ngay_nhap || purchase.created_at || null,
          kho_id: getObjectIdValue(purchase.kho_id),
          kho: purchase.kho_id || null,
          nha_cung_cap_id: supplier ? supplier._id : '',
          nha_cung_cap: supplier,
          trang_thai: purchase.trang_thai || '',
          ngay_het_han_tra: deadlineEnd ? deadlineEnd.toISOString() : null,
          so_ngay_duoc_tra_hang_nhap: purchase.so_ngay_duoc_tra_hang_nhap,
          han_tra_hang_nhap: purchase.han_tra_hang_nhap || null
        },
        nha_cung_cap: supplier,
        items: items,
        chi_tiet: items
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải chi tiết phiếu nhập' });
  }
};

exports.apiPurchasesByWarehouse = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const khoId = String((req.params && req.params.khoId) || (req.query && req.query.kho_id) || '').trim();
    if (!isObjectId(khoId)) {
      return res.status(400).json({ success: false, message: 'Kho không hợp lệ' });
    }

    const purchases = await listEligiblePurchasesForReturnImport(storeId, khoId);

    const items = purchases.map(row => {
      const supplier = row.nha_cung_cap_id
        ? {
          _id: getObjectIdValue(row.nha_cung_cap_id),
          ma_ncc: row.nha_cung_cap_id.ma_ncc || '',
          ten_ncc: row.nha_cung_cap_id.ten_ncc || ''
        }
        : null;
      const deadlineEnd = getPurchaseReturnDeadlineEnd(row);
      return {
        _id: String(row._id),
        ma_phieu_nhap: row.ma_phieu_nhap || '',
        ngay_nhap: row.ngay_nhap || row.created_at || null,
        ngay_het_han_tra: deadlineEnd ? deadlineEnd.toISOString() : null,
        lot_names: Array.isArray(row.lot_names) ? row.lot_names : [],
        kho_id: getObjectIdValue(row.kho_id),
        nha_cung_cap_id: supplier ? supplier._id : '',
        nha_cung_cap: supplier
      };
    });

    return res.json({ success: true, items });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải phiếu nhập theo kho' });
  }
};

exports.createSubmit = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    if (!isObjectId(storeId)) return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ' });

    const body = req.body || {};
    const submitMode = body.submitMode === 'completed' ? 'completed' : 'draft';
    const khoId = String(body.kho_id || '').trim();
    let supplierId = isObjectId(body.nha_cung_cap_id) ? String(body.nha_cung_cap_id) : '';
    const phieuNhapId = isObjectId(body.phieu_nhap_id) ? String(body.phieu_nhap_id) : '';
    if (phieuNhapId) {
      const purchase = await PhieuNhap.findOne(activePurchaseDataFilter({ _id: phieuNhapId })).select('nha_cung_cap_id kho_id').lean();
      if (!purchase) return res.status(400).json({ success: false, message: 'Phiếu nhập gốc không hợp lệ' });
      const purchaseSupplierId = purchase.nha_cung_cap_id ? getObjectIdValue(purchase.nha_cung_cap_id) : '';
      if (supplierId && purchaseSupplierId && supplierId !== purchaseSupplierId) {
        return res.status(400).json({ success: false, message: 'Không cho chọn nhà cung cấp khác với phiếu nhập gốc' });
      }
      supplierId = purchaseSupplierId || supplierId;
    } else if (!supplierId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà cung cấp hoặc phiếu nhập gốc' });
    }
    const discountType = ['vnd', 'percent'].includes(String(body.kieu_giam_gia || '').trim()) ? String(body.kieu_giam_gia).trim() : 'vnd';
    const requestedReturnDate = body.ngay_tra ? new Date(body.ngay_tra) : null;
    const returnDate = requestedReturnDate && !isNaN(requestedReturnDate.getTime()) ? requestedReturnDate : new Date();
    const rawItems = parseItems(body.items_json || body.items);
    let detailRows = submitMode === 'completed'
      ? await validateReturnItems({ items: rawItems, storeId, khoId, phieuNhapId })
      : await validateReturnItems({ items: rawItems, storeId, khoId, phieuNhapId }).catch(error => {
        if (String(error.message || '').includes('tồn kho')) throw error;
        throw error;
    });
    const totals = computeTotals(detailRows, parseMoney(body.giam_gia || 0), discountType);
    const payment = normalizePaymentDetail(body, totals.ncc_can_tra);
    const nccDaTra = payment.amount;
    const cashBookId = resolveCashBookIdFromBody(body);
    const paymentMethod = paymentMethodFromDetail(payment.detail);
    if (nccDaTra > 0 && !payment.isV2 && !isObjectId(cashBookId)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.' });
    }
    const vatChuaParsed = parseVatChuaImportInput(body);
    if (submitMode === 'completed') {
      try {
        assertVatChuaImportInput(vatChuaParsed);
      } catch (vatChuaInputError) {
        return res.status(400).json({ success: false, message: vatChuaInputError.message });
      }
      if (vatChuaParsed.vatChuaId && vatChuaParsed.qty > 0) {
        const vatChuaRow = await VatChua.findOne({
          _id: vatChuaParsed.vatChuaId,
          cua_hang_id: storeId,
          trang_thai: 'active'
        }).select('so_luong_ton ten_vat_chua').lean();
        if (!vatChuaRow) {
          return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng' });
        }
        const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
        if (tonVatChua < vatChuaParsed.qty) {
          return res.status(400).json({
            success: false,
            message: 'Tồn vật chứa không đủ để xuất (còn ' + tonVatChua + ', cần ' + vatChuaParsed.qty + ')'
          });
        }
      }
    }
    let supplierName = '';
    if (supplierId) {
      const supplierRow = await NhaCungCap.findById(supplierId).select('ten_ncc').lean();
      supplierName = supplierRow && supplierRow.ten_ncc ? String(supplierRow.ten_ncc).trim() : '';
    }
    const maPhieu = String(body.ma_phieu_tra_nhap || '').trim() || await makeReturnCode();
    let returnDoc;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await acquirePurchaseGroupMutationLock(storeId, session);
        if (phieuNhapId) {
          const currentPurchase = await PhieuNhap.findOne(activePurchaseDataFilter({ _id: phieuNhapId, cua_hang_id: storeId }))
            .select('nha_cung_cap_id').session(session).lean();
          if (!currentPurchase || getObjectIdValue(currentPurchase.nha_cung_cap_id) !== supplierId) {
            throw new Error('Phiếu nhập gốc đã thay đổi, vui lòng tải lại trước khi trả hàng');
          }
        }
        detailRows = await validateReturnItems({
          items: parseItems(body.items_json || body.items), storeId, khoId, phieuNhapId, session
        });
        const createdRows = await PhieuTraHangNhap.create([{
          cua_hang_id: storeId,
          kho_id: khoId,
          ma_phieu_tra_nhap: maPhieu,
          ngay_tra: returnDate,
          nha_cung_cap_id: supplierId || undefined,
          phieu_nhap_id: phieuNhapId || undefined,
          tong_tien_hang: totals.tong_tien_hang,
          giam_gia: totals.giam_gia,
          kieu_giam_gia: discountType,
          ncc_can_tra: totals.ncc_can_tra,
          ncc_da_tra: nccDaTra,
          ncc_con_phai_tra: Math.max(0, Number(totals.ncc_can_tra || 0) - Number(nccDaTra || 0)),
          so_quy_id: !payment.isV2 && isObjectId(cashBookId) ? cashBookId : undefined,
          chi_tiet_thanh_toan: payment.detail,
          tinh_vao_cong_no: true,
          tong_tien_tra: totals.tong_tien_tra,
          trang_thai: submitMode,
          ghi_chu: String(body.ghi_chu || '').trim(),
          nguoi_tao_id: req.user?._id,
          nguoi_tra_id: req.user?._id
        }], { session });
        returnDoc = createdRows[0];
        await persistDetails(returnDoc._id, detailRows, { session });

        if (submitMode === 'completed') {
          await completeInventory(returnDoc, detailRows, req.user?._id, { session });
          await exportVatChuaWithPurchaseReturn(returnDoc, {
            vat_chua_id: vatChuaParsed.vatChuaId,
            vat_chua_so_luong: vatChuaParsed.qty,
            nha_cung_cap_ten: supplierName
          }, session);
          await applySupplierDebt(returnDoc, { session });
          await requireSupplierRefundReceipt(returnDoc, req.user?._id, {
            so_quy_id: cashBookId,
            payment_v2: payment.isV2,
            phuong_thuc_thanh_toan: paymentMethod,
            chi_tiet_thanh_toan: payment.detail,
            session
          });
        }
      });
    } finally {
      await session.endSession();
    }

    return res.json({
      success: true,
      redirect: '/tra-hang-nhap',
      id: returnDoc._id,
      ma_phieu_tra_nhap: maPhieu,
      print_url: '/tra-hang-nhap/' + returnDoc._id + '/in'
    });
  } catch (error) {
    const message = error && error.message ? error.message : 'Không thể lưu phiếu trả hàng nhập';
    console.error('[TRA_HANG_NHAP][CREATE_FAIL]', message, error && error.stack ? error.stack : error);
    return res.status(400).json({ success: false, message: message });
  }
};

exports.detail = async function(req, res, next) {
  try {
    const ret = await PhieuTraHangNhap.findOne(activeReturnImportDataFilter({ _id: req.params.id }))
      .populate('nha_cung_cap_id')
      .populate('phieu_nhap_id')
      .populate('kho_id')
      .populate('nguoi_tao_id')
      .populate('nguoi_tra_id')
      .lean();
    if (!ret) {
      const accept = String(req.headers.accept || '');
      const wantsHtml = !req.xhr && accept.indexOf('text/html') >= 0;
      if (wantsHtml) return res.redirect('/tra-hang-nhap');
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng nhập' });
    }

    const accept = String(req.headers.accept || '');
    const wantsHtml = !req.xhr
      && accept.indexOf('text/html') >= 0
      && (accept.indexOf('application/json') < 0 || accept.indexOf('text/html') < accept.indexOf('application/json'));
    if (wantsHtml) {
      const qs = new URLSearchParams();
      if (ret.ma_phieu_tra_nhap) qs.set('q', String(ret.ma_phieu_tra_nhap));
      qs.set('openReturn', String(ret._id));
      return res.redirect('/tra-hang-nhap?' + qs.toString());
    }

    const items = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ret._id })
      .populate('hang_hoa_id')
      .populate('lo_hang_id')
      .populate('don_vi_tinh_id')
      .lean();
    return res.json({ success: true, data: { ticket: ret, items } });
  } catch (error) {
    next(error);
  }
};

exports.complete = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    if (!isObjectId(storeId)) return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ' });
    const returnFilter = activeReturnImportDataFilter({ _id: req.params.id, cua_hang_id: storeId });
    let returnDoc = await PhieuTraHangNhap.findOne(returnFilter);
    if (!returnDoc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng nhập' });
    if (returnDoc.trang_thai === 'cancelled') return res.status(400).json({ success: false, message: 'Phiếu đã hủy' });
    if (returnDoc.trang_thai === 'completed') return res.json({ success: true, message: 'Phiếu đã hoàn thành' });
    const cashBookId = resolveCashBookIdFromBody(req.body || {}) || getObjectIdValue(returnDoc.so_quy_id);
    const payment = normalizePaymentDetail(req.body || {}, returnDoc.ncc_da_tra || 0);
    const paymentDetail = payment.amount > 0 ? payment.detail : (returnDoc.chi_tiet_thanh_toan || null);
    const paymentMethod = paymentMethodFromDetail(paymentDetail);
    const requestedReturnDate = req.body && req.body.ngay_tra ? new Date(req.body.ngay_tra) : null;
    const completeDate = requestedReturnDate && !isNaN(requestedReturnDate.getTime()) ? requestedReturnDate : new Date();
    if (Number(returnDoc.ncc_da_tra || 0) > 0 && !(payment && payment.isV2) && !isObjectId(cashBookId)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.' });
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await acquirePurchaseGroupMutationLock(storeId, session);
        returnDoc = await PhieuTraHangNhap.findOne(returnFilter).session(session);
        if (!returnDoc) throw new Error('Không tìm thấy phiếu trả hàng nhập');
        if (returnDoc.trang_thai === 'cancelled') throw new Error('Phiếu đã hủy');
        if (returnDoc.trang_thai === 'completed') return;
        const rawRows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: returnDoc._id }).session(session).lean();
        const detailRows = await validateReturnItems({
          items: rawRows.map(row => ({
            hang_hoa_id: row.hang_hoa_id, lo_hang_id: row.lo_hang_id,
            phieu_nhap_id: row.phieu_nhap_id, ct_phieu_nhap_id: row.ct_phieu_nhap_id,
            ten_quy_cach: row.ten_quy_cach || '', ton_kho_lo_quy_cach_id: row.ton_kho_lo_quy_cach_id || '',
            gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || '', so_luong: row.so_luong,
            gia_nhap: row.gia_nhap, gia_tra_lai: row.gia_tra_lai || row.don_gia, ghi_chu: row.ghi_chu
          })),
          storeId, khoId: returnDoc.kho_id, phieuNhapId: returnDoc.phieu_nhap_id, returnId: returnDoc._id, session
        });
        await completeInventory(returnDoc, detailRows, req.user?._id, { session });
        returnDoc.trang_thai = 'completed';
        returnDoc.ngay_tra = completeDate;
        returnDoc.nguoi_tra_id = req.user?._id || returnDoc.nguoi_tra_id;
        if (payment.amount > 0) {
          returnDoc.ncc_da_tra = payment.amount;
          returnDoc.so_quy_id = payment.isV2 ? undefined : cashBookId;
          returnDoc.chi_tiet_thanh_toan = payment.detail;
        }
        returnDoc.ncc_con_phai_tra = Math.max(0, Number(returnDoc.ncc_can_tra || 0) - Number(returnDoc.ncc_da_tra || 0));
        await returnDoc.save({ session });
        await applySupplierDebt(returnDoc, { session });
        await requireSupplierRefundReceipt(returnDoc, req.user?._id, {
          so_quy_id: cashBookId,
          payment_v2: payment && payment.isV2,
          phuong_thuc_thanh_toan: paymentMethod,
          chi_tiet_thanh_toan: paymentDetail || undefined,
          session
        });
      });
    } finally {
      await session.endSession();
    }
    return res.json({ success: true, message: 'Đã hoàn thành phiếu trả hàng nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hoàn thành phiếu' });
  }
};

exports.createReceipt = async function(req, res) {
  let session = null;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const returnDoc = await PhieuTraHangNhap.findOne(activeReturnImportDataFilter({ _id: req.params.id })).session(session);
      if (!returnDoc) throw new Error('Không tìm thấy phiếu trả hàng nhập');
      if (returnDoc.trang_thai === 'cancelled') throw new Error('Phiếu đã hủy, không thể tạo phiếu thu');
      if (returnDoc.trang_thai !== 'completed') throw new Error('Chỉ tạo phiếu thu cho phiếu đã trả hàng');

      const remaining = Math.max(0, Number(returnDoc.ncc_can_tra || 0) - Number(returnDoc.ncc_da_tra || 0));
      if (remaining <= 0) throw new Error('Nhà cung cấp đã thanh toán đủ');
      const payment = normalizePaymentDetail(req.body || {}, remaining);
      if (payment.amount <= 0) throw new Error('Vui lòng nhập số tiền nhà cung cấp trả');
      if (payment.amount > remaining) throw new Error('Số tiền thu không được vượt số NCC còn phải trả');
      const cashBookId = resolveCashBookIdFromBody(req.body || {});
      if (!payment.isV2 && !isObjectId(cashBookId)) throw new Error('Vui lòng chọn sổ quỹ để nhận tiền nhà cung cấp hoàn.');

      const receipt = await createSupplierRefundPaymentReceipt(returnDoc, req.user?._id, payment, cashBookId, { session });
      if (!receipt) throw new Error('Không tạo được phiếu thu');

      const currentDetail = returnDoc.chi_tiet_thanh_toan || {};
      returnDoc.ncc_da_tra = Math.min(Number(returnDoc.ncc_can_tra || 0), Number(returnDoc.ncc_da_tra || 0) + payment.amount);
      returnDoc.ncc_con_phai_tra = Math.max(0, Number(returnDoc.ncc_can_tra || 0) - Number(returnDoc.ncc_da_tra || 0));
      returnDoc.so_quy_id = payment.isV2 ? undefined : cashBookId;
      returnDoc.chi_tiet_thanh_toan = {
        tien_mat: Number(currentDetail.tien_mat || 0) + Number(payment.detail.tien_mat || 0),
        so_quy_tien_mat_id: payment.detail.so_quy_tien_mat_id || currentDetail.so_quy_tien_mat_id || null,
        chuyen_khoan: Number(currentDetail.chuyen_khoan || 0) + Number(payment.detail.chuyen_khoan || 0),
        so_quy_chuyen_khoan_id: payment.detail.so_quy_chuyen_khoan_id || currentDetail.so_quy_chuyen_khoan_id || null,
        tien_tra_khach: 0
      };
      await returnDoc.save({ session });
      result = {
        receipt,
        paid: returnDoc.ncc_da_tra,
        remaining: Math.max(0, Number(returnDoc.ncc_can_tra || 0) - Number(returnDoc.ncc_da_tra || 0)),
        payment
      };
    });
    return res.json({ success: true, message: 'Đã tạo phiếu thu', data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu thu' });
  } finally {
    if (session) await session.endSession();
  }
};

exports.cancel = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    await cancelReturnImport(req.params.id, storeId, req.user && req.user._id);
    return res.json({ success: true, message: 'Đã hủy phiếu trả hàng nhập' });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không thể hủy phiếu' });
  }
};

exports.exportExcel = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    const { returns, detailMap } = await loadExportReturns(query);
    await sendReturnImportWorkbook(res, 'tra-hang-nhap.xlsx', returns, detailMap);
  } catch (error) {
    next(error);
  }
};

exports.exportOneExcel = async function(req, res, next) {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    }
    const storeId = await resolveStoreId(req);
    const query = { _id: req.params.id };
    if (isObjectId(storeId)) query.cua_hang_id = storeId;
    const ticket = await PhieuTraHangNhap.findOne(activeReturnImportDataFilter(query))
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
      .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
      .populate({ path: 'nguoi_tra_id', select: 'ho_ten email username' })
      .lean();
    if (!ticket) {
      return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    }
    const details = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ticket._id })
      .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
      .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .sort({ created_at: 1 })
      .lean();
    await sendSingleReturnDetailWorkbook(res, ticket, details);
  } catch (error) {
    next(error);
  }
};

exports.exportCsv = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    const rows = await PhieuTraHangNhap.find(query)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .sort({ ngay_tra: -1, created_at: -1 })
      .lean();
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [
      ['ma_tra_hang_nhap', 'thoi_gian', 'nha_cung_cap', 'tong_tien_hang', 'giam_gia', 'ncc_can_tra', 'ncc_da_tra', 'ncc_con_phai_tra', 'trang_thai'],
      ...rows.map(row => [
        row.ma_phieu_tra_nhap || '',
        row.ngay_tra ? row.ngay_tra.toISOString() : '',
        row.nha_cung_cap_id?.ten_ncc || '',
        row.tong_tien_hang || 0,
        row.giam_gia || 0,
        row.ncc_can_tra || 0,
        row.ncc_da_tra || 0,
        resolveSupplierReturnRemaining(row),
        row.trang_thai || ''
      ])
    ].map(row => row.map(escape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tra-hang-nhap.csv"');
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
};

async function loadReturnWithItems(id, storeId) {
  if (!isObjectId(id)) return null;
  const filter = { _id: id };
  if (isObjectId(storeId)) filter.cua_hang_id = storeId;
  const ticket = await PhieuTraHangNhap.findOne(activeReturnImportDataFilter(filter))
    .populate({ path: 'cua_hang_id', select: 'ten_cua_hang ma_cua_hang ma_so_thue dia_chi dia_chi_day_du sdt email' })
    .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc ten_cong_ty ma_so_thue sdt email' })
    .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
    .populate({ path: 'nguoi_tra_id', select: 'ho_ten email' })
    .lean();
  if (!ticket) return null;
  const items = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ticket._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
    .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
    .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
    .sort({ created_at: 1 })
    .lean();
  return { ticket, items };
}

async function buildReturnPrintData(req, title) {
  const storeId = await resolveStoreId(req);
  const loaded = await loadReturnWithItems(req.params.id, storeId);
  if (!loaded) return null;
  const store = loaded.ticket.cua_hang_id || null;
  return {
    activeMenu: 'mua-hang',
    user: req.user,
    store,
    ticket: loaded.ticket,
    items: loaded.items,
    statusLabel,
    embeddedPrint: String(req.query && req.query.embed || '') === '1',
    formatDate: formatDate
  };
}

function safeReturnPdfName(ticket) {
  const code = String(ticket && ticket.ma_phieu_tra_nhap ? ticket.ma_phieu_tra_nhap : 'tra-hang-nhap')
    .replace(/[^\w.-]+/g, '-');
  return 'phieu-tra-hang-nhap-' + code + '.pdf';
}

async function renderReturnPrint(req, res, next, viewName, title) {
  try {
    const data = await buildReturnPrintData(req, title);
    if (!data) return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    return res.render(viewName, data);
  } catch (error) {
    next(error);
  }
}

async function renderReturnPdf(req, res, next, viewName, title) {
  try {
    const data = await buildReturnPrintData(req, title);
    if (!data) return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    const viewPath = path.join(__dirname, '..', 'views', viewName + '.ejs');
    const html = await pdfService.renderViewToHtml(viewPath, data);
    const buffer = await pdfService.generatePdfFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeReturnPdfName(data.ticket) + '"');
    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
}

exports.print = function(req, res, next) {
  return renderReturnPrint(req, res, next, 'tra-hang-nhap/print', 'In phiếu trả hàng nhập');
};

exports.printPdf = function(req, res, next) {
  return renderReturnPdf(req, res, next, 'tra-hang-nhap/print', 'In phiếu trả hàng nhập');
};
