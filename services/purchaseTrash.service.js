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
  VatChua,
  GopPhieuNhap
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');
const {
  rollbackCompletedPurchaseEffects,
  restoreCompletedPurchaseEffects,
  normalizeQuyCachItems
} = require('./purchase.service');
const { cancelNhapVatChuaBySource } = require('./vatChuaImport.service');

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

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

function withSessionOptions(options = {}, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 5).map(pickFn).filter(Boolean);
}

function idStrings(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) { return String(row._id); });
}

function statusSnapshot(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(function(map, row) {
    map[String(row._id)] = {
      trang_thai: row.trang_thai || '',
      deleted_at: row.deleted_at || null,
      deleted_by: row.deleted_by || null,
      ghi_chu: row.ghi_chu || ''
    };
    return map;
  }, {});
}

function money(value) {
  return Math.max(0, Number(value || 0));
}

function inventoryImpactFromRows(rows) {
  const byProduct = {};
  let quantity = 0;
  let amount = 0;
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const qty = Number(row.so_luong || 0);
    const key = String(row.hang_hoa_id || '');
    quantity += qty;
    amount += Number(row.thanh_tien || 0);
    if (!key) return;
    if (!byProduct[key]) byProduct[key] = { hang_hoa_id: key, so_luong: 0, thanh_tien: 0 };
    byProduct[key].so_luong += qty;
    byProduct[key].thanh_tien += Number(row.thanh_tien || 0);
  });
  return {
    so_luong: quantity,
    thanh_tien: amount,
    by_product: Object.keys(byProduct).map(function(key) { return byProduct[key]; })
  };
}

function quyCachImpactFromRows(rows) {
  let count = 0;
  let quantity = 0;
  const samples = [];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    normalizeQuyCachItems(row.lot_info && row.lot_info.quy_cach_items).forEach(function(qc) {
      count += 1;
      quantity += Number(qc.so_luong || 0);
      if (samples.length < 5) samples.push(qc.ten_quy_cach + ': ' + Number(qc.so_luong || 0));
    });
  });
  return { count, quantity, samples };
}

function buildGroup(entityType, rows, action, extra = {}) {
  const docs = Array.isArray(rows) ? rows : [];
  return Object.assign({
    entity_type: entityType,
    label: RELATION_LABELS[entityType] || entityType,
    count: docs.length,
    samples: sampleTexts(docs, function(row) {
      return row.ma_phieu || row.ma_phieu_nhap || row.ma_phieu_tra_nhap || row.ma_hoa_don || row.ma_lo || row.ma_nhap_vat_chua || String(row._id || '');
    }),
    action: action
  }, extra);
}

async function countThuChiByPurchases(purchaseIds, session) {
  if (!purchaseIds.length) return [];
  const objectIds = purchaseIds.map(function(id) { return new mongoose.Types.ObjectId(id); });
  return withSessionQuery(PhieuThuChi.find({
    deleted_at: null,
    trang_thai: { $ne: 'cancelled' },
    $or: [
      { phieu_nhap_id: { $in: objectIds } },
      { 'allocations.phieu_nhap_id': { $in: objectIds } }
    ]
  }).select('ma_phieu phieu_nhap_id allocations gia_tri trang_thai ghi_chu').lean(), session);
}

