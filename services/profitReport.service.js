const mongoose = require('mongoose');
const {
  HangHoa,
  LoHang,
  HoaDonBanHang,
  CTHoaDonBanHang,
  PhieuTraHang,
  PhieuNhap,
  KhachHang,
  NhaCungCap
} = require('../models/kiot.model');

function toObjectId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeSpecLabel(value) {
  const text = String(value || '').trim();
  return text || '---';
}

function makeLotSpecKey(loHangId, spec) {
  const attr = String(spec?.ten_quy_cach || spec?.ten_thuoc_tinh || '').trim();
  const attrId = spec?.gia_tri_thuoc_tinh_id ? String(spec.gia_tri_thuoc_tinh_id) : '';
  return `${String(loHangId || '')}::${attrId}::${attr}`;
}

function expandLineToLotSlices(line) {
  const attribute = String(line.ten_quy_cach || line.ten_thuoc_tinh || '').trim();
  const attrId = line.gia_tri_thuoc_tinh_id || null;
  const unitSale = Math.max(0, Number(line.don_gia || 0));
  const allocations = Array.isArray(line.lot_allocations) ? line.lot_allocations : [];

  if (allocations.length) {
    return allocations
      .map(function(row) {
        const qty = Math.max(0, Number(row.so_luong || 0));
        return {
          lo_hang_id: toObjectId(row.lo_hang_id),
          hang_hoa_id: toObjectId(line.hang_hoa_id?._id || line.hang_hoa_id),
          so_luong: qty,
          doanh_thu: qty * unitSale,
          ten_quy_cach: attribute,
          gia_tri_thuoc_tinh_id: attrId
        };
      })
      .filter(function(row) { return row.lo_hang_id && row.so_luong > 0; });
  }

  const lotId = toObjectId(line.lo_hang_id?._id || line.lo_hang_id);
  const qty = Math.max(0, Number(line.so_luong || 0));
  if (!lotId || qty <= 0) return [];
  return [{
    lo_hang_id: lotId,
    hang_hoa_id: toObjectId(line.hang_hoa_id?._id || line.hang_hoa_id),
    so_luong: qty,
    doanh_thu: qty * unitSale,
    ten_quy_cach: attribute,
    gia_tri_thuoc_tinh_id: attrId
  }];
}

function resolveUnitCost(slice, lotCostMap, productCost) {
  const lotCost = lotCostMap.get(String(slice.lo_hang_id || '')) || 0;
  const cost = lotCost || productCost || 0;
  return {
    unitCost: cost,
    thieu_gia_von: !cost
  };
}

async function loadSalesLineFacts(range, storeId) {
  const invoiceFilter = {
    ngay_ban: { $gte: range.start, $lt: range.end },
    trang_thai: { $ne: 'cancelled' }
  };
  if (storeId) invoiceFilter.cua_hang_id = storeId;

  const invoices = await HoaDonBanHang.find(invoiceFilter)
    .select('_id khach_hang_id ma_hoa_don ngay_ban')
    .lean();
  if (!invoices.length) {
    return { invoices: [], lines: [], invoiceMap: new Map() };
  }

  const invoiceMap = new Map(invoices.map(function(row) {
    return [String(row._id), row];
  }));
  const invoiceIds = invoices.map(function(row) { return row._id; });

  const lines = await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
    .populate('hang_hoa_id', 'ma_hang ten_hang gia_von nha_cung_cap_id')
    .populate('lo_hang_id', 'ma_lo ten_lo gia_von don_gia_nhap nha_cung_cap_id')
    .lean();

  return { invoices, lines, invoiceMap };
}

async function buildLotCostMap(lines) {
  const lotIds = new Set();
  lines.forEach(function(line) {
    (line.lot_allocations || []).forEach(function(alloc) {
      if (alloc?.lo_hang_id) lotIds.add(String(alloc.lo_hang_id));
    });
    const lotId = line.lo_hang_id?._id || line.lo_hang_id;
    if (lotId) lotIds.add(String(lotId));
  });

  if (!lotIds.size) return new Map();

  const lotDocs = await LoHang.find({ _id: { $in: Array.from(lotIds) } })
    .select('gia_von don_gia_nhap ma_lo ten_lo nha_cung_cap_id hang_hoa_id phieu_nhap_id ngay_nhap')
    .lean();

  return new Map(lotDocs.map(function(doc) {
    return [String(doc._id), {
      cost: Number(doc.gia_von || doc.don_gia_nhap || 0),
      doc: doc
    }];
  }));
}

