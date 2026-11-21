const mongoose = require('mongoose');
const {
  PhieuNhap,
  CTPhieuNhap,
  PhieuTraHangNhap,
  NhaCungCap,
  DiaChiNcc,
  HangHoa,
  LoHang,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LichSuKho,
  CongNoNhaCungCap,
  GiaoDichCongNoNhaCungCap,
  PhieuThuChi,
  Kho
} = require('../models/kiot.model');
const { taoPhieuThuChi } = require('./soQuy.service');
const { extractPaymentDetail } = require('./paymentCashBook.service');
const { syncTonKhoSauQuyCach } = require('./kho.service');
const {
  assertVatChuaImportInput,
  parseVatChuaImportInput,
  importVatChuaWithPurchase,
  cancelNhapVatChuaBySource
} = require('./vatChuaImport.service');

function logNhapHangOk(table, detail) {
  console.log(`[NHAP_HANG][OK] ${table}${detail ? ' - ' + detail : ''}`);
}

function logNhapHangFail(table, error, detail) {
  console.error(`[NHAP_HANG][FAIL] ${table}${detail ? ' - ' + detail : ''}: ${error && error.message ? error.message : error}`);
}

async function withNhapHangLog(table, detail, fn) {
  try {
    const result = await fn();
    logNhapHangOk(table, detail);
    return result;
  } catch (error) {
    logNhapHangFail(table, error, detail);
    throw error;
  }
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function cleanId(value) {
  const id = String(value || '').trim();
  return isObjectId(id) ? id : undefined;
}

function withSessionOptions(options = {}, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

async function createOne(model, doc, session) {
  if (!session) return model.create(doc);
  const rows = await model.create([doc], { session });
  return rows[0];
}

function resolveCashBookId(value = {}) {
  return cleanId(value.so_quy_id || value.cashBookId || value.soQuyId);
}

function assertCashBookWhenPaying(payment, data) {
  if (!payment || payment.isV2) return;
  if (parseMoney(payment.amount) > 0 && !resolveCashBookId(data)) {
    throw new Error('Vui lòng chọn sổ quỹ để thanh toán phiếu nhập.');
  }
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
  if (tienMat > 0) return 'tien_mat';
  return 'cong_no';
}

function purchasePaymentMethodFromDetail(detail) {
  const tienMat = Number(detail && detail.tien_mat || 0);
  const chuyenKhoan = Number(detail && detail.chuyen_khoan || 0);
  if (tienMat > 0 && chuyenKhoan <= 0) return 'tien_mat';
  if (chuyenKhoan > 0 && tienMat <= 0) return 'chuyen_khoan';
  return '';
}

function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function isPurchasePaymentV2(data = {}) {
  const raw = data.chi_tiet_thanh_toan && typeof data.chi_tiet_thanh_toan === 'object'
    ? data.chi_tiet_thanh_toan
    : {};
  const flag = data.payment_v2;
  return flag === true
    || flag === 'true'
    || flag === '1'
    || Boolean(String(raw.so_quy_tien_mat_id || data['chi_tiet_thanh_toan[so_quy_tien_mat_id]'] || data.so_quy_tien_mat_id || '').trim())
    || Boolean(String(raw.so_quy_chuyen_khoan_id || data['chi_tiet_thanh_toan[so_quy_chuyen_khoan_id]'] || data.so_quy_chuyen_khoan_id || '').trim());
}

function normalizePaymentDetail(data = {}, maxAmount) {
  if (isPurchasePaymentV2(data)) {
    const detail = extractPaymentDetail(data);
    if (detail.tien_tra_khach > 0) {
      throw new Error('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
    }
    const amount = detail.tien_mat + detail.chuyen_khoan;
    const limit = Math.max(0, parseMoney(maxAmount));
    if (amount > limit) {
      throw new Error('Số tiền thanh toán không được vượt số cần trả nhà cung cấp.');
    }
    return {
      isV2: true,
      amount,
      detail: Object.assign({}, detail, { tien_tra_khach: 0 })
    };
  }

  const raw = data.chi_tiet_thanh_toan && typeof data.chi_tiet_thanh_toan === 'object'
    ? data.chi_tiet_thanh_toan
    : {};
  let tienMat = parseMoney(raw.tien_mat ?? data['chi_tiet_thanh_toan[tien_mat]'] ?? data.tien_mat);
  let chuyenKhoan = parseMoney(raw.chuyen_khoan ?? data['chi_tiet_thanh_toan[chuyen_khoan]'] ?? data.chuyen_khoan);
  let amount = tienMat + chuyenKhoan;
  if (amount <= 0) {
    amount = parseMoney(data.da_tra_ncc);
    tienMat = amount;
    chuyenKhoan = 0;
  }
  const limit = Math.max(0, parseMoney(maxAmount));
  if (amount > limit) {
    const overflow = amount - limit;
    if (chuyenKhoan >= overflow) {
      chuyenKhoan -= overflow;
    } else {
      tienMat = Math.max(0, tienMat - (overflow - chuyenKhoan));
      chuyenKhoan = 0;
    }
    amount = tienMat + chuyenKhoan;
  }
  return {
    isV2: false,
    amount,
    detail: {
      tien_mat: tienMat,
      chuyen_khoan: chuyenKhoan,
      tien_tra_khach: 0
    }
  };
}

function parseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function safeLotCodeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function makePurchaseLotCode(purchaseCode, productCode) {
  const safePurchaseCode = safeLotCodeSegment(purchaseCode);
  const safeProductCode = safeLotCodeSegment(productCode);
  if (!safePurchaseCode || !safeProductCode) return '';
  return 'LO-' + safePurchaseCode + '-' + safeProductCode;
}

function normalizeQuyCachItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      const qty = Math.max(0, Number(item && item.so_luong || 0));
      const unitCost = parseMoney(item && (item.don_gia_nhap ?? item.don_gia ?? item.gia_von));
      const name = String(item && (item.ten_quy_cach || item.ten_thuoc_tinh) || '').trim();
      return {
        ten_quy_cach: name,
        ten_thuoc_tinh: name,
        so_luong: qty,
        don_gia_nhap: unitCost,
        gia_von: unitCost,
        thanh_tien: Math.floor(qty * unitCost),
        ghi_chu: String(item && item.ghi_chu || '').trim()
      };
    })
    .filter(item => item.ten_quy_cach || item.so_luong > 0 || item.don_gia_nhap > 0 || item.ghi_chu);
}

