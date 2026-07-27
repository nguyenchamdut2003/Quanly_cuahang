const mongoose = require('mongoose');
const { ThungRacItem } = require('../models/trash.model');
const {
  HangHoa,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LichSuKho,
  GiaBanHangHoa,
  CTBangGia,
  HangHoaThuocTinh,
  PhieuNhap,
  CTPhieuNhap,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  DonHang,
  CTDonHang,
  HoaDonBanHang,
  CTHoaDonBanHang,
  PhieuTraHang,
  CTPhieuTraHang,
  PhieuThuChi,
  SoQuy,
  CongNoNhaCungCap,
  CongNoKhachHang,
  GiaoDichCongNoNhaCungCap,
  GiaoDichCongNoKhachHang,
  HoaDonDauVao,
  LoHang,
  VanDon,
  GopPhieuNhap,
  GopDonHang,
  GopHoaDon,
  PhanBoHang,
  CTPhanBoHang,
  PhieuKiemKho,
  CTPhieuKiemKho,
  PhieuXuatNoiBo,
  CTXuatNoiBo,
  PhieuXuatHuy,
  CTXuatHuy,
  NhapVatChua,
  XuatVatChua
} = require('../models/kiot.model');

const TRASH_RETENTION_DAYS = 30;

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
  error.statusCode = statusCode || 400;
  return error;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTrashRetentionDays() {
  return TRASH_RETENTION_DAYS;
}

function getTrashRetentionCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS);
  return cutoff;
}

function normalizeRootIds(rawIds) {
  if (!rawIds) return [];
  const list = Array.isArray(rawIds) ? rawIds : [rawIds];
  return [...new Set(list.map(function(id) {
    return String(id || '').trim();
  }).filter(function(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }))];
}

function toObjectId(value) {
  const raw = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

function addCount(total, result) {
  return Number(total || 0) + Number(result && (result.deletedCount || result.modifiedCount) || 0);
}

async function collectIds(query, Model) {
  const rows = await Model.find(query).select('_id').lean();
  return rows.map(function(row) { return row._id; }).filter(Boolean);
}

async function distinctObjectIds(Model, query, field) {
  const values = await Model.distinct(field, query);
  return (values || []).map(toObjectId).filter(Boolean);
}

function receiptCashBookFilter(bookId) {
  return {
    $or: [
      { so_quy_id: bookId },
      { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': bookId },
      { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': bookId }
    ]
  };
}

async function hardDeleteReceipts(receiptIds, storeId) {
  const ids = (receiptIds || []).filter(Boolean);
  if (!ids.length) return 0;
  const receiptFilter = { _id: { $in: ids } };
  if (storeId) receiptFilter.cua_hang_id = storeId;
  let deleted = 0;
  deleted = addCount(deleted, await CongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: { $in: ids } }));
  deleted = addCount(deleted, await CongNoKhachHang.deleteMany({ phieu_thu_chi_id: { $in: ids } }));
  if (GiaoDichCongNoNhaCungCap) {
    deleted = addCount(deleted, await GiaoDichCongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: { $in: ids } }));
  }
  if (GiaoDichCongNoKhachHang) {
    deleted = addCount(deleted, await GiaoDichCongNoKhachHang.deleteMany({ phieu_thu_chi_id: { $in: ids } }));
  }
  deleted = addCount(deleted, await PhieuThuChi.deleteMany(receiptFilter));
  return deleted;
}

