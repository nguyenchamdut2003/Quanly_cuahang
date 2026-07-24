const mongoose = require('mongoose');
const {
  HangHoa,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LoHang,
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
  PhieuKiemKho,
  CTPhieuKiemKho,
  PhieuXuatHuy,
  CTXuatHuy,
  PhieuXuatNoiBo,
  CTXuatNoiBo,
  PhanBoHang,
  CTPhanBoHang
} = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

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

function activeFilter(extra) {
  return Object.assign({}, extra || {}, {
    $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
  });
}

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const source = limit ? rows.slice(0, limit) : rows;
  return source.map(pickFn).filter(Boolean);
}

function idList(rows, key) {
  const map = {};
  (rows || []).forEach(function(row) {
    const id = row && row[key] ? String(row[key]) : '';
    if (id && mongoose.Types.ObjectId.isValid(id)) map[id] = true;
  });
  return Object.keys(map).map(function(id) { return new mongoose.Types.ObjectId(id); });
}

async function loadParentRows(DetailModel, detailFilter, ParentModel, parentField, selectFields, codePicker) {
  const details = await DetailModel.find(detailFilter).select(parentField).lean();
  const parentIds = idList(details, parentField);
  if (!parentIds.length) return { count: 0, samples: [], parentIds: [] };
  const parents = await ParentModel.find(activeFilter({ _id: { $in: parentIds } }))
    .select(selectFields)
    .lean();
  return {
    count: parents.length,
    samples: sampleTexts(parents, codePicker),
    parentIds: parents.map(function(row) { return row._id; })
  };
}

async function buildProductImpact(product, storeId) {
  const productId = product._id;
  const productIdStr = String(productId);
  const inTrash = await ThungRacItem.exists({
    entity_type: 'HangHoa',
    entity_id: productId,
    restored_at: null
  });

  let canTrash = true;
  let blockReason = '';
  if (product.deleted_at || inTrash) {
    canTrash = false;
    blockReason = 'Hàng hóa đã nằm trong thùng rác.';
  }

  const [
    purchase,
    supplierReturn,
    order,
    invoice,
    saleReturn,
    stockCheck,
    disposal,
    internalIssue,
    allocation,
    stockCount,
    lotStockCount,
    qcStockCount,
    lotCount,
    historyCount,
    priceCount,
    priceBookCount,
    attributeCount
  ] = await Promise.all([
    loadParentRows(CTPhieuNhap, { hang_hoa_id: productId }, PhieuNhap, 'phieu_nhap_id', 'ma_phieu_nhap', function(row) { return row.ma_phieu_nhap || ''; }),
    loadParentRows(CTPhieuTraHangNhap, { hang_hoa_id: productId }, PhieuTraHangNhap, 'phieu_tra_nhap_id', 'ma_phieu_tra_nhap', function(row) { return row.ma_phieu_tra_nhap || ''; }),
    loadParentRows(CTDonHang, { hang_hoa_id: productId }, DonHang, 'don_hang_id', 'ma_don_hang', function(row) { return row.ma_don_hang || ''; }),
    loadParentRows(CTHoaDonBanHang, { hang_hoa_id: productId }, HoaDonBanHang, 'hoa_don_id', 'ma_hoa_don', function(row) { return row.ma_hoa_don || ''; }),
    loadParentRows(CTPhieuTraHang, { hang_hoa_id: productId }, PhieuTraHang, 'phieu_tra_hang_id', 'ma_phieu_tra', function(row) { return row.ma_phieu_tra || ''; }),
    loadParentRows(CTPhieuKiemKho, { hang_hoa_id: productId }, PhieuKiemKho, 'phieu_kiem_kho_id', 'ma_kiem_kho', function(row) { return row.ma_kiem_kho || ''; }),
    loadParentRows(CTXuatHuy, { hang_hoa_id: productId }, PhieuXuatHuy, 'phieu_xuat_huy_id', 'ma_xuat_huy', function(row) { return row.ma_xuat_huy || ''; }),
    loadParentRows(CTXuatNoiBo, { hang_hoa_id: productId }, PhieuXuatNoiBo, 'phieu_xuat_id', 'ma_xuat_noi_bo', function(row) { return row.ma_xuat_noi_bo || ''; }),
    loadParentRows(CTPhanBoHang, { hang_hoa_id: productId }, PhanBoHang, 'phan_bo_hang_id', 'ma_phan_bo', function(row) { return row.ma_phan_bo || ''; }),
    TonKho.countDocuments({ hang_hoa_id: productId }),
    TonKhoLo.countDocuments({ hang_hoa_id: productId }),
    TonKhoLoQuyCach.countDocuments({ hang_hoa_id: productId }),
    LoHang.countDocuments({ hang_hoa_id: productId }),
    LichSuKho.countDocuments({ hang_hoa_id: productId }),
    GiaBanHangHoa.countDocuments({ hang_hoa_id: productId }),
    CTBangGia.countDocuments({ hang_hoa_id: productId }),
    HangHoaThuocTinh.countDocuments({ hang_hoa_id: productId })
  ]);

  const voucherGroups = [
    { entity_type: 'PhieuNhap', label: ENTITY_LABELS.PhieuNhap, count: purchase.count, samples: purchase.samples, parentIds: purchase.parentIds },
    { entity_type: 'PhieuTraHangNhap', label: ENTITY_LABELS.PhieuTraHangNhap, count: supplierReturn.count, samples: supplierReturn.samples, parentIds: supplierReturn.parentIds },
    { entity_type: 'DonHang', label: ENTITY_LABELS.DonHang, count: order.count, samples: order.samples, parentIds: order.parentIds },
    { entity_type: 'HoaDonBanHang', label: ENTITY_LABELS.HoaDonBanHang, count: invoice.count, samples: invoice.samples, parentIds: invoice.parentIds },
    { entity_type: 'PhieuTraHang', label: ENTITY_LABELS.PhieuTraHang, count: saleReturn.count, samples: saleReturn.samples, parentIds: saleReturn.parentIds },
    { entity_type: 'PhieuKiemKho', label: ENTITY_LABELS.PhieuKiemKho, count: stockCheck.count, samples: stockCheck.samples, parentIds: stockCheck.parentIds },
    { entity_type: 'PhieuXuatHuy', label: ENTITY_LABELS.PhieuXuatHuy, count: disposal.count, samples: disposal.samples, parentIds: disposal.parentIds },
    { entity_type: 'PhieuXuatNoiBo', label: ENTITY_LABELS.PhieuXuatNoiBo, count: internalIssue.count, samples: internalIssue.samples, parentIds: internalIssue.parentIds },
    { entity_type: 'PhanBoHang', label: ENTITY_LABELS.PhanBoHang, count: allocation.count, samples: allocation.samples, parentIds: allocation.parentIds }
  ].filter(function(group) { return Number(group.count || 0) > 0; });

  const dataGroups = [
    { entity_type: 'TonKho', label: 'Tồn kho', count: stockCount, samples: [] },
    { entity_type: 'TonKhoLo', label: 'Tồn kho lô', count: lotStockCount, samples: [] },
    { entity_type: 'TonKhoLoQuyCach', label: 'Tồn kho quy cách', count: qcStockCount, samples: [] },
    { entity_type: 'LoHang', label: ENTITY_LABELS.LoHang, count: lotCount, samples: [] },
    { entity_type: 'LichSuKho', label: 'Lịch sử kho', count: historyCount, samples: [] },
    { entity_type: 'GiaBanHangHoa', label: 'Giá bán hàng hóa', count: priceCount, samples: [] },
    { entity_type: 'CTBangGia', label: 'Giá trong bảng giá', count: priceBookCount, samples: [] },
    { entity_type: 'HangHoaThuocTinh', label: 'Thuộc tính hàng hóa', count: attributeCount, samples: [] }
  ].filter(function(group) { return Number(group.count || 0) > 0; });

  const groups = voucherGroups.concat(dataGroups);
  return {
    hang_hoa_id: productIdStr,
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: voucherGroups.length ? ['Các phiếu/chứng từ bên dưới sẽ được đưa vào thùng rác cùng hàng hóa.'] : [],
    groups: groups,
    voucher_groups: voucherGroups,
    total_related: groups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
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
        if (sample && map[key].samples.indexOf(sample) < 0) map[key].samples.push(sample);
      });
    });
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    return String(a.label || '').localeCompare(String(b.label || ''), 'vi');
  });
}

