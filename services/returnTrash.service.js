const mongoose = require('mongoose');
const {
  PhieuTraHang,
  CTPhieuTraHang,
  PhieuThuChi,
  CongNoKhachHang,
  GiaoDichCongNoKhachHang,
  NhapVatChua,
  XuatVatChua
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

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

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 3).map(pickFn).filter(Boolean);
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function buildReturnImpact(returnSlip) {
  const returnId = returnSlip._id;
  const returnCode = returnSlip.ma_phieu_tra || '';
  const warnings = [];
  let canTrash = true;
  let blockReason = '';

  if (returnSlip.deleted_at) {
    canTrash = false;
    blockReason = 'Phiếu trả hàng đã nằm trong thùng rác.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'PhieuTraHang',
      entity_id: returnId,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu trả hàng đã nằm trong thùng rác.';
    }
  }

  if (canTrash && String(returnSlip.trang_thai || '') !== 'cancelled') {
    warnings.push('Phiếu trả hàng sẽ chỉ được đưa vào thùng rác, không đảo tồn kho hay hủy thu/chi.');
  }

  const receiptFilter = {
    trang_thai: { $ne: 'cancelled' },
    $or: [{ phieu_tra_hang_id: returnId }]
  };
  if (returnCode) receiptFilter.$or.push({ ma_chung_tu_goc: returnCode });
  const debtFilter = { $or: [{ phieu_tra_hang_id: returnId }] };
  if (returnCode) debtFilter.$or.push({ ma_chung_tu_goc: returnCode }, { ghi_chu: { $regex: escapeRegex(returnCode), $options: 'i' } });
  const debtTransactionFilter = Object.assign({ trang_thai: { $ne: 'cancelled' } }, debtFilter);

  const [lineCount, receiptRows, customerDebtCount, debtTransactionCount, nhapVatRows, xuatVatRows] = await Promise.all([
    CTPhieuTraHang.countDocuments({ phieu_tra_hang_id: returnId }),
    PhieuThuChi.find(receiptFilter).select('ma_phieu').limit(50).lean(),
    CongNoKhachHang.countDocuments(debtFilter),
    GiaoDichCongNoKhachHang
      ? GiaoDichCongNoKhachHang.countDocuments(debtTransactionFilter)
      : 0,
    NhapVatChua.find({ source_type: 'tra_hang_ban', source_id: returnId, trang_thai: { $ne: 'cancelled' } })
      .select('ma_nhap_vat_chua')
      .lean(),
    XuatVatChua.find({ source_type: 'tra_hang_ban', source_id: returnId, trang_thai: { $ne: 'cancelled' } })
      .select('ma_xuat_vat_chua')
      .lean()
  ]);

  const groups = [
    {
      entity_type: 'CTPhieuTraHang',
      label: RELATION_LABELS.CTPhieuTraHang,
      count: lineCount,
      samples: []
    },
    {
      entity_type: 'PhieuThuChi',
      label: RELATION_LABELS.PhieuThuChi,
      count: receiptRows.length,
      samples: sampleTexts(receiptRows, function(row) { return row.ma_phieu || ''; })
    },
    {
      entity_type: 'CongNoKhachHang',
      label: RELATION_LABELS.CongNoKhachHang,
      count: customerDebtCount,
      samples: []
    },
    {
      entity_type: 'GiaoDichCongNoKhachHang',
      label: RELATION_LABELS.GiaoDichCongNoKhachHang,
      count: debtTransactionCount,
      samples: []
    },
    {
      entity_type: 'NhapVatChua',
      label: RELATION_LABELS.NhapVatChua,
      count: nhapVatRows.length,
      samples: sampleTexts(nhapVatRows, function(row) { return row.ma_nhap_vat_chua || ''; })
    },
    {
      entity_type: 'XuatVatChua',
      label: RELATION_LABELS.XuatVatChua,
      count: xuatVatRows.length,
      samples: sampleTexts(xuatVatRows, function(row) { return row.ma_xuat_vat_chua || ''; })
    }
  ];
  const activeGroups = groups.filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    phieu_tra_hang_id: String(returnId),
    ma_phieu_tra: returnCode,
    ten_khach: returnSlip.khach_hang_id?.ten_khach_hang || '',
    trang_thai: returnSlip.trang_thai || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: warnings,
    groups: activeGroups,
    total_related: activeGroups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
}

async function previewReturnTrash(returnIds, storeId) {
  const ids = normalizeIds(returnIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu trả hàng.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }

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
    const slip = slipMap[id];
    if (!slip) continue;
    items.push(await buildReturnImpact(slip));
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

async function moveReturnsToTrash(returnIds, storeId, userId) {
  const preview = await previewReturnTrash(returnIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các phiếu trả hàng đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];

  for (const item of preview.items) {
    if (!item.can_trash) continue;

    const slip = await PhieuTraHang.findById(item.phieu_tra_hang_id);
    if (!slip) continue;

    slip.deleted_at = now;
    slip.deleted_by = userId || null;
    await slip.save();

    const customerName = item.ten_khach || '';
    const root = await ThungRacItem.create({
      entity_type: 'PhieuTraHang',
      entity_id: slip._id,
      ma_chung_tu: slip.ma_phieu_tra || '',
      ten_hien_thi: customerName || slip.ma_phieu_tra || 'Phiếu trả hàng bán',
      mo_ta_phu: customerName ? ('Khách hàng: ' + customerName) : '',
      cua_hang_id: slip.cua_hang_id || storeId || null,
      deleted_at: now,
      deleted_by: userId || null,
      is_trash_root: true,
      trash_group_id: null,
      sort_order: 0
    });

    let sortOrder = 1;
    for (const group of item.groups || []) {
      if (Number(group.count || 0) <= 0) continue;
      const childFields = buildTrashChildFields(group);
      await ThungRacItem.create({
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
        sort_order: sortOrder
      });
      sortOrder += 1;
    }

    moved.push({
      phieu_tra_hang_id: String(slip._id),
      ma_phieu_tra: slip.ma_phieu_tra || '',
      trash_root_id: String(root._id)
    });
  }

  return {
    moved_count: moved.length,
    moved: moved
  };
}

module.exports = {
  RELATION_LABELS,
  previewReturnTrash,
  moveReturnsToTrash
};