async function hardDeleteVatChuaImport(importId, storeId) {
  const id = toObjectId(importId);
  if (!id) return 0;
  let deleted = 0;
  const receiptIds = await collectIds({ nhap_vat_chua_id: id }, PhieuThuChi);
  const xuatIds = await collectIds({ source_id: id }, XuatVatChua);
  deleted = addCount(deleted, await XuatVatChua.deleteMany({ _id: { $in: xuatIds } }));
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await CongNoNhaCungCap.deleteMany({ nhap_vat_chua_id: id }));
  deleted = addCount(deleted, await NhapVatChua.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteVatChuaExport(exportId, storeId) {
  const id = toObjectId(exportId);
  if (!id) return 0;
  const doc = await XuatVatChua.findById(id).select('ma_xuat_vat_chua source_id').lean();
  let deleted = 0;
  const receiptFilter = {
    $or: [
      { ma_chung_tu_goc: doc && doc.ma_xuat_vat_chua ? doc.ma_xuat_vat_chua : '' }
    ].filter(function(item) {
      return Object.values(item)[0];
    })
  };
  if (storeId) receiptFilter.cua_hang_id = storeId;
  const receiptIds = receiptFilter.$or.length ? await collectIds(receiptFilter, PhieuThuChi) : [];
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await XuatVatChua.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeletePurchase(root, storeId) {
  const id = toObjectId(root.entity_id);
  if (!id) return 0;
  let deleted = 0;
  const returnIds = await collectIds({ phieu_nhap_id: id }, PhieuTraHangNhap);
  const vatChuaImportIds = await collectIds({ source_type: 'phieu_nhap', source_id: id }, NhapVatChua);
  for (const vatChuaImportId of vatChuaImportIds) {
    deleted += await hardDeleteVatChuaImport(vatChuaImportId, storeId);
  }
  const receiptIds = await collectIds({
    $or: [
      { phieu_nhap_id: id },
      { phieu_tra_hang_nhap_id: { $in: returnIds } },
      { 'allocations.phieu_nhap_id': id }
    ]
  }, PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await CongNoNhaCungCap.deleteMany({
    $or: [
      { phieu_nhap_id: id },
      { phieu_tra_nhap_id: { $in: returnIds } },
      { phieu_thu_chi_id: { $in: receiptIds } }
    ]
  }));
  if (GiaoDichCongNoNhaCungCap) {
    deleted = addCount(deleted, await GiaoDichCongNoNhaCungCap.deleteMany({
      $or: [
        { phieu_nhap_id: id },
        { phieu_tra_hang_nhap_id: { $in: returnIds } },
        { phieu_thu_chi_id: { $in: receiptIds } }
      ]
    }));
  }
  deleted = addCount(deleted, await CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: { $in: returnIds } }));
  deleted = addCount(deleted, await PhieuTraHangNhap.deleteMany({ _id: { $in: returnIds } }));
  deleted = addCount(deleted, await CTPhieuNhap.deleteMany({ phieu_nhap_id: id }));
  deleted = addCount(deleted, await HoaDonDauVao.deleteMany({ phieu_nhap_id: id }));
  deleted = addCount(deleted, await LoHang.deleteMany({ phieu_nhap_id: id }));
  deleted = addCount(deleted, await GopPhieuNhap.deleteMany({ $or: [{ phieu_nhan_id: id }, { phieu_nguon_ids: id }] }));
  deleted = addCount(deleted, await PhieuNhap.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteReturnImport(returnId, storeId) {
  const id = toObjectId(returnId);
  if (!id) return 0;
  let deleted = 0;
  const receiptIds = await collectIds({ phieu_tra_hang_nhap_id: id }, PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await CongNoNhaCungCap.deleteMany({
    $or: [
      { phieu_tra_nhap_id: id },
      { phieu_thu_chi_id: { $in: receiptIds } }
    ]
  }));
  if (GiaoDichCongNoNhaCungCap) {
    deleted = addCount(deleted, await GiaoDichCongNoNhaCungCap.deleteMany({
      $or: [
        { phieu_tra_hang_nhap_id: id },
        { phieu_thu_chi_id: { $in: receiptIds } }
      ]
    }));
  }
  deleted = addCount(deleted, await XuatVatChua.deleteMany({ source_type: 'phieu_tra_hang_nhap', source_id: id }));
  deleted = addCount(deleted, await CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: id }));
  deleted = addCount(deleted, await PhieuTraHangNhap.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteInvoice(invoiceId, storeId) {
  const id = toObjectId(invoiceId);
  if (!id) return 0;
  let deleted = 0;
  const returnIds = await collectIds({ hoa_don_id: id }, PhieuTraHang);
  const receiptIds = await collectIds({
    $or: [
      { hoa_don_id: id },
      { phieu_tra_hang_id: { $in: returnIds } }
    ]
  }, PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await CongNoKhachHang.deleteMany({
    $or: [
      { hoa_don_id: id },
      { phieu_thu_chi_id: { $in: receiptIds } }
    ]
  }));
  if (GiaoDichCongNoKhachHang) {
    deleted = addCount(deleted, await GiaoDichCongNoKhachHang.deleteMany({
      $or: [
        { hoa_don_id: id },
        { phieu_tra_hang_id: { $in: returnIds } },
        { phieu_thu_chi_id: { $in: receiptIds } }
      ]
    }));
  }
  deleted = addCount(deleted, await CTPhieuTraHang.deleteMany({ phieu_tra_hang_id: { $in: returnIds } }));
  deleted = addCount(deleted, await PhieuTraHang.deleteMany({ _id: { $in: returnIds } }));
  deleted = addCount(deleted, await CTHoaDonBanHang.deleteMany({ hoa_don_id: id }));
  deleted = addCount(deleted, await XuatVatChua.deleteMany({ source_type: 'hoa_don', source_id: id }));
  deleted = addCount(deleted, await NhapVatChua.deleteMany({ source_type: 'hoa_don', source_id: id }));
  deleted = addCount(deleted, await GopHoaDon.deleteMany({ $or: [{ hoa_don_nhan_id: id }, { hoa_don_nguon_ids: id }] }));
  deleted = addCount(deleted, await HoaDonBanHang.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteOrder(root, storeId) {
  const id = toObjectId(root.entity_id);
  if (!id) return 0;
  let deleted = 0;
  const invoiceIds = await collectIds({ don_hang_id: id }, HoaDonBanHang);
  for (const invoiceId of invoiceIds) {
    deleted += await hardDeleteInvoice(invoiceId, storeId);
  }
  const returnIds = await collectIds({ don_hang_id: id }, PhieuTraHang);
  const receiptIds = await collectIds({
    $or: [
      { don_hang_id: id },
      { phieu_tra_hang_id: { $in: returnIds } }
    ]
  }, PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await CongNoKhachHang.deleteMany({
    $or: [
      { don_hang_id: id },
      { phieu_thu_chi_id: { $in: receiptIds } }
    ]
  }));
  deleted = addCount(deleted, await CTPhieuTraHang.deleteMany({ phieu_tra_hang_id: { $in: returnIds } }));
  deleted = addCount(deleted, await PhieuTraHang.deleteMany({ _id: { $in: returnIds } }));
  deleted = addCount(deleted, await CTDonHang.deleteMany({ don_hang_id: id }));
  deleted = addCount(deleted, await VanDon.deleteMany({ don_hang_id: id }));
  deleted = addCount(deleted, await XuatVatChua.deleteMany({ source_type: 'don_hang', source_id: id }));
  deleted = addCount(deleted, await NhapVatChua.deleteMany({ source_type: 'don_hang', source_id: id }));
  const allocationIds = await collectIds({ don_hang_id: id }, PhanBoHang);
  deleted = addCount(deleted, await CTPhanBoHang.deleteMany({ phan_bo_hang_id: { $in: allocationIds } }));
  deleted = addCount(deleted, await PhanBoHang.deleteMany({ _id: { $in: allocationIds } }));
  deleted = addCount(deleted, await GopDonHang.deleteMany({ $or: [{ don_nhan_id: id }, { don_nguon_ids: id }] }));
  deleted = addCount(deleted, await DonHang.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteCashBook(root, storeId) {
  const id = toObjectId(root.entity_id);
  if (!id) return 0;
  let deleted = 0;
  const receiptIds = await collectIds(receiptCashBookFilter(id), PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  deleted = addCount(deleted, await SoQuy.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteInventoryCheck(root) {
  const id = toObjectId(root.entity_id);
  if (!id) return 0;
  let deleted = 0;
  deleted = addCount(deleted, await CTPhieuKiemKho.deleteMany({ phieu_kiem_kho_id: id }));
  deleted = addCount(deleted, await PhieuKiemKho.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteSaleReturn(returnId, storeId) {
  const id = toObjectId(returnId);
  if (!id) return 0;
  let deleted = 0;
  const doc = await PhieuTraHang.findById(id).select('ma_phieu_tra').lean();
  const receiptFilter = { $or: [{ phieu_tra_hang_id: id }] };
  if (doc && doc.ma_phieu_tra) receiptFilter.$or.push({ ma_chung_tu_goc: doc.ma_phieu_tra });
  const receiptIds = await collectIds(receiptFilter, PhieuThuChi);
  deleted += await hardDeleteReceipts(receiptIds, storeId);
  const [vatImportIds, vatExportIds] = await Promise.all([
    collectIds({ source_type: 'tra_hang_ban', source_id: id }, NhapVatChua),
    collectIds({ source_type: 'tra_hang_ban', source_id: id }, XuatVatChua)
  ]);
  for (const importId of vatImportIds) deleted += await hardDeleteVatChuaImport(importId, storeId);
  for (const exportId of vatExportIds) deleted += await hardDeleteVatChuaExport(exportId, storeId);
  const debtFilter = { $or: [{ phieu_tra_hang_id: id }, { phieu_thu_chi_id: { $in: receiptIds } }] };
  if (doc && doc.ma_phieu_tra) {
    debtFilter.$or.push(
      { ma_chung_tu_goc: doc.ma_phieu_tra },
      { ghi_chu: { $regex: escapeRegex(doc.ma_phieu_tra), $options: 'i' } }
    );
  }
  deleted = addCount(deleted, await CongNoKhachHang.deleteMany({
    $or: debtFilter.$or
  }));
  if (GiaoDichCongNoKhachHang) {
    deleted = addCount(deleted, await GiaoDichCongNoKhachHang.deleteMany({
      $or: debtFilter.$or
    }));
  }
  deleted = addCount(deleted, await CTPhieuTraHang.deleteMany({ phieu_tra_hang_id: id }));
  deleted = addCount(deleted, await PhieuTraHang.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteInternalIssue(issueId) {
  const id = toObjectId(issueId);
  if (!id) return 0;
  let deleted = 0;
  deleted = addCount(deleted, await CTXuatNoiBo.deleteMany({ phieu_xuat_id: id }));
  deleted = addCount(deleted, await PhieuXuatNoiBo.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteDisposal(disposalId) {
  const id = toObjectId(disposalId);
  if (!id) return 0;
  let deleted = 0;
  deleted = addCount(deleted, await CTXuatHuy.deleteMany({ phieu_xuat_huy_id: id }));
  deleted = addCount(deleted, await PhieuXuatHuy.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteAllocation(allocationId) {
  const id = toObjectId(allocationId);
  if (!id) return 0;
  let deleted = 0;
  deleted = addCount(deleted, await CTPhanBoHang.deleteMany({ phan_bo_hang_id: id }));
  deleted = addCount(deleted, await PhanBoHang.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteProduct(root, storeId) {
  const id = toObjectId(root.entity_id);
  if (!id) return 0;
  let deleted = 0;

  const [
    purchaseIds,
    supplierReturnIds,
    orderIds,
    invoiceIds,
    saleReturnIds,
    stockCheckIds,
    disposalIds,
    internalIssueIds,
    allocationIds
  ] = await Promise.all([
    distinctObjectIds(CTPhieuNhap, { hang_hoa_id: id }, 'phieu_nhap_id'),
    distinctObjectIds(CTPhieuTraHangNhap, { hang_hoa_id: id }, 'phieu_tra_nhap_id'),
    distinctObjectIds(CTDonHang, { hang_hoa_id: id }, 'don_hang_id'),
    distinctObjectIds(CTHoaDonBanHang, { hang_hoa_id: id }, 'hoa_don_id'),
    distinctObjectIds(CTPhieuTraHang, { hang_hoa_id: id }, 'phieu_tra_hang_id'),
    distinctObjectIds(CTPhieuKiemKho, { hang_hoa_id: id }, 'phieu_kiem_kho_id'),
    distinctObjectIds(CTXuatHuy, { hang_hoa_id: id }, 'phieu_xuat_huy_id'),
    distinctObjectIds(CTXuatNoiBo, { hang_hoa_id: id }, 'phieu_xuat_id'),
    distinctObjectIds(CTPhanBoHang, { hang_hoa_id: id }, 'phan_bo_hang_id')
  ]);

  for (const purchaseId of purchaseIds) deleted += await hardDeletePurchase({ entity_id: purchaseId }, storeId);
  for (const returnId of supplierReturnIds) deleted += await hardDeleteReturnImport(returnId, storeId);
  for (const orderId of orderIds) deleted += await hardDeleteOrder({ entity_id: orderId }, storeId);
  for (const invoiceId of invoiceIds) deleted += await hardDeleteInvoice(invoiceId, storeId);
  for (const returnId of saleReturnIds) deleted += await hardDeleteSaleReturn(returnId, storeId);
  for (const stockCheckId of stockCheckIds) deleted += await hardDeleteInventoryCheck({ entity_id: stockCheckId });
  for (const disposalId of disposalIds) deleted += await hardDeleteDisposal(disposalId);
  for (const issueId of internalIssueIds) deleted += await hardDeleteInternalIssue(issueId);
  for (const allocationId of allocationIds) deleted += await hardDeleteAllocation(allocationId);

  deleted = addCount(deleted, await CTPhieuNhap.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTPhieuTraHangNhap.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTDonHang.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTHoaDonBanHang.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTPhieuTraHang.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTPhieuKiemKho.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTXuatHuy.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTXuatNoiBo.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTPhanBoHang.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await TonKho.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await TonKhoLo.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await TonKhoLoQuyCach.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await LoHang.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await LichSuKho.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await GiaBanHangHoa.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await CTBangGia.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await HangHoaThuocTinh.deleteMany({ hang_hoa_id: id }));
  deleted = addCount(deleted, await HangHoa.deleteOne({ _id: id }));
  return deleted;
}

async function hardDeleteRootEntity(root, storeId) {
  if (!root || !root.entity_type) return 0;
  if (root.entity_type === 'PhieuNhap') return hardDeletePurchase(root, storeId);
  if (root.entity_type === 'PhieuTraHangNhap') return hardDeleteReturnImport(root.entity_id, storeId);
  if (root.entity_type === 'DonHang') return hardDeleteOrder(root, storeId);
  if (root.entity_type === 'HoaDonBanHang') return hardDeleteInvoice(root.entity_id, storeId);
  if (root.entity_type === 'PhieuTraHang') return hardDeleteSaleReturn(root.entity_id, storeId);
  if (root.entity_type === 'HangHoa') return hardDeleteProduct(root, storeId);
  if (root.entity_type === 'SoQuy') return hardDeleteCashBook(root, storeId);
  if (root.entity_type === 'PhieuKiemKho') return hardDeleteInventoryCheck(root);
  if (root.entity_type === 'NhapVatChua') return hardDeleteVatChuaImport(root.entity_id, storeId);
  if (root.entity_type === 'XuatVatChua') return hardDeleteVatChuaExport(root.entity_id, storeId);
  return 0;
}

async function purgeExpiredTrashItems(storeId) {
  const filter = {
    restored_at: null,
    deleted_at: { $lt: getTrashRetentionCutoff() }
  };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }
  const roots = await ThungRacItem.find(Object.assign({}, filter, { is_trash_root: true })).lean();
  let deletedEntities = 0;
  for (const root of roots) {
    deletedEntities += await hardDeleteRootEntity(root, storeId);
  }
  const result = await ThungRacItem.deleteMany(filter);
  return {
    deletedCount: Number(result.deletedCount || 0),
    deleted_entities: deletedEntities
  };
}

async function permanentDeleteTrashGroups(rootTrashIds, storeId) {
  const ids = normalizeRootIds(rootTrashIds);
  if (!ids.length) {
    throw createHttpError(400, 'Vui lòng chọn ít nhất một chứng từ trong thùng rác.');
  }
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    throw createHttpError(400, 'Không xác định được cửa hàng.');
  }

  const objectIds = ids.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const roots = await ThungRacItem.find({
    _id: { $in: objectIds },
    cua_hang_id: storeId,
    restored_at: null,
    is_trash_root: true
  }).lean();

  if (!roots.length) {
    throw createHttpError(404, 'Không tìm thấy chứng từ đã chọn trong thùng rác.');
  }

  const foundIds = roots.map(function(row) { return String(row._id); });
  const missing = ids.filter(function(id) { return foundIds.indexOf(id) < 0; });
  if (missing.length) {
    throw createHttpError(404, 'Một hoặc nhiều mục không còn trong thùng rác.');
  }

  const rootObjectIds = roots.map(function(row) { return row._id; });
  let deletedEntities = 0;
  for (const root of roots) {
    deletedEntities += await hardDeleteRootEntity(root, storeId);
  }

  const deleteResult = await ThungRacItem.deleteMany({
    cua_hang_id: storeId,
    restored_at: null,
    $or: [
      { _id: { $in: rootObjectIds } },
      { trash_group_id: { $in: rootObjectIds } }
    ]
  });

  return {
    deleted_roots: roots.length,
    deleted_items: Number(deleteResult.deletedCount || 0),
    deleted_entities: deletedEntities,
    roots: roots.map(function(row) {
      return {
        trash_id: String(row._id),
        ma_chung_tu: row.ma_chung_tu || '',
        entity_type: row.entity_type || ''
      };
    })
  };
}

module.exports = {
  TRASH_RETENTION_DAYS,
  getTrashRetentionDays,
  getTrashRetentionCutoff,
  purgeExpiredTrashItems,
  permanentDeleteTrashGroups
};
