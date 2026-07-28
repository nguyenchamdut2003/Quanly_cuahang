const mongoose = require('mongoose');
const {
  PhieuTraHang,
  CTPhieuTraHang,
  PhieuThuChi,
  CongNoKhachHang,
  GiaoDichCongNoKhachHang,
  KhachHang,
  NhapVatChua,
  XuatVatChua,
  VatChua
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');
const { congTonKho, truTonKho } = require('./kho.service');
const { cancelNhapVatChuaBySource } = require('./vatChuaImport.service');
const { cancelXuatVatChuaBySource } = require('./vatChuaExport.service');

const RELATION_LABELS = ENTITY_LABELS;

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

function objectIdStrings(rows) {
  return (rows || []).map(function(row) { return String(row && row._id || ''); }).filter(Boolean);
}

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 3).map(pickFn).filter(Boolean);
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deletedGuard(filter) {
  return Object.assign({}, filter || {}, {
    $or: [
      ...(filter && Array.isArray(filter.$or) ? filter.$or : []),
      { deleted_at: null },
      { deleted_at: { $exists: false } }
    ]
  });
}

function buildReceiptFilter(returnIds, returnCodes, includeDeleted) {
  const objectIds = returnIds.map(toObjectId).filter(Boolean);
  const or = [];
  if (objectIds.length) or.push({ phieu_tra_hang_id: { $in: objectIds } });
  (returnCodes || []).filter(Boolean).forEach(function(code) {
    or.push({ ma_chung_tu_goc: code });
  });
  const filter = { $or: or.length ? or : [{ _id: null }] };
  if (!includeDeleted) {
    filter.trang_thai = { $ne: 'cancelled' };
    filter.deleted_at = null;
  }
  return filter;
}

function buildDebtFilter(returnIds, receiptIds, returnCodes, includeDeleted, activeOnly) {
  const objectIds = returnIds.map(toObjectId).filter(Boolean);
  const receiptObjectIds = receiptIds.map(toObjectId).filter(Boolean);
  const or = [];
  if (objectIds.length) or.push({ phieu_tra_hang_id: { $in: objectIds } });
  if (receiptObjectIds.length) or.push({ phieu_thu_chi_id: { $in: receiptObjectIds } });
  (returnCodes || []).filter(Boolean).forEach(function(code) {
    or.push({ ma_chung_tu_goc: code }, { ghi_chu: { $regex: escapeRegex(code), $options: 'i' } });
  });
  const filter = { $or: or.length ? or : [{ _id: null }] };
  if (!includeDeleted) filter.deleted_at = null;
  if (activeOnly) filter.trang_thai = { $ne: 'cancelled' };
  return filter;
}

async function loadRelatedReceipts(returnIds, returnCodes, storeId, session, includeDeleted) {
  const filter = buildReceiptFilter(returnIds, returnCodes, includeDeleted);
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(PhieuThuChi.find(filter)
    .select('_id ma_phieu gia_tri ngay_lap phieu_tra_hang_id ma_chung_tu_goc trang_thai deleted_at')
    .sort({ ngay_lap: -1, created_at: -1 }), session)
    .lean();
}

async function loadRelatedCustomerDebt(returnIds, receiptIds, returnCodes, session, includeDeleted) {
  return withSessionQuery(CongNoKhachHang.find(buildDebtFilter(returnIds, receiptIds, returnCodes, includeDeleted, false))
    .select('_id cua_hang_id khach_hang_id hoa_don_id phieu_thu_chi_id phieu_tra_hang_id so_tien loai ghi_chu deleted_at')
    .sort({ ngay: -1 }), session)
    .lean();
}

async function loadRelatedCustomerDebtTx(returnIds, receiptIds, returnCodes, storeId, session, includeDeleted) {
  if (!GiaoDichCongNoKhachHang) return [];
  const filter = buildDebtFilter(returnIds, receiptIds, returnCodes, includeDeleted, !includeDeleted);
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return withSessionQuery(GiaoDichCongNoKhachHang.find(filter)
    .select('_id cua_hang_id khach_hang_id ma_giao_dich phieu_tra_hang_id phieu_thu_chi_id gia_tri huong_cong_no trang_thai deleted_at')
    .sort({ ngay_giao_dich: -1 }), session)
    .lean();
}

