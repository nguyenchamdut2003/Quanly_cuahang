const mongoose = require('mongoose');
const {
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  PhieuThuChi,
  CongNoNhaCungCap,
  GiaoDichCongNoNhaCungCap,
  NhaCungCap,
  XuatVatChua,
  VatChua
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');
const { congTonKho, truTonKho } = require('./kho.service');
const { cancelXuatVatChuaBySource } = require('./vatChuaExport.service');

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yeu cau khong hop le');
  error.statusCode = statusCode || 400;
  return error;
}

function normalizeIds(rawIds) {
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

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

function withSessionOptions(options, session) {
  return session ? Object.assign({}, options || {}, { session }) : (options || {});
}

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 5).map(pickFn).filter(Boolean);
}

function objectIdStrings(rows) {
  return (rows || []).map(function(row) { return String(row && row._id || ''); }).filter(Boolean);
}

function supplierDebtSign(row) {
  const type = String(row && row.loai || '');
  if (type === 'tang_no') return 1;
  if (type === 'giam_no' || type === 'thanh_toan') return -1;
  return 0;
}

function supplierDebtTxSign(row) {
  const direction = String(row && row.huong_cong_no || '');
  if (direction === 'tang_no') return 1;
  if (direction === 'giam_no') return -1;
  return 0;
}

async function applySupplierDebtRows(rows, mode, session) {
  const direction = mode === 'restore' ? 1 : -1;
  for (const row of rows || []) {
    if (!row || !row.nha_cung_cap_id) continue;
    const sign = supplierDebtSign(row);
    const amount = Number(row.so_tien || 0);
    if (!sign || !amount) continue;
    await NhaCungCap.updateOne(
      { _id: row.nha_cung_cap_id },
      { $inc: { tong_no: direction * sign * amount } },
      { session }
    );
  }
}

async function applySupplierDebtTxRows(rows, mode, session) {
  const direction = mode === 'restore' ? 1 : -1;
  for (const row of rows || []) {
    if (!row || !row.nha_cung_cap_id) continue;
    const sign = supplierDebtTxSign(row);
    const amount = Number(row.gia_tri || 0);
    if (!sign || !amount) continue;
    await NhaCungCap.updateOne(
      { _id: row.nha_cung_cap_id },
      { $inc: { tong_no: direction * sign * amount } },
      { session }
    );
  }
}

async function loadRelatedReceipts(returnIds, storeId, session, includeDeleted) {
  if (!returnIds.length) return [];
  const objectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const filter = {
    phieu_tra_hang_nhap_id: { $in: objectIds }
  };
  if (!includeDeleted) filter.deleted_at = null;
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(PhieuThuChi.find(filter)
    .select('_id ma_phieu gia_tri ngay_lap phieu_tra_hang_nhap_id trang_thai deleted_at')
    .sort({ ngay_lap: -1, created_at: -1 }), session)
    .lean();
}

async function loadRelatedXuatVatChua(returnIds, storeId, session, includeDeleted) {
  if (!returnIds.length) return [];
  const objectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const filter = {
    source_type: 'phieu_tra_hang_nhap',
    source_id: { $in: objectIds }
  };
  if (!includeDeleted) filter.deleted_at = null;
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(XuatVatChua.find(filter)
    .select('_id ma_xuat_vat_chua source_id tong_so_luong trang_thai deleted_at items cua_hang_id')
    .sort({ created_at: -1 }), session)
    .lean();
}

async function loadRelatedSupplierDebt(returnIds, receiptIds, storeId, session, includeDeleted) {
  if (!returnIds.length && !receiptIds.length) return [];
  const returnObjectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const receiptObjectIds = receiptIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const or = [];
  if (returnObjectIds.length) or.push({ phieu_tra_nhap_id: { $in: returnObjectIds } });
  if (receiptObjectIds.length) or.push({ phieu_thu_chi_id: { $in: receiptObjectIds } });
  const filter = { $or: or };
  if (!includeDeleted) filter.deleted_at = null;
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(CongNoNhaCungCap.find(filter)
    .select('_id cua_hang_id nha_cung_cap_id phieu_tra_nhap_id phieu_thu_chi_id so_tien loai deleted_at')
    .sort({ ngay: -1 }), session)
    .lean();
}

