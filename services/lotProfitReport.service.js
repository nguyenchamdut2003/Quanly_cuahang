const mongoose = require('mongoose');
const {
  HangHoa,
  LoHang,
  TonKhoLo,
  CTPhieuNhap,
  PhieuNhap,
  HoaDonBanHang,
  CTHoaDonBanHang,
  Kho
} = require('../models/kiot.model');

function toObjectId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function parseDateStart(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDateEnd(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function lotDisplayName(lot) {
  if (!lot) return 'Lô không tên';
  return String(lot.ten_lo || lot.ma_lo || '').trim() || 'Lô không tên';
}

function normalizeSpecLabel(value) {
  const text = String(value || '').trim();
  return text || '---';
}

function specFromImportRow(row) {
  let tenQuyCach = '';
  const lotInfo = row.lot_info;
  if (lotInfo && typeof lotInfo === 'object') {
    tenQuyCach = String(lotInfo.ten_quy_cach || lotInfo.quy_cach || '').trim();
    if (!tenQuyCach && Array.isArray(lotInfo.quy_cach_items) && lotInfo.quy_cach_items[0]) {
      tenQuyCach = String(lotInfo.quy_cach_items[0].ten_quy_cach || '').trim();
    }
  }
  return {
    ten_quy_cach: tenQuyCach,
    gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || null
  };
}

function importSlicesFromRow(row) {
  const lotInfo = row.lot_info;
  const qcItems = lotInfo && typeof lotInfo === 'object' && Array.isArray(lotInfo.quy_cach_items)
    ? lotInfo.quy_cach_items
    : [];
  const normalizedQcItems = qcItems
    .map((item) => {
      const qty = Math.max(0, Number(item.so_luong || item.so_luong_nhap || 0));
      const price = Math.max(0, Number(item.don_gia_nhap || item.gia_von || row.don_gia_nhap || 0));
      return {
        ten_quy_cach: String(item.ten_quy_cach || item.ten_thuoc_tinh || item.quy_cach || '').trim(),
        gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || row.gia_tri_thuoc_tinh_id || null,
        so_luong: qty,
        gia_tri_nhap: Math.max(0, Number(item.thanh_tien || qty * price))
      };
    })
    .filter((item) => item.ten_quy_cach || item.so_luong > 0 || item.gia_tri_nhap > 0);

  if (normalizedQcItems.length) return normalizedQcItems;

  const spec = specFromImportRow(row);
  const qty = Math.max(0, Number(row.so_luong || 0));
  const price = Math.max(0, Number(row.don_gia_nhap || 0));
  return [{
    ten_quy_cach: spec.ten_quy_cach,
    gia_tri_thuoc_tinh_id: spec.gia_tri_thuoc_tinh_id,
    so_luong: qty,
    gia_tri_nhap: qty * price
  }];
}

/** Khóa tổng hợp: lo_hang_id + thuộc tính/quy cách (cùng hang_hoa_id trong một báo cáo). */
function makeLotSpecKey(loHangId, spec = {}) {
  const attr = String(spec.ten_quy_cach || spec.ten_thuoc_tinh || '').trim();
  const attrId = spec.gia_tri_thuoc_tinh_id ? String(spec.gia_tri_thuoc_tinh_id) : '';
  return `${String(loHangId)}::${attrId}::${attr}`;
}

async function loadProductLotOptions(hangHoaId) {
  const map = new Map();
  const stockFilter = { hang_hoa_id: hangHoaId };
  const stockLots = await TonKhoLo.find(stockFilter)
    .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
    .sort({ updated_at: -1, created_at: -1 })
    .lean();

  stockLots.forEach((row) => {
    const lot = row.lo_hang_id || {};
    const id = String(lot._id || row.lo_hang_id || '');
    if (!id || map.has(id)) return;
    map.set(id, {
      _id: id,
      lo_hang_id: id,
      ten_lo: lot.ten_lo || '',
      ma_lo: lot.ma_lo || '',
      han_su_dung: lot.han_su_dung || '',
      ngay_nhap: lot.ngay_nhap || '',
      label: lotDisplayName(lot)
    });
  });

  const directLots = await LoHang.find({ hang_hoa_id: hangHoaId })
    .select('ten_lo ma_lo han_su_dung kho_id ngay_nhap')
    .sort({ ngay_nhap: -1 })
    .lean();
  directLots.forEach((lot) => {
    const id = String(lot._id || '');
    if (!id || map.has(id)) return;
    map.set(id, {
      _id: id,
      lo_hang_id: id,
      ten_lo: lot.ten_lo || '',
      ma_lo: lot.ma_lo || '',
      han_su_dung: lot.han_su_dung || '',
      ngay_nhap: lot.ngay_nhap || '',
      label: lotDisplayName(lot)
    });
  });

  return Array.from(map.values());
}

function expandLineToLotSlices(line) {
  const attribute = String(line.ten_quy_cach || line.ten_thuoc_tinh || '').trim();
  const attrId = line.gia_tri_thuoc_tinh_id || null;
  const allocations = Array.isArray(line.lot_allocations) ? line.lot_allocations : [];
  if (allocations.length) {
    return allocations
      .map((row) => ({
        lo_hang_id: toObjectId(row.lo_hang_id),
        ten_lo: row.ten_lo,
        ma_lo: row.ma_lo,
        so_luong_xuat: Math.max(0, Number(row.so_luong || 0)),
        ten_quy_cach: attribute,
        gia_tri_thuoc_tinh_id: attrId
      }))
      .filter((row) => row.lo_hang_id && row.so_luong_xuat > 0);
  }
  const lotId = toObjectId(line.lo_hang_id);
  const qty = Math.max(0, Number(line.so_luong || 0));
  if (!lotId || qty <= 0) return [];
  return [{
    lo_hang_id: lotId,
    ten_lo: '',
    ma_lo: '',
    so_luong_xuat: qty,
    ten_quy_cach: attribute,
    gia_tri_thuoc_tinh_id: attrId
  }];
}

async function loadLotImportStatsBySpec(hangHoaId, options = {}) {
  const map = new Map();
  const filterLoId = toObjectId(options.lo_hang_id);

  const completedPurchases = await PhieuNhap.find({
    trang_thai: 'completed',
    deleted_at: null
  }).select('_id').lean();
  const purchaseIds = completedPurchases.map((row) => row._id);
  if (!purchaseIds.length) return map;

  const detailFilter = {
    hang_hoa_id: hangHoaId,
    phieu_nhap_id: { $in: purchaseIds },
    lo_hang_id: { $exists: true, $ne: null }
  };
  if (filterLoId) detailFilter.lo_hang_id = filterLoId;

  const details = await CTPhieuNhap.find(detailFilter)
    .select('lo_hang_id so_luong don_gia_nhap gia_tri_thuoc_tinh_id lot_info')
    .lean();

  details.forEach((row) => {
    const lotId = toObjectId(row.lo_hang_id);
    if (!lotId) return;
    importSlicesFromRow(row).forEach((slice) => {
      const key = makeLotSpecKey(lotId, slice);
      if (!map.has(key)) {
        map.set(key, {
          lo_hang_id: lotId,
          ten_quy_cach: normalizeSpecLabel(slice.ten_quy_cach),
          gia_tri_thuoc_tinh_id: slice.gia_tri_thuoc_tinh_id,
          so_luong_nhap: 0,
          gia_tri_nhap: 0
        });
      }
      const bucket = map.get(key);
      bucket.so_luong_nhap += Math.max(0, Number(slice.so_luong || 0));
      bucket.gia_tri_nhap += Math.max(0, Number(slice.gia_tri_nhap || 0));
    });
  });

  return map;
}

function createEmptySalesBucket(slice, product) {
  return {
    lo_hang_id: slice.lo_hang_id,
    ten_lo: slice.ten_lo,
    ma_lo: slice.ma_lo,
    ten_quy_cach: normalizeSpecLabel(slice.ten_quy_cach),
    gia_tri_thuoc_tinh_id: slice.gia_tri_thuoc_tinh_id || null,
    ten_hang: product.ten_hang || '',
    ma_hang: product.ma_hang || '',
    so_luong_xuat: 0,
    tong_doanh_thu: 0
  };
}

function buildAggregatedRow(key, salesBucket, importBucket, lotDoc, product) {
  const importInfo = importBucket || {
    so_luong_nhap: 0,
    gia_tri_nhap: 0
  };
  const soLuongNhap = Math.max(0, Number(importInfo.so_luong_nhap || 0));
  const donGiaNhap = soLuongNhap > 0
    ? Math.max(0, Number(importInfo.gia_tri_nhap || 0) / soLuongNhap)
    : Math.max(0, Number(lotDoc.don_gia_nhap || lotDoc.gia_von || 0));

  const soLuongXuat = Math.max(0, Number(salesBucket?.so_luong_xuat || 0));
  const tongDoanhThu = Math.max(0, Number(salesBucket?.tong_doanh_thu || 0));
  const tongGiaVon = soLuongXuat * donGiaNhap;
  const donGiaXuatBinhQuan = soLuongXuat > 0 ? tongDoanhThu / soLuongXuat : 0;
  const loiNhuan = tongDoanhThu - tongGiaVon;

  const ngayNhap = lotDoc.ngay_nhap || null;

  return {
    ngay_nhap: ngayNhap,
    ten_hang: salesBucket?.ten_hang || product.ten_hang || '',
    ma_hang: salesBucket?.ma_hang || product.ma_hang || '',
    lo_hang_id: salesBucket?.lo_hang_id || importInfo.lo_hang_id || lotDoc._id,
    ten_lo: String(salesBucket?.ten_lo || lotDoc.ten_lo || '').trim(),
    ma_lo: String(salesBucket?.ma_lo || lotDoc.ma_lo || '').trim(),
    lo_hien_thi: lotDisplayName(lotDoc),
    ten_quy_cach: salesBucket?.ten_quy_cach || importInfo.ten_quy_cach || '---',
    so_luong_nhap: soLuongNhap,
    don_gia_nhap: donGiaNhap,
    tong_gia_von: tongGiaVon,
    so_luong_xuat: soLuongXuat,
    don_gia_xuat_binh_quan: donGiaXuatBinhQuan,
    tong_doanh_thu: tongDoanhThu,
    loi_nhuan: loiNhuan,
    thieu_gia_nhap: soLuongNhap <= 0 && donGiaNhap <= 0,
    aggregate_key: key
  };
}

async function buildLotProfitReport(options = {}) {
  const hangHoaId = toObjectId(options.hang_hoa_id);
  if (!hangHoaId) {
    return { rows: [], filters: {}, meta: { message: 'Thiếu hàng hóa' } };
  }

  const product = await HangHoa.findById(hangHoaId).select('ten_hang ma_hang quan_ly_theo_lo cua_hang_id').lean();
  if (!product) {
    return { rows: [], filters: {}, meta: { message: 'Không tìm thấy hàng hóa' } };
  }

  const filterLoId = toObjectId(options.lo_hang_id);
  const ngayNhapFrom = parseDateStart(options.ngay_nhap_from);
  const ngayNhapTo = parseDateEnd(options.ngay_nhap_to);
  const storeId = toObjectId(options.cua_hang_id) || toObjectId(product.cua_hang_id);
  const filterOptions = {
    lots: await loadProductLotOptions(hangHoaId)
  };

  const importMap = await loadLotImportStatsBySpec(hangHoaId, { lo_hang_id: filterLoId });
  const salesMap = new Map();

  const invoiceFilter = { trang_thai: { $ne: 'cancelled' } };
  if (storeId) invoiceFilter.cua_hang_id = storeId;

  const invoices = await HoaDonBanHang.find(invoiceFilter)
    .select('_id ma_hoa_don ngay_ban')
    .lean();
  const invoiceIds = invoices.map((row) => row._id);

  if (invoiceIds.length) {
    const invoiceMap = new Map(invoices.map((row) => [String(row._id), row]));
    const lineFilter = { hang_hoa_id: hangHoaId, hoa_don_id: { $in: invoiceIds } };
    const lines = await CTHoaDonBanHang.find(lineFilter)
      .select('hoa_don_id lo_hang_id lot_allocations ten_quy_cach ten_thuoc_tinh gia_tri_thuoc_tinh_id so_luong don_gia')
      .lean();

    lines.forEach((line) => {
      if (!invoiceMap.get(String(line.hoa_don_id))) return;
      const unitSale = Math.max(0, Number(line.don_gia || 0));
      expandLineToLotSlices(line).forEach((slice) => {
        if (filterLoId && String(slice.lo_hang_id) !== String(filterLoId)) return;
        const key = makeLotSpecKey(slice.lo_hang_id, slice);
        if (!salesMap.has(key)) {
          salesMap.set(key, createEmptySalesBucket(slice, product));
        }
        const bucket = salesMap.get(key);
        const qty = slice.so_luong_xuat;
        bucket.so_luong_xuat += qty;
        bucket.tong_doanh_thu += qty * unitSale;
        if (!bucket.ten_lo && slice.ten_lo) bucket.ten_lo = slice.ten_lo;
        if (!bucket.ma_lo && slice.ma_lo) bucket.ma_lo = slice.ma_lo;
      });
    });
  }

  const allKeys = new Set([...importMap.keys(), ...salesMap.keys()]);
  if (!allKeys.size && filterLoId) {
    allKeys.add(makeLotSpecKey(filterLoId, {}));
  }

  const lotIds = [...new Set([...allKeys].map((key) => key.split('::')[0]))];
  const lotDocs = lotIds.length
    ? await LoHang.find({ _id: { $in: lotIds } }).select('ten_lo ma_lo ngay_nhap don_gia_nhap gia_von').lean()
    : [];
  const lotDocMap = new Map(lotDocs.map((row) => [String(row._id), row]));

  const rows = [...allKeys].map((key) => {
    const lotId = key.split('::')[0];
    const lotDoc = lotDocMap.get(lotId) || { _id: lotId };
    return buildAggregatedRow(
      key,
      salesMap.get(key),
      importMap.get(key),
      lotDoc,
      product
    );
  });

  const visibleRows = rows.filter((row) => {
    if (!(row.so_luong_nhap > 0 || row.so_luong_xuat > 0)) return false;
    if (ngayNhapFrom || ngayNhapTo) {
      if (!row.ngay_nhap) return false;
      const time = new Date(row.ngay_nhap).getTime();
      if (!Number.isFinite(time)) return false;
      if (ngayNhapFrom && time < ngayNhapFrom.getTime()) return false;
      if (ngayNhapTo && time > ngayNhapTo.getTime()) return false;
    }
    return true;
  });

  visibleRows.sort((a, b) => {
    const dateA = a.ngay_nhap ? new Date(a.ngay_nhap).getTime() : 0;
    const dateB = b.ngay_nhap ? new Date(b.ngay_nhap).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA;
    return String(a.lo_hien_thi || '').localeCompare(String(b.lo_hien_thi || ''), 'vi');
  });

  return {
    rows: visibleRows,
    product,
    filters: { applied: options },
    filterOptions,
    meta: {
      aggregate_by: 'lo_hang_id + thuộc tính/quy cách',
      ghi_chu_gia_nhap: 'Báo cáo tổng hợp theo lô/quy cách. Đơn giá nhập = BQGQ từ phiếu nhập hoàn thành. Doanh thu = tổng từ hóa đơn bán (CTHoaDonBanHang, phân bổ lot_allocations).',
      tong_dong: visibleRows.length
    }
  };
}

module.exports = {
  buildLotProfitReport,
  loadLotImportStatsBySpec,
  makeLotSpecKey
};