async function loadRelatedVatChua(Model, returnIds, storeId, session, includeDeleted) {
  const objectIds = returnIds.map(toObjectId).filter(Boolean);
  if (!objectIds.length) return [];
  const filter = { source_type: 'tra_hang_ban', source_id: { $in: objectIds } };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  if (!includeDeleted) {
    filter.deleted_at = null;
    filter.trang_thai = { $ne: 'cancelled' };
  }
  return withSessionQuery(Model.find(filter).sort({ created_at: -1 }), session).lean();
}

function aggregateGroupTotals(items) {
  const map = {};
  items.forEach(function(item) {
    (item.groups || []).forEach(function(group) {
      const key = group.entity_type;
      if (!map[key]) {
        map[key] = { entity_type: key, label: group.label, count: 0, samples: [] };
      }
      map[key].count += Number(group.count || 0);
      (group.samples || []).forEach(function(sample) {
        if (map[key].samples.length < 5 && sample && map[key].samples.indexOf(sample) < 0) {
          map[key].samples.push(sample);
        }
      });
    });
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    return String(a.label || '').localeCompare(String(b.label || ''), 'vi');
  });
}

async function buildReturnImpact(returnSlip, storeId) {
  const returnId = String(returnSlip._id);
  const returnCode = returnSlip.ma_phieu_tra || '';
  const warnings = [];
  let canTrash = true;
  let blockReason = '';

  if (returnSlip.deleted_at || String(returnSlip.trang_thai || '') === 'cancelled') {
    canTrash = false;
    blockReason = returnSlip.deleted_at
      ? 'Phiếu trả hàng đã nằm trong thùng rác.'
      : 'Phiếu trả hàng đã hủy, không xử lý lại.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'PhieuTraHang',
      entity_id: returnSlip._id,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu trả hàng đã nằm trong thùng rác.';
    }
  }

  const receipts = await loadRelatedReceipts([returnId], [returnCode], storeId, null, false);
  const receiptIds = objectIdStrings(receipts);
  const [lineCount, debtRows, debtTxRows, nhapVatRows, xuatVatRows] = await Promise.all([
    CTPhieuTraHang.countDocuments({ phieu_tra_hang_id: returnSlip._id, deleted_at: null }),
    loadRelatedCustomerDebt([returnId], receiptIds, [returnCode], null, false),
    loadRelatedCustomerDebtTx([returnId], receiptIds, [returnCode], storeId, null, false),
    loadRelatedVatChua(NhapVatChua, [returnId], storeId, null, false),
    loadRelatedVatChua(XuatVatChua, [returnId], storeId, null, false)
  ]);

  if (canTrash && String(returnSlip.trang_thai || '') === 'completed') {
    warnings.push('Tồn kho hàng trả/hàng đổi sẽ được hoàn tác theo phiếu trả hàng.');
    warnings.push('Phiếu thu/chi, công nợ và vật chứa liên quan sẽ được đưa vào thùng rác cùng phiếu.');
  }

  const groups = [
    { entity_type: 'CTPhieuTraHang', label: RELATION_LABELS.CTPhieuTraHang, count: lineCount, samples: [] },
    { entity_type: 'PhieuThuChi', label: RELATION_LABELS.PhieuThuChi, count: receipts.length, samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }) },
    { entity_type: 'CongNoKhachHang', label: RELATION_LABELS.CongNoKhachHang, count: debtRows.length, samples: [] },
    { entity_type: 'GiaoDichCongNoKhachHang', label: RELATION_LABELS.GiaoDichCongNoKhachHang, count: debtTxRows.length, samples: sampleTexts(debtTxRows, function(row) { return row.ma_giao_dich || ''; }) },
    { entity_type: 'NhapVatChua', label: RELATION_LABELS.NhapVatChua, count: nhapVatRows.length, samples: sampleTexts(nhapVatRows, function(row) { return row.ma_nhap_vat_chua || ''; }) },
    { entity_type: 'XuatVatChua', label: RELATION_LABELS.XuatVatChua, count: xuatVatRows.length, samples: sampleTexts(xuatVatRows, function(row) { return row.ma_xuat_vat_chua || ''; }) }
  ].filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    phieu_tra_hang_id: returnId,
    ma_phieu_tra: returnCode,
    ten_khach: returnSlip.khach_hang_id && returnSlip.khach_hang_id.ten_khach_hang || '',
    trang_thai: returnSlip.trang_thai || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: canTrash ? warnings : [],
    groups,
    total_related: groups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
}