async function loadRelatedSupplierDebtTx(returnIds, receiptIds, storeId, session, includeDeleted) {
  if (!GiaoDichCongNoNhaCungCap || (!returnIds.length && !receiptIds.length)) return [];
  const returnObjectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const receiptObjectIds = receiptIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const or = [];
  if (returnObjectIds.length) or.push({ phieu_tra_hang_nhap_id: { $in: returnObjectIds } });
  if (receiptObjectIds.length) or.push({ phieu_thu_chi_id: { $in: receiptObjectIds } });
  const filter = { $or: or };
  if (!includeDeleted) filter.deleted_at = null;
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(GiaoDichCongNoNhaCungCap.find(filter)
    .select('_id cua_hang_id nha_cung_cap_id ma_giao_dich phieu_tra_hang_nhap_id phieu_thu_chi_id gia_tri huong_cong_no trang_thai deleted_at')
    .sort({ ngay_giao_dich: -1 }), session)
    .lean();
}

function aggregateGroupTotals(items) {
  const map = {};
  items.forEach(function(item) {
    (item.groups || []).forEach(function(group) {
      if (!map[group.entity_type]) {
        map[group.entity_type] = {
          entity_type: group.entity_type,
          label: group.label,
          count: 0,
          samples: []
        };
      }
      map[group.entity_type].count += Number(group.count || 0);
      (group.samples || []).forEach(function(sample) {
        if (sample && map[group.entity_type].samples.indexOf(sample) < 0 && map[group.entity_type].samples.length < 5) {
          map[group.entity_type].samples.push(sample);
        }
      });
    });
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    return String(a.label || '').localeCompare(String(b.label || ''), 'vi');
  });
}

async function buildReturnImportImpact(doc, storeId) {
  let canTrash = true;
  let blockReason = '';
  const warnings = [];
  if (doc.deleted_at || String(doc.trang_thai || '') === 'cancelled') {
    canTrash = false;
    blockReason = doc.deleted_at
      ? 'Phiếu trả hàng nhập đã nằm trong thùng rác.'
      : 'Phiếu trả hàng nhập đã hủy, không xử lý lại.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'PhieuTraHangNhap',
      entity_id: doc._id,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu trả hàng nhập đã nằm trong thùng rác.';
    }
  }

  const returnId = String(doc._id);
  const detailCount = await CTPhieuTraHangNhap.countDocuments({ phieu_tra_nhap_id: doc._id, deleted_at: null });
  const receipts = await loadRelatedReceipts([returnId], storeId);
  const receiptIds = objectIdStrings(receipts);
  const xuatVatChua = await loadRelatedXuatVatChua([returnId], storeId);
  const debtRows = await loadRelatedSupplierDebt([returnId], receiptIds, storeId);
  const debtTxRows = await loadRelatedSupplierDebtTx([returnId], receiptIds, storeId);

  if (String(doc.trang_thai || '') === 'completed') {
    warnings.push('Tồn kho hàng hóa sẽ được cộng lại theo số lượng đã trả.');
    warnings.push('Công nợ nhà cung cấp phát sinh từ phiếu trả sẽ được hoàn tác.');
  }
  if (xuatVatChua.length) warnings.push('Phiếu xuất vật chứa liên quan sẽ được đưa vào thùng rác và hoàn lại tồn vật chứa.');
  if (receipts.length) warnings.push('Phiếu thu trong sổ quỹ liên quan sẽ được đưa vào thùng rác cùng phiếu trả.');

  const groups = [
    {
      entity_type: 'CTPhieuTraHangNhap',
      label: ENTITY_LABELS.CTPhieuTraHangNhap || 'Dòng trả hàng nhập',
      count: detailCount,
      samples: []
    },
    {
      entity_type: 'PhieuThuChi',
      label: ENTITY_LABELS.PhieuThuChi,
      count: receipts.length,
      samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }, 5)
    },
    {
      entity_type: 'XuatVatChua',
      label: ENTITY_LABELS.XuatVatChua,
      count: xuatVatChua.length,
      samples: sampleTexts(xuatVatChua, function(row) { return row.ma_xuat_vat_chua || ''; }, 5)
    },
    {
      entity_type: 'CongNoNhaCungCap',
      label: ENTITY_LABELS.CongNoNhaCungCap,
      count: debtRows.length,
      samples: []
    },
    {
      entity_type: 'GiaoDichCongNoNhaCungCap',
      label: ENTITY_LABELS.GiaoDichCongNoNhaCungCap,
      count: debtTxRows.length,
      samples: sampleTexts(debtTxRows, function(row) { return row.ma_giao_dich || ''; }, 5)
    }
  ].filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    phieu_tra_hang_nhap_id: returnId,
    ma_phieu_tra_nhap: doc.ma_phieu_tra_nhap || '',
    ten_ncc: doc.nha_cung_cap_id && doc.nha_cung_cap_id.ten_ncc ? doc.nha_cung_cap_id.ten_ncc : '',
    tong_tien_tra: Number(doc.tong_tien_tra || doc.ncc_can_tra || 0),
    trang_thai: doc.trang_thai || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: canTrash ? warnings : [],
    groups: groups,
    total_related: groups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
}