function emptyProfitBucket() {
  return {
    doanh_thu: 0,
    gia_von: 0,
    so_luong: 0,
    dong_thieu_gia_von: 0
  };
}

function addSliceToBucket(bucket, slice, unitCost, thieuGiaVon) {
  bucket.doanh_thu += slice.doanh_thu;
  bucket.gia_von += roundMoney(slice.so_luong * unitCost);
  bucket.so_luong += slice.so_luong;
  if (thieuGiaVon) bucket.dong_thieu_gia_von += 1;
}

async function buildProfitByLotReport(options) {
  const storeId = toObjectId(options.cua_hang_id);
  const range = options.range;
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const { lines } = await loadSalesLineFacts(range, storeId);
  const lotCostMap = await buildLotCostMap(lines);
  const rowMap = new Map();

  lines.forEach(function(line) {
    const product = line.hang_hoa_id || {};
    const productCost = Number(product.gia_von || 0);
    expandLineToLotSlices(line).forEach(function(slice) {
      const lotInfo = lotCostMap.get(String(slice.lo_hang_id || '')) || {};
      const lotDoc = lotInfo.doc || line.lo_hang_id || {};
      const costInfo = resolveUnitCost(slice, new Map([[String(slice.lo_hang_id), lotInfo.cost || 0]]), productCost);
      const key = [
        String(slice.hang_hoa_id || ''),
        makeLotSpecKey(slice.lo_hang_id, slice)
      ].join('||');

      if (!rowMap.has(key)) {
        rowMap.set(key, {
          hang_hoa_id: slice.hang_hoa_id,
          lo_hang_id: slice.lo_hang_id,
          ma_hang: product.ma_hang || '',
          ten_hang: product.ten_hang || '',
          ma_lo: lotDoc.ma_lo || '',
          ten_lo: lotDoc.ten_lo || lotDoc.ma_lo || '',
          ten_quy_cach: normalizeSpecLabel(slice.ten_quy_cach),
          ngay_nhap: lotDoc.ngay_nhap || null,
          ...emptyProfitBucket()
        });
      }
      addSliceToBucket(rowMap.get(key), slice, costInfo.unitCost, costInfo.thieu_gia_von);
    });
  });

  let rows = Array.from(rowMap.values()).map(function(row) {
    const loiNhuan = row.doanh_thu - row.gia_von;
    return Object.assign({}, row, {
      loi_nhuan: loiNhuan,
      ty_le_loi_nhuan: row.doanh_thu > 0 ? (loiNhuan / row.doanh_thu) * 100 : 0,
      thieu_gia_von: row.dong_thieu_gia_von > 0
    });
  });

  if (keyword) {
    rows = rows.filter(function(row) {
      const haystack = [
        row.ma_hang,
        row.ten_hang,
        row.ma_lo,
        row.ten_lo,
        row.ten_quy_cach
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  rows.sort(function(a, b) {
    return b.loi_nhuan - a.loi_nhuan || String(a.ma_hang).localeCompare(String(b.ma_hang), 'vi');
  });

  const totals = rows.reduce(function(acc, row) {
    acc.rowCount += 1;
    acc.doanh_thu += row.doanh_thu;
    acc.gia_von += row.gia_von;
    acc.loi_nhuan += row.loi_nhuan;
    acc.dong_thieu_gia_von += row.dong_thieu_gia_von;
    if (row.thieu_gia_von) acc.lo_thieu_gia_von += 1;
    return acc;
  }, { rowCount: 0, doanh_thu: 0, gia_von: 0, loi_nhuan: 0, dong_thieu_gia_von: 0, lo_thieu_gia_von: 0 });

  return {
    generatedAt: new Date(),
    range,
    rows,
    topRows: rows.slice(0, 10),
    totals,
    filters: options,
    meta: {
      ghi_chu: 'Lợi nhuận = doanh thu bán (đơn giá × SL) − giá vốn (giá lô hoặc giá vốn HH). Dòng * = thiếu giá vốn.'
    }
  };
}

async function buildProfitByCustomerReport(options) {
  const storeId = toObjectId(options.cua_hang_id);
  const range = options.range;
  const customerSearch = String(options.customer || '').trim();
  const customerFilter = {};
  if (customerSearch) {
    customerFilter.$or = [
      { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
      { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
      { sdt: { $regex: customerSearch, $options: 'i' } }
    ];
  }

  const customers = await KhachHang.find(customerFilter).sort({ ma_khach_hang: 1 }).lean();
  const customerMap = new Map(customers.map(function(row) {
    return [String(row._id), row];
  }));
  const bucketMap = new Map();
  customers.forEach(function(customer) {
    bucketMap.set(String(customer._id), Object.assign({
      id: String(customer._id),
      code: customer.ma_khach_hang || '',
      name: customer.ten_khach_hang || '',
      phone: customer.sdt || '',
      invoiceCount: 0
    }, emptyProfitBucket()));
  });

  const { invoices, lines, invoiceMap } = await loadSalesLineFacts(range, storeId);
  const lotCostMapRaw = await buildLotCostMap(lines);
  const lotCostMap = new Map(Array.from(lotCostMapRaw.entries()).map(function(entry) {
    return [entry[0], entry[1].cost || 0];
  }));

  const invoiceCountMap = new Map();
  invoices.forEach(function(inv) {
    const key = String(inv.khach_hang_id || 'retail');
    invoiceCountMap.set(key, (invoiceCountMap.get(key) || 0) + 1);
  });

  lines.forEach(function(line) {
    const invoice = invoiceMap.get(String(line.hoa_don_id));
    if (!invoice) return;
    const customerKey = String(invoice.khach_hang_id || 'retail');
    if (!bucketMap.has(customerKey) && invoice.khach_hang_id) {
      const customer = customerMap.get(customerKey);
      if (customer) {
        bucketMap.set(customerKey, Object.assign({
          id: customerKey,
          code: customer.ma_khach_hang || '',
          name: customer.ten_khach_hang || '',
          phone: customer.sdt || '',
          invoiceCount: 0
        }, emptyProfitBucket()));
      }
    }
    if (!bucketMap.has(customerKey)) return;

    const productCost = Number(line.hang_hoa_id?.gia_von || 0);
    expandLineToLotSlices(line).forEach(function(slice) {
      const costInfo = resolveUnitCost(slice, lotCostMap, productCost);
      addSliceToBucket(bucketMap.get(customerKey), slice, costInfo.unitCost, costInfo.thieu_gia_von);
    });
  });

  const returnFilter = {
    ngay_tra: { $gte: range.start, $lt: range.end },
    trang_thai: { $nin: ['cancelled', 'draft'] },
    deleted_at: null
  };
  if (storeId) returnFilter.cua_hang_id = storeId;
  const returns = await PhieuTraHang.find(returnFilter).select('khach_hang_id tong_tien_tra').lean();
  returns.forEach(function(row) {
    const key = String(row.khach_hang_id || '');
    if (!bucketMap.has(key)) return;
    const bucket = bucketMap.get(key);
    bucket.doanh_thu -= Number(row.tong_tien_tra || 0);
  });

  bucketMap.forEach(function(bucket, key) {
    bucket.invoiceCount = invoiceCountMap.get(key) || 0;
    bucket.loi_nhuan = bucket.doanh_thu - bucket.gia_von;
    bucket.ty_le_loi_nhuan = bucket.doanh_thu > 0 ? (bucket.loi_nhuan / bucket.doanh_thu) * 100 : 0;
    bucket.thieu_gia_von = bucket.dong_thieu_gia_von > 0;
  });

  let rows = Array.from(bucketMap.values())
    .filter(function(row) { return row.doanh_thu !== 0 || row.gia_von !== 0 || row.so_luong > 0; })
    .sort(function(a, b) { return b.loi_nhuan - a.loi_nhuan || a.code.localeCompare(b.code, 'vi'); });

  const totals = rows.reduce(function(acc, row) {
    acc.customerCount += 1;
    acc.doanh_thu += row.doanh_thu;
    acc.gia_von += row.gia_von;
    acc.loi_nhuan += row.loi_nhuan;
    acc.dong_thieu_gia_von += row.dong_thieu_gia_von;
    if (row.thieu_gia_von) acc.lo_thieu_gia_von += 1;
    return acc;
  }, { customerCount: 0, doanh_thu: 0, gia_von: 0, loi_nhuan: 0, dong_thieu_gia_von: 0, lo_thieu_gia_von: 0 });

  return {
    generatedAt: new Date(),
    branchName: 'Cửa hàng trung tâm',
    range,
    rows,
    topCustomers: rows.slice(0, 10),
    totals,
    filters: options,
    viewMode: options.view === 'report' ? 'report' : 'chart',
    focus: 'loi-nhuan',
    meta: {
      ghi_chu: 'Lợi nhuận = doanh thu bán − giá vốn, đã trừ giá trị trả hàng. * = có dòng thiếu giá vốn.'
    }
  };
}

async function buildProfitBySupplierReport(options) {
  const storeId = toObjectId(options.cua_hang_id);
  const range = options.range;
  const supplierSearch = String(options.supplier || '').trim();
  const supplierFilter = {};
  if (supplierSearch) {
    supplierFilter.$or = [
      { ma_ncc: { $regex: supplierSearch, $options: 'i' } },
      { ten_ncc: { $regex: supplierSearch, $options: 'i' } },
      { sdt: { $regex: supplierSearch, $options: 'i' } }
    ];
  }

  const suppliers = await NhaCungCap.find(supplierFilter).sort({ ma_ncc: 1 }).lean();
  const supplierMap = new Map(suppliers.map(function(row) {
    return [String(row._id), row];
  }));
  const bucketMap = new Map();
  suppliers.forEach(function(supplier) {
    bucketMap.set(String(supplier._id), Object.assign({
      id: String(supplier._id),
      code: supplier.ma_ncc || '',
      name: supplier.ten_ncc || '',
      phone: supplier.sdt || ''
    }, emptyProfitBucket()));
  });

  const { lines } = await loadSalesLineFacts(range, storeId);
  const lotCostMapRaw = await buildLotCostMap(lines);
  const lotCostMap = new Map(Array.from(lotCostMapRaw.entries()).map(function(entry) {
    return [entry[0], entry[1]];
  }));

  lines.forEach(function(line) {
    const product = line.hang_hoa_id || {};
    const productCost = Number(product.gia_von || 0);
    const defaultSupplierId = String(product.nha_cung_cap_id || '');

    expandLineToLotSlices(line).forEach(function(slice) {
      const lotPack = lotCostMap.get(String(slice.lo_hang_id || '')) || {};
      const lotDoc = lotPack.doc || {};
      const supplierId = String(lotDoc.nha_cung_cap_id || defaultSupplierId || '');
      if (!supplierId || !bucketMap.has(supplierId)) return;
      const costInfo = resolveUnitCost(slice, new Map([[String(slice.lo_hang_id), lotPack.cost || 0]]), productCost);
      addSliceToBucket(bucketMap.get(supplierId), slice, costInfo.unitCost, costInfo.thieu_gia_von);
    });
  });

  bucketMap.forEach(function(bucket) {
    bucket.loi_nhuan = bucket.doanh_thu - bucket.gia_von;
    bucket.ty_le_loi_nhuan = bucket.doanh_thu > 0 ? (bucket.loi_nhuan / bucket.doanh_thu) * 100 : 0;
    bucket.thieu_gia_von = bucket.dong_thieu_gia_von > 0;
  });

  let rows = Array.from(bucketMap.values())
    .filter(function(row) { return row.doanh_thu !== 0 || row.gia_von !== 0 || row.so_luong > 0; })
    .sort(function(a, b) { return b.loi_nhuan - a.loi_nhuan || a.code.localeCompare(b.code, 'vi'); });

  const totals = rows.reduce(function(acc, row) {
    acc.supplierCount += 1;
    acc.doanh_thu += row.doanh_thu;
    acc.gia_von += row.gia_von;
    acc.loi_nhuan += row.loi_nhuan;
    acc.dong_thieu_gia_von += row.dong_thieu_gia_von;
    if (row.thieu_gia_von) acc.lo_thieu_gia_von += 1;
    return acc;
  }, { supplierCount: 0, doanh_thu: 0, gia_von: 0, loi_nhuan: 0, dong_thieu_gia_von: 0, lo_thieu_gia_von: 0 });

  return {
    generatedAt: new Date(),
    branchName: 'Cửa hàng trung tâm',
    range,
    rows,
    topSuppliers: rows.slice(0, 10),
    totals,
    filters: options,
    viewMode: options.view === 'report' ? 'report' : 'chart',
    focus: 'loi-nhuan',
    meta: {
      ghi_chu: 'Phân bổ theo NCC của lô bán (hoặc NCC mặc định của hàng). * = có dòng thiếu giá vốn.'
    }
  };
}

async function buildProfitBySupplierAddressReport(options = {}) {
  const storeId = toObjectId(options.cua_hang_id);
  const supplierId = toObjectId(options.supplier_id || options.nha_cung_cap_id);
  const addresses = Array.isArray(options.addresses) ? options.addresses : [];
  const range = options.range || { start: new Date(0), end: new Date('3000-01-01T00:00:00.000Z') };
  const addressIds = new Set(addresses.map(function(row) { return String(row._id || ''); }).filter(Boolean));
  const bucketMap = new Map();

  addresses.forEach(function(address) {
    const id = String(address._id || '');
    if (!id) return;
    bucketMap.set(id, Object.assign({
      id,
      address_id: id,
      detailRows: []
    }, emptyProfitBucket()));
  });

  if (!supplierId || !addressIds.size) {
    return { rows: Array.from(bucketMap.values()), totals: { doanh_thu: 0, gia_von: 0, loi_nhuan: 0, so_luong: 0 } };
  }

  const { lines, invoiceMap } = await loadSalesLineFacts(range, storeId);
  const lotCostMapRaw = await buildLotCostMap(lines);
  const purchaseIds = Array.from(new Set(Array.from(lotCostMapRaw.values())
    .map(function(pack) { return pack && pack.doc ? pack.doc.phieu_nhap_id : null; })
    .filter(Boolean)
    .map(String)));

  const purchases = purchaseIds.length ? await PhieuNhap.find({
    _id: { $in: purchaseIds },
    nha_cung_cap_id: supplierId
  }).select('_id dia_chi_ncc_id').lean() : [];
  const purchaseAddressMap = new Map(purchases.map(function(row) {
    return [String(row._id), String(row.dia_chi_ncc_id || '')];
  }));

  lines.forEach(function(line) {
    const product = line.hang_hoa_id || {};
    const productCost = Number(product.gia_von || 0);
    const invoice = invoiceMap.get(String(line.hoa_don_id)) || {};

    expandLineToLotSlices(line).forEach(function(slice) {
      const lotPack = lotCostMapRaw.get(String(slice.lo_hang_id || '')) || {};
      const lotDoc = lotPack.doc || {};
      const purchaseId = String(lotDoc.phieu_nhap_id || '');
      const addressId = purchaseAddressMap.get(purchaseId) || '';
      if (!addressId || !bucketMap.has(addressId)) return;

      const costInfo = resolveUnitCost(slice, new Map([[String(slice.lo_hang_id), lotPack.cost || 0]]), productCost);
      const lineCost = roundMoney(slice.so_luong * costInfo.unitCost);
      const bucket = bucketMap.get(addressId);
      addSliceToBucket(bucket, slice, costInfo.unitCost, costInfo.thieu_gia_von);
      bucket.detailRows.push({
        hoa_don_id: invoice._id || line.hoa_don_id,
        ma_hoa_don: invoice.ma_hoa_don || '',
        ngay_ban: invoice.ngay_ban || null,
        hang_hoa_id: product._id || slice.hang_hoa_id,
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        lo_hang_id: slice.lo_hang_id,
        ma_lo: lotDoc.ma_lo || '',
        ten_lo: lotDoc.ten_lo || lotDoc.ma_lo || '',
        ten_quy_cach: normalizeSpecLabel(slice.ten_quy_cach),
        so_luong: slice.so_luong,
        doanh_thu: slice.doanh_thu,
        gia_von: lineCost,
        loi_nhuan: slice.doanh_thu - lineCost,
        thieu_gia_von: costInfo.thieu_gia_von
      });
    });
  });

  const rows = Array.from(bucketMap.values()).map(function(bucket) {
    bucket.loi_nhuan = bucket.doanh_thu - bucket.gia_von;
    bucket.ty_le_loi_nhuan = bucket.doanh_thu > 0 ? (bucket.loi_nhuan / bucket.doanh_thu) * 100 : 0;
    bucket.thieu_gia_von = bucket.dong_thieu_gia_von > 0;
    bucket.detailRows.sort(function(a, b) {
      return new Date(b.ngay_ban || 0).getTime() - new Date(a.ngay_ban || 0).getTime()
        || String(a.ma_hang).localeCompare(String(b.ma_hang), 'vi');
    });
    return bucket;
  });

  const totals = rows.reduce(function(acc, row) {
    acc.doanh_thu += row.doanh_thu;
    acc.gia_von += row.gia_von;
    acc.loi_nhuan += row.loi_nhuan;
    acc.so_luong += row.so_luong;
    return acc;
  }, { doanh_thu: 0, gia_von: 0, loi_nhuan: 0, so_luong: 0 });

  return { rows, totals };
}

module.exports = {
  buildProfitByLotReport,
  buildProfitByCustomerReport,
  buildProfitBySupplierReport,
  buildProfitBySupplierAddressReport
};