async function previewReturnTrash(returnIds, storeId) {
  const ids = normalizeIds(returnIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu trả hàng.');
  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  const slips = await PhieuTraHang.find(filter)
    .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
    .lean();
  if (slips.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều phiếu trả hàng không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }
  const slipMap = slips.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});
  const items = [];
  for (const id of ids) {
    if (slipMap[id]) items.push(await buildReturnImpact(slipMap[id], storeId));
  }
  const blocked = items.filter(function(item) { return !item.can_trash; });
  const allowed = items.filter(function(item) { return item.can_trash; });
  return {
    items,
    allowed_count: allowed.length,
    blocked_count: blocked.length,
    can_proceed: blocked.length === 0 && allowed.length > 0,
    aggregate_groups: aggregateGroupTotals(items),
    total_related: items.reduce(function(sum, item) { return sum + Number(item.total_related || 0); }, 0)
  };
}

function customerDebtSign(row) {
  const type = String(row && row.loai || '');
  if (type === 'tang_no') return 1;
  if (type === 'giam_no' || type === 'thanh_toan') return -1;
  return 0;
}

function customerDebtTxSign(row) {
  const direction = String(row && row.huong_cong_no || '');
  if (direction === 'tang_no') return 1;
  if (direction === 'giam_no') return -1;
  return 0;
}

async function applyCustomerDebtRows(rows, mode, session) {
  const direction = mode === 'restore' ? 1 : -1;
  for (const row of rows || []) {
    if (!row || !row.khach_hang_id) continue;
    const sign = customerDebtSign(row);
    const amount = Number(row.so_tien || 0);
    if (!sign || !amount) continue;
    await KhachHang.updateOne(
      { _id: row.khach_hang_id },
      { $inc: { tong_no: direction * sign * amount } },
      { session }
    );
  }
}

async function applyCustomerDebtTxRows(rows, mode, session) {
  const direction = mode === 'restore' ? 1 : -1;
  for (const row of rows || []) {
    if (!row || !row.khach_hang_id) continue;
    const sign = customerDebtTxSign(row);
    const amount = Number(row.gia_tri || 0);
    if (!sign || !amount) continue;
    await KhachHang.updateOne(
      { _id: row.khach_hang_id },
      { $inc: { tong_no: direction * sign * amount } },
      { session }
    );
  }
}

function stockLineFromDetail(row) {
  const tenQuyCach = String(row.ten_quy_cach || row.ten_thuoc_tinh || '').trim();
  return {
    hang_hoa_id: row.hang_hoa_id,
    lo_hang_id: row.lo_hang_id || undefined,
    gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || undefined,
    ten_quy_cach: tenQuyCach || undefined,
    ten_thuoc_tinh: String(row.ten_thuoc_tinh || tenQuyCach || '').trim() || undefined,
    sync_quy_cach: Boolean(tenQuyCach || row.gia_tri_thuoc_tinh_id),
    so_luong: Number(row.so_luong || 0),
    gia_von: Number(row.don_gia || 0)
  };
}

async function applyInventory(doc, mode, userId, session) {
  const rows = await CTPhieuTraHang.find({ phieu_tra_hang_id: doc._id, deleted_at: null }).session(session).lean();
  for (const row of rows) {
    if (!row.hang_hoa_id || Number(row.so_luong || 0) <= 0) continue;
    const line = stockLineFromDetail(row);
    const isExchangeLine = String(row.loai_dong || '') === 'hang_doi';
    const shouldIncrease = mode === 'restore' ? !isExchangeLine : isExchangeLine;
    const payload = Object.assign({}, line, {
      kho_id: doc.kho_id,
      nguoi_tao_id: userId,
      loai_phieu: mode === 'restore' ? 'tra_hang' : 'dieu_chinh',
      ma_phieu: String(doc.ma_phieu_tra || ''),
      ghi_chu: mode === 'restore'
        ? 'Khôi phục phiếu trả hàng bán từ thùng rác'
        : 'Hoàn tác phiếu trả hàng bán khi đưa vào thùng rác',
      session
    });
    if (shouldIncrease) await congTonKho(payload);
    else await truTonKho(payload);
  }
}

