const mongoose = require('mongoose');
const {
  Kho,
  HangHoa,
  TonKho,
  LoHang,
  TonKhoLo,
  TonKhoLoQuyCach,
  LichSuKho,
  GiaTriThuocTinh
} = require('../models/kiot.model');

const UNCLASSIFIED = 'Chưa phân loại';
const STOCK_EPSILON = 1e-8;

function stockQuantity(value) { return Math.round(Number(value) * 1e6) / 1e6; }
function stockRef(value) { return String(value && value._id || value || ''); }
function hasStockPrecision(value) {
  const scaled = Number(value) * 1e6;
  return Number.isFinite(scaled) && Number.isSafeInteger(Math.round(scaled)) && Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

const QUY_CACH_REQUIRED_MSG = 'Hàng/lô có tồn theo phân loại, vui lòng chọn phân loại cần trừ tồn.';

function toObjectId(value, fieldName) {
  if (!value) {
    throw new Error(`Thiếu ${fieldName}`);
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${fieldName} không hợp lệ`);
  }

  return new mongoose.Types.ObjectId(value);
}

function optionalObjectId(value, fieldName) {
  if (!value) {
    return null;
  }

  return toObjectId(value, fieldName);
}

function normalizeQuantity(value) {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Số lượng phải lớn hơn 0');
  }

  if (!hasStockPrecision(quantity) || stockQuantity(quantity) <= 0) {
    throw new Error('Số lượng chỉ được có tối đa 6 chữ số thập phân');
  }
  return stockQuantity(quantity);
}

function normalizeTenQuyCach(value) {
  return String(value || '').trim();
}

function isSellableLot(lot) {
  if (!lot || lot.trang_thai === 'huy' || lot.trang_thai_du_lieu === 'inactive') return false;
  if (!lot.han_su_dung) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(lot.han_su_dung);
  expiry.setHours(0, 0, 0, 0);
  return expiry.getTime() >= today.getTime();
}

function sortLotsFefo(a, b) {
  const aLot = a.lo_hang_id;
  const bLot = b.lo_hang_id;
  const aDate = aLot && aLot.han_su_dung ? new Date(aLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
  const bDate = bLot && bLot.han_su_dung ? new Date(bLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime();
}

function buildAllocationEntry(lotDoc, quantity) {
  const lotId = lotDoc?._id || lotDoc || null;
  return {
    lo_hang_id: lotId,
    ma_lo: lotDoc?.ma_lo || '',
    ten_lo: lotDoc?.ten_lo || '',
    han_su_dung: lotDoc?.han_su_dung || null,
    so_luong: Number(quantity) || 0
  };
}

function pushAllocation(allocations, lotDoc, quantity) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return allocations;
  const entry = buildAllocationEntry(lotDoc, qty);
  const key = String(entry.lo_hang_id || '');
  if (!key) return allocations;
  const existing = allocations.find(row => String(row.lo_hang_id) === key);
  if (existing) {
    existing.so_luong += qty;
    return allocations;
  }
  allocations.push(entry);
  return allocations;
}

function finalizeTruTonKho(inventory, allocations = []) {
  return {
    success: true,
    allocations,
    inventory
  };
}

async function getWarehouse(khoId, session) {
  const warehouse = await withSessionQuery(Kho.findById(khoId), session);

  if (!warehouse) {
    throw new Error('Không tìm thấy kho');
  }

  return warehouse;
}

async function ghiLichSuKho(params) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const warehouse = await getWarehouse(khoId, params.session);
  const historyData = {
    cua_hang_id: warehouse.cua_hang_id,
    chi_nhanh_id: warehouse.chi_nhanh_id,
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: Number(params.so_luong_thay_doi) || 0,
    ton_kho_sau: Number(params.ton_kho_sau) || 0,
    gia_tri_thay_doi: Number(params.gia_tri_thay_doi) || 0,
    ghi_chu: params.ghi_chu,
    ngay: params.ngay ? new Date(params.ngay) : new Date()
  };

  if (loHangId) {
    historyData.lo_hang_id = loHangId;
  }

  if (params.ton_kho_truoc != null) {
    historyData.ton_kho_truoc = Number(params.ton_kho_truoc) || 0;
  }
  if (params.ten_quy_cach) {
    historyData.ten_quy_cach = String(params.ten_quy_cach).trim();
  }
  if (params.cap_ton) {
    historyData.cap_ton = params.cap_ton;
  }

  const creatorId = optionalObjectId(params.nguoi_tao_id, 'nguoi_tao_id');
  if (creatorId) {
    historyData.nguoi_tao_id = creatorId;
  }

  return LichSuKho.create([historyData], withSessionOptions({}, params.session)).then(rows => rows[0]);
}

async function resolveTenQuyCachFromParams(params) {
  const direct = normalizeTenQuyCach(params.ten_quy_cach || params.ten_thuoc_tinh);
  if (direct) return direct;
  const attrId = optionalObjectId(params.gia_tri_thuoc_tinh_id, 'gia_tri_thuoc_tinh_id');
  if (!attrId) return '';
  if (GiaTriThuocTinh && typeof GiaTriThuocTinh.findById === 'function') {
    const attr = await withSessionQuery(GiaTriThuocTinh.findById(attrId).select('ten_gia_tri'), params.session).lean();
    const attrName = normalizeTenQuyCach(attr && attr.ten_gia_tri);
    if (attrName) return attrName;
  }
  if (params.kho_id && params.hang_hoa_id) {
    const rows = await withSessionQuery(TonKhoLoQuyCach.find({
      kho_id: toObjectId(params.kho_id, 'kho_id'), hang_hoa_id: toObjectId(params.hang_hoa_id, 'hang_hoa_id'),
      lo_hang_id: optionalObjectId(params.lo_hang_id, 'lo_hang_id'), gia_tri_thuoc_tinh_id: attrId
    }), params.session).lean();
    const names = [...new Set(rows.map(row => normalizeTenQuyCach(row.ten_quy_cach || row.ten_thuoc_tinh)).filter(Boolean))];
    if (names.length === 1) return names[0];
  }
  throw new Error('Không xác định được phân loại từ thuộc tính. Vui lòng chọn tên phân loại trong đúng kho và lô.');
}

async function lotHasQuyCachStock(khoId, hangHoaId, loHangId, session) {
  return Boolean(await withSessionQuery(TonKhoLoQuyCach.exists({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId
  }), session));
}

async function productHasQuyCachStock(khoId, hangHoaId, session) {
  return Boolean(await withSessionQuery(TonKhoLoQuyCach.exists({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    so_luong: { $gt: 0 }
  }), session));
}

async function resolveQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach, session) {
  const name = normalizeTenQuyCach(tenQuyCach);
  if (name) {
    const row = await withSessionQuery(TonKhoLoQuyCach.findOne({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId,
      $or: [{ ten_quy_cach: name }, { ten_thuoc_tinh: name }]
    }), session);
    return row;
  }

  const rows = await withSessionQuery(TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  }), session);
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw new Error('Lô có nhiều phân loại, vui lòng kiểm kho theo từng phân loại');
  }
  return rows[0];
}

function withSessionOptions(options = {}, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

async function withStockTransaction(params, operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation({ ...params, session }); });
    return result;
  } finally { await session.endSession(); }
}

// Every stock writer touches this existing aggregate row before reading detail
// rows. MongoDB retries a conflicting transaction with a fresh stock snapshot.
async function lockStockScope(params) {
  if (!params.session) throw new Error('Cập nhật tồn kho cần transaction.');
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const warehouse = await getWarehouse(khoId, params.session);
  if (params.cua_hang_id && stockRef(warehouse.cua_hang_id) !== stockRef(params.cua_hang_id)) {
    throw new Error('Kho không thuộc cửa hàng đang làm việc.');
  }
  return TonKho.findOneAndUpdate({ kho_id: khoId, hang_hoa_id: hangHoaId }, {
    $inc: { __v: 1 },
    $setOnInsert: { cua_hang_id: warehouse.cua_hang_id, kho_id: khoId, hang_hoa_id: hangHoaId, so_luong: 0 }
  }, { upsert: true, new: true, setDefaultsOnInsert: true, session: params.session });
}

async function ensureQuyCachStock(params) {
  const session = params.session;
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const lotId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const warehouse = await getWarehouse(khoId, session);
  if (params.cua_hang_id && stockRef(warehouse.cua_hang_id) !== stockRef(params.cua_hang_id)) throw new Error('Kho không thuộc cửa hàng đang làm việc.');
  const product = await withSessionQuery(HangHoa.findById(hangHoaId), session);
  if (!product || product.cua_hang_id && stockRef(product.cua_hang_id) !== stockRef(warehouse.cua_hang_id)) throw new Error('Hàng hóa không thuộc cửa hàng đang làm việc.');
  if (Boolean(product.quan_ly_theo_lo) !== Boolean(lotId)) throw new Error(product.quan_ly_theo_lo ? 'Vui lòng chọn lô hàng.' : 'Hàng hóa này không quản lý lô.');
  const inventory = await withSessionQuery(TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId }), session);
  if (inventory && !hasStockPrecision(inventory.so_luong)) throw new Error('Tồn cũ vượt độ chính xác 6 chữ số thập phân. Vui lòng đối soát trước khi phân loại.');
  const filter = { kho_id: khoId, hang_hoa_id: hangHoaId, lo_hang_id: lotId };
  let rows = await withSessionQuery(TonKhoLoQuyCach.find(filter), session).lean();
  let scopeQuantity = Number(inventory && inventory.so_luong || 0);
  let unitCost = Number(product.gia_von);
  let lot = null;
  if (lotId) {
    lot = await withSessionQuery(LoHang.findById(lotId), session);
    if (!lot || stockRef(lot.kho_id) !== stockRef(khoId) || stockRef(lot.hang_hoa_id) !== stockRef(hangHoaId)
      || stockRef(lot.cua_hang_id) !== stockRef(warehouse.cua_hang_id) || lot.trang_thai === 'huy' || lot.trang_thai_du_lieu === 'inactive') throw new Error('Lô không hợp lệ hoặc không thuộc hàng hóa/kho đang chọn.');
    const lotRows = await withSessionQuery(TonKhoLo.find({ kho_id: khoId, hang_hoa_id: hangHoaId }), session).lean();
    const aggregateQuantity = lotRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    if (Math.abs(aggregateQuantity - scopeQuantity) > STOCK_EPSILON) throw new Error('Tồn tổng và tồn lô chưa đối soát được. Vui lòng kiểm tra tồn kho trước khi phân loại.');
    const selected = lotRows.filter(row => stockRef(row.lo_hang_id) === stockRef(lotId));
    if (lotRows.some(row => !hasStockPrecision(row.so_luong))) throw new Error('Tồn lô cũ vượt độ chính xác cho phép. Vui lòng đối soát trước khi phân loại.');
    scopeQuantity = selected.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    if (Math.abs(Number(lot.so_luong_con_lai || 0) - scopeQuantity) > STOCK_EPSILON) throw new Error('Số lượng còn lại của lô không khớp tồn kho. Vui lòng đối soát trước khi phân loại.');
    unitCost = scopeQuantity > 0 ? selected.reduce((sum, row) => sum + Number(row.so_luong || 0) * Number(row.gia_von), 0) / scopeQuantity : Number(lot.gia_von);
  } else {
    const unexpected = await withSessionQuery(TonKhoLoQuyCach.exists({ kho_id: khoId, hang_hoa_id: hangHoaId, lo_hang_id: { $ne: null } }), session);
    if (unexpected) throw new Error('Hàng không quản lý lô đang có tồn theo phân loại gắn lô cũ. Vui lòng đối soát trước khi phân loại.');
  }
  if (!Number.isFinite(scopeQuantity) || scopeQuantity < 0 && !params.allow_negative) throw new Error('Tồn hiện tại không hợp lệ để phân loại.');
  const names = new Set();
  for (const row of rows) {
    const name = normalizeTenQuyCach(row.ten_quy_cach || row.ten_thuoc_tinh);
    if (!name || names.has(name) || !hasStockPrecision(row.so_luong) || Number(row.so_luong) < 0 && !params.allow_negative) throw new Error('Tồn theo phân loại cũ bị trùng hoặc không hợp lệ. Vui lòng đối soát trước khi phân loại.');
    names.add(name);
  }
  const total = rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  if (rows.length && Math.abs(total - scopeQuantity) > STOCK_EPSILON) throw new Error('Tổng tồn theo phân loại không khớp tồn kho. Vui lòng đối soát trước khi phân loại.');
  const bootstrapRequired = !rows.length;
  if (bootstrapRequired) {
    if (scopeQuantity > 0 && (!Number.isFinite(unitCost) || unitCost < 0)) throw new Error('Chưa xác định được giá vốn tồn cũ. Vui lòng đối soát trước khi phân loại.');
    const data = { cua_hang_id: warehouse.cua_hang_id, ...filter, ten_quy_cach: UNCLASSIFIED, ten_thuoc_tinh: UNCLASSIFIED,
      so_luong: stockQuantity(scopeQuantity), gia_von: Number.isFinite(unitCost) ? unitCost : 0,
      don_gia_nhap: Number.isFinite(unitCost) ? unitCost : 0, thanh_tien: scopeQuantity * (Number.isFinite(unitCost) ? unitCost : 0) };
    if (params.read_only) rows = [data];
    else {
      if (!session) throw new Error('Khởi tạo tồn theo phân loại cần giao dịch.');
      const created = await TonKhoLoQuyCach.create([data], { session });
      rows = created.map(row => typeof row.toObject === 'function' ? row.toObject() : row);
    }
  }
  return { inventory, warehouse, product, lot, rows, bootstrap_required: bootstrapRequired, bootstrap: bootstrapRequired };
}

async function mutateNoLotQuyCach(params, direction) {
  if (!params.session) return withStockTransaction(params, nested => mutateNoLotQuyCach(nested, direction));
  const state = await ensureQuyCachStock({ ...params, lo_hang_id: null, allow_negative: direction > 0 || params.allow_negative });
  const name = await resolveTenQuyCachFromParams(params) || UNCLASSIFIED;
  const qty = normalizeQuantity(params.so_luong);
  let row = state.rows.find(item => normalizeTenQuyCach(item.ten_quy_cach || item.ten_thuoc_tinh) === name);
  if (!row && direction < 0) throw new Error('Tồn theo phân loại không đủ để trừ.');
  const before = Number(row && row.so_luong || 0);
  const after = stockQuantity(before + direction * qty);
  if (after < 0 && !params.allow_negative) throw new Error('Tồn theo phân loại không đủ để trừ.');
  const oldCost = Number(row && row.gia_von || 0);
  const receivedCost = Number(params.gia_von || 0);
  if (!Number.isFinite(receivedCost) || receivedCost < 0) throw new Error('Giá vốn không hợp lệ.');
  const value = direction > 0 ? before * oldCost + qty * receivedCost : after * oldCost;
  const cost = after > 0 ? value / after : direction > 0 ? receivedCost : oldCost;
  const filter = { kho_id: params.kho_id, hang_hoa_id: params.hang_hoa_id, lo_hang_id: null, ten_quy_cach: name };
  await TonKhoLoQuyCach.findOneAndUpdate(row && row._id ? { _id: row._id } : filter, {
    $setOnInsert: { cua_hang_id: state.warehouse.cua_hang_id, kho_id: params.kho_id, hang_hoa_id: params.hang_hoa_id, lo_hang_id: null },
    $set: { ten_quy_cach: name, ten_thuoc_tinh: name, so_luong: after, gia_von: cost, don_gia_nhap: cost, thanh_tien: value,
      ...(params.gia_tri_thuoc_tinh_id ? { gia_tri_thuoc_tinh_id: params.gia_tri_thuoc_tinh_id } : {}) }
  }, { upsert: direction > 0, new: true, session: params.session });
  const synced = await syncTonKhoSauQuyCach(params.kho_id, params.hang_hoa_id, null, state.warehouse, cost, { session: params.session });
  await ghiLichSuKho({ ...params, lo_hang_id: null, ten_quy_cach: name, cap_ton: 'quy_cach',
    so_luong_thay_doi: direction * qty, ton_kho_truoc: before, ton_kho_sau: after,
    gia_tri_thay_doi: direction * qty * (direction > 0 ? receivedCost : oldCost) });
  return synced;
}

async function syncTonKhoSauQuyCach(khoId, hangHoaId, loHangId, warehouse, cost, options = {}) {
  const session = options.session;
  const qcRows = await withSessionQuery(TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId
  }), session).lean();
  const lotTotal = qcRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  const weightedCost = qcRows.reduce((sum, row) => {
    return sum + Number(row.so_luong || 0) * Number(row.gia_von || 0);
  }, 0);
  const avgCost = lotTotal > 0 ? weightedCost / lotTotal : Number(cost || 0);

  if (!loHangId) {
    const inventory = await TonKho.findOneAndUpdate({ kho_id: khoId, hang_hoa_id: hangHoaId }, {
      $setOnInsert: { cua_hang_id: warehouse.cua_hang_id, kho_id: khoId, hang_hoa_id: hangHoaId },
      $set: { so_luong: stockQuantity(lotTotal) }
    }, withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session));
    return { lotTotal: stockQuantity(lotTotal), productTotal: stockQuantity(lotTotal), inventory };
  }

  // TonKhoLo may contain one row per attribute. Updating an arbitrary row to
  // the whole lot total would count its other attribute rows again.
  const previousLotRows = await withSessionQuery(TonKhoLo.find({ kho_id: khoId, hang_hoa_id: hangHoaId, lo_hang_id: loHangId }), session).lean();
  const attributeGroups = new Map();
  for (const row of qcRows) {
    const key = stockRef(row.gia_tri_thuoc_tinh_id);
    if (!attributeGroups.has(key)) attributeGroups.set(key, { quantity: 0, value: 0 });
    const group = attributeGroups.get(key);
    group.quantity += Number(row.so_luong || 0);
    group.value += Number(row.so_luong || 0) * Number(row.gia_von || 0);
  }
  for (const row of previousLotRows) {
    const key = stockRef(row.gia_tri_thuoc_tinh_id);
    if (!attributeGroups.has(key)) attributeGroups.set(key, { quantity: 0, value: 0 });
  }
  if (!attributeGroups.size) attributeGroups.set('', { quantity: 0, value: 0 });
  for (const [attributeId, group] of attributeGroups) {
    const filter = { kho_id: khoId, hang_hoa_id: hangHoaId, lo_hang_id: loHangId, gia_tri_thuoc_tinh_id: attributeId || null };
    await TonKhoLo.findOneAndUpdate(filter, {
      $setOnInsert: { cua_hang_id: warehouse.cua_hang_id, ...filter },
      $set: { so_luong: stockQuantity(group.quantity), gia_von: group.quantity > 0 ? group.value / group.quantity : avgCost }
    }, withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session));
  }

  const lot = await withSessionQuery(LoHang.findById(loHangId), session);
  if (lot) {
    lot.so_luong_con_lai = lotTotal;
    if (lot.trang_thai !== 'huy') {
      lot.trang_thai = lotTotal > 0 ? 'active' : 'het_hang';
    }
    await lot.save(withSessionOptions({}, session));
  }

  const lotRows = await withSessionQuery(TonKhoLo.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  }), session).lean();
  const productTotal = lotRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  const inventory = await TonKho.findOneAndUpdate(
    {
      kho_id: khoId,
      hang_hoa_id: hangHoaId
    },
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        chi_nhanh_id: warehouse.chi_nhanh_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId
      },
      $set: {
        so_luong: productTotal
      }
    },
    withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
  );

  return { lotTotal, productTotal, inventory };
}

async function dieuChinhTonQuyCach(params, direction) {
  if (!params.session) return withStockTransaction(params, nested => dieuChinhTonQuyCach(nested, direction));
  const session = params.session;
  await lockStockScope(params);
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  if (!loHangId) return mutateNoLotQuyCach(params, direction);
  const state = await ensureQuyCachStock(params);
  const quantity = normalizeQuantity(params.so_luong);
  const cost = Number(params.gia_von || 0);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Giá vốn không hợp lệ.');
  const tenQuyCach = await resolveTenQuyCachFromParams(params) || UNCLASSIFIED;
  let qcStock = await resolveQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach, session);
  if (!qcStock) {
    if (direction < 0) throw new Error('Không tìm thấy tồn theo phân loại trong lô');
    qcStock = (await TonKhoLoQuyCach.create([{
      cua_hang_id: state.warehouse.cua_hang_id, kho_id: khoId, hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId, ten_quy_cach: tenQuyCach, ten_thuoc_tinh: tenQuyCach,
      so_luong: 0, don_gia_nhap: cost, gia_von: cost, thanh_tien: 0
    }], { session }))[0];
  }
  const beforeQc = Number(qcStock.so_luong || 0);
  const nextQc = stockQuantity(beforeQc + direction * quantity);
  if (nextQc < 0 && !params.allow_negative) throw new Error('Không cho tồn theo phân loại âm');
  const oldCost = Number(qcStock.gia_von || 0);
  const nextValue = direction > 0 ? beforeQc * oldCost + quantity * cost : nextQc * oldCost;
  const nextCost = nextQc > 0 ? nextValue / nextQc : direction > 0 ? cost : oldCost;
  qcStock.so_luong = nextQc;
  qcStock.gia_von = nextCost;
  qcStock.don_gia_nhap = nextCost;
  qcStock.thanh_tien = nextValue;
  qcStock.ten_quy_cach = tenQuyCach;
  qcStock.ten_thuoc_tinh = tenQuyCach;
  if (params.gia_tri_thuoc_tinh_id) qcStock.gia_tri_thuoc_tinh_id = params.gia_tri_thuoc_tinh_id;
  await qcStock.save({ session });
  await ghiLichSuKho({ ...params, lo_hang_id: loHangId, ten_quy_cach: tenQuyCach,
    cap_ton: 'quy_cach', so_luong_thay_doi: direction * quantity,
    ton_kho_truoc: beforeQc, ton_kho_sau: nextQc,
    gia_tri_thay_doi: direction * quantity * (direction > 0 ? cost : oldCost), session });
  return syncTonKhoSauQuyCach(khoId, hangHoaId, loHangId, state.warehouse, nextCost, { session });
}

async function truTonKhoQuyCach(params, inventory, quantity) {
  const session = params.session;
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const qcStockId = optionalObjectId(params.ton_kho_lo_quy_cach_id, 'ton_kho_lo_quy_cach_id');
  const warehouse = await withSessionQuery(Kho.findById(khoId), session);
  if (!warehouse) throw new Error('Không tìm thấy kho');
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  if (!tenQuyCach) {
    throw new Error('Chưa chọn phân loại cần trừ tồn');
  }
  const allowExpiredDisposal = params.allow_expired_lot === true && params.loai_phieu === 'xuat_huy' && Boolean(loHangId);
  const permittedLot = lot => Boolean(lot && lot.trang_thai !== 'huy' && lot.trang_thai_du_lieu !== 'inactive'
    && (isSellableLot(lot) || allowExpiredDisposal && stockRef(lot) === stockRef(loHangId)));
  if (loHangId) {
    const selectedLot = await withSessionQuery(LoHang.findById(loHangId), session);
    if (!selectedLot || stockRef(selectedLot.kho_id) !== stockRef(khoId) || stockRef(selectedLot.hang_hoa_id) !== stockRef(hangHoaId)
      || !permittedLot(selectedLot)) throw new Error('Lô đã hết hạn, bị hủy hoặc ngừng hoạt động, không thể xuất theo nghiệp vụ này.');
  }

  let qcRows = [];
  if (qcStockId) {
    const qcStock = await withSessionQuery(TonKhoLoQuyCach.findById(qcStockId).populate('lo_hang_id'), session);
    if (!qcStock) throw new Error('Không tìm thấy tồn theo phân loại trong lô');
    if (String(qcStock.kho_id) !== String(khoId)) throw new Error('Tồn theo phân loại không thuộc kho trả');
    if (String(qcStock.hang_hoa_id) !== String(hangHoaId)) throw new Error('Tồn theo phân loại không khớp hàng hóa');
    if (loHangId && String(qcStock.lo_hang_id?._id || qcStock.lo_hang_id) !== String(loHangId)) {
      throw new Error('Tồn theo phân loại không khớp lô hàng');
    }
    if (Number(qcStock.so_luong || 0) > 0) qcRows = [qcStock];
  } else {
    const qcFilter = {
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }],
      so_luong: { $gt: 0 }
    };
    if (loHangId) qcFilter.lo_hang_id = loHangId;

    qcRows = await withSessionQuery(TonKhoLoQuyCach.find(qcFilter)
      .populate('lo_hang_id')
      .sort({ updated_at: 1, created_at: 1 }), session);
  }
  qcRows = qcRows.filter(row => permittedLot(row.lo_hang_id)).sort(sortLotsFefo);

  let remaining = quantity;
  const allocations = [];

  for (const qcStock of qcRows) {
    if (remaining <= 0) break;
    const lotId = qcStock.lo_hang_id?._id || qcStock.lo_hang_id;
    if (!lotId) continue;

    const lot = qcStock.lo_hang_id?._id ? qcStock.lo_hang_id : await withSessionQuery(LoHang.findById(lotId), session);
    const qcQty = Number(qcStock.so_luong || 0);
    const take = Math.min(qcQty, remaining);
    if (take <= 0) continue;

    const beforeQc = qcQty;
    qcStock.so_luong = beforeQc - take;
    qcStock.thanh_tien = qcStock.so_luong * (Number(qcStock.don_gia_nhap || qcStock.gia_von) || 0);
    if (!qcStock.ten_quy_cach && qcStock.ten_thuoc_tinh) qcStock.ten_quy_cach = qcStock.ten_thuoc_tinh;
    await qcStock.save(withSessionOptions({}, session));

    await syncTonKhoSauQuyCach(khoId, hangHoaId, lotId, warehouse, undefined, { session });

    pushAllocation(allocations, lot, take);
    remaining -= take;
    await ghiLichSuKho({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: lotId,
      ten_quy_cach: qcStock.ten_quy_cach || qcStock.ten_thuoc_tinh,
      cap_ton: 'quy_cach',
      nguoi_tao_id: params.nguoi_tao_id,
      loai_phieu: params.loai_phieu,
      ma_phieu: params.ma_phieu,
      ngay: params.ngay,
      so_luong_thay_doi: -take,
      ton_kho_truoc: beforeQc,
      ton_kho_sau: qcStock.so_luong,
      gia_tri_thay_doi: -(take * (Number(qcStock.gia_von) || 0)),
      ghi_chu: params.ghi_chu,
      session
    });
  }

  if (remaining > 0) {
    if (qcStockId) {
      throw new Error('Tồn kho theo phân loại không đủ để trừ');
    }
    if (!params.allow_negative) {
      throw new Error('Tồn kho theo phân loại không đủ để trừ');
    }
    const targetLotId = loHangId || (qcRows[0] && (qcRows[0].lo_hang_id?._id || qcRows[0].lo_hang_id));
    let qcStock = null;
    if (targetLotId) {
      qcStock = await withSessionQuery(TonKhoLoQuyCach.findOne({
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: targetLotId,
        $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
      }), session);
    }
    if (!qcStock) {
      const findFilter = {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
      };
      if (targetLotId) findFilter.lo_hang_id = targetLotId;
      qcStock = await withSessionQuery(TonKhoLoQuyCach.findOne(findFilter), session);
    }
    if (!qcStock && targetLotId) {
      const createdRows = await TonKhoLoQuyCach.create([{
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: targetLotId,
        ten_quy_cach: tenQuyCach,
        ten_thuoc_tinh: tenQuyCach,
        so_luong: 0,
        don_gia_nhap: Number(params.gia_von) || 0,
        gia_von: Number(params.gia_von) || 0,
        thanh_tien: 0
      }], withSessionOptions({}, session));
      qcStock = createdRows[0];
    }
    if (qcStock) {
      const lotId = qcStock.lo_hang_id?._id || qcStock.lo_hang_id || targetLotId;
      const lot = lotId ? await withSessionQuery(LoHang.findById(lotId), session) : null;
      if (!permittedLot(lot)) throw new Error('Lô đã hết hạn, bị hủy hoặc ngừng hoạt động, không thể xuất theo nghiệp vụ này.');
      const beforeQc = Number(qcStock.so_luong || 0);
      qcStock.so_luong = beforeQc - remaining;
      qcStock.thanh_tien = qcStock.so_luong * (Number(qcStock.don_gia_nhap || qcStock.gia_von) || 0);
      if (!qcStock.ten_quy_cach && qcStock.ten_thuoc_tinh) qcStock.ten_quy_cach = qcStock.ten_thuoc_tinh;
      await qcStock.save(withSessionOptions({}, session));
      if (lotId) {
        await syncTonKhoSauQuyCach(khoId, hangHoaId, lotId, warehouse, undefined, { session });
      } else {
        inventory.so_luong -= remaining;
        await inventory.save(withSessionOptions({}, session));
      }
      if (lot) pushAllocation(allocations, lot, remaining);
      await ghiLichSuKho({
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: lotId,
        ten_quy_cach: qcStock.ten_quy_cach || qcStock.ten_thuoc_tinh,
        cap_ton: 'quy_cach',
        nguoi_tao_id: params.nguoi_tao_id,
        loai_phieu: params.loai_phieu,
        ma_phieu: params.ma_phieu,
        ngay: params.ngay,
        so_luong_thay_doi: -remaining,
        ton_kho_truoc: beforeQc,
        ton_kho_sau: qcStock.so_luong,
        gia_tri_thay_doi: -(remaining * (Number(qcStock.gia_von) || 0)),
        ghi_chu: (params.ghi_chu || '') + ' (trừ âm tồn)',
        session
      });
      remaining = 0;
    } else {
      inventory.so_luong -= remaining;
      await inventory.save(withSessionOptions({}, session));
      remaining = 0;
    }
  }

  const refreshed = await withSessionQuery(TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId }), session);
  if (!params.allow_negative && (!refreshed || refreshed.so_luong < 0)) {
    throw new Error('Tồn kho không đủ để trừ');
  }
  return finalizeTruTonKho(refreshed || inventory, allocations);
}

async function congTonKho(params) {
  if (!params.session) return withStockTransaction(params, congTonKho);
  const session = params.session;
  await lockStockScope(params);
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const cost = Number(params.gia_von) || 0;
  const warehouse = await withSessionQuery(Kho.findById(khoId), session);
  if (!warehouse) {
    throw new Error('Không tìm thấy kho');
  }
  const product = await withSessionQuery(HangHoa.findById(hangHoaId).select('quan_ly_theo_lo gia_von cua_hang_id'), session);
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  const useQuyCach = Boolean(
    params.sync_quy_cach || tenQuyCach || (manageLots && loHangId && await lotHasQuyCachStock(khoId, hangHoaId, loHangId, session))
  );

  if (!manageLots) {
    loHangId = null;
  } else if (!loHangId) {
    throw new Error('Hàng hóa quản lý theo lô phải có lô hàng khi nhập kho');
  }

  if (!manageLots && (useQuyCach || await lotHasQuyCachStock(khoId, hangHoaId, null, session))) {
    const synced = await mutateNoLotQuyCach({ ...params, lo_hang_id: null, ten_quy_cach: tenQuyCach || UNCLASSIFIED }, 1);
    return synced.inventory;
  }

  if (manageLots && loHangId && useQuyCach) {
    if (!tenQuyCach) {
      throw new Error('Lô có tồn theo phân loại, vui lòng chọn phân loại cần cộng tồn.');
    }
    const synced = await dieuChinhTonQuyCach(Object.assign({}, params, { ten_quy_cach: tenQuyCach }), 1);
    return synced.inventory;
  }

  const inventory = await TonKho.findOneAndUpdate(
    {
      kho_id: khoId,
      hang_hoa_id: hangHoaId
    },
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        chi_nhanh_id: warehouse.chi_nhanh_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId
      },
      $inc: {
        so_luong: quantity
      }
    },
    withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
  );

  if (loHangId) {
    await TonKhoLo.findOneAndUpdate(
      {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId
      },
      {
        $setOnInsert: {
          cua_hang_id: warehouse.cua_hang_id,
          kho_id: khoId,
          hang_hoa_id: hangHoaId,
          lo_hang_id: loHangId
        },
        $set: {
          gia_von: cost
        },
        $inc: {
          so_luong: quantity
        }
      },
      withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
    );

    await LoHang.findByIdAndUpdate(loHangId, {
      $inc: {
        so_luong_con_lai: quantity
      }
    }, withSessionOptions({}, session));
  }

  await ghiLichSuKho({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    ngay: params.ngay,
    so_luong_thay_doi: quantity,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: quantity * cost,
    ghi_chu: params.ghi_chu,
    session
  });

  return inventory;
}

async function truTonKho(params) {
  if (!params.session) return withStockTransaction(params, truTonKho);
  const session = params.session;
  await lockStockScope(params);
  const allowNegative = Boolean(params.allow_negative);
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const product = await withSessionQuery(HangHoa.findById(hangHoaId).select('quan_ly_theo_lo gia_von cua_hang_id'), session);
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  const useQuyCach = Boolean(
    params.sync_quy_cach || tenQuyCach
  );

  if (!manageLots) {
    loHangId = null;
  }

  let inventory = await withSessionQuery(TonKho.findOne({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  }), session);

  if (!inventory) {
    if (!allowNegative) {
      throw new Error('Tồn kho không đủ để trừ');
    }
    const warehouse = await getWarehouse(khoId, params.session);
    inventory = (await TonKho.create([{
      cua_hang_id: warehouse.cua_hang_id,
      chi_nhanh_id: warehouse.chi_nhanh_id,
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      so_luong: 0
    }], withSessionOptions({}, session)))[0];
  } else if (!allowNegative && inventory.so_luong < quantity) {
    throw new Error('Tồn kho không đủ để trừ');
  }

  if (!manageLots && (useQuyCach || await lotHasQuyCachStock(khoId, hangHoaId, null, session))) {
    const synced = await mutateNoLotQuyCach({ ...params, lo_hang_id: null, ten_quy_cach: tenQuyCach || UNCLASSIFIED }, -1);
    return finalizeTruTonKho(synced.inventory);
  }

  if (manageLots && useQuyCach) {
    return truTonKhoQuyCach(params, inventory, quantity);
  }

  if (manageLots && loHangId && await lotHasQuyCachStock(khoId, hangHoaId, loHangId, session)) {
    throw new Error(QUY_CACH_REQUIRED_MSG);
  }

  if (manageLots && !loHangId && await productHasQuyCachStock(khoId, hangHoaId, session)) {
    throw new Error(QUY_CACH_REQUIRED_MSG);
  }

  if (manageLots && !loHangId) {
    let remaining = quantity;
    const allocations = [];
    const lotRows = await withSessionQuery(TonKhoLo.find({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      so_luong: { $gt: 0 }
    })
      .populate('lo_hang_id')
      .sort({ updated_at: 1, created_at: 1 }), session);

    const sellableLotRows = lotRows.filter(row => isSellableLot(row.lo_hang_id)).sort(sortLotsFefo);

    for (const row of sellableLotRows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.so_luong || 0), remaining);
      if (take <= 0) continue;

      row.so_luong -= take;
      await row.save(withSessionOptions({}, session));

      if (row.lo_hang_id) {
        const lot = row.lo_hang_id;
        lot.so_luong_con_lai = Math.max(0, Number(lot.so_luong_con_lai || 0) - take);
        lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
        await lot.save(withSessionOptions({}, session));
        pushAllocation(allocations, lot, take);
      }

      remaining -= take;
      await ghiLichSuKho({
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: row.lo_hang_id?._id || row.lo_hang_id,
        nguoi_tao_id: params.nguoi_tao_id,
        loai_phieu: params.loai_phieu,
        ma_phieu: params.ma_phieu,
        ngay: params.ngay,
        so_luong_thay_doi: -take,
        ton_kho_sau: inventory.so_luong - (quantity - remaining),
        gia_tri_thay_doi: -(take * (Number(row.gia_von) || 0)),
        ghi_chu: params.ghi_chu || 'Tự trừ theo FEFO',
        session
      });
    }

    if (remaining > 0 && !allowNegative) {
      throw new Error('Tồn kho theo lô không đủ để trừ');
    }

    inventory.so_luong -= quantity;
    await inventory.save(withSessionOptions({}, session));
    return finalizeTruTonKho(inventory, allocations);
  }

  let lotInventory = null;
  const allocations = [];
  if (manageLots && loHangId) {
    lotInventory = await withSessionQuery(TonKhoLo.findOne({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId
    }), session);

    if (!lotInventory) {
      if (!allowNegative) {
        throw new Error('Tồn kho theo lô không đủ để trừ');
      }
      const warehouse = await getWarehouse(khoId, params.session);
      lotInventory = (await TonKhoLo.create([{
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        so_luong: 0,
        gia_von: Number(params.gia_von) || 0
      }], withSessionOptions({}, session)))[0];
    } else if (!allowNegative && lotInventory.so_luong < quantity) {
      throw new Error('Tồn kho theo lô không đủ để trừ');
    }

    const lot = await withSessionQuery(LoHang.findById(loHangId), session);
    if (lot) {
      if (!allowNegative && (lot.so_luong_con_lai || 0) < quantity) {
        throw new Error('Số lượng còn lại của lô không đủ để trừ');
      }

      lotInventory.so_luong -= quantity;
      await lotInventory.save(withSessionOptions({}, session));

      lot.so_luong_con_lai = Number(lot.so_luong_con_lai || 0) - quantity;
      lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
      await lot.save(withSessionOptions({}, session));
      pushAllocation(allocations, lot, quantity);
    }
  }

  inventory.so_luong -= quantity;
  await inventory.save(withSessionOptions({}, session));

  const unitCost = lotInventory ? Number(lotInventory.gia_von) || 0 : Number(params.gia_von) || 0;
  await ghiLichSuKho({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    ngay: params.ngay,
    so_luong_thay_doi: -quantity,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: -(quantity * unitCost),
    ghi_chu: params.ghi_chu,
    session: params.session
  });

  return finalizeTruTonKho(inventory, allocations);
}

async function layTonKhoTheoKho(kho_id) {
  const khoId = toObjectId(kho_id, 'kho_id');

  return TonKho.find({ kho_id: khoId })
    .populate('hang_hoa_id')
    .sort({ updated_at: -1, created_at: -1 });
}

async function layTonKhoTheoLo(kho_id, hang_hoa_id) {
  const khoId = toObjectId(kho_id, 'kho_id');
  const hangHoaId = toObjectId(hang_hoa_id, 'hang_hoa_id');

  return TonKhoLo.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  })
    .populate('lo_hang_id')
    .sort({ updated_at: -1, created_at: -1 });
}

module.exports = {
  UNCLASSIFIED,
  lockStockScope,
  ensureQuyCachStock,
  dieuChinhTonQuyCach,
  congTonKho,
  truTonKho,
  ghiLichSuKho,
  syncTonKhoSauQuyCach,
  lotHasQuyCachStock,
  productHasQuyCachStock,
  resolveTenQuyCachFromParams,
  layTonKhoTheoKho,
  layTonKhoTheoLo
};
