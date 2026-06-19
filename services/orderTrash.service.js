const mongoose = require('mongoose');
const {
  DonHang,
  CTDonHang,
  HoaDonBanHang,
  CTHoaDonBanHang,
  VanDon,
  PhieuThuChi,
  CongNoKhachHang,
  GiaoDichCongNoKhachHang,
  PhieuTraHang,
  CTPhieuTraHang,
  GopDonHang,
  PhanBoHang,
  CTPhanBoHang,
  NhapVatChua,
  XuatVatChua
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

async function loadOrderInvoices(orderId) {
  return HoaDonBanHang.find({
    don_hang_id: orderId,
    trang_thai: { $ne: 'cancelled' }
  })
    .select('_id ma_hoa_don')
    .lean();
}

async function countThuChiByOrders(orderIds) {
  if (!orderIds.length) return { count: 0, samples: [] };
  const objectIds = orderIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const rows = await PhieuThuChi.find({
    trang_thai: { $ne: 'cancelled' },
    don_hang_id: { $in: objectIds }
  })
    .select('ma_phieu don_hang_id')
    .limit(50)
    .lean();
  return {
    count: rows.length,
    samples: sampleTexts(rows, function(row) { return row.ma_phieu || ''; })
  };
}

async function buildOrderImpact(order) {
  const orderId = order._id;
  const orderIdStr = String(orderId);
  const warnings = [];
  let canTrash = true;
  let blockReason = '';

  if (order.deleted_at) {
    canTrash = false;
    blockReason = 'Đơn đã nằm trong thùng rác.';
  } else if (String(order.trang_thai || '') === 'merged') {
    canTrash = false;
    blockReason = 'Đơn đã gộp vào ' + (order.merged_to_ma_don_hang || 'đơn khác') + ', không thể xóa riêng.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'DonHang',
      entity_id: orderId,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Đơn đã nằm trong thùng rác.';
    }
  }

  if (canTrash && String(order.trang_thai || '') === 'cancelled') {
    warnings.push('Đơn đang ở trạng thái đã hủy.');
  }
  if (canTrash && String(order.trang_thai_giao_hang || '') !== 'chua_giao') {
    warnings.push('Đơn đã phát sinh giao hàng (' + (order.trang_thai_giao_hang || '') + ').');
  }
  const conNo = Math.max(0, Number(order.khach_can_tra || order.tong_thanh_toan || order.tong_tien || 0) - Number(order.khach_thanh_toan || 0));
  if (canTrash && conNo > 0) {
    warnings.push('Đơn còn công nợ khách: ' + conNo.toLocaleString('vi-VN') + ' VNĐ.');
  }

  const invoices = await loadOrderInvoices(orderId);
  const invoiceIds = invoices.map(function(row) { return row._id; });

  const [
    ctLines,
    vanDonRows,
    congNoRows,
    giaoDichRows,
    returnSlips,
    gopRows,
    phanBoRows,
    nhapVatRows,
    xuatVatRows
  ] = await Promise.all([
    CTDonHang.countDocuments({ don_hang_id: orderId }),
    VanDon.find({ don_hang_id: orderId, trang_thai: { $ne: 'cancelled' } })
      .select('ma_van_don')
      .lean(),
    CongNoKhachHang.countDocuments({ don_hang_id: orderId }),
    GiaoDichCongNoKhachHang.countDocuments({ don_hang_id: orderId, trang_thai: { $ne: 'cancelled' } }),
    invoiceIds.length
      ? PhieuTraHang.find({ hoa_don_id: { $in: invoiceIds }, trang_thai: { $ne: 'cancelled' } })
        .select('ma_phieu_tra')
        .lean()
      : [],
    GopDonHang.countDocuments({
      $or: [
        { don_nhan_id: orderId },
        { don_nguon_ids: orderId }
      ],
      trang_thai: { $ne: 'cancelled' }
    }),
    PhanBoHang.find({ don_hang_id: orderId, trang_thai: { $ne: 'cancelled' } })
      .select('_id ma_phan_bo')
      .lean(),
    NhapVatChua.countDocuments({ source_type: 'don_hang', source_id: orderId, trang_thai: { $ne: 'cancelled' } }),
    XuatVatChua.countDocuments({ source_type: 'don_hang', source_id: orderId, trang_thai: { $ne: 'cancelled' } })
  ]);

  const phanBoIds = phanBoRows.map(function(row) { return row._id; });
  const returnSlipIds = returnSlips.map(function(row) { return row._id; });

  const [ctInvoiceLineCount, ctReturnLineCount, ctPhanBoCount, thuChi] = await Promise.all([
    invoiceIds.length
      ? CTHoaDonBanHang.countDocuments({ hoa_don_id: { $in: invoiceIds } })
      : 0,
    returnSlipIds.length
      ? CTPhieuTraHang.countDocuments({ phieu_tra_hang_id: { $in: returnSlipIds } })
      : 0,
    phanBoIds.length
      ? CTPhanBoHang.countDocuments({ phan_bo_hang_id: { $in: phanBoIds } })
      : 0,
    countThuChiByOrders([orderIdStr])
  ]);

  if (canTrash && invoices.length > 0) {
    warnings.push('Đơn đã phát sinh hóa đơn bán hàng — xóa sẽ đưa cả dữ liệu liên quan vào thùng rác.');
  }
  if (canTrash && returnSlips.length > 0) {
    warnings.push('Đơn đã phát sinh trả hàng bán — xóa sẽ đưa cả dữ liệu liên quan vào thùng rác.');
  }

  const mergedSources = Array.isArray(order.merged_from_ma_don_hangs)
    ? order.merged_from_ma_don_hangs.filter(Boolean)
    : [];

  const groups = [
    {
      entity_type: 'CTDonHang',
      label: RELATION_LABELS.CTDonHang,
      count: ctLines,
      samples: []
    },
    {
      entity_type: 'HoaDonBanHang',
      label: RELATION_LABELS.HoaDonBanHang,
      count: invoices.length,
      samples: sampleTexts(invoices, function(row) { return row.ma_hoa_don || ''; })
    },
    {
      entity_type: 'CTHoaDonBanHang',
      label: RELATION_LABELS.CTHoaDonBanHang,
      count: ctInvoiceLineCount,
      samples: []
    },
    {
      entity_type: 'VanDon',
      label: RELATION_LABELS.VanDon,
      count: vanDonRows.length,
      samples: sampleTexts(vanDonRows, function(row) { return row.ma_van_don || ''; })
    },
    {
      entity_type: 'PhieuThuChi',
      label: RELATION_LABELS.PhieuThuChi,
      count: thuChi.count,
      samples: thuChi.samples
    },
    {
      entity_type: 'CongNoKhachHang',
      label: RELATION_LABELS.CongNoKhachHang,
      count: congNoRows,
      samples: []
    },
    {
      entity_type: 'GiaoDichCongNoKhachHang',
      label: RELATION_LABELS.GiaoDichCongNoKhachHang,
      count: giaoDichRows,
      samples: []
    },
    {
      entity_type: 'PhieuTraHang',
      label: RELATION_LABELS.PhieuTraHang,
      count: returnSlips.length,
      samples: sampleTexts(returnSlips, function(row) { return row.ma_phieu_tra || ''; })
    },
    {
      entity_type: 'CTPhieuTraHang',
      label: RELATION_LABELS.CTPhieuTraHang,
      count: ctReturnLineCount,
      samples: []
    },
    {
      entity_type: 'GopDonHang',
      label: RELATION_LABELS.GopDonHang,
      count: gopRows,
      samples: []
    },
    {
      entity_type: 'PhanBoHang',
      label: RELATION_LABELS.PhanBoHang,
      count: phanBoRows.length,
      samples: sampleTexts(phanBoRows, function(row) { return row.ma_phan_bo || ''; })
    },
    {
      entity_type: 'CTPhanBoHang',
      label: RELATION_LABELS.CTPhanBoHang,
      count: ctPhanBoCount,
      samples: []
    },
    {
      entity_type: 'NhapVatChua',
      label: RELATION_LABELS.NhapVatChua,
      count: nhapVatRows,
      samples: []
    },
    {
      entity_type: 'XuatVatChua',
      label: RELATION_LABELS.XuatVatChua,
      count: xuatVatRows,
      samples: []
    }
  ];

  if (mergedSources.length) {
    groups.push({
      entity_type: 'DonHang_merged',
      label: RELATION_LABELS.DonHang_merged,
      count: mergedSources.length,
      samples: mergedSources.slice(0, 3)
    });
  }

  const activeGroups = groups.filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    don_hang_id: orderIdStr,
    ma_don_hang: order.ma_don_hang || '',
    ten_khach: order.khach_hang_id?.ten_khach_hang || order.khach_hang_id?.ten_kh || '',
    trang_thai: order.trang_thai || '',
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

async function previewOrderTrash(orderIds, storeId) {
  const ids = normalizeIds(orderIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một đơn đặt hàng.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }

  const orders = await DonHang.find(filter)
    .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
    .lean();

  if (orders.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều đơn đặt hàng không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }

  const orderMap = orders.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});

  const items = [];
  for (const id of ids) {
    const order = orderMap[id];
    if (!order) continue;
    items.push(await buildOrderImpact(order));
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

async function moveOrdersToTrash(orderIds, storeId, userId) {
  const preview = await previewOrderTrash(orderIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các đơn đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];

  for (const item of preview.items) {
    if (!item.can_trash) continue;

    const order = await DonHang.findById(item.don_hang_id);
    if (!order) continue;

    order.deleted_at = now;
    order.deleted_by = userId || null;
    await order.save();

    const customerName = item.ten_khach || '';
    const root = await ThungRacItem.create({
      entity_type: 'DonHang',
      entity_id: order._id,
      ma_chung_tu: order.ma_don_hang || '',
      ten_hien_thi: customerName || order.ma_don_hang || 'Đơn đặt hàng',
      mo_ta_phu: customerName ? ('Khách hàng: ' + customerName) : '',
      cua_hang_id: order.cua_hang_id || storeId || null,
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
        entity_id: order._id,
        ma_chung_tu: childFields.ma_chung_tu,
        ten_hien_thi: childFields.ten_hien_thi,
        mo_ta_phu: childFields.mo_ta_phu,
        cua_hang_id: order.cua_hang_id || storeId || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        sort_order: sortOrder
      });
      sortOrder += 1;
    }

    moved.push({
      don_hang_id: String(order._id),
      ma_don_hang: order.ma_don_hang || '',
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
  previewOrderTrash,
  moveOrdersToTrash
};
