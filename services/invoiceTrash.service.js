const mongoose = require('mongoose');
const {
  HoaDonBanHang,
  CTHoaDonBanHang,
  VanDon,
  PhieuThuChi,
  CongNoKhachHang,
  GiaoDichCongNoKhachHang,
  PhieuTraHang,
  CTPhieuTraHang,
  GopHoaDon,
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

async function countThuChiByInvoices(invoiceIds) {
  if (!invoiceIds.length) return { count: 0, samples: [] };
  const objectIds = invoiceIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const rows = await PhieuThuChi.find({
    trang_thai: { $ne: 'cancelled' },
    hoa_don_id: { $in: objectIds }
  })
    .select('ma_phieu hoa_don_id')
    .limit(50)
    .lean();
  return {
    count: rows.length,
    samples: sampleTexts(rows, function(row) { return row.ma_phieu || ''; })
  };
}

async function buildInvoiceImpact(invoice) {
  const invoiceId = invoice._id;
  const invoiceIdStr = String(invoiceId);
  const warnings = [];
  let canTrash = true;
  let blockReason = '';

  if (invoice.deleted_at) {
    canTrash = false;
    blockReason = 'Hóa đơn đã nằm trong thùng rác.';
  } else if (String(invoice.trang_thai || '') === 'merged') {
    canTrash = false;
    blockReason = 'Hóa đơn đã gộp vào ' + (invoice.merged_to_ma_hoa_don || 'hóa đơn khác') + ', không thể xóa riêng.';
  } else {
    const inTrash = await ThungRacItem.exists({
      entity_type: 'HoaDonBanHang',
      entity_id: invoiceId,
      restored_at: null
    });
    if (inTrash) {
      canTrash = false;
      blockReason = 'Hóa đơn đã nằm trong thùng rác.';
    }
  }

  if (canTrash && String(invoice.trang_thai || '') === 'cancelled') {
    warnings.push('Hóa đơn đang ở trạng thái đã hủy.');
  }
  if (canTrash && invoice.da_tru_ton_kho) {
    warnings.push('Hóa đơn đã trừ tồn kho — xóa sẽ đưa cả dữ liệu liên quan vào thùng rác.');
  }
  const payable = Number(invoice.thanh_toan ?? invoice.tong_tien ?? 0) || 0;
  const paidFromReceipts = await PhieuThuChi.aggregate([
    {
      $match: {
        hoa_don_id: invoiceId,
        trang_thai: { $ne: 'cancelled' },
        loai_phieu: 'thu'
      }
    },
    { $group: { _id: null, total: { $sum: '$gia_tri' } } }
  ]);
  const paid = Number(paidFromReceipts[0]?.total || 0);
  const conNo = Math.max(0, payable - paid);
  if (canTrash && conNo > 0) {
    warnings.push('Hóa đơn còn công nợ khách: ' + conNo.toLocaleString('vi-VN') + ' VNĐ.');
  }

  const [
    ctLines,
    vanDonRows,
    congNoRows,
    giaoDichRows,
    returnSlips,
    gopRows,
    nhapVatRows,
    xuatVatRows,
    thuChi
  ] = await Promise.all([
    CTHoaDonBanHang.countDocuments({ hoa_don_id: invoiceId }),
    VanDon.find({ hoa_don_id: invoiceId, trang_thai: { $ne: 'cancelled' } })
      .select('ma_van_don')
      .lean(),
    CongNoKhachHang.countDocuments({ hoa_don_id: invoiceId }),
    GiaoDichCongNoKhachHang.countDocuments({ hoa_don_id: invoiceId, trang_thai: { $ne: 'cancelled' } }),
    PhieuTraHang.find({ hoa_don_id: invoiceId, trang_thai: { $ne: 'cancelled' }, deleted_at: null })
      .select('ma_phieu_tra')
      .lean(),
    GopHoaDon.countDocuments({
      $or: [
        { hoa_don_nhan_id: invoiceId },
        { hoa_don_nguon_ids: invoiceId }
      ],
      trang_thai: { $ne: 'cancelled' }
    }),
    NhapVatChua.countDocuments({ source_type: 'hoa_don', source_id: invoiceId, trang_thai: { $ne: 'cancelled' } }),
    XuatVatChua.countDocuments({ source_type: 'hoa_don', source_id: invoiceId, trang_thai: { $ne: 'cancelled' } }),
    countThuChiByInvoices([invoiceIdStr])
  ]);

  const returnSlipIds = returnSlips.map(function(row) { return row._id; });
  const ctReturnLineCount = returnSlipIds.length
    ? await CTPhieuTraHang.countDocuments({ phieu_tra_hang_id: { $in: returnSlipIds } })
    : 0;

  if (canTrash && returnSlips.length > 0) {
    warnings.push('Hóa đơn đã phát sinh trả hàng bán — xóa sẽ đưa cả dữ liệu liên quan vào thùng rác.');
  }
  if (canTrash && vanDonRows.length > 0) {
    warnings.push('Hóa đơn đã phát sinh vận đơn giao hàng.');
  }

  const mergedSources = Array.isArray(invoice.merged_from_ma_hoa_dons)
    ? invoice.merged_from_ma_hoa_dons.filter(Boolean)
    : [];

  const groups = [
    {
      entity_type: 'CTHoaDonBanHang',
      label: RELATION_LABELS.CTHoaDonBanHang,
      count: ctLines,
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
      entity_type: 'GopHoaDon',
      label: RELATION_LABELS.GopHoaDon,
      count: gopRows,
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
      entity_type: 'HoaDonBanHang_merged',
      label: RELATION_LABELS.HoaDonBanHang_merged,
      count: mergedSources.length,
      samples: mergedSources.slice(0, 3)
    });
  }

  const activeGroups = groups.filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    hoa_don_id: invoiceIdStr,
    ma_hoa_don: invoice.ma_hoa_don || '',
    ten_khach: invoice.khach_hang_id?.ten_khach_hang || '',
    trang_thai: invoice.trang_thai || '',
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

async function previewInvoiceTrash(invoiceIds, storeId) {
  const ids = normalizeIds(invoiceIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một hóa đơn.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }

  const invoices = await HoaDonBanHang.find(filter)
    .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
    .lean();

  if (invoices.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều hóa đơn không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }

  const invoiceMap = invoices.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});

  const items = [];
  for (const id of ids) {
    const invoice = invoiceMap[id];
    if (!invoice) continue;
    items.push(await buildInvoiceImpact(invoice));
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

async function moveInvoicesToTrash(invoiceIds, storeId, userId) {
  const preview = await previewInvoiceTrash(invoiceIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các hóa đơn đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];

  for (const item of preview.items) {
    if (!item.can_trash) continue;

    const invoice = await HoaDonBanHang.findById(item.hoa_don_id);
    if (!invoice) continue;

    invoice.deleted_at = now;
    invoice.deleted_by = userId || null;
    await invoice.save();

    const customerName = item.ten_khach || '';
    const root = await ThungRacItem.create({
      entity_type: 'HoaDonBanHang',
      entity_id: invoice._id,
      ma_chung_tu: invoice.ma_hoa_don || '',
      ten_hien_thi: customerName || invoice.ma_hoa_don || 'Hóa đơn bán hàng',
      mo_ta_phu: customerName ? ('Khách hàng: ' + customerName) : '',
      cua_hang_id: invoice.cua_hang_id || storeId || null,
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
        entity_id: invoice._id,
        ma_chung_tu: childFields.ma_chung_tu,
        ten_hien_thi: childFields.ten_hien_thi,
        mo_ta_phu: childFields.mo_ta_phu,
        cua_hang_id: invoice.cua_hang_id || storeId || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        sort_order: sortOrder
      });
      sortOrder += 1;
    }

    moved.push({
      hoa_don_id: String(invoice._id),
      ma_hoa_don: invoice.ma_hoa_don || '',
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
  previewInvoiceTrash,
  moveInvoicesToTrash
};
