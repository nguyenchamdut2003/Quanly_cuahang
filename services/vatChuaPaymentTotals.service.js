const { PhieuThuChi, XuatVatChua } = require('../models/kiot.model');

function relatedId(value) {
  return String(value && value._id ? value._id : value || '').trim();
}

function buildNhapVatChuaReceiptFilter(docs, storeId, { includeCancelled = false } = {}) {
  const rows = Array.isArray(docs) ? docs : [];
  const ids = rows.map(function(doc) { return doc._id; }).filter(Boolean);
  const codes = rows.map(function(doc) { return String(doc.ma_nhap_vat_chua || '').trim(); }).filter(Boolean);
  const filter = {
    loai_phieu: 'chi',
    deleted_at: null,
    trang_thai_du_lieu: { $ne: 'inactive' },
    trang_thai: { $nin: includeCancelled ? ['inactive'] : ['cancelled', 'inactive'] },
    $or: [
      { nhap_vat_chua_id: { $in: ids } },
      { 'allocations.nhap_vat_chua_id': { $in: ids } }
    ]
  };
  if (codes.length) filter.$or.push({ ma_chung_tu_goc: { $in: codes } });
  const stores = [...new Set(rows.map(function(doc) { return relatedId(doc.cua_hang_id); }).filter(Boolean))];
  if (storeId) filter.cua_hang_id = storeId;
  else if (stores.length === 1) filter.cua_hang_id = stores[0];
  else if (stores.length > 1) filter.cua_hang_id = { $in: stores };
  return filter;
}

function getNhapVatChuaReceiptAmount(receipt, doc) {
  if (!receipt || !doc || receipt.deleted_at || receipt.trang_thai_du_lieu === 'inactive') return 0;
  if (receipt.trang_thai === 'cancelled' || receipt.trang_thai === 'inactive') return 0;
  if (receipt.loai_phieu && receipt.loai_phieu !== 'chi') return 0;
  if (receipt.cua_hang_id && doc.cua_hang_id && relatedId(receipt.cua_hang_id) !== relatedId(doc.cua_hang_id)) return 0;
  const id = relatedId(doc._id);
  const code = String(doc.ma_nhap_vat_chua || '').trim();
  const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
  // A shared receipt belongs to each document only for its allocated amount.
  // Never count the receipt's full value again through its legacy direct link.
  if (allocations.length) {
    return allocations.reduce(function(total, allocation) {
      if (!id || relatedId(allocation.nhap_vat_chua_id) !== id) return total;
      return total + Math.max(0, Number(allocation.so_tien) || 0);
    }, 0);
  }
  const linkedId = relatedId(receipt.nhap_vat_chua_id);
  const matches = linkedId ? linkedId === id : Boolean(code && code === String(receipt.ma_chung_tu_goc || '').trim());
  return matches ? Math.max(0, Number(receipt.gia_tri) || 0) : 0;
}

async function loadNhapVatChuaPaymentTotals(docs, { session = null, storeId } = {}) {
  const rows = Array.isArray(docs) ? docs : [];
  const totals = new Map(rows.map(function(doc) { return [relatedId(doc._id), 0]; }));
  if (!rows.length) return totals;
  let query = PhieuThuChi.find(buildNhapVatChuaReceiptFilter(rows, storeId))
    .setOptions({ strictQuery: false })
    .select('nhap_vat_chua_id ma_chung_tu_goc allocations gia_tri loai_phieu trang_thai trang_thai_du_lieu deleted_at cua_hang_id');
  if (session) query = query.session(session);
  const receipts = await query.lean();
  rows.forEach(function(doc) {
    totals.set(relatedId(doc._id), receipts.reduce(function(total, receipt) {
      return total + getNhapVatChuaReceiptAmount(receipt, doc);
    }, 0));
  });
  return totals;
}

async function loadNhapVatChuaReturnTotals(docs, { session = null, storeId } = {}) {
  const rows = Array.isArray(docs) ? docs : [];
  const totals = new Map(rows.map(function(doc) { return [relatedId(doc._id), 0]; }));
  if (!rows.length) return totals;
  const filter = {
    source_id: { $in: rows.map(function(doc) { return doc._id; }).filter(Boolean) },
    source_type: 'manual',
    loai_xuat: 'tra_hang_nhap',
    trang_thai: 'active',
    deleted_at: null,
    trang_thai_du_lieu: { $ne: 'inactive' }
  };
  const stores = [...new Set(rows.map(function(doc) { return relatedId(doc.cua_hang_id); }).filter(Boolean))];
  if (storeId) filter.cua_hang_id = storeId;
  else if (stores.length === 1) filter.cua_hang_id = stores[0];
  else if (stores.length > 1) filter.cua_hang_id = { $in: stores };
  let query = XuatVatChua.find(filter)
    .setOptions({ strictQuery: false })
    .select('source_id source_type loai_xuat tong_tien trang_thai trang_thai_du_lieu deleted_at cua_hang_id');
  if (session) query = query.session(session);
  const returns = await query.lean();
  const docsById = new Map(rows.map(function(doc) { return [relatedId(doc._id), doc]; }));
  returns.forEach(function(row) {
    if (row.trang_thai !== 'active' || row.deleted_at || row.trang_thai_du_lieu === 'inactive') return;
    if (row.source_type !== 'manual' || row.loai_xuat !== 'tra_hang_nhap') return;
    const id = relatedId(row.source_id);
    const doc = docsById.get(id);
    if (!doc) return;
    const store = storeId || doc.cua_hang_id;
    if (store && relatedId(row.cua_hang_id) !== relatedId(store)) return;
    totals.set(id, totals.get(id) + Math.max(0, Number(row.tong_tien) || 0));
  });
  return totals;
}

module.exports = {
  buildNhapVatChuaReceiptFilter,
  getNhapVatChuaReceiptAmount,
  loadNhapVatChuaPaymentTotals,
  loadNhapVatChuaReturnTotals
};