async function previewProductTrash(productIds, storeId) {
  const ids = normalizeIds(productIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một hàng hóa.');

  const filter = { _id: { $in: ids } };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  const products = await HangHoa.find(filter).lean();
  if (products.length !== ids.length) {
    throw createHttpError(404, 'Một hoặc nhiều hàng hóa không tồn tại hoặc không thuộc cửa hàng đang làm việc.');
  }

  const productMap = products.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});
  const items = [];
  for (const id of ids) {
    if (productMap[id]) items.push(await buildProductImpact(productMap[id], storeId));
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

async function markParentsDeleted(item, now, userId) {
  const update = { $set: { deleted_at: now, deleted_by: userId || null } };
  for (const group of item.voucher_groups || []) {
    const ids = group.parentIds || [];
    if (!ids.length) continue;
    if (group.entity_type === 'PhieuNhap') await PhieuNhap.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhieuTraHangNhap') await PhieuTraHangNhap.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'DonHang') await DonHang.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'HoaDonBanHang') await HoaDonBanHang.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhieuTraHang') await PhieuTraHang.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhieuKiemKho') await PhieuKiemKho.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhieuXuatHuy') await PhieuXuatHuy.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhieuXuatNoiBo') await PhieuXuatNoiBo.updateMany({ _id: { $in: ids } }, update);
    else if (group.entity_type === 'PhanBoHang') await PhanBoHang.updateMany({ _id: { $in: ids } }, update);
  }
}

async function moveProductsToTrash(productIds, storeId, userId) {
  const preview = await previewProductTrash(productIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa hàng hóa đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];
  for (const item of preview.items) {
    if (!item.can_trash) continue;
    const product = await HangHoa.findById(item.hang_hoa_id);
    if (!product) continue;

    product.deleted_at = now;
    product.deleted_by = userId || null;
    product.trang_thai = 'inactive';
    await product.save();
    await markParentsDeleted(item, now, userId);

    const root = await ThungRacItem.create({
      entity_type: 'HangHoa',
      entity_id: product._id,
      ma_chung_tu: product.ma_hang || '',
      ten_hien_thi: product.ten_hang || product.ma_hang || 'Hàng hóa',
      mo_ta_phu: product.ma_hang ? ('Mã hàng: ' + product.ma_hang) : '',
      cua_hang_id: product.cua_hang_id || storeId || null,
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
        entity_id: product._id,
        ma_chung_tu: childFields.ma_chung_tu,
        ten_hien_thi: childFields.ten_hien_thi,
        mo_ta_phu: childFields.mo_ta_phu,
        cua_hang_id: product.cua_hang_id || storeId || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        sort_order: sortOrder
      });
      sortOrder += 1;
    }

    moved.push({
      hang_hoa_id: String(product._id),
      ma_hang: product.ma_hang || '',
      ten_hang: product.ten_hang || '',
      trash_root_id: String(root._id)
    });
  }

  return { moved_count: moved.length, moved: moved };
}

module.exports = {
  previewProductTrash,
  moveProductsToTrash
};