async function rollbackCompletedReturn(doc, userId, session) {
  if (!doc || String(doc.trang_thai || '') !== 'completed') return {};
  const returnId = String(doc._id);
  const returnCode = doc.ma_phieu_tra || '';
  const storeId = doc.cua_hang_id;
  const receipts = await loadRelatedReceipts([returnId], [returnCode], storeId, session, false);
  const receiptIds = objectIdStrings(receipts);
  const [debtRows, debtTxRows, nhapVatChua, xuatVatChua] = await Promise.all([
    loadRelatedCustomerDebt([returnId], receiptIds, [returnCode], session, false),
    loadRelatedCustomerDebtTx([returnId], receiptIds, [returnCode], storeId, session, false),
    loadRelatedVatChua(NhapVatChua, [returnId], storeId, session, false),
    loadRelatedVatChua(XuatVatChua, [returnId], storeId, session, false)
  ]);

  await applyInventory(doc, 'trash', userId, session);
  if (storeId) {
    await cancelNhapVatChuaBySource(storeId, 'tra_hang_ban', doc._id, session);
    await cancelXuatVatChuaBySource(storeId, 'tra_hang_ban', doc._id, session);
  }
  await applyCustomerDebtRows(debtRows, 'rollback', session);
  await applyCustomerDebtTxRows(debtTxRows, 'rollback', session);
  return { receipts, debtRows, debtTxRows, nhapVatChua, xuatVatChua };
}

function statusMap(rows) {
  return (rows || []).reduce(function(map, row) {
    if (row && row._id) map[String(row._id)] = String(row.trang_thai || '');
    return map;
  }, {});
}

