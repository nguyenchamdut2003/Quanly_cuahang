const mongoose = require('mongoose');
const { VatChua, NhapVatChua, PhieuThuChi } = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

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
  return rows.slice(0, limit || 3).map(pickFn).filter(Boolean);
}

function activeReceiptFilterForImports(importObjectIds, importCodes, storeId) {
  const filter = {
    loai_phieu: 'chi',
    trang_thai: { $ne: 'cancelled' },
    deleted_at: null,
    $or: [
      { nhap_vat_chua_id: { $in: importObjectIds } }
    ]
  };
  if (importCodes.length) filter.$or.push({ ma_chung_tu_goc: { $in: importCodes } });
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return filter;
}

async function loadRelatedReceipts(importIds, storeId) {
  if (!importIds.length) return [];
  const docs = await NhapVatChua.find({ _id: { $in: importIds } }).select('ma_nhap_vat_chua').lean();
  const codes = docs.map(function(row) { return row.ma_nhap_vat_chua; }).filter(Boolean);
  const objectIds = importIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  return PhieuThuChi.find(activeReceiptFilterForImports(objectIds, codes, storeId))
    .select('_id ma_phieu gia_tri ngay_lap nhap_vat_chua_id ma_chung_tu_goc')
    .sort({ ngay_lap: -1, created_at: -1 })
    .lean();
}

function summarizeStockLines(doc) {
  return (Array.isArray(doc.items) ? doc.items : []).map(function(line) {
    const qty = Math.floor(Number(line.so_luong || 0));
    return {
      vat_chua_id: String(line.vat_chua_id || ''),
      ma_vat_chua: line.ma_vat_chua || '',
      ten_vat_chua: line.ten_vat_chua || '',
      so_luong: qty
    };
  }).filter(function(line) {
    return mongoose.Types.ObjectId.isValid(line.vat_chua_id) && line.so_luong > 0;
  });
}

async function buildNhapVatChuaImpact(doc, storeId) {
  let canTrash = true;
  let blockReason = '';
  const warnings = [
    'Tồn vật chứa sẽ được trừ lại theo số lượng đã nhập trên phiếu.',
    'Phiếu chi trong sổ quỹ liên quan sẽ được đưa vào thùng rác cùng phiếu nhập vật chứa.'
  ];

  if (doc.deleted_at) {
    canTrash = false;
    blockReason = 'Phiếu nhập vật chứa đã nằm trong thùng rác.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'NhapVatChua',
      entity_id: doc._id,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu nhập vật chứa đã nằm trong thùng rác.';
    }
  }

  const lines = summarizeStockLines(doc);
  const vatChuaIds = lines.map(function(line) { return line.vat_chua_id; });
  const vatChuaRows = vatChuaIds.length
    ? await VatChua.find({ _id: { $in: vatChuaIds }, cua_hang_id: storeId }).select('_id so_luong_ton ten_vat_chua ma_vat_chua').lean()
    : [];
  const stockMap = vatChuaRows.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});

  for (const line of lines) {
    const stock = stockMap[line.vat_chua_id];
    if (!stock) {
      canTrash = false;
      blockReason = 'Không tìm thấy vật chứa trên một dòng nhập.';
      break;
    }
    if (Number(stock.so_luong_ton || 0) < line.so_luong) {
      canTrash = false;
      blockReason = 'Tồn vật chứa không đủ để trừ lại phiếu ' + (doc.ma_nhap_vat_chua || '') + '.';
      break;
    }
  }

  const receipts = await loadRelatedReceipts([String(doc._id)], storeId);
  const groups = [{
    entity_type: 'PhieuThuChi',
    label: ENTITY_LABELS.PhieuThuChi,
    count: receipts.length,
    samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }, 5)
  }].filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    nhap_vat_chua_id: String(doc._id),
    ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
    doi_tuong_ten: doc.doi_tuong_ten || '',
    tong_so_luong: Number(doc.tong_so_luong || 0),
    tong_tien: Number(doc.tong_tien || 0),
    trang_thai: doc.trang_thai || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: canTrash ? warnings : [],
    groups: groups,
    total_related: groups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
}