async function loadPurchaseRelations(purchaseId, session) {
  const [
    ctLines,
    returnSlips,
    returnLineRows,
    congNoRows,
    thuChiRows,
    giaoDichRows,
    hoaDonDauVaoRows,
    loRows,
    vatChuaRows,
    gopRows
  ] = await Promise.all([
    withSessionQuery(CTPhieuNhap.find({ phieu_nhap_id: purchaseId }).select('_id hang_hoa_id lo_hang_id so_luong thanh_tien don_gia_nhap lot_info').lean(), session),
    withSessionQuery(PhieuTraHangNhap.find({ phieu_nhap_id: purchaseId, trang_thai: { $ne: 'cancelled' }, deleted_at: null }).select('_id ma_phieu_tra_nhap tong_tien_tra trang_thai').lean(), session),
    withSessionQuery(CTPhieuTraHangNhap.find({ phieu_nhap_id: purchaseId, deleted_at: null }).select('_id phieu_tra_nhap_id phieu_nhap_id so_luong thanh_tien').lean(), session),
    withSessionQuery(CongNoNhaCungCap.find({ phieu_nhap_id: purchaseId, deleted_at: null }).select('_id so_tien loai ghi_chu').lean(), session),
    countThuChiByPurchases([String(purchaseId)], session),
    withSessionQuery(GiaoDichCongNoNhaCungCap.find({
      deleted_at: null,
      trang_thai: { $ne: 'cancelled' },
      $or: [
        { phieu_nhap_id: purchaseId },
        { 'phan_bo_phieu_nhap.phieu_nhap_id': purchaseId }
      ]
    }).select('_id ma_giao_dich gia_tri loai_giao_dich trang_thai ghi_chu').lean(), session),
    withSessionQuery(HoaDonDauVao.find({ phieu_nhap_id: purchaseId, trang_thai: { $ne: 'cancelled' } }).select('_id ma_hoa_don tong_tien trang_thai ghi_chu').lean(), session),
    withSessionQuery(LoHang.find({ phieu_nhap_id: purchaseId }).select('_id ma_lo ten_lo so_luong_ban_dau so_luong_con_lai trang_thai').lean(), session),
    withSessionQuery(NhapVatChua.find({ source_type: 'phieu_nhap', source_id: purchaseId, deleted_at: null, trang_thai: { $ne: 'cancelled' } }).select('_id ma_nhap_vat_chua tong_so_luong tong_tien trang_thai items').lean(), session),
    withSessionQuery(GopPhieuNhap.find({
      $or: [
        { phieu_nhan_id: purchaseId },
        { phieu_nguon_ids: purchaseId }
      ],
      trang_thai: { $ne: 'cancelled' }
    }).select('_id ma_gop_phieu_nhap trang_thai').lean(), session)
  ]);

  return {
    ctLines,
    returnSlips,
    returnLineRows,
    congNoRows,
    thuChiRows,
    giaoDichRows,
    hoaDonDauVaoRows,
    loRows,
    vatChuaRows,
    gopRows
  };
}