async function moveReturnsToTrash(returnIds, storeId, userId) {
  const preview = await previewReturnTrash(returnIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock && firstBlock.block_reason || 'Không thể đưa các phiếu trả hàng đã chọn vào thùng rác.');
  }
  const session = await mongoose.startSession();
  const moved = [];
  try {
    await session.withTransaction(async function() {
      const now = new Date();
      for (const item of preview.items) {
        if (!item.can_trash) continue;
        const filter = {
          _id: item.phieu_tra_hang_id,
          deleted_at: null,
          trang_thai: { $ne: 'cancelled' }
        };
        if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
        const slip = await PhieuTraHang.findOne(filter).session(session);
        if (!slip) continue;

        const originalStatus = String(slip.trang_thai || 'completed');
        const rollback = await rollbackCompletedReturn(slip, userId, session);
        const returnId = String(slip._id);
        const returnCode = slip.ma_phieu_tra || '';
        const receipts = rollback.receipts || await loadRelatedReceipts([returnId], [returnCode], storeId, session, false);
        const receiptIds = objectIdStrings(receipts);
        const debtRows = rollback.debtRows || await loadRelatedCustomerDebt([returnId], receiptIds, [returnCode], session, false);
        const debtTxRows = rollback.debtTxRows || await loadRelatedCustomerDebtTx([returnId], receiptIds, [returnCode], storeId, session, false);
        const nhapVatChua = rollback.nhapVatChua || await loadRelatedVatChua(NhapVatChua, [returnId], storeId, session, false);
        const xuatVatChua = rollback.xuatVatChua || await loadRelatedVatChua(XuatVatChua, [returnId], storeId, session, false);

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
                ly_do_huy: 'Đưa phiếu trả hàng bán vào thùng rác'
              }
            },
            { session }
          );
        }
        if (debtRows.length) {
          await CongNoKhachHang.updateMany(
            { _id: { $in: debtRows.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: now, deleted_by: userId || null } },
            { session }
          );
        }
        if (debtTxRows.length) {
          await GiaoDichCongNoKhachHang.updateMany(
            { _id: { $in: debtTxRows.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'cancelled',
                deleted_at: now,
                deleted_by: userId || null,
                nguoi_huy_id: userId || null,
                ngay_huy: now,
                ly_do_huy: 'Đưa phiếu trả hàng bán vào thùng rác'
              }
            },
            { session }
          );
        }
        await CTPhieuTraHang.updateMany(
          { phieu_tra_hang_id: slip._id, deleted_at: null },
          { $set: { deleted_at: now, deleted_by: userId || null } },
          { session }
        );
        await NhapVatChua.updateMany(
          { _id: { $in: nhapVatChua.map(function(row) { return row._id; }) } },
          { $set: { deleted_at: now, deleted_by: userId || null, trang_thai: 'cancelled' } },
          { session }
        );
        await XuatVatChua.updateMany(
          { _id: { $in: xuatVatChua.map(function(row) { return row._id; }) } },
          { $set: { deleted_at: now, deleted_by: userId || null, trang_thai: 'cancelled' } },
          { session }
        );

        slip.deleted_at = now;
        slip.deleted_by = userId || null;
        slip.trang_thai = 'cancelled';
        await slip.save({ session });

        const metadata = {
          original_status: originalStatus,
          phieu_tra_hang_id: String(slip._id),
          hoa_don_id: slip.hoa_don_id ? String(slip.hoa_don_id) : '',
          cua_hang_id: slip.cua_hang_id ? String(slip.cua_hang_id) : String(storeId || ''),
          receipt_ids: objectIdStrings(receipts),
          receipt_statuses: statusMap(receipts),
          nhap_vat_chua_ids: objectIdStrings(nhapVatChua),
          xuat_vat_chua_ids: objectIdStrings(xuatVatChua),
          cong_no_khach_hang_ids: objectIdStrings(debtRows),
          giao_dich_cong_no_khach_hang_ids: objectIdStrings(debtTxRows)
        };

        const rootRows = await ThungRacItem.create([{
          entity_type: 'PhieuTraHang',
          entity_id: slip._id,
          ma_chung_tu: slip.ma_phieu_tra || '',
          ten_hien_thi: item.ten_khach || slip.ma_phieu_tra || 'Phiếu trả hàng bán',
          mo_ta_phu: item.ten_khach ? ('Khách hàng: ' + item.ten_khach) : '',
          cua_hang_id: slip.cua_hang_id || storeId || null,
          deleted_at: now,
          deleted_by: userId || null,
          is_trash_root: true,
          trash_group_id: null,
          restored_at: null,
          sort_order: 0,
          metadata
        }], { session });
        const root = rootRows && rootRows[0];
        let sortOrder = 1;
        for (const group of item.groups || []) {
          if (Number(group.count || 0) <= 0 || !root) continue;
          const childFields = buildTrashChildFields(group);
          await ThungRacItem.create([{
            entity_type: group.entity_type,
            entity_id: slip._id,
            ma_chung_tu: childFields.ma_chung_tu,
            ten_hien_thi: childFields.ten_hien_thi,
            mo_ta_phu: childFields.mo_ta_phu,
            cua_hang_id: slip.cua_hang_id || storeId || null,
            deleted_at: now,
            deleted_by: userId || null,
            is_trash_root: false,
            trash_group_id: root._id,
            restored_at: null,
            sort_order: sortOrder,
            metadata
          }], { session });
          sortOrder += 1;
        }
        moved.push({
          phieu_tra_hang_id: String(slip._id),
          ma_phieu_tra: slip.ma_phieu_tra || '',
          trash_root_id: root ? String(root._id) : ''
        });
      }
    });
  } finally {
    await session.endSession();
  }
  return { moved_count: moved.length, moved };
}

async function restoreNhapVatChuaRows(rows, session) {
  for (const doc of rows || []) {
    const items = Array.isArray(doc.items) ? doc.items : [];
    for (const item of items) {
      const vatChuaId = toObjectId(item.vat_chua_id);
      const qty = Math.floor(Number(item.so_luong || 0));
      if (!vatChuaId || qty <= 0) continue;
      await VatChua.updateOne({ _id: vatChuaId }, { $inc: { so_luong_ton: qty } }, { session });
    }
    await NhapVatChua.updateOne(
      { _id: doc._id },
      { $set: { trang_thai: 'active', deleted_at: null, deleted_by: null } },
      { session }
    );
  }
}