function sumQuyCachItems(items) {
  return normalizeQuyCachItems(items).reduce((sum, item) => sum + Number(item.so_luong || 0), 0);
}

function sumQuyCachAmount(items) {
  return normalizeQuyCachItems(items).reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0);
}

function normalizeLotInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const quyCachItems = normalizeQuyCachItems(raw.quy_cach_items);
  const total = sumQuyCachItems(quyCachItems);
  const rawTotal = Math.max(0, Number(raw.so_luong_tong || 0));
  const unitCost = parseMoney(raw.don_gia_nhap ?? raw.don_gia);
  const amount = sumQuyCachAmount(quyCachItems);
  return {
    lo_hang_id: cleanId(raw.lo_hang_id),
    ma_lo: String(raw.ma_lo || '').trim(),
    ten_lo: String(raw.ten_lo || '').trim(),
    han_su_dung: String(raw.han_su_dung || '').trim(),
    ngay_nhap: String(raw.ngay_nhap || '').trim(),
    ghi_chu: String(raw.ghi_chu || '').trim(),
    so_luong_tong: total || rawTotal,
    don_gia_nhap: unitCost,
    tong_tien_quy_cach: amount || (rawTotal * unitCost),
    quy_cach_items: quyCachItems
  };
}

function validateLotInfoForProduct(item, product) {
  if (!product || !product.quan_ly_theo_lo) return;
  const lotInfo = item.lot_info;
  if (!lotInfo) throw new Error('Hàng quản lý theo lô cần thông tin lô');
  const quyCachItems = normalizeQuyCachItems(lotInfo.quy_cach_items);
  for (const row of quyCachItems) {
    if (!row.ten_quy_cach) {
      throw new Error('Tên quy cách không được để trống khi có số lượng');
    }
    if (Number(row.so_luong || 0) <= 0) {
      throw new Error('Số lượng quy cách phải lớn hơn 0');
    }
    if (Number(row.don_gia_nhap || 0) < 0) {
      throw new Error('Đơn giá quy cách không hợp lệ');
    }
  }
  if (quyCachItems.length) {
    const total = sumQuyCachItems(quyCachItems);
    if (Number(item.so_luong || 0) > 0 && Number(item.so_luong || 0) !== total) {
      throw new Error('Tổng số lượng quy cách phải bằng số lượng dòng hàng');
    }
    item.so_luong = total;
    item.don_gia_nhap = total > 0 ? Math.round(sumQuyCachAmount(quyCachItems) / total) : item.don_gia_nhap;
    item.lot_info.so_luong_tong = total;
    item.lot_info.tong_tien_quy_cach = sumQuyCachAmount(quyCachItems);
    item.lot_info.quy_cach_items = quyCachItems;
  }
  if (Number(item.so_luong || 0) <= 0) throw new Error('Tổng số lượng lô phải lớn hơn 0');
}

function formatLotName(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return 'Lô';
  return 'Lô ' + d.toLocaleDateString('vi-VN');
}

function normalizeItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => {
    const discountType = item.kieu_giam_gia_dong === 'percent' ? 'percent' : 'vnd';
    const lotInfo = normalizeLotInfo(item.lo_info || item.lot_info);
    const lotQty = lotInfo ? Number(lotInfo.so_luong_tong || 0) : 0;
    const rawQty = Math.max(0, Number(item.so_luong || 0));
    const qcAmount = lotInfo ? Number(lotInfo.tong_tien_quy_cach || 0) : 0;
    const qty = Math.floor(lotQty > 0 ? lotQty : rawQty);
    const rawUnitCost = parseMoney(item.don_gia_nhap ?? item.don_gia);
    return {
      hang_hoa_id: cleanId(item.hang_hoa_id),
      lo_hang_id: cleanId(item.lo_hang_id) || (lotInfo && lotInfo.lo_hang_id),
      so_luong: qty,
      don_gia_nhap: qcAmount > 0 && qty > 0 ? Math.round(qcAmount / qty) : rawUnitCost,
      giam_gia_dong: parseMoney(item.giam_gia_dong ?? item.giam_gia),
      kieu_giam_gia_dong: discountType,
      lot_info: lotInfo
    };
  }).filter(item => item.hang_hoa_id && item.don_gia_nhap >= 0);
}

function lineTotal(item) {
  const qcTotal = item.lot_info && item.lot_info.quy_cach_items && item.lot_info.quy_cach_items.length
    ? sumQuyCachAmount(item.lot_info.quy_cach_items)
    : 0;
  if (qcTotal > 0) return Math.floor(qcTotal);
  const base = qcTotal > 0 ? qcTotal : Number(item.so_luong || 0) * Number(item.don_gia_nhap || 0);
  const discount = item.kieu_giam_gia_dong === 'percent'
    ? Math.floor(base * Math.min(Number(item.giam_gia_dong || 0), 100) / 100)
    : Number(item.giam_gia_dong || 0);
  if (discount > base) throw new Error('Giảm giá dòng không được vượt quá thành tiền');
  return Math.max(0, Math.floor(base - discount));
}