async function previewReturnImportTrash(rawIds, storeId) {
  const ids = normalizeIds(rawIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu trả hàng nhập.');
  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  const docs = await PhieuTraHangNhap.find(filter)
    .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' })
    .lean();
  if (docs.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều phiếu trả hàng nhập không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }
  const docMap = docs.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});
  const items = [];
  for (const id of ids) {
    if (docMap[id]) items.push(await buildReturnImportImpact(docMap[id], storeId));
  }
  const blocked = items.filter(function(item) { return !item.can_trash; });
  const allowed = items.filter(function(item) { return item.can_trash; });
  return {
    items: items,
    allowed_count: allowed.length,
    blocked_count: blocked.length,
    can_proceed: blocked.length === 0 && allowed.length > 0,
    aggregate_groups: aggregateGroupTotals(items),
    total_related: items.reduce(function(sum, item) { return sum + Number(item.total_related || 0); }, 0)
  };
}

async function rollbackInventory(doc, userId, session) {
  const rows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: doc._id, deleted_at: null }).session(session).lean();
  for (const row of rows) {
    const tenQc = String(row.ten_quy_cach || '').trim();
    await congTonKho({
      kho_id: doc.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_tra_lai || row.gia_nhap || row.don_gia || 0,
      nguoi_tao_id: userId,
      loai_phieu: 'dieu_chinh',
      ma_phieu: String(doc.ma_phieu_tra_nhap || ''),
      ghi_chu: 'Hoàn tồn kho - đưa phiếu trả hàng nhập vào thùng rác',
      ten_quy_cach: tenQc || undefined,
      sync_quy_cach: Boolean(row.lo_hang_id && tenQc),
      session: session
    });
  }
}

async function restoreInventory(doc, userId, session) {
  const rows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: doc._id }).session(session).lean();
  for (const row of rows) {
    const tenQc = String(row.ten_quy_cach || '').trim();
    await truTonKho({
      kho_id: doc.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_tra_lai || row.gia_nhap || row.don_gia || 0,
      nguoi_tao_id: userId,
      loai_phieu: 'tra_hang_nhap',
      ma_phieu: String(doc.ma_phieu_tra_nhap || ''),
      ghi_chu: 'Khôi phục phiếu trả hàng nhập từ thùng rác',
      ten_quy_cach: tenQc || undefined,
      sync_quy_cach: Boolean(row.lo_hang_id && tenQc),
      session: session
    });
  }
}

async function rollbackCompletedReturn(doc, userId, session, options) {
  if (!doc || String(doc.trang_thai || '') !== 'completed') return {};
  const storeId = doc.cua_hang_id;
  await rollbackInventory(doc, userId, session);
  await cancelXuatVatChuaBySource(storeId, 'phieu_tra_hang_nhap', doc._id, session);

  const returnId = String(doc._id);
  const receipts = await loadRelatedReceipts([returnId], storeId, session, false);
  const receiptIds = objectIdStrings(receipts);
  const debtRows = await loadRelatedSupplierDebt([returnId], receiptIds, storeId, session, false);
  const debtTxRows = await loadRelatedSupplierDebtTx([returnId], receiptIds, storeId, session, false);

  await applySupplierDebtRows(debtRows, 'rollback', session);
  await applySupplierDebtTxRows(debtTxRows, 'rollback', session);

  const hardDelete = options && options.hardDeleteRelated;
  if (hardDelete) {
    if (debtRows.length) await CongNoNhaCungCap.deleteMany({ _id: { $in: debtRows.map(function(row) { return row._id; }) } }).session(session);
    if (debtTxRows.length) await GiaoDichCongNoNhaCungCap.deleteMany({ _id: { $in: debtTxRows.map(function(row) { return row._id; }) } }).session(session);
    if (receipts.length) await PhieuThuChi.deleteMany({ _id: { $in: receipts.map(function(row) { return row._id; }) } }).session(session);
  }

  return {
    receipts: receipts,
    debtRows: debtRows,
    debtTxRows: debtTxRows
  };
}