async function restoreXuatVatChuaRows(rows, session) {
  for (const doc of rows || []) {
    const items = Array.isArray(doc.items) ? doc.items : [];
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
      { _id: doc._id },
      { $set: { trang_thai: 'active', deleted_at: null, deleted_by: null } },
      { session }
    );
  }
}

async function restoreReturnFromTrash(rootTrashIds, storeId, userId) {
  const ids = normalizeIds(rootTrashIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một chứng từ trong thùng rác.');
  if (!storeId || !mongoose.Types.ObjectId.isValid(String(storeId))) {
    throw createHttpError(400, 'Không xác định được cửa hàng.');
  }
  const session = await mongoose.startSession();
  const restored = [];
  try {
    await session.withTransaction(async function() {
      const roots = await ThungRacItem.find({
        _id: { $in: ids.map(toObjectId).filter(Boolean) },
        cua_hang_id: storeId,
        restored_at: null,
        is_trash_root: true,
        entity_type: 'PhieuTraHang'
      }).session(session).lean();
      if (roots.length !== ids.length) {
        throw createHttpError(404, 'Chỉ hỗ trợ khôi phục các phiếu trả hàng bán còn trong thùng rác.');
      }
      for (const root of roots) {
        const metadata = root.metadata || {};
        const doc = await PhieuTraHang.findOne({ _id: root.entity_id, cua_hang_id: storeId }).session(session);
        if (!doc) throw createHttpError(404, 'Phiếu trả hàng bán đã bị xóa vĩnh viễn.');
        if (!doc.deleted_at) throw createHttpError(400, 'Phiếu trả hàng bán không còn trong thùng rác.');

        const originalStatus = String(metadata.original_status || 'completed');
        const returnId = String(doc._id);
        const returnCode = doc.ma_phieu_tra || '';
        const receiptIds = Array.isArray(metadata.receipt_ids) ? metadata.receipt_ids.map(toObjectId).filter(Boolean) : [];
        const nhapIds = Array.isArray(metadata.nhap_vat_chua_ids) ? metadata.nhap_vat_chua_ids.map(toObjectId).filter(Boolean) : [];
        const xuatIds = Array.isArray(metadata.xuat_vat_chua_ids) ? metadata.xuat_vat_chua_ids.map(toObjectId).filter(Boolean) : [];
        const debtIds = Array.isArray(metadata.cong_no_khach_hang_ids) ? metadata.cong_no_khach_hang_ids.map(toObjectId).filter(Boolean) : [];
        const debtTxIds = Array.isArray(metadata.giao_dich_cong_no_khach_hang_ids) ? metadata.giao_dich_cong_no_khach_hang_ids.map(toObjectId).filter(Boolean) : [];

        await CTPhieuTraHang.updateMany(
          { phieu_tra_hang_id: doc._id },
          { $set: { deleted_at: null, deleted_by: null } },
          { session }
        );
        if (originalStatus === 'completed') await applyInventory(doc, 'restore', userId, session);

        const receiptFilter = receiptIds.length ? { _id: { $in: receiptIds } } : buildReceiptFilter([returnId], [returnCode], true);
        const receipts = await PhieuThuChi.find(receiptFilter).session(session).lean();
        const currentReceiptIds = objectIdStrings(receipts);
        const debtRows = await CongNoKhachHang.find(debtIds.length
          ? { _id: { $in: debtIds } }
          : buildDebtFilter([returnId], currentReceiptIds, [returnCode], true, false)
        ).session(session).lean();
        const debtTxRows = GiaoDichCongNoKhachHang
          ? await GiaoDichCongNoKhachHang.find(debtTxIds.length
            ? { _id: { $in: debtTxIds } }
            : buildDebtFilter([returnId], currentReceiptIds, [returnCode], true, false)
          ).session(session).lean()
          : [];
        const nhapRows = await NhapVatChua.find(nhapIds.length
          ? { _id: { $in: nhapIds } }
          : { source_type: 'tra_hang_ban', source_id: doc._id }
        ).session(session).lean();
        const xuatRows = await XuatVatChua.find(xuatIds.length
          ? { _id: { $in: xuatIds } }
          : { source_type: 'tra_hang_ban', source_id: doc._id }
        ).session(session).lean();

        if (originalStatus === 'completed') {
          await restoreNhapVatChuaRows(nhapRows, session);
          await restoreXuatVatChuaRows(xuatRows, session);
          await applyCustomerDebtRows(debtRows, 'restore', session);
          await applyCustomerDebtTxRows(debtTxRows, 'restore', session);
        }

        const receiptStatuses = metadata.receipt_statuses || {};
        for (const receipt of receipts) {
          await PhieuThuChi.updateOne(
            { _id: receipt._id },
            {
              $set: {
                trang_thai: receiptStatuses[String(receipt._id)] || 'paid',
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
          await CongNoKhachHang.updateMany(
            { _id: { $in: debtRows.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: null, deleted_by: null } },
            { session }
          );
        }
        if (debtTxRows.length) {
          await GiaoDichCongNoKhachHang.updateMany(
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

        doc.deleted_at = null;
        doc.deleted_by = null;
        doc.trang_thai = originalStatus;
        await doc.save({ session });

        await ThungRacItem.deleteMany({
          cua_hang_id: storeId,
          $or: [{ _id: root._id }, { trash_group_id: root._id }]
        }).session(session);
        restored.push({ trash_id: String(root._id), phieu_tra_hang_id: returnId, ma_phieu_tra: doc.ma_phieu_tra || '' });
      }
    });
  } finally {
    await session.endSession();
  }
  return { restored_count: restored.length, restored };
}

async function cancelReturnSlip(returnId, storeId, userId) {
  const id = toObjectId(returnId);
  if (!id) throw createHttpError(400, 'ID phiếu trả hàng không hợp lệ.');
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async function() {
      const filter = { _id: id, deleted_at: null };
      if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
      const doc = await PhieuTraHang.findOne(filter).session(session);
      if (!doc) throw createHttpError(404, 'Không tìm thấy phiếu trả hàng.');
      if (String(doc.trang_thai || '') === 'cancelled') {
        result = { phieu_tra_hang_id: String(doc._id), ma_phieu_tra: doc.ma_phieu_tra || '', already_cancelled: true };
        return;
      }
      const rollback = await rollbackCompletedReturn(doc, userId, session);
      const now = new Date();
      const receipts = rollback.receipts || [];
      const debtRows = rollback.debtRows || [];
      const debtTxRows = rollback.debtTxRows || [];
      if (receipts.length) {
        await PhieuThuChi.updateMany(
          { _id: { $in: receipts.map(function(row) { return row._id; }) } },
          {
            $set: {
              trang_thai: 'cancelled',
              nguoi_huy_id: userId || null,
              ngay_huy: now,
              ly_do_huy: 'Hủy phiếu trả hàng bán'
            }
          },
          { session }
        );
      }
      if (debtRows.length) {
        await CongNoKhachHang.updateMany(
          { _id: { $in: debtRows.map(function(row) { return row._id; }) } },
          { $set: { deleted_at: now, deleted_by: userId || null } },
          { session }
        );
      }
      if (debtTxRows.length) {
        await GiaoDichCongNoKhachHang.updateMany(
          { _id: { $in: debtTxRows.map(function(row) { return row._id; }) } },
          {
            $set: {
              trang_thai: 'cancelled',
              deleted_at: now,
              deleted_by: userId || null,
              nguoi_huy_id: userId || null,
              ngay_huy: now,
              ly_do_huy: 'Hủy phiếu trả hàng bán'
            }
          },
          { session }
        );
      }
      doc.trang_thai = 'cancelled';
      await doc.save({ session });
      result = { phieu_tra_hang_id: String(doc._id), ma_phieu_tra: doc.ma_phieu_tra || '' };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = {
  RELATION_LABELS,
  previewReturnTrash,
  moveReturnsToTrash,
  restoreReturnFromTrash,
  cancelReturnSlip
};
