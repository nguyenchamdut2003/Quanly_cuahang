const mongoose = require('mongoose');
const {
  PhieuNhap,
  CTPhieuNhap,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  PhieuThuChi,
  CongNoNhaCungCap,
  GiaoDichCongNoNhaCungCap,
  HoaDonDauVao,
  LoHang,
  NhapVatChua,
  GopPhieuNhap
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

const RELATION_LABELS = ENTITY_LABELS;

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
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

async function countThuChiByPurchases(purchaseIds) {
  if (!purchaseIds.length) return { count: 0, samples: [], rows: [] };
  const objectIds = purchaseIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const rows = await PhieuThuChi.find({
    trang_thai: { $ne: 'cancelled' },
    $or: [
      { phieu_nhap_id: { $in: objectIds } },
      { 'allocations.phieu_nhap_id': { $in: objectIds } }
    ]
  })
    .select('ma_phieu phieu_nhap_id')
    .limit(50)
    .lean();
  return {
    count: rows.length,
    samples: sampleTexts(rows, function(row) { return row.ma_phieu || ''; }),
    rows: rows
  };
}

async function buildPurchaseImpact(purchase) {
  const purchaseId = purchase._id;
  const purchaseIdStr = String(purchaseId);
  const warnings = [];
  let canTrash = true;
  let blockReason = '';

  if (purchase.deleted_at) {
    canTrash = false;
    blockReason = 'Phiếu đã nằm trong thùng rác.';
  } else if (String(purchase.trang_thai || '') === 'merged') {
    canTrash = false;
    blockReason = 'Phiếu đã gộp vào ' + (purchase.merged_to_ma_phieu_nhap || 'phiếu khác') + ', không thể xóa riêng.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'PhieuNhap',
      entity_id: purchaseId,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu đã nằm trong thùng rác.';
    }
  }

  if (canTrash && String(purchase.trang_thai || '') === 'cancelled') {
    warnings.push('Phiếu đang ở trạng thái đã hủy.');
  }
  if (canTrash && Number(purchase.con_no_ncc || 0) > 0) {
    warnings.push('Phiếu còn công nợ NCC: ' + Number(purchase.con_no_ncc || 0).toLocaleString('vi-VN') + ' VNĐ.');
  }

  const [
    ctLines,
    returnSlips,
    returnLineCount,
    congNoRows,
    giaoDichRows,
    hoaDonDauVaoRows,
    loRows,
    vatChuaRows,
    gopRows
  ] = await Promise.all([
    CTPhieuNhap.find({ phieu_nhap_id: purchaseId }).select('_id hang_hoa_id').lean(),
    PhieuTraHangNhap.find({ phieu_nhap_id: purchaseId, trang_thai: { $ne: 'cancelled' } })
      .select('ma_phieu_tra_nhap')
      .lean(),
    CTPhieuTraHangNhap.countDocuments({ phieu_nhap_id: purchaseId }),
    CongNoNhaCungCap.countDocuments({ phieu_nhap_id: purchaseId }),
    GiaoDichCongNoNhaCungCap.countDocuments({ phieu_nhap_id: purchaseId, trang_thai: { $ne: 'cancelled' } }),
    HoaDonDauVao.countDocuments({ phieu_nhap_id: purchaseId, trang_thai: { $ne: 'cancelled' } }),
    LoHang.countDocuments({ phieu_nhap_id: purchaseId }),
    NhapVatChua.countDocuments({ source_type: 'phieu_nhap', source_id: purchaseId, trang_thai: { $ne: 'cancelled' } }),
    GopPhieuNhap.countDocuments({
      $or: [
        { phieu_nhan_id: purchaseId },
        { phieu_nguon_ids: purchaseId }
      ],
      trang_thai: { $ne: 'cancelled' }
    })
  ]);

  const thuChi = await countThuChiByPurchases([purchaseIdStr]);

  if (canTrash && returnSlips.length > 0) {
    warnings.push('Phiếu đã phát sinh trả hàng nhập — xóa sẽ đưa cả dữ liệu liên quan vào thùng rác.');
  }

  const mergedSources = Array.isArray(purchase.merged_from_ma_phieu_nhaps)
    ? purchase.merged_from_ma_phieu_nhaps.filter(Boolean)
    : [];

  const groups = [
    {
      entity_type: 'CTPhieuNhap',
      label: RELATION_LABELS.CTPhieuNhap,
      count: ctLines.length,
      samples: []
    },
    {
      entity_type: 'PhieuTraHangNhap',
      label: RELATION_LABELS.PhieuTraHangNhap,
      count: returnSlips.length,
      samples: sampleTexts(returnSlips, function(row) { return row.ma_phieu_tra_nhap || ''; })
    },
    {
      entity_type: 'CTPhieuTraHangNhap',
      label: RELATION_LABELS.CTPhieuTraHangNhap,
      count: returnLineCount,
      samples: []
    },
    {
      entity_type: 'PhieuThuChi',
      label: RELATION_LABELS.PhieuThuChi,
      count: thuChi.count,
      samples: thuChi.samples
    },
    {
      entity_type: 'CongNoNhaCungCap',
      label: RELATION_LABELS.CongNoNhaCungCap,
      count: congNoRows,
      samples: []
    },
    {
      entity_type: 'GiaoDichCongNoNhaCungCap',
      label: RELATION_LABELS.GiaoDichCongNoNhaCungCap,
      count: giaoDichRows,
      samples: []
    },
    {
      entity_type: 'HoaDonDauVao',
      label: RELATION_LABELS.HoaDonDauVao,
      count: hoaDonDauVaoRows,
      samples: []
    },
    {
      entity_type: 'LoHang',
      label: RELATION_LABELS.LoHang,
      count: loRows,
      samples: []
    },
    {
      entity_type: 'NhapVatChua',
      label: RELATION_LABELS.NhapVatChua,
      count: vatChuaRows,
      samples: []
    },
    {
      entity_type: 'GopPhieuNhap',
      label: RELATION_LABELS.GopPhieuNhap,
      count: gopRows,
      samples: []
    }
  ];

  if (mergedSources.length) {
    groups.push({
      entity_type: 'PhieuNhap_merged',
      label: RELATION_LABELS.PhieuNhap_merged,
      count: mergedSources.length,
      samples: mergedSources.slice(0, 3)
    });
  }

  const activeGroups = groups.filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    phieu_nhap_id: purchaseIdStr,
    ma_phieu_nhap: purchase.ma_phieu_nhap || '',
    ten_ncc: purchase.nha_cung_cap_id?.ten_ncc || purchase.nha_cung_cap_id?.ten_nha_cung_cap || '',
    trang_thai: purchase.trang_thai || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: warnings,
    groups: activeGroups,
    total_related: activeGroups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
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

async function previewPurchaseTrash(purchaseIds, storeId) {
  const ids = normalizeIds(purchaseIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu nhập.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }

  const purchases = await PhieuNhap.find(filter)
    .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' })
    .lean();

  if (purchases.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều phiếu nhập không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }

  const purchaseMap = purchases.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});

  const items = [];
  for (const id of ids) {
    const purchase = purchaseMap[id];
    if (!purchase) continue;
    items.push(await buildPurchaseImpact(purchase));
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

async function movePurchasesToTrash(purchaseIds, storeId, userId) {
  const preview = await previewPurchaseTrash(purchaseIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các phiếu đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];

  for (const item of preview.items) {
    if (!item.can_trash) continue;

    const purchase = await PhieuNhap.findById(item.phieu_nhap_id);
    if (!purchase) continue;

    purchase.deleted_at = now;
    purchase.deleted_by = userId || null;
    await purchase.save();

    const supplierName = item.ten_ncc || '';
    const root = await ThungRacItem.create({
      entity_type: 'PhieuNhap',
      entity_id: purchase._id,
      ma_chung_tu: purchase.ma_phieu_nhap || '',
      ten_hien_thi: supplierName || purchase.ma_phieu_nhap || 'Phiếu nhập',
      mo_ta_phu: supplierName ? ('Nhà cung cấp: ' + supplierName) : '',
      cua_hang_id: purchase.cua_hang_id || storeId || null,
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
        entity_id: purchase._id,
        ma_chung_tu: childFields.ma_chung_tu,
        ten_hien_thi: childFields.ten_hien_thi,
        mo_ta_phu: childFields.mo_ta_phu,
        cua_hang_id: purchase.cua_hang_id || storeId || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        sort_order: sortOrder
      });
      sortOrder += 1;
    }

    moved.push({
      phieu_nhap_id: String(purchase._id),
      ma_phieu_nhap: purchase.ma_phieu_nhap || '',
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
  previewPurchaseTrash,
  movePurchasesToTrash
};
