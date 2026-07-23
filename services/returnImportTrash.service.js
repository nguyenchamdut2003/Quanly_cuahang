const mongoose = require('mongoose');
const {
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  PhieuThuChi,
  CongNoNhaCungCap,
  NhaCungCap,
  XuatVatChua
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');
const { congTonKho } = require('./kho.service');
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

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 5).map(pickFn).filter(Boolean);
}

async function loadRelatedReceipts(returnIds, storeId) {
  if (!returnIds.length) return [];
  const objectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const filter = {
    phieu_tra_hang_nhap_id: { $in: objectIds },
    deleted_at: null
  };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return PhieuThuChi.find(filter)
    .select('_id ma_phieu gia_tri ngay_lap phieu_tra_hang_nhap_id')
    .sort({ ngay_lap: -1, created_at: -1 })
    .lean();
}

async function loadRelatedXuatVatChua(returnIds, storeId) {
  if (!returnIds.length) return [];
  const objectIds = returnIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const filter = {
    source_type: 'phieu_tra_hang_nhap',
    source_id: { $in: objectIds },
    deleted_at: null
  };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return XuatVatChua.find(filter)
    .select('_id ma_xuat_vat_chua source_id tong_so_luong')
    .sort({ created_at: -1 })
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
  if (doc.deleted_at) {
    canTrash = false;
    blockReason = 'Phiếu trả hàng nhập đã nằm trong thùng rác.';
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

  const detailCount = await CTPhieuTraHangNhap.countDocuments({ phieu_tra_nhap_id: doc._id });
  const receipts = await loadRelatedReceipts([String(doc._id)], storeId);
  const xuatVatChua = await loadRelatedXuatVatChua([String(doc._id)], storeId);

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
    }
  ].filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    phieu_tra_hang_nhap_id: String(doc._id),
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

async function rollbackCompletedReturn(doc, userId, session) {
  if (!doc || String(doc.trang_thai || '') !== 'completed') return;
  const rows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: doc._id }).session(session).lean();
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

  await cancelXuatVatChuaBySource(doc.cua_hang_id, 'phieu_tra_hang_nhap', doc._id, session);

  const receipts = await PhieuThuChi.find({ phieu_tra_hang_nhap_id: doc._id, deleted_at: null }).session(session).lean();
  for (const rec of receipts) {
    const linked = await CongNoNhaCungCap.find({ phieu_thu_chi_id: rec._id }).session(session).lean();
    for (const row of linked) {
      if (!row.nha_cung_cap_id) continue;
      const amount = Number(row.so_tien || 0);
      if (row.loai === 'giam_no') {
        await NhaCungCap.updateOne({ _id: row.nha_cung_cap_id }, { $inc: { tong_no: amount } }, { session });
      } else if (row.loai === 'thanh_toan') {
        await NhaCungCap.updateOne({ _id: row.nha_cung_cap_id }, { $inc: { tong_no: -amount } }, { session });
      }
    }
  }
  await CongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: { $in: receipts.map(function(row) { return row._id; }) } }).session(session);

  const standalone = await CongNoNhaCungCap.find({
    phieu_tra_nhap_id: doc._id,
    $or: [{ phieu_thu_chi_id: { $exists: false } }, { phieu_thu_chi_id: null }]
  }).session(session).lean();
  for (const row of standalone) {
    if (row.loai === 'giam_no' && row.nha_cung_cap_id) {
      await NhaCungCap.updateOne({ _id: row.nha_cung_cap_id }, { $inc: { tong_no: Number(row.so_tien || 0) } }, { session });
    }
  }
  await CongNoNhaCungCap.deleteMany({
    phieu_tra_nhap_id: doc._id,
    $or: [{ phieu_thu_chi_id: { $exists: false } }, { phieu_thu_chi_id: null }]
  }).session(session);
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
          deleted_at: null
        }).session(session);
        if (!doc) continue;

        await rollbackCompletedReturn(doc, userId, session);

        const receipts = await loadRelatedReceipts([String(doc._id)], storeId);
        if (receipts.length) {
          await PhieuThuChi.updateMany(
            { _id: { $in: receipts.map(function(row) { return row._id; }) } },
            {
              $set: {
                trang_thai: 'cancelled',
                deleted_at: now,
                deleted_by: userId || null,
                ngay_huy: now,
                ly_do_huy: 'Đưa phiếu trả hàng nhập vào thùng rác'
              }
            },
            { session }
          );
        }
        const xuatVatChua = await loadRelatedXuatVatChua([String(doc._id)], storeId);
        if (xuatVatChua.length) {
          await XuatVatChua.updateMany(
            { _id: { $in: xuatVatChua.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: now, deleted_by: userId || null, trang_thai: 'cancelled' } },
            { session }
          );
        }

        doc.deleted_at = now;
        doc.deleted_by = userId || null;
        doc.trang_thai = 'cancelled';
        await doc.save({ session });

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
          sort_order: 0
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
            sort_order: sortOrder
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

module.exports = {
  previewReturnImportTrash,
  moveReturnImportToTrash
};