async function buildPurchaseImpact(purchase, session) {
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
    const inTrash = await withSessionQuery(ThungRacItem.exists({
      entity_type: 'PhieuNhap',
      entity_id: purchaseId,
      restored_at: null
    }), session);
    if (inTrash) {
      canTrash = false;
      blockReason = 'Phiếu đã nằm trong thùng rác.';
    }
  }

  const rel = await loadPurchaseRelations(purchaseId, session);
  if (canTrash && rel.returnSlips.length > 0) {
    canTrash = false;
    blockReason = 'Phiếu nhập đã có phiếu trả hàng nhập liên quan. Vui lòng xử lý các phiếu trả hàng nhập trước.';
  }
  if (canTrash && String(purchase.trang_thai || '') === 'cancelled') {
    warnings.push('Phiếu đang ở trạng thái đã hủy.');
  }
  if (canTrash && Number(purchase.con_no_ncc || 0) > 0) {
    warnings.push('Phiếu còn công nợ NCC: ' + Number(purchase.con_no_ncc || 0).toLocaleString('vi-VN') + ' VND.');
  }

  const stockImpact = inventoryImpactFromRows(rel.ctLines);
  const qcImpact = quyCachImpactFromRows(rel.ctLines);
  const groups = [
    buildGroup('CTPhieuNhap', rel.ctLines, 'soft_delete_child_or_keep_with_parent', {
      affected_quantity: stockImpact.so_luong,
      affected_amount: stockImpact.thanh_tien
    }),
    buildGroup('LoHang', rel.loRows, purchase.trang_thai === 'completed' ? 'rollback_lot_stock_then_keep_until_purge' : 'keep_until_purge', {
      affected_quantity: rel.loRows.reduce(function(sum, row) { return sum + Number(row.so_luong_con_lai || 0); }, 0)
    }),
    {
      entity_type: 'TonKho',
      label: 'Tồn kho',
      count: stockImpact.by_product.length,
      samples: stockImpact.by_product.slice(0, 5).map(function(row) { return row.hang_hoa_id + ': ' + row.so_luong; }),
      action: purchase.trang_thai === 'completed' ? 'hoan_tac_ton_kho' : 'giu_nguyen',
      affected_quantity: stockImpact.so_luong,
      affected_amount: stockImpact.thanh_tien
    },
    {
      entity_type: 'TonKhoLoQuyCach',
      label: 'Tồn quy cách theo lô',
      count: qcImpact.count,
      samples: qcImpact.samples,
      action: purchase.trang_thai === 'completed' ? 'hoan_tac_ton_quy_cach' : 'giu_nguyen',
      affected_quantity: qcImpact.quantity
    },
    buildGroup('PhieuThuChi', rel.thuChiRows, 'soft_delete_cancel_cashbook', {
      affected_amount: rel.thuChiRows.reduce(function(sum, row) { return sum + money(row.gia_tri); }, 0)
    }),
    buildGroup('CongNoNhaCungCap', rel.congNoRows, 'soft_delete_rollback_supplier_debt', {
      affected_amount: rel.congNoRows.reduce(function(sum, row) { return sum + money(row.so_tien); }, 0)
    }),
    buildGroup('GiaoDichCongNoNhaCungCap', rel.giaoDichRows, 'soft_delete_cancel_debt_transaction', {
      affected_amount: rel.giaoDichRows.reduce(function(sum, row) { return sum + money(row.gia_tri); }, 0)
    }),
    buildGroup('HoaDonDauVao', rel.hoaDonDauVaoRows, 'cancel_keep_until_purge', {
      affected_amount: rel.hoaDonDauVaoRows.reduce(function(sum, row) { return sum + money(row.tong_tien); }, 0)
    }),
    buildGroup('NhapVatChua', rel.vatChuaRows, 'rollback_vat_chua_stock_soft_delete', {
      affected_quantity: rel.vatChuaRows.reduce(function(sum, row) { return sum + Number(row.tong_so_luong || 0); }, 0)
    }),
    buildGroup('PhieuTraHangNhap', rel.returnSlips, rel.returnSlips.length ? 'chan_xoa' : 'giu_nguyen'),
    buildGroup('CTPhieuTraHangNhap', rel.returnLineRows, rel.returnLineRows.length ? 'chan_xoa_theo_phieu_tra' : 'giu_nguyen'),
    buildGroup('GopPhieuNhap', rel.gopRows, rel.gopRows.length ? 'chan_xoa_hoac_xu_ly_phieu_gop_truoc' : 'giu_nguyen')
  ].filter(function(group) { return Number(group.count || 0) > 0 || ['TonKho', 'TonKhoLoQuyCach'].includes(group.entity_type); });

  if (canTrash && rel.gopRows.length) {
    canTrash = false;
    blockReason = 'Phiếu nhập đang nằm trong chứng từ gộp. Vui lòng xử lý phiếu gộp trước.';
  }

  return {
    phieu_nhap_id: purchaseIdStr,
    ma_phieu_nhap: purchase.ma_phieu_nhap || '',
    ten_ncc: purchase.nha_cung_cap_id?.ten_ncc || purchase.nha_cung_cap_id?.ten_nha_cung_cap || '',
    trang_thai: purchase.trang_thai || '',
    tong_tien: Number(purchase.tong_tien || 0),
    can_tra_ncc: Number(purchase.can_tra_ncc || 0),
    con_no_ncc: Number(purchase.con_no_ncc || 0),
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: warnings,
    groups: groups,
    blocking_documents: {
      phieu_tra_hang_nhap: rel.returnSlips.map(function(row) {
        return { _id: String(row._id), ma_chung_tu: row.ma_phieu_tra_nhap || '' };
      }),
      gop_phieu_nhap: rel.gopRows.map(function(row) {
        return { _id: String(row._id), ma_chung_tu: row.ma_gop_phieu_nhap || '' };
      })
    },
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
          samples: [],
          action: group.action,
          affected_quantity: 0,
          affected_amount: 0
        };
      }
      map[key].count += Number(group.count || 0);
      map[key].affected_quantity += Number(group.affected_quantity || 0);
      map[key].affected_amount += Number(group.affected_amount || 0);
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
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;

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
    if (purchaseMap[id]) items.push(await buildPurchaseImpact(purchaseMap[id]));
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