async function moveReturnImportToTrash(rawIds, storeId, userId) {
  const preview = await previewReturnImportTrash(rawIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock && firstBlock.block_reason || 'Không thể đưa các phiếu đã chọn vào thùng rác.');
  }

  const session = await mongoose.startSession();
  const moved = [];
  try {
    await session.withTransaction(async function() {
      const now = new Date();
      for (const item of preview.items) {
        if (!item.can_trash) continue;
        const doc = await PhieuTraHangNhap.findOne({
          _id: item.phieu_tra_hang_nhap_id,
          cua_hang_id: storeId,
          deleted_at: null,
          trang_thai: { $ne: 'cancelled' }
        }).session(session);
        if (!doc) continue;

        const originalStatus = String(doc.trang_thai || 'draft');
        const rollback = await rollbackCompletedReturn(doc, userId, session, { hardDeleteRelated: false });

        const returnId = String(doc._id);
        const receipts = rollback.receipts || await loadRelatedReceipts([returnId], storeId, session, false);
        const receiptIds = objectIdStrings(receipts);
        const xuatVatChua = await loadRelatedXuatVatChua([returnId], storeId, session, false);
        const debtRows = rollback.debtRows || await loadRelatedSupplierDebt([returnId], receiptIds, storeId, session, false);
        const debtTxRows = rollback.debtTxRows || await loadRelatedSupplierDebtTx([returnId], receiptIds, storeId, session, false);

        if (receipts.length) {
          await PhieuThuChi.updateMany(
            { _id: { $in: receipts.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'cancelled',
                deleted_at: now,
                deleted_by: userId || null,
                nguoi_huy_id: userId || null,
                ngay_huy: now,
                ly_do_huy: 'Đưa phiếu trả hàng nhập vào thùng rác'
              }
            },
            { session }
          );
        }
        if (xuatVatChua.length) {
          await XuatVatChua.updateMany(
            { _id: { $in: xuatVatChua.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: now, deleted_by: userId || null, trang_thai: 'cancelled' } },
            { session }
          );
        }
        if (debtRows.length) {
          await CongNoNhaCungCap.updateMany(
            { _id: { $in: debtRows.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: now, deleted_by: userId || null } },
            { session }
          );
        }
        if (debtTxRows.length) {
          await GiaoDichCongNoNhaCungCap.updateMany(
            { _id: { $in: debtTxRows.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'cancelled',
                deleted_at: now,
                deleted_by: userId || null,
                nguoi_huy_id: userId || null,
                ngay_huy: now,
                ly_do_huy: 'Đưa phiếu trả hàng nhập vào thùng rác'
              }
            },
            { session }
          );
        }
        await CTPhieuTraHangNhap.updateMany(
          { phieu_tra_nhap_id: doc._id, deleted_at: null },
          { $set: { deleted_at: now, deleted_by: userId || null } },
          { session }
        );

        doc.deleted_at = now;
        doc.deleted_by = userId || null;
        doc.trang_thai = 'cancelled';
        await doc.save({ session });

        const metadata = {
          original_status: originalStatus,
          phieu_tra_nhap_id: String(doc._id),
          phieu_nhap_id: doc.phieu_nhap_id ? String(doc.phieu_nhap_id) : '',
          cua_hang_id: doc.cua_hang_id ? String(doc.cua_hang_id) : String(storeId || ''),
          receipt_ids: objectIdStrings(receipts),
          xuat_vat_chua_ids: objectIdStrings(xuatVatChua),
          cong_no_ncc_ids: objectIdStrings(debtRows),
          giao_dich_cong_no_ncc_ids: objectIdStrings(debtTxRows)
        };

        const rootRows = await ThungRacItem.create([{
          entity_type: 'PhieuTraHangNhap',
          entity_id: doc._id,
          ma_chung_tu: doc.ma_phieu_tra_nhap || '',
          ten_hien_thi: doc.ma_phieu_tra_nhap || 'Phiếu trả hàng nhập',
          mo_ta_phu: item.ten_ncc ? ('Nhà cung cấp: ' + item.ten_ncc) : '',
          cua_hang_id: doc.cua_hang_id || storeId || null,
          deleted_at: now,
          deleted_by: userId || null,
          is_trash_root: true,
          trash_group_id: null,
          restored_at: null,
          sort_order: 0,
          metadata: metadata
        }], { session });
        const root = rootRows && rootRows[0];
        let sortOrder = 1;
        for (const group of item.groups || []) {
          if (Number(group.count || 0) <= 0 || !root) continue;
          const childFields = buildTrashChildFields(group);
          await ThungRacItem.create([{
            entity_type: group.entity_type,
            entity_id: doc._id,
            ma_chung_tu: childFields.ma_chung_tu,
            ten_hien_thi: childFields.ten_hien_thi,
            mo_ta_phu: childFields.mo_ta_phu,
            cua_hang_id: doc.cua_hang_id || storeId || null,
            deleted_at: now,
            deleted_by: userId || null,
            is_trash_root: false,
            trash_group_id: root._id,
            restored_at: null,
            sort_order: sortOrder,
            metadata: metadata
          }], { session });
          sortOrder += 1;
        }

        moved.push({
          phieu_tra_hang_nhap_id: String(doc._id),
          ma_phieu_tra_nhap: doc.ma_phieu_tra_nhap || '',
          trash_root_id: root ? String(root._id) : ''
        });
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    moved_count: moved.length,
    moved: moved
  };
}

async function restoreXuatVatChuaRows(rows, session) {
  for (const xuatDoc of rows || []) {
    if (!xuatDoc || !xuatDoc._id) continue;
    const items = Array.isArray(xuatDoc.items) ? xuatDoc.items : [];
    for (const item of items) {
      const vatChuaId = toObjectId(item.vat_chua_id);
      const qty = Math.floor(Number(item.so_luong || 0));
      if (!vatChuaId || qty <= 0) continue;
      const result = await VatChua.updateOne(
        { _id: vatChuaId, so_luong_ton: { $gte: qty } },
        { $inc: { so_luong_ton: -qty } },
        { session }
      );
      if (!result || Number(result.modifiedCount || 0) < 1) {
        throw createHttpError(409, 'Tồn vật chứa không đủ để khôi phục phiếu xuất vật chứa.');
      }
    }
    await XuatVatChua.updateOne(
      { _id: xuatDoc._id },
      { $set: { trang_thai: 'active', deleted_at: null, deleted_by: null } },
      { session }
    );
  }
}

async function restoreReturnImportFromTrash(rootTrashIds, storeId, userId) {
  const ids = normalizeIds(rootTrashIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một chứng từ trong thùng rác.');
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) {
    throw createHttpError(400, 'Không xác định được cửa hàng.');
  }
  const session = await mongoose.startSession();
  const restored = [];
  try {
    await session.withTransaction(async function() {
      const objectIds = ids.map(function(id) { return new mongoose.Types.ObjectId(id); });
      const roots = await ThungRacItem.find({
        _id: { $in: objectIds },
        cua_hang_id: storeId,
        restored_at: null,
        is_trash_root: true,
        entity_type: 'PhieuTraHangNhap'
      }).session(session).lean();
      if (roots.length !== ids.length) {
        throw createHttpError(404, 'Chỉ hỗ trợ khôi phục các phiếu trả hàng nhập còn trong thùng rác.');
      }

      const now = new Date();
      for (const root of roots) {
        const metadata = root.metadata || {};
        const doc = await PhieuTraHangNhap.findOne({
          _id: root.entity_id,
          cua_hang_id: storeId
        }).session(session);
        if (!doc) throw createHttpError(404, 'Phiếu trả hàng nhập đã bị xóa vĩnh viễn.');
        if (!doc.deleted_at) throw createHttpError(400, 'Phiếu trả hàng nhập không còn trong thùng rác.');

        const originalStatus = String(metadata.original_status || 'draft');
        const returnId = String(doc._id);
        const receiptIds = Array.isArray(metadata.receipt_ids) ? metadata.receipt_ids.filter(toObjectId) : [];
        const xuatIds = Array.isArray(metadata.xuat_vat_chua_ids) ? metadata.xuat_vat_chua_ids.filter(toObjectId) : [];
        const debtIds = Array.isArray(metadata.cong_no_ncc_ids) ? metadata.cong_no_ncc_ids.filter(toObjectId) : [];
        const debtTxIds = Array.isArray(metadata.giao_dich_cong_no_ncc_ids) ? metadata.giao_dich_cong_no_ncc_ids.filter(toObjectId) : [];

        if (originalStatus === 'completed') {
          await restoreInventory(doc, userId, session);
        }

        const receiptFilter = receiptIds.length
          ? { _id: { $in: receiptIds.map(toObjectId).filter(Boolean) } }
          : { phieu_tra_hang_nhap_id: doc._id };
        const receipts = await PhieuThuChi.find(receiptFilter).session(session).lean();
        const currentReceiptIds = objectIdStrings(receipts);

        const xuatFilter = xuatIds.length
          ? { _id: { $in: xuatIds.map(toObjectId).filter(Boolean) } }
          : { source_type: 'phieu_tra_hang_nhap', source_id: doc._id };
        const xuatRows = await XuatVatChua.find(xuatFilter).session(session).lean();

        const debtFilter = debtIds.length
          ? { _id: { $in: debtIds.map(toObjectId).filter(Boolean) } }
          : {
              $or: [
                { phieu_tra_nhap_id: doc._id },
                { phieu_thu_chi_id: { $in: currentReceiptIds.map(toObjectId).filter(Boolean) } }
              ]
            };
        const debtRows = await CongNoNhaCungCap.find(debtFilter).session(session).lean();

        const debtTxFilter = debtTxIds.length
          ? { _id: { $in: debtTxIds.map(toObjectId).filter(Boolean) } }
          : {
              $or: [
                { phieu_tra_hang_nhap_id: doc._id },
                { phieu_thu_chi_id: { $in: currentReceiptIds.map(toObjectId).filter(Boolean) } }
              ]
            };
        const debtTxRows = await GiaoDichCongNoNhaCungCap.find(debtTxFilter).session(session).lean();

        if (originalStatus === 'completed') {
          await restoreXuatVatChuaRows(xuatRows, session);
          await applySupplierDebtRows(debtRows, 'restore', session);
          await applySupplierDebtTxRows(debtTxRows, 'restore', session);
        }

        if (receipts.length) {
          await PhieuThuChi.updateMany(
            { _id: { $in: receipts.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'paid',
                deleted_at: null,
                deleted_by: null,
                nguoi_huy_id: null,
                ngay_huy: null,
                ly_do_huy: ''
              }
            },
            { session }
          );
        }
        if (debtRows.length) {
          await CongNoNhaCungCap.updateMany(
            { _id: { $in: debtRows.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: null, deleted_by: null } },
            { session }
          );
        }
        if (debtTxRows.length) {
          await GiaoDichCongNoNhaCungCap.updateMany(
            { _id: { $in: debtTxRows.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'active',
                deleted_at: null,
                deleted_by: null,
                nguoi_huy_id: null,
                ngay_huy: null,
                ly_do_huy: ''
              }
            },
            { session }
          );
        }
        await CTPhieuTraHangNhap.updateMany(
          { phieu_tra_nhap_id: doc._id },
          { $set: { deleted_at: null, deleted_by: null } },
          { session }
        );

        doc.deleted_at = null;
        doc.deleted_by = null;
        doc.trang_thai = originalStatus;
        await doc.save({ session });

        await ThungRacItem.deleteMany({
          cua_hang_id: storeId,
          $or: [
            { _id: root._id },
            { trash_group_id: root._id }
          ]
        }).session(session);

        restored.push({
          trash_id: String(root._id),
          phieu_tra_hang_nhap_id: returnId,
          ma_phieu_tra_nhap: doc.ma_phieu_tra_nhap || ''
        });
      }
    });
  } finally {
    await session.endSession();
  }
  return {
    restored_count: restored.length,
    restored: restored
  };
}

async function cancelReturnImport(returnId, storeId, userId) {
  const id = toObjectId(returnId);
  if (!id) throw createHttpError(400, 'ID phiếu trả hàng nhập không hợp lệ.');
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const filter = { _id: id, deleted_at: null };
      if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
      const doc = await PhieuTraHangNhap.findOne(filter).session(session);
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu trả hàng nhập.');
      if (String(doc.trang_thai || '') === 'cancelled') {
        throw createHttpError(400, 'Phiếu trả hàng nhập đã hủy.');
      }
      if (String(doc.trang_thai || '') === 'completed') {
        await rollbackCompletedReturn(doc, userId, session, { hardDeleteRelated: true });
      }
      doc.trang_thai = 'cancelled';
      await doc.save({ session });
      result = {
        phieu_tra_hang_nhap_id: String(doc._id),
        ma_phieu_tra_nhap: doc.ma_phieu_tra_nhap || ''
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = {
  previewReturnImportTrash,
  moveReturnImportToTrash,
  restoreReturnImportFromTrash,
  cancelReturnImport
};