function aggregateGroupTotals(items) {
  const map = {};
  items.forEach(function(item) {
    (item.groups || []).forEach(function(group) {
      const key = group.entity_type;
      if (!map[key]) {
        map[key] = {
          entity_type: key,
          label: group.label,
          count: 0,
          samples: []
        };
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
    return a.label.localeCompare(b.label, 'vi');
  });
}

async function previewNhapVatChuaTrash(rawIds, storeId) {
  const ids = normalizeIds(rawIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu nhập vật chứa.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;

  const docs = await NhapVatChua.find(filter).lean();
  if (docs.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều phiếu nhập vật chứa không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }

  const docMap = docs.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});
  const items = [];
  for (const id of ids) {
    if (docMap[id]) items.push(await buildNhapVatChuaImpact(docMap[id], storeId));
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

async function moveNhapVatChuaToTrash(rawIds, storeId, userId) {
  const preview = await previewNhapVatChuaTrash(rawIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các phiếu đã chọn vào thùng rác.');
  }

  const session = await mongoose.startSession();
  const moved = [];
  try {
    await session.withTransaction(async function() {
      const now = new Date();
      for (const item of preview.items) {
        if (!item.can_trash) continue;
        const doc = await NhapVatChua.findOne({
          _id: item.nhap_vat_chua_id,
          cua_hang_id: storeId,
          deleted_at: null
        }).session(session);
        if (!doc) continue;

        const lines = summarizeStockLines(doc);
        for (const line of lines) {
          const updated = await VatChua.updateOne(
            {
              _id: line.vat_chua_id,
              cua_hang_id: storeId,
              so_luong_ton: { $gte: line.so_luong }
            },
            { $inc: { so_luong_ton: -line.so_luong } },
            { session: session }
          );
          if (!updated || Number(updated.modifiedCount || 0) < 1) {
            throw createHttpError(400, 'Tồn vật chứa không đủ để trừ lại phiếu ' + (doc.ma_nhap_vat_chua || '') + '.');
          }
        }

        doc.deleted_at = now;
        doc.deleted_by = userId || null;
        doc.trang_thai = 'cancelled';
        await doc.save({ session: session });

        const root = await ThungRacItem.create([{
          entity_type: 'NhapVatChua',
          entity_id: doc._id,
          ma_chung_tu: doc.ma_nhap_vat_chua || '',
          ten_hien_thi: doc.ma_nhap_vat_chua || 'Phiếu nhập vật chứa',
          mo_ta_phu: doc.doi_tuong_ten ? ('Đối tượng: ' + doc.doi_tuong_ten) : '',
          cua_hang_id: doc.cua_hang_id || storeId || null,
          deleted_at: now,
          deleted_by: userId || null,
          is_trash_root: true,
          trash_group_id: null,
          sort_order: 0
        }], { session: session });
        const rootDoc = root && root[0];

        const receipts = await loadRelatedReceipts([String(doc._id)], storeId);
        if (receipts.length) {
          await PhieuThuChi.updateMany(
            { _id: { $in: receipts.map(function(row) { return row._id; }) } },
            { $set: { deleted_at: now, deleted_by: userId || null } },
            { session: session }
          );
          const childFields = buildTrashChildFields({
            entity_type: 'PhieuThuChi',
            label: ENTITY_LABELS.PhieuThuChi,
            count: receipts.length,
            samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }, 5)
          });
          await ThungRacItem.create([{
            entity_type: 'PhieuThuChi',
            entity_id: doc._id,
            ma_chung_tu: childFields.ma_chung_tu,
            ten_hien_thi: childFields.ten_hien_thi,
            mo_ta_phu: childFields.mo_ta_phu,
            cua_hang_id: doc.cua_hang_id || storeId || null,
            deleted_at: now,
            deleted_by: userId || null,
            is_trash_root: false,
            trash_group_id: rootDoc._id,
            sort_order: 1
          }], { session: session });
        }

        moved.push({
          nhap_vat_chua_id: String(doc._id),
          ma_nhap_vat_chua: doc.ma_nhap_vat_chua || '',
          trash_root_id: String(rootDoc._id)
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
  previewNhapVatChuaTrash,
  moveNhapVatChuaToTrash
};