async function softDeletePurchaseRelations(purchase, rel, now, userId, session) {
  const receiptIds = idStrings(rel.thuChiRows);
  const congNoIds = idStrings(rel.congNoRows);
  const giaoDichIds = idStrings(rel.giaoDichRows);
  const hoaDonIds = idStrings(rel.hoaDonDauVaoRows);
  const vatChuaIds = idStrings(rel.vatChuaRows);

  if (receiptIds.length) {
    await PhieuThuChi.updateMany(
      { _id: { $in: receiptIds } },
      {
        $set: {
          deleted_at: now,
          deleted_by: userId || null,
          trang_thai: 'cancelled',
          nguoi_huy_id: userId || null,
          ngay_huy: now,
          ly_do_huy: 'Đưa phiếu nhập vào thùng rác'
        }
      },
      withSessionOptions({}, session)
    );
  }
  if (congNoIds.length) {
    await CongNoNhaCungCap.updateMany(
      { _id: { $in: congNoIds } },
      { $set: { deleted_at: now, deleted_by: userId || null } },
      withSessionOptions({}, session)
    );
  }
  if (giaoDichIds.length) {
    await GiaoDichCongNoNhaCungCap.updateMany(
      { _id: { $in: giaoDichIds } },
      {
        $set: {
          deleted_at: now,
          deleted_by: userId || null,
          trang_thai: 'cancelled',
          nguoi_huy_id: userId || null,
          ngay_huy: now,
          ly_do_huy: 'Đưa phiếu nhập vào thùng rác'
        }
      },
      withSessionOptions({}, session)
    );
  }
  if (hoaDonIds.length) {
    await HoaDonDauVao.updateMany(
      { _id: { $in: hoaDonIds } },
      { $set: { trang_thai: 'cancelled' } },
      withSessionOptions({}, session)
    );
  }
  if (vatChuaIds.length) {
    await cancelNhapVatChuaBySource(purchase.cua_hang_id, 'phieu_nhap', purchase._id, session);
    await NhapVatChua.updateMany(
      { _id: { $in: vatChuaIds } },
      { $set: { deleted_at: now, deleted_by: userId || null } },
      withSessionOptions({}, session)
    );
  }
}