function calculateTotals(items, discountValue, discountType) {
  const tongTienHang = items.reduce((sum, item) => sum + lineTotal(item), 0);
  let giamGia = parseMoney(discountValue);
  const kieuGiamGia = discountType === 'percent' ? 'percent' : 'vnd';
  if (kieuGiamGia === 'percent') giamGia = Math.min(giamGia, 100);
  const discountAmount = kieuGiamGia === 'percent'
    ? Math.floor(tongTienHang * giamGia / 100)
    : giamGia;
  if (discountAmount > tongTienHang) throw new Error('Giảm giá phiếu không được vượt quá tổng tiền hàng');
  const tongTien = Math.max(0, tongTienHang - discountAmount);
  return { tongTienHang, giamGia, kieuGiamGia, tongTien };
}

function toAggregateObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!isObjectId(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

async function calculateMovingAverageCost(productId, quantity, unitCost, session) {
  const hangHoaId = toAggregateObjectId(productId);
  const incomingQty = Number(quantity || 0);
  const incomingCost = Number(unitCost || 0);
  if (!hangHoaId || incomingQty <= 0) return Math.round(incomingCost);

  const [product, stockRows] = await Promise.all([
    withSessionQuery(HangHoa.findById(hangHoaId).select('gia_von'), session).lean(),
    TonKho.aggregate([
      { $match: { hang_hoa_id: hangHoaId } },
      { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]).session(session || null)
  ]);

  const currentStock = Number(stockRows && stockRows[0] ? stockRows[0].total : 0);
  const currentCost = Number(product && product.gia_von ? product.gia_von : 0);
  const nextStock = currentStock + incomingQty;
  if (currentStock <= 0 || nextStock <= 0) return Math.round(incomingCost);

  return Math.round(((currentStock * currentCost) + (incomingQty * incomingCost)) / nextStock);
}

async function makeCode(model, field, prefix, width, session) {
  const regex = new RegExp('^' + prefix + '\\d+$');
  const last = await withSessionQuery(model.findOne({ [field]: regex }).sort({ [field]: -1 }), session).lean();
  const next = last && last[field] ? Number(String(last[field]).replace(/\D/g, '')) + 1 : 1;
  return prefix + String(next).padStart(width, '0');
}

async function createLotForLine({ storeId, khoId, supplierId, purchase, ctDoc, product, productId, item, now, lotCache, session }) {
  if (item.lo_hang_id) {
    const existing = await withSessionQuery(LoHang.findOne({
      _id: item.lo_hang_id,
      hang_hoa_id: productId,
      kho_id: khoId,
      trang_thai: { $ne: 'huy' }
    }), session);
    if (!existing) throw new Error('Lô hàng không hợp lệ');
    return existing._id;
  }

  const lotInfo = item.lot_info;
  if (!lotInfo) throw new Error('Hàng quản lý theo lô cần thông tin lô');
  const lotQty = Math.floor(Number(item.so_luong || 0));
  if (lotQty <= 0) throw new Error('Số lượng dòng hàng không hợp lệ');

  const maLo = lotInfo.ma_lo || makePurchaseLotCode(purchase.ma_phieu_nhap, product && product.ma_hang);
  if (!maLo) throw new Error('Không thể sinh mã lô từ phiếu nhập và hàng hóa');
  if (lotCache && lotCache.has(maLo)) {
    const lotId = lotCache.get(maLo);
    await withNhapHangLog('LoHang', `cap nhat lo co san ${maLo}`, () => LoHang.updateOne(
      { _id: lotId },
      {
        $inc: { so_luong_ban_dau: lotQty },
        $set: {
          nha_cung_cap_id: supplierId || undefined,
          don_gia_nhap: item.don_gia_nhap,
          gia_von: item.don_gia_nhap,
          quy_cach_items: lotInfo.quy_cach_items
        }
      },
      withSessionOptions({}, session)
    ));
    return lotId;
  }
  const existingByCode = await withSessionQuery(LoHang.findOne({
    ma_lo: maLo,
    hang_hoa_id: productId,
    phieu_nhap_id: purchase._id,
    trang_thai: { $ne: 'huy' }
  }), session);
  if (existingByCode) {
    await withNhapHangLog('LoHang', `cap nhat lo trung ma ${maLo}`, () => LoHang.updateOne(
      { _id: existingByCode._id },
      {
        $inc: { so_luong_ban_dau: lotQty },
        $set: {
          nha_cung_cap_id: supplierId || undefined,
          don_gia_nhap: item.don_gia_nhap,
          gia_von: item.don_gia_nhap,
          quy_cach_items: lotInfo.quy_cach_items
        }
      },
      withSessionOptions({}, session)
    ));
    if (lotCache) lotCache.set(maLo, existingByCode._id);
    return existingByCode._id;
  }
  const created = await withNhapHangLog('LoHang', `tao lo ${maLo}`, () => createOne(LoHang, {
    cua_hang_id: storeId,
    kho_id: khoId,
    hang_hoa_id: productId,
    nha_cung_cap_id: supplierId,
    phieu_nhap_id: purchase._id,
    ct_phieu_nhap_id: ctDoc._id,
    ma_lo: maLo,
    ten_lo: lotInfo.ten_lo || formatLotName(parseDate(lotInfo.ngay_nhap) || purchase.ngay_nhap || now),
    ngay_nhap: parseDate(lotInfo.ngay_nhap) || now,
    han_su_dung: parseDate(lotInfo.han_su_dung),
    so_luong_ban_dau: lotQty,
    so_luong_con_lai: 0,
    don_gia_nhap: item.don_gia_nhap,
    gia_von: item.don_gia_nhap,
    trang_thai: 'active',
    ghi_chu: lotInfo.ghi_chu || undefined,
    quy_cach_items: lotInfo.quy_cach_items
  }, session));
  if (lotCache) lotCache.set(maLo, created._id);
  return created._id;
}

async function applyCompletedEffects(purchase, rows, options = {}) {
  const session = options.session;
  if (purchase.__effectsApplied) throw new Error('Phiếu nhập đã được hoàn tất trước đó');
  purchase.__effectsApplied = true;

  const warehouse = await withSessionQuery(Kho.findById(purchase.kho_id), session).lean();
  if (!warehouse) throw new Error('Không tìm thấy kho nhập');

  for (const row of rows) {
    const qty = Number(row.so_luong || 0);
    const newProductCost = await calculateMovingAverageCost(row.hang_hoa_id, qty, row.don_gia_nhap, session);
    const quyCachItems = normalizeQuyCachItems(row.lot_info && row.lot_info.quy_cach_items);
    let updatedStock = null;

    if (row.lo_hang_id && quyCachItems.length) {
      const totalQc = sumQuyCachItems(quyCachItems);
      if (qty > 0 && totalQc !== qty) {
        throw new Error('Tổng số lượng quy cách phải bằng số lượng dòng hàng');
      }
      for (const qc of quyCachItems) {
        await withNhapHangLog('TonKhoLoQuyCach', `dong bo ten cu qc=${qc.ten_quy_cach}`, () => TonKhoLoQuyCach.updateMany(
          {
            kho_id: purchase.kho_id,
            hang_hoa_id: row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            ten_thuoc_tinh: qc.ten_quy_cach,
            $or: [
              { ten_quy_cach: { $exists: false } },
              { ten_quy_cach: null },
              { ten_quy_cach: '' }
            ]
          },
          { $set: { ten_quy_cach: qc.ten_quy_cach } },
          withSessionOptions({}, session)
        ));
        await withNhapHangLog('TonKhoLoQuyCach', `bo sung ten_thuoc_tinh qc=${qc.ten_quy_cach}`, () => TonKhoLoQuyCach.updateMany(
          {
            kho_id: purchase.kho_id,
            hang_hoa_id: row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            ten_quy_cach: qc.ten_quy_cach,
            $or: [
              { ten_thuoc_tinh: { $exists: false } },
              { ten_thuoc_tinh: null },
              { ten_thuoc_tinh: '' }
            ]
          },
          { $set: { ten_thuoc_tinh: qc.ten_quy_cach } },
          withSessionOptions({}, session)
        ));
        await withNhapHangLog('TonKhoLoQuyCach', `upsert lo=${row.lo_hang_id} qc=${qc.ten_quy_cach} sl=${qc.so_luong}`, () => TonKhoLoQuyCach.findOneAndUpdate(
          {
            cua_hang_id: purchase.cua_hang_id,
            kho_id: purchase.kho_id,
            hang_hoa_id: row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            ten_thuoc_tinh: qc.ten_quy_cach
          },
          {
            $inc: {
              so_luong: Number(qc.so_luong || 0),
              thanh_tien: Number(qc.thanh_tien || 0)
            },
            $set: {
              ten_quy_cach: qc.ten_quy_cach,
              ten_thuoc_tinh: qc.ten_quy_cach,
              don_gia_nhap: Number(qc.don_gia_nhap || 0),
              gia_von: Number(qc.gia_von || qc.don_gia_nhap || 0)
            }
          },
          withSessionOptions({ upsert: true, new: true }, session)
        ));
      }
      const synced = await withNhapHangLog('TonKho', `sync ton sau quy cach lo=${row.lo_hang_id}`, () => syncTonKhoSauQuyCach(
        purchase.kho_id,
        row.hang_hoa_id,
        row.lo_hang_id,
        warehouse,
        row.don_gia_nhap,
        { session }
      ));
      updatedStock = synced.inventory;
      await withNhapHangLog('LoHang', `cap nhat trang thai lo=${row.lo_hang_id}`, () => LoHang.updateOne(
        { _id: row.lo_hang_id },
        { $set: { trang_thai: synced.lotTotal > 0 ? 'active' : 'het_hang' } },
        withSessionOptions({}, session)
      ));
    } else {
      updatedStock = await withNhapHangLog('TonKho', `cong ton hang=${row.hang_hoa_id} sl=${qty}`, () => TonKho.findOneAndUpdate(
        { cua_hang_id: purchase.cua_hang_id, kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id },
        { $inc: { so_luong: qty }, $setOnInsert: { cua_hang_id: purchase.cua_hang_id } },
        withSessionOptions({ upsert: true, new: true }, session)
      ).lean());

      if (row.lo_hang_id) {
        await withNhapHangLog('TonKhoLo', `cong ton lo=${row.lo_hang_id} hang=${row.hang_hoa_id} sl=${qty}`, () => TonKhoLo.findOneAndUpdate(
          {
            cua_hang_id: purchase.cua_hang_id,
            kho_id: purchase.kho_id,
            hang_hoa_id: row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            gia_tri_thuoc_tinh_id: null
          },
          { $inc: { so_luong: qty }, $set: { gia_von: row.don_gia_nhap } },
          withSessionOptions({ upsert: true, new: true }, session)
        ));
        await withNhapHangLog('LoHang', `cap nhat ton con lai lo=${row.lo_hang_id} sl=${qty}`, () => LoHang.updateOne(
          { _id: row.lo_hang_id },
          { $inc: { so_luong_con_lai: qty }, $set: { trang_thai: 'active' } },
          withSessionOptions({}, session)
        ));
      }
    }

    await withNhapHangLog('LichSuKho', `ghi lich su hang=${row.hang_hoa_id} sl=${qty}`, () => createOne(LichSuKho, {
      cua_hang_id: purchase.cua_hang_id,
      kho_id: purchase.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id || undefined,
      nguoi_tao_id: options.userId,
      loai_phieu: 'nhap_hang',
      ma_phieu: purchase.ma_phieu_nhap,
      so_luong_thay_doi: qty,
      ton_kho_sau: Number(updatedStock?.so_luong || 0),
      gia_tri_thay_doi: Number(row.thanh_tien || 0),
      ghi_chu: 'Nhập hàng',
      ngay: purchase.ngay_nhap || new Date()
    }, session));

    await withNhapHangLog('HangHoa', `cap nhat gia hang=${row.hang_hoa_id}`, () => HangHoa.updateOne(
      { _id: row.hang_hoa_id },
      { $set: { gia_nhap_cuoi: row.don_gia_nhap, gia_von: newProductCost } },
      withSessionOptions({}, session)
    ));
  }

  if (purchase.nha_cung_cap_id) {
    const canTra = Number(purchase.can_tra_ncc || 0);
    const daTra = Number(purchase.da_tra_ncc || 0);
    const conNo = Number(purchase.con_no_ncc || 0);
    const includeDebt = options.includeDebt !== false;
    if (includeDebt && canTra > 0) {
      await withNhapHangLog('CongNoNhaCungCap', `tao cong no phieu=${purchase.ma_phieu_nhap}`, () => createOne(CongNoNhaCungCap, {
        cua_hang_id: purchase.cua_hang_id,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        so_tien: canTra,
        loai: 'tang_no',
        ghi_chu: 'Công nợ phát sinh từ phiếu nhập ' + purchase.ma_phieu_nhap,
        ngay: purchase.ngay_nhap || new Date()
      }, session));
    }
    const paymentForDebt = options.payment || {};
    const supplierDebtInc = paymentForDebt.isV2 ? canTra : conNo;
    await withNhapHangLog('NhaCungCap', `cap nhat mua/no ncc=${purchase.nha_cung_cap_id}`, () => NhaCungCap.updateOne(
      { _id: purchase.nha_cung_cap_id },
      { $inc: { tong_mua: canTra, tong_no: includeDebt ? supplierDebtInc : 0 } },
      withSessionOptions({}, session)
    ));

    if (daTra > 0) {
      const cashBookId = resolveCashBookId(options);
      const paymentInput = options.payment || { isV2: false, detail: options.chi_tiet_thanh_toan };
      if (paymentInput.isV2) {
        const receiptPayload = {
          loai_phieu: 'chi',
          loai_thu_chi: 'Chi tra nha cung cap',
          gia_tri: daTra,
          ngay_lap: purchase.ngay_nhap || new Date(),
          cua_hang_id: purchase.cua_hang_id,
          chi_nhanh_id: options.chi_nhanh_id,
          nguoi_tao_id: options.userId,
          nha_cung_cap_id: purchase.nha_cung_cap_id,
          phieu_nhap_id: purchase._id,
          document_type: 'phieu_nhap',
          ma_chung_tu_goc: purchase.ma_phieu_nhap,
          nhom_doi_tuong: 'nha_cung_cap',
          doi_tuong: options.supplierName,
          payment_v2: true,
          tien_mat: Number(paymentInput.detail.tien_mat || 0),
          so_quy_tien_mat_id: paymentInput.detail.so_quy_tien_mat_id || '',
          chuyen_khoan: Number(paymentInput.detail.chuyen_khoan || 0),
          so_quy_chuyen_khoan_id: paymentInput.detail.so_quy_chuyen_khoan_id || '',
          tien_tra_khach: 0,
          hach_toan: includeDebt
        };
        await withNhapHangLog('PhieuThuChi', `tao phieu chi phieu=${purchase.ma_phieu_nhap}`, () => taoPhieuThuChi(receiptPayload, { session }));
        return;
      }
      if (!cashBookId) throw new Error('Vui lòng chọn sổ quỹ để thanh toán phiếu nhập.');
      await withNhapHangLog('PhieuThuChi', `tao phieu chi phieu=${purchase.ma_phieu_nhap}`, () => taoPhieuThuChi({
        loai_phieu: 'chi',
        loai_thu_chi: 'Chi tra nha cung cap',
        gia_tri: daTra,
        ngay_lap: purchase.ngay_nhap || new Date(),
        so_quy_id: cashBookId,
        cua_hang_id: purchase.cua_hang_id,
        nguoi_tao_id: options.userId,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        document_type: 'phieu_nhap',
        ma_chung_tu_goc: purchase.ma_phieu_nhap,
        nhom_doi_tuong: 'nha_cung_cap',
        phuong_thuc_thanh_toan: normalizePaymentMethod(paymentMethodFromDetail(options.chi_tiet_thanh_toan) || purchase.phuong_thuc_thanh_toan),
        chi_tiet_thanh_toan: options.chi_tiet_thanh_toan || { tien_mat: daTra, chuyen_khoan: 0, tien_tra_khach: 0 },
        hach_toan: false
      }, { session }));
      if (includeDebt) await withNhapHangLog('CongNoNhaCungCap', `ghi thanh toan phieu=${purchase.ma_phieu_nhap}`, () => createOne(CongNoNhaCungCap, {
        cua_hang_id: purchase.cua_hang_id,
        nha_cung_cap_id: purchase.nha_cung_cap_id,
        phieu_nhap_id: purchase._id,
        so_tien: daTra,
        loai: 'thanh_toan',
        ghi_chu: 'Thanh toán NCC từ phiếu nhập ' + purchase.ma_phieu_nhap,
        ngay: purchase.ngay_nhap || new Date()
      }, session));
    }
  }
}

async function adjustCompletedPurchaseEffects(purchase, rows, direction, options = {}) {
  const session = options.session;
  const userId = cleanId(options.userId);
  const isRollback = direction < 0;
  const warehouse = await withSessionQuery(Kho.findById(purchase.kho_id), session).lean();
  if (!warehouse) throw new Error('Không tìm thấy kho nhập');

  for (const row of rows) {
    const qty = Number(row.so_luong || 0);
    if (qty <= 0) continue;
    const quyCachItems = normalizeQuyCachItems(row.lot_info && row.lot_info.quy_cach_items);
    let updated = null;

    if (isRollback) {
      const stock = await withSessionQuery(TonKho.findOne({
        kho_id: purchase.kho_id,
        hang_hoa_id: row.hang_hoa_id
      }), session).lean();
      if (!stock || Number(stock.so_luong || 0) < qty) throw new Error('Tồn kho không đủ để hoàn tác phiếu nhập');
    }

    if (row.lo_hang_id && quyCachItems.length) {
      for (const qc of quyCachItems) {
        const qcFilter = {
          kho_id: purchase.kho_id,
          hang_hoa_id: row.hang_hoa_id,
          lo_hang_id: row.lo_hang_id,
          $or: [
            { ten_thuoc_tinh: qc.ten_thuoc_tinh },
            { ten_quy_cach: qc.ten_quy_cach }
          ]
        };
        if (isRollback) {
          const qcStock = await withSessionQuery(TonKhoLoQuyCach.findOne(qcFilter), session).lean();
          if (!qcStock || Number(qcStock.so_luong || 0) < Number(qc.so_luong || 0)) {
            throw new Error('Tồn kho quy cách trong lô không đủ để hoàn tác phiếu nhập');
          }
        }
        await TonKhoLoQuyCach.findOneAndUpdate(
          qcFilter,
          {
            $inc: {
              so_luong: direction * Number(qc.so_luong || 0),
              thanh_tien: direction * Number(qc.thanh_tien || 0)
            },
            $setOnInsert: {
              cua_hang_id: purchase.cua_hang_id,
              kho_id: purchase.kho_id,
              hang_hoa_id: row.hang_hoa_id,
              lo_hang_id: row.lo_hang_id,
              ten_quy_cach: qc.ten_quy_cach,
              ten_thuoc_tinh: qc.ten_quy_cach
            },
            $set: {
              don_gia_nhap: Number(qc.don_gia_nhap || row.don_gia_nhap || 0),
              gia_von: Number(qc.gia_von || qc.don_gia_nhap || row.don_gia_nhap || 0)
            }
          },
          withSessionOptions({ upsert: !isRollback, new: true }, session)
        );
      }
      const synced = await syncTonKhoSauQuyCach(
        purchase.kho_id,
        row.hang_hoa_id,
        row.lo_hang_id,
        warehouse,
        row.don_gia_nhap,
        { session }
      );
      updated = synced.inventory;
    } else {
      updated = await TonKho.findOneAndUpdate(
        { cua_hang_id: purchase.cua_hang_id, kho_id: purchase.kho_id, hang_hoa_id: row.hang_hoa_id },
        { $inc: { so_luong: direction * qty }, $setOnInsert: { cua_hang_id: purchase.cua_hang_id } },
        withSessionOptions({ upsert: !isRollback, new: true }, session)
      ).lean();
      if (!updated || Number(updated.so_luong || 0) < 0) throw new Error('Tồn kho không đủ để hoàn tác phiếu nhập');

      if (row.lo_hang_id) {
        const lotStock = await TonKhoLo.findOneAndUpdate(
          {
            cua_hang_id: purchase.cua_hang_id,
            kho_id: purchase.kho_id,
            hang_hoa_id: row.hang_hoa_id,
            lo_hang_id: row.lo_hang_id,
            gia_tri_thuoc_tinh_id: null
          },
          { $inc: { so_luong: direction * qty }, $set: { gia_von: row.don_gia_nhap } },
          withSessionOptions({ upsert: !isRollback, new: true }, session)
        );
        if (!lotStock || Number(lotStock.so_luong || 0) < 0) throw new Error('Tồn kho lô không đủ để hoàn tác phiếu nhập');
        const lotQtyAfter = Number(lotStock.so_luong || 0);
        await LoHang.updateOne(
          { _id: row.lo_hang_id },
          {
            $inc: { so_luong_con_lai: direction * qty },
            $set: { trang_thai: lotQtyAfter > 0 ? 'active' : 'het_hang' }
          },
          withSessionOptions({}, session)
        );
      }
    }

    await createOne(LichSuKho, {
      cua_hang_id: purchase.cua_hang_id,
      kho_id: purchase.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id || undefined,
      nguoi_tao_id: userId,
      loai_phieu: isRollback ? 'dieu_chinh' : 'nhap_hang',
      ma_phieu: purchase.ma_phieu_nhap,
      so_luong_thay_doi: direction * qty,
      ton_kho_sau: Number(updated?.so_luong || 0),
      gia_tri_thay_doi: direction * Number(row.thanh_tien || 0),
      ghi_chu: (isRollback ? 'Hoàn tác phiếu nhập ' : 'Khôi phục phiếu nhập ') + purchase.ma_phieu_nhap,
      ngay: new Date()
    }, session);
  }

  if (purchase.nha_cung_cap_id) {
    const canTra = Number(purchase.can_tra_ncc || 0);
    const conNo = Number(purchase.con_no_ncc || 0);
    await NhaCungCap.updateOne(
      { _id: purchase.nha_cung_cap_id },
      { $inc: { tong_mua: direction * canTra, tong_no: direction * conNo } },
      withSessionOptions({}, session)
    );
  }
}

async function rollbackCompletedPurchaseEffects(purchase, rows, options = {}) {
  await adjustCompletedPurchaseEffects(purchase, rows, -1, options);
}

async function restoreCompletedPurchaseEffects(purchase, rows, options = {}) {
  await adjustCompletedPurchaseEffects(purchase, rows, 1, options);
}

async function createPurchase(data = {}, options = {}) {
  const session = options.session || data.session;
  const storeId = cleanId(data.cua_hang_id);
  const khoId = cleanId(data.kho_id);
  if (!storeId) throw new Error('Cửa hàng không hợp lệ');
  if (!khoId) throw new Error('Vui lòng chọn kho nhập');

  const items = normalizeItems(data.items_json ?? data.items);
  if (!items.length) throw new Error('Vui lòng chọn hàng hóa');

  const supplierId = cleanId(data.nha_cung_cap_id);
  const supplierAddressId = supplierId ? cleanId(data.dia_chi_ncc_id) : undefined;
  if (supplierAddressId) {
    const address = await withSessionQuery(
      DiaChiNcc.findOne({
        _id: supplierAddressId,
        nha_cung_cap_id: supplierId,
        trang_thai: 'active'
      }).select('_id'),
      session
    ).lean();
    if (!address) throw new Error('Địa chỉ nhà cung cấp không hợp lệ');
  }
  const mode = data.submitMode === 'completed' ? 'completed' : 'draft';
  const vatChuaImport = parseVatChuaImportInput(data);
  if (mode === 'completed') assertVatChuaImportInput(vatChuaImport);
  const totals = calculateTotals(items, data.giam_gia, data.kieu_giam_gia);
  const canTra = parseMoney(data.can_tra_ncc || totals.tongTien);
  if (canTra > totals.tongTien) throw new Error('Cần trả nhà cung cấp không được lớn hơn tổng tiền');
  const payment = normalizePaymentDetail(data, canTra);
  const daTra = payment.amount;
  const phuongThuc = purchasePaymentMethodFromDetail(payment.detail);
  const conNo = Math.max(0, canTra - daTra);
  assertCashBookWhenPaying(payment, data);
  const now = new Date();
  const maPhieu = data.ma_phieu_nhap || await makeCode(PhieuNhap, 'ma_phieu_nhap', 'PN', 6, session);
  const includeDebt = data.tinh_vao_cong_no !== false
    && data.tinh_vao_cong_no !== 'false'
    && data.tinh_vao_cong_no !== '0'
    && data.tinh_vao_cong_no !== 'off';

  const productDocs = await withSessionQuery(
    HangHoa.find({ _id: { $in: items.map(x => x.hang_hoa_id) }, trang_thai: 'active' })
      .select('_id ma_hang don_vi_tinh_id quan_ly_theo_lo'),
    session
  ).lean();
  const productMap = new Map(productDocs.map(p => [String(p._id), p]));
  if (productMap.size !== new Set(items.map(x => String(x.hang_hoa_id))).size) {
    throw new Error('Có hàng hóa không hợp lệ hoặc đã ngừng kinh doanh');
  }
  for (const item of items) {
    const product = productMap.get(String(item.hang_hoa_id));
    if (!product.quan_ly_theo_lo) {
      item.lo_hang_id = undefined;
      item.lot_info = null;
    }
    validateLotInfoForProduct(item, product);
    if (!product.quan_ly_theo_lo && Number(item.so_luong || 0) <= 0) {
      throw new Error('Số lượng dòng hàng phải lớn hơn 0');
    }
    lineTotal(item);
    if (product.quan_ly_theo_lo && mode === 'completed') {
      if (!item.lo_hang_id && !item.lot_info) throw new Error('Hàng quản lý theo lô cần chọn hoặc tạo lô');
    }
  }

  const purchase = await withNhapHangLog('PhieuNhap', `tao phieu ${maPhieu}`, () => createOne(PhieuNhap, {
    cua_hang_id: storeId,
    kho_id: khoId,
    nha_cung_cap_id: supplierId,
    dia_chi_ncc_id: supplierAddressId,
    nguoi_tao_id: cleanId(data.nguoi_tao_id),
    ma_phieu_nhap: maPhieu,
    ngay_nhap: parseDate(data.ngay_nhap) || now,
    tong_tien_hang: totals.tongTienHang,
    giam_gia: totals.giamGia,
    kieu_giam_gia: totals.kieuGiamGia,
    tong_tien: totals.tongTien,
    can_tra_ncc: canTra,
    da_tra_ncc: daTra,
    con_no_ncc: conNo,
    phuong_thuc_thanh_toan: phuongThuc,
    trang_thai: mode,
    ghi_chu: String(data.ghi_chu || '').trim()
  }, session));

  const rows = [];
  const lotCache = new Map();
  for (const item of items) {
    const product = productMap.get(String(item.hang_hoa_id));
    if (product.quan_ly_theo_lo && mode === 'completed' && !item.lo_hang_id && !item.lot_info) {
      throw new Error('Hàng quản lý theo lô cần chọn hoặc tạo lô');
    }
    const total = lineTotal(item);
    const ctDoc = await withNhapHangLog('CTPhieuNhap', `tao dong hang=${item.hang_hoa_id} sl=${item.so_luong}`, () => createOne(CTPhieuNhap, {
      phieu_nhap_id: purchase._id,
      hang_hoa_id: item.hang_hoa_id,
      don_vi_tinh_id: product.don_vi_tinh_id || undefined,
      so_luong: item.so_luong,
      don_gia_nhap: item.don_gia_nhap,
      giam_gia_dong: item.giam_gia_dong,
      kieu_giam_gia_dong: item.kieu_giam_gia_dong,
      thanh_tien: total,
      lot_info: item.lot_info || undefined
    }, session));
    let lotId;
    if (product.quan_ly_theo_lo && (item.lo_hang_id || item.lot_info)) {
      lotId = await createLotForLine({
        storeId,
        khoId,
        supplierId,
        purchase,
        ctDoc,
        product,
        productId: item.hang_hoa_id,
        item,
        now,
        lotCache,
        session
      });
      await withNhapHangLog('CTPhieuNhap', `gan lo=${lotId} cho dong=${ctDoc._id}`, () => CTPhieuNhap.updateOne({ _id: ctDoc._id }, { $set: { lo_hang_id: lotId } }, withSessionOptions({}, session)));
    }
    rows.push({
      _id: ctDoc._id,
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId,
      so_luong: item.so_luong,
      don_gia_nhap: item.don_gia_nhap,
      thanh_tien: total,
      lot_info: item.lot_info || undefined
    });
  }

  if (mode === 'completed') {
    await applyCompletedEffects(purchase, rows, {
      userId: cleanId(data.nguoi_tao_id),
      so_quy_id: data.so_quy_id,
      cashBookId: data.cashBookId,
      soQuyId: data.soQuyId,
      chi_nhanh_id: data.chi_nhanh_id,
      includeDebt,
      chi_tiet_thanh_toan: payment.detail,
      payment,
      session
    });
    await withNhapHangLog('NhapVatChua', `nhap vat chua kem phieu=${purchase.ma_phieu_nhap}`, () =>
      importVatChuaWithPurchase(purchase, data, session)
    );
  }

  return purchase;
}

async function cancelPurchase(id, storeId, userId) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async function() {
      const filter = { _id: id, deleted_at: null };
      if (cleanId(storeId)) filter.cua_hang_id = storeId;
      const purchase = await withSessionQuery(PhieuNhap.findOne(filter), session);
      if (!purchase) throw new Error('Không tìm thấy phiếu nhập hoặc phiếu đang trong thùng rác');
      if (purchase.trang_thai === 'cancelled') throw new Error('Phiếu nhập đã bị hủy');

      const activeReturn = await withSessionQuery(PhieuTraHangNhap.findOne({
        phieu_nhap_id: purchase._id,
        trang_thai: { $ne: 'cancelled' },
        trang_thai_du_lieu: { $ne: 'inactive' },
        deleted_at: null
      }).setOptions({ strictQuery: false }).select('ma_phieu_tra_nhap'), session).lean();
      if (activeReturn) {
        const returnCode = activeReturn.ma_phieu_tra_nhap ? ' ' + activeReturn.ma_phieu_tra_nhap : '';
        throw new Error('Không thể hủy phiếu nhập ' + purchase.ma_phieu_nhap
          + ' vì còn phiếu trả hàng' + returnCode + ' đang có hiệu lực.');
      }

      const rows = await withSessionQuery(CTPhieuNhap.find({ phieu_nhap_id: purchase._id }), session).lean();
      if (purchase.trang_thai === 'completed') {
        await rollbackCompletedPurchaseEffects(purchase, rows, { userId, session });
        await cancelNhapVatChuaBySource(purchase.cua_hang_id, 'phieu_nhap', purchase._id, session);
        await PhieuThuChi.updateMany(
          {
            loai_phieu: 'chi',
            trang_thai: { $ne: 'cancelled' },
            $or: [
              { phieu_nhap_id: purchase._id },
              { 'allocations.phieu_nhap_id': purchase._id }
            ]
          },
          {
            $set: {
              trang_thai: 'cancelled',
              ghi_chu: 'Hủy theo phiếu nhập ' + purchase.ma_phieu_nhap
            }
          },
          withSessionOptions({}, session)
        );
        const now = new Date();
        await CongNoNhaCungCap.updateMany(
          { phieu_nhap_id: purchase._id, deleted_at: null },
          { $set: { deleted_at: now, deleted_by: cleanId(userId) || null } },
          withSessionOptions({}, session)
        );
        if (GiaoDichCongNoNhaCungCap) {
          await GiaoDichCongNoNhaCungCap.updateMany(
            {
              deleted_at: null,
              trang_thai: { $ne: 'cancelled' },
              $or: [
                { phieu_nhap_id: purchase._id },
                { 'phan_bo_phieu_nhap.phieu_nhap_id': purchase._id }
              ]
            },
            {
              $set: {
                deleted_at: now,
                deleted_by: cleanId(userId) || null,
                trang_thai: 'cancelled',
                nguoi_huy_id: cleanId(userId) || null,
                ngay_huy: now,
                ly_do_huy: 'Hủy phiếu nhập'
              }
            },
            withSessionOptions({}, session)
          );
        }
      }

      purchase.trang_thai = 'cancelled';
      purchase.trang_thai_du_lieu = 'inactive';
      await LoHang.updateMany(
        { phieu_nhap_id: purchase._id },
        { $set: { trang_thai_du_lieu: 'inactive', updated_at: new Date() } },
        withSessionOptions({}, session)
      );
      await purchase.save(withSessionOptions({}, session));
      result = purchase;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createPurchase,
  cancelPurchase,
  rollbackCompletedPurchaseEffects,
  restoreCompletedPurchaseEffects,
  calculateTotals,
  normalizeItems,
  normalizeQuyCachItems,
  parseMoney
};