async function createTrashItemsForPurchase(purchase, item, rel, metadata, now, userId, session) {
  const supplierName = item.ten_ncc || '';
  const rootRows = await ThungRacItem.create([{
    entity_type: 'PhieuNhap',
    entity_id: purchase._id,
    ma_chung_tu: purchase.ma_phieu_nhap || '',
    ten_hien_thi: supplierName || purchase.ma_phieu_nhap || 'Phiếu nhập',
    mo_ta_phu: supplierName ? ('Nhà cung cấp: ' + supplierName) : '',
    cua_hang_id: purchase.cua_hang_id,
    deleted_at: now,
    deleted_by: userId || null,
    is_trash_root: true,
    trash_group_id: null,
    metadata,
    sort_order: 0
  }], { session });
  const root = rootRows[0];
  let sortOrder = 1;
  const childDocs = [];

  const childSources = [
    ['CTPhieuNhap', rel.ctLines],
    ['LoHang', rel.loRows],
    ['PhieuThuChi', rel.thuChiRows],
    ['CongNoNhaCungCap', rel.congNoRows],
    ['GiaoDichCongNoNhaCungCap', rel.giaoDichRows],
    ['HoaDonDauVao', rel.hoaDonDauVaoRows],
    ['NhapVatChua', rel.vatChuaRows]
  ];
  childSources.forEach(function(pair) {
    const entityType = pair[0];
    const rows = pair[1] || [];
    rows.forEach(function(row) {
      const fields = buildTrashChildFields({ entity_type: entityType, count: 1, samples: [] });
      childDocs.push({
        entity_type: entityType,
        entity_id: row._id,
        ma_chung_tu: row.ma_phieu || row.ma_hoa_don || row.ma_lo || row.ma_nhap_vat_chua || fields.ma_chung_tu,
        ten_hien_thi: fields.ten_hien_thi,
        mo_ta_phu: fields.mo_ta_phu,
        cua_hang_id: purchase.cua_hang_id,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        metadata: { parent_entity_type: 'PhieuNhap', parent_entity_id: String(purchase._id) },
        sort_order: sortOrder++
      });
    });
  });

  const stockGroups = (item.groups || []).filter(function(group) {
    return ['TonKho', 'TonKhoLoQuyCach'].includes(group.entity_type) && Number(group.count || 0) > 0;
  });
  stockGroups.forEach(function(group) {
    const fields = buildTrashChildFields(group);
    childDocs.push({
      entity_type: group.entity_type,
      entity_id: purchase._id,
      ma_chung_tu: fields.ma_chung_tu,
      ten_hien_thi: fields.ten_hien_thi,
      mo_ta_phu: fields.mo_ta_phu,
      cua_hang_id: purchase.cua_hang_id,
      deleted_at: now,
      deleted_by: userId || null,
      is_trash_root: false,
      trash_group_id: root._id,
      metadata: {
        group_only: true,
        parent_entity_type: 'PhieuNhap',
        parent_entity_id: String(purchase._id),
        action: group.action,
        affected_quantity: group.affected_quantity || 0,
        affected_amount: group.affected_amount || 0
      },
      sort_order: sortOrder++
    });
  });

  if (childDocs.length) await ThungRacItem.insertMany(childDocs, { session });
  return root;
}

async function movePurchasesToTrash(purchaseIds, storeId, userId) {
  const ids = normalizeIds(purchaseIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một phiếu nhập.');
  const session = await mongoose.startSession();
  try {
    const moved = [];
    await session.withTransaction(async function() {
      const preview = await previewPurchaseTrash(ids, storeId);
      if (!preview.can_proceed) {
        const firstBlock = preview.items.find(function(row) { return !row.can_trash; });
        throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa các phiếu đã chọn vào thùng rác.');
      }

      const now = new Date();
      for (const item of preview.items) {
        const filter = { _id: item.phieu_nhap_id, deleted_at: null };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
        const purchase = await withSessionQuery(PhieuNhap.findOne(filter), session);
        if (!purchase) throw createHttpError(404, 'Không tìm thấy phiếu nhập hoặc phiếu đã nằm trong thùng rác.');
        if (String(purchase.trang_thai || '') === 'merged') {
          throw createHttpError(400, 'Phiếu đã gộp, không thể xóa riêng.');
        }

        const rel = await loadPurchaseRelations(purchase._id, session);
        if (rel.returnSlips.length) {
          throw createHttpError(400, 'Phiếu nhập ' + (purchase.ma_phieu_nhap || '') + ' đã có phiếu trả hàng nhập. Vui lòng xử lý phiếu trả trước.');
        }
        if (rel.gopRows.length) {
          throw createHttpError(400, 'Phiếu nhập ' + (purchase.ma_phieu_nhap || '') + ' đang nằm trong chứng từ gộp. Vui lòng xử lý phiếu gộp trước.');
        }

        const originalStatus = purchase.trang_thai || 'draft';
        const rows = await withSessionQuery(CTPhieuNhap.find({ phieu_nhap_id: purchase._id }), session).lean();
        if (originalStatus === 'completed') {
          await rollbackCompletedPurchaseEffects(purchase, rows, { userId, session });
        }

        const metadata = {
          original_status: originalStatus,
          rollback_applied: originalStatus === 'completed',
          child_ids: {
            ct_phieu_nhap: idStrings(rel.ctLines),
            lo_hang: idStrings(rel.loRows),
            phieu_thu_chi: idStrings(rel.thuChiRows),
            cong_no_nha_cung_cap: idStrings(rel.congNoRows),
            giao_dich_cong_no_nha_cung_cap: idStrings(rel.giaoDichRows),
            hoa_don_dau_vao: idStrings(rel.hoaDonDauVaoRows),
            nhap_vat_chua: idStrings(rel.vatChuaRows)
          },
          snapshots: {
            phieu_thu_chi: statusSnapshot(rel.thuChiRows),
            giao_dich_cong_no_nha_cung_cap: statusSnapshot(rel.giaoDichRows),
            hoa_don_dau_vao: statusSnapshot(rel.hoaDonDauVaoRows),
            nhap_vat_chua: statusSnapshot(rel.vatChuaRows)
          }
        };

        await softDeletePurchaseRelations(purchase, rel, now, userId, session);
        purchase.deleted_at = now;
        purchase.deleted_by = userId || null;
        await purchase.save(withSessionOptions({}, session));
        const root = await createTrashItemsForPurchase(purchase, item, rel, metadata, now, userId, session);
        moved.push({
          phieu_nhap_id: String(purchase._id),
          ma_phieu_nhap: purchase.ma_phieu_nhap || '',
          trash_root_id: String(root._id)
        });
      }
    });
    return { moved_count: moved.length, moved };
  } finally {
    await session.endSession();
  }
}

function toObjectIds(ids) {
  return normalizeIds(ids).map(function(id) { return new mongoose.Types.ObjectId(id); });
}

async function restoreVatChuaImports(ids, snapshots, session) {
  if (!ids.length) return;
  const docs = await withSessionQuery(NhapVatChua.find({ _id: { $in: toObjectIds(ids) } }), session);
  for (const doc of docs) {
    const items = Array.isArray(doc.items) ? doc.items : [];
    for (const item of items) {
      if (!item.vat_chua_id || Number(item.so_luong || 0) <= 0) continue;
      await VatChua.updateOne(
        { _id: item.vat_chua_id },
        { $inc: { so_luong_ton: Number(item.so_luong || 0) } },
        withSessionOptions({}, session)
      );
    }
    const snapshot = snapshots && snapshots[String(doc._id)] || {};
    doc.trang_thai = snapshot.trang_thai || 'active';
    doc.deleted_at = null;
    doc.deleted_by = null;
    await doc.save(withSessionOptions({}, session));
  }
}

async function restoreStatusDocs(Model, ids, snapshots, defaultStatus, session) {
  const objectIds = toObjectIds(ids || []);
  if (!objectIds.length) return;
  for (const id of objectIds) {
    const snapshot = snapshots && snapshots[String(id)] || {};
    const setData = { deleted_at: null, deleted_by: null };
    if (defaultStatus || snapshot.trang_thai) setData.trang_thai = snapshot.trang_thai || defaultStatus;
    if (snapshot.ghi_chu != null) setData.ghi_chu = snapshot.ghi_chu;
    await Model.updateOne(
      { _id: id },
      { $set: setData, $unset: { nguoi_huy_id: '', ngay_huy: '', ly_do_huy: '' } },
      withSessionOptions({}, session)
    );
  }
}

async function restorePurchasesFromTrash(rootTrashIds, storeId, userId) {
  const rootIds = normalizeIds(rootTrashIds);
  if (!rootIds.length) throw createHttpError(400, 'Vui lòng chọn phiếu nhập cần khôi phục.');
  const session = await mongoose.startSession();
  try {
    let restoredCount = 0;
    await session.withTransaction(async function() {
      const roots = await withSessionQuery(ThungRacItem.find({
        _id: { $in: toObjectIds(rootIds) },
        entity_type: 'PhieuNhap',
        is_trash_root: true,
        restored_at: null,
        cua_hang_id: storeId
      }), session).lean();
      if (roots.length !== rootIds.length) {
        throw createHttpError(404, 'Không tìm thấy phiếu nhập trong thùng rác.');
      }

      const now = new Date();
      for (const root of roots) {
        const metadata = root.metadata || {};
        const snapshots = metadata.snapshots || {};
        if (!metadata.original_status) {
          throw createHttpError(400, 'Thiếu snapshot trạng thái gốc, không thể khôi phục ' + (root.ma_chung_tu || 'phiếu nhập') + '.');
        }
        const purchase = await withSessionQuery(PhieuNhap.findOne({
          _id: root.entity_id,
          cua_hang_id: storeId,
          deleted_at: { $ne: null }
        }), session);
        if (!purchase) throw createHttpError(404, 'Không tìm thấy phiếu nhập đã xóa.');

        const rows = await withSessionQuery(CTPhieuNhap.find({ phieu_nhap_id: purchase._id }), session).lean();
        if (metadata.original_status === 'completed') {
          await restoreCompletedPurchaseEffects(purchase, rows, { userId, session });
        }

        const childIds = metadata.child_ids || {};
        if ((childIds.cong_no_nha_cung_cap || []).length) {
          await CongNoNhaCungCap.updateMany(
            { _id: { $in: toObjectIds(childIds.cong_no_nha_cung_cap) } },
            { $set: { deleted_at: null, deleted_by: null } },
            withSessionOptions({}, session)
          );
        }
        if ((childIds.giao_dich_cong_no_nha_cung_cap || []).length) {
          await restoreStatusDocs(GiaoDichCongNoNhaCungCap, childIds.giao_dich_cong_no_nha_cung_cap, snapshots.giao_dich_cong_no_nha_cung_cap, 'active', session);
        }
        if ((childIds.phieu_thu_chi || []).length) {
          await restoreStatusDocs(PhieuThuChi, childIds.phieu_thu_chi, snapshots.phieu_thu_chi, 'paid', session);
        }
        if ((childIds.hoa_don_dau_vao || []).length) {
          await restoreStatusDocs(HoaDonDauVao, childIds.hoa_don_dau_vao, snapshots.hoa_don_dau_vao, 'completed', session);
        }
        await restoreVatChuaImports(childIds.nhap_vat_chua || [], snapshots.nhap_vat_chua, session);

        purchase.trang_thai = metadata.original_status;
        purchase.deleted_at = null;
        purchase.deleted_by = null;
        await purchase.save(withSessionOptions({}, session));

        await ThungRacItem.updateMany(
          {
            cua_hang_id: storeId,
            restored_at: null,
            $or: [
              { _id: root._id },
              { trash_group_id: root._id }
            ]
          },
          { $set: { restored_at: now } },
          withSessionOptions({}, session)
        );
        restoredCount += 1;
      }
    });
    return { restored_count: restoredCount };
  } finally {
    await session.endSession();
  }
}

module.exports = {
  RELATION_LABELS,
  previewPurchaseTrash,
  movePurchasesToTrash,
  restorePurchasesFromTrash
};
